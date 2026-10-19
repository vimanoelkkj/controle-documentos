/**
 * ============================================================================
 * Protocolo de Operações, Claims Versionados, Leases e Recibos (F1-B)
 * ============================================================================
 * Coordenação segura das operações geradas pela F1-A (sync_operations),
 * garantindo:
 *  - G1: Claim exclusivo atômico
 *  - G2: Fencing estrito por lease_epoch
 *  - G3: Rejeição de respostas e callbacks tardios
 *  - G4: Timeout incerto (UNCERTAIN -> VERIFYING antes de RETRY_WAIT)
 *  - G5: Imutabilidade de payload e revisão do evento original
 *  - G6: Isolamento estrito entre FACE FEA e FCH EAD
 *  - G7: Recuperação resiliente sem perda de histórico (sync_attempts append-only)
 */

import type { FieldKey, GroupKey } from './sync-d1-core';

export type OperationState =
  | 'PENDING'
  | 'CLAIMED'
  | 'DISPATCHED'
  | 'VERIFYING'
  | 'OBSERVED'
  | 'UNCERTAIN'
  | 'RETRY_WAIT';

export type OperationTargetKey = 'CONTROLE' | 'GERAL_CONTRATO';

export interface OperationRecord {
  operation_id: string;
  event_id: string;
  record_id: string;
  field_key: FieldKey;
  target_key: OperationTargetKey;
  target_revision: number;
  state: OperationState;
  lease_owner: string | null;
  lease_epoch: number;
  lease_until: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
}

export interface OperationPayload {
  operationId: string;
  eventId: string;
  recordId: string;
  fieldKey: FieldKey;
  targetKey: OperationTargetKey;
  targetRevision: number;
  proposedValue: number;
  raText: string;
  groupKey: GroupKey;
  integrationId: string;
  periodoId: number;
  commandId: string;
}

export interface ClaimParams {
  operationId: string;
  workerId: string;
  leaseDurationSeconds?: number;
  now?: string | Date;
}

export type ClaimResult =
  | {
      ok: true;
      operation: OperationRecord;
      payload: OperationPayload;
      leaseEpoch: number;
      leaseUntil: string;
    }
  | {
      ok: false;
      code: 'ALREADY_CLAIMED' | 'NOT_FOUND' | 'NOT_ELIGIBLE';
      error: string;
    };

export interface DispatchParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  payloadText: string;
  attemptId?: string;
  now?: string | Date;
}

export type DispatchResult =
  | {
      ok: true;
      attemptId: string;
    }
  | {
      ok: false;
      code: 'FENCING_CONFLICT' | 'INVALID_STATE' | 'LEASE_EXPIRED';
      error: string;
    };

export interface ObserveParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  targetRevision: number;
  attemptId: string;
  receiptId?: string;
  responsePayload?: string;
  now?: string | Date;
}

export type ObserveResult =
  | {
      ok: true;
      receiptId: string;
    }
  | {
      ok: false;
      code:
        | 'FENCING_CONFLICT'
        | 'REVISION_MISMATCH'
        | 'ALREADY_OBSERVED'
        | 'INVALID_ATTEMPT'
        | 'INVALID_STATE'
        | 'LEASE_EXPIRED';
      error: string;
    };

export interface MarkUncertainParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  errorMessage?: string;
  attemptId?: string;
  now?: string | Date;
}

export type MarkUncertainResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: 'FENCING_CONFLICT' | 'INVALID_STATE' | 'LEASE_EXPIRED';
      error: string;
    };

export interface VerifyParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  leaseExtensionSeconds?: number;
  attemptId?: string;
  now?: string | Date;
}

export type VerifyResult =
  | {
      ok: true;
      operation: OperationRecord;
      payload: OperationPayload;
      leaseEpoch: number;
      attemptId: string;
    }
  | {
      ok: false;
      code: 'FENCING_CONFLICT' | 'INVALID_STATE';
      error: string;
    };

export interface RetryWaitParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  backoffSeconds: number;
  confirmEffectAbsent?: boolean;
  errorMessage?: string;
  attemptId?: string;
  now?: string | Date;
}

export type RetryWaitResult =
  | {
      ok: true;
      nextAttemptAt: string;
    }
  | {
      ok: false;
      code: 'FENCING_CONFLICT' | 'INVALID_STATE' | 'LEASE_EXPIRED';
      error: string;
    };

export interface RenewParams {
  operationId: string;
  workerId: string;
  leaseEpoch: number;
  extensionSeconds: number;
  now?: string | Date;
}

export type RenewResult =
  | {
      ok: true;
      leaseUntil: string;
    }
  | {
      ok: false;
      code: 'FENCING_CONFLICT' | 'INVALID_STATE' | 'LEASE_EXPIRED';
      error: string;
    };

export interface RecoveryResult {
  recoveredClaimed: number;
  recoveredDispatchedToUncertain: number;
  recoveredVerifyingToUncertain: number;
}

