/**
 * ============================================================================
 * SINCRONIZAÇÃO V2 — COORDENADOR PERSISTENTE E SCHEDULER (D1 ⇄ GOOGLE SHEETS)
 * ============================================================================
 * Gerencia a execução automática e segura dos fluxos Inbound (Sheets → D1)
 * e Outbound (D1 → Sheets) no Cloudflare Workers:
 *  - Coordenação persistente de leases e fencing no D1 (anti-split-brain).
 *  - Ordem explícita de execução: Inbound (Captura Causal) -> Outbound (Despacho CAS).
 *  - Regras formais para cada modo: SHADOW, CAPTURE, BIDIRECTIONAL, LEGACY, PAUSED, QUARANTINED.
 *  - Proteção estrita contra concorrência entre instâncias distintas do Cloudflare Workers.
 *  - Desativação segura por padrão (SYNC_V2_ENABLED e SYNC_V2_AUTO_ENABLED).
 *  - Ausência total de credenciais e dados pessoais na auditoria.
 * ============================================================================
 */

import type { ISyncSpreadsheetAdapter } from "./sync-sheet-contracts";
import { GoogleSheetsRealAdapter } from "./sync-sheet-real-adapter";
import {
  reconcileInboundFromSpreadsheet,
  type InboundSyncReport,
} from "./sync-inbound-reconciler";
import {
  SyncV2Orchestrator,
  type SyncBatchResult,
  type TabNameResolver,
  createTabNameResolver,
} from "./sync-orchestrator";

// ----------------------------------------------------------------------------
// 1. CONTRATOS E REGRAS FORMAIS DE CADA MODO DE INTEGRAÇÃO
// ----------------------------------------------------------------------------

export type IntegrationMode =
  | "LEGACY"
  | "SHADOW"
  | "CAPTURE"
  | "BIDIRECTIONAL"
  | "PAUSED"
  | "QUARANTINED";

export interface ModePermissions {
  /** Indica se a integração pode ser executada pelo scheduler */
  eligible: boolean;
  /** Permite executar o fluxo inbound (Sheets -> D1) */
  canRunInbound: boolean;
  /** Se true, o inbound não grava no D1 (simulação segura) */
  inboundDryRun: boolean;
  /** Permite executar o fluxo outbound (D1 -> Sheets) */
  canRunOutbound: boolean;
  /** Se true, o outbound não grava no Google Sheets nem muta operações no D1 (simulação segura) */
  outboundDryRun: boolean;
}

export const INTEGRATION_MODE_RULES: Record<IntegrationMode, ModePermissions> = {
  // BIDIRECTIONAL: Sincronização plena em ambas as direções (único modo que permite escrita real no Sheets)
  BIDIRECTIONAL: {
    eligible: true,
    canRunInbound: true,
    inboundDryRun: false,
    canRunOutbound: true,
    outboundDryRun: false,
  },
  // CAPTURE: Apenas captura do Sheets para o D1; nunca despacha para o Sheets
  CAPTURE: {
    eligible: true,
    canRunInbound: true,
    inboundDryRun: false,
    canRunOutbound: false,
    outboundDryRun: true,
  },
  // SHADOW: Modo observador de homologação passiva (inbound dryRun, outbound estritamente simulado sem escrita no Sheets)
  SHADOW: {
    eligible: true,
    canRunInbound: true,
    inboundDryRun: true,
    canRunOutbound: true,
    outboundDryRun: true,
  },
  // LEGACY: Período legado ou desativado para V2
  LEGACY: {
    eligible: false,
    canRunInbound: false,
    inboundDryRun: true,
    canRunOutbound: false,
    outboundDryRun: true,
  },
  // PAUSED: Parada operacional administrativa imediata (bloqueia ambas as direções)
  PAUSED: {
    eligible: false,
    canRunInbound: false,
    inboundDryRun: true,
    canRunOutbound: false,
    outboundDryRun: true,
  },
  // QUARANTINED: Quarentena de integridade (bloqueia ambas as direções)
  QUARANTINED: {
    eligible: false,
    canRunInbound: false,
    inboundDryRun: true,
    canRunOutbound: false,
    outboundDryRun: true,
  },
};

// ----------------------------------------------------------------------------
// 2. COORDENAÇÃO PERSISTENTE COM LEASE E FENCING NO D1
// ----------------------------------------------------------------------------

export type LeaseType = "INBOUND" | "OUTBOUND" | "FULL_CYCLE";

export interface CoordinatorLeaseRecord {
  integration_id: string;
  lease_owner: string;
  lease_epoch: number;
  lease_type: LeaseType;
  lease_until: string;
  acquired_at: string;
  updated_at: string;
}

