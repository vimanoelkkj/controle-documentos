import type { UsuarioSessao } from "./auth";
import {
  SyncV2Orchestrator,
  type SyncBatchResult,
  type TabNameResolver,
  defaultTabNameResolver,
} from "../services/sync-orchestrator";
import {
  GoogleSheetsRealAdapter,
} from "../services/sync-sheet-real-adapter";
import type { ISyncSpreadsheetAdapter } from "../services/sync-sheet-contracts";
import type { GroupKey } from "../services/sync-d1-core";
import { reconcileInboundFromSpreadsheet } from "../services/sync-inbound-reconciler";
import {
  acquireCoordinatorLease,
  releaseCoordinatorLease,
  runScheduledSyncV2,
} from "../services/sync-coordinator";

export interface SyncV2AdminDependencies {
  request: Request;
  url: URL;
  db: D1Database;
  env: {
    SYNC_V2_ENABLED?: string;
    SYNC_V2_AUTO_ENABLED?: string;
    SYNC_V2_ADMIN_SECRET?: string;
    SYNC_ADMIN_SECRET?: string;
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
    ENVIRONMENT?: string;
  };
  usuarioAtual: UsuarioSessao | null;
  podeEditar: boolean;
  registrarAuditoria: (
    periodoId: number,
    evento: {
      acao: string;
      entidade: string;
      descricao: string;
    },
  ) => Promise<void>;
  customAdapter?: ISyncSpreadsheetAdapter;
}

// Conjunto em memória para exclusão mútua de despachos simultâneos no mesmo worker isolate
const activeDispatches = new Set<string>();

/**
 * Verifica de forma segura se uma tabela existe no D1 sem lançar exceção não tratada.
 */
async function verificarTabelasV2Existem(db: D1Database): Promise<boolean> {
  try {
    const res = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sync_integrations', 'sync_operations')`,
      )
      .all<{ name: string }>();
    return (res.results || []).length === 2;
  } catch {
    return false;
  }
}

/**
 * Valida autorização da requisição administrativa:
 * Exige usuário com privilégio de escrita OU secret administrativo no header.
 */
function estaAutorizadoComoAdmin(
  request: Request,
  usuarioAtual: UsuarioSessao | null,
  adminSecretConfigurado?: string,
): boolean {
  if (
    usuarioAtual &&
    (usuarioAtual.perfil === "ADMIN" ||
      (usuarioAtual as unknown as { role?: string }).role === "ADMIN")
  ) {
    return true;
  }
  const secretHeader = request.headers.get("X-Sync-Admin-Secret");
  if (
    adminSecretConfigurado &&
    secretHeader &&
    secretHeader === adminSecretConfigurado
  ) {
    return true;
  }
  return false;
}

