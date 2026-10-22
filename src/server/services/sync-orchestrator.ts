/**
 * ============================================================================
 * F4-B — Orquestrador da Sincronização V2 (SyncV2Orchestrator)
 * ============================================================================
 * Conecta o núcleo transacional D1 (F1-A, F1-B), os contratos e adaptadores
 * de planilha (F2, F4-A) e o motor de reconciliação e resolução de conflitos (F3).
 *
 * Garantias do Ciclo de Vida:
 *  - O1: Injeção de dependências desacoplada (ISyncSpreadsheetAdapter).
 *  - O2: Manutenção e recuperação contínua de leases expirados (Fencing G2, G4).
 *  - O3: Claim atômico e exclusivo de operações elegíveis (G1).
 *  - O4: Despacho versionado com histórico append-only em sync_attempts (G7).
 *  - O5: Read-Before-Write com verificação prévia e detecção de conflitos (CAS C4).
 *  - O6: Encaminhamento estrito de conflitos à reconciliação F3 (sem sobrescrita cega).
 *  - O7: Tratamento de incerteza de rede com verificação prévia antes de qualquer retry (C3).
 *  - O8: Isolamento absoluto de período, grupo, epoch e RA.
 *  - O9: Preservação estrita das fórmulas J/K e limites de colunas.
 *  - O10: Sistema V1 legado 100% desativado dentro do ciclo V2.
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import {
  type OperationTargetKey,
  type RecoveryResult,
  claimOperation,
  dispatchOperation,
  observeOperation,
  markUncertainOperation,
  verifyOperation,
  markRetryWaitOperation,
  recoverExpiredLeases,
  toSqliteDatetime,
} from './sync-d1-operations';
import {
  type ISyncSpreadsheetAdapter,
  type WritePreconditions,
  type WriteResult,
  type ExternalEffectCheckResult,
} from './sync-sheet-contracts';
import { type ReconciliationDecision } from './sync-reconciliation-contracts';
import { recordTargetConflict } from './sync-reconciliation';

export interface TabNameResolver {
  getControlTabName(groupKey: GroupKey, periodoCodigo?: string): string;
  getGeneralTabName(groupKey: GroupKey, periodoCodigo?: string): string;
}

export const defaultTabNameResolver: TabNameResolver = {
  getControlTabName(groupKey: GroupKey): string {
    return groupKey === 'FACE_FEA'
      ? 'CONTROLE DE DOCUMENTOS FACE FEA'
      : 'CONTROLE DE DOCUMENTOS FCH EAD';
  },
  getGeneralTabName(groupKey: GroupKey): string {
    return groupKey === 'FACE_FEA'
      ? 'FACE - FEA 2026 - 2'
      : 'FCH - EAD 2026 - 2';
  },
};

/**
 * Constrói um TabNameResolver dinâmico respeitando as abas configuradas do período
 * (da tabela google_sheets_periodos) e derivando do código do período (ex: '2027-1' -> '2027 - 1')
 * quando não houver sobreposição explícita na configuração.
 */
export function createTabNameResolver(options?: {
  sheetsConfig?: {
    aba_docs_face_fea?: string | null;
    aba_docs_fch_ead?: string | null;
    aba_base_face_fea?: string | null;
    aba_base_fch_ead?: string | null;
  } | null;
  periodoCodigo?: string | null;
}): TabNameResolver {
  const cfg = options?.sheetsConfig;
  const pCode = (options?.periodoCodigo || '').trim();

  let formattedPeriodSuffix = '2026 - 2';
  if (pCode) {
    const match = pCode.match(/^(\d{4})[./\-_ ]*([12])$/);
    if (match) {
      formattedPeriodSuffix = `${match[1]} - ${match[2]}`;
    } else {
      formattedPeriodSuffix = pCode;
    }
  }

  return {
    getControlTabName(groupKey: GroupKey): string {
      if (groupKey === 'FACE_FEA') {
        return (cfg?.aba_docs_face_fea || '').trim() || 'CONTROLE DE DOCUMENTOS FACE FEA';
      }
      return (cfg?.aba_docs_fch_ead || '').trim() || 'CONTROLE DE DOCUMENTOS FCH EAD';
    },
    getGeneralTabName(groupKey: GroupKey): string {
      if (groupKey === 'FACE_FEA') {
        return (cfg?.aba_base_face_fea || '').trim() || `FACE - FEA ${formattedPeriodSuffix}`;
      }
      return (cfg?.aba_base_fch_ead || '').trim() || `FCH - EAD ${formattedPeriodSuffix}`;
    },
  };
}

export interface SyncOrchestratorOptions {
  db: D1Database;
  adapter: ISyncSpreadsheetAdapter;
  workerId: string;
  leaseDurationSeconds?: number;
  batchSize?: number;
  tabNameResolver?: TabNameResolver;
  now?: string | Date;
  baseBackoffSeconds?: number;
  logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void;
  beforeWriteHook?: (operationId: string) => Promise<void>;
  integrationId?: string;
  shouldAbort?: () => Promise<boolean> | boolean;
  dryRun?: boolean;
}