export type LeaseAcquireResult =
  | {
      ok: true;
      epoch: number;
      owner: string;
      leaseUntil: string;
    }
  | {
      ok: false;
      status: "LOCKED" | "INTEGRATION_NOT_FOUND" | "DATABASE_ERROR";
      currentOwner?: string;
      leaseUntil?: string;
      error?: string;
    };

/**
 * Garante a criação da tabela sync_coordinator_leases no D1 se não existir.
 */
export async function ensureCoordinatorLeasesTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS sync_coordinator_leases (
        integration_id TEXT PRIMARY KEY,
        lease_owner TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL DEFAULT 1,
        lease_type TEXT NOT NULL CHECK (lease_type IN ('INBOUND', 'OUTBOUND', 'FULL_CYCLE')),
        lease_until TEXT NOT NULL,
        acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (integration_id) REFERENCES sync_integrations(integration_id) ON DELETE CASCADE
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_sync_coordinator_leases_exp ON sync_coordinator_leases (lease_until)`,
    )
    .run();
}

/**
 * Tenta adquirir atômica e persistentemente o lease da integração no D1.
 * Trata expiração e usurpação segura por workers mais recentes via incremento de epoch.
 */
export async function acquireCoordinatorLease(params: {
  db: D1Database;
  integrationId: string;
  owner: string;
  leaseType: LeaseType;
  durationSeconds?: number;
  now?: string;
}): Promise<LeaseAcquireResult> {
  const {
    db,
    integrationId,
    owner,
    leaseType,
    durationSeconds = 30,
    now = new Date().toISOString(),
  } = params;

  await ensureCoordinatorLeasesTable(db);

  const existing = await db
    .prepare(
      `SELECT integration_id, lease_owner, lease_epoch, lease_type, lease_until
       FROM sync_coordinator_leases
       WHERE integration_id = ?`,
    )
    .bind(integrationId)
    .first<CoordinatorLeaseRecord>();

  const leaseUntilDate = new Date(new Date(now).getTime() + durationSeconds * 1000).toISOString();

  // Caso 1: Lease ainda não existe
  if (!existing) {
    try {
      await db
        .prepare(
          `INSERT INTO sync_coordinator_leases (
             integration_id, lease_owner, lease_epoch, lease_type, lease_until, acquired_at, updated_at
           ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
        )
        .bind(integrationId, owner, leaseType, leaseUntilDate, now, now)
        .run();

      return {
        ok: true,
        epoch: 1,
        owner,
        leaseUntil: leaseUntilDate,
      };
    } catch {
      // Conflito de inserção simultânea por outro worker: recai na checagem CAS abaixo
    }
  }

  // Caso 2: Lease existente
  // Permite aquisição se já expirou (datetime(lease_until) < datetime(now)) OU se já pertence ao mesmo owner (renovação)
  const isExpired = existing
    ? new Date(existing.lease_until).getTime() <= new Date(now).getTime()
    : false;
  const isSameOwner = existing?.lease_owner === owner;

  if (existing && !isExpired && !isSameOwner) {
    return {
      ok: false,
      status: "LOCKED",
      currentOwner: existing.lease_owner,
      leaseUntil: existing.lease_until,
      error: `Integração bloqueada pelo worker ${existing.lease_owner} até ${existing.lease_until}`,
    };
  }

  // Tenta aquisição CAS no D1 incrementando monotonicamente o lease_epoch
  const nextEpoch = existing ? (isSameOwner ? existing.lease_epoch : existing.lease_epoch + 1) : 1;

  const updateRes = await db
    .prepare(
      `UPDATE sync_coordinator_leases
       SET lease_owner = ?,
           lease_epoch = ?,
           lease_type = ?,
           lease_until = ?,
           updated_at = ?
       WHERE integration_id = ?
         AND (
           datetime(lease_until) <= datetime(?)
           OR lease_owner = ?
         )`,
    )
    .bind(owner, nextEpoch, leaseType, leaseUntilDate, now, integrationId, now, owner)
    .run();

  const success = (updateRes.meta.changes ?? 0) > 0;
  if (!success) {
    const current = await db
      .prepare(`SELECT lease_owner, lease_until FROM sync_coordinator_leases WHERE integration_id = ?`)
      .bind(integrationId)
      .first<{ lease_owner: string; lease_until: string }>();

    return {
      ok: false,
      status: "LOCKED",
      currentOwner: current?.lease_owner,
      leaseUntil: current?.lease_until,
      error: "Falha na aquisição atômica de lease: corrida de concorrência com outro worker.",
    };
  }

  return {
    ok: true,
    epoch: nextEpoch,
    owner,
    leaseUntil: leaseUntilDate,
  };
}

