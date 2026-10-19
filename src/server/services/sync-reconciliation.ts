/**
 * ============================================================================
 * F3 — Motor de Reconciliação Determinística e Recuperação (F3.2, F3.3, F3.4)
 * ============================================================================
 * Implementa a máquina de decisão determinística de reconciliação com:
 *  - A1: Causalidade comprovada (nunca classificar IN_SYNC só por valores iguais).
 *  - A2: Avaliação de operações antigas vs superadas vs pendentes.
 *  - A3: Recibos tratados como evidência histórica.
 *  - A4: Conflitos isolados por alvo (CONTROLE vs GERAL_CONTRATO).
 *  - D1: Resolução administrativa autenticada via CAS/comando auditável compatível com F1-A.
 *  - D2: Recibo sem valor comprovado rejeita presunção e suspende decisão (sem fallback ?? 0).
 *  - D3: Autenticidade, layout e identidade estrita do snapshot com proveniência.
 *  - D4: Tipagem TypeScript rigorosa alinhada a ObservedExternalSnapshot.
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import type { OperationTargetKey, OperationRecord } from './sync-d1-operations';
import type {
  ReconciliationDecision,
  ReconciliationTargetContext,
  LocalFieldSnapshot,
  ConfirmedReceiptAnchor,
  ObservedExternalSnapshot,
  AdminConflictResolutionInput,
  AdminConflictResolutionResult,
} from './sync-reconciliation-contracts';
import { validateCanonicalRa, getServerTrustedAdapter, verifyAdminCredential } from './sync-d1-auth';
import { CONTROL_COLUMN_LETTERS } from './sync-sheet-contracts';

/**
 * Validação de Alvo, Layout e Proveniência Criptográfica do Snapshot Externo (D3).
 * Garante que snapshots fabricados ou de outro RA/grupo não sejam aceitos.
 */