export function toSqliteDatetime(d?: Date | string): string {
  if (!d) {
    return new Date().toISOString().replace('T', ' ').replace(/\..+/, '');
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().replace('T', ' ').replace(/\..+/, '');
}

/**
 * Reivindica uma operação de forma atômica e exclusiva (G1).
 * Tolera recuperação de lease expirado (G2, G7), mas se a operação já estiver
 * despachada e o lease expirar, ela deve ser recuperada para UNCERTAIN via
 * recoverExpiredLeases antes de nova tentativa (G4).
 */
export async function claimOperation(
  db: D1Database,
  params: ClaimParams
): Promise<ClaimResult> {
  const leaseDuration = params.leaseDurationSeconds ?? 30;
  const now = toSqliteDatetime(params.now);

  // 1. Executa UPDATE atômico com CAS de estado e lease
  const updateRes = await db
    .prepare(
      `UPDATE sync_operations
       SET state = 'CLAIMED',
           lease_owner = ?,
           lease_epoch = lease_epoch + 1,
           lease_until = datetime(?, '+' || ? || ' seconds'),
           next_attempt_at = datetime(?, '+' || ? || ' seconds'),
           updated_at = ?
       WHERE operation_id = ?
         AND (
           -- Operação elegível para primeira tentativa ou retry agendado
           (state IN ('PENDING', 'RETRY_WAIT') AND datetime(?) >= datetime(next_attempt_at))
           -- OU lease expirou em estado pré-dispatch (CLAIMED)
           OR (state = 'CLAIMED' AND datetime(?) > datetime(lease_until))
         )`
    )
    .bind(
      params.workerId,
      now,
      leaseDuration,
      now,
      leaseDuration,
      now,
      params.operationId,
      now,
      now
    )
    .run();

  if (!updateRes.meta.changes || updateRes.meta.changes === 0) {
    // Diagnóstico do motivo da não elegibilidade
    const current = await db
      .prepare(`SELECT state, lease_owner, lease_until, next_attempt_at FROM sync_operations WHERE operation_id = ?`)
      .bind(params.operationId)
      .first<{ state: string; lease_owner: string | null; lease_until: string | null; next_attempt_at: string }>();

    if (!current) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        error: `Operação ${params.operationId} não encontrada.`,
      };
    }

    if (current.state === 'OBSERVED') {
      return {
        ok: false,
        code: 'NOT_ELIGIBLE',
        error: `Operação ${params.operationId} já foi concluída (OBSERVED).`,
      };
    }

    if (current.state === 'DISPATCHED' || current.state === 'UNCERTAIN' || current.state === 'VERIFYING') {
      return {
        ok: false,
        code: 'NOT_ELIGIBLE',
        error: `Operação ${params.operationId} está no estado ${current.state} e requer resolução de incerteza (G4) antes de novo claim.`,
      };
    }

    if (current.lease_owner && current.lease_until && new Date(current.lease_until) >= new Date(now)) {
      return {
        ok: false,
        code: 'ALREADY_CLAIMED',
        error: `Operação ${params.operationId} já está sob lease ativo do worker ${current.lease_owner} até ${current.lease_until}.`,
      };
    }

    return {
      ok: false,
      code: 'NOT_ELIGIBLE',
      error: `Operação ${params.operationId} não está elegível para claim (estado: ${current.state}, next_attempt_at: ${current.next_attempt_at}).`,
    };
  }

  // 2. Consulta a operação atualizada e o payload imutável vinculado ao evento (G5, G6)
  const fullOp = await db
    .prepare(
      `SELECT
         o.operation_id,
         o.event_id,
         o.record_id,
         o.field_key,
         o.target_key,
         o.target_revision,
         o.state,
         o.lease_owner,
         o.lease_epoch,
         o.lease_until,
         o.next_attempt_at,
         o.created_at,
         o.updated_at,
         e.value_new,
         e.command_id,
         r.ra_text,
         r.group_key,
         r.integration_id,
         i.periodo_id
       FROM sync_operations o
       JOIN sync_events e ON e.event_id = o.event_id
       JOIN sync_records r ON r.record_id = o.record_id
       JOIN sync_integrations i ON i.integration_id = r.integration_id
       WHERE o.operation_id = ?`
    )
    .bind(params.operationId)
    .first<any>();

  const operation: OperationRecord = {
    operation_id: fullOp.operation_id,
    event_id: fullOp.event_id,
    record_id: fullOp.record_id,
    field_key: fullOp.field_key,
    target_key: fullOp.target_key,
    target_revision: fullOp.target_revision,
    state: fullOp.state,
    lease_owner: fullOp.lease_owner,
    lease_epoch: fullOp.lease_epoch,
    lease_until: fullOp.lease_until,
    next_attempt_at: fullOp.next_attempt_at,
    created_at: fullOp.created_at,
    updated_at: fullOp.updated_at,
  };

  const payload: OperationPayload = {
    operationId: fullOp.operation_id,
    eventId: fullOp.event_id,
    recordId: fullOp.record_id,
    fieldKey: fullOp.field_key,
    targetKey: fullOp.target_key,
    targetRevision: fullOp.target_revision,
    proposedValue: fullOp.value_new,
    raText: fullOp.ra_text,
    groupKey: fullOp.group_key,
    integrationId: fullOp.integration_id,
    periodoId: fullOp.periodo_id,
    commandId: fullOp.command_id,
  };

  return {
    ok: true,
    operation,
    payload,
    leaseEpoch: fullOp.lease_epoch,
    leaseUntil: fullOp.lease_until,
  };
}