/**
 * Validação de Fencing atômica: confirma que o worker atual ainda é o titular legítimo
 * do lease e que o tempo de vigência não expirou.
 * Deve ser chamado antes de iniciar qualquer mutação externa ou interna.
 */
export async function verifyCoordinatorLease(params: {
  db: D1Database;
  integrationId: string;
  owner: string;
  epoch: number;
  now?: string;
}): Promise<boolean> {
  const { db, integrationId, owner, epoch, now = new Date().toISOString() } = params;

  const row = await db
    .prepare(
      `SELECT lease_owner, lease_epoch, lease_until
       FROM sync_coordinator_leases
       WHERE integration_id = ?
         AND lease_owner = ?
         AND lease_epoch = ?
         AND datetime(lease_until) >= datetime(?)`,
    )
    .bind(integrationId, owner, epoch, now)
    .first<{ lease_owner: string; lease_epoch: number; lease_until: string }>();

  return Boolean(row);
}

/**
 * Libera o lease coordenador no D1 ao término de um ciclo.
 * Marca o lease como expirado para preservar o lease_epoch histórico.
 */
export async function releaseCoordinatorLease(params: {
  db: D1Database;
  integrationId: string;
  owner: string;
  epoch: number;
}): Promise<void> {
  const { db, integrationId, owner, epoch } = params;
  await db
    .prepare(
      `UPDATE sync_coordinator_leases
       SET lease_until = '1970-01-01 00:00:00',
           updated_at = CURRENT_TIMESTAMP
       WHERE integration_id = ?
         AND lease_owner = ?
         AND lease_epoch = ?`,
    )
    .bind(integrationId, owner, epoch)
    .run();
}

// ----------------------------------------------------------------------------
// 3. EXECUÇÃO COORDENADA DO CICLO DE SINCRONIZAÇÃO (SCHEDULER / WORKER)
// ----------------------------------------------------------------------------

export interface IntegrationExecutionReport {
  integrationId: string;
  periodoId: number;
  mode: IntegrationMode;
  status:
    | "SUCCESS"
    | "SKIPPED_NOT_ELIGIBLE"
    | "SKIPPED_LOCKED"
    | "FENCING_LOST"
    | "ERROR";
  motivo?: string;
  inboundReport?: InboundSyncReport;
  outboundReport?: SyncBatchResult;
  duracaoMs: number;
}

export interface ScheduledSyncReport {
  sucesso: boolean;
  timestamp: string;
  autoEnabled: boolean;
  totalIntegracoesEncontradas: number;
  integracoesExecutadas: number;
  integracoesIgnoradas: number;
  relatorios: IntegrationExecutionReport[];
  erroGeral?: string;
}

export interface SchedulerOptions {
  db: D1Database;
  env: {
    SYNC_V2_ENABLED?: string;
    SYNC_V2_AUTO_ENABLED?: string;
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
    SYNC_V2_BATCH_SIZE?: string;
    SYNC_V2_DISPATCH_TIMEOUT_MS?: string;
    SYNC_V2_LEASE_DURATION_MS?: string;
    ENVIRONMENT?: string;
  };
  workerId?: string;
  customAdapter?: ISyncSpreadsheetAdapter;
  customTabNameResolver?: TabNameResolver;
  targetPeriodoId?: number;
  targetIntegrationId?: string;
  registrarAuditoria?: (periodoId: number, evento: { acao: string; entidade: string; descricao: string }) => Promise<void>;
}

/**
 * Executa um ciclo completo de sincronização bidirecional coordenado para
 * uma integração elegível, garantindo a ordem:
 * 1. Aquisição de Lease com Fencing no D1
 * 2. Fase Inbound (Captura do Sheets para o D1, com detecção de conflitos F3)
 * 3. Revalidação de Fencing
 * 4. Fase Outbound (Despacho D1 para o Sheets com CAS)
 * 5. Liberação do Lease
 */