export function validateSnapshotProvenance(
  snapshot: ObservedExternalSnapshot,
  ctx: ReconciliationTargetContext
): { valid: true } | { valid: false; reason: string } {
  // 1. Alvo incompatível
  if (snapshot.targetKey !== ctx.targetKey) {
    return {
      valid: false,
      reason: `Alvo incompatível: snapshot pertence a '${snapshot.targetKey}', esperado '${ctx.targetKey}'`,
    };
  }

  // 2. Validação de layout e coordenadas por alvo
  if (ctx.targetKey === 'CONTROLE') {
    const expectedLetter = CONTROL_COLUMN_LETTERS[ctx.fieldKey];
    if (!snapshot.cellCoordinate || !snapshot.cellCoordinate.toUpperCase().startsWith(expectedLetter)) {
      return {
        valid: false,
        reason: `Layout/coordenada inválida: campo '${ctx.fieldKey}' no alvo CONTROLE exige coluna '${expectedLetter}', encontrada '${snapshot.cellCoordinate}'`,
      };
    }
  } else if (ctx.targetKey === 'GERAL_CONTRATO') {
    if (ctx.fieldKey !== 'contrato') {
      return {
        valid: false,
        reason: "Alvo GERAL_CONTRATO é estritamente restrito ao campo 'contrato'",
      };
    }
    if (!snapshot.cellCoordinate || !snapshot.cellCoordinate.toUpperCase().startsWith('A')) {
      return {
        valid: false,
        reason: `Layout/coordenada inválida: alvo GERAL_CONTRATO exige coluna 'A', encontrada '${snapshot.cellCoordinate}'`,
      };
    }
  }

  // 3. Validação de Evidência de Proveniência (D3)
  if (!snapshot.evidence) {
    return {
      valid: false,
      reason: 'Snapshot externo sem evidência de proveniência criptográfica do adaptador',
    };
  }

  const ev = snapshot.evidence;
  if (ev.integrationId !== ctx.integrationId) {
    return {
      valid: false,
      reason: `Evidência fabricada/incompatível: integrationId '${ev.integrationId}' diverge do contexto '${ctx.integrationId}'`,
    };
  }
  if (ev.periodoId !== ctx.periodoId) {
    return {
      valid: false,
      reason: `Evidência fabricada/incompatível: periodoId '${ev.periodoId}' diverge do contexto '${ctx.periodoId}'`,
    };
  }
  if (ev.groupKey !== ctx.groupKey) {
    return {
      valid: false,
      reason: `Evidência fabricada/incompatível: groupKey '${ev.groupKey}' diverge do contexto '${ctx.groupKey}'`,
    };
  }
  if (ev.raText !== ctx.raText) {
    return {
      valid: false,
      reason: `Evidência de outro aluno: RA da evidência '${ev.raText}' diverge do aluno '${ctx.raText}'`,
    };
  }
  if (ev.fieldKey !== ctx.fieldKey) {
    return {
      valid: false,
      reason: `Evidência de outro documento: fieldKey '${ev.fieldKey}' diverge do campo '${ctx.fieldKey}'`,
    };
  }
  if (ev.normalizedValue !== snapshot.normalizedValue) {
    return {
      valid: false,
      reason: `Valor normalizado do snapshot (${snapshot.normalizedValue}) diverge da evidência (${ev.normalizedValue})`,
    };
  }
  if (ev.rawValue !== snapshot.rawValue) {
    return {
      valid: false,
      reason: `Valor bruto do snapshot ('${snapshot.rawValue}') diverge da evidência ('${ev.rawValue}')`,
    };
  }
  if (ev.cellCoordinate !== snapshot.cellCoordinate) {
    return {
      valid: false,
      reason: `Coordenada da célula diverge da evidência ('${snapshot.cellCoordinate}' vs '${ev.cellCoordinate}')`,
    };
  }
  if (ev.headerFingerprint !== snapshot.headerFingerprint) {
    return {
      valid: false,
      reason: `Fingerprint de cabeçalho diverge da evidência ('${snapshot.headerFingerprint}' vs '${ev.headerFingerprint}')`,
    };
  }

  // Validação do adaptador autorizado no servidor
  const trustedAdapter = getServerTrustedAdapter(ev.sourceAdapterId, ctx.integrationId);
  if (!trustedAdapter) {
    return {
      valid: false,
      reason: `Adaptador de origem '${ev.sourceAdapterId}' não está registrado como confiável no servidor para a integração '${ctx.integrationId}'`,
    };
  }
  if (trustedAdapter.status !== 'ACTIVE') {
    return {
      valid: false,
      reason: `Adaptador de origem '${ev.sourceAdapterId}' está revogado (${trustedAdapter.status})`,
    };
  }
  if (!trustedAdapter.allowedGroups.includes(ctx.groupKey)) {
    return {
      valid: false,
      reason: `Adaptador de origem '${ev.sourceAdapterId}' não tem autorização para o grupo '${ctx.groupKey}'`,
    };
  }

  return { valid: true };
}

/**
 * Função Pura de Decisão Determinística de Reconciliação (A1, A2, A3, A4, D2, D3).
 */