/**
 * Registra o envio da operação para o adaptador externo (DISPATCHED).
 * Valida fencing de lease_owner e lease_epoch (G2) e grava tentativa em sync_attempts (G7).
 */
export async function dispatchOperation(
  db: D1Database,
  params: DispatchParams
): Promise<DispatchResult> {
  const attemptId = params.attemptId ?? crypto.randomUUID();
  const now = toSqliteDatetime(params.now);

  const stmts: D1PreparedStatement[] = [
    // 1. Atualiza estado da operação com validação estrita de lease_owner, lease_epoch, estado CLAIMED e lease vigente (D1, D3)
    db
      .prepare(
        `UPDATE sync_operations
         SET state = 'DISPATCHED',
             updated_at = ?
         WHERE operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND state = 'CLAIMED'
           AND datetime(lease_until) >= datetime(?)`
      )
      .bind(now, params.operationId, params.workerId, params.leaseEpoch, now),

    // 2. Grava histórico imutável da tentativa (G7)
    db
      .prepare(
        `INSERT INTO sync_attempts (
          attempt_id, operation_id, lease_owner, lease_epoch, target_revision, state, dispatch_payload, started_at
        )
        VALUES (
          ?, ?, ?, ?,
          (SELECT target_revision FROM sync_operations WHERE operation_id = ? AND lease_owner = ? AND lease_epoch = ? AND datetime(lease_until) >= datetime(?)),
          'DISPATCHED',
          ?, ?
        )`
      )
      .bind(
        attemptId,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        now,
        params.payloadText,
        now
      ),
  ];

  try {
    const results = await db.batch(stmts);
    if (!results[0].meta.changes || results[0].meta.changes === 0) {
      const current = await db
        .prepare(`SELECT state, lease_owner, lease_epoch, lease_until FROM sync_operations WHERE operation_id = ?`)
        .bind(params.operationId)
        .first<{ state: string; lease_owner: string | null; lease_epoch: number; lease_until: string | null }>();

      if (!current) {
        return { ok: false, code: 'INVALID_STATE', error: `Operação ${params.operationId} não encontrada.` };
      }

      if (current.lease_owner !== params.workerId || current.lease_epoch !== params.leaseEpoch) {
        return {
          ok: false,
          code: 'FENCING_CONFLICT',
          error: `Fencing conflict: lease_epoch ${params.leaseEpoch} ou worker ${params.workerId} não é o proprietário atual (atual: epoch ${current.lease_epoch}, worker ${current.lease_owner}).`,
        };
      }

      if (current.lease_until && new Date(now).getTime() > new Date(current.lease_until).getTime()) {
        return {
          ok: false,
          code: 'LEASE_EXPIRED',
          error: `Lease expirado em ${current.lease_until}. Worker não pode despachar após o término do lease (D3).`,
        };
      }

      if (current.state !== 'CLAIMED') {
        return {
          ok: false,
          code: 'INVALID_STATE',
          error: `Operação está em estado '${current.state}'. Despacho direto só é permitido a partir de CLAIMED (D1).`,
        };
      }

      return {
        ok: false,
        code: 'FENCING_CONFLICT',
        error: `Não foi possível despachar a operação ${params.operationId}.`,
      };
    }
    return {
      ok: true,
      attemptId,
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes('NOT NULL constraint failed: sync_attempts.target_revision')) {
      return {
        ok: false,
        code: 'FENCING_CONFLICT',
        error: `Fencing conflict: subconsulta de target_revision retornou NULL devido a lease_epoch, lease_owner ou lease_until divergente.`,
      };
    }
    return {
      ok: false,
      code: 'INVALID_STATE',
      error: msg,
    };
  }
}

/**
 * Confirma que o alvo externo aplicou com sucesso a operação (OBSERVED).
 * Valida atomicamente:
 *  - Fencing por lease_owner e lease_epoch (G2)
 *  - Exata correspondência de targetRevision (G3: respostas tardias não confirmam revisões posteriores)
 *  - Emissão de recibo associado à operação e revisão exata
 */