export async function executeIntegrationSyncCycle(params: {
  db: D1Database;
  integration: {
    integration_id: string;
    periodo_id: number;
    spreadsheet_id: string;
    mode: IntegrationMode;
    epoch: number;
  };
  adapter: ISyncSpreadsheetAdapter;
  tabNameResolver: TabNameResolver;
  workerId: string;
  batchSize?: number;
  dispatchTimeoutMs?: number;
  registrarAuditoria?: (periodoId: number, evento: { acao: string; entidade: string; descricao: string }) => Promise<void>;
}): Promise<IntegrationExecutionReport> {
  const inicio = Date.now();
  const {
    db,
    integration,
    adapter,
    tabNameResolver,
    workerId,
    batchSize = 20,
    dispatchTimeoutMs = 25000,
    registrarAuditoria,
  } = params;

  const mode = integration.mode;
  const permissions = INTEGRATION_MODE_RULES[mode] || INTEGRATION_MODE_RULES.LEGACY;

  // 1. Verificação de elegibilidade do modo
  if (!permissions.eligible) {
    return {
      integrationId: integration.integration_id,
      periodoId: integration.periodo_id,
      mode,
      status: "SKIPPED_NOT_ELIGIBLE",
      motivo: `Modo '${mode}' não é elegível para execução automática pelo scheduler.`,
      duracaoMs: Date.now() - inicio,
    };
  }

  // 2. Aquisição de lease persistente no D1 (Coordenação anti-split-brain)
  const leaseAcq = await acquireCoordinatorLease({
    db,
    integrationId: integration.integration_id,
    owner: workerId,
    leaseType: "FULL_CYCLE",
    durationSeconds: 45,
  });

  if (!leaseAcq.ok) {
    return {
      integrationId: integration.integration_id,
      periodoId: integration.periodo_id,
      mode,
      status: "SKIPPED_LOCKED",
      motivo: leaseAcq.error || "Integração retida por outro worker.",
      duracaoMs: Date.now() - inicio,
    };
  }

  let inboundReport: InboundSyncReport | undefined;
  let outboundReport: SyncBatchResult | undefined;

  try {
    // 3. FASE 1: INBOUND (Sheets -> D1)
    if (permissions.canRunInbound) {
      // Revalida fencing antes de ler a planilha
      const fenceInboundOk = await verifyCoordinatorLease({
        db,
        integrationId: integration.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      });

      if (!fenceInboundOk) {
        return {
          integrationId: integration.integration_id,
          periodoId: integration.periodo_id,
          mode,
          status: "FENCING_LOST",
          motivo: "Fencing revogado antes da fase Inbound.",
          duracaoMs: Date.now() - inicio,
        };
      }

      inboundReport = await reconcileInboundFromSpreadsheet({
        periodoId: integration.periodo_id,
        integrationId: integration.integration_id,
        actorId: `scheduler:${workerId}`,
        adapter,
        db,
        dryRun: permissions.inboundDryRun,
        tabNameResolver,
      });
    }

    // 4. FASE 2: OUTBOUND (D1 -> Sheets)
    if (permissions.canRunOutbound) {
      // Revalida fencing antes de despachar lote de outbox
      const fenceOutboundOk = await verifyCoordinatorLease({
        db,
        integrationId: integration.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      });

      if (!fenceOutboundOk) {
        return {
          integrationId: integration.integration_id,
          periodoId: integration.periodo_id,
          mode,
          status: "FENCING_LOST",
          motivo: "Fencing revogado durante o processamento Inbound. Outbound abortado preventivamente.",
          inboundReport,
          duracaoMs: Date.now() - inicio,
        };
      }

      const orchestrator = new SyncV2Orchestrator({
        db,
        adapter,
        workerId: `sched-${workerId}`,
        integrationId: integration.integration_id,
        batchSize,
        tabNameResolver,
        leaseDurationSeconds: Math.round(dispatchTimeoutMs / 1000),
        dryRun: permissions.outboundDryRun,
      });

      outboundReport = await orchestrator.executeBatch({
        batchSize,
        dryRun: permissions.outboundDryRun,
      });
    }

    // Auditoria sem dados pessoais ou credenciais
    if (registrarAuditoria) {
      await registrarAuditoria(integration.periodo_id, {
        acao: "SYNC_V2_SCHEDULED_CYCLE",
        entidade: "SYNC_COORDINATOR",
        descricao: `Ciclo V2 modo ${mode} concluído pelo worker ${workerId}: inbound=[atualizados=${inboundReport?.camposAtualizadosNoD1 ?? 0}, conflitos=${inboundReport?.conflitosDetectados ?? 0}], outbound=[processadas=${outboundReport?.processedCount ?? 0}, confirmadas=${outboundReport?.observedCount ?? 0}, conflitos=${outboundReport?.conflictCount ?? 0}].`,
      });
    }

    return {
      integrationId: integration.integration_id,
      periodoId: integration.periodo_id,
      mode,
      status: "SUCCESS",
      inboundReport,
      outboundReport,
      duracaoMs: Date.now() - inicio,
    };
  } finally {
    // 5. Liberação do lease persistente garantida
    await releaseCoordinatorLease({
      db,
      integrationId: integration.integration_id,
      owner: workerId,
      epoch: leaseAcq.epoch,
    }).catch(() => {});
  }
}