export type SyncOperationStatus =
  | 'OBSERVED'
  | 'OBSERVED_VIA_VERIFY'
  | 'SIMULATED_SHADOW'
  | 'CONFLICT_RECORDED'
  | 'BLOCKED_BY_OPEN_CONFLICT'
  | 'STRUCTURAL_ERROR'
  | 'UNCERTAIN_PRESERVED'
  | 'RETRY_SCHEDULED'
  | 'FENCING_REJECTED'
  | 'SKIPPED_NOT_ELIGIBLE';

export interface SyncOperationResult {
  operationId: string;
  recordId: string;
  raText: string;
  groupKey: GroupKey;
  fieldKey: FieldKey;
  targetKey: OperationTargetKey;
  targetRevision: number;
  status: SyncOperationStatus;
  error?: string;
  attemptId?: string;
  receiptId?: string;
  conflictId?: string;
}

export interface SyncBatchResult {
  workerId: string;
  recoveredLeases: RecoveryResult;
  processedCount: number;
  observedCount: number;
  conflictCount: number;
  blockedByConflictCount: number;
  uncertainCount: number;
  retryScheduledCount: number;
  structuralErrorCount: number;
  fencingRejectedCount: number;
  skippedCount: number;
  dryRun?: boolean;
  simulatedCount?: number;
  operations: SyncOperationResult[];
}

export class SyncV2Orchestrator {
  readonly db: D1Database;
  readonly adapter: ISyncSpreadsheetAdapter;
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
  readonly batchSize: number;
  readonly tabNameResolver: TabNameResolver;
  readonly baseBackoffSeconds: number;
  readonly integrationId?: string;
  readonly dryRun: boolean;
  private readonly logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void;
  private readonly beforeWriteHook?: (operationId: string) => Promise<void>;
  private readonly shouldAbort?: () => Promise<boolean> | boolean;

  constructor(options: SyncOrchestratorOptions) {
    this.db = options.db;
    this.adapter = options.adapter;
    this.workerId = options.workerId;
    this.leaseDurationSeconds = options.leaseDurationSeconds ?? 30;
    this.batchSize = options.batchSize ?? 20;
    this.tabNameResolver = options.tabNameResolver ?? defaultTabNameResolver;
    this.baseBackoffSeconds = options.baseBackoffSeconds ?? 10;
    this.integrationId = options.integrationId;
    this.dryRun = options.dryRun ?? false;
    this.logger = options.logger;
    this.beforeWriteHook = options.beforeWriteHook;
    this.shouldAbort = options.shouldAbort;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, meta?: any) {
    if (this.logger) {
      this.logger(level, `[SyncV2Orchestrator:${this.workerId}] ${message}`, meta);
    }
  }

