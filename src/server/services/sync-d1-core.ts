/**
 * ============================================================================
 * Núcleo Transacional D1 (F1-A) — Sincronização Bidirecional v2
 * ============================================================================
 * Implementa CAS atômico por campo, cálculo canônico de hash de idempotência,
 * contrato de escopo explícito obrigatório (B3), validação transacional anti-TOCTOU
 * (B1, B2), convergência transacional protegida contra corridas e suporte a
 * campos desconhecidos (UNBASELINED, B4).
 */

import { getServerTrustedAdapter } from './sync-d1-auth';

export type GroupKey = 'FACE_FEA' | 'FCH_EAD';

export type FieldKey =
  | 'identidade'
  | 'cpf_documento'
  | 'certidao'
  | 'residencia'
  | 'titulo'
  | 'ensino_medio'
  | 'contrato';

export const FIELD_TO_DOC_COLUMN: Record<FieldKey, string> = {
  identidade: 'identidade',
  cpf_documento: 'cpf',
  certidao: 'certidao',
  residencia: 'residencia',
  titulo: 'titulo',
  ensino_medio: 'ensino_medio',
  contrato: 'contrato',
};

export interface InitRecordParams {
  recordId: string;
  integrationId: string;
  raText: string;
  groupKey: GroupKey;
  alunoId?: number | null;
  generation?: number;
  lifecycle?: 'ACTIVE' | 'INACTIVE' | 'TOMBSTONE';
  initialValues?: Partial<Record<FieldKey, 0 | 1>>;
}

export interface BaselineEvidence {
  source: 'SPREADSHEET_IMPORT' | 'MANUAL_INITIALIZATION' | 'LEGACY_MIGRATION';
  evidencePayload: string;
  evidenceHash: string;
}

export interface BaselineInput {
  commandId: string;
  actorId: string;
  recordId: string;
  fieldKey: FieldKey;
  baselineValue: 0 | 1;
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  generation: number;
  expectedEpoch?: number;
  epoch?: number;
  evidence: BaselineEvidence;
  receiptId?: string;
  requestHash?: string;
}

export type BaselineResult =
  | {
      ok: true;
      status: 'BASELINE_ESTABLISHED';
      revision: number;
      receiptId: string;
    }
  | {
      ok: true;
      status: 'IDEMPOTENT_REPLAY';
      revision: number;
      receiptId: string;
    }
  | {
      ok: false;
      status: 'INTEGRITY_ERROR';
      error: string;
    }
  | {
      ok: false;
      status: 'INVALID_EVIDENCE';
      error: string;
    }
  | {
      ok: false;
      status: 'STATUS_CONFLICT';
      error: string;
    }
  | {
      ok: false;
      status: 'CAS_CONFLICT';
      error: string;
    }
  | {
      ok: false;
      status: 'SQL_ERROR';
      error: string;
    };

export interface MutationInput {
  commandId: string;
  actorId: string;
  recordId: string;
  fieldKey: FieldKey;
  fromRevision: number;
  proposedValue: 0 | 1;
  // B3: Contrato de escopo explícito e obrigatório na F1-A
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  generation: number;
  expectedEpoch?: number;
  epoch?: number;
  requestHash?: string;
  eventId?: string;
  operationIdControle?: string;
  operationIdGeral?: string;
  receiptId?: string;
}

export type MutationResult =
  | {
      ok: true;
      status: 'COMMITTED';
      toRevision: number;
      eventId: string;
      receiptId: string;
    }
  | {
      ok: true;
      status: 'CONVERGED';
      toRevision: number;
      receiptId: string;
    }
  | {
      ok: true;
      status: 'IDEMPOTENT_REPLAY';
      toRevision: number;
      receiptId: string;
    }
  | {
      ok: false;
      status: 'INTEGRITY_ERROR';
      error: string;
    }
  | {
      ok: false;
      status: 'CAS_CONFLICT';
      error: string;
    }
  | {
      ok: false;
      status: 'REVISION_CONFLICT';
      error: string;
    }
  | {
      ok: false;
      status: 'CONSTRAINT_VIOLATION' | 'SQL_ERROR';
      error: string;
    };

/**
 * Calcula o hash canônico e verificável do payload vinculando todos os escopos obrigatórios (B3).
 */
export async function computeCanonicalCommandHash(payload: {
  commandId: string;
  actorId: string;
  recordId: string;
  fieldKey: string;
  fromRevision: number;
  proposedValue: number;
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  generation: number;
  epoch?: number;
  expectedEpoch?: number;
}): Promise<string> {
  const epoch = payload.expectedEpoch ?? payload.epoch ?? 1;
  const raw = `v2:${payload.commandId}:${payload.actorId}:${payload.integrationId}:${payload.periodoId}:${payload.groupKey}:${payload.generation}:${epoch}:${payload.recordId}:${payload.fieldKey}:${payload.fromRevision}:${payload.proposedValue}`;
  const msgUint8 = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calcula o hash canônico do comando de estabelecimento de linha de base.
 */
export async function computeCanonicalBaselineHash(payload: {
  commandId: string;
  actorId: string;
  recordId: string;
  fieldKey: string;
  baselineValue: number;
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  generation: number;
  epoch: number;
  evidenceHash: string;
}): Promise<string> {
  const raw = `v2:baseline:${payload.commandId}:${payload.actorId}:${payload.integrationId}:${payload.periodoId}:${payload.groupKey}:${payload.generation}:${payload.epoch}:${payload.recordId}:${payload.fieldKey}:${payload.baselineValue}:${payload.evidenceHash}`;
  const msgUint8 = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Inicializa um registro de sincronização.
 * B4: Dados desconhecidos não são assumidos como 0 (não entregues). São inicializados
 * com value = NULL e status = 'UNBASELINED'. Somente valores fornecidos explicitamente
 * recebem status = 'CONFIRMED'.
 */
export async function initSyncRecord(
  db: D1Database,
  params: InitRecordParams
): Promise<void> {
  const generation = params.generation ?? 1;
  const lifecycle = params.lifecycle ?? 'ACTIVE';
  const alunoId = params.alunoId ?? null;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, aluno_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.recordId,
        params.integrationId,
        alunoId,
        params.raText,
        params.groupKey,
        generation,
        lifecycle
      ),
  ];

  const allFields: FieldKey[] = [
    'identidade',
    'cpf_documento',
    'certidao',
    'residencia',
    'titulo',
    'ensino_medio',
    'contrato',
  ];

  for (const field of allFields) {
    const val = params.initialValues?.[field];
    if (val !== undefined) {
      // Base comprovada explicitamente
      stmts.push(
        db
          .prepare(
            `INSERT INTO sync_field_state (
              record_id, field_key, value, revision, status
            ) VALUES (?, ?, ?, 0, 'CONFIRMED')`
          )
          .bind(params.recordId, field, val)
      );
    } else {
      // Base inicial desconhecida (UNBASELINED, sem valor 0 fictício)
      stmts.push(
        db
          .prepare(
            `INSERT INTO sync_field_state (
              record_id, field_key, value, revision, status
            ) VALUES (?, ?, NULL, 0, 'UNBASELINED')`
          )
          .bind(params.recordId, field)
      );
    }
  }

  await db.batch(stmts);
}