export function evaluateReconciliationDecision(
  ctx: ReconciliationTargetContext
): ReconciliationDecision {
  const { localState, receiptAnchor, currentExternal, activeOperation, targetKey, fieldKey, recordId } = ctx;

  // 1. Validação de RA e Integridade Estrutural
  const raRes = validateCanonicalRa(ctx.raText);
  if (!raRes.valid) {
    return {
      classification: 'UNKNOWN',
      targetKey,
      fieldKey,
      recordId,
      reason: `Identidade inválida: RA '${ctx.raText}' não é canônico (${raRes.error})`,
      causalityProven: false,
      actionRequired: 'ABORT_QUARANTINE',
    };
  }

  // 2. Se a observação externa for nula, ausente ou desconhecida
  if (!currentExternal || currentExternal.normalizedValue === null) {
    return {
      classification: 'UNKNOWN',
      targetKey,
      fieldKey,
      recordId,
      reason: 'Observação externa ausente ou valor da célula é desconhecido/não conclusivo',
      causalityProven: false,
      actionRequired: 'NONE',
    };
  }

  // 3. Se o campo local estiver em estado UNBASELINED
  if (localState.status === 'UNBASELINED') {
    return {
      classification: 'UNKNOWN',
      targetKey,
      fieldKey,
      recordId,
      reason: 'Campo local está em estado UNBASELINED. Exige baseline explícito autenticado antes de reconciliar.',
      causalityProven: false,
      actionRequired: 'NONE',
    };
  }

  // 4. D2: Se existe recibo órfão ou sem valor comprovado
  if (ctx.unverifiedReceipt) {
    return {
      classification: 'UNKNOWN',
      targetKey,
      fieldKey,
      recordId,
      reason: `Recibo órfão ou sem valor comprovado: ${ctx.unverifiedReceipt.reason}`,
      causalityProven: false,
      actionRequired: 'NONE',
    };
  }

  // 5. D3: Validação estrita de alvo, layout e proveniência do snapshot externo
  const provValidation = validateSnapshotProvenance(currentExternal, ctx);
  if (!provValidation.valid) {
    return {
      classification: 'UNKNOWN',
      targetKey,
      fieldKey,
      recordId,
      reason: `Snapshot externo rejeitado: ${provValidation.reason}`,
      causalityProven: false,
      actionRequired: 'NONE',
    };
  }

  // 6. Verificação de Operações Ativas / Pendentes (A2, F1-B)
  if (activeOperation) {
    // 6.1 Operação em timeout/incerteza (UNCERTAIN ou VERIFYING) -> NEEDS_VERIFICATION
    if (activeOperation.state === 'UNCERTAIN' || activeOperation.state === 'VERIFYING') {
      return {
        classification: 'NEEDS_VERIFICATION',
        targetKey,
        fieldKey,
        recordId,
        reason: `Operação ativa '${activeOperation.operation_id}' está em estado ${activeOperation.state} e requer verificação externa conclusiva`,
        causalityProven: false,
        actionRequired: 'VERIFY_EXTERNAL_EFFECT',
        details: { operationId: activeOperation.operation_id, leaseEpoch: activeOperation.lease_epoch },
      };
    }

    // 6.2 Operação atrasada com targetRevision < localState.revision
    if (activeOperation.target_revision < localState.revision) {
      // Verifica se a operação ainda é necessária ou foi superada (A2)
      if (receiptAnchor && receiptAnchor.revision >= activeOperation.target_revision) {
        return {
          classification: 'STALE_OPERATION',
          targetKey,
          fieldKey,
          recordId,
          reason: `Operação '${activeOperation.operation_id}' com targetRevision ${activeOperation.target_revision} já foi superada pela revisão confirmada ${receiptAnchor.revision}`,
          causalityProven: true,
          actionRequired: 'NONE',
          details: { operationId: activeOperation.operation_id },
        };
      }
    }
  }

  // 7. Análise Causal: Local vs Último Recibo Confirmado vs Externo Atual (A1, A3, D3)
  const extObservedValue = currentExternal.normalizedValue;
  const localValue = localState.value;

  // Caso 7.1: Se NÃO existe recibo âncora anterior para este alvo
  if (!receiptAnchor) {
    // Se o valor externo é idêntico ao local, mas não temos âncora histórica confirmada:
    // A1: NÃO presumir IN_SYNC apenas por valores iguais!
    if (localValue === extObservedValue) {
      if (localState.revision === 0) {
        return {
          classification: 'IN_SYNC',
          targetKey,
          fieldKey,
          recordId,
          reason: 'Estado sincronizado comprovado via baseline inicial (revisão 0)',
          causalityProven: true,
          actionRequired: 'NONE',
        };
      }
      return {
        classification: 'UNKNOWN',
        targetKey,
        fieldKey,
        recordId,
        reason: 'Valores iguais em ambos os lados, mas sem recibo âncora histórico. Causalidade não comprovada.',
        causalityProven: false,
        actionRequired: 'NONE',
      };
    }

    // Valores divergem e não temos recibo anterior
    if (localState.revision === 0) {
      return {
        classification: 'EXTERNAL_AHEAD',
        targetKey,
        fieldKey,
        recordId,
        reason: 'Alteração externa legítima observada após baseline inicial',
        causalityProven: true,
        actionRequired: 'APPLY_EXTERNAL_MUTATION',
        details: { fromRevision: 0, proposedValue: extObservedValue },
      };
    }

    // Revisão local > 0 e externo diverge sem recibo anterior -> Conflito Causal
    return {
      classification: 'CONFLICT',
      targetKey,
      fieldKey,
      recordId,
      reason: 'Divergência entre D1 e planilha sem âncora histórica comprovada de sincronização',
      causalityProven: false,
      actionRequired: 'RECORD_CONFLICT',
      details: { localValue, externalValue: extObservedValue },
    };
  }

  // Caso 7.2: Temos Recibo Âncora Confirmado (receiptAnchor)
  const anchorValue = receiptAnchor.confirmedValue;
  const localMutated = localValue !== anchorValue || localState.revision > receiptAnchor.revision;
  const externalMutated = extObservedValue !== anchorValue;

  // Subcaso A: Nenhum lado mudou em relação à âncora confirmada
  if (!localMutated && !externalMutated) {
    return {
      classification: 'IN_SYNC',
      targetKey,
      fieldKey,
      recordId,
      reason: `Estados comprovadamente sincronizados ancorados no recibo '${receiptAnchor.receiptId}' (revisão ${receiptAnchor.revision})`,
      causalityProven: true,
      actionRequired: 'NONE',
    };
  }

  // Subcaso B: Apenas o D1 mudou (Local Ahead)
  if (localMutated && !externalMutated) {
    return {
      classification: 'LOCAL_AHEAD',
      targetKey,
      fieldKey,
      recordId,
      reason: `D1 avançou para revisão ${localState.revision} enquanto o destino permanece no estado confirmado anterior (${anchorValue})`,
      causalityProven: true,
      actionRequired: 'DISPATCH_LOCAL_OPERATION',
      details: { targetRevision: localState.revision, targetValue: localValue },
    };
  }

  // Subcaso C: Apenas o destino externo mudou (External Ahead)
  if (!localMutated && externalMutated) {
    return {
      classification: 'EXTERNAL_AHEAD',
      targetKey,
      fieldKey,
      recordId,
      reason: `Planilha sofreu mutação externa para ${extObservedValue} enquanto D1 permaneceu na revisão ancorada ${receiptAnchor.revision}`,
      causalityProven: true,
      actionRequired: 'APPLY_EXTERNAL_MUTATION',
      details: { fromRevision: localState.revision, proposedValue: extObservedValue },
    };
  }

  // Subcaso D: Ambos os lados mudaram em relação à âncora (Conflito!)
  if (localMutated && externalMutated) {
    if (localValue === extObservedValue) {
      return {
        classification: 'CONFLICT',
        targetKey,
        fieldKey,
        recordId,
        reason: 'Ambos os lados foram alterados concorrentemente em relação ao último recibo confirmado. Causalidade ambígua.',
        causalityProven: false,
        actionRequired: 'RECORD_CONFLICT',
        details: { localValue, externalValue: extObservedValue, note: 'Coincident values under concurrent modification' },
      };
    }

    return {
      classification: 'CONFLICT',
      targetKey,
      fieldKey,
      recordId,
      reason: `Conflito concorrente: D1 alterado para ${localValue} (rev ${localState.revision}) e planilha alterada para ${extObservedValue}`,
      causalityProven: false,
      actionRequired: 'RECORD_CONFLICT',
      details: { localValue, externalValue: extObservedValue },
    };
  }

  return {
    classification: 'UNKNOWN',
    targetKey,
    fieldKey,
    recordId,
    reason: 'Estado inconclusivo na árvore de decisão causal',
    causalityProven: false,
    actionRequired: 'NONE',
  };
}