  /**
   * Executa uma rodada em lote do orquestrador V2:
   * 1. Recupera leases expirados de workers anteriores (G2, G4).
   * 2. Busca e reivindica operações elegíveis (G1).
   * 3. Executa despacho, gravação com CAS e resolução de incertezas/conflitos.
   */
  async executeBatch(overrideOptions?: {
    batchSize?: number;
    now?: string | Date;
    dryRun?: boolean;
  }): Promise<SyncBatchResult> {
    const isDryRun = overrideOptions?.dryRun ?? this.dryRun ?? false;
    const now = toSqliteDatetime(overrideOptions?.now);
    const limit = overrideOptions?.batchSize ?? this.batchSize;

    // 1. Manutenção contínua de leases expirados (G2, G4, G7) — apenas em modo real
    const recoveredLeases = isDryRun
      ? { recoveredClaimed: 0, recoveredDispatchedToUncertain: 0, recoveredVerifyingToUncertain: 0, totalRecovered: 0 }
      : await recoverExpiredLeases(this.db, now);
    if (
      recoveredLeases.recoveredClaimed > 0 ||
      recoveredLeases.recoveredDispatchedToUncertain > 0 ||
      recoveredLeases.recoveredVerifyingToUncertain > 0
    ) {
      this.log('info', 'Leases expirados recuperados pelo orquestrador', recoveredLeases);
    }

    // 2. Busca de operações elegíveis para processamento (com isolamento por integração e bloqueio de PAUSED/CAPTURE em escrita real)
    const eligibleOps = this.integrationId
      ? await this.db
          .prepare(
            `SELECT
               o.operation_id,
               o.state,
               o.next_attempt_at,
               o.lease_until
             FROM sync_operations o
             JOIN sync_records r ON r.record_id = o.record_id
             JOIN sync_integrations i ON i.integration_id = r.integration_id
             WHERE r.integration_id = ?
               AND (? = 1 OR i.mode NOT IN ('PAUSED', 'CAPTURE', 'QUARANTINED', 'LEGACY'))
               AND (
                 (o.state IN ('PENDING', 'RETRY_WAIT') AND datetime(?) >= datetime(o.next_attempt_at))
                 OR (o.state = 'CLAIMED' AND datetime(?) > datetime(o.lease_until))
                 OR (o.state = 'UNCERTAIN' AND datetime(?) >= datetime(o.next_attempt_at))
               )
             ORDER BY o.next_attempt_at ASC, o.target_revision ASC
             LIMIT ?`
          )
          .bind(this.integrationId, isDryRun ? 1 : 0, now, now, now, limit)
          .all<{
            operation_id: string;
            state: string;
            next_attempt_at: string;
            lease_until: string | null;
          }>()
      : await this.db
          .prepare(
            `SELECT
               o.operation_id,
               o.state,
               o.next_attempt_at,
               o.lease_until
             FROM sync_operations o
             JOIN sync_records r ON r.record_id = o.record_id
             JOIN sync_integrations i ON i.integration_id = r.integration_id
             WHERE (? = 1 OR i.mode NOT IN ('PAUSED', 'CAPTURE', 'QUARANTINED', 'LEGACY'))
               AND (
                 (o.state IN ('PENDING', 'RETRY_WAIT') AND datetime(?) >= datetime(o.next_attempt_at))
                 OR (o.state = 'CLAIMED' AND datetime(?) > datetime(o.lease_until))
                 OR (o.state = 'UNCERTAIN' AND datetime(?) >= datetime(next_attempt_at))
               )
             ORDER BY o.next_attempt_at ASC, o.target_revision ASC
             LIMIT ?`
          )
          .bind(isDryRun ? 1 : 0, now, now, now, limit)
          .all<{
            operation_id: string;
            state: string;
            next_attempt_at: string;
            lease_until: string | null;
          }>();
    const operationsToProcess = eligibleOps.results || [];
    const operationResults: SyncOperationResult[] = [];

    // Se estiver em modo dryRun (SHADOW / simulação segura), observa sem mutação externa
    if (isDryRun) {
      for (const rawOp of operationsToProcess) {
        const opDetails = await this.db
          .prepare(
            `SELECT o.operation_id, o.record_id, o.target_key, o.target_revision, o.field_key,
                    r.ra_text, r.group_key
             FROM sync_operations o
             JOIN sync_records r ON r.record_id = o.record_id
             WHERE o.operation_id = ?`
          )
          .bind(rawOp.operation_id)
          .first<{
            operation_id: string;
            record_id: string;
            target_key: OperationTargetKey;
            target_revision: number;
            field_key: FieldKey;
            ra_text: string;
            group_key: GroupKey;
          }>();

        if (!opDetails) continue;

        const openConflict = await this.db
          .prepare(
            `SELECT conflict_id
             FROM sync_conflicts
             WHERE record_id = ? AND field_key = ? AND target_key = ? AND resolved = 0`
          )
          .bind(opDetails.record_id, opDetails.field_key, opDetails.target_key)
          .first<{ conflict_id: string }>();

        if (openConflict) {
          operationResults.push({
            operationId: rawOp.operation_id,
            recordId: opDetails.record_id,
            raText: opDetails.ra_text,
            groupKey: opDetails.group_key,
            fieldKey: opDetails.field_key,
            targetKey: opDetails.target_key,
            targetRevision: opDetails.target_revision,
            status: 'BLOCKED_BY_OPEN_CONFLICT',
            conflictId: openConflict.conflict_id,
          });
        } else {
          operationResults.push({
            operationId: rawOp.operation_id,
            recordId: opDetails.record_id,
            raText: opDetails.ra_text,
            groupKey: opDetails.group_key,
            fieldKey: opDetails.field_key,
            targetKey: opDetails.target_key,
            targetRevision: opDetails.target_revision,
            status: 'SIMULATED_SHADOW',
          });
        }
      }

      return {
        workerId: this.workerId,
        recoveredLeases,
        processedCount: operationResults.length,
        observedCount: 0,
        simulatedCount: operationResults.filter(r => r.status === 'SIMULATED_SHADOW').length,
        conflictCount: 0,
        blockedByConflictCount: operationResults.filter(r => r.status === 'BLOCKED_BY_OPEN_CONFLICT').length,
        uncertainCount: 0,
        retryScheduledCount: 0,
        structuralErrorCount: 0,
        fencingRejectedCount: 0,
        skippedCount: 0,
        dryRun: true,
        operations: operationResults,
      };
    }

    for (const rawOp of operationsToProcess) {
      if (this.shouldAbort && (await this.shouldAbort())) {
        this.log('warn', 'Parada operacional acionada durante lote. Interrompendo processamento.');
        break;
      }
      let opRes: SyncOperationResult;

      if (rawOp.state === 'UNCERTAIN') {
        opRes = await this.processUncertainOperation(rawOp.operation_id, now);
      } else {
        opRes = await this.processPendingOperation(rawOp.operation_id, now);
      }

      operationResults.push(opRes);
    }

    const batchSummary: SyncBatchResult = {
      workerId: this.workerId,
      recoveredLeases,
      processedCount: operationResults.length,
      observedCount: operationResults.filter(r => r.status === 'OBSERVED' || r.status === 'OBSERVED_VIA_VERIFY').length,
      conflictCount: operationResults.filter(r => r.status === 'CONFLICT_RECORDED').length,
      blockedByConflictCount: operationResults.filter(r => r.status === 'BLOCKED_BY_OPEN_CONFLICT').length,
      uncertainCount: operationResults.filter(r => r.status === 'UNCERTAIN_PRESERVED').length,
      retryScheduledCount: operationResults.filter(r => r.status === 'RETRY_SCHEDULED').length,
      structuralErrorCount: operationResults.filter(r => r.status === 'STRUCTURAL_ERROR').length,
      fencingRejectedCount: operationResults.filter(r => r.status === 'FENCING_REJECTED').length,
      skippedCount: operationResults.filter(r => r.status === 'SKIPPED_NOT_ELIGIBLE').length,
      dryRun: false,
      operations: operationResults,
    };

    return batchSummary;
  }

