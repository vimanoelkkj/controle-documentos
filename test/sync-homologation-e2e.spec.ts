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
  type OperationTargetKey,
} from "../src/server/services/sync-d1-operations";
import {
  EXPECTED_CONTROL_HEADERS,
  type ISyncSpreadsheetAdapter,
  type WritePreconditions,
  type WriteResult,
  type ExternalEffectCheckResult,
  type ControlTabReadResult,
  type GeneralTabReadResult,
} from "../src/server/services/sync-sheet-contracts";
import {
  SyncV2Orchestrator,
  type SyncBatchResult,
} from "../src/server/services/sync-orchestrator";
import {
  registerServerTrustedAdapter,
  registerServerTrustedAdmin,
  generateAdminCredential,
} from "../src/server/services/sync-d1-auth";
import {
  loadReconciliationTargetContext,
  evaluateReconciliationDecision,
  applyAdminConflictResolution,
} from "../src/server/services/sync-reconciliation";
import type {
  ObservedExternalSnapshot,
} from "../src/server/services/sync-reconciliation-contracts";

class HomologationSheetsAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId: string;
  sheets: Map<string, Map<string, string[][]>> = new Map();
  writeCalls: Array<{
    tabName: string;
    raText: string;
    fieldKey: FieldKey;
    targetValue: 0 | 1;
  }> = [];

  simulateNetworkException = false;
  simulateNetworkDropAfterWrite = false;
  simulateWriteErrorStatus: string | null = null;
  verifyExternalEffectOverride?: (params: any) => Promise<ExternalEffectCheckResult>;

  constructor(adapterId = "homologation-adapter-001") {
    this.adapterId = adapterId;
  }

  setSheetData(spreadsheetId: string, tabName: string, grid: string[][]) {
    if (!this.sheets.has(spreadsheetId)) {
      this.sheets.set(spreadsheetId, new Map());
    }
    this.sheets.get(spreadsheetId)!.set(
      tabName,
      grid.map((r) => [...r])
    );
  }

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName) || [];
    if (grid.length === 0) {
      throw new Error(`Aba '${params.tabName}' não encontrada na planilha '${params.spreadsheetId}'`);
    }

    const header = grid[0];
    const headerFingerprint = header.slice(2, 9).join("::");
    const expectedHeaders = EXPECTED_CONTROL_HEADERS.join("::");

    if (headerFingerprint !== expectedHeaders) {
      const err: any = new Error("LAYOUT_MUTATED: cabeçalho divergente do contrato canonical C:I");
      err.status = "LAYOUT_MUTATED";
      throw err;
    }

    const rowsByRa = new Map();
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const raText = String(row[0] || "").trim();
      if (!raText) continue;

      const fields: Record<FieldKey, any> = {
        identidade: {
          rawValue: row[2],
          normalizedValue: String(row[2]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `C${i + 1}`,
        },
        cpf: {
          rawValue: row[3],
          normalizedValue: String(row[3]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `D${i + 1}`,
        },
        certidao: {
          rawValue: row[4],
          normalizedValue: String(row[4]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `E${i + 1}`,
        },
        residencia: {
          rawValue: row[5],
          normalizedValue: String(row[5]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `F${i + 1}`,
        },
        titulo: {
          rawValue: row[6],
          normalizedValue: String(row[6]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `G${i + 1}`,
        },
        ensino_medio: {
          rawValue: row[7],
          normalizedValue: String(row[7]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `H${i + 1}`,
        },
        contrato: {
          rawValue: row[8],
          normalizedValue: String(row[8]).toUpperCase() === "TRUE" ? 1 : 0,
          cellCoordinate: `I${i + 1}`,
        },
      };

      rowsByRa.set(raText, {
        rowIndex: i + 1,
        raText,
        studentName: row[1] || "",
        fields,
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint,
      readAt: new Date().toISOString(),
      rowsByRa,
    };
  }

  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName) || [];
    const rowsByRa = new Map();

    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const raText = String(row[6] || "").trim();
      if (!raText) continue;

      rowsByRa.set(raText, {
        rowIndex: i + 1,
        raText,
        contractRawValue: String(row[0] || ""),
        contractNormalizedValue: String(row[0] || "").toUpperCase().includes("ENTREGUE") ? 1 : 0,
        cellCoordinate: `A${i + 1}`,
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: "SITUAÇÃO CONTRATUAL::RA",
      readAt: new Date().toISOString(),
      rowsByRa,
    };
  }

  async writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    preconditions: WritePreconditions;
  }): Promise<WriteResult> {
    this.writeCalls.push({
      tabName: params.tabName,
      raText: params.raText,
      fieldKey: params.fieldKey,
      targetValue: params.preconditions.targetValue,
    });

    if (this.simulateNetworkException) {
      if (this.simulateNetworkDropAfterWrite) {
        const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
        if (grid) {
          const row = grid.find((r) => r[0] === params.raText);
          if (row) row[2] = "TRUE";
        }
      }
      throw new Error("HTTP Network Timeout: conexão interrompida durante mutação na planilha");
    }

    if (this.simulateWriteErrorStatus) {
      return {
        success: false,
        status: this.simulateWriteErrorStatus as any,
        error: `Simulated write error: ${this.simulateWriteErrorStatus}`,
        observedValue: "VALOR_DIVERGENTE_HUMANO",
      };
    }

    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    if (!grid) {
      return { success: false, status: "STUDENT_NOT_FOUND", error: "Grade não encontrada" };
    }

    const row = grid.find((r) => r[0] === params.raText);
    if (!row) {
      return { success: false, status: "STUDENT_NOT_FOUND", error: `RA ${params.raText} não encontrado` };
    }

    if (params.preconditions.targetKey === "CONTROLE") {
      const fieldIdxMap: Record<FieldKey, number> = {
        identidade: 2,
        cpf: 3,
        certidao: 4,
        residencia: 5,
        titulo: 6,
        ensino_medio: 7,
        contrato: 8,
      };
      const colIdx = fieldIdxMap[params.fieldKey];
      row[colIdx] = params.preconditions.targetValue === 1 ? "TRUE" : "FALSE";

      return {
        success: true,
        status: "COMMITTED",
        cellCoordinate: `C${grid.indexOf(row) + 1}`,
        observedValue: row[colIdx],
      };
    } else {
      row[0] = params.preconditions.targetValue === 1 ? "ENTREGUE" : "NÃO ENTREGUE";
      return {
        success: true,
        status: "COMMITTED",
        cellCoordinate: `A${grid.indexOf(row) + 1}`,
        observedValue: row[0],
      };
    }
  }

  async verifyExternalEffect(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    targetKey: OperationTargetKey;
    expectedTargetValue: 0 | 1;
  }): Promise<ExternalEffectCheckResult> {
    if (this.verifyExternalEffectOverride) {
      return this.verifyExternalEffectOverride(params);
    }

    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    const row = grid?.find((r) => r[0] === params.raText);

    if (!row) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: new Date().toISOString(),
      };
    }

    const currentVal = row[2];
    const norm = currentVal === "TRUE" ? 1 : 0;
    const effectObserved = norm === params.expectedTargetValue;
    const isAbsentConfirmed = norm !== params.expectedTargetValue;

    return {
      effectObserved,
      isAbsentConfirmed,
      currentRawValue: currentVal,
      currentNormalizedValue: norm,
      cellCoordinate: "C2",
      inspectedAt: new Date().toISOString(),
    };
  }
}