export async function observeOperation(
  db: D1Database,
  params: ObserveParams
): Promise<ObserveResult> {
  const receiptId = params.receiptId ?? crypto.randomUUID();
  const now = toSqliteDatetime(params.now);

  if (!params.attemptId || typeof params.attemptId !== 'string' || params.attemptId.trim() === '') {
    return {
      ok: false,
      code: 'INVALID_ATTEMPT',
      error: 'attemptId é obrigatório para emissão de recibo (D2).',
    };
  }

  // 1. Batch atômico com validação transacional integral (D2, D3)
  const stmts: D1PreparedStatement[] = [
    // STMT 1: Atualiza sync_operations com validação estrita de lease_owner, lease_epoch, target_revision,
    // estado permitido (DISPATCHED ou VERIFYING), lease vigente (D3) e tentativa correspondente (D2)
    db
      .prepare(
        `UPDATE sync_operations
         SET state = 'OBSERVED',
             updated_at = ?
         WHERE operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND target_revision = ?
           AND state IN ('DISPATCHED', 'VERIFYING')
           AND datetime(lease_until) >= datetime(?)
           AND EXISTS (
             SELECT 1 FROM sync_attempts
             WHERE attempt_id = ?
               AND operation_id = ?
               AND lease_owner = ?
               AND lease_epoch = ?
               AND target_revision = ?
               AND state IN ('DISPATCHED', 'VERIFYING')
           )`
      )
      .bind(
        now,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        params.targetRevision,
        now,
        params.attemptId,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        params.targetRevision
      ),

    // STMT 2: Atualiza sync_attempts para OBSERVED
    db
      .prepare(
        `UPDATE sync_attempts
         SET state = 'OBSERVED',
             response_payload = ?,
             completed_at = ?
         WHERE attempt_id = ?
           AND operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND target_revision = ?`
      )
      .bind(
        params.responsePayload ?? null,
        now,
        params.attemptId,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        params.targetRevision
      ),

    // STMT 3: Emite recibo definitivo em sync_receipts com revision NOT NULL vinculada atomicamente ao STMT 1
    db
      .prepare(
        `INSERT INTO sync_receipts (
          receipt_id, command_id, operation_id, target_key, attempt_id, record_id, field_key, revision, status, created_at
        )
        VALUES (
          ?,
          (SELECT e.command_id FROM sync_operations o JOIN sync_events e ON e.event_id = o.event_id WHERE o.operation_id = ?),
          ?,
          (SELECT target_key FROM sync_operations WHERE operation_id = ?),
          ?,
          (SELECT record_id FROM sync_operations WHERE operation_id = ?),
          (SELECT field_key FROM sync_operations WHERE operation_id = ?),
          (SELECT target_revision FROM sync_operations
           WHERE operation_id = ?
             AND lease_owner = ?
             AND lease_epoch = ?
             AND target_revision = ?
             AND state = 'OBSERVED'),
          'OBSERVED',
          ?
        )`
      )
      .bind(
        receiptId,
        params.operationId,
        params.operationId,
        params.operationId,
        params.attemptId,
        params.operationId,
        params.operationId,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        params.targetRevision,
        now
      ),
  ];

  try {
    const results = await db.batch(stmts);
    if (!results[0].meta.changes || results[0].meta.changes === 0) {
      return await diagnoseObserveFailure(db, params, now);
    }

    return {
      ok: true,
      receiptId,
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes('NOT NULL constraint failed: sync_receipts.revision')) {
      return await diagnoseObserveFailure(db, params, now);
    }
    return {
      ok: false,
      code: 'FENCING_CONFLICT',
      error: msg,
    };
  }
}

