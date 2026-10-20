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
}

export type SyncOperationStatus =
  | 'OBSERVED'
  | 'OBSERVED_VIA_VERIFY'
  | 'CONFLICT_RECORDED'
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
  uncertainCount: number;
  retryScheduledCount: number;
  structuralErrorCount: number;
  fencingRejectedCount: number;
  skippedCount: number;
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
  private readonly logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void;

  constructor(options: SyncOrchestratorOptions) {
    this.db = options.db;
    this.adapter = options.adapter;
    this.workerId = options.workerId;
    this.leaseDurationSeconds = options.leaseDurationSeconds ?? 30;
    this.batchSize = options.batchSize ?? 20;
    this.tabNameResolver = options.tabNameResolver ?? defaultTabNameResolver;
    this.baseBackoffSeconds = options.baseBackoffSeconds ?? 10;
    this.logger = options.logger;
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
  }): Promise<SyncBatchResult> {
    const now = toSqliteDatetime(overrideOptions?.now);
    const limit = overrideOptions?.batchSize ?? this.batchSize;

    // 1. Manutenção contínua de leases expirados (G2, G4, G7)
    const recoveredLeases = await recoverExpiredLeases(this.db, now);
    if (
      recoveredLeases.recoveredClaimed > 0 ||
      recoveredLeases.recoveredDispatchedToUncertain > 0 ||
      recoveredLeases.recoveredVerifyingToUncertain > 0
    ) {
      this.log('info', 'Leases expirados recuperados pelo orquestrador', recoveredLeases);
    }

    // 2. Busca de operações elegíveis para processamento
    const eligibleOps = await this.db
      .prepare(
        `SELECT
           operation_id,
           state,
           next_attempt_at,
           lease_until
         FROM sync_operations
         WHERE (
           -- Operações novas ou aguardando retry que atingiram seu momento
           (state IN ('PENDING', 'RETRY_WAIT') AND datetime(?) >= datetime(next_attempt_at))
           -- Operações com lease expirado em CLAIMED
           OR (state = 'CLAIMED' AND datetime(?) > datetime(lease_until))
           -- Operações incertas que atingiram o momento de nova conferência
           OR (state = 'UNCERTAIN' AND datetime(?) >= datetime(next_attempt_at))
         )
         ORDER BY next_attempt_at ASC, target_revision ASC
         LIMIT ?`
      )
      .bind(now, now, now, limit)
      .all<{
        operation_id: string;
        state: string;
        next_attempt_at: string;
        lease_until: string | null;
      }>();

    const operationsToProcess = eligibleOps.results || [];
    const operationResults: SyncOperationResult[] = [];

    for (const rawOp of operationsToProcess) {
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
      uncertainCount: operationResults.filter(r => r.status === 'UNCERTAIN_PRESERVED').length,
      retryScheduledCount: operationResults.filter(r => r.status === 'RETRY_SCHEDULED').length,
      structuralErrorCount: operationResults.filter(r => r.status === 'STRUCTURAL_ERROR').length,
      fencingRejectedCount: operationResults.filter(r => r.status === 'FENCING_REJECTED').length,
      skippedCount: operationResults.filter(r => r.status === 'SKIPPED_NOT_ELIGIBLE').length,
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

    // 2. Despacho e registro de tentativa imutável append-only (G7)
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

    // 3. Consulta de integração e metadados de planilha
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

    // 4. Resolução da aba de destino
    const tabName =
      payload.targetKey === 'CONTROLE'
        ? this.tabNameResolver.getControlTabName(payload.groupKey)
        : this.tabNameResolver.getGeneralTabName(payload.groupKey);

    // 5. Consulta do valor anterior esperado para precondição de CAS (C4)
    const eventRow = await this.db
      .prepare(`SELECT value_old FROM sync_events WHERE event_id = ?`)
      .bind(payload.eventId)
      .first<{ value_old: number | null }>();

    const expectedCurrentValue = eventRow ? (eventRow.value_old as 0 | 1 | null) : null;

    const preconditions: WritePreconditions = {
      targetKey: payload.targetKey,
      expectedCurrentValue,
      targetValue: payload.proposedValue as 0 | 1,
      targetRevision: payload.targetRevision,
      operationId: payload.operationId,
    };

    // 6. Chamada cirúrgica de célula única no adaptador
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
    const structErrorMsg = writeRes.error || `Erro estrutural no adaptador: ${writeRes.status}`;
    const structVerifyAttemptId = crypto.randomUUID();
    const structVerifyRes = await verifyOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      attemptId: structVerifyAttemptId,
      now,
    });

    const effectiveStructEpoch = structVerifyRes.ok ? structVerifyRes.operation.lease_epoch : leaseEpoch;
    const effectiveStructAttempt = structVerifyRes.ok ? structVerifyAttemptId : attemptId;

    await markRetryWaitOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch: effectiveStructEpoch,
      backoffSeconds: this.baseBackoffSeconds * 4,
      confirmEffectAbsent: true,
      errorMessage: structErrorMsg,
      attemptId: effectiveStructAttempt,
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
      attemptId: effectiveStructAttempt,
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
    // 1. Claim exclusivo da operação incerta
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

    // Busca a última tentativa associada
    const lastAttempt = await this.db
      .prepare(
        `SELECT attempt_id
         FROM sync_attempts
         WHERE operation_id = ?
         ORDER BY attempt_number DESC
         LIMIT 1`
      )
      .bind(operationId)
      .first<{ attempt_id: string }>();

    const attemptId = lastAttempt?.attempt_id || `att_recovered_${crypto.randomUUID()}`;

    // 2. Transiciona para VERIFYING
    const verifyRes = await verifyOperation(this.db, {
      operationId,
      workerId: this.workerId,
      leaseEpoch,
      attemptId,
      now,
    });

    if (!verifyRes.ok) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'FENCING_REJECTED',
        error: verifyRes.error,
        attemptId,
      };
    }

    // 3. Consulta integração e planilha
    const integration = await this.db
      .prepare(`SELECT spreadsheet_id FROM sync_integrations WHERE integration_id = ?`)
      .bind(payload.integrationId)
      .first<{ spreadsheet_id: string }>();

    if (!integration) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'STRUCTURAL_ERROR',
        error: 'Integração não encontrada durante verificação incerta',
        attemptId,
      };
    }

    const tabName =
      payload.targetKey === 'CONTROLE'
        ? this.tabNameResolver.getControlTabName(payload.groupKey)
        : this.tabNameResolver.getGeneralTabName(payload.groupKey);

    // 4. Executa verifyExternalEffect (C3)
    let check: ExternalEffectCheckResult;
    try {
      check = await this.adapter.verifyExternalEffect({
        spreadsheetId: integration.spreadsheet_id,
        tabName,
        groupKey: payload.groupKey,
        raText: payload.raText,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        expectedTargetValue: payload.proposedValue as 0 | 1,
      });
    } catch (err: any) {
      return {
        operationId,
        recordId: payload.recordId,
        raText: payload.raText,
        groupKey: payload.groupKey,
        fieldKey: payload.fieldKey,
        targetKey: payload.targetKey,
        targetRevision: payload.targetRevision,
        status: 'UNCERTAIN_PRESERVED',
        error: `Falha na releitura externa: ${err?.message || err}`,
        attemptId,
      };
    }

    if (check.effectObserved) {
      const obsRes = await observeOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        targetRevision: payload.targetRevision,
        attemptId,
        responsePayload: JSON.stringify(check),
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
        status: 'OBSERVED_VIA_VERIFY',
        attemptId,
        receiptId: obsRes.ok ? obsRes.receiptId : undefined,
      };
    }

    if (check.isAbsentConfirmed) {
      await markRetryWaitOperation(this.db, {
        operationId,
        workerId: this.workerId,
        leaseEpoch,
        backoffSeconds: this.baseBackoffSeconds,
        confirmEffectAbsent: true,
        errorMessage: 'Efeito comprovadamente ausente na verificação incerta',
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
        status: 'RETRY_SCHEDULED',
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
      status: 'UNCERTAIN_PRESERVED',
      error: 'Efeito continua indeterminado',
      attemptId,
    };
  }
}