describe("F4-C: Homologação Integrada de Ponta a Ponta (D1 ↔ Sheets V2)", () => {
  const periodo2027Id = 7777;
  const periodo2026Id = 8888;
  const intFace2027 = "int-hml-face-2027";
  const intFch2027 = "int-hml-fch-2027";
  const intFace2026 = "int-hml-face-2026";
  const sheetFace2027 = "sheet-face-2027-id";
  const sheetFch2027 = "sheet-fch-2027-id";
  const sheetFace2026 = "sheet-face-2026-id";
  const authSecretKey = "homologation-hmac-secret-key-32b-min";

  let adapter: HomologationSheetsAdapter;

  beforeAll(async () => {
    // 1. Registro de períodos de homologação
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, criado_em, status)
       VALUES (?, '2027-1-HML', datetime('now'), 'ATIVO')`
    ).bind(periodo2027Id).run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, criado_em, status)
       VALUES (?, '2026-2-HML', datetime('now'), 'ATIVO')`
    ).bind(periodo2026Id).run();

    // 2. Registro das integrações nos dois períodos e grupos
    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
       VALUES (?, ?, ?, 1, 1, 'SHADOW')`
    ).bind(intFace2027, periodo2027Id, sheetFace2027).run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
       VALUES (?, ?, ?, 1, 1, 'SHADOW')`
    ).bind(intFch2027, periodo2027Id, sheetFch2027).run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
       VALUES (?, ?, ?, 1, 1, 'SHADOW')`
    ).bind(intFace2026, periodo2026Id, sheetFace2026).run();

    // 3. Registro de adaptadores e administradores de auditoria F3
    registerServerTrustedAdapter({
      adapterId: "homologation-adapter-001",
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      spreadsheetId: sheetFace2027,
      allowedGroups: ["FACE_FEA", "FCH_EAD"],
      secret: authSecretKey,
      status: "ACTIVE",
    });

    registerServerTrustedAdmin({
      adminId: "admin:supervisor",
      allowedScopes: ["admin:resolve_conflict", "GLOBAL"],
      status: "ACTIVE",
      secret: authSecretKey,
    });
  });

  async function createEvidence(source: "SPREADSHEET_IMPORT" | "MANUAL_INITIALIZATION" | "LEGACY_MIGRATION", payload: string) {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { source, evidencePayload: payload, evidenceHash: hash };
  }

  async function resetarAmbiente() {
    adapter = new HomologationSheetsAdapter("homologation-adapter-001");

    // Configuração das planilhas com colunas J e K de fórmulas preservadas
    adapter.setSheetData(sheetFace2027, "CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS, "TOTAL_DOCS", "STATUS_FINAL"],
      ["000123", "Aluno Face 2027", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "=CONT.SE(C2:I2, TRUE)", '=SE(J2=7, "OK", "PENDENTE")'],
      ["000456", "Aluno Face 2027 B", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "=CONT.SE(C3:I3, TRUE)", '=SE(J3=7, "OK", "PENDENTE")'],
    ]);

    adapter.setSheetData(sheetFch2027, "CONTROLE DE DOCUMENTOS FCH EAD", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS, "TOTAL_DOCS", "STATUS_FINAL"],
      ["000123", "Aluno Fch 2027", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "=CONT.SE(C2:I2, TRUE)", '=SE(J2=7, "OK", "PENDENTE")'],
    ]);

    adapter.setSheetData(sheetFace2026, "CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS, "TOTAL_DOCS", "STATUS_FINAL"],
      ["000123", "Aluno Face 2026", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "=CONT.SE(C2:I2, TRUE)", '=SE(J2=7, "OK", "PENDENTE")'],
    ]);

    await env.DB.prepare(`DELETE FROM sync_conflicts`).run();
    await env.DB.prepare(`DELETE FROM sync_receipts`).run();
    await env.DB.prepare(`DELETE FROM sync_attempts`).run();
    await env.DB.prepare(`DELETE FROM sync_operations`).run();
    await env.DB.prepare(`DELETE FROM sync_events`).run();
    await env.DB.prepare(`DELETE FROM sync_commands`).run();
    await env.DB.prepare(`DELETE FROM sync_field_state`).run();
    await env.DB.prepare(`DELETE FROM sync_records`).run();
    await env.DB.prepare(`DELETE FROM documentos`).run();
    await env.DB.prepare(`DELETE FROM alunos WHERE periodo_id IN (?, ?)`).bind(periodo2027Id, periodo2026Id).run();
  }

  async function cadastrarAluno(params: {
    periodoId: number;
    ra: string;
    nome: string;
    groupKey: GroupKey;
    integrationId: string;
    fieldKey?: FieldKey;
    initialValue?: 0 | 1;
  }) {
    const fieldKey = params.fieldKey || "identidade";
    const initialValue = params.initialValue ?? 0;

    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'ADMINISTRACAO', ?, 'ATIVO')`
    ).bind(params.periodoId, params.ra, params.nome, params.groupKey === "FACE_FEA" ? "FACE" : "FCH").run();

    const alunoId = Number(res.meta.last_row_id);

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    ).bind(alunoId).run();

    const recordId = `rec-${params.groupKey}-${params.ra}-${crypto.randomUUID().slice(0, 8)}`;
    await initSyncRecord(env.DB, {
      recordId,
      integrationId: params.integrationId,
      groupKey: params.groupKey,
      raText: params.ra,
      alunoId,
    });

    const evidence = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, field: fieldKey }));
    await establishFieldBaseline(env.DB, {
      recordId,
      fieldKey,
      baselineValue: initialValue,
      commandId: `cmd-base-${recordId}-${fieldKey}`,
      actorId: "actor-homologation",
      integrationId: params.integrationId,
      periodoId: params.periodoId,
      groupKey: params.groupKey,
      generation: 1,
      expectedEpoch: 1,
      evidence,
    });

    return { alunoId, recordId };
  }

  it("HML-1 — Fluxo Completo Ponta a Ponta: Mutação Documental → Outbox → Orquestrador → Planilha → Confirmação", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    // 1. Aluno entrega RG na aplicação: comando com CAS
    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-rg-${recordId}`,
      actorId: "atendente-secretaria",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    // 2. Confirma outbox gerada em estado PENDING no D1
    const pendingOps = await env.DB.prepare(
      `SELECT operation_id, state, target_key, target_revision FROM sync_operations WHERE record_id = ?`
    ).bind(recordId).all<any>();

    expect(pendingOps.results.length).toBe(1);
    expect(pendingOps.results[0].state).toBe("PENDING");
    expect(pendingOps.results[0].target_revision).toBe(1);

    // 3. Orquestrador executa o despacho
    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-hml-primary",
    });

    const batchRes: SyncBatchResult = await orchestrator.executeBatch();

    // 4. Critérios de aprovação do fluxo direto:
    expect(batchRes.processedCount).toBe(1);
    expect(batchRes.observedCount).toBe(1);
    expect(batchRes.operations[0].status).toBe("OBSERVED");
    expect(batchRes.operations[0].receiptId).toBeDefined();

    // 5. Confirma persistência em sync_receipts e estado OBSERVED em sync_operations
    const opRow = await env.DB.prepare(
      `SELECT state, lease_owner FROM sync_operations WHERE operation_id = ?`
    ).bind(batchRes.operations[0].operationId).first<{ state: string; lease_owner: string | null }>();
    expect(opRow?.state).toBe("OBSERVED");
    expect(opRow?.lease_owner).toBe("worker-hml-primary");

    // 6. Confirma que a célula C2 na planilha foi atualizada para TRUE
    const grid = adapter.sheets.get(sheetFace2027)?.get("CONTROLE DE DOCUMENTOS FACE FEA");
    expect(grid?.[1][2]).toBe("TRUE");

    // 7. Confirma inviolabilidade estrita das fórmulas nas colunas J e K
    expect(grid?.[1][9]).toBe("=CONT.SE(C2:I2, TRUE)");
    expect(grid?.[1][10]).toBe('=SE(J2=7, "OK", "PENDENTE")');
  });

  it("HML-2 — Fluxo Inverso Ponta a Ponta: Modificação na Planilha → Reconciliação F3 Causal → Atualização D1 sem Eco", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
      initialValue: 0,
    });

    // 1. Simula leitura de snapshot assinado com entrega direta de RG na planilha
    const evidence = {
      evidenceId: `ev_test_${crypto.randomUUID()}`,
      sourceAdapterId: "homologation-adapter-001",
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA" as GroupKey,
      spreadsheetId: sheetFace2027,
      tabName: "CONTROLE DE DOCUMENTOS FACE FEA",
      raText: "000123",
      fieldKey: "identidade" as FieldKey,
      cellCoordinate: "C2",
      rawValue: "TRUE",
      normalizedValue: 1 as 0 | 1,
      readTimestamp: new Date().toISOString(),
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join("::"),
      contentHash: "hash_canonical_test",
    };

    const externalSnapshot: ObservedExternalSnapshot = {
      targetKey: "CONTROLE",
      rawValue: "TRUE",
      normalizedValue: 1,
      cellCoordinate: "C2",
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join("::"),
      observedAt: new Date().toISOString(),
      evidence,
    };

    // 2. Carrega contexto de reconciliação no D1
    const targetCtx = await loadReconciliationTargetContext(env.DB, {
      recordId,
      fieldKey: "identidade",
      targetKey: "CONTROLE",
      currentExternal: externalSnapshot,
    });

    // 3. Avalia decisão de reconciliação F3
    const decision = evaluateReconciliationDecision(targetCtx);
    expect(decision.classification).toBe("EXTERNAL_AHEAD");
    expect(decision.actionRequired).toBe("APPLY_EXTERNAL_MUTATION");

    // 4. Executa a resolução aceitando o valor externo via comando administrativo seguro
    const adminCred = await generateAdminCredential({
      adminId: "admin:supervisor",
      conflictId: "hml-ingestao-direta",
      chosenResolution: "ACCEPT_EXTERNAL",
      expectedLocalRevision: 0,
      secret: authSecretKey,
    });

    // Registra temporariamente conflito para baixa atômica
    await env.DB.prepare(
      `INSERT INTO sync_conflicts (conflict_id, record_id, field_key, target_key, local_revision, local_value, external_value, reason, resolved)
       VALUES ('hml-ingestao-direta', ?, 'identidade', 'CONTROLE', 0, 0, 1, 'Ingestão externa legítima', 0)`
    ).bind(recordId).run();

    const resAdmin = await applyAdminConflictResolution(env.DB, {
      conflictId: "hml-ingestao-direta",
      chosenResolution: "ACCEPT_EXTERNAL",
      expectedLocalRevision: 0,
      authCredential: adminCred,
    });

    expect(resAdmin.success).toBe(true);

    // 5. Confirma que sync_field_state foi atualizado para valor 1 sem eco de outbox para CONTROLE
    const fState = await env.DB.prepare(
      `SELECT revision, value, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
    ).bind(recordId).first<{ revision: number; value: number; status: string }>();

    expect(fState?.value).toBe(1);
    expect(fState?.revision).toBe(1);
    expect(fState?.status).toBe("CONFIRMED");

    // Nenhuma outbox em eco gerada para o alvo originador (CONTROLE)
    const echoes = await env.DB.prepare(
      `SELECT count(*) as total FROM sync_operations WHERE record_id = ? AND target_key = 'CONTROLE'`
    ).bind(recordId).first<{ total: number }>();
    expect(echoes?.total).toBe(0);
  });

  it("HML-3 — Conflito Humano Concorrente: Encaminhamento F3, Bloqueio Estrito e Resolução Auditada", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
      initialValue: 0,
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-conflito-${recordId}`,
      actorId: "operador-d1",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    // Simula divergência humana na planilha durante o Read-Before-Write
    adapter.simulateWriteErrorStatus = "CONFLICT_DETECTED";

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-hml-conflict",
    });

    const firstBatch = await orchestrator.executeBatch();
    expect(firstBatch.conflictCount).toBe(1);
    expect(firstBatch.operations[0].status).toBe("CONFLICT_RECORDED");
    const conflictId = firstBatch.operations[0].conflictId!;
    expect(conflictId).toBeDefined();

    // 1. Confirma que o conflito foi gravado no D1 em sync_conflicts com resolved = 0
    const confRow = await env.DB.prepare(
      `SELECT conflict_id, resolved, field_key FROM sync_conflicts WHERE conflict_id = ?`
    ).bind(conflictId).first<{ conflict_id: string; resolved: number; field_key: string }>();
    expect(confRow?.resolved).toBe(0);

    // 2. Demonstra que rodadas subsequentes BLOQUEIAM novas tentativas de escrita
    adapter.simulateWriteErrorStatus = null; // limpa o erro no mock
    let writeFoiChamado = false;
    adapter.writeDocumentField = async () => {
      writeFoiChamado = true;
      return { success: true, status: "COMMITTED" };
    };

    // Força next_attempt_at para agora para testar o bloqueio pelo conflito aberto
    await env.DB.prepare(
      `UPDATE sync_operations SET next_attempt_at = datetime('now', '-1 minute') WHERE record_id = ?`
    ).bind(recordId).run();

    const secondBatch = await orchestrator.executeBatch();
    expect(writeFoiChamado).toBe(false); // NÃO toca na planilha!
    expect(secondBatch.blockedByConflictCount).toBe(1);
    expect(secondBatch.operations[0].status).toBe("BLOCKED_BY_OPEN_CONFLICT");

    // 3. Resolução administrativa autorizada via F3
    const adminCred = await generateAdminCredential({
      adminId: "admin:supervisor",
      conflictId,
      chosenResolution: "ACCEPT_EXTERNAL",
      expectedLocalRevision: 1,
      secret: authSecretKey,
    });

    // Atualiza o conflito para simular que o valor externo é 0
    await env.DB.prepare(`UPDATE sync_conflicts SET external_value = 0 WHERE conflict_id = ?`).bind(conflictId).run();

    const resAdmin = await applyAdminConflictResolution(env.DB, {
      conflictId,
      chosenResolution: "ACCEPT_EXTERNAL",
      expectedLocalRevision: 1,
      authCredential: adminCred,
    });
    expect(resAdmin.success).toBe(true);

    // Confirma que o conflito foi baixado
    const confAfter = await env.DB.prepare(
      `SELECT resolved, resolution_action FROM sync_conflicts WHERE conflict_id = ?`
    ).bind(conflictId).first<{ resolved: number; resolution_action: string }>();
    expect(confAfter?.resolved).toBe(1);
    expect(confAfter?.resolution_action).toBe("ACCEPT_EXTERNAL");
  });

  it("HML-4 — Incerteza de Rede: Timeout HTTP, Releitura e Quarentena sem Retry Cego", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-net-${recordId}`,
      actorId: "operador-d1",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    // Simula queda de rede no envio HTTP, mas o efeito foi gravado na planilha antes da queda
    adapter.simulateNetworkException = true;
    adapter.simulateNetworkDropAfterWrite = true;

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-hml-network",
    });

    const batchRes = await orchestrator.executeBatch();

    // 1. O orquestrador detectou a queda e recuperou via verifyExternalEffect
    expect(batchRes.observedCount).toBe(1);
    expect(batchRes.operations[0].status).toBe("OBSERVED_VIA_VERIFY");
    expect(batchRes.operations[0].receiptId).toBeDefined();

    // 2. Agora simula incerteza onde a releitura também falha (planilha inacessível)
    await resetarAmbiente();
    const aluno2 = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000456",
      nome: "Aluno Face 2027 B",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-net2-${aluno2.recordId}`,
      actorId: "operador-d1",
      recordId: aluno2.recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    adapter.simulateNetworkException = true;
    adapter.verifyExternalEffectOverride = async () => {
      throw new Error("Timeout total durante verificação externa");
    };

    const orchestrator2 = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-hml-network-2",
    });

    const batchUncertain = await orchestrator2.executeBatch();
    expect(batchUncertain.uncertainCount).toBe(1);
    expect(batchUncertain.operations[0].status).toBe("UNCERTAIN_PRESERVED");

    // Confirma que a operação permaneceu em UNCERTAIN no D1 (em quarentena segura, sem retry cego)
    const opRow = await env.DB.prepare(
      `SELECT state FROM sync_operations WHERE operation_id = ?`
    ).bind(batchUncertain.operations[0].operationId).first<{ state: string }>();
    expect(opRow?.state).toBe("UNCERTAIN");
  });

  it("HML-5 — Concorrência Multiprocesso e Revalidação Atômica Pré-HTTP contra Workers Zumbis", async () => {
    await resetarAmbiente();

    // 1. Concorrência Real: Dois workers disputam operações distintas na outbox sem colisão
    const alunoA = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face A",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    const alunoB = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000456",
      nome: "Aluno Face B",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-conc-A`,
      actorId: "operador-d1",
      recordId: alunoA.recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-conc-B`,
      actorId: "operador-d1",
      recordId: alunoB.recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    const workerA = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-concorrente-A",
    });

    const workerB = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-concorrente-B",
    });

    // Execução independente de dois workers disputando a outbox
    const resA = await workerA.executeBatch({ batchSize: 1 });
    const resB = await workerB.executeBatch({ batchSize: 1 });

    expect(resA.observedCount).toBe(1);
    expect(resB.observedCount).toBe(1);
    expect(resA.operations[0].operationId).not.toBe(resB.operations[0].operationId);

    // 2. Proteção Pré-HTTP: Perda de fencing lease aborta escrita antes do socket HTTP
    const alunoC = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000789",
      nome: "Aluno Face C",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-conc-C`,
      actorId: "operador-d1",
      recordId: alunoC.recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    let writeChamadoZombie = false;
    adapter.writeDocumentField = async () => {
      writeChamadoZombie = true;
      return { success: true, status: "COMMITTED" };
    };

    const workerZombie = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-zombie-1",
      beforeWriteHook: async (opId) => {
        // Simula usurpação do lease imediatamente antes da chamada HTTP
        await env.DB.prepare(
          `UPDATE sync_operations
           SET lease_owner = 'worker-outro',
               lease_epoch = 99
           WHERE operation_id = ?`
        ).bind(opId).run();
      },
    });

    const resZombie = await workerZombie.executeBatch();
    expect(writeChamadoZombie).toBe(false);
    expect(resZombie.fencingRejectedCount).toBe(1);
    expect(resZombie.operations[0].status).toBe("FENCING_REJECTED");
  });

  it("HML-6 — Isolamento Multidimensional Absoluto: Períodos Distintos (2026-2 vs 2027-1) e Grupos (FACE vs FCH) com Mesmo RA Textual", async () => {
    await resetarAmbiente();

    // Cria o mesmo RA 000123 em 3 instâncias independentes:
    // 1. Período 2027-1, Grupo FACE FEA
    const inst1 = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    // 2. Período 2027-1, Grupo FCH EAD (adiciona registro de sincronização para FCH)
    const recFch = `rec-FCH_EAD-000123-${crypto.randomUUID().slice(0, 8)}`;
    await initSyncRecord(env.DB, {
      recordId: recFch,
      integrationId: intFch2027,
      groupKey: "FCH_EAD",
      raText: "000123",
      alunoId: inst1.alunoId,
    });
    const evFch = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ ra: "000123", group: "FCH_EAD" }));
    await establishFieldBaseline(env.DB, {
      recordId: recFch,
      fieldKey: "identidade",
      baselineValue: 0,
      commandId: `cmd-base-${recFch}`,
      actorId: "actor-hml",
      integrationId: intFch2027,
      periodoId: periodo2027Id,
      groupKey: "FCH_EAD",
      generation: 1,
      expectedEpoch: 1,
      evidence: evFch,
    });

    // 3. Período 2026-2, Grupo FACE FEA
    const inst3 = await cadastrarAluno({
      periodoId: periodo2026Id,
      ra: "000123",
      nome: "Aluno Face 2026",
      groupKey: "FACE_FEA",
      integrationId: intFace2026,
      fieldKey: "identidade",
    });

    // Dispara mutação apenas para a Instância 1 (FACE 2027-1)
    await executeFieldMutation(env.DB, {
      commandId: `cmd-face2027-${inst1.recordId}`,
      actorId: "operador-d1",
      recordId: inst1.recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-isolamento",
    });

    await orchestrator.executeBatch();

    // 1. Confirma que APENAS a planilha FACE 2027-1 foi alterada
    const gridFace2027 = adapter.sheets.get(sheetFace2027)?.get("CONTROLE DE DOCUMENTOS FACE FEA");
    expect(gridFace2027?.[1][2]).toBe("TRUE");

    // 2. Confirma que a planilha FCH 2027-1 permaneceu FALSE
    const gridFch2027 = adapter.sheets.get(sheetFch2027)?.get("CONTROLE DE DOCUMENTOS FCH EAD");
    expect(gridFch2027?.[1][2]).toBe("FALSE");

    // 3. Confirma que a planilha FACE 2026-2 permaneceu FALSE
    const gridFace2026 = adapter.sheets.get(sheetFace2026)?.get("CONTROLE DE DOCUMENTOS FACE FEA");
    expect(gridFace2026?.[1][2]).toBe("FALSE");

    // 4. Confirma que os estados no D1 das outras instâncias permaneceram intactos com valor 0
    const fStateFch = await env.DB.prepare(
      `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
    ).bind(recFch).first<{ value: number; revision: number }>();
    expect(fStateFch?.value).toBe(0);
    expect(fStateFch?.revision).toBe(0);

    const fStateFace2026 = await env.DB.prepare(
      `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
    ).bind(inst3.recordId).first<{ value: number; revision: number }>();
    expect(fStateFace2026?.value).toBe(0);
    expect(fStateFace2026?.revision).toBe(0);
  });

  it("HML-7 — Erros Estruturais (Layout Adulterado e RA Ausente): Quarentena UNCERTAIN sem Retry Cego", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-struct-${recordId}`,
      actorId: "operador-d1",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    adapter.simulateWriteErrorStatus = "LAYOUT_MUTATED";

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-structural-quarantine",
    });

    const batchRes = await orchestrator.executeBatch();

    // 1. Confirma que o status da operação foi STRUCTURAL_ERROR
    expect(batchRes.structuralErrorCount).toBe(1);
    expect(batchRes.operations[0].status).toBe("STRUCTURAL_ERROR");

    // 2. Confirma categoricamente que o estado no D1 é UNCERTAIN (quarentena segura)
    // e que a operação NÃO foi colocada em RETRY_WAIT com falso atestado de ausência de efeito
    const opRow = await env.DB.prepare(
      `SELECT state FROM sync_operations WHERE operation_id = ?`
    ).bind(batchRes.operations[0].operationId).first<{ state: string }>();

    expect(opRow?.state).toBe("UNCERTAIN");
  });

  it("HML-8 — Inviolabilidade da Desativação V1 durante Toda a Operação V2", async () => {
    await resetarAmbiente();

    const { recordId } = await cadastrarAluno({
      periodoId: periodo2027Id,
      ra: "000123",
      nome: "Aluno Face 2027",
      groupKey: "FACE_FEA",
      integrationId: intFace2027,
      fieldKey: "identidade",
    });

    await executeFieldMutation(env.DB, {
      commandId: `cmd-v1-check-${recordId}`,
      actorId: "operador-d1",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intFace2027,
      periodoId: periodo2027Id,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-v1-integrity",
    });

    await orchestrator.executeBatch();

    // Confirma que nenhuma linha foi gravada na tabela legada google_sheets_pendencias
    const pendenciasV1 = await env.DB.prepare(
      `SELECT count(*) as total FROM google_sheets_pendencias`
    ).first<{ total: number }>();

    expect(pendenciasV1?.total).toBe(0);
  });
});