async function diagnoseObserveFailure(
  db: D1Database,
  params: ObserveParams,
  now: string
): Promise<ObserveResult> {
  const current = await db
    .prepare(`SELECT state, lease_owner, lease_epoch, target_revision, lease_until FROM sync_operations WHERE operation_id = ?`)
    .bind(params.operationId)
    .first<any>();

  if (!current) {
    return { ok: false, code: 'INVALID_STATE', error: 'Operação não encontrada.' };
  }

  if (current.state === 'OBSERVED') {
    return { ok: false, code: 'ALREADY_OBSERVED', error: 'Operação já se encontra no estado OBSERVED.' };
  }

  if (current.target_revision !== params.targetRevision) {
    return {
      ok: false,
      code: 'REVISION_MISMATCH',
      error: `Revisão do callback (${params.targetRevision}) diverge da revisão da operação (${current.target_revision}). Callback tardio ignorado (G3).`,
    };
  }

  if (current.lease_owner !== params.workerId || current.lease_epoch !== params.leaseEpoch) {
    return {
      ok: false,
      code: 'FENCING_CONFLICT',
      error: `Lease epoch do callback (${params.leaseEpoch}) ou worker (${params.workerId}) diverge do atual (epoch: ${current.lease_epoch}, worker: ${current.lease_owner}). Fencing acionado (G2).`,
    };
  }

  if (current.lease_until && new Date(now).getTime() > new Date(current.lease_until).getTime()) {
    return {
      ok: false,
      code: 'LEASE_EXPIRED',
      error: `Lease expirado em ${current.lease_until}. Worker não pode observar após a expiração do lease (D3).`,
    };
  }

  if (current.state === 'CLAIMED') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      error: 'Não é permitido registrar OBSERVED a partir de CLAIMED sem dispatch ou verificação legítima (D2).',
    };
  }

  if (current.state === 'UNCERTAIN') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      error: 'Operação UNCERTAIN não pode ser observada diretamente sem antes passar por VERIFYING (D1, D2).',
    };
  }

  if (current.state !== 'DISPATCHED' && current.state !== 'VERIFYING') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      error: `Estado atual '${current.state}' não permite observação direta.`,
    };
  }

  // Diagnóstico da tentativa
  const att = await db
    .prepare(`SELECT attempt_id, operation_id, lease_owner, lease_epoch, target_revision, state FROM sync_attempts WHERE attempt_id = ?`)
    .bind(params.attemptId)
    .first<any>();

  if (!att) {
    return {
      ok: false,
      code: 'INVALID_ATTEMPT',
      error: `attemptId '${params.attemptId}' não encontrado no histórico de tentativas (D2).`,
    };
  }

  if (att.operation_id !== params.operationId) {
    return {
      ok: false,
      code: 'INVALID_ATTEMPT',
      error: `attemptId '${params.attemptId}' pertence à operação '${att.operation_id}', e não a '${params.operationId}' (D2).`,
    };
  }

  if (att.lease_owner !== params.workerId || att.lease_epoch !== params.leaseEpoch) {
    return {
      ok: false,
      code: 'FENCING_CONFLICT',
      error: `attemptId '${params.attemptId}' pertence a outro worker (${att.lease_owner}) ou lease epoch (${att.lease_epoch}) (D2).`,
    };
  }

  if (att.target_revision !== params.targetRevision) {
    return {
      ok: false,
      code: 'REVISION_MISMATCH',
      error: `Revisão da tentativa (${att.target_revision}) diverge da revisão informada (${params.targetRevision}) (D2).`,
    };
  }

  return { ok: false, code: 'FENCING_CONFLICT', error: 'Condição de concorrência violada ao observar operação.' };
}

/**
 * Marca uma operação como UNCERTAIN (G4: Timeout Incerto).
 * Usado quando um dispatch falha por timeout de rede ou conexão abortada.
 * A operação NÃO pode ser re-despachada cegamente; deve passar por VERIFYING.
 */