/**
 * Estabelece a linha de base inicial comprovada para um campo em estado UNBASELINED.
 * Exige evidência rastreável com verificação canônica de hash, contrato de escopo
 * explícito, validação transacional atômica anti-TOCTOU e registro semântico próprio,
 * preservando head_command_id exclusivamente para mutações documentais efetivas.
 */
export async function establishFieldBaseline(
  db: D1Database,
  input: BaselineInput
): Promise<BaselineResult> {
  const epoch = input.expectedEpoch ?? input.epoch;

  // 1. Validação de contrato de escopo explícito
  if (
    !input.commandId ||
    !input.actorId ||
    !input.recordId ||
    !input.fieldKey ||
    input.baselineValue === undefined ||
    !input.integrationId ||
    input.periodoId === undefined ||
    !input.groupKey ||
    input.generation === undefined ||
    epoch === undefined ||
    typeof epoch !== 'number'
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: 'Contrato de escopo incompleto: commandId, actorId, recordId, fieldKey, baselineValue, integrationId, periodoId, groupKey, generation e expectedEpoch são estritamente obrigatórios.',
    };
  }

  // 2. Validação rigorosa e rastreável da evidência de origem
  if (!input.evidence || typeof input.evidence !== 'object') {
    return {
      ok: false,
      status: 'INVALID_EVIDENCE',
      error: 'Evidência de linha de base ausente ou não estruturada.',
    };
  }

  const validSources = ['SPREADSHEET_IMPORT', 'MANUAL_INITIALIZATION', 'LEGACY_MIGRATION'];
  if (!validSources.includes(input.evidence.source)) {
    return {
      ok: false,
      status: 'INVALID_EVIDENCE',
      error: `Fonte de evidência '${input.evidence.source}' desconhecida ou não autorizada. Fontes válidas: ${validSources.join(', ')}.`,
    };
  }

  if (typeof input.evidence.evidencePayload !== 'string' || !input.evidence.evidencePayload.trim()) {
    return {
      ok: false,
      status: 'INVALID_EVIDENCE',
      error: 'Payload de evidência vazio ou inválido.',
    };
  }

  // Verificação canônica do digest da evidência
  const evidenceBytes = new TextEncoder().encode(input.evidence.evidencePayload);
  const evidenceDigestBuffer = await crypto.subtle.digest('SHA-256', evidenceBytes);
  const computedEvidenceHash = Array.from(new Uint8Array(evidenceDigestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (!input.evidence.evidenceHash || input.evidence.evidenceHash !== computedEvidenceHash) {
    return {
      ok: false,
      status: 'INVALID_EVIDENCE',
      error: `Hash da evidência (${input.evidence.evidenceHash}) diverge do cálculo canônico do payload (${computedEvidenceHash}).`,
    };
  }

  // Validação semântica e de vinculação para importações de planilha (C5)
  if (input.evidence.source === 'SPREADSHEET_IMPORT') {
    let parsedEvidence: any;
    try {
      parsedEvidence = JSON.parse(input.evidence.evidencePayload);
    } catch {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: 'Payload de evidência de SPREADSHEET_IMPORT não é um JSON válido.',
      };
    }

    if (
      !parsedEvidence.evidenceId ||
      !parsedEvidence.sourceAdapterId ||
      !parsedEvidence.spreadsheetId ||
      !parsedEvidence.tabName ||
      !parsedEvidence.headerFingerprint ||
      !parsedEvidence.cellCoordinate
    ) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: 'Evidência de SPREADSHEET_IMPORT incompleta: metadados de proveniência de planilha ausentes.',
      };
    }

    // Vinculação estrita aos metadados do comando
    if (parsedEvidence.integrationId !== input.integrationId) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Evidência fabricada/incompatível: integrationId da evidência (${parsedEvidence.integrationId}) diverge do comando (${input.integrationId}).`,
      };
    }
    if (parsedEvidence.periodoId !== input.periodoId) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Evidência fabricada/incompatível: periodoId da evidência (${parsedEvidence.periodoId}) diverge do comando (${input.periodoId}).`,
      };
    }
    if (parsedEvidence.groupKey !== input.groupKey) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Evidência fabricada/incompatível: groupKey da evidência (${parsedEvidence.groupKey}) diverge do comando (${input.groupKey}).`,
      };
    }
    if (parsedEvidence.fieldKey !== input.fieldKey) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Evidência fabricada/incompatível: fieldKey da evidência (${parsedEvidence.fieldKey}) diverge do comando (${input.fieldKey}).`,
      };
    }
    if (parsedEvidence.normalizedValue !== input.baselineValue) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Evidência fabricada/incompatível: valor normalizado observado (${parsedEvidence.normalizedValue}) diverge do baseline solicitado (${input.baselineValue}).`,
      };
    }

    // ------------------------------------------------------------------------
    // Fronteira Confiável Obrigatória (C5):
    // 1. Toda evidência SPREADSHEET_IMPORT DEVE possuir adapterSignature obrigatória.
    // 2. A chave de verificação é obtida EXCLUSIVAMENTE do registro confiável do servidor
    //    (getServerTrustedAdapter), nunca do input não confiável do chamador.
    // 3. A assinatura deve cobrir o contentHash canônico completo da leitura.
    // ------------------------------------------------------------------------
    if (!parsedEvidence.adapterSignature || typeof parsedEvidence.adapterSignature !== 'string') {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: 'Evidência de SPREADSHEET_IMPORT rejeitada: adapterSignature ausente. Toda importação de planilha exige assinatura criptográfica de origem.',
      };
    }

    const trustedAdapter = getServerTrustedAdapter(parsedEvidence.sourceAdapterId, input.integrationId);
    if (!trustedAdapter) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Adaptador de origem '${parsedEvidence.sourceAdapterId}' não está registrado como confiável no servidor para a integração '${input.integrationId}'.`,
      };
    }

    if (trustedAdapter.status !== 'ACTIVE') {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Adaptador de origem '${parsedEvidence.sourceAdapterId}' está revogado (${trustedAdapter.status}).`,
      };
    }

    if (!trustedAdapter.allowedGroups.includes(input.groupKey)) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `Adaptador de origem '${parsedEvidence.sourceAdapterId}' não tem autorização para o grupo '${input.groupKey}'.`,
      };
    }

    // Validação estrita do contentHash canônico e assinatura HMAC
    const expectedContentHash = parsedEvidence.contentHash;
    if (!expectedContentHash) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: 'Evidência de SPREADSHEET_IMPORT ausente de contentHash do adaptador.',
      };
    }

    // Recalcula o hash canônico a partir dos campos do snapshot para garantir que o contentHash não foi forjado
    const enc = new TextEncoder();
    const canonicalString = [
      parsedEvidence.evidenceId,
      parsedEvidence.sourceAdapterId,
      parsedEvidence.integrationId,
      parsedEvidence.periodoId,
      parsedEvidence.groupKey,
      parsedEvidence.spreadsheetId,
      parsedEvidence.tabName,
      parsedEvidence.raText,
      parsedEvidence.fieldKey,
      parsedEvidence.cellCoordinate,
      parsedEvidence.rawValue,
      parsedEvidence.normalizedValue ?? 'NULL',
      parsedEvidence.headerFingerprint,
      parsedEvidence.readTimestamp,
    ].join('|');

    const expectedCalculatedHashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(canonicalString));
    const expectedCalculatedHash = Array.from(new Uint8Array(expectedCalculatedHashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (expectedCalculatedHash !== expectedContentHash) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: `contentHash da evidência (${expectedContentHash}) diverge dos metadados da observação (${expectedCalculatedHash}).`,
      };
    }

    // Validação da assinatura HMAC usando o segredo confiável do servidor
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(trustedAdapter.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(expectedContentHash));
    const expectedSig = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (expectedSig !== parsedEvidence.adapterSignature) {
      return {
        ok: false,
        status: 'INVALID_EVIDENCE',
        error: 'Falsificação de evidência detectada: assinatura HMAC do adaptador inválida.',
      };
    }
  }

  // 3. Cálculo canônico e verificável do hash do comando de baseline
  const canonicalHash = await computeCanonicalBaselineHash({
    commandId: input.commandId,
    actorId: input.actorId,
    recordId: input.recordId,
    fieldKey: input.fieldKey,
    baselineValue: input.baselineValue,
    integrationId: input.integrationId,
    periodoId: input.periodoId,
    groupKey: input.groupKey,
    generation: input.generation,
    epoch,
    evidenceHash: computedEvidenceHash,
  });

  if (input.requestHash && input.requestHash !== canonicalHash) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Hash da requisição fornecido (${input.requestHash}) diverge do hash canônico calculado (${canonicalHash}).`,
    };
  }

  // 4. Verificação de comando existente (idempotência estrita)
  const existingCommand = await db
    .prepare(
      `SELECT command_id, request_hash, status
       FROM sync_commands
       WHERE actor_id = ? AND command_id = ?`
    )
    .bind(input.actorId, input.commandId)
    .first<{ command_id: string; request_hash: string; status: string }>();

  if (existingCommand) {
    if (existingCommand.request_hash !== canonicalHash) {
      return {
        ok: false,
        status: 'INTEGRITY_ERROR',
        error: `Comando ${input.commandId} já existe com payload/hash canônico divergente.`,
      };
    }

    const receipt = await db
      .prepare(
        `SELECT receipt_id, revision, status
         FROM sync_receipts
         WHERE command_id = ?`
      )
      .bind(input.commandId)
      .first<{ receipt_id: string; revision: number; status: string }>();

    return {
      ok: true,
      status: 'IDEMPOTENT_REPLAY',
      revision: receipt?.revision ?? 0,
      receiptId: receipt?.receipt_id ?? '',
    };
  }

  // 5. Preflight de Identidade, Escopo e Ciclo de Vida
  const recordRow = await db
    .prepare(
      `SELECT
         r.record_id,
         r.integration_id,
         r.aluno_id,
         r.ra_text,
         r.group_key,
         r.generation,
         r.lifecycle,
         i.periodo_id,
         i.epoch,
         i.mode,
         a.id AS aluno_id_real,
         a.ra AS aluno_ra,
         a.periodo_id AS aluno_periodo_id,
         d.id AS doc_id
       FROM sync_records r
       LEFT JOIN sync_integrations i ON i.integration_id = r.integration_id
       LEFT JOIN alunos a ON a.id = r.aluno_id
       LEFT JOIN documentos d ON d.aluno_id = r.aluno_id
       WHERE r.record_id = ?`
    )
    .bind(input.recordId)
    .first<{
      record_id: string;
      integration_id: string;
      aluno_id: number | null;
      ra_text: string;
      group_key: GroupKey;
      generation: number;
      lifecycle: string;
      periodo_id: number | null;
      epoch: number | null;
      mode: string | null;
      aluno_id_real: number | null;
      aluno_ra: string | null;
      aluno_periodo_id: number | null;
      doc_id: number | null;
    }>();

  if (!recordRow) {
    return {
      ok: false,
      status: 'SQL_ERROR',
      error: `Registro de sincronização ${input.recordId} não encontrado.`,
    };
  }

  if (
    input.integrationId !== recordRow.integration_id ||
    input.groupKey !== recordRow.group_key ||
    input.generation !== recordRow.generation ||
    input.periodoId !== recordRow.periodo_id
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: 'Contrato de escopo incompatível com o registro no banco.',
    };
  }

  if (recordRow.epoch === null || epoch !== recordRow.epoch) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Epoch informada (${epoch}) diverge da integração (${recordRow.epoch}).`,
    };
  }

  if (recordRow.lifecycle !== 'ACTIVE') {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Registro ${input.recordId} está ${recordRow.lifecycle} e não aceita estabelecimento de linha de base.`,
    };
  }

  const maxGenRow = await db
    .prepare(
      `SELECT MAX(generation) as max_gen
       FROM sync_records
       WHERE integration_id = ? AND group_key = ? AND ra_text = ?`
    )
    .bind(recordRow.integration_id, recordRow.group_key, recordRow.ra_text)
    .first<{ max_gen: number | null }>();

  if (maxGenRow?.max_gen && recordRow.generation < maxGenRow.max_gen) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Geração ${recordRow.generation} é obsoleta (geração ativa atual é ${maxGenRow.max_gen}).`,
    };
  }

  if (recordRow.mode === 'PAUSED' || recordRow.mode === 'QUARANTINED') {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Integração ${recordRow.integration_id} está no modo ${recordRow.mode} e não aceita linha de base.`,
    };
  }

  if (recordRow.aluno_id === null || recordRow.aluno_id === undefined) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Projeção documental ausente: registro ${input.recordId} possui aluno_id nulo.`,
    };
  }

  if (
    !recordRow.aluno_id_real ||
    recordRow.aluno_ra !== recordRow.ra_text ||
    recordRow.aluno_periodo_id !== recordRow.periodo_id
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Identidade inconsistente: aluno vinculado (${recordRow.aluno_id}) diverge em RA ou período do registro ${input.recordId}.`,
    };
  }

  if (!recordRow.doc_id) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Projeção documental inexistente: aluno vinculado (${recordRow.aluno_id}) não possui registro correspondente na tabela documentos.`,
    };
  }

  // 6. Leitura do estado atual do campo
  const currentState = await db
    .prepare(
      `SELECT value, revision, status
       FROM sync_field_state
       WHERE record_id = ? AND field_key = ?`
    )
    .bind(input.recordId, input.fieldKey)
    .first<{ value: number | null; revision: number; status: string }>();

  if (!currentState) {
    return {
      ok: false,
      status: 'SQL_ERROR',
      error: `Campo ${input.fieldKey} do registro ${input.recordId} não encontrado.`,
    };
  }

  if (currentState.status !== 'UNBASELINED') {
    return {
      ok: false,
      status: 'STATUS_CONFLICT',
      error: `Campo '${input.fieldKey}' do registro ${input.recordId} não está em estado UNBASELINED (status atual: ${currentState.status}).`,
    };
  }

  // 7. Montagem do lote transacional D1.batch atômico
  const receiptId = input.receiptId ?? crypto.randomUUID();
  const docColumn = FIELD_TO_DOC_COLUMN[input.fieldKey];

  const stmts: D1PreparedStatement[] = [
    // STMT 1: Atualiza sync_field_state para CONFIRMED e registra baseline_command_id
    // Condicionado a status = 'UNBASELINED' AND revision = 0.
    // head_command_id NÃO é alterado (mantido NULL/inalterado para distinguir de mutações reais).
    db
      .prepare(
        `UPDATE sync_field_state
         SET value = ?,
             status = 'CONFIRMED',
             baseline_command_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE record_id = ?
           AND field_key = ?
           AND status = 'UNBASELINED'
           AND revision = 0`
      )
      .bind(
        input.baselineValue,
        input.commandId,
        input.recordId,
        input.fieldKey
      ),

    // STMT 2: Grava o comando em sync_commands com status BASELINE_ESTABLISHED
    db
      .prepare(
        `INSERT INTO sync_commands (
          command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
        ) VALUES (?, ?, ?, ?, 0, ?, ?, 'BASELINE_ESTABLISHED')`
      )
      .bind(
        input.commandId,
        input.actorId,
        input.recordId,
        input.fieldKey,
        input.baselineValue,
        canonicalHash
      ),

    // STMT 3: Grava recibo com revision calculada atomicamente
    // Valida TODAS as invariantes (ciclo de vida, geração ativa, modo, epoch estrito, aluno, doc, e se STMT 1 atualizou baseline_command_id)
    db
      .prepare(
        `INSERT INTO sync_receipts (
          receipt_id, command_id, record_id, field_key, revision, status
        )
        VALUES (
          ?, ?, ?, ?,
          (SELECT CASE WHEN (
            r.lifecycle = 'ACTIVE'
            AND r.generation = (
              SELECT MAX(sr2.generation) FROM sync_records sr2
              WHERE sr2.integration_id = r.integration_id AND sr2.group_key = r.group_key AND sr2.ra_text = r.ra_text
            )
            AND i.mode NOT IN ('PAUSED', 'QUARANTINED')
            AND i.epoch = ?
            AND r.aluno_id = ?
            AND r.ra_text = ?
            AND i.periodo_id = ?
            AND EXISTS (SELECT 1 FROM documentos WHERE aluno_id = ?)
            AND s.status = 'CONFIRMED'
            AND s.baseline_command_id = ?
            AND s.revision = 0
            AND s.value = ?
          ) THEN 0 ELSE NULL END
          FROM sync_records r
          JOIN sync_integrations i ON i.integration_id = r.integration_id
          JOIN sync_field_state s ON s.record_id = r.record_id AND s.field_key = ?
          WHERE r.record_id = ? AND r.integration_id = ?),
          'D1_COMMITTED'
        )`
      )
      .bind(
        receiptId,
        input.commandId,
        input.recordId,
        input.fieldKey,
        epoch,
        recordRow.aluno_id,
        recordRow.ra_text,
        input.periodoId,
        recordRow.aluno_id,
        input.commandId,
        input.baselineValue,
        input.fieldKey,
        input.recordId,
        input.integrationId
      ),

    // STMT 4: Projeção de compatibilidade em documentos
    db
      .prepare(
        `UPDATE documentos
         SET ${docColumn} = ?,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE aluno_id = (SELECT aluno_id FROM sync_records WHERE record_id = ?)
           AND EXISTS (SELECT 1 FROM sync_receipts WHERE receipt_id = ?)`
      )
      .bind(
        input.baselineValue,
        input.recordId,
        receiptId
      ),
  ];

  try {
    await db.batch(stmts);
    return {
      ok: true,
      status: 'BASELINE_ESTABLISHED',
      revision: 0,
      receiptId,
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err);

    if (msg.includes('UNIQUE constraint failed: sync_commands')) {
      const existing = await db
        .prepare(`SELECT command_id, request_hash, status FROM sync_commands WHERE actor_id = ? AND command_id = ?`)
        .bind(input.actorId, input.commandId)
        .first<{ command_id: string; request_hash: string; status: string }>();

      if (existing) {
        if (existing.request_hash !== canonicalHash) {
          return {
            ok: false,
            status: 'INTEGRITY_ERROR',
            error: `Comando ${input.commandId} concorrente já registrado com payload/hash divergente.`,
          };
        }
        const rec = await db
          .prepare(`SELECT receipt_id, revision FROM sync_receipts WHERE command_id = ?`)
          .bind(input.commandId)
          .first<{ receipt_id: string; revision: number }>();
        return {
          ok: true,
          status: 'IDEMPOTENT_REPLAY',
          revision: rec?.revision ?? 0,
          receiptId: rec?.receipt_id ?? '',
        };
      }
    }

    if (msg.includes('NOT NULL constraint failed: sync_receipts.revision')) {
      return {
        ok: false,
        status: 'CAS_CONFLICT',
        error: 'Transação de estabelecimento de baseline abortada: o estado do campo não era UNBASELINED ou as condições de elegibilidade foram alteradas concorrentemente (TOCTOU).',
      };
    }

    return {
      ok: false,
      status: 'SQL_ERROR',
      error: msg,
    };
  }
}

/**
 * Executa uma mutação de campo documental de forma estritamente atômica no D1.
 * Exige contrato de escopo explícito (B3), validação transacional anti-TOCTOU (B2),
 * convergência atômica anti-corrida (B1) e suporte a campos UNBASELINED (B4).
 */
export async function executeFieldMutation(
  db: D1Database,
  input: MutationInput
): Promise<MutationResult> {
  const epoch = input.expectedEpoch ?? input.epoch;

  // 1. B3: Validação de presença obrigatória do contrato de escopo explícito
  if (
    !input.commandId ||
    !input.actorId ||
    !input.recordId ||
    !input.fieldKey ||
    input.fromRevision === undefined ||
    input.proposedValue === undefined ||
    !input.integrationId ||
    input.periodoId === undefined ||
    !input.groupKey ||
    input.generation === undefined ||
    epoch === undefined ||
    typeof epoch !== 'number'
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: 'Contrato de escopo incompleto: commandId, actorId, recordId, fieldKey, integrationId, periodoId, groupKey, generation e expectedEpoch são estritamente obrigatórios.',
    };
  }

  // 2. Cálculo canônico e verificável do hash do payload no núcleo
  const canonicalHash = await computeCanonicalCommandHash({
    commandId: input.commandId,
    actorId: input.actorId,
    recordId: input.recordId,
    fieldKey: input.fieldKey,
    fromRevision: input.fromRevision,
    proposedValue: input.proposedValue,
    integrationId: input.integrationId,
    periodoId: input.periodoId,
    groupKey: input.groupKey,
    generation: input.generation,
    epoch,
  });

  if (input.requestHash && input.requestHash !== canonicalHash) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Hash da requisição fornecido (${input.requestHash}) diverge do hash canônico calculado (${canonicalHash}).`,
    };
  }

  // 3. Verificação de comando existente (idempotência estrita)
  const existingCommand = await db
    .prepare(
      `SELECT command_id, request_hash, from_revision, status
       FROM sync_commands
       WHERE actor_id = ? AND command_id = ?`
    )
    .bind(input.actorId, input.commandId)
    .first<{
      command_id: string;
      request_hash: string;
      from_revision: number;
      status: string;
    }>();

  if (existingCommand) {
    if (existingCommand.request_hash !== canonicalHash) {
      return {
        ok: false,
        status: 'INTEGRITY_ERROR',
        error: `Comando ${input.commandId} já existe com payload/hash canônico divergente.`,
      };
    }

    const receipt = await db
      .prepare(
        `SELECT receipt_id, revision, status
         FROM sync_receipts
         WHERE command_id = ?`
      )
      .bind(input.commandId)
      .first<{ receipt_id: string; revision: number; status: string }>();

    return {
      ok: true,
      status: 'IDEMPOTENT_REPLAY',
      toRevision: receipt?.revision ?? (existingCommand.status === 'CONVERGED' ? existingCommand.from_revision : existingCommand.from_revision + 1),
      receiptId: receipt?.receipt_id ?? '',
    };
  }

  // 4. Preflight de Identidade, Escopo e Ciclo de Vida
  const recordRow = await db
    .prepare(
      `SELECT
         r.record_id,
         r.integration_id,
         r.aluno_id,
         r.ra_text,
         r.group_key,
         r.generation,
         r.lifecycle,
         i.periodo_id,
         i.epoch,
         i.mode,
         a.id AS aluno_id_real,
         a.ra AS aluno_ra,
         a.periodo_id AS aluno_periodo_id,
         d.id AS doc_id
       FROM sync_records r
       LEFT JOIN sync_integrations i ON i.integration_id = r.integration_id
       LEFT JOIN alunos a ON a.id = r.aluno_id
       LEFT JOIN documentos d ON d.aluno_id = r.aluno_id
       WHERE r.record_id = ?`
    )
    .bind(input.recordId)
    .first<{
      record_id: string;
      integration_id: string;
      aluno_id: number | null;
      ra_text: string;
      group_key: GroupKey;
      generation: number;
      lifecycle: string;
      periodo_id: number | null;
      epoch: number | null;
      mode: string | null;
      aluno_id_real: number | null;
      aluno_ra: string | null;
      aluno_periodo_id: number | null;
      doc_id: number | null;
    }>();

  if (!recordRow) {
    return {
      ok: false,
      status: 'SQL_ERROR',
      error: `Registro de sincronização ${input.recordId} não encontrado.`,
    };
  }

  // B3: Validação de coerência do escopo contra o banco
  if (
    input.integrationId !== recordRow.integration_id ||
    input.groupKey !== recordRow.group_key ||
    input.generation !== recordRow.generation ||
    input.periodoId !== recordRow.periodo_id
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: 'Contrato de escopo incompatível com o registro no banco.',
    };
  }

  if (recordRow.epoch === null || epoch !== recordRow.epoch) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Epoch informada (${epoch}) diverge da integração (${recordRow.epoch}).`,
    };
  }

  // Ciclo de vida
  if (recordRow.lifecycle === 'INACTIVE' || recordRow.lifecycle === 'TOMBSTONE') {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Registro ${input.recordId} está ${recordRow.lifecycle} e não aceita mutações documentais.`,
    };
  }

  // Geração ativa
  const maxGenRow = await db
    .prepare(
      `SELECT MAX(generation) as max_gen
       FROM sync_records
       WHERE integration_id = ? AND group_key = ? AND ra_text = ?`
    )
    .bind(recordRow.integration_id, recordRow.group_key, recordRow.ra_text)
    .first<{ max_gen: number | null }>();

  if (maxGenRow?.max_gen && recordRow.generation < maxGenRow.max_gen) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Geração ${recordRow.generation} é obsoleta (geração ativa atual é ${maxGenRow.max_gen}).`,
    };
  }

  // Modo da integração
  if (recordRow.mode === 'PAUSED' || recordRow.mode === 'QUARANTINED') {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Integração ${recordRow.integration_id} está no modo ${recordRow.mode} e não aceita mutações documentais.`,
    };
  }

  // Projeção e identidade
  if (recordRow.aluno_id === null || recordRow.aluno_id === undefined) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Projeção documental ausente: registro ${input.recordId} possui aluno_id nulo.`,
    };
  }

  if (
    !recordRow.aluno_id_real ||
    recordRow.aluno_ra !== recordRow.ra_text ||
    recordRow.aluno_periodo_id !== recordRow.periodo_id
  ) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Identidade inconsistente: aluno vinculado (${recordRow.aluno_id}) diverge em RA ou período do registro ${input.recordId}.`,
    };
  }

  if (!recordRow.doc_id) {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Projeção documental inexistente: aluno vinculado (${recordRow.aluno_id}) não possui registro correspondente na tabela documentos.`,
    };
  }

  // 5. Leitura do estado atual do campo
  const currentState = await db
    .prepare(
      `SELECT value, revision, status
       FROM sync_field_state
       WHERE record_id = ? AND field_key = ?`
    )
    .bind(input.recordId, input.fieldKey)
    .first<{ value: number | null; revision: number; status: string }>();

  if (!currentState) {
    return {
      ok: false,
      status: 'SQL_ERROR',
      error: `Campo ${input.fieldKey} do registro ${input.recordId} não encontrado.`,
    };
  }

  // 1. UNBASELINED: Mutações comuns não podem ser aplicadas sobre dado desconhecido
  if (currentState.status === 'UNBASELINED') {
    return {
      ok: false,
      status: 'INTEGRITY_ERROR',
      error: `Campo '${input.fieldKey}' do registro ${input.recordId} está no estado UNBASELINED. Não é permitido aplicar mutação comum sobre dado desconhecido. Estabeleça a linha de base inicial via establishFieldBaseline().`,
    };
  }

  // 6. B1: Convergência Transacional Protegida contra Corridas (anti-stale e anti-TOCTOU)
  if (
    currentState.status === 'CONFIRMED' &&
    currentState.value === input.proposedValue &&
    currentState.revision === input.fromRevision
  ) {
    const receiptId = input.receiptId ?? crypto.randomUUID();

    const stmts: D1PreparedStatement[] = [
      // STMT 1: Grava sync_commands com status 'CONVERGED'
      db
        .prepare(
          `INSERT INTO sync_commands (
            command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONVERGED')`
        )
        .bind(
          input.commandId,
          input.actorId,
          input.recordId,
          input.fieldKey,
          input.fromRevision,
          input.proposedValue,
          canonicalHash
        ),

      // STMT 2: Grava sync_receipts com status 'CONVERGED' e revision NOT NULL calculada atomicamente
      // Valida TODAS as invariantes: ciclo de vida, geração máxima, modo, epoch estrito, aluno, doc, e revision/value/status.
      // Preserva head_command_id em sync_field_state 100% inalterado!
      db
        .prepare(
          `INSERT INTO sync_receipts (
            receipt_id, command_id, record_id, field_key, revision, status
          )
          VALUES (
            ?, ?, ?, ?,
            (SELECT CASE WHEN (
              r.lifecycle = 'ACTIVE'
              AND r.generation = (
                SELECT MAX(sr2.generation) FROM sync_records sr2
                WHERE sr2.integration_id = r.integration_id AND sr2.group_key = r.group_key AND sr2.ra_text = r.ra_text
              )
              AND i.mode NOT IN ('PAUSED', 'QUARANTINED')
              AND i.epoch = ?
              AND r.aluno_id = ?
              AND r.ra_text = ?
              AND i.periodo_id = ?
              AND EXISTS (SELECT 1 FROM documentos WHERE aluno_id = ?)
              AND s.revision = ?
              AND s.value = ?
              AND s.status = 'CONFIRMED'
            ) THEN s.revision ELSE NULL END
            FROM sync_records r
            JOIN sync_integrations i ON i.integration_id = r.integration_id
            JOIN sync_field_state s ON s.record_id = r.record_id AND s.field_key = ?
            WHERE r.record_id = ? AND r.integration_id = ?),
            'CONVERGED'
          )`
        )
        .bind(
          receiptId,
          input.commandId,
          input.recordId,
          input.fieldKey,
          epoch,
          recordRow.aluno_id,
          recordRow.ra_text,
          input.periodoId,
          recordRow.aluno_id,
          input.fromRevision,
          input.proposedValue,
          input.fieldKey,
          input.recordId,
          input.integrationId
        ),
    ];

    try {
      await db.batch(stmts);
      return {
        ok: true,
        status: 'CONVERGED',
        toRevision: currentState.revision,
        receiptId,
      };
    } catch (err: any) {
      const msg = String(err?.message ?? err);

      if (msg.includes('UNIQUE constraint failed: sync_commands')) {
        const existing = await db
          .prepare(
            `SELECT command_id, request_hash, from_revision, status
             FROM sync_commands
             WHERE actor_id = ? AND command_id = ?`
          )
          .bind(input.actorId, input.commandId)
          .first<{ command_id: string; request_hash: string; from_revision: number; status: string }>();

        if (existing) {
          if (existing.request_hash !== canonicalHash) {
            return {
              ok: false,
              status: 'INTEGRITY_ERROR',
              error: `Comando ${input.commandId} concorrente já registrado com payload/hash divergente.`,
            };
          }
          const rec = await db
            .prepare(`SELECT receipt_id, revision FROM sync_receipts WHERE command_id = ?`)
            .bind(input.commandId)
            .first<{ receipt_id: string; revision: number }>();
          return {
            ok: true,
            status: 'IDEMPOTENT_REPLAY',
            toRevision: rec?.revision ?? currentState.revision,
            receiptId: rec?.receipt_id ?? '',
          };
        }
      }

      if (msg.includes('NOT NULL constraint failed: sync_receipts.revision')) {
        return {
          ok: false,
          status: 'CAS_CONFLICT',
          error: 'Convergência transacional abortada: o estado do campo ou a elegibilidade do registro mudou concorrentemente (TOCTOU).',
        };
      }

      return { ok: false, status: 'SQL_ERROR', error: msg };
    }
  }

  // 7. Transição Vencedora (Semântica Real ou Estabelecimento de Base Inicial)
  const valueOld = currentState.value;
  const eventId = input.eventId ?? crypto.randomUUID();
  const opIdControle = input.operationIdControle ?? crypto.randomUUID();
  const receiptId = input.receiptId ?? crypto.randomUUID();
  const docColumn = FIELD_TO_DOC_COLUMN[input.fieldKey];

  // 8. Montagem do lote transacional D1.batch com validação atômica integral anti-TOCTOU
  const stmts: D1PreparedStatement[] = [];

  // STMT 1: Registro do comando com status ACCEPTED
  stmts.push(
    db
      .prepare(
        `INSERT INTO sync_commands (
          command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`
      )
      .bind(
        input.commandId,
        input.actorId,
        input.recordId,
        input.fieldKey,
        input.fromRevision,
        input.proposedValue,
        canonicalHash
      )
  );

  // STMT 2: CAS no sync_field_state com atualização de last_event_id e status = 'CONFIRMED'
  stmts.push(
    db
      .prepare(
        `UPDATE sync_field_state
         SET value = ?,
             revision = revision + 1,
             head_command_id = ?,
             last_event_id = ?,
             status = 'CONFIRMED',
             updated_at = CURRENT_TIMESTAMP
         WHERE record_id = ?
           AND field_key = ?
           AND revision = ?
           AND status = 'CONFIRMED'`
      )
      .bind(
        input.proposedValue,
        input.commandId,
        eventId,
        input.recordId,
        input.fieldKey,
        input.fromRevision
      )
  );

  // STMT 3: Inserção do evento aceito com validação transacional atômica anti-TOCTOU (B2)
  // Avalia todas as invariantes no exato momento da execução do batch no D1.
  // Se QUALQUER invariante falhar, a subconsulta retorna NULL e dispara
  // 'NOT NULL constraint failed: sync_events.to_revision', abortando o lote completo.
  stmts.push(
    db
      .prepare(
        `INSERT INTO sync_events (
          event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
        ) VALUES (
          ?, ?, ?, ?, ?,
          (SELECT sfs.revision
           FROM sync_field_state sfs
           JOIN sync_records r ON r.record_id = sfs.record_id
           JOIN sync_integrations i ON i.integration_id = r.integration_id
           JOIN alunos a ON a.id = r.aluno_id
           JOIN documentos d ON d.aluno_id = r.aluno_id
           WHERE sfs.record_id = ?
             AND sfs.field_key = ?
             AND sfs.head_command_id = ?
             AND r.lifecycle = 'ACTIVE'
             AND r.generation = (
               SELECT MAX(sr2.generation) FROM sync_records sr2
               WHERE sr2.integration_id = r.integration_id AND sr2.group_key = r.group_key AND sr2.ra_text = r.ra_text
             )
             AND i.mode NOT IN ('PAUSED', 'QUARANTINED')
             AND a.ra = r.ra_text
             AND a.periodo_id = i.periodo_id
             AND r.integration_id = ?
             AND r.group_key = ?
             AND r.generation = ?
             AND i.periodo_id = ?
             AND i.epoch = ?
          ),
          ?, ?, ?
        )`
      )
      .bind(
        eventId,
        input.recordId,
        input.fieldKey,
        input.commandId,
        input.fromRevision,
        input.recordId,
        input.fieldKey,
        input.commandId,
        input.integrationId,
        input.groupKey,
        input.generation,
        input.periodoId,
        epoch,
        valueOld,
        input.proposedValue,
        input.actorId
      )
  );

  // STMT 4: Projeção de compatibilidade em 'documentos'
  stmts.push(
    db
      .prepare(
        `UPDATE documentos
         SET ${docColumn} = ?,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE aluno_id = (SELECT aluno_id FROM sync_records WHERE record_id = ?)
           AND EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
      )
      .bind(
        input.proposedValue,
        input.recordId,
        eventId
      )
  );

  // STMT 5: Outbox para o alvo CONTROLE (estado PENDING estrito)
  stmts.push(
    db
      .prepare(
        `INSERT INTO sync_operations (
          operation_id, event_id, record_id, field_key, target_key, target_revision, state
        )
        SELECT ?, ?, ?, ?, 'CONTROLE', (SELECT to_revision FROM sync_events WHERE event_id = ?), 'PENDING'
        WHERE EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
      )
      .bind(
        opIdControle,
        eventId,
        input.recordId,
        input.fieldKey,
        eventId,
        eventId
      )
  );

  // STMT 6: Outbox para GERAL_CONTRATO caso o campo seja 'contrato'
  if (input.fieldKey === 'contrato') {
    const opIdGeral = input.operationIdGeral ?? crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          `INSERT INTO sync_operations (
            operation_id, event_id, record_id, field_key, target_key, target_revision, state
          )
          SELECT ?, ?, ?, ?, 'GERAL_CONTRATO', (SELECT to_revision FROM sync_events WHERE event_id = ?), 'PENDING'
          WHERE EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
        )
        .bind(
          opIdGeral,
          eventId,
          input.recordId,
          input.fieldKey,
          eventId,
          eventId
        )
    );
  }

  // STMT 7: Recibo local D1_COMMITTED
  stmts.push(
    db
      .prepare(
        `INSERT INTO sync_receipts (
          receipt_id, command_id, record_id, field_key, revision, status
        )
        SELECT ?, ?, ?, ?, (SELECT to_revision FROM sync_events WHERE event_id = ?), 'D1_COMMITTED'
        WHERE EXISTS (SELECT 1 FROM sync_events WHERE event_id = ?)`
      )
      .bind(
        receiptId,
        input.commandId,
        input.recordId,
        input.fieldKey,
        eventId,
        eventId
      )
  );

  // 9. Execução do lote atômico no D1
  try {
    await db.batch(stmts);
    return {
      ok: true,
      status: 'COMMITTED',
      toRevision: input.fromRevision + 1,
      eventId,
      receiptId,
    };
  } catch (error: any) {
    const msg = String(error?.message ?? error);

    if (msg.includes('UNIQUE constraint failed: sync_commands')) {
      const existing = await db
        .prepare(
          `SELECT command_id, request_hash, from_revision, status
           FROM sync_commands
           WHERE actor_id = ? AND command_id = ?`
        )
        .bind(input.actorId, input.commandId)
        .first<{
          command_id: string;
          request_hash: string;
          from_revision: number;
          status: string;
        }>();

      if (existing) {
        if (existing.request_hash !== canonicalHash) {
          return {
            ok: false,
            status: 'INTEGRITY_ERROR',
            error: `Comando ${input.commandId} concorrente já registrado com payload/hash divergente.`,
          };
        }
        const rec = await db
          .prepare(
            `SELECT receipt_id, revision, status FROM sync_receipts WHERE command_id = ?`
          )
          .bind(input.commandId)
          .first<{ receipt_id: string; revision: number; status: string }>();

        return {
          ok: true,
          status: 'IDEMPOTENT_REPLAY',
          toRevision: rec?.revision ?? existing.from_revision + 1,
          receiptId: rec?.receipt_id ?? '',
        };
      }
    }

    if (msg.includes('NOT NULL constraint failed: sync_events.to_revision')) {
      return {
        ok: false,
        status: 'CAS_CONFLICT',
        error: `NOT NULL constraint failed: sync_events.to_revision - Transação abortada: CAS falhou ou condição de elegibilidade (ciclo de vida, geração, integração, projeção) foi invalidada (TOCTOU).`,
      };
    }

    if (
      msg.includes(
        'UNIQUE constraint failed: sync_events.record_id, sync_events.field_key, sync_events.to_revision'
      )
    ) {
      return {
        ok: false,
        status: 'REVISION_CONFLICT',
        error: msg,
      };
    }

    if (msg.includes('UNIQUE constraint failed')) {
      return {
        ok: false,
        status: 'CONSTRAINT_VIOLATION',
        error: msg,
      };
    }

    return {
      ok: false,
      status: 'SQL_ERROR',
      error: msg,
    };
  }
}