  /**
   * Processa uma operação em estado elegível (PENDING, RETRY_WAIT ou CLAIMED expirada).
   */
  async processPendingOperation(
    operationId: string,
    now: string
  ): Promise<SyncOperationResult> {
    // 0. Bloqueio de defesa em profundidade para períodos em PAUSED / CAPTURE / QUARANTINED / LEGACY
    const modeGuard = await this.db
      .prepare(
        `SELECT i.mode, o.record_id, o.field_key, o.target_key, o.target_revision, r.ra_text, r.group_key
         FROM sync_operations o
         JOIN sync_records r ON r.record_id = o.record_id
         JOIN sync_integrations i ON i.integration_id = r.integration_id
         WHERE o.operation_id = ?`
      )
      .bind(operationId)
      .first<{
        mode: string;
        record_id: string;
        field_key: FieldKey;
        target_key: OperationTargetKey;
        target_revision: number;
        ra_text: string;
        group_key: GroupKey;
      }>();

    if (
      modeGuard &&
      ['PAUSED', 'CAPTURE', 'QUARANTINED', 'LEGACY'].includes(modeGuard.mode)
    ) {
      return {
        operationId,
        recordId: modeGuard.record_id,
        raText: modeGuard.ra_text,
        groupKey: modeGuard.group_key,
        fieldKey: modeGuard.field_key,
        targetKey: modeGuard.target_key,
        targetRevision: modeGuard.target_revision,
        status: 'SKIPPED_NOT_ELIGIBLE',
        error: `Bloqueio de escrita externa: integração em modo '${modeGuard.mode}' não permite despacho Outbound.`,
      };
    }

    // 1. Reivindicação atômica e exclusiva (G1, G2)
    const claimRes = await claimOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseDurationSeconds: this.leaseDurationSeconds,
      now,
    });

    if (!claimRes.ok) {
      return {
        operationId,
        recordId: '',
        raText: '',
        groupKey: 'FACE_FEA',
        fieldKey: 'identidade',
        targetKey: 'CONTROLE',
        targetRevision: 0,
        status: 'SKIPPED_NOT_ELIGIBLE',
        error: claimRes.error,
      };
    }

    const { payload, leaseEpoch } = claimRes;

    // 2. Verificação de Conflitos F3 Abertos:
    // Uma operação NUNCA pode executar escrita externa se houver um conflito F3 aberto para este registro/campo/alvo!
    // Exige resolução administrativa explícita (applyAdminConflictResolution) antes de qualquer nova tentativa.
    const openConflict = await this.db
      .prepare(
        `SELECT conflict_id, local_revision, reason
         FROM sync_conflicts
         WHERE record_id = ? AND field_key = ? AND target_key = ? AND resolved = 0`
      )
      .bind(payload.recordId, payload.fieldKey, payload.targetKey)
      .first<{ conflict_id: string; local_revision: number; reason: string }>();

    if (openConflict) {
      const blockMsg = `Conflito F3 aberto (${openConflict.conflict_id}): aguardando resolução administrativa explícita antes de qualquer escrita.`;
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        backoffSeconds: this.baseBackoffSeconds * 12,
        confirmEffectAbsent: true,
        errorMessage: blockMsg,
        now,
      });

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'BLOCKED_BY_OPEN_CONFLICT',
        conflictId: openConflict.conflict_id,
        error: blockMsg,
      };
    }

    // 3. Despacho e registro de tentativa imutável append-only (G7)
    const dispatchRes = await dispatchOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      payloadText: JSON.stringify(payload),
      now,
    });

    if (!dispatchRes.ok) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'FENCING_REJECTED',
        error: dispatchRes.error,
      };
    }

    const attemptId = dispatchRes.attemptId;

    // 4. Consulta de integração e metadados de planilha
    const integration = await this.db
      .prepare(
        `SELECT spreadsheet_id, mode
         FROM sync_integrations
         WHERE integration_id = ?`
      )
      .bind(payload.integrationId)
      .first<{ spreadsheet_id: string; mode: string }>();

    if (!integration) {
      const errorMsg = `Integração '${payload.integrationId}' não encontrada para operação ${operationId}`;
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        backoffSeconds: this.baseBackoffSeconds * 2,
        confirmEffectAbsent: true,
        errorMessage: errorMsg,
        attemptId,
        now,
      });

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'STRUCTURAL_ERROR',
        error: errorMsg,
        attemptId,
      };
    }

    // 5. Resolução da aba de destino
    const tabName =
      payload.targetKey === 'CONTROLE'
        ? this.tabNameResolver.getControlTabName(payload.groupKey)
        : this.tabNameResolver.getGeneralTabName(payload.groupKey);

    // 6. Consulta do valor anterior esperado para precondição de CAS (C4)
    const eventRow = await this.db
      .prepare(`SELECT value_old FROM sync_events WHERE event_id = ?`)
      .bind(payload.eventId)
      .first<{ value_old: number | null }>();

    // Se houve conflito F3 nesta revisão resolvido explicitamente como KEEP_LOCAL,
    // o valor observado na planilha no momento do conflito passa a ser a precondição autorizada pelo administrador.
    const keepLocalConflict = await this.db
      .prepare(
        `SELECT external_value
         FROM sync_conflicts
         WHERE record_id = ? AND field_key = ? AND target_key = ? AND local_revision = ?
           AND resolved = 1 AND resolution_action = 'KEEP_LOCAL'
         ORDER BY resolved_at DESC
         LIMIT 1`
      )
      .bind(payload.recordId, payload.fieldKey, payload.targetKey, payload.targetRevision)
      .first<{ external_value: number | null }>();

    const expectedCurrentValue: 0 | 1 | null =
      keepLocalConflict &&
      (keepLocalConflict.external_value === 0 || keepLocalConflict.external_value === 1)
        ? (keepLocalConflict.external_value as 0 | 1)
        : eventRow
          ? (eventRow.value_old as 0 | 1 | null)
          : null;

    const preconditions: WritePreconditions = {
      targetKey: payload.targetKey,
      expectedCurrentValue,
      targetValue: payload.proposedValue as 0 | 1,
      targetRevision: payload.targetRevision,
      operationId: payload.operationId,
    };

    // 7. Revalidação atômica de titularidade de fencing imediatamente antes da chamada HTTP externa.
    // Garante que respostas tardias de workers com lease expirado ou revogado durante o preparo
    // não cheguem a disparar requisições HTTP na planilha.
    if (this.beforeWriteHook) {
      await this.beforeWriteHook(operationId);
    }

    const leaseCheck = await this.db
      .prepare(
        `SELECT lease_owner, lease_epoch, lease_until
         FROM sync_operations
         WHERE operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND datetime(lease_until) >= datetime(?)`
      )
      .bind(operationId, this.workerId, leaseEpoch, now)
      .first<{ lease_owner: string; lease_epoch: number; lease_until: string }>();

    if (!leaseCheck) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'FENCING_REJECTED',
        error: `Fencing lease expirado ou revogado na janela pré-HTTP (worker ${this.workerId}, epoch ${leaseEpoch}). Chamada externa abortada preventivamente.`,
        attemptId,
      };
    }

    // 8. Chamada cirúrgica de célula única no adaptador
    let writeRes: WriteResult;
    try {
      writeRes = await this.adapter.writeDocumentField({
        spreadsheetId: integration.spreadsheet_id,
        tabName,
        groupKey: payload.groupKey,
        raText: payload.raText,
        fieldKey: payload.fieldKey,
        preconditions,
      });
    } catch (netErr: any) {
      // Incerteza de rede: trata imediatamente com verificação pós-falha (G4, C3)
      return this.handleNetworkFailureDuringWrite({
        operationId,
        payload,
        leaseEpoch,
        attemptId,
        spreadsheetId: integration.spreadsheet_id,
        tabName,
        netErrorMessage: String(netErr?.message || netErr),
        now,
      });
    }

    // 7. Avaliação e persistência do resultado do adaptador
    if (writeRes.success && writeRes.status === 'COMMITTED') {
      const obsRes = await observeOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        targetRevision: payload.targetRevision,
        attemptId,
        responsePayload: JSON.stringify(writeRes),
        now,
      });

      if (!obsRes.ok) {
        return {
          operationId,
          recordId: payload.recordId,
          raText: payload.raText,
          groupKey: payload.groupKey,
          fieldKey: payload.fieldKey,
          targetKey: payload.targetKey,
          targetRevision: payload.targetRevision,
          status: 'FENCING_REJECTED',
          error: obsRes.error,
          attemptId,
        };
      }

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'OBSERVED',
        attemptId,
        receiptId: obsRes.receiptId,
      };
    }

    if (writeRes.status === 'CONFLICT_DETECTED') {
      // Conflito com edição humana detectado na planilha (C4, F3)
      // NUNCA sobrescreve cegamente! Registra formalmente na reconciliação F3
      const decision: ReconciliationDecision = {
        classification: 'CONFLICT',
        targetKey: payload.targetKey,
        fieldKey: payload.fieldKey,
        recordId: payload.recordId,
        reason:
          writeRes.error ||
          `Divergência remota pré-escrita: valor observado '${writeRes.observedValue}' diverge do esperado (${expectedCurrentValue})`,
        causalityProven: false,
        actionRequired: 'RECORD_CONFLICT',
      };

      const conflictRes = await recordTargetConflict(this.db, decision, {
        localRevision: payload.targetRevision,
        localValue: payload.proposedValue,
        externalValue: writeRes.observedValue !== undefined ? (Number(writeRes.observedValue) === 1 ? 1 : 0) : null,
        evidencePayload: JSON.stringify(writeRes),
      });

      // Operação está em DISPATCHED. Para transicionar para RETRY_WAIT com segurança,
      // passa por VERIFYING com confirmação de que o efeito externo NÃO ocorreu.
      const verifyAttemptId = crypto.randomUUID();
      const verifyRes = await verifyOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        attemptId: verifyAttemptId,
        now,
      });

      const effectiveEpoch = verifyRes.ok ? verifyRes.operation.lease_epoch : leaseEpoch;
      const effectiveAttempt = verifyRes.ok ? verifyAttemptId : attemptId;

      // Agenda retry com backoff longo para dar tempo à resolução administrativa
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: effectiveEpoch,
        backoffSeconds: this.baseBackoffSeconds * 6,
        confirmEffectAbsent: true,
        errorMessage: `Conflito registrado (${conflictRes.conflictId}): ${decision.reason}`,
        attemptId: effectiveAttempt,
        now,
      });

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'CONFLICT_RECORDED',
        error: writeRes.error,
        attemptId: effectiveAttempt,
        conflictId: conflictRes.conflictId,
      };
    }

    // Caso de erro estrutural (OUT_OF_BOUNDS, LAYOUT_MUTATED, STUDENT_NOT_FOUND)
    // Aluno ausente, duplicado ou layout adulterado NÃO comprova conclusivamente ausência de efeito na planilha.
    // A operação é encaminhada com segurança para UNCERTAIN (quarentena sem retry cego e sem falso atestado de ausência).
    const structErrorMsg = writeRes.error || `Erro estrutural no adaptador: ${writeRes.status}`;
    await markUncertainOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      errorMessage: structErrorMsg,
      attemptId,
      now,
    });

    return {
      operationId,
      recordId: payload.recordId,
      raText: payload.raText,
      groupKey: payload.groupKey,
      fieldKey: payload.fieldKey,
      targetKey: payload.targetKey,
      targetRevision: payload.targetRevision,
      status: 'STRUCTURAL_ERROR',
      error: structErrorMsg,
      attemptId,
    };
  }

  /**
   * Trata uma quebra de conexão ou timeout durante a mutação HTTP:
   * 1. Registra estado UNCERTAIN no D1 (G4).
   * 2. Promove para VERIFYING.
   * 3. Executa verifyExternalEffect para apurar se a mutação chegou a ser gravada.
   * 4. Se observada -> OBSERVED. Se comprovadamente ausente -> RETRY_WAIT seguro.
   */
  private async handleNetworkFailureDuringWrite(params: {
    operationId: string;
    payload: any;
    leaseEpoch: number;
    attemptId: string;
    spreadsheetId: string;
    tabName: string;
    netErrorMessage: string;
    now: string;
  }): Promise<SyncOperationResult> {
    const { operationId, payload, leaseEpoch, attemptId, spreadsheetId, tabName, netErrorMessage, now } = params;

    // 1. Marca como UNCERTAIN no D1 (G4: Timeout Incerto)
    await markUncertainOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      errorMessage: netErrorMessage,
      attemptId,
      now,
    });

    // 2. Promove imediatamente para VERIFYING com um novo attemptId dedicado à verificação
    const verifyAttemptId = crypto.randomUUID();
    const verifyPrep = await verifyOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      attemptId: verifyAttemptId,
      now,
    });

    if (!verifyPrep.ok) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'UNCERTAIN_PRESERVED',
        error: `Falha ao transicionar para verificação: ${verifyPrep.error}`,
        attemptId,
      };
    }

    const currentEpoch = verifyPrep.operation.lease_epoch;

    // 3. Releitura de conferência no adaptador externo (C3)
    let checkRes: ExternalEffectCheckResult;
    try {
      checkRes = await this.adapter.verifyExternalEffect({
        spreadsheetId,
        tabName,
        groupKey: payload.groupKey,
        raText: payload.raText,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        expectedTargetValue: payload.proposedValue as 0 | 1,
      });
    } catch (checkErr: any) {
      // Se a própria verificação falhar (ex: planilha inacessível), reverte para UNCERTAIN
      await markUncertainOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        errorMessage: `Releitura pós-falha falhou: ${checkErr?.message || checkErr}`,
        attemptId: verifyAttemptId,
        now,
      });

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'UNCERTAIN_PRESERVED',
        error: `Releitura pós-falha falhou: ${checkErr?.message || checkErr}. Estado preservado como UNCERTAIN.`,
        attemptId: verifyAttemptId,
      };
    }

    // 4. Se o efeito foi observado na planilha -> Conclui com sucesso seguro!
    if (checkRes.effectObserved) {
      const obsRes = await observeOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        targetRevision: payload.targetRevision,
        attemptId: verifyAttemptId,
        responsePayload: JSON.stringify(checkRes),
        now,
      });

      if (obsRes.ok) {
        return {
          operationId,
          recordId: payload.recordId,
          raText: payload.raText,
          groupKey: payload.groupKey,
          fieldKey: payload.fieldKey,
          targetKey: payload.targetKey,
          targetRevision: payload.targetRevision,
          status: 'OBSERVED_VIA_VERIFY',
          attemptId: verifyAttemptId,
          receiptId: obsRes.receiptId,
        };
      }
    }

    // 5. Se foi conclusivamente comprovado que a mutação NÃO ocorreu -> Agenda retry seguro
    if (checkRes.isAbsentConfirmed) {
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        backoffSeconds: this.baseBackoffSeconds,
        confirmEffectAbsent: true,
        errorMessage: `Mutação não aplicada no destino externo antes da queda de conexão: ${netErrorMessage}`,
        attemptId: verifyAttemptId,
        now,
      });

      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'RETRY_SCHEDULED',
        attemptId: verifyAttemptId,
      };
    }

    // 6. Efeito continua estritamente indeterminado -> Reverte para UNCERTAIN sem retry cego!
    await markUncertainOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch: currentEpoch,
      errorMessage: `Efeito externo indeterminado após verificação: ${JSON.stringify(checkRes)}`,
      attemptId: verifyAttemptId,
      now,
    });

    return {
      operationId,
      recordId: payload.recordId,
      raText: payload.raText,
      groupKey: payload.groupKey,
      fieldKey: payload.fieldKey,
      targetKey: payload.targetKey,
      targetRevision: payload.targetRevision,
      status: 'UNCERTAIN_PRESERVED',
      error: 'Efeito externo continua indeterminado após verificação. Operação em quarentena segura.',
      attemptId: verifyAttemptId,
    };
  }

  /**
   * Processa uma operação encontrada diretamente em estado UNCERTAIN (G4, C3).
   */
  async processUncertainOperation(
    operationId: string,
    now: string
  ): Promise<SyncOperationResult> {
    // 1. Consulta contexto completo da operação incerta e verifica modo da integração
    const opContext = await this.db
      .prepare(
        `SELECT o.operation_id, o.event_id, o.record_id, o.field_key, o.target_key,
                o.target_revision, o.state, o.lease_epoch,
                r.integration_id, r.ra_text, r.group_key,
                e.value_new,
                i.spreadsheet_id, i.mode
         FROM sync_operations o
         JOIN sync_records r ON r.record_id = o.record_id
         JOIN sync_events e ON e.event_id = o.event_id
         JOIN sync_integrations i ON i.integration_id = r.integration_id
         WHERE o.operation_id = ?`
      )
      .bind(operationId)
      .first<{
        operation_id: string;
        event_id: string;
        record_id: string;
        field_key: FieldKey;
        target_key: OperationTargetKey;
        target_revision: number;
        state: string;
        lease_epoch: number;
        integration_id: string;
        ra_text: string;
        group_key: GroupKey;
        value_new: number;
        spreadsheet_id: string;
        mode: string;
      }>();

    if (!opContext) {
      return {
        operationId,
        recordId: '',
        raText: '',
        groupKey: 'FACE_FEA',
        fieldKey: 'identidade',
        targetKey: 'CONTROLE',
        targetRevision: 0,
        status: 'SKIPPED_NOT_ELIGIBLE',
        error: `Operação '${operationId}' não encontrada para resolução de incerteza.`,
      };
    }

    if (['PAUSED', 'CAPTURE', 'QUARANTINED', 'LEGACY'].includes(opContext.mode)) {
      return {
        operationId,
        recordId: opContext.record_id,
        raText: opContext.ra_text,
        groupKey: opContext.group_key,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        targetRevision: opContext.target_revision,
        status: 'SKIPPED_NOT_ELIGIBLE',
        error: `Bloqueio operacional: integração em modo '${opContext.mode}' não permite verificação/despacho Outbound.`,
      };
    }

    // 2. Transiciona atomicamente de UNCERTAIN para VERIFYING com novo attemptId dedicado (G4, C3)
    const verifyAttemptId = `att_verify_${crypto.randomUUID()}`;
    const verifyRes = await verifyOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch: opContext.lease_epoch,
      leaseExtensionSeconds: this.leaseDurationSeconds,
      attemptId: verifyAttemptId,
      now,
    });

    if (!verifyRes.ok) {
      return {
        operationId,
        recordId: opContext.record_id,
        raText: opContext.ra_text,
        groupKey: opContext.group_key,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        targetRevision: opContext.target_revision,
        status: verifyRes.code === 'FENCING_CONFLICT' ? 'FENCING_REJECTED' : 'SKIPPED_NOT_ELIGIBLE',
        error: verifyRes.error,
        attemptId: verifyAttemptId,
      };
    }

    const currentEpoch = verifyRes.operation.lease_epoch;
    const effectiveAttemptId = verifyRes.attemptId;

    const tabName =
      opContext.target_key === 'CONTROLE'
        ? this.tabNameResolver.getControlTabName(opContext.group_key)
        : this.tabNameResolver.getGeneralTabName(opContext.group_key);

    // 3. Executa verifyExternalEffect (C3) — NUNCA repete escrita antes de conferir se o efeito ocorreu
    let check: ExternalEffectCheckResult;
    try {
      check = await this.adapter.verifyExternalEffect({
        spreadsheetId: opContext.spreadsheet_id,
        tabName,
        groupKey: opContext.group_key,
        raText: opContext.ra_text,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        expectedTargetValue: opContext.value_new as 0 | 1,
      });
    } catch (err: any) {
      await markUncertainOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        errorMessage: `Falha na releitura externa de operação UNCERTAIN: ${err?.message || err}`,
        attemptId: effectiveAttemptId,
        now,
      });

      return {
        operationId,
        recordId: opContext.record_id,
        raText: opContext.ra_text,
        groupKey: opContext.group_key,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        targetRevision: opContext.target_revision,
        status: 'UNCERTAIN_PRESERVED',
        error: `Falha na releitura externa: ${err?.message || err}`,
        attemptId: effectiveAttemptId,
      };
    }

    // 4. Se o efeito foi observado na planilha -> Conclui como OBSERVED_VIA_VERIFY sem repetir escrita!
    if (check.effectObserved) {
      const obsRes = await observeOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        targetRevision: opContext.target_revision,
        attemptId: effectiveAttemptId,
        responsePayload: JSON.stringify(check),
        now,
      });

      return {
        operationId,
        recordId: opContext.record_id,
        raText: opContext.ra_text,
        groupKey: opContext.group_key,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        targetRevision: opContext.target_revision,
        status: 'OBSERVED_VIA_VERIFY',
        attemptId: effectiveAttemptId,
        receiptId: obsRes.ok ? obsRes.receiptId : undefined,
      };
    }

    // 5. Se foi conclusivamente comprovado que o efeito externo está ausente -> Agenda RETRY_WAIT seguro
    if (check.isAbsentConfirmed) {
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch: currentEpoch,
        backoffSeconds: this.baseBackoffSeconds,
        confirmEffectAbsent: true,
        errorMessage: 'Efeito comprovadamente ausente na verificação incerta',
        attemptId: effectiveAttemptId,
        now,
      });

      return {
        operationId,
        recordId: opContext.record_id,
        raText: opContext.ra_text,
        groupKey: opContext.group_key,
        fieldKey: opContext.field_key,
        targetKey: opContext.target_key,
        targetRevision: opContext.target_revision,
        status: 'RETRY_SCHEDULED',
        attemptId: effectiveAttemptId,
      };
    }

    // 6. Efeito continua indeterminado -> Reverte de VERIFYING para UNCERTAIN sem retry cego
    await markUncertainOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch: currentEpoch,
      errorMessage: `Efeito continua indeterminado na verificação incerta: ${JSON.stringify(check)}`,
      attemptId: effectiveAttemptId,
      now,
    });

    return {
      operationId,
      recordId: opContext.record_id,
      raText: opContext.ra_text,
      groupKey: opContext.group_key,
      fieldKey: opContext.field_key,
      targetKey: opContext.target_key,
      targetRevision: opContext.target_revision,
      status: 'UNCERTAIN_PRESERVED',
      error: 'Efeito continua indeterminado',
      attemptId: effectiveAttemptId,
    };
  }
}