/**
 * Consulta o contexto de reconciliação para um campo e alvo específico no D1 (D2).
 */
export async function loadReconciliationTargetContext(
  db: D1Database,
  params: {
    recordId: string;
    fieldKey: FieldKey;
    targetKey: OperationTargetKey;
    currentExternal: ObservedExternalSnapshot | null;
  }
): Promise<ReconciliationTargetContext | null> {
  // 1. Carrega dados cadastrais e de escopo
  const recordRow = await db
    .prepare(
      `SELECT r.record_id, r.integration_id, r.ra_text, r.group_key, r.generation,
              i.periodo_id, i.epoch
       FROM sync_records r
       JOIN sync_integrations i ON i.integration_id = r.integration_id
       WHERE r.record_id = ?`
    )
    .bind(params.recordId)
    .first<{
      record_id: string;
      integration_id: string;
      ra_text: string;
      group_key: GroupKey;
      generation: number;
      periodo_id: number;
      epoch: number;
    }>();

  if (!recordRow) return null;

  // 2. Carrega estado atual do campo
  const fieldRow = await db
    .prepare(
      `SELECT record_id, field_key, revision, value, status, head_command_id, baseline_command_id, updated_at
       FROM sync_field_state
       WHERE record_id = ? AND field_key = ?`
    )
    .bind(params.recordId, params.fieldKey)
    .first<{
      record_id: string;
      field_key: FieldKey;
      revision: number;
      value: number | null;
      status: 'CONFIRMED' | 'PENDING' | 'CONFLICT' | 'UNBASELINED';
      head_command_id: string | null;
      baseline_command_id: string | null;
      updated_at: string;
    }>();

  if (!fieldRow) return null;

  const localState: LocalFieldSnapshot = {
    recordId: fieldRow.record_id,
    fieldKey: fieldRow.field_key,
    revision: fieldRow.revision,
    value: fieldRow.value as 0 | 1 | null,
    status: fieldRow.status,
    headCommandId: fieldRow.head_command_id,
    baselineCommandId: fieldRow.baseline_command_id,
    updatedAt: fieldRow.updated_at,
  };

  // 3. Carrega o último recibo confirmado para este alvo exato (A3, D2)
  const receiptRow = await db
    .prepare(
      `SELECT receipt_id, operation_id, target_key, revision, status, created_at
       FROM sync_receipts
       WHERE record_id = ? AND field_key = ? AND target_key = ? AND status = 'OBSERVED'
       ORDER BY revision DESC, created_at DESC
       LIMIT 1`
    )
    .bind(params.recordId, params.fieldKey, params.targetKey)
    .first<{
      receipt_id: string;
      operation_id: string;
      target_key: OperationTargetKey;
      revision: number;
      status: string;
      created_at: string;
    }>();

  let receiptAnchor: ConfirmedReceiptAnchor | null = null;
  let unverifiedReceipt: { receiptId: string; revision: number; reason: string } | null = null;

  if (receiptRow) {
    // Busca o valor comprovado em sync_events
    const eventRow = await db
      .prepare(
        `SELECT value_new FROM sync_events
         WHERE record_id = ? AND field_key = ? AND to_revision = ?`
      )
      .bind(params.recordId, params.fieldKey, receiptRow.revision)
      .first<{ value_new: number | null }>();

    // D2 — Elimina categoricamente o fallback eventRow?.value_new ?? 0
    if (!eventRow || eventRow.value_new === null || (eventRow.value_new !== 0 && eventRow.value_new !== 1)) {
      receiptAnchor = null;
      unverifiedReceipt = {
        receiptId: receiptRow.receipt_id,
        revision: receiptRow.revision,
        reason: `Recibo '${receiptRow.receipt_id}' na revisão ${receiptRow.revision} não possui evento correspondente com valor comprovado em sync_events`,
      };
    } else {
      receiptAnchor = {
        receiptId: receiptRow.receipt_id,
        operationId: receiptRow.operation_id,
        targetKey: receiptRow.target_key,
        revision: receiptRow.revision,
        confirmedValue: eventRow.value_new as 0 | 1,
        observedAt: receiptRow.created_at,
      };
    }
  }

  // 4. Carrega operação ativa pendente/despachada/incerta para este alvo
  const activeOpRow = await db
    .prepare(
      `SELECT operation_id, event_id, record_id, field_key, target_key, target_revision,
              state, lease_owner, lease_epoch, lease_until, next_attempt_at, created_at, updated_at
       FROM sync_operations
       WHERE record_id = ? AND field_key = ? AND target_key = ? AND state != 'OBSERVED'
       ORDER BY target_revision DESC
       LIMIT 1`
    )
    .bind(params.recordId, params.fieldKey, params.targetKey)
    .first<OperationRecord>();

  return {
    integrationId: recordRow.integration_id,
    periodoId: recordRow.periodo_id,
    groupKey: recordRow.group_key,
    raText: recordRow.ra_text,
    generation: recordRow.generation,
    expectedEpoch: recordRow.epoch,
    recordId: params.recordId,
    fieldKey: params.fieldKey,
    targetKey: params.targetKey,
    localState,
    receiptAnchor,
    currentExternal: params.currentExternal,
    activeOperation: activeOpRow || null,
    unverifiedReceipt,
  };
}