export async function markUncertainOperation(
  db: D1Database,
  params: MarkUncertainParams
): Promise<MarkUncertainResult> {
  const now = toSqliteDatetime(params.now);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE sync_operations
         SET state = 'UNCERTAIN',
             lease_owner = NULL,
             lease_until = NULL,
             updated_at = ?
         WHERE operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND state IN ('DISPATCHED', 'VERIFYING')
           AND datetime(lease_until) >= datetime(?)`
      )
      .bind(now, params.operationId, params.workerId, params.leaseEpoch, now),

    db
      .prepare(
        `UPDATE sync_attempts
         SET state = 'UNCERTAIN',
             error_message = ?,
             completed_at = ?
         WHERE operation_id = ?
           AND lease_epoch = ?
           AND (? IS NULL OR attempt_id = ?)`
      )
      .bind(
        params.errorMessage ?? 'Timeout ou resposta incerta do destino externo',
        now,
        params.operationId,
        params.leaseEpoch,
        params.attemptId ?? null,
        params.attemptId ?? null
      ),
  ];

  const results = await db.batch(stmts);
  if (!results[0].meta.changes || results[0].meta.changes === 0) {
    const current = await db
      .prepare(`SELECT state, lease_owner, lease_epoch, lease_until FROM sync_operations WHERE operation_id = ?`)
      .bind(params.operationId)
      .first<{ state: string; lease_owner: string | null; lease_epoch: number; lease_until: string | null }>();

    if (!current) {
      return { ok: false, code: 'INVALID_STATE', error: `Operação ${params.operationId} não encontrada.` };
    }

    if (current.lease_owner !== params.workerId || current.lease_epoch !== params.leaseEpoch) {
      return {
        ok: false,
        code: 'FENCING_CONFLICT',
        error: `Fencing conflict: lease_epoch ${params.leaseEpoch} ou worker ${params.workerId} não é o proprietário atual.`,
      };
    }

    if (current.lease_until && new Date(now).getTime() > new Date(current.lease_until).getTime()) {
      return {
        ok: false,
        code: 'LEASE_EXPIRED',
        error: `Lease expirado em ${current.lease_until}. Worker não pode alterar estado após o término do lease (D3).`,
      };
    }

    return {
      ok: false,
      code: 'INVALID_STATE',
      error: `Operação está em estado '${current.state}', incompatível com transição para UNCERTAIN.`,
    };
  }

  return { ok: true };
}

/**
 * Transiciona uma operação de UNCERTAIN para VERIFYING (G4).
 * Permite que um worker verifique junto ao alvo externo se a revisão já foi aplicada.
 */
export async function verifyOperation(
  db: D1Database,
  params: VerifyParams
): Promise<VerifyResult> {
  const attemptId = params.attemptId ?? crypto.randomUUID();
  const now = toSqliteDatetime(params.now);
  const extension = params.leaseExtensionSeconds ?? 30;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE sync_operations
         SET state = 'VERIFYING',
             lease_owner = ?,
             lease_epoch = lease_epoch + 1,
             lease_until = datetime(?, '+' || ? || ' seconds'),
             updated_at = ?
         WHERE operation_id = ?
           AND (
             (lease_owner = ? AND lease_epoch = ? AND state IN ('UNCERTAIN', 'DISPATCHED') AND datetime(lease_until) >= datetime(?))
             OR (state = 'UNCERTAIN' AND (lease_owner IS NULL OR datetime(?) > datetime(lease_until)))
           )`
      )
      .bind(
        params.workerId,
        now,
        extension,
        now,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        now,
        now
      ),

    // Registra a tentativa de verificação externa em sync_attempts (D2)
    db
      .prepare(
        `INSERT INTO sync_attempts (
          attempt_id, operation_id, lease_owner, lease_epoch, target_revision, state, dispatch_payload, started_at
        )
        VALUES (
          ?, ?, ?,
          (SELECT lease_epoch FROM sync_operations WHERE operation_id = ?),
          (SELECT target_revision FROM sync_operations WHERE operation_id = ?),
          'VERIFYING',
          'Tentativa de verificação externa',
          ?
        )`
      )
      .bind(
        attemptId,
        params.operationId,
        params.workerId,
        params.operationId,
        params.operationId,
        now
      ),
  ];

  const results = await db.batch(stmts);
  if (!results[0].meta.changes || results[0].meta.changes === 0) {
    return {
      ok: false,
      code: 'FENCING_CONFLICT',
      error: `Fencing conflict: não foi possível transicionar para VERIFYING para worker ${params.workerId} e epoch ${params.leaseEpoch}.`,
    };
  }

  const fullOp = await db
    .prepare(
      `SELECT
         o.operation_id,
         o.event_id,
         o.record_id,
         o.field_key,
         o.target_key,
         o.target_revision,
         o.state,
         o.lease_owner,
         o.lease_epoch,
         o.lease_until,
         o.next_attempt_at,
         o.created_at,
         o.updated_at,
         e.value_new,
         e.command_id,
         r.ra_text,
         r.group_key,
         r.integration_id,
         i.periodo_id
       FROM sync_operations o
       JOIN sync_events e ON e.event_id = o.event_id
       JOIN sync_records r ON r.record_id = o.record_id
       JOIN sync_integrations i ON i.integration_id = r.integration_id
       WHERE o.operation_id = ?`
    )
    .bind(params.operationId)
    .first<any>();

  const operation: OperationRecord = {
    operation_id: fullOp.operation_id,
    event_id: fullOp.event_id,
    record_id: fullOp.record_id,
    field_key: fullOp.field_key,
    target_key: fullOp.target_key,
    target_revision: fullOp.target_revision,
    state: fullOp.state,
    lease_owner: fullOp.lease_owner,
    lease_epoch: fullOp.lease_epoch,
    lease_until: fullOp.lease_until,
    next_attempt_at: fullOp.next_attempt_at,
    created_at: fullOp.created_at,
    updated_at: fullOp.updated_at,
  };

  const payload: OperationPayload = {
    operationId: fullOp.operation_id,
    eventId: fullOp.event_id,
    recordId: fullOp.record_id,
    fieldKey: fullOp.field_key,
    targetKey: fullOp.target_key,
    targetRevision: fullOp.target_revision,
    proposedValue: fullOp.value_new,
    raText: fullOp.ra_text,
    groupKey: fullOp.group_key,
    integrationId: fullOp.integration_id,
    periodoId: fullOp.periodo_id,
    commandId: fullOp.command_id,
  };

  return {
    ok: true,
    operation,
    payload,
    leaseEpoch: fullOp.lease_epoch,
    attemptId,
  };
}

/**
 * Coloca a operação em RETRY_WAIT após confirmação de que o efeito externo NÃO ocorreu
 * ou falha pré-dispatch (CLAIMED), aplicando backoff exponencial ou determinístico.
 * PROÍBE estritamente transição direta a partir de UNCERTAIN sem verificação prévia (D1).
 */