/**
 * Ponto de entrada coordenado do Scheduler V2 (chamado pelo handler scheduled do Worker)
 */
export async function runScheduledSyncV2(
  options: SchedulerOptions,
): Promise<ScheduledSyncReport> {
  const { db, env, workerId = `sched-${crypto.randomUUID().slice(0, 8)}`, targetPeriodoId, targetIntegrationId } = options;

  // 1. Verificação de Flag Mestre e Flag de Agendamento Automático
  const enabled = env.SYNC_V2_ENABLED === "true";
  const autoEnabled = env.SYNC_V2_AUTO_ENABLED === "true";

  if (!enabled || !autoEnabled) {
    return {
      sucesso: false,
      timestamp: new Date().toISOString(),
      autoEnabled,
      totalIntegracoesEncontradas: 0,
      integracoesExecutadas: 0,
      integracoesIgnoradas: 0,
      relatorios: [],
      erroGeral: !enabled
        ? "SYNC_V2_DISABLED: Sincronização V2 está desativada por configuração (SYNC_V2_ENABLED !== 'true')."
        : "SYNC_V2_AUTO_DISABLED: Scheduler automático está desativado por padrão (SYNC_V2_AUTO_ENABLED !== 'true').",
    };
  }

  // 2. Monta Adaptador e Resolução de Abas
  let adapter: ISyncSpreadsheetAdapter;
  if (options.customAdapter) {
    adapter = options.customAdapter;
  } else {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return {
        sucesso: false,
        timestamp: new Date().toISOString(),
        autoEnabled,
        totalIntegracoesEncontradas: 0,
        integracoesExecutadas: 0,
        integracoesIgnoradas: 0,
        relatorios: [],
        erroGeral: "CREDENCIAIS_AUSENTES: GOOGLE_SERVICE_ACCOUNT_JSON não configurado para o scheduler.",
      };
    }
    adapter = new GoogleSheetsRealAdapter({
      serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    });
  }

  // 3. Busca de integrações cadastradas
  let query = `SELECT integration_id, periodo_id, spreadsheet_id, mode, epoch FROM sync_integrations WHERE 1=1`;
  const binds: any[] = [];
  if (targetPeriodoId) {
    query += ` AND periodo_id = ?`;
    binds.push(targetPeriodoId);
  }
  if (targetIntegrationId) {
    query += ` AND integration_id = ?`;
    binds.push(targetIntegrationId);
  }

  const integracoes = await db
    .prepare(query)
    .bind(...binds)
    .all<{
      integration_id: string;
      periodo_id: number;
      spreadsheet_id: string;
      mode: IntegrationMode;
      epoch: number;
    }>();

  const relatorios: IntegrationExecutionReport[] = [];
  let executadas = 0;
  let ignoradas = 0;

  for (const integracao of integracoes.results || []) {
    // Configura resolução de abas
    let tabNameResolver = options.customTabNameResolver;
    if (!tabNameResolver) {
      const sheetsConfig = await db
        .prepare(
          `SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead
           FROM google_sheets_periodos
           WHERE periodo_id = ?`,
        )
        .bind(integracao.periodo_id)
        .first<{
          aba_docs_face_fea?: string;
          aba_docs_fch_ead?: string;
          aba_base_face_fea?: string;
          aba_base_fch_ead?: string;
        }>();

      tabNameResolver = createTabNameResolver({ sheetsConfig });
    }

    try {
      const rep = await executeIntegrationSyncCycle({
        db,
        integration: integracao,
        adapter,
        tabNameResolver,
        workerId,
        batchSize: Number(env.SYNC_V2_BATCH_SIZE || 20),
        dispatchTimeoutMs: Number(env.SYNC_V2_DISPATCH_TIMEOUT_MS || 25000),
        registrarAuditoria: options.registrarAuditoria,
      });

      relatorios.push(rep);
      if (rep.status === "SUCCESS") {
        executadas++;
      } else {
        ignoradas++;
      }
    } catch (err: any) {
      ignoradas++;
      relatorios.push({
        integrationId: integracao.integration_id,
        periodoId: integracao.periodo_id,
        mode: integracao.mode,
        status: "ERROR",
        motivo: err?.message || String(err),
        duracaoMs: 0,
      });
    }
  }

  return {
    sucesso: true,
    timestamp: new Date().toISOString(),
    autoEnabled,
    totalIntegracoesEncontradas: (integracoes.results || []).length,
    integracoesExecutadas: executadas,
    integracoesIgnoradas: ignoradas,
    relatorios,
  };
}