/**
 * Registra um conflito de forma idempotente e atômica isolado por alvo (A4).
 * Não altera globalmente sync_field_state.status quando o conflito for exclusivo de um alvo.
 */
export async function recordTargetConflict(
  db: D1Database,
  decision: ReconciliationDecision,
  params: {
    localRevision: number;
    localValue: number | null;
    externalValue: number | null;
    evidencePayload?: string;
  }
): Promise<{ recorded: boolean; conflictId: string }> {
  const conflictId = `conf_${crypto.randomUUID()}`;

  try {
    const res = await db
      .prepare(
        `INSERT INTO sync_conflicts (
          conflict_id, record_id, field_key, target_key, local_revision,
          local_value, external_value, reason, evidence_payload, resolved
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .bind(
        conflictId,
        decision.recordId,
        decision.fieldKey,
        decision.targetKey,
        params.localRevision,
        params.localValue,
        params.externalValue,
        decision.reason,
        params.evidencePayload ?? null
      )
      .run();

    return { recorded: res.meta.changes > 0, conflictId };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('UNIQUE')) {
      const existing = await db
        .prepare(
          `SELECT conflict_id FROM sync_conflicts
           WHERE record_id = ? AND field_key = ? AND target_key = ? AND local_revision = ?`
        )
        .bind(decision.recordId, decision.fieldKey, decision.targetKey, params.localRevision)
        .first<{ conflict_id: string }>();

      return { recorded: false, conflictId: existing?.conflict_id || conflictId };
    }
    throw err;
  }
}

/**
 * Contrato de Resolução Administrativa Explícita e Auditável (F3.4, D1, R1-R4, P1, P2).
 * Exige credencial criptográfica autenticada pelo servidor (P1),
 * verifica a revisão atual do campo, executa CAS com unidade transacional e rollback no D1 (P2),
 * integra operações outbox necessárias sem eco (R2), rejeita valores externos indefinidos (R3),
 * e vincula atomicamente a baixa do conflito à revisão atual (R4).
 */
export async function applyAdminConflictResolution(
  db: D1Database,
  input: AdminConflictResolutionInput
): Promise<AdminConflictResolutionResult> {
  // P1 — Autenticação Real na Fronteira do Servidor:
  // Nunca aceitar adminActorId, authorizedActorId ou qualquer outro identificador
  // enviado pelo chamador como prova de autenticação.
  // Exige credencial criptográfica válida (authCredential) verificada deterministicamente
  // contra o registro de segredos do servidor.
  const authRes = await verifyAdminCredential(db, input.authCredential, {
    conflictId: input.conflictId,
    chosenResolution: input.chosenResolution,
    expectedLocalRevision: input.expectedLocalRevision,
  });
  if (!authRes.valid) {
    return { success: false, error: 'UNAUTHORIZED_ADMIN' };
  }

  // A identidade autenticada é derivada da credencial verificada pelo servidor,
  // NUNCA de um ator escolhido livremente no payload do chamador.
  const authenticatedAdminActor = authRes.admin.adminId;

  // 1. Carrega o registro do conflito
  const conflict = await db
    .prepare(
      `SELECT conflict_id, record_id, field_key, target_key, local_revision, local_value, external_value, resolved
       FROM sync_conflicts WHERE conflict_id = ?`
    )
    .bind(input.conflictId)
    .first<{
      conflict_id: string;
      record_id: string;
      field_key: FieldKey;
      target_key: OperationTargetKey;
      local_revision: number;
      local_value: number | null;
      external_value: number | null;
      resolved: number;
    }>();

  if (!conflict) {
    return { success: false, error: 'CONFLICT_NOT_FOUND' };
  }
  if (conflict.resolved === 1) {
    return { success: false, error: 'ALREADY_RESOLVED' };
  }

  // 2. Verificar a revisão atual do campo no D1
  const currentField = await db
    .prepare(
      `SELECT revision, value, status FROM sync_field_state WHERE record_id = ? AND field_key = ?`
    )
    .bind(conflict.record_id, conflict.field_key)
    .first<{ revision: number; value: number | null; status: string }>();

  if (!currentField) {
    return { success: false, error: 'FIELD_NOT_FOUND' };
  }

  if (
    currentField.revision !== input.expectedLocalRevision ||
    currentField.revision !== conflict.local_revision
  ) {
    return { success: false, error: 'STALE_RESOLUTION_TARGET' };
  }

  const nowIso = new Date().toISOString();

  // 3. Efeitos Transacionais Atômicos compatíveis com F1-A
  if (input.chosenResolution === 'ACCEPT_EXTERNAL') {
    // R3 — Valor desconhecido: Rejeitar quando external_value não for conclusivamente 0 ou 1. Sem fallback ?? 0.
    if (conflict.external_value !== 0 && conflict.external_value !== 1) {
      return { success: false, error: 'INVALID_EXTERNAL_VALUE' };
    }
    const proposedVal: number = conflict.external_value;
    const commandId = `cmd_admin_res_${crypto.randomUUID()}`;
    const eventId = `evt_admin_res_${crypto.randomUUID()}`;
    const reqHash = `admin_res_${conflict.conflict_id}`;

    // R2 — Outbox da resolução ACCEPT_EXTERNAL:
    // Identificar alvos do campo e não criar propagação de retorno para o alvo originador,
    // garantindo que outros alvos (ex: contrato entre CONTROLE e GERAL_CONTRATO) recebam outbox.
    const allTargets: OperationTargetKey[] =
      conflict.field_key === 'contrato' ? ['CONTROLE', 'GERAL_CONTRATO'] : ['CONTROLE'];
    const targetsToNotify = allTargets.filter((t) => t !== conflict.target_key);

    const outboxOperationIds: string[] = [];

    // P2 — Atomicidade Efetiva do CAS (Padrão F1-A):
    // STMT 1: CAS no sync_field_state
    // STMT 2: INSERT no sync_commands
    // STMT 3: INSERT no sync_events com to_revision condicionado ao CAS em sync_field_state e conflito não-resolvido.
    //         Se o CAS falhar (revisão obsoleta ou concorrência) ou o conflito já estiver resolvido,
    //         a subquery de to_revision retorna NULL, disparando 'NOT NULL constraint failed: sync_events.to_revision'.
    //         Isso aborta o lote D1.batch() inteiro no SQLite com ROLLBACK TOTAL, impedindo qualquer efeito parcial!
    // STMT 4+: Operações outbox amarradas com WHERE EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)
    // STMT final: UPDATE sync_conflicts WHERE conflict_id = ? AND resolved = 0 AND EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)
    const stmts: D1PreparedStatement[] = [
      // STMT 1: CAS em sync_field_state
      db
        .prepare(
          `UPDATE sync_field_state
           SET revision = revision + 1,
               value = ?,
               status = 'CONFIRMED',
               head_command_id = ?,
               updated_at = ?
           WHERE record_id = ? AND field_key = ? AND revision = ?`
        )
        .bind(
          proposedVal,
          commandId,
          nowIso,
          conflict.record_id,
          conflict.field_key,
          currentField.revision
        ),

      // STMT 2: Comando auditável F1-A com a identidade autenticada (P1)
      db
        .prepare(
          `INSERT INTO sync_commands (
            command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`
        )
        .bind(
          commandId,
          authenticatedAdminActor,
          conflict.record_id,
          conflict.field_key,
          currentField.revision,
          proposedVal,
          reqHash
        ),

      // STMT 3: Evento aceito F1-A amarrado ao CAS (se CAS falhou, to_revision = NULL -> NOT NULL failure -> ROLLBACK)
      db
        .prepare(
          `INSERT INTO sync_events (
            event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
          ) VALUES (
            ?, ?, ?, ?, ?,
            (SELECT sfs.revision
             FROM sync_field_state sfs
             JOIN sync_conflicts sc ON sc.conflict_id = ? AND sc.resolved = 0
             WHERE sfs.record_id = ?
               AND sfs.field_key = ?
               AND sfs.head_command_id = ?
               AND sfs.revision = ? + 1
            ),
            ?, ?, ?
          )`
        )
        .bind(
          eventId,
          conflict.record_id,
          conflict.field_key,
          commandId,
          currentField.revision,
          input.conflictId,
          conflict.record_id,
          conflict.field_key,
          commandId,
          currentField.revision,
          currentField.value,
          proposedVal,
          authenticatedAdminActor
        ),
    ];

    // Inserção das operações outbox necessárias para alvos não-originadores (R2, P2)
    for (const target of targetsToNotify) {
      const opId = `op_admin_${crypto.randomUUID()}`;
      outboxOperationIds.push(opId);
      stmts.push(
        db
          .prepare(
            `INSERT INTO sync_operations (
              operation_id, event_id, record_id, field_key, target_key, target_revision, state
            )
            SELECT ?, ?, ?, ?, ?, (SELECT to_revision FROM sync_events WHERE event_id = ?), 'PENDING'
            WHERE EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
          )
          .bind(
            opId,
            eventId,
            conflict.record_id,
            conflict.field_key,
            target,
            eventId,
            eventId
          )
      );
    }

    // Marcação do conflito como resolvido com proteção contra concorrência e amarra ao evento
    stmts.push(
      db
        .prepare(
          `UPDATE sync_conflicts
           SET resolved = 1,
               resolution_action = 'ACCEPT_EXTERNAL',
               resolution_actor_id = ?,
               resolved_at = ?
           WHERE conflict_id = ?
             AND resolved = 0
             AND local_revision = ?
             AND EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
        )
        .bind(authenticatedAdminActor, nowIso, input.conflictId, currentField.revision, eventId)
    );

    try {
      const results = await db.batch(stmts);
      const updateConflict = results[results.length - 1];
      if (!updateConflict.meta.changes || updateConflict.meta.changes === 0) {
        return { success: false, error: 'CONCURRENT_RESOLUTION_CONFLICT' };
      }
      return {
        success: true,
        commandId,
        eventId,
        outboxOperationIds,
        authenticatedActorId: authenticatedAdminActor,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('NOT NULL constraint failed: sync_events.to_revision')) {
        const checkConflict = await db
          .prepare(`SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`)
          .bind(input.conflictId)
          .first<{ resolved: number }>();

        if (checkConflict && checkConflict.resolved === 1) {
          return { success: false, error: 'ALREADY_RESOLVED' };
        }
        return { success: false, error: 'STALE_REVISION_CAS_FAILED' };
      }
      if (msg.includes('UNIQUE constraint failed')) {
        return { success: false, error: 'CONCURRENT_RESOLUTION_CONFLICT' };
      }
      throw err;
    }
  } else {
    // R4 / P2 — Concorrência no KEEP_LOCAL:
    // Vincular atomicamente a baixa do conflito à revisão atual do campo em sync_field_state
    const res = await db
      .prepare(
        `UPDATE sync_conflicts
         SET resolved = 1,
             resolution_action = 'KEEP_LOCAL',
             resolution_actor_id = ?,
             resolved_at = ?
         WHERE conflict_id = ?
           AND resolved = 0
           AND local_revision = ?
           AND EXISTS (
             SELECT 1 FROM sync_field_state fs
             WHERE fs.record_id = sync_conflicts.record_id
               AND fs.field_key = sync_conflicts.field_key
               AND fs.revision = ?
           )`
      )
      .bind(authenticatedAdminActor, nowIso, input.conflictId, currentField.revision, currentField.revision)
      .run();

    if (!res.meta.changes || res.meta.changes === 0) {
      // Distinguir conflito já resolvido de alteração concorrente na revisão
      const checkAgain = await db
        .prepare(`SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`)
        .bind(input.conflictId)
        .first<{ resolved: number }>();

      if (checkAgain && checkAgain.resolved === 1) {
        return { success: false, error: 'ALREADY_RESOLVED' };
      }
      return { success: false, error: 'CONCURRENT_RESOLUTION_CONFLICT' };
    }

    return { success: true, authenticatedActorId: authenticatedAdminActor };
  }
}