export async function handleSyncV2AdminRoute(
  deps: SyncV2AdminDependencies,
): Promise<Response | null> {
  const {
    request,
    url,
    db,
    env,
    usuarioAtual,
    podeEditar: _podeEditar,
    registrarAuditoria,
    customAdapter,
  } = deps;

  const matchPeriodo = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/sync-v2\/(status|dispatch|pause|resume|inbound|schedule-run)$/,
  );

  let periodoId: number | null = null;
  let action: string | null = null;

  if (matchPeriodo) {
    periodoId = Number(matchPeriodo[1]);
    action = matchPeriodo[2];
  } else {
    const matchDirect = url.pathname.match(
      /^\/api\/sync-v2\/(status|dispatch|pause|resume|inbound|schedule-run)$/,
    );
    if (matchDirect) {
      action = matchDirect[1];
      const q = url.searchParams.get("periodoId");
      if (q) {
        periodoId = Number(q);
      }
    }
  }

  if (!action) return null;

  if (periodoId === null && (request.method === "POST" || request.method === "PATCH")) {
    try {
      const cloned = (await request.clone().json()) as Record<string, unknown> | null;
      if (cloned && typeof cloned.periodoId === "number") {
        periodoId = cloned.periodoId;
      }
    } catch {
      // ignore
    }
  }

  if (periodoId === null) {
    const integracaoDefault = await db
      .prepare(`SELECT periodo_id FROM sync_integrations ORDER BY updated_at DESC LIMIT 1`)
      .first<{ periodo_id: number }>();
    if (integracaoDefault?.periodo_id) {
      periodoId = integracaoDefault.periodo_id;
    } else {
      return Response.json(
        {
          sucesso: false,
          erro: "PERIODO_ID_OBRIGATORIO",
          mensagem: "O parâmetro periodoId é obrigatório na URL (/api/periodos/:id/sync-v2/...) ou no corpo da requisição.",
        },
        { status: 400 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 1. GET /status — Consulta de Saúde e Prontidão
  // ---------------------------------------------------------------------------
  if (action === "status" && request.method === "GET") {
    if (!usuarioAtual) {
      return Response.json(
        { erro: "Não autenticado." },
        { status: 401 },
      );
    }

    const enabled = env.SYNC_V2_ENABLED === "true";
    const tablesExist = await verificarTabelasV2Existem(db);
    const motivosBloqueio: string[] = [];

    if (!enabled) {
      motivosBloqueio.push("Sincronização V2 desativada por configuração (SYNC_V2_ENABLED !== 'true').");
    }

    if (!tablesExist) {
      motivosBloqueio.push("Tabelas do núcleo V2 não existem no banco de dados.");
      return Response.json({
        sucesso: true,
        status: {
          enabled,
          environment: env.ENVIRONMENT || "production",
          tablesExist: false,
          credentialsConfigured: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
          integracao: null,
          metrics: null,
          readyForDispatch: false,
          motivosBloqueio,
        },
      });
    }

    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode, updated_at
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
        updated_at: string;
      }>();

    if (!integracao) {
      motivosBloqueio.push(`Nenhuma integração V2 vinculada ao período letivo ${periodoId}.`);
    } else if (["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao.mode)) {
      motivosBloqueio.push(`Integração está em modo '${integracao.mode}'.`);
    }

    let credentialsConfigured = Boolean(customAdapter);
    if (!credentialsConfigured && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        credentialsConfigured = Boolean(parsed.client_email && parsed.private_key);
      } catch {
        credentialsConfigured = false;
      }
    }

    if (!credentialsConfigured) {
      motivosBloqueio.push("Credenciais de conta de serviço Google Sheets ausentes ou inválidas.");
    }

    // Métricas operacionais do D1
    const operacoesPorEstado = await db
      .prepare(
        `SELECT state, count(*) as total
         FROM sync_operations
         GROUP BY state`,
      )
      .all<{ state: string; total: number }>();

    const operacoesMetrics: Record<string, number> = {};
    for (const r of operacoesPorEstado.results || []) {
      operacoesMetrics[r.state] = r.total;
    }

    const camposState = await db
      .prepare(
        `SELECT status, count(*) as total
         FROM sync_field_state
         GROUP BY status`,
      )
      .all<{ status: string; total: number }>();

    const camposMetrics: Record<string, number> = {};
    for (const r of camposState.results || []) {
      camposMetrics[r.status] = r.total;
    }

    const conflitosAbertos = await db
      .prepare(
        `SELECT count(*) as total FROM sync_conflicts WHERE resolved = 0`,
      )
      .first<{ total: number }>();

    const unbaselinedCount = camposMetrics["UNBASELINED"] ?? 0;
    if (unbaselinedCount > 0) {
      motivosBloqueio.push(`Existem ${unbaselinedCount} campos sem baseline estabelecida (UNBASELINED).`);
    }

    const readyForDispatch =
      enabled &&
      tablesExist &&
      Boolean(integracao) &&
      !["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao?.mode ?? "") &&
      credentialsConfigured;

    let activeLease: {
      lease_owner: string;
      lease_epoch: number;
      lease_type: string;
      lease_until: string;
    } | null = null;

    if (integracao) {
      try {
        const leaseRow = await db
          .prepare(
            `SELECT lease_owner, lease_epoch, lease_type, lease_until
             FROM sync_coordinator_leases
             WHERE integration_id = ? AND datetime(lease_until) >= datetime('now')`,
          )
          .bind(integracao.integration_id)
          .first<{
            lease_owner: string;
            lease_epoch: number;
            lease_type: string;
            lease_until: string;
          }>();
        activeLease = leaseRow || null;
      } catch {
        // Tabela de leases ainda não criada
      }
    }

    return Response.json({
      sucesso: true,
      status: {
        enabled,
        autoEnabled: env.SYNC_V2_AUTO_ENABLED === "true",
        environment: env.ENVIRONMENT || "production",
        tablesExist,
        credentialsConfigured,
        integracao,
        activeLease,
        metrics: {
          operations: operacoesMetrics,
          fieldStates: camposMetrics,
          openConflicts: conflitosAbertos?.total ?? 0,
        },
        readyForDispatch,
        motivosBloqueio,
      },
    });
  }

  // Para endpoints modificadores (dispatch, pause, resume), exige autorização de escrita
  const adminSecret = env.SYNC_V2_ADMIN_SECRET || env.SYNC_ADMIN_SECRET;
  if (!estaAutorizadoComoAdmin(request, usuarioAtual, adminSecret)) {
    return Response.json(
      { erro: "PRIVILEGIO_INSUFICIENTE", mensagem: "Esta operação requer privilégio de Administrador do sistema." },
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. POST /pause — Parada Operacional Imediata
  // ---------------------------------------------------------------------------
  if (action === "pause" && request.method === "POST") {
    const integracao = await db
      .prepare(`SELECT integration_id, mode FROM sync_integrations WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    if (!integracao) {
      return Response.json(
        { erro: "INTEGRACAO_NAO_ENCONTRADA", mensagem: "Integração V2 não encontrada." },
        { status: 404 },
      );
    }

    await db
      .prepare(
        `UPDATE sync_integrations SET mode = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .run();

    const modoAnterior = integracao.mode;
    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_PARADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: JSON.stringify({
        integration_id: integracao.integration_id,
        modo_anterior: modoAnterior,
        motivo: "Parada operacional acionada por administrador",
      }),
    });

    return Response.json({
      sucesso: true,
      modo: "PAUSED",
      mensagem: "Parada operacional ativada com sucesso. Novos despachos estão bloqueados.",
    });
  }

  // ---------------------------------------------------------------------------
  // 3. POST /resume — Retomada Operacional
  // ---------------------------------------------------------------------------
  if (action === "resume" && request.method === "POST") {
    const integracao = await db
      .prepare(`SELECT integration_id, mode FROM sync_integrations WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    if (!integracao) {
      return Response.json(
        { erro: "INTEGRACAO_NAO_ENCONTRADA", mensagem: "Integração V2 não encontrada." },
        { status: 404 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as any;
    let modoDestino = body?.modo;

    if (!modoDestino) {
      const ultimaParada = await db
        .prepare(
          `SELECT descricao FROM logs WHERE periodo_id = ? AND acao = 'SYNC_V2_PARADA_OPERACIONAL' ORDER BY id DESC LIMIT 1`,
        )
        .bind(periodoId)
        .first<{ descricao: string }>();

      if (ultimaParada?.descricao) {
        try {
          const parsed = JSON.parse(ultimaParada.descricao);
          if (["SHADOW", "CAPTURE", "BIDIRECTIONAL"].includes(parsed.modo_anterior)) {
            modoDestino = parsed.modo_anterior;
          }
        } catch {
          // parsing legado
        }
      }
    }

    if (!modoDestino || !["SHADOW", "CAPTURE", "BIDIRECTIONAL"].includes(modoDestino)) {
      return Response.json(
        {
          sucesso: false,
          erro: "MODO_EXPLICITO_OBRIGATORIO",
          mensagem:
            "O modo anterior não pôde ser determinado com segurança. É obrigatório informar explicitamente o modo autorizado no corpo da requisição (ex: { \"modo\": \"SHADOW\" | \"CAPTURE\" | \"BIDIRECTIONAL\" }).",
        },
        { status: 400 },
      );
    }

    await db
      .prepare(
        `UPDATE sync_integrations SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE periodo_id = ?`,
      )
      .bind(modoDestino, periodoId)
      .run();

    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_RETOMADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: `Integração '${integracao.integration_id}' retomada para modo ${modoDestino}.`,
    });

    return Response.json({
      sucesso: true,
      modo: modoDestino,
      mensagem: `Integração retomada para modo ${modoDestino} com sucesso.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. POST /dispatch — Despacho Controlado de Lote V2
  // ---------------------------------------------------------------------------
  if (action === "dispatch" && request.method === "POST") {
    // 1. Fail-closed: bloqueado por padrão se flag não estiver ativa
    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "SINCRONIZACAO_V2_DESATIVADA",
          mensagem:
            "O processamento V2 está desativado por padrão neste ambiente (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 403 },
      );
    }

    // 2. Existência de tabelas
    const tablesExist = await verificarTabelasV2Existem(db);
    if (!tablesExist) {
      return Response.json(
        {
          sucesso: false,
          erro: "TABELAS_V2_INEXISTENTES",
          mensagem: "Tabelas do núcleo Sync V2 não foram encontradas no banco D1.",
        },
        { status: 503 },
      );
    }

    // 3. Integração do período
    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
      }>();

    if (!integracao) {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_NAO_ENCONTRADA",
          mensagem: `Nenhuma integração V2 configurada para o período ${periodoId}.`,
        },
        { status: 404 },
      );
    }

    // 4. Bloqueio de integrações LEGACY, PAUSED ou QUARANTINED
    if (["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao.mode)) {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_BLOQUEADA",
          modo: integracao.mode,
          mensagem: `Integração está em modo '${integracao.mode}'. Despachos estão bloqueados.`,
        },
        { status: 409 },
      );
    }

    // 4.1 Bloqueio estrito de modo CAPTURE (fluxo outbound desativado)
    if (integracao.mode === "CAPTURE") {
      return Response.json(
        {
          sucesso: false,
          erro: "OUTBOUND_BLOQUEADO_EM_CAPTURE",
          modo: integracao.mode,
          mensagem: "Integração está em modo 'CAPTURE'. Despachos de saída para o Google Sheets estão estritamente bloqueados.",
        },
        { status: 409 },
      );
    }

    const isShadow = integracao.mode === "SHADOW";

    // 5. Verificação de credenciais
    let adapter = customAdapter;
    if (!adapter) {
      if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_AUSENTES",
            mensagem:
              "Credenciais de serviço do Google Sheets (GOOGLE_SERVICE_ACCOUNT_JSON) não configuradas no ambiente.",
          },
          { status: 503 },
        );
      }
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error("Campos client_email ou private_key ausentes.");
        }
      } catch (err: any) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_INVALIDAS",
            mensagem: `Formato de credenciais inválido: ${err?.message ?? err}`,
          },
          { status: 503 },
        );
      }
      adapter = new GoogleSheetsRealAdapter({
        serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
        readOnly: isShadow,
      });
    }

    // 6. Prevenção de simultaneidade persistente com lease D1 (multi-instância)
    const dispatchKey = `${integracao.integration_id}:${periodoId}`;
    if (activeDispatches.has(dispatchKey)) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um lote de sincronização em execução ativa para esta integração.",
        },
        { status: 429 },
      );
    }

    const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
    const leaseAcq = await acquireCoordinatorLease({
      db,
      integrationId: integracao.integration_id,
      owner: workerId,
      leaseType: "OUTBOUND",
      durationSeconds: 30,
    });

    if (!leaseAcq.ok) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um processo de sincronização em execução ativa para esta integração.",
          bloqueadoPor: leaseAcq.currentOwner,
          expiraEm: leaseAcq.leaseUntil,
        },
        { status: 429 },
      );
    }

    // 7. Parse de opções da requisição
    let batchSize = 20;
    try {
      const body = (await request.json().catch(() => ({}))) as any;
      if (body && typeof body.batchSize === "number" && body.batchSize > 0) {
        batchSize = Math.min(body.batchSize, 50);
      }
    } catch {
      // Ignora erro de parse de body
    }

    activeDispatches.add(dispatchKey);

    // Monta resolver dinâmico de abas a partir de google_sheets_periodos (ou default)
    const sheetsConfig = await db
      .prepare(`SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead FROM google_sheets_periodos WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{
        aba_docs_face_fea?: string;
        aba_docs_fch_ead?: string;
        aba_base_face_fea?: string;
        aba_base_fch_ead?: string;
      }>();

    const tabNameResolver: TabNameResolver = {
      getControlTabName(groupKey: GroupKey): string {
        if (groupKey === "FACE_FEA") {
          return sheetsConfig?.aba_docs_face_fea || defaultTabNameResolver.getControlTabName(groupKey);
        }
        return sheetsConfig?.aba_docs_fch_ead || defaultTabNameResolver.getControlTabName(groupKey);
      },
      getGeneralTabName(groupKey: GroupKey): string {
        if (groupKey === "FACE_FEA") {
          return sheetsConfig?.aba_base_face_fea || defaultTabNameResolver.getGeneralTabName(groupKey);
        }
        return sheetsConfig?.aba_base_fch_ead || defaultTabNameResolver.getGeneralTabName(groupKey);
      },
    };

    try {
      // Cria instância do orquestrador com hook de parada operacional graciosa
      const orchestrator = new SyncV2Orchestrator({
        db,
        adapter,
        workerId,
        integrationId: integracao.integration_id,
        batchSize,
        tabNameResolver,
        dryRun: isShadow,
        shouldAbort: async () => {
          const row = await db
            .prepare(`SELECT mode FROM sync_integrations WHERE integration_id = ?`)
            .bind(integracao.integration_id)
            .first<{ mode: string }>();
          return row?.mode === "PAUSED" || row?.mode === "QUARANTINED";
        },
      });

      const batchResult: SyncBatchResult = await orchestrator.executeBatch({
        batchSize,
        dryRun: isShadow,
      });

      // 8. Registro de métricas e auditoria
      await registrarAuditoria(periodoId, {
        acao: "SYNC_V2_DISPATCH",
        entidade: "SYNC_ORCHESTRATOR",
        descricao: `Lote V2 executado pelo worker ${workerId}: ${batchResult.processedCount} processadas, ${batchResult.observedCount} confirmadas, ${batchResult.conflictCount} conflitos, ${batchResult.uncertainCount} incertas, ${batchResult.fencingRejectedCount} fencing rejeitadas, ${batchResult.recoveredLeases.recoveredClaimed} leases recuperadas.`,
      });

      return Response.json({
        sucesso: true,
        periodoId,
        integrationId: integracao.integration_id,
        batchResult,
      });
    } finally {
      activeDispatches.delete(dispatchKey);
      await releaseCoordinatorLease({
        db,
        integrationId: integracao.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 5. POST /inbound — Ingestão Inbound a partir do Google Sheets (Fluxo Inverso)
  // ---------------------------------------------------------------------------
  if (action === "inbound" && request.method === "POST") {
    // 1. Verificação de flag mestre
    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "FEATURE_DISABLED",
          mensagem:
            "Sincronização V2 está desativada por configuração (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 503 },
      );
    }

    // 2. Busca e validação da integração
    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
      }>();

    if (!integracao) {
      return Response.json(
        {
          erro: "INTEGRACAO_NAO_ENCONTRADA",
          mensagem: "Nenhuma integração V2 vinculada a este período.",
        },
        { status: 404 },
      );
    }

    if (integracao.mode === "PAUSED") {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRATION_PAUSED",
          mensagem: `A integração '${integracao.integration_id}' está em pausa operacional.`,
        },
        { status: 409 },
      );
    }

    if (integracao.mode === "QUARANTINED") {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRATION_QUARANTINED",
          mensagem: `A integração '${integracao.integration_id}' está em quarentena por inconsistência estrutural.`,
        },
        { status: 409 },
      );
    }

    // 3. Verificação de credenciais / adapter
    let adapter = customAdapter;
    if (!adapter) {
      if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_AUSENTES",
            mensagem:
              "Credenciais de serviço do Google Sheets (GOOGLE_SERVICE_ACCOUNT_JSON) não configuradas no ambiente.",
          },
          { status: 503 },
        );
      }
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error("Campos client_email ou private_key ausentes.");
        }
      } catch (err: any) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_INVALIDAS",
            mensagem: `Formato de credenciais inválido: ${err?.message ?? err}`,
          },
          { status: 503 },
        );
      }
      adapter = new GoogleSheetsRealAdapter({
        serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
      });
    }

    // 4. Parse de opções do body (dryRun, targetGroupKey)
    // Em modo SHADOW, dryRun é estritamente forçado como true para impedir mutações no D1
    let dryRun = integracao.mode === "SHADOW";
    let targetGroupKey: GroupKey | undefined;
    try {
      const body = (await request.json().catch(() => ({}))) as any;
      if (body) {
        if (body.dryRun === true) dryRun = true;
        if (body.groupKey === "FACE_FEA" || body.groupKey === "FCH_EAD") {
          targetGroupKey = body.groupKey;
        }
      }
    } catch {
      // ignore
    }

    // 5. Monta resolver dinâmico de abas
    const sheetsConfig = await db
      .prepare(
        `SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        aba_docs_face_fea?: string;
        aba_docs_fch_ead?: string;
        aba_base_face_fea?: string;
        aba_base_fch_ead?: string;
      }>();

    const tabNameResolver: TabNameResolver = {
      getControlTabName(groupKey: GroupKey): string {
        if (groupKey === "FACE_FEA") {
          return (
            sheetsConfig?.aba_docs_face_fea ||
            defaultTabNameResolver.getControlTabName(groupKey)
          );
        }
        return (
          sheetsConfig?.aba_docs_fch_ead ||
          defaultTabNameResolver.getControlTabName(groupKey)
        );
      },
      getGeneralTabName(groupKey: GroupKey): string {
        if (groupKey === "FACE_FEA") {
          return (
            sheetsConfig?.aba_base_face_fea ||
            defaultTabNameResolver.getGeneralTabName(groupKey)
          );
        }
        return (
          sheetsConfig?.aba_base_fch_ead ||
          defaultTabNameResolver.getGeneralTabName(groupKey)
        );
      },
    };

    const actorId = usuarioAtual?.email || `admin-secret:${periodoId}`;

    const workerId = `inbound-${crypto.randomUUID().slice(0, 8)}`;
    const leaseAcq = await acquireCoordinatorLease({
      db,
      integrationId: integracao.integration_id,
      owner: workerId,
      leaseType: "INBOUND",
      durationSeconds: 30,
    });

    if (!leaseAcq.ok) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um processo de sincronização em execução ativa para esta integração.",
          bloqueadoPor: leaseAcq.currentOwner,
          expiraEm: leaseAcq.leaseUntil,
        },
        { status: 429 },
      );
    }

    try {
      const report = await reconcileInboundFromSpreadsheet({
        periodoId,
        integrationId: integracao.integration_id,
        actorId,
        dryRun,
        adapter,
        tabNameResolver,
        db,
        targetGroupKey,
      });

      const persistidos = dryRun ? 0 : report.camposAtualizadosNoD1;
      const planejados = dryRun ? report.camposAtualizadosNoD1 : 0;
      const descMutacoes = dryRun
        ? `${planejados} mutações planejadas (0 persistidas)`
        : `${persistidos} campos persistidos no D1`;

      await registrarAuditoria(periodoId, {
        acao: "SYNC_V2_INBOUND_INGEST",
        entidade: "SYNC_INBOUND",
        descricao: `Ingestão Inbound V2 executada (${dryRun ? "DRY-RUN" : "REAL"}): ${descMutacoes}, ${report.camposEmSincronia} em sincronia, ${report.conflitosDetectados} conflitos detectados, ${report.totalAlunosLidosNaPlanilha} alunos processados na planilha.`,
      });

      return Response.json({
        sucesso: report.sucesso,
        report,
      });
    } finally {
      await releaseCoordinatorLease({
        db,
        integrationId: integracao.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 6. POST /schedule-run — Disparo Forçado do Ciclo Completo do Scheduler
  // ---------------------------------------------------------------------------
  if (action === "schedule-run" && request.method === "POST") {
    const report = await runScheduledSyncV2({
      db,
      env: {
        ...env,
        SYNC_V2_ENABLED: "true",
        SYNC_V2_AUTO_ENABLED: "true",
      },
      targetPeriodoId: periodoId,
      customAdapter,
      registrarAuditoria: async (pId, evento) => {
        await registrarAuditoria(pId, evento);
      },
    });

    return Response.json({
      sucesso: report.sucesso,
      report,
    });
  }

  return null;
}