export async function markRetryWaitOperation(
  db: D1Database,
  params: RetryWaitParams
): Promise<RetryWaitResult> {
  const now = toSqliteDatetime(params.now);
  const isAbsentConfirmed = params.confirmEffectAbsent === true ? 1 : 0;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE sync_operations
         SET state = 'RETRY_WAIT',
             lease_owner = NULL,
             lease_until = NULL,
             next_attempt_at = datetime(?, '+' || ? || ' seconds'),
             updated_at = ?
         WHERE operation_id = ?
           AND lease_owner = ?
           AND lease_epoch = ?
           AND datetime(lease_until) >= datetime(?)
           AND (
             state = 'CLAIMED'
             OR (state = 'VERIFYING' AND ? = 1)
           )`
      )
      .bind(
        now,
        params.backoffSeconds,
        now,
        params.operationId,
        params.workerId,
        params.leaseEpoch,
        now,
        isAbsentConfirmed
      ),

    db
      .prepare(
        `UPDATE sync_attempts
         SET state = 'FAILED',
             error_message = ?,
             completed_at = ?
         WHERE operation_id = ?
           AND lease_epoch = ?
           AND (? IS NULL OR attempt_id = ?)`
      )
      .bind(
        params.errorMessage ?? 'Falha agendada para retry',
        now,
        params.operationId,
        params.leaseEpoch,
        params.attemptId ?? null,
        params.attemptId ?? null
      ),
  ];

  const results = await db.batch(stmts);
  if (!results[0].meta.changes || results[0].meta.changes === 0) {
    const current = await db
      .prepare(`SELECT state, lease_owner, lease_epoch, lease_until FROM sync_operations WHERE operation_id = ?`)
      .bind(params.operationId)
      .first<{ state: string; lease_owner: string | null; lease_epoch: number; lease_until: string | null }>();

    if (!current) {
      return { ok: false, code: 'INVALID_STATE', error: `Operação ${params.operationId} não encontrada.` };
    }

    if (current.state === 'UNCERTAIN') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        error: 'Operação UNCERTAIN não pode ser movida diretamente para RETRY_WAIT sem antes passar por VERIFYING e comprovação de ausência de efeito externo (D1).',
      };
    }

    if (current.state === 'DISPATCHED') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        error: 'Operação DISPATCHED não pode ser movida diretamente para RETRY_WAIT sem resolução de incerteza (D1).',
      };
    }

    if (current.state === 'VERIFYING' && params.confirmEffectAbsent !== true) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        error: 'Operação em estado VERIFYING só pode transicionar para RETRY_WAIT quando confirmEffectAbsent for estritamente true (valores false, undefined e null são proibidos) (D1).',
      };
    }

    if (current.lease_owner !== params.workerId || current.lease_epoch !== params.leaseEpoch) {
      return {
        ok: false,
        code: 'FENCING_CONFLICT',
        error: `Fencing conflict: lease_epoch ${params.leaseEpoch} ou worker ${params.workerId} não é o proprietário atual (atual: epoch ${current.lease_epoch}, worker ${current.lease_owner}).`,
      };
    }

    if (current.lease_until && new Date(now).getTime() > new Date(current.lease_until).getTime()) {
      return {
        ok: false,
        code: 'LEASE_EXPIRED',
        error: `Lease expirado em ${current.lease_until}. Worker não pode colocar operação em retry após expiração do lease (D3).`,
      };
    }

    return {
      ok: false,
      code: 'INVALID_STATE',
      error: `Estado atual '${current.state}' não permite agendamento de RETRY_WAIT.`,
    };
  }

  const updated = await db
    .prepare(`SELECT next_attempt_at FROM sync_operations WHERE operation_id = ?`)
    .bind(params.operationId)
    .first<{ next_attempt_at: string }>();

  return {
    ok: true,
    nextAttemptAt: updated?.next_attempt_at ?? '',
  };
}

/**
 * Renova o lease ativo antes que ele expire, para operações que requerem mais tempo de execução.
 */
export async function renewLease(
  db: D1Database,
  params: RenewParams
): Promise<RenewResult> {
  const now = toSqliteDatetime(params.now);

  const res = await db
    .prepare(
      `UPDATE sync_operations
       SET lease_until = datetime(lease_until, '+' || ? || ' seconds'),
           updated_at = ?
       WHERE operation_id = ?
         AND lease_owner = ?
         AND lease_epoch = ?
         AND state IN ('CLAIMED', 'DISPATCHED', 'VERIFYING')
         AND datetime(?) <= datetime(lease_until)`
    )
    .bind(
      params.extensionSeconds,
      now,
      params.operationId,
      params.workerId,
      params.leaseEpoch,
      now
    )
    .run();

  if (!res.meta.changes || res.meta.changes === 0) {
    return {
      ok: false,
      code: 'FENCING_CONFLICT',
      error: `Não foi possível renovar o lease: já expirado ou propriedade transferida (epoch: ${params.leaseEpoch}).`,
    };
  }

  const updated = await db
    .prepare(`SELECT lease_until FROM sync_operations WHERE operation_id = ?`)
    .bind(params.operationId)
    .first<{ lease_until: string }>();

  return {
    ok: true,
    leaseUntil: updated?.lease_until ?? '',
  };
}

/**
 * Varredura determinística de recuperação de leases expirados (G4, G7).
 *  - Se expirou em CLAIMED: nunca chegou ao destino externo, seguro retornar a RETRY_WAIT.
 *  - Se expirou em DISPATCHED: foi enviado, pode ter sido aplicado externamente!
 *    Obrigatoriamente transiciona para UNCERTAIN (G4: não reenvia cegamente).
 *  - Se expirou em VERIFYING: retorna para UNCERTAIN para novo ciclo de verificação.
 */
export async function recoverExpiredLeases(
  db: D1Database,
  nowOrParams?: string | Date | { now?: string | Date }
): Promise<RecoveryResult> {
  const rawNow =
    nowOrParams instanceof Date || typeof nowOrParams === 'string'
      ? nowOrParams
      : nowOrParams?.now;
  const now = toSqliteDatetime(rawNow);

  // 1. Recupera CLAIMED -> RETRY_WAIT (sem perigo de efeito duplicado)
  const resClaimed = await db
    .prepare(
      `UPDATE sync_operations
       SET state = 'RETRY_WAIT',
           lease_owner = NULL,
           next_attempt_at = ?,
           updated_at = ?
       WHERE state = 'CLAIMED'
         AND datetime(?) > datetime(lease_until)`
    )
    .bind(now, now, now)
    .run();

  // 2. Recupera DISPATCHED -> UNCERTAIN (G4: proteção contra envio duplo cego)
  const resDispatched = await db
    .prepare(
      `UPDATE sync_operations
       SET state = 'UNCERTAIN',
           lease_owner = NULL,
           updated_at = ?
       WHERE state = 'DISPATCHED'
         AND datetime(?) > datetime(lease_until)`
    )
    .bind(now, now)
    .run();

  // 3. Recupera VERIFYING -> UNCERTAIN
  const resVerifying = await db
    .prepare(
      `UPDATE sync_operations
       SET state = 'UNCERTAIN',
           lease_owner = NULL,
           updated_at = ?
       WHERE state = 'VERIFYING'
         AND datetime(?) > datetime(lease_until)`
    )
    .bind(now, now)
    .run();

  return {
    recoveredClaimed: resClaimed.meta.changes ?? 0,
    recoveredDispatchedToUncertain: resDispatched.meta.changes ?? 0,
    recoveredVerifyingToUncertain: resVerifying.meta.changes ?? 0,
  };
}

/**
 * ============================================================================
 * Adaptador Externo Falso Determinístico (Simulador Local em Memória)
 * ============================================================================
 */
export interface FakeAdapterOptions {
  simulateTimeout?: boolean;
  simulateDrop?: boolean;
  simulateError?: string;
  delayMs?: number;
}

export class FakeExternalAdapter {
  private observedRevisions: Map<string, number> = new Map();
  private calls: Array<{ type: string; payload: any; timestamp: number }> = [];
  public options: FakeAdapterOptions = {};

  constructor(options?: FakeAdapterOptions) {
    if (options) this.options = options;
  }

  getKey(targetKey: string, recordId: string, fieldKey: string): string {
    return `${targetKey}:${recordId}:${fieldKey}`;
  }

  async apply(payload: {
    targetKey: string;
    recordId: string;
    fieldKey: string;
    targetRevision: number;
    value: number;
  }): Promise<{ success: boolean; externalReceiptId: string }> {
    this.calls.push({ type: 'apply', payload, timestamp: Date.now() });

    if (this.options.simulateTimeout) {
      // G4: Simula efeito produzido no destino, porém cliente sofreu timeout antes de receber o ack
      this.observedRevisions.set(
        this.getKey(payload.targetKey, payload.recordId, payload.fieldKey),
        payload.targetRevision
      );
      throw new Error('ETIMEDOUT: Target did not reply in time');
    }

    if (this.options.simulateDrop) {
      // Simula queda de conexão antes de processar no destino
      throw new Error('ECONNRESET: Connection dropped before target processing');
    }

    if (this.options.simulateError) {
      throw new Error(this.options.simulateError);
    }

    // Sucesso: registra a revisão no destino
    this.observedRevisions.set(
      this.getKey(payload.targetKey, payload.recordId, payload.fieldKey),
      payload.targetRevision
    );

    return {
      success: true,
      externalReceiptId: `ext-rcpt-${crypto.randomUUID()}`,
    };
  }

  async queryObservedRevision(
    targetKey: string,
    recordId: string,
    fieldKey: string
  ): Promise<number | null> {
    this.calls.push({
      type: 'query',
      payload: { targetKey, recordId, fieldKey },
      timestamp: Date.now(),
    });
    return this.observedRevisions.get(this.getKey(targetKey, recordId, fieldKey)) ?? null;
  }

  getCalls() {
    return [...this.calls];
  }

  clear() {
    this.observedRevisions.clear();
    this.calls = [];
  }
}
