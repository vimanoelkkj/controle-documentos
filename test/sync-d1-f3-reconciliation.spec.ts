import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initSyncRecord,
  establishFieldBaseline,
  executeFieldMutation,
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";
import {
  claimOperation,
  dispatchOperation,
  observeOperation,
  markUncertainOperation,
  verifyOperation,
  type OperationTargetKey,
} from "../src/server/services/sync-d1-operations";
import {
  registerServerTrustedAdapter,
  registerServerTrustedAdmin,
  clearServerTrustedAdmins,
  generateAdminCredential,
  type AuthIdentity,
} from "../src/server/services/sync-d1-auth";
import { FakeSpreadsheetAdapter } from "../src/server/services/sync-sheet-fake-adapter";
import {
  evaluateReconciliationDecision,
  loadReconciliationTargetContext,
  recordTargetConflict,
  applyAdminConflictResolution,
} from "../src/server/services/sync-reconciliation";
import type {
  ReconciliationTargetContext,
  ObservedExternalSnapshot,
  ProvenanceEvidence,
} from "../src/server/services/sync-reconciliation-contracts";

describe("F3: Reconciliação, Detecção de Conflitos e Recuperação (D1 ↔ Sheets)", () => {
  const periodoId = 7777;
  const integrationFaceId = "int-f3-face-001";
  const integrationFchId = "int-f3-fch-001";
  const spreadsheetFaceId = "sheet-f3-face-mock";
  const spreadsheetFchId = "sheet-f3-fch-mock";
  const secretKey = "super-secret-hmac-key-f3";

  let adapterFace: FakeSpreadsheetAdapter;
  let adapterFch: FakeSpreadsheetAdapter;

  const adminIdentities: Record<string, AuthIdentity> = {
    "admin:authorized": {
      senderId: "admin:authorized",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA", "FCH_EAD"],
      allowedScopes: ["admin:resolve_conflict"],
      status: "ACTIVE",
      secret: secretKey,
    },
    "admin:unauthorized_scope": {
      senderId: "admin:unauthorized_scope",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA"],
      allowedScopes: ["read:snapshot"],
      status: "ACTIVE",
      secret: secretKey,
    },
    "admin:revoked": {
      senderId: "admin:revoked",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA"],
      allowedScopes: ["admin:resolve_conflict"],
      status: "REVOKED",
      secret: secretKey,
    },
  };

  async function adminIdentityLookup(senderId: string): Promise<AuthIdentity | null> {
    return adminIdentities[senderId] || null;
  }

  beforeAll(async () => {
    // 1. Garantir que a tabela sync_conflicts existe no D1
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        conflict_id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        field_key TEXT NOT NULL,
        target_key TEXT NOT NULL CHECK (target_key IN ('CONTROLE', 'GERAL_CONTRATO')),
        local_revision INTEGER NOT NULL,
        local_value INTEGER,
        external_value INTEGER,
        reason TEXT NOT NULL,
        evidence_payload TEXT,
        resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
        resolution_action TEXT,
        resolution_actor_id TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
        UNIQUE (record_id, field_key, target_key, local_revision)
      )
    `).run();

    // 2. Setup de período e integrações no D1
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status)
       VALUES (?, '2026-2-FICTICIO-F3', 'ATIVO')`
    )
      .bind(periodoId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, ?, 1, 1, 'BIDIRECTIONAL')`
    )
      .bind(integrationFaceId, periodoId, spreadsheetFaceId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, ?, 1, 1, 'BIDIRECTIONAL')`
    )
      .bind(integrationFchId, periodoId, spreadsheetFchId)
      .run();

    // 3. Registro dos adaptadores confiáveis no servidor
    registerServerTrustedAdapter({
      adapterId: "fake-adapter-face-f3",
      integrationId: integrationFaceId,
      periodoId,
      spreadsheetId: spreadsheetFaceId,
      allowedGroups: ["FACE_FEA"],
      status: "ACTIVE",
      secret: secretKey,
    });

    registerServerTrustedAdapter({
      adapterId: "fake-adapter-fch-f3",
      integrationId: integrationFchId,
      periodoId,
      spreadsheetId: spreadsheetFchId,
      allowedGroups: ["FCH_EAD"],
      status: "ACTIVE",
      secret: secretKey,
    });

    // 4. Instancia adaptadores simulados
    adapterFace = new FakeSpreadsheetAdapter("fake-adapter-face-f3");
    adapterFch = new FakeSpreadsheetAdapter("fake-adapter-fch-f3");

    // 5. Registra administradores confiáveis no servidor (R1, P1)
    clearServerTrustedAdmins();
    registerServerTrustedAdmin({
      adminId: "admin:authorized",
      allowedScopes: ["admin:resolve_conflict"],
      status: "ACTIVE",
      secret: secretKey,
    });
    registerServerTrustedAdmin({
      adminId: "admin:unauthorized_scope",
      allowedScopes: ["read:snapshot"],
      status: "ACTIVE",
      secret: secretKey,
    });
    registerServerTrustedAdmin({
      adminId: "admin:revoked",
      allowedScopes: ["admin:resolve_conflict"],
      status: "REVOKED",
      secret: secretKey,
    });
  });

  // Helper para criar aluno fictício
  async function criarAlunoFicticio(ra: string, nome: string): Promise<number> {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO TESTE F3', 'FACE', 'ATIVO')`
    )
      .bind(periodoId, ra, nome)
      .run();

    const alunoId = Number(res.meta.last_row_id);
    await env.DB.prepare(
      `INSERT INTO documentos (
        aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    )
      .bind(alunoId)
      .run();

    return alunoId;
  }

  // Helper tipado para criar snapshot externo válido com proveniência
  function buildValidExternalSnapshot(params: {
    targetKey?: OperationTargetKey;
    fieldKey?: FieldKey;
    rawValue?: string;
    normalizedValue?: 0 | 1 | null;
    cellCoordinate?: string;
    raText?: string;
    groupKey?: GroupKey;
    integrationId?: string;
    periodoIdVal?: number;
    withoutEvidence?: boolean;
    tamperedEvidence?: Partial<ProvenanceEvidence>;
  } = {}): ObservedExternalSnapshot {
    const targetKey = params.targetKey ?? "CONTROLE";
    const fieldKey = params.fieldKey ?? "identidade";
    const rawValue = params.rawValue ?? "NÃO";
    const normalizedValue = params.normalizedValue !== undefined ? params.normalizedValue : 0;
    const cellCoordinate = params.cellCoordinate ?? (targetKey === "GERAL_CONTRATO" ? "A2" : "C2");
    const headerFingerprint = "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO";
    const observedAt = new Date().toISOString();

    if (params.withoutEvidence) {
      return {
        targetKey,
        rawValue,
        normalizedValue,
        cellCoordinate,
        headerFingerprint,
        observedAt,
      };
    }

    const evidence: ProvenanceEvidence = {
      evidenceId: `ev_test_${crypto.randomUUID()}`,
      sourceAdapterId: "fake-adapter-face-f3",
      integrationId: params.integrationId ?? integrationFaceId,
      periodoId: params.periodoIdVal ?? periodoId,
      groupKey: params.groupKey ?? "FACE_FEA",
      spreadsheetId: spreadsheetFaceId,
      tabName: "CONTROLE_FACE",
      raText: params.raText ?? "00012345",
      fieldKey,
      cellCoordinate,
      rawValue,
      normalizedValue,
      readTimestamp: observedAt,
      headerFingerprint,
      contentHash: "hash_canonical_test",
      ...params.tamperedEvidence,
    };

    return {
      targetKey,
      rawValue,
      normalizedValue,
      cellCoordinate,
      headerFingerprint,
      observedAt,
      evidence,
    };
  }

  // Helper para montar contexto puro de teste
  function buildTestContext(overrides: Partial<ReconciliationTargetContext>): ReconciliationTargetContext {
    return {
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      raText: "00012345",
      generation: 1,
      expectedEpoch: 1,
      recordId: "rec_mock_001",
      fieldKey: "identidade",
      targetKey: "CONTROLE",
      localState: {
        recordId: "rec_mock_001",
        fieldKey: "identidade",
        revision: 0,
        value: 0,
        status: "CONFIRMED",
        headCommandId: "cmd_0",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: null,
      currentExternal: buildValidExternalSnapshot(),
      activeOperation: null,
      ...overrides,
    };
  }

  // =========================================================================
  // CENÁRIO 1: D1 mudou, planilha não mudou -> LOCAL_AHEAD
  // =========================================================================
  it("Cenário 1: D1 avançou para nova revisão enquanto planilha permanece no estado confirmado -> LOCAL_AHEAD", () => {
    const ctx = buildTestContext({
      localState: {
        recordId: "rec_mock_001",
        fieldKey: "identidade",
        revision: 1,
        value: 1,
        status: "CONFIRMED",
        headCommandId: "cmd_1",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: {
        receiptId: "rcpt_0",
        operationId: "op_0",
        targetKey: "CONTROLE",
        revision: 0,
        confirmedValue: 0,
        observedAt: new Date().toISOString(),
      },
      currentExternal: buildValidExternalSnapshot({
        rawValue: "NÃO",
        normalizedValue: 0,
      }),
    });

    const decision = evaluateReconciliationDecision(ctx);

    expect(decision.classification).toBe("LOCAL_AHEAD");
    expect(decision.causalityProven).toBe(true);
    expect(decision.actionRequired).toBe("DISPATCH_LOCAL_OPERATION");
    expect(decision.details?.targetRevision).toBe(1);
    expect(decision.details?.targetValue).toBe(1);
  });

  // =========================================================================
  // CENÁRIO 2: Planilha mudou, D1 não mudou -> EXTERNAL_AHEAD
  // =========================================================================
  it("Cenário 2: Planilha alterada externamente enquanto D1 permanece na revisão ancorada -> EXTERNAL_AHEAD", () => {
    const ctx = buildTestContext({
      localState: {
        recordId: "rec_mock_001",
        fieldKey: "identidade",
        revision: 0,
        value: 0,
        status: "CONFIRMED",
        headCommandId: "cmd_0",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: {
        receiptId: "rcpt_0",
        operationId: "op_0",
        targetKey: "CONTROLE",
        revision: 0,
        confirmedValue: 0,
        observedAt: new Date().toISOString(),
      },
      currentExternal: buildValidExternalSnapshot({
        rawValue: "SIM",
        normalizedValue: 1,
      }),
    });

    const decision = evaluateReconciliationDecision(ctx);

    expect(decision.classification).toBe("EXTERNAL_AHEAD");
    expect(decision.causalityProven).toBe(true);
    expect(decision.actionRequired).toBe("APPLY_EXTERNAL_MUTATION");
    expect(decision.details?.fromRevision).toBe(0);
    expect(decision.details?.proposedValue).toBe(1);
  });

  // =========================================================================
  // CENÁRIO 3: D1 e planilha mudaram -> CONFLICT isolado por alvo
  // =========================================================================
  it("Cenário 3: D1 e planilha sofreram mutações concorrentes em relação à âncora -> CONFLICT isolado", () => {
    const ctxConflict = buildTestContext({
      fieldKey: "residencia",
      receiptAnchor: {
        receiptId: "rcpt_c3",
        operationId: "op_c3",
        targetKey: "CONTROLE",
        revision: 1,
        confirmedValue: 1,
        observedAt: new Date().toISOString(),
      },
      localState: {
        recordId: "rec_mock_001",
        fieldKey: "residencia",
        revision: 2,
        value: 0,
        status: "CONFIRMED",
        headCommandId: "cmd_c3",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      currentExternal: buildValidExternalSnapshot({
        fieldKey: "residencia",
        cellCoordinate: "F2",
        rawValue: "NÃO",
        normalizedValue: 0,
      }),
    });

    const decision = evaluateReconciliationDecision(ctxConflict);
    expect(decision.classification).toBe("CONFLICT");
    expect(decision.causalityProven).toBe(false);
    expect(decision.actionRequired).toBe("RECORD_CONFLICT");
  });

  // =========================================================================
  // CENÁRIO 4: Condição A1 — Mesmo valor nos dois lados sem causalidade comprovada -> UNKNOWN
  // =========================================================================
  it("Cenário 4 (Condição A1): Mesmo valor nos dois lados mas sem recibo âncora -> retorna UNKNOWN, NUNCA IN_SYNC", () => {
    const ctx = buildTestContext({
      fieldKey: "titulo",
      localState: {
        recordId: "rec_mock_c4",
        fieldKey: "titulo",
        revision: 3,
        value: 1,
        status: "CONFIRMED",
        headCommandId: "cmd_c4",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: null,
      currentExternal: buildValidExternalSnapshot({
        fieldKey: "titulo",
        cellCoordinate: "G2",
        rawValue: "SIM",
        normalizedValue: 1,
      }),
    });

    const decision = evaluateReconciliationDecision(ctx);

    expect(decision.classification).toBe("UNKNOWN");
    expect(decision.causalityProven).toBe(false);
    expect(decision.reason).toContain("sem recibo âncora histórico. Causalidade não comprovada");
  });

  // =========================================================================
  // CENÁRIO 5: Condição A2 — Avaliação de operações antigas vs superadas
  // =========================================================================
  it("Cenário 5 (Condição A2): Operação antiga superada por revisão comprovada na âncora -> STALE_OPERATION", () => {
    const ctx = buildTestContext({
      fieldKey: "ensino_medio",
      localState: {
        recordId: "rec_mock_c5",
        fieldKey: "ensino_medio",
        revision: 3,
        value: 1,
        status: "CONFIRMED",
        headCommandId: "cmd_c5",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: {
        receiptId: "rcpt_c5_2",
        operationId: "op_c5_2",
        targetKey: "CONTROLE",
        revision: 2,
        confirmedValue: 1,
        observedAt: new Date().toISOString(),
      },
      activeOperation: {
        operation_id: "op_old_1",
        event_id: "evt_1",
        record_id: "rec_mock_c5",
        field_key: "ensino_medio",
        target_key: "CONTROLE",
        target_revision: 1,
        state: "CLAIMED",
        lease_owner: "worker_1",
        lease_epoch: 1,
        lease_until: new Date(Date.now() + 60000).toISOString(),
        next_attempt_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      currentExternal: buildValidExternalSnapshot({
        fieldKey: "ensino_medio",
        cellCoordinate: "H2",
        rawValue: "SIM",
        normalizedValue: 1,
      }),
    });

    const decision = evaluateReconciliationDecision(ctx);

    expect(decision.classification).toBe("STALE_OPERATION");
    expect(decision.causalityProven).toBe(true);
    expect(decision.reason).toContain("já foi superada pela revisão confirmada 2");
  });

  it("Cenário 5B (Condição A2): Operação antiga NÃO superada (alvo ainda não alcançou) não é marcada STALE", () => {
    const ctx = buildTestContext({
      fieldKey: "ensino_medio",
      localState: {
        recordId: "rec_mock_c5b",
        fieldKey: "ensino_medio",
        revision: 3,
        value: 1,
        status: "CONFIRMED",
        headCommandId: "cmd_c5b",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: {
        receiptId: "rcpt_c5_0",
        operationId: "op_c5_0",
        targetKey: "CONTROLE",
        revision: 0,
        confirmedValue: 0,
        observedAt: new Date().toISOString(),
      },
      activeOperation: {
        operation_id: "op_pending_1",
        event_id: "evt_1",
        record_id: "rec_mock_c5b",
        field_key: "ensino_medio",
        target_key: "CONTROLE",
        target_revision: 1,
        state: "CLAIMED",
        lease_owner: "worker_1",
        lease_epoch: 1,
        lease_until: new Date(Date.now() + 60000).toISOString(),
        next_attempt_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      currentExternal: buildValidExternalSnapshot({
        fieldKey: "ensino_medio",
        cellCoordinate: "H2",
        rawValue: "NÃO",
        normalizedValue: 0,
      }),
    });

    const decision = evaluateReconciliationDecision(ctx);
    expect(decision.classification).not.toBe("STALE_OPERATION");
  });

  // =========================================================================
  // CENÁRIO 6: Operação incerta (UNCERTAIN/VERIFYING) -> NEEDS_VERIFICATION
  // =========================================================================
  it("Cenário 6: Operação ativa em estado UNCERTAIN/VERIFYING suspende decisão e exige verificação externa", () => {
    const ctx = buildTestContext({
      activeOperation: {
        operation_id: "op_uncertain_001",
        event_id: "evt_unc",
        record_id: "rec_mock_001",
        field_key: "identidade",
        target_key: "CONTROLE",
        target_revision: 1,
        state: "UNCERTAIN",
        lease_owner: "worker_1",
        lease_epoch: 2,
        lease_until: new Date(Date.now() + 60000).toISOString(),
        next_attempt_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const decision = evaluateReconciliationDecision(ctx);

    expect(decision.classification).toBe("NEEDS_VERIFICATION");
    expect(decision.causalityProven).toBe(false);
    expect(decision.actionRequired).toBe("VERIFY_EXTERNAL_EFFECT");
    expect(decision.details?.operationId).toBe("op_uncertain_001");
  });

  // =========================================================================
  // CENÁRIO 7: Snapshot duplicado/repetido -> IN_SYNC idempotente sem mutações órfãs
  // =========================================================================
  it("Cenário 7: Snapshot repetido com valores idênticos e âncora válida -> IN_SYNC idempotente", () => {
    const snapshot = buildValidExternalSnapshot({
      fieldKey: "cpf_documento",
      cellCoordinate: "D2",
      rawValue: "SIM",
      normalizedValue: 1,
    });

    const ctx = buildTestContext({
      fieldKey: "cpf_documento",
      localState: {
        recordId: "rec_mock_c7",
        fieldKey: "cpf_documento",
        revision: 1,
        value: 1,
        status: "CONFIRMED",
        headCommandId: "cmd_c7",
        baselineCommandId: "cmd_0",
        updatedAt: new Date().toISOString(),
      },
      receiptAnchor: {
        receiptId: "rcpt_c7_1",
        operationId: "op_c7_1",
        targetKey: "CONTROLE",
        revision: 1,
        confirmedValue: 1,
        observedAt: new Date().toISOString(),
      },
      currentExternal: snapshot,
    });

    const decision1 = evaluateReconciliationDecision(ctx);
    const decision2 = evaluateReconciliationDecision(ctx);

    expect(decision1.classification).toBe("IN_SYNC");
    expect(decision1.causalityProven).toBe(true);
    expect(decision1.actionRequired).toBe("NONE");
    expect(decision2.classification).toBe("IN_SYNC");
  });

  // =========================================================================
  // CENÁRIO 8: RA não canônico ou ambíguo -> Bloqueio com UNKNOWN e ABORT_QUARANTINE
  // =========================================================================
  it("Cenário 8: RA não canônico ou ambíguo bloqueia imediatamente a reconciliação", () => {
    const ctxInvalidRa = buildTestContext({
      raText: "  RA-12345  ",
    });

    const decision = evaluateReconciliationDecision(ctxInvalidRa);

    expect(decision.classification).toBe("UNKNOWN");
    expect(decision.causalityProven).toBe(false);
    expect(decision.actionRequired).toBe("ABORT_QUARANTINE");
    expect(decision.reason).toContain("Identidade inválida: RA");
  });

  // =========================================================================
  // CENÁRIO 9: Leitura de snapshot com valor nulo suspende com UNKNOWN
  // =========================================================================
  it("Cenário 9: Leitura de snapshot sem valor válido suspende com UNKNOWN", () => {
    const ctxCorruptSnapshot = buildTestContext({
      currentExternal: {
        targetKey: "CONTROLE",
        rawValue: "???",
        normalizedValue: null,
        cellCoordinate: "C2",
        headerFingerprint: "IDENTIDADE::CPF",
        observedAt: new Date().toISOString(),
      },
    });

    const decision = evaluateReconciliationDecision(ctxCorruptSnapshot);

    expect(decision.classification).toBe("UNKNOWN");
    expect(decision.causalityProven).toBe(false);
    expect(decision.actionRequired).toBe("NONE");
    expect(decision.reason).toContain("Observação externa ausente ou valor da célula é desconhecido");
  });

  // =========================================================================
  // CENÁRIO 10: Campo não inicializado/unbaselined suspende reconciliação
  // =========================================================================
  it("Cenário 10: Campo não inicializado/unbaselined suspende reconciliação até baseline explícito", () => {
    const ctxUnbaselined = buildTestContext({
      localState: {
        recordId: "rec_mock_c10",
        fieldKey: "certidao",
        revision: 0,
        value: null,
        status: "UNBASELINED",
        headCommandId: null,
        baselineCommandId: null,
        updatedAt: new Date().toISOString(),
      },
    });

    const decision = evaluateReconciliationDecision(ctxUnbaselined);

    expect(decision.classification).toBe("UNKNOWN");
    expect(decision.causalityProven).toBe(false);
    expect(decision.reason).toContain("Exige baseline explícito");
  });

  // =========================================================================
  // CENÁRIO 11: Mesmo RA em FACE_FEA e FCH_EAD -> Isolamento total de reconciliação
  // =========================================================================
  it("Cenário 11: Mesmo RA em grupos acadêmicos diferentes mantém reconciliação e conflitos 100% isolados", async () => {
    const raCompartilhado = "00099901";
    const alunoId = await criarAlunoFicticio(raCompartilhado, "Aluno Compartilhado Conflito");

    const recordFaceId = `rec_f3_c11_face_${raCompartilhado}`;
    const recordFchId = `rec_f3_c11_fch_${raCompartilhado}`;

    await initSyncRecord(env.DB, {
      recordId: recordFaceId,
      integrationId: integrationFaceId,
      alunoId,
      raText: raCompartilhado,
      groupKey: "FACE_FEA",
    });

    await initSyncRecord(env.DB, {
      recordId: recordFchId,
      integrationId: integrationFchId,
      alunoId,
      raText: raCompartilhado,
      groupKey: "FCH_EAD",
    });

    expect(recordFaceId).not.toBe(recordFchId);

    const fakeConflictDecisionFace = {
      classification: "CONFLICT" as const,
      targetKey: "CONTROLE" as const,
      fieldKey: "contrato" as const,
      recordId: recordFaceId,
      reason: "Conflito simulado no grupo FACE_FEA",
      causalityProven: false,
      actionRequired: "RECORD_CONFLICT" as const,
    };

    const resConflict = await recordTargetConflict(env.DB, fakeConflictDecisionFace, {
      localRevision: 1,
      localValue: 1,
      externalValue: 0,
      evidencePayload: "ev_face_001",
    });

    expect(resConflict.recorded).toBe(true);

    const conflictsFace = await env.DB.prepare(
      `SELECT * FROM sync_conflicts WHERE record_id = ?`
    )
      .bind(recordFaceId)
      .all();
    expect(conflictsFace.results.length).toBe(1);

    const conflictsFch = await env.DB.prepare(
      `SELECT * FROM sync_conflicts WHERE record_id = ?`
    )
      .bind(recordFchId)
      .all();
    expect(conflictsFch.results.length).toBe(0);
  });

  // =========================================================================
  // CENÁRIO 12: Concorrência entre duas reconciliações no D1 -> Idempotência de recordTargetConflict
  // =========================================================================
  it("Cenário 12: Tentativa concorrente de registrar conflito com mesma chave UNIQUE é idempotente", async () => {
    const ra = "00099902";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Concorrente");
    const recordId = `rec_f3_c12_${ra}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId: integrationFaceId,
      alunoId,
      raText: ra,
      groupKey: "FACE_FEA",
    });

    const decision = {
      classification: "CONFLICT" as const,
      targetKey: "CONTROLE" as const,
      fieldKey: "identidade" as const,
      recordId,
      reason: "Conflito concorrente para teste de idempotência",
      causalityProven: false,
      actionRequired: "RECORD_CONFLICT" as const,
    };

    const first = await recordTargetConflict(env.DB, decision, {
      localRevision: 1,
      localValue: 1,
      externalValue: 0,
    });
    expect(first.recorded).toBe(true);

    const second = await recordTargetConflict(env.DB, decision, {
      localRevision: 1,
      localValue: 1,
      externalValue: 0,
    });
    expect(second.recorded).toBe(false);
    expect(second.conflictId).toBe(first.conflictId);
  });

  // =========================================================================
  // CENÁRIO 13: Recuperação de queda após dispatch com verificação de efeito
  // =========================================================================
  it("Cenário 13: Recuperação de operação pós-timeout via verifyOperation e convergência para IN_SYNC", async () => {
    const ra = "00099903";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Queda Recuperacao");
    const recordId = `rec_f3_c13_${ra}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId: integrationFaceId,
      alunoId,
      raText: ra,
      groupKey: "FACE_FEA",
    });

    adapterFace.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
      {
        raText: ra,
        fields: { identidade: "NÃO" },
      },
    ]);

    const evidence0 = await adapterFace.generateProvenanceEvidence({
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      spreadsheetId: spreadsheetFaceId,
      tabName: "CONTROLE_FACE",
      raText: ra,
      fieldKey: "identidade",
      adapterSecret: secretKey,
    });

    const ev0Payload = JSON.stringify(evidence0);
    const ev0Digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ev0Payload));
    const ev0Hash = Array.from(new Uint8Array(ev0Digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const baseRes = await establishFieldBaseline(env.DB, {
      commandId: `cmd-f3-base-${crypto.randomUUID()}`,
      actorId: "worker:face_fea",
      recordId,
      fieldKey: "identidade",
      baselineValue: 0,
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
      evidence: {
        source: "SPREADSHEET_IMPORT",
        evidencePayload: ev0Payload,
        evidenceHash: ev0Hash,
      },
    });
    expect(baseRes.ok).toBe(true);

    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-f3-mut-${crypto.randomUUID()}`,
      actorId: "worker:face_fea",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    const pendingOp = await env.DB.prepare(
      `SELECT operation_id, state, lease_epoch FROM sync_operations
       WHERE record_id = ? AND field_key = 'identidade' AND target_key = 'CONTROLE'`
    )
      .bind(recordId)
      .first<{ operation_id: string; state: string; lease_epoch: number }>();
    expect(pendingOp).toBeDefined();

    const claimRes = await claimOperation(env.DB, {
      operationId: pendingOp!.operation_id,
      workerId: "worker:face_fea",
      leaseDurationSeconds: 60,
    });
    expect(claimRes.ok).toBe(true);
    if (!claimRes.ok) return;

    const dispatchRes = await dispatchOperation(env.DB, {
      operationId: pendingOp!.operation_id,
      workerId: "worker:face_fea",
      leaseEpoch: claimRes.leaseEpoch,
      payloadText: JSON.stringify({ target: "CONTROLE", value: 1 }),
    });
    expect(dispatchRes.ok).toBe(true);
    if (!dispatchRes.ok) return;

    const uncertainRes = await markUncertainOperation(env.DB, {
      operationId: pendingOp!.operation_id,
      workerId: "worker:face_fea",
      leaseEpoch: claimRes.leaseEpoch,
      attemptId: dispatchRes.attemptId,
      errorMessage: "Timeout de rede simulado",
    });
    expect(uncertainRes.ok).toBe(true);

    const snapUncertain = buildValidExternalSnapshot({
      raText: ra,
      rawValue: "SIM",
      normalizedValue: 1,
      cellCoordinate: "C2",
    });

    const ctxUncertain = await loadReconciliationTargetContext(env.DB, {
      recordId,
      fieldKey: "identidade",
      targetKey: "CONTROLE",
      currentExternal: snapUncertain,
    });
    expect(ctxUncertain).not.toBeNull();
    const decUncertain = evaluateReconciliationDecision(ctxUncertain!);
    expect(decUncertain.classification).toBe("NEEDS_VERIFICATION");

    const verifyRes = await verifyOperation(env.DB, {
      operationId: pendingOp!.operation_id,
      workerId: "worker:face_fea",
      leaseEpoch: claimRes.leaseEpoch,
    });
    expect(verifyRes.ok).toBe(true);
    if (!verifyRes.ok) return;

    const observeRes = await observeOperation(env.DB, {
      operationId: pendingOp!.operation_id,
      workerId: "worker:face_fea",
      leaseEpoch: verifyRes.leaseEpoch,
      targetRevision: 1,
      attemptId: verifyRes.attemptId,
      responsePayload: JSON.stringify({ updated: true }),
    });
    expect(observeRes.ok).toBe(true);

    const snapResolved = buildValidExternalSnapshot({
      raText: ra,
      rawValue: "SIM",
      normalizedValue: 1,
      cellCoordinate: "C2",
    });

    const ctxResolved = await loadReconciliationTargetContext(env.DB, {
      recordId,
      fieldKey: "identidade",
      targetKey: "CONTROLE",
      currentExternal: snapResolved,
    });
    expect(ctxResolved).not.toBeNull();
    const decResolved = evaluateReconciliationDecision(ctxResolved!);
    expect(decResolved.classification).toBe("IN_SYNC");
    expect(decResolved.causalityProven).toBe(true);
  });

  // =========================================================================
  // CENÁRIO 14: Condição A4 e D1 — Falha isolada e Resolução Administrativa Autenticada
  // =========================================================================
  it("Cenário 14 (Condições A4 e D1): Falha em GERAL_CONTRATO isolada e Resolução Administrativa Autenticada", async () => {
    const ra = "00099904";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Isolamento Alvo A4");
    const recordId = `rec_f3_c14_${ra}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId: integrationFaceId,
      alunoId,
      raText: ra,
      groupKey: "FACE_FEA",
    });

    adapterFace.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
      {
        raText: ra,
        fields: { contrato: "NÃO" },
      },
    ]);

    const evidence0 = await adapterFace.generateProvenanceEvidence({
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      spreadsheetId: spreadsheetFaceId,
      tabName: "CONTROLE_FACE",
      raText: ra,
      fieldKey: "contrato",
      adapterSecret: secretKey,
    });

    const ev0Payload = JSON.stringify(evidence0);
    const ev0Digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ev0Payload));
    const ev0Hash = Array.from(new Uint8Array(ev0Digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await establishFieldBaseline(env.DB, {
      commandId: `cmd-f3-base-c14-${crypto.randomUUID()}`,
      actorId: "worker:face_fea",
      recordId,
      fieldKey: "contrato",
      baselineValue: 0,
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
      evidence: {
        source: "SPREADSHEET_IMPORT",
        evidencePayload: ev0Payload,
        evidenceHash: ev0Hash,
      },
    });

    const cmdIdCtrl = `cmd_ctrl_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO sync_commands (
        command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
      ) VALUES (?, 'worker:face_fea', ?, 'contrato', 0, 1, 'req_hash_c14', 'ACCEPTED')`
    )
      .bind(cmdIdCtrl, recordId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_events (
        event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
      ) VALUES ('evt_ctrl_01', ?, 'contrato', ?, 0, 1, 0, 1, 'worker:face_fea')`
    )
      .bind(recordId, cmdIdCtrl)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (
        operation_id, event_id, record_id, field_key, target_key, target_revision, state
      ) VALUES ('op_ctrl_01', 'evt_ctrl_01', ?, 'contrato', 'CONTROLE', 1, 'OBSERVED')`
    )
      .bind(recordId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_receipts (
        receipt_id, command_id, operation_id, target_key, record_id, field_key, revision, status
      ) VALUES ('rcpt_ctrl_01', ?, 'op_ctrl_01', 'CONTROLE', ?, 'contrato', 1, 'OBSERVED')`
    )
      .bind(cmdIdCtrl, recordId)
      .run();

    await env.DB.prepare(
      `UPDATE sync_field_state SET revision = 1, value = 1, status = 'CONFIRMED'
       WHERE record_id = ? AND field_key = 'contrato'`
    )
      .bind(recordId)
      .run();

    const snapControle = buildValidExternalSnapshot({
      targetKey: "CONTROLE",
      fieldKey: "contrato",
      cellCoordinate: "I2",
      raText: ra,
      rawValue: "SIM",
      normalizedValue: 1,
    });

    const ctxControle = await loadReconciliationTargetContext(env.DB, {
      recordId,
      fieldKey: "contrato",
      targetKey: "CONTROLE",
      currentExternal: snapControle,
    });
    expect(ctxControle).not.toBeNull();
    const decControle = evaluateReconciliationDecision(ctxControle!);
    expect(decControle.classification).toBe("IN_SYNC");
    expect(decControle.causalityProven).toBe(true);

    const snapGeral = buildValidExternalSnapshot({
      targetKey: "GERAL_CONTRATO",
      fieldKey: "contrato",
      cellCoordinate: "A2",
      raText: ra,
      rawValue: "NÃO",
      normalizedValue: 0,
    });

    const ctxGeral = await loadReconciliationTargetContext(env.DB, {
      recordId,
      fieldKey: "contrato",
      targetKey: "GERAL_CONTRATO",
      currentExternal: snapGeral,
    });
    expect(ctxGeral).not.toBeNull();
    const decGeral = evaluateReconciliationDecision(ctxGeral!);
    expect(decGeral.classification).toBe("CONFLICT");

    const conflictRes = await recordTargetConflict(env.DB, decGeral, {
      localRevision: 1,
      localValue: 1,
      externalValue: 0,
    });
    expect(conflictRes.recorded).toBe(true);

    const conflictRows = await env.DB.prepare(
      `SELECT target_key FROM sync_conflicts WHERE record_id = ? AND field_key = 'contrato'`
    )
      .bind(recordId)
      .all<{ target_key: string }>();

    expect(conflictRows.results.length).toBe(1);
    expect(conflictRows.results[0].target_key).toBe("GERAL_CONTRATO");

    const fieldState = await env.DB.prepare(
      `SELECT status FROM sync_field_state WHERE record_id = ? AND field_key = 'contrato'`
    )
      .bind(recordId)
      .first<{ status: string }>();
    expect(fieldState?.status).toBe("CONFIRMED");

    // D1 / P1 — Resolução Administrativa Autenticada
    const credential = await generateAdminCredential({
      adminId: "admin:authorized",
      conflictId: conflictRes.conflictId,
      chosenResolution: "KEEP_LOCAL",
      expectedLocalRevision: 1,
      secret: secretKey,
    });
    const adminRes = await applyAdminConflictResolution(env.DB, {
      conflictId: conflictRes.conflictId,
      authCredential: credential,
      chosenResolution: "KEEP_LOCAL",
      justification: "Resolvido por auditor administrativo com escopo autenticado",
      expectedLocalRevision: 1,
    });
    expect(adminRes.success).toBe(true);

    const resolvedConflict = await env.DB.prepare(
      `SELECT resolved, resolution_action, resolution_actor_id FROM sync_conflicts WHERE conflict_id = ?`
    )
      .bind(conflictRes.conflictId)
      .first<{ resolved: number; resolution_action: string; resolution_actor_id: string }>();

    expect(resolvedConflict?.resolved).toBe(1);
    expect(resolvedConflict?.resolution_action).toBe("KEEP_LOCAL");
    expect(resolvedConflict?.resolution_actor_id).toBe("admin:authorized");
  });

  // =========================================================================
  // R1–R4 — TESTES DIRECIONADOS DE RESOLUÇÃO ADMINISTRATIVA (FECHAMENTO F3)
  // =========================================================================
  // =========================================================================
  // P1, P2 & R2–R4 — TESTES DIRECIONADOS DE RESOLUÇÃO ADMINISTRATIVA (FECHAMENTO F3)
  // =========================================================================
  describe("P1, P2 & R2–R4 — Resolução Administrativa Autenticada e Atomicidade CAS", () => {
    // -----------------------------------------------------------------------
    // P1: Autenticação Real da Identidade Administrativa na Fronteira do Servidor
    // -----------------------------------------------------------------------
    it("P1.1 (OBRIGATÓRIO) — Solicitante não autenticado informa o identificador de um administrador válido; rejeição imediata sem efeitos colaterais", async () => {
      const ra = "00099931";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.1");
      const recordId = `rec_p1_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.1",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Solicitante NÃO autenticado (sem authCredential) tenta usar o identificador de um admin válido ("admin:authorized")
      const resUnauthenticated = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        adminActorId: "admin:authorized",
        authorizedActorId: "admin:authorized",
        chosenResolution: "KEEP_LOCAL",
        justification: "Invasor tentando forjar admin válido sem credencial criptográfica",
        expectedLocalRevision: 0,
      });

      expect(resUnauthenticated.success).toBe(false);
      expect(resUnauthenticated.error).toBe("UNAUTHORIZED_ADMIN");

      // Verificação estrita de ausência de efeitos colaterais no D1:
      const cmds = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_commands WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(cmds?.cnt).toBe(0);

      const evts = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_events WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(evts?.cnt).toBe(0);

      const field = await env.DB.prepare(
        `SELECT revision, value FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ revision: number; value: number | null }>();
      expect(field?.revision).toBe(0);
      expect(field?.value).toBeNull();

      const conflict = await env.DB.prepare(
        `SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolved: number }>();
      expect(conflict?.resolved).toBe(0);
    });

    it("P1.2 (ADVERSARIAL) — Assinar KEEP_LOCAL e tentar executar ACCEPT_EXTERNAL com a mesma credencial: rejeitar", async () => {
      const ra = "00099932";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.2");
      const recordId = `rec_p1_2_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.2",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Administrador assina autorizando especificamente KEEP_LOCAL
      const credKeepLocal = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      // Atacante tenta usar a credencial de KEEP_LOCAL para forçar ACCEPT_EXTERNAL
      const resTampered = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: credKeepLocal,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Tentando sequestrar a credencial de KEEP_LOCAL para ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
      });

      expect(resTampered.success).toBe(false);
      expect(resTampered.error).toBe("UNAUTHORIZED_ADMIN");

      // Garante que o banco permaneceu intocado
      const field = await env.DB.prepare(
        `SELECT revision FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ revision: number }>();
      expect(field?.revision).toBe(0);
    });

    it("P1.3 (ADVERSARIAL) — Alterar a revisão esperada após a assinatura: rejeitar", async () => {
      const ra = "00099933";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.3");
      const recordId = `rec_p1_3_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.3",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Credencial assinada para expectedLocalRevision = 0
      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      // Chamador tenta executar passando expectedLocalRevision = 1
      const resTamperedRev = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Revisão alterada no comando",
        expectedLocalRevision: 1,
      });

      expect(resTamperedRev.success).toBe(false);
      expect(resTamperedRev.error).toBe("UNAUTHORIZED_ADMIN");
    });

    it("P1.4 (ADVERSARIAL) — Reutilizar a mesma credencial (replay do nonce): rejeitar", async () => {
      const ra = "00099934";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.4");
      const recordId = `rec_p1_4_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.4",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const fixedNonce = `nonce_test_replay_${crypto.randomUUID()}`;
      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
        nonce: fixedNonce,
      });

      // Primeira execução: aceita uma única vez
      const res1 = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Execução legítima única",
        expectedLocalRevision: 0,
      });
      expect(res1.success).toBe(true);

      // Comprova persistência correta do registro de nonce no schema real da migração:
      // (nonce, sender_id, integration_id, created_at, expires_at)
      const nonceRow = await env.DB.prepare(
        `SELECT nonce, sender_id, integration_id, created_at, expires_at FROM sync_auth_nonces WHERE nonce = ?`
      )
        .bind(fixedNonce)
        .first<{
          nonce: string;
          sender_id: string;
          integration_id: string;
          created_at: string;
          expires_at: string;
        }>();

      expect(nonceRow).not.toBeNull();
      expect(nonceRow?.nonce).toBe(fixedNonce);
      expect(nonceRow?.sender_id).toBe("admin:authorized");
      expect(nonceRow?.integration_id).toBe("admin_resolution");
      expect(nonceRow?.created_at).toBeDefined();
      expect(nonceRow?.expires_at).toBeDefined();

      // Segunda execução: replay com exatamente a mesma credencial (mesmo nonce já consumido no D1)
      const resReplay = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentativa de replay do mesmo nonce",
        expectedLocalRevision: 0,
      });
      expect(resReplay.success).toBe(false);
      expect(resReplay.error).toBe("UNAUTHORIZED_ADMIN");
    });

    it("P1.5 (ADVERSARIAL) — Utilizar timestamp expirado: rejeitar", async () => {
      const ra = "00099935";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.5");
      const recordId = `rec_p1_5_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.5",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Timestamp com mais de 10 minutos no passado (janela padrão: 300 segundos)
      const expiredTimestamp = Date.now() - 700 * 1000;
      const credExpired = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
        timestamp: expiredTimestamp,
      });

      const resExpired = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: credExpired,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentativa com credencial expirada",
        expectedLocalRevision: 0,
      });

      expect(resExpired.success).toBe(false);
      expect(resExpired.error).toBe("UNAUTHORIZED_ADMIN");
    });

    it("P1.6 (ADVERSARIAL) — Apresentar credencial de administrador revogado: rejeitar", async () => {
      const ra = "00099936";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.6");
      const recordId = `rec_p1_6_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.6",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Admin com status REVOKED no servidor assinando com sua chave legítima
      const credRevoked = await generateAdminCredential({
        adminId: "admin:revoked",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const resRevoked = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: credRevoked,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentativa de admin revogado",
        expectedLocalRevision: 0,
      });

      expect(resRevoked.success).toBe(false);
      expect(resRevoked.error).toBe("UNAUTHORIZED_ADMIN");
    });

    it("P1.7 — Executar resolução legítima: aceitar uma única vez e registrar a identidade autenticada no D1", async () => {
      const ra = "00099937";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P1.7");
      const recordId = `rec_p1_7_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste P1.7",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Credencial autenticada de "admin:authorized", mas o payload declara "admin:outro_nome_ficticio"
      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        adminActorId: "admin:outro_nome_ficticio",
        authorizedActorId: "admin:outro_nome_ficticio",
        chosenResolution: "KEEP_LOCAL",
        justification: "Teste de procedência do ator autenticado",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(true);
      expect(res.authenticatedActorId).toBe("admin:authorized");

      // Confere que no banco o resolution_actor_id é a identidade autenticada
      const row = await env.DB.prepare(
        `SELECT resolution_actor_id FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolution_actor_id: string }>();

      expect(row?.resolution_actor_id).toBe("admin:authorized");
      expect(row?.resolution_actor_id).not.toBe("admin:outro_nome_ficticio");
    });

    // -----------------------------------------------------------------------
    // P2: Atomicidade Efetiva do CAS (ACCEPT_EXTERNAL)
    // -----------------------------------------------------------------------
    it("P2.1 (OBRIGATÓRIO) — CAS com revisão obsoleta em ACCEPT_EXTERNAL não persiste comando, evento, outbox ou resolução (Rollback Total D1)", async () => {
      const ra = "00099938";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P2.1");
      const recordId = `rec_p2_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste de atomicidade CAS",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Simula concorrência que avança a revisão do campo no banco para 1 antes da resolução
      await env.DB.prepare(
        `UPDATE sync_field_state SET revision = 1, value = 1 WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .run();

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const resStale = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Tentativa de aceitar com revisão obsoleta",
        expectedLocalRevision: 0,
      });

      expect(resStale.success).toBe(false);
      expect(["STALE_RESOLUTION_TARGET", "STALE_REVISION_CAS_FAILED", "CONCURRENT_RESOLUTION_CONFLICT"]).toContain(
        resStale.error
      );

      // Verificação mandatória: NENHUM comando, evento ou outbox foi persistido no D1
      const cmds = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_commands WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(cmds?.cnt).toBe(0);

      const evts = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_events WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(evts?.cnt).toBe(0);

      const ops = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_operations WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(ops?.cnt).toBe(0);

      const conflict = await env.DB.prepare(
        `SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolved: number }>();
      expect(conflict?.resolved).toBe(0);
    });

    it("P2.2 (OBRIGATÓRIO) — Duas resoluções ACCEPT_EXTERNAL concorrentes: somente uma vence, segunda sofre rollback integral", async () => {
      const ra = "00099939";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P2.2");
      const recordId = `rec_p2_2_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para corrida concorrente",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cred1 = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const cred2 = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      // Primeira resolução vence
      const res1 = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred1,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Primeira resolução vencedora",
        expectedLocalRevision: 0,
      });
      expect(res1.success).toBe(true);

      // Segunda resolução tenta aplicar concorrentemente sobre a mesma revisão 0
      const res2 = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred2,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Segunda resolução atrasada",
        expectedLocalRevision: 0,
      });
      expect(res2.success).toBe(false);
      expect(["ALREADY_RESOLVED", "STALE_REVISION_CAS_FAILED", "CONCURRENT_RESOLUTION_CONFLICT", "STALE_RESOLUTION_TARGET"]).toContain(
        res2.error
      );

      // Verifica que no banco existe exatamente 1 comando e 1 evento
      const cmds = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_commands WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(cmds?.cnt).toBe(1);

      const evts = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sync_events WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ cnt: number }>();
      expect(evts?.cnt).toBe(1);

      const field = await env.DB.prepare(
        `SELECT revision FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ revision: number }>();
      expect(field?.revision).toBe(1);
    });

    it("P2.3 & P2.4 (OBRIGATÓRIO) — Resolução legítima mantém comando, evento, revisão e outbox coerentes e atômicos", async () => {
      const ra = "00099940";
      const alunoId = await criarAlunoFicticio(ra, "Aluno P2.3");
      const recordId = `rec_p2_3_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito legítimo",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Resolução atômica comprovada",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(true);
      expect(res.commandId).toBeDefined();
      expect(res.eventId).toBeDefined();

      const cmdRow = await env.DB.prepare(`SELECT * FROM sync_commands WHERE command_id = ?`)
        .bind(res.commandId)
        .first<{ actor_id: string; proposed_value: number; status: string }>();
      expect(cmdRow?.actor_id).toBe("admin:authorized");
      expect(cmdRow?.proposed_value).toBe(1);
      expect(cmdRow?.status).toBe("ACCEPTED");

      const evtRow = await env.DB.prepare(`SELECT * FROM sync_events WHERE event_id = ?`)
        .bind(res.eventId)
        .first<{ from_revision: number; to_revision: number; value_new: number; actor_id: string }>();
      expect(evtRow?.from_revision).toBe(0);
      expect(evtRow?.to_revision).toBe(1);
      expect(evtRow?.value_new).toBe(1);
      expect(evtRow?.actor_id).toBe("admin:authorized");

      const fieldRow = await env.DB.prepare(
        `SELECT revision, value, status, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ revision: number; value: number; status: string; head_command_id: string }>();
      expect(fieldRow?.revision).toBe(1);
      expect(fieldRow?.value).toBe(1);
      expect(fieldRow?.status).toBe("CONFIRMED");
      expect(fieldRow?.head_command_id).toBe(res.commandId);

      const conflictRow = await env.DB.prepare(
        `SELECT resolved, resolution_action, resolution_actor_id FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolved: number; resolution_action: string; resolution_actor_id: string }>();
      expect(conflictRow?.resolved).toBe(1);
      expect(conflictRow?.resolution_action).toBe("ACCEPT_EXTERNAL");
      expect(conflictRow?.resolution_actor_id).toBe("admin:authorized");
    });

    // -----------------------------------------------------------------------
    // R2: Outbox da Resolução ACCEPT_EXTERNAL e Preservação Causal F1-A
    // -----------------------------------------------------------------------
    it("R2.1 — Resolução ACCEPT_EXTERNAL para 'contrato' com conflito originado em CONTROLE gera outbox exclusivamente para GERAL_CONTRATO (sem propagação de retorno para CONTROLE)", async () => {
      const ra = "00099941";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R2.1");
      const recordId = `rec_r2_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "contrato" as const,
          recordId,
          reason: "Conflito em contrato originado em CONTROLE",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Aceitando contrato vindo da aba CONTROLE",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(true);
      expect(res.outboxOperationIds).toHaveLength(1);

      const ops = await env.DB.prepare(
        `SELECT target_key, state, target_revision FROM sync_operations WHERE event_id = ?`
      )
        .bind(res.eventId)
        .all<{ target_key: string; state: string; target_revision: number }>();

      expect(ops.results).toHaveLength(1);
      expect(ops.results[0].target_key).toBe("GERAL_CONTRATO");
      expect(ops.results[0].state).toBe("PENDING");
      expect(ops.results[0].target_revision).toBe(1);

      const opControle = ops.results.find((o) => o.target_key === "CONTROLE");
      expect(opControle).toBeUndefined();
    });

    it("R2.2 — Resolução ACCEPT_EXTERNAL para 'contrato' com conflito originado em GERAL_CONTRATO gera outbox exclusivamente para CONTROLE (sem propagação de retorno para GERAL_CONTRATO)", async () => {
      const ra = "00099942";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R2.2");
      const recordId = `rec_r2_2_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "GERAL_CONTRATO" as const,
          fieldKey: "contrato" as const,
          recordId,
          reason: "Conflito em contrato originado em GERAL_CONTRATO",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Aceitando contrato vindo da aba Geral Contrato",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(true);
      expect(res.outboxOperationIds).toHaveLength(1);

      const ops = await env.DB.prepare(
        `SELECT target_key, state, target_revision FROM sync_operations WHERE event_id = ?`
      )
        .bind(res.eventId)
        .all<{ target_key: string; state: string; target_revision: number }>();

      expect(ops.results).toHaveLength(1);
      expect(ops.results[0].target_key).toBe("CONTROLE");
      expect(ops.results[0].state).toBe("PENDING");
      expect(ops.results[0].target_revision).toBe(1);

      const opGeral = ops.results.find((o) => o.target_key === "GERAL_CONTRATO");
      expect(opGeral).toBeUndefined();
    });

    it("R2.3 — Resolução ACCEPT_EXTERNAL para campo simples não gera propagação de retorno desnecessária para CONTROLE", async () => {
      const ra = "00099943";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R2.3");
      const recordId = `rec_r2_3_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito simples em CONTROLE",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Aceitando identidade vinda de CONTROLE",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(true);
      expect(res.outboxOperationIds).toHaveLength(0);

      const ops = await env.DB.prepare(
        `SELECT target_key FROM sync_operations WHERE event_id = ?`
      )
        .bind(res.eventId)
        .all<{ target_key: string }>();

      expect(ops.results).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // R3: Rejeição de Valor Desconhecido (Sem fallback ?? 0)
    // -----------------------------------------------------------------------
    it("R3.1 — Rejeita ACCEPT_EXTERNAL quando external_value for nulo ou não for conclusivamente 0 ou 1", async () => {
      const ra = "00099944";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R3.1");
      const recordId = `rec_r3_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Valor externo inconclusivo",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: null }
      );

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "ACCEPT_EXTERNAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const res = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "ACCEPT_EXTERNAL",
        justification: "Tentativa de aceitar valor nulo",
        expectedLocalRevision: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("INVALID_EXTERNAL_VALUE");

      const fieldState = await env.DB.prepare(
        `SELECT revision, value FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ revision: number; value: number | null }>();

      expect(fieldState?.revision).toBe(0);
      expect(fieldState?.value).toBeNull();

      const conflictRow = await env.DB.prepare(
        `SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolved: number }>();
      expect(conflictRow?.resolved).toBe(0);
    });

    // -----------------------------------------------------------------------
    // R4: Concorrência no KEEP_LOCAL e Vinculação Atômica à Revisão Atual
    // -----------------------------------------------------------------------
    it("R4.1 — Alteração concorrente da revisão no D1 impede a conclusão da resolução KEEP_LOCAL atomicamente", async () => {
      const ra = "00099945";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R4.1");
      const recordId = `rec_r4_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste de concorrência KEEP_LOCAL",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      // Simula mutação concorrente incrementando a revisão do campo para 1
      await env.DB.prepare(
        `UPDATE sync_field_state SET revision = 1, value = 1 WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .run();

      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const resStale = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentando manter local mas revisão foi alterada concorrentemente",
        expectedLocalRevision: 0,
      });

      expect(resStale.success).toBe(false);
      expect(["STALE_RESOLUTION_TARGET", "CONCURRENT_RESOLUTION_CONFLICT"]).toContain(resStale.error);

      const conflictRow = await env.DB.prepare(
        `SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cRes.conflictId)
        .first<{ resolved: number }>();
      expect(conflictRow?.resolved).toBe(0);
    });

    it("R4.2 — Idempotência e isolamento por alvo: KEEP_LOCAL resolve alvo específico e segunda resolução retorna ALREADY_RESOLVED", async () => {
      const ra = "00099946";
      const alunoId = await criarAlunoFicticio(ra, "Aluno R4.2");
      const recordId = `rec_r4_2_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cResControle = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "contrato" as const,
          recordId,
          reason: "Conflito CONTROLE",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const cResGeral = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "GERAL_CONTRATO" as const,
          fieldKey: "contrato" as const,
          recordId,
          reason: "Conflito GERAL_CONTRATO",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const credControle = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cResControle.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      // Resolve o conflito de CONTROLE
      const res1 = await applyAdminConflictResolution(env.DB, {
        conflictId: cResControle.conflictId,
        authCredential: credControle,
        chosenResolution: "KEEP_LOCAL",
        justification: "Baixa legítima de CONTROLE",
        expectedLocalRevision: 0,
      });
      expect(res1.success).toBe(true);

      // Garante isolamento: o conflito de GERAL_CONTRATO continua não-resolvido
      const rowGeral = await env.DB.prepare(
        `SELECT resolved FROM sync_conflicts WHERE conflict_id = ?`
      )
        .bind(cResGeral.conflictId)
        .first<{ resolved: number }>();
      expect(rowGeral?.resolved).toBe(0);

      // Idempotência: segunda tentativa sobre o mesmo conflito (com novo nonce) retorna ALREADY_RESOLVED
      const credRepeat = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cResControle.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
      });

      const resIdempotent = await applyAdminConflictResolution(env.DB, {
        conflictId: cResControle.conflictId,
        authCredential: credRepeat,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentativa repetida",
        expectedLocalRevision: 0,
      });
      expect(resIdempotent.success).toBe(false);
      expect(resIdempotent.error).toBe("ALREADY_RESOLVED");
    });
  });

  // =========================================================================
  // D2 — TESTES ADVERSARIAIS: RECIBO SEM VALOR COMPROVADO (AUDITORIA D2)
  // =========================================================================
  describe("D2 — Testes Adversariais de Recibo sem Valor Comprovado", () => {
    it("D2.1 — Recibo órfão sem evento correspondente em sync_events não assume fallback ?? 0 e suspende com UNKNOWN", async () => {
      const ra = "00099909";
      const alunoId = await criarAlunoFicticio(ra, "Aluno D2.1");
      const recordId = `rec_d2_1_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      // Cria um comando de teste
      const cmdId = `cmd_d2_${crypto.randomUUID()}`;
      await env.DB.prepare(
        `INSERT INTO sync_commands (
          command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
        ) VALUES (?, 'worker:test', ?, 'identidade', 0, 1, 'hash_d2', 'ACCEPTED')`
      )
        .bind(cmdId, recordId)
        .run();

      // Insere um recibo OBSERVED sem inserir o evento correspondente em sync_events (recibo órfão!)
      await env.DB.prepare(
        `INSERT INTO sync_receipts (
          receipt_id, command_id, operation_id, target_key, record_id, field_key, revision, status
        ) VALUES ('rcpt_orfao_01', ?, NULL, 'CONTROLE', ?, 'identidade', 1, 'OBSERVED')`
      )
        .bind(cmdId, recordId)
        .run();

      // Atualiza o estado local para CONFIRMED na revisão 1
      await env.DB.prepare(
        `UPDATE sync_field_state SET revision = 1, value = 1, status = 'CONFIRMED'
         WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .run();

      const snap = buildValidExternalSnapshot({
        raText: ra,
        cellCoordinate: "C2",
        rawValue: "SIM",
        normalizedValue: 1,
      });

      const ctx = await loadReconciliationTargetContext(env.DB, {
        recordId,
        fieldKey: "identidade",
        targetKey: "CONTROLE",
        currentExternal: snap,
      });

      expect(ctx).not.toBeNull();
      // D2: receiptAnchor deve ser NULO e unverifiedReceipt deve estar preenchido
      expect(ctx!.receiptAnchor).toBeNull();
      expect(ctx!.unverifiedReceipt).not.toBeNull();
      expect(ctx!.unverifiedReceipt?.reason).toContain("não possui evento correspondente com valor comprovado");

      // Avaliação determinística: suspende como UNKNOWN
      const decision = evaluateReconciliationDecision(ctx!);
      expect(decision.classification).toBe("UNKNOWN");
      expect(decision.causalityProven).toBe(false);
      expect(decision.reason).toContain("Recibo órfão ou sem valor comprovado");
    });
  });

  // =========================================================================
  // D3 — TESTES ADVERSARIAIS: AUTENTICIDADE E IDENTIDADE DO SNAPSHOT (AUDITORIA D3)
  // =========================================================================
  describe("D3 — Testes Adversariais de Autenticidade e Identidade do Snapshot", () => {
    it("D3.1 — Snapshot fabricado com RA de outro aluno é rejeitado e não gera APPLY_EXTERNAL_MUTATION", () => {
      const snapOtherRa = buildValidExternalSnapshot({
        raText: "00099999", // RA forjado na evidência!
        tamperedEvidence: {
          raText: "00099999",
        },
      });

      const ctx = buildTestContext({
        raText: "00012345", // Aluno real
        currentExternal: snapOtherRa,
      });

      const decision = evaluateReconciliationDecision(ctx);
      expect(decision.classification).toBe("UNKNOWN");
      expect(decision.causalityProven).toBe(false);
      expect(decision.reason).toContain("Evidência de outro aluno: RA da evidência '00099999' diverge");
      expect(decision.actionRequired).not.toBe("APPLY_EXTERNAL_MUTATION");
    });

    it("D3.2 — Snapshot fabricado com grupo acadêmico incompatível é rejeitado", () => {
      const snapWrongGroup = buildValidExternalSnapshot({
        groupKey: "FCH_EAD", // Grupo forjado!
        tamperedEvidence: {
          groupKey: "FCH_EAD",
        },
      });

      const ctx = buildTestContext({
        groupKey: "FACE_FEA", // Grupo esperado
        currentExternal: snapWrongGroup,
      });

      const decision = evaluateReconciliationDecision(ctx);
      expect(decision.classification).toBe("UNKNOWN");
      expect(decision.causalityProven).toBe(false);
      expect(decision.reason).toContain("groupKey 'FCH_EAD' diverge do contexto 'FACE_FEA'");
    });

    it("D3.3 — Snapshot sem evidência de proveniência criptográfica é rejeitado", () => {
      const snapNoEvidence = buildValidExternalSnapshot({
        withoutEvidence: true,
      });

      const ctx = buildTestContext({
        currentExternal: snapNoEvidence,
      });

      const decision = evaluateReconciliationDecision(ctx);
      expect(decision.classification).toBe("UNKNOWN");
      expect(decision.causalityProven).toBe(false);
      expect(decision.reason).toContain("Snapshot externo sem evidência de proveniência");
      expect(decision.actionRequired).not.toBe("APPLY_EXTERNAL_MUTATION");
    });

    it("D3.4 — Snapshot com coordenadas fora dos limites de controle (C:I) é rejeitado", () => {
      const snapWrongCoordinate = buildValidExternalSnapshot({
        targetKey: "CONTROLE",
        fieldKey: "identidade", // Deveria ser coluna C
        cellCoordinate: "A2", // Coluna A não autorizada para CONTROLE!
        tamperedEvidence: {
          cellCoordinate: "A2",
        },
      });

      const ctx = buildTestContext({
        targetKey: "CONTROLE",
        fieldKey: "identidade",
        currentExternal: snapWrongCoordinate,
      });

      const decision = evaluateReconciliationDecision(ctx);
      expect(decision.classification).toBe("UNKNOWN");
      expect(decision.causalityProven).toBe(false);
      expect(decision.reason).toContain("Layout/coordenada inválida: campo 'identidade' no alvo CONTROLE exige coluna 'C'");
    });
  });

  // =========================================================================
  // F3 — VERIFICAÇÃO DE COMPATIBILIDADE DO ANTI-REPLAY (SCHEMA REAL DA MIGRAÇÃO)
  // =========================================================================
  describe("F3 — Compatibilidade do Anti-Replay com o Schema Efetivo da Migração", () => {
    it("deve comprovar aceitação da 1ª credencial, rejeição do mesmo nonce na 2ª tentativa e persistência exata no schema real (sender_id, integration_id, expires_at)", async () => {
      // 1. Valida diretamente que a tabela sync_auth_nonces criada pela migração 011_sync_v2.sql
      // possui exatamente as colunas reais: nonce, sender_id, integration_id, created_at, expires_at
      const tableInfo = await env.DB.prepare(`PRAGMA table_info(sync_auth_nonces)`).all<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>();

      const colNames = tableInfo.results.map((c) => c.name);
      expect(colNames).toContain("nonce");
      expect(colNames).toContain("sender_id");
      expect(colNames).toContain("integration_id");
      expect(colNames).toContain("created_at");
      expect(colNames).toContain("expires_at");
      // Não deve possuir a coluna incompatível used_by_actor_id
      expect(colNames).not.toContain("used_by_actor_id");

      // 2. Prepara cenário com aluno, registro e conflito real
      const ra = "00099955";
      const alunoId = await criarAlunoFicticio(ra, "Aluno Schema Real Nonce");
      const recordId = `rec_real_nonce_${ra}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        alunoId,
        raText: ra,
        groupKey: "FACE_FEA",
      });

      const cRes = await recordTargetConflict(
        env.DB,
        {
          classification: "CONFLICT" as const,
          targetKey: "CONTROLE" as const,
          fieldKey: "identidade" as const,
          recordId,
          reason: "Conflito para teste de schema real do anti-replay",
          causalityProven: false,
          actionRequired: "RECORD_CONFLICT" as const,
        },
        { localRevision: 0, localValue: 0, externalValue: 1 }
      );

      const realNonce = `nonce_migration_compat_${crypto.randomUUID()}`;
      const cred = await generateAdminCredential({
        adminId: "admin:authorized",
        conflictId: cRes.conflictId,
        chosenResolution: "KEEP_LOCAL",
        expectedLocalRevision: 0,
        secret: secretKey,
        nonce: realNonce,
      });

      // 1. Primeira credencial válida aceita
      const res1 = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Resolução para validação de schema real",
        expectedLocalRevision: 0,
      });
      expect(res1.success).toBe(true);

      // 3. Persistência correta do registro de nonce no schema real da migração
      const persistedNonce = await env.DB.prepare(
        `SELECT nonce, sender_id, integration_id, created_at, expires_at
         FROM sync_auth_nonces
         WHERE nonce = ?`
      )
        .bind(realNonce)
        .first<{
          nonce: string;
          sender_id: string;
          integration_id: string;
          created_at: string;
          expires_at: string;
        }>();

      expect(persistedNonce).not.toBeNull();
      expect(persistedNonce?.nonce).toBe(realNonce);
      expect(persistedNonce?.sender_id).toBe("admin:authorized");
      expect(persistedNonce?.integration_id).toBe("admin_resolution");
      expect(persistedNonce?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(persistedNonce?.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // 2. Mesmo nonce rejeitado na segunda tentativa (Replay bloqueado atomicamente)
      const resReplay = await applyAdminConflictResolution(env.DB, {
        conflictId: cRes.conflictId,
        authCredential: cred,
        chosenResolution: "KEEP_LOCAL",
        justification: "Tentativa de reutilização do mesmo nonce",
        expectedLocalRevision: 0,
      });
      expect(resReplay.success).toBe(false);
      expect(resReplay.error).toBe("UNAUTHORIZED_ADMIN");
    });
  });
});

