/**
 * ============================================================================
 * F3 — Contratos de Reconciliação, Detecção de Conflitos e Recuperação (F3.1, F3.2)
 * ============================================================================
 * Define interfaces, estados de decisão determinística e estruturas de conflito
 * isoladas por alvo e campo (A1, A2, A3, A4).
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import type { OperationTargetKey, OperationRecord } from './sync-d1-operations';
import type { ProvenanceEvidence } from './sync-sheet-contracts';
export type { ProvenanceEvidence };

/**
 * Classificação Determinística da Reconciliação (F3.2, A1, A2, A3).
 * - IN_SYNC: Comprovadamente sincronizados via âncora causal/recibo.
 * - LOCAL_AHEAD: Mudança local D1 confirmada, elegível para propagação ao alvo externo.
 * - EXTERNAL_AHEAD: Mudança externa comprovada, elegível para CAS no D1.
 * - CONFLICT: Ambos os lados sofreram alterações incompatíveis; suspende sem sobrescrita.
 * - UNKNOWN: Ausência de evidência conclusiva, layout corrompido ou causalidade desconhecida.
 * - STALE_OPERATION: Operação atrasada que não deve sobrescrever estado posterior.
 * - NEEDS_VERIFICATION: Operação externa incerta exigindo verificação antes de qualquer decisão.
 */
export type ReconciliationClassification =
  | 'IN_SYNC'
  | 'LOCAL_AHEAD'
  | 'EXTERNAL_AHEAD'
  | 'CONFLICT'
  | 'UNKNOWN'
  | 'STALE_OPERATION'
  | 'NEEDS_VERIFICATION';

/**
 * Estado Local do D1 para um campo documental.
 */
export interface LocalFieldSnapshot {
  recordId: string;
  fieldKey: FieldKey;
  revision: number;
  value: 0 | 1 | null;
  status: 'CONFIRMED' | 'PENDING' | 'CONFLICT' | 'UNBASELINED';
  headCommandId: string | null;
  baselineCommandId: string | null;
  updatedAt: string;
}

/**
 * Âncora Histórica do Último Recibo Externo Confirmado (A3).
 */
export interface ConfirmedReceiptAnchor {
  receiptId: string;
  operationId: string;
  targetKey: OperationTargetKey;
  revision: number;
  confirmedValue: 0 | 1;
  observedAt: string;
}

/**
 * Observação Externa Atual da Planilha.
 */
export interface ObservedExternalSnapshot {
  targetKey: OperationTargetKey;
  rawValue: string;
  normalizedValue: 0 | 1 | null;
  cellCoordinate: string;
  headerFingerprint: string;
  observedAt: string;
  evidence?: ProvenanceEvidence;
}

/**
 * Contexto Completo de Entrada para Reconciliação de um Alvo.
 */
export interface ReconciliationTargetContext {
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  raText: string;
  generation: number;
  expectedEpoch: number;
  recordId: string;
  fieldKey: FieldKey;
  targetKey: OperationTargetKey;
  localState: LocalFieldSnapshot;
  receiptAnchor: ConfirmedReceiptAnchor | null;
  currentExternal: ObservedExternalSnapshot | null;
  activeOperation: OperationRecord | null;
  unverifiedReceipt?: { receiptId: string; revision: number; reason: string } | null;
}

/**
 * Decisão Resultante da Reconciliação.
 */
export interface ReconciliationDecision {
  classification: ReconciliationClassification;
  targetKey: OperationTargetKey;
  fieldKey: FieldKey;
  recordId: string;
  reason: string;
  causalityProven: boolean;
  actionRequired:
    | 'NONE'
    | 'DISPATCH_LOCAL_OPERATION'
    | 'APPLY_EXTERNAL_MUTATION'
    | 'RECORD_CONFLICT'
    | 'VERIFY_EXTERNAL_EFFECT'
    | 'ABORT_QUARANTINE';
  details?: Record<string, unknown>;
}

/**
 * Registro de Conflito Isolado por Alvo (A4).
 */
export interface SyncConflictRecord {
  conflictId: string;
  recordId: string;
  fieldKey: FieldKey;
  targetKey: OperationTargetKey;
  localRevision: number;
  localValue: number | null;
  externalValue: number | null;
  reason: string;
  evidencePayload?: string;
  resolved: boolean;
  resolutionAction?: 'KEEP_LOCAL' | 'ACCEPT_EXTERNAL';
  resolutionActorId?: string;
  resolvedAt?: string;
  createdAt: string;
}

import type { AuthIdentity, AdminAuthCredential } from './sync-d1-auth';
export type { AdminAuthCredential };

export interface AdminConflictResolutionInput {
  conflictId: string;
  /**
   * Credencial de autenticação criptográfica real do administrador (P1).
   * Verificada na fronteira do servidor contra o registro confiável.
   */
  authCredential?: AdminAuthCredential;
  authorizedActorId?: string;
  adminActorId?: string;
  chosenResolution: 'KEEP_LOCAL' | 'ACCEPT_EXTERNAL';
  justification: string;
  expectedLocalRevision: number;
  /**
   * @deprecated R1/P1: Não aceito como prova suficiente de autorização pelo servidor.
   */
  identityLookup?: (senderId: string) => Promise<AuthIdentity | null> | AuthIdentity | null;
  /**
   * @deprecated R1/P1: Não aceito como prova suficiente de autorização pelo servidor.
   */
  authenticatedIdentity?: AuthIdentity;
}

export interface AdminConflictResolutionResult {
  success: boolean;
  error?: string;
  commandId?: string;
  eventId?: string;
  outboxOperationIds?: string[];
  authenticatedActorId?: string;
}

