/**
 * ============================================================================
 * Suíte de Validação — Resolução Segura de Conflitos Bidirecionais V2
 * (Site ⇄ Google Sheets)
 * ============================================================================
 * Escopo de Dados:
 *  - Utiliza exclusivamente os 4 alunos fictícios do período 999:
 *      * 0090001001 (FACE_FEA)
 *      * 0090001002 (FACE_FEA)
 *      * 0090002001 (FCH_EAD)
 *      * 0090002002 (FCH_EAD)
 *  - Valida bloqueio estrito de escrita para períodos em PAUSED (999 quando pausado)
 *    e CAPTURE (2027-1), protegendo integralmente a planilha 2027-1.
 *
 * Cenários Cobertos:
 *  1. Site altera documento, mas o Sheets continua com o valor anterior (LOCAL_AHEAD).
 *  2. Site e Sheets alteram o mesmo documento antes da sincronização (Conflito Causal).
 *  3. Site e Sheets alteram documentos diferentes do mesmo aluno (Convergência Independente).
 *  4. Escrita enviada ao Sheets, mas a confirmação da API falha (UNCERTAIN + Releitura).
 *  5. Duas execuções concorrentes tentam despachar a mesma operação (Exclusão Mútua por Lease).
 *  6. Conflito resolvido manualmente (ACCEPT_EXTERNAL e KEEP_LOCAL sem operações órfãs).
 *  7. Operação outbound para período em PAUSED ou CAPTURE (Bloqueio Obrigatório).
 *  8. Reprocessamento após falha ou reinício do Worker (Idempotência e Recuperação Segura).
 */

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncV2Orchestrator } from "../src/server/services/sync-orchestrator";
import { reconcileInboundFromSpreadsheet } from "../src/server/services/sync-inbound-reconciler";
import {
  acquireCoordinatorLease,
  runScheduledSyncV2,
} from "../src/server/services/sync-coordinator";
import {
  applyAdminConflictResolution,
  loadReconciliationTargetContext,
} from "../src/server/services/sync-reconciliation";
import {
  generateAdminCredential,
  registerServerTrustedAdmin,
} from "../src/server/services/sync-d1-auth";
import {
  claimOperation,
  dispatchOperation,
} from "../src/server/services/sync-d1-operations";
import {
  executeFieldMutation,
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";
import { prepareExistingAlunosBaselines } from "../src/server/services/sync-baseline-seeder";
import {
  EXPECTED_CONTROL_HEADERS,
  type ControlTabReadResult,
  type ExternalEffectCheckResult,
  type GeneralTabReadResult,
  type ISyncSpreadsheetAdapter,
  type WritePreconditions,
  type WriteResult,
} from "../src/server/services/sync-sheet-contracts";

const PERIODO_999_ID = 999;
const INTEGRACAO_999_ID = "integ-homolog-999";
const SPREADSHEET_999_ID = "sheet-homolog-999-sandbox";

const PERIODO_2027_1_ID = 20271;
const INTEGRACAO_2027_1_ID = "integ-2027-1-capture";
const SPREADSHEET_2027_1_ID = "sheet-2027-1-protected";

const TAB_FACE_CONTROL = "CONTROLE DE DOCUMENTOS FACE FEA";
const TAB_FCH_CONTROL = "CONTROLE DE DOCUMENTOS FCH EAD";
const TAB_FACE_GENERAL = " MATRÍCULAS GERAIS FACE FEA";
const TAB_FCH_GENERAL = "MATRÍCULAS GERAIS FCH EAD";

const ALUNOS_FICTICIOS_999 = [
  { id: 99901, ra: "0090001001", nome: "Aluno Ficticio 999 Alfa", unidade: "FACE FEA", groupKey: "FACE_FEA" as GroupKey },
  { id: 99902, ra: "0090001002", nome: "Aluno Ficticio 999 Beta", unidade: "FACE FEA", groupKey: "FACE_FEA" as GroupKey },
  { id: 99903, ra: "0090002001", nome: "Aluno Ficticio 999 Gama", unidade: "FCH EAD", groupKey: "FCH_EAD" as GroupKey },
  { id: 99904, ra: "0090002002", nome: "Aluno Ficticio 999 Delta", unidade: "FCH EAD", groupKey: "FCH_EAD" as GroupKey },
] as const;

const ADMIN_SECRET = "segredo_homolog_999_conflitos_v2_chave_forte_2026";

const FIELD_KEYS: FieldKey[] = [
  "identidade",
  "cpf_documento",
  "certidao",
  "residencia",
  "titulo",
  "ensino_medio",
  "contrato",
];

/**
 * Adaptador determinístico em memória para simular o Google Sheets com suporte a:
 *  - Leitura de abas de controle (readControlTab) e gerais (readGeneralTabContracts)
 *  - Escrita com verificação Read-Before-Write CAS (writeDocumentField)
 *  - Simulação de falha de confirmação pós-escrita (simulateNetworkDropAfterWrite)
 *  - Simulação de falha de rede antes da escrita (simulateNetworkDropBeforeWrite)
 *  - Rastreamento completo de chamadas de escrita e verificação por planilha
 */
class BidirectionalSandboxSheetAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "bidirectional-sandbox-sheet-adapter";

  private sheets = new Map<
    string,
    Map<string, Map<string, Record<FieldKey, 0 | 1>>>
  >();

  public simulateNetworkDropAfterWrite = false;
  public simulateNetworkDropBeforeWrite = false;

  public writeCalls: Array<{
    spreadsheetId: string;
    tabName: string;
    raText: string;
    fieldKey: FieldKey;
    expectedCurrentValue: 0 | 1 | null;
    targetValue: 0 | 1;
    operationId: string;
  }> = [];

  public verifyCalls: Array<{
    spreadsheetId: string;
    tabName: string;
    raText: string;
    fieldKey: FieldKey;
    expectedTargetValue: 0 | 1;
  }> = [];

  reset() {
    this.sheets.clear();
    this.simulateNetworkDropAfterWrite = false;
    this.simulateNetworkDropBeforeWrite = false;
    this.writeCalls = [];
    this.verifyCalls = [];
  }

  setStudentRow(
    spreadsheetId: string,
    tabName: string,
    raText: string,
    docs: Partial<Record<FieldKey, 0 | 1>> = {},
  ) {
    if (!this.sheets.has(spreadsheetId)) {
      this.sheets.set(spreadsheetId, new Map());
    }
    const book = this.sheets.get(spreadsheetId)!;
    if (!book.has(tabName)) {
      book.set(tabName, new Map());
    }
    const tab = book.get(tabName)!;
    const current = tab.get(raText) || {
      identidade: 0,
      cpf_documento: 0,
      certidao: 0,
      residencia: 0,
      titulo: 0,
      ensino_medio: 0,
      contrato: 0,
    };
    tab.set(raText, { ...current, ...docs });
  }

  getFieldValue(
    spreadsheetId: string,
    tabName: string,
    raText: string,
    fieldKey: FieldKey,
  ): 0 | 1 | null {
    return this.sheets.get(spreadsheetId)?.get(tabName)?.get(raText)?.[fieldKey] ?? null;
  }

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const tab = this.sheets.get(params.spreadsheetId)?.get(params.tabName) || new Map();
    const rowsByRa = new Map<string, any>();
    let rowIdx = 2;

    for (const [ra, docs] of tab.entries()) {
      const fields: Record<string, any> = {};
      FIELD_KEYS.forEach((f, idx) => {
        const val = docs[f];
        fields[f] = {
          rawValue: val === 1 ? "TRUE" : "FALSE",
          normalizedValue: val,
          cellCoordinate: `${String.fromCharCode(67 + idx)}${rowIdx}`,
        };
      });
      rowsByRa.set(ra, {
        rowIndex: rowIdx,
        raText: ra,
        studentName: `Aluno ${ra}`,
        fields,
      });
      rowIdx++;
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join("::"),
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [],
    };
  }

  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const rowsByRa = new Map<string, any>();
    const book = this.sheets.get(params.spreadsheetId);
    if (book) {
      let rowIdx = 2;
      for (const [, tab] of book.entries()) {
        for (const [ra, docs] of tab.entries()) {
          rowsByRa.set(ra, {
            rowIndex: rowIdx++,
            raText: ra,
            contractRawValue: "Em curso",
            contractNormalizedValue: docs.contrato,
            courseName: "ADMINISTRAÇÃO",
            cellCoordinate: `A${rowIdx}`,
          });
        }
      }
    }
    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: "SITUAÇÃO CONTRATUAL::RA",
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [],
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
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      raText: params.raText,
      fieldKey: params.fieldKey,
      expectedCurrentValue: params.preconditions.expectedCurrentValue,
      targetValue: params.preconditions.targetValue,
      operationId: params.preconditions.operationId,
    });

    if (this.simulateNetworkDropBeforeWrite) {
      throw new Error("ETIMEDOUT: Falha de conexão antes do envio do payload ao Google Sheets");
    }

    const tab = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    const row = tab?.get(params.raText);
    if (!row) {
      return {
        success: false,
        status: "STUDENT_NOT_FOUND",
        error: `RA ${params.raText} não encontrado na aba ${params.tabName}`,
      };
    }

    const currentVal = row[params.fieldKey];

    // Read-Before-Write CAS (C4): se o valor atual na planilha diverge do esperado e também não é igual ao alvo
    if (
      params.preconditions.expectedCurrentValue !== null &&
      currentVal !== params.preconditions.expectedCurrentValue
    ) {
      return {
        success: false,
        status: "CONFLICT_DETECTED",
        observedValue: currentVal === 1 ? "TRUE" : "FALSE",
        error: `Conflito CAS na planilha: esperado=${params.preconditions.expectedCurrentValue}, observado=${currentVal}`,
      };
    }

    // Grava o novo valor na célula da planilha
    row[params.fieldKey] = params.preconditions.targetValue;

    if (this.simulateNetworkDropAfterWrite) {
      throw new Error("ECONNRESET: Escrita aplicada no Google Sheets, mas resposta HTTP caiu");
    }

    return {
      success: true,
      status: "COMMITTED",
      updatedRange: `${params.tabName}!C2`,
      observedValue: params.preconditions.targetValue === 1 ? "TRUE" : "FALSE",
      committedAt: new Date().toISOString(),
    };
  }

  async verifyExternalEffect(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    targetKey: "CONTROLE" | "GERAL_CONTRATO";
    expectedTargetValue: 0 | 1;
  }): Promise<ExternalEffectCheckResult> {
    this.verifyCalls.push({
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      raText: params.raText,
      fieldKey: params.fieldKey,
      expectedTargetValue: params.expectedTargetValue,
    });

    const currentVal = this.getFieldValue(
      params.spreadsheetId,
      params.tabName,
      params.raText,
      params.fieldKey,
    );

    if (currentVal === null) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: "",
        currentNormalizedValue: null,
        checkedAt: new Date().toISOString(),
      };
    }

    const effectObserved = currentVal === params.expectedTargetValue;
    return {
      effectObserved,
      isAbsentConfirmed: !effectObserved,
      currentRawValue: currentVal === 1 ? "TRUE" : "FALSE",
      currentNormalizedValue: currentVal,
      checkedAt: new Date().toISOString(),
    };
  }
}

describe("Validação de Conflitos Bidirecionais V2 — Período Fictício 999", () => {
  const adapter = new BidirectionalSandboxSheetAdapter();

  beforeEach(async () => {
    adapter.reset();

    // Limpa estritamente o estado dos períodos de teste (999 e 20271) sem afetar outros testes paralelos
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM sync_attempts WHERE operation_id IN (
           SELECT o.operation_id FROM sync_operations o
           JOIN sync_records r ON r.record_id = o.record_id
           WHERE r.integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_receipts WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_operations WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_events WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_commands WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_conflicts WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(
        `DELETE FROM sync_field_state WHERE record_id IN (
           SELECT record_id FROM sync_records WHERE integration_id IN (?, ?)
         )`,
      ).bind(INTEGRACAO_999_ID, INTEGRACAO_2027_1_ID),
      env.DB.prepare(`DELETE FROM sync_records WHERE integration_id IN (?, ?)`).bind(
        INTEGRACAO_999_ID,
        INTEGRACAO_2027_1_ID,
      ),
      env.DB.prepare(`DELETE FROM sync_coordinator_leases WHERE integration_id IN (?, ?)`).bind(
        INTEGRACAO_999_ID,
        INTEGRACAO_2027_1_ID,
      ),
      env.DB.prepare(`DELETE FROM sync_auth_nonces WHERE sender_id = 'admin:secretaria_homolog'`),
      env.DB.prepare(`DELETE FROM documentos WHERE aluno_id IN (99901, 99902, 99903, 99904, 2027101, 2027102)`),
      env.DB.prepare(`DELETE FROM alunos WHERE periodo_id IN (?, ?)`).bind(PERIODO_999_ID, PERIODO_2027_1_ID),
      env.DB.prepare(`DELETE FROM google_sheets_periodos WHERE periodo_id IN (?, ?)`).bind(PERIODO_999_ID, PERIODO_2027_1_ID),
      env.DB.prepare(`DELETE FROM sync_integrations WHERE periodo_id IN (?, ?)`).bind(PERIODO_999_ID, PERIODO_2027_1_ID),
    ]);

    // Registra principal administrativo confiável para resolução de conflitos F3
    registerServerTrustedAdmin({
      adminId: "admin:secretaria_homolog",
      allowedScopes: ["admin:resolve_conflict"],
      status: "ACTIVE",
      secret: ADMIN_SECRET,
    });

    // Configura Período 999 (Sandbox de testes com os 4 alunos fictícios)
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, status)
       VALUES (?, '999', 'ATIVO')`,
    )
      .bind(PERIODO_999_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
       VALUES (?, ?, ?, 1, 1, 'BIDIRECTIONAL')`,
    )
      .bind(INTEGRACAO_999_ID, PERIODO_999_ID, SPREADSHEET_999_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO google_sheets_periodos (
         periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
         aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
       ) VALUES (?, ?, ?, ?, ?, ?, 'CANC_FACE', 'CANC_FCH')`,
    )
      .bind(
        PERIODO_999_ID,
        SPREADSHEET_999_ID,
        TAB_FACE_GENERAL,
        TAB_FCH_GENERAL,
        TAB_FACE_CONTROL,
        TAB_FCH_CONTROL,
      )
      .run();

    // Insere exclusivamente os 4 alunos fictícios do período 999 e semeia o baseline inicial (todos 0)
    for (const a of ALUNOS_FICTICIOS_999) {
      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
         VALUES (?, ?, ?, ?, 'ADMINISTRAÇÃO', ?, 'ATIVO')`,
      )
        .bind(a.id, PERIODO_999_ID, a.ra, a.nome, a.unidade)
        .run();

      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
      )
        .bind(a.id)
        .run();

      const tabName = a.groupKey === "FACE_FEA" ? TAB_FACE_CONTROL : TAB_FCH_CONTROL;
      adapter.setStudentRow(SPREADSHEET_999_ID, tabName, a.ra, {
        identidade: 0,
        cpf_documento: 0,
        certidao: 0,
        residencia: 0,
        titulo: 0,
        ensino_medio: 0,
        contrato: 0,
      });
    }

    const seedRes = await prepareExistingAlunosBaselines(env.DB, {
      periodoId: PERIODO_999_ID,
      integrationId: INTEGRACAO_999_ID,
      actorId: "seed:homolog-999",
      targetRas: ALUNOS_FICTICIOS_999.map((a) => a.ra),
    });
    expect(seedRes.sucesso).toBe(true);
    expect(seedRes.alunosPreparados).toBe(4);
  });

  // =========================================================================
  // CENÁRIO 1: Site altera documento, mas o Sheets continua com o valor anterior
  // =========================================================================
  it("Cenário 1: Site altera documento e Sheets continua com valor anterior -> Inbound NÃO descarta operação pendente e Outbound conclui envio", async () => {
    const aluno = ALUNOS_FICTICIOS_999[0]; // 0090001001 (FACE_FEA)
    const recordId = `rec-${PERIODO_999_ID}-${aluno.groupKey}-${aluno.ra}`;

    // 1. Site altera 'identidade' de 0 para 1
    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-c1-${aluno.ra}`,
      actorId: "user:secretaria",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno.groupKey,
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    await env.DB.prepare(`UPDATE documentos SET identidade = 1 WHERE aluno_id = ?`)
      .bind(aluno.id)
      .run();

    // 2. Antes do Outbound rodar, o Inbound lê a planilha (que ainda tem identidade = 0)
    const inboundReport = await reconcileInboundFromSpreadsheet({
      periodoId: PERIODO_999_ID,
      integrationId: INTEGRACAO_999_ID,
      actorId: "cron:inbound",
      adapter,
      db: env.DB,
    });

    expect(inboundReport.sucesso).toBe(true);
    expect(inboundReport.conflitosDetectados).toBe(0);
    expect(inboundReport.camposAtualizadosNoD1).toBe(0);

    // 3. Confirma que o valor local no D1 NÃO foi revertido para 0 e a operação PENDING permanece intacta
    const fieldAfterInbound = await env.DB.prepare(
      `SELECT value, revision, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
    )
      .bind(recordId)
      .first<{ value: number; revision: number; status: string }>();
    expect(fieldAfterInbound).toEqual({ value: 1, revision: 1, status: "CONFIRMED" });

    const pendingOp = await env.DB.prepare(
      `SELECT operation_id, state FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`,
    )
      .bind(recordId)
      .first<{ operation_id: string; state: string }>();
    expect(pendingOp?.state).toBe("PENDING");

    // 4. Despachador Outbound processa a operação pendente e atualiza a planilha para 1
    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-c1",
      integrationId: INTEGRACAO_999_ID,
    });
    const batchRes = await orchestrator.executeBatch();
    expect(batchRes.processedCount).toBe(1);
    expect(batchRes.observedCount).toBe(1);
    expect(adapter.getFieldValue(SPREADSHEET_999_ID, TAB_FACE_CONTROL, aluno.ra, "identidade")).toBe(1);
  });

  // =========================================================================
  // CENÁRIO 2: Site e Sheets alteram o mesmo documento antes da sincronização
  // =========================================================================
  it("Cenário 2: Site e Sheets alteram o mesmo documento antes da sincronização -> detecta divergência causal, preserva ambos os lados e registra sync_conflicts", async () => {
    const alunoA = ALUNOS_FICTICIOS_999[0]; // 0090001001 (FACE_FEA) — detectado no Inbound
    const alunoB = ALUNOS_FICTICIOS_999[2]; // 0090002001 (FCH_EAD) — detectado no Outbound CAS
    const recA = `rec-${PERIODO_999_ID}-${alunoA.groupKey}-${alunoA.ra}`;
    const recB = `rec-${PERIODO_999_ID}-${alunoB.groupKey}-${alunoB.ra}`;

    // --- Subcaso 2A: Site altera 'certidao' (0 -> 1) e Sheets também altera 'certidao' (0 -> 1) concorrentemente ---
    const mutA = await executeFieldMutation(env.DB, {
      commandId: `cmd-c2a-${alunoA.ra}`,
      actorId: "user:secretaria",
      recordId: recA,
      fieldKey: "certidao",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoA.groupKey,
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutA.ok).toBe(true);

    // Sheets é editado concorrentemente antes da sincronização (0 -> 1)
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FACE_CONTROL, alunoA.ra, { certidao: 1 });

    // Inbound roda e detecta que havia operação local pendente partindo de value_old=0 enquanto a planilha mudou para 1
    const inboundReport = await reconcileInboundFromSpreadsheet({
      periodoId: PERIODO_999_ID,
      integrationId: INTEGRACAO_999_ID,
      actorId: "cron:inbound",
      adapter,
      db: env.DB,
    });
    expect(inboundReport.conflitosDetectados).toBe(1);

    const conflictA = await env.DB.prepare(
      `SELECT conflict_id, local_revision, local_value, external_value, resolved
       FROM sync_conflicts WHERE record_id = ? AND field_key = 'certidao'`,
    )
      .bind(recA)
      .first<{
        conflict_id: string;
        local_revision: number;
        local_value: number;
        external_value: number;
        resolved: number;
      }>();
    expect(conflictA).toBeDefined();
    expect(conflictA?.resolved).toBe(0);

    // --- Subcaso 2B: Baseline inicial de 'titulo' = 1 para alunoB; Site altera (1 -> 0), mas na planilha o valor era 0 (ou foi alterado externamente) quando Outbound tenta gravar ---
    // Primeiro colocamos alunoB com titulo = 0 no baseline, Site altera 0 -> 1 (rev 1) e depois 1 -> 0 (rev 2), enquanto Sheets mudou de 0 -> 1!
    const mutB1 = await executeFieldMutation(env.DB, {
      commandId: `cmd-c2b1-${alunoB.ra}`,
      actorId: "user:secretaria",
      recordId: recB,
      fieldKey: "titulo",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoB.groupKey,
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutB1.ok).toBe(true);

    // Simula que a revisão 0 tinha âncora 0, mas na planilha alguém alterou 'identidade' de 0 para 1 enquanto Site alterou 'identidade' de 0 para 1:
    // Vamos testar o Read-Before-Write CAS no Outbound: Site espera value_old = 0 e quer gravar 1, mas a planilha já está em 1!
    const opIdB = `op-c2b-id-${alunoB.ra}`;
    const mutBId = await executeFieldMutation(env.DB, {
      commandId: `cmd-c2b-id-${alunoB.ra}`,
      actorId: "user:secretaria",
      recordId: recB,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoB.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: opIdB,
    });
    expect(mutBId.ok).toBe(true);
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FCH_CONTROL, alunoB.ra, { identidade: 1 });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-c2",
      integrationId: INTEGRACAO_999_ID,
    });

    const opResB = await orchestrator.processPendingOperation(
      opIdB,
      new Date().toISOString(),
    );
    expect(opResB.status).toBe("CONFLICT_RECORDED");
    expect(opResB.conflictId).toBeDefined();

    // Confirma que a operação de recA (que já tinha conflito aberto pelo Inbound) também é bloqueada pelo Outbound
    const opARow = await env.DB.prepare(
      `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'certidao'`,
    )
      .bind(recA)
      .first<{ operation_id: string }>();
    const opResA = await orchestrator.processPendingOperation(
      opARow!.operation_id,
      new Date().toISOString(),
    );
    expect(opResA.status).toBe("BLOCKED_BY_OPEN_CONFLICT");
  });

  // =========================================================================
  // CENÁRIO 3: Site e Sheets alteram documentos diferentes do mesmo aluno
  // =========================================================================
  it("Cenário 3: Site e Sheets alteram documentos diferentes do mesmo aluno -> preserva ambas as alterações sem falso conflito", async () => {
    const aluno = ALUNOS_FICTICIOS_999[1]; // 0090001002 (FACE_FEA)
    const recordId = `rec-${PERIODO_999_ID}-${aluno.groupKey}-${aluno.ra}`;

    // 1. Site altera 'cpf_documento' (0 -> 1)
    const mutSite = await executeFieldMutation(env.DB, {
      commandId: `cmd-c3-${aluno.ra}`,
      actorId: "user:secretaria",
      recordId,
      fieldKey: "cpf_documento",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno.groupKey,
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutSite.ok).toBe(true);
    await env.DB.prepare(`UPDATE documentos SET cpf = 1 WHERE aluno_id = ?`)
      .bind(aluno.id)
      .run();

    // 2. Concorrentemente, Sheets altera 'ensino_medio' (0 -> 1) para o MESMO aluno
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FACE_CONTROL, aluno.ra, {
      cpf_documento: 0,
      ensino_medio: 1,
    });

    // 3. Executa o ciclo coordenado completo (Inbound + Outbound)
    const cycleRes = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      customAdapter: adapter,
      targetPeriodoId: PERIODO_999_ID,
    });

    expect(cycleRes.integracoesExecutadas).toBe(1);
    const intReport = cycleRes.relatorios[0];
    expect(intReport.inboundReport?.conflitosDetectados).toBe(0);
    expect(intReport.inboundReport?.camposAtualizadosNoD1).toBe(1);
    expect(intReport.outboundReport?.observedCount).toBe(1);
    expect(intReport.outboundReport?.conflictCount).toBe(0);

    // 4. Verifica convergência final: ambos os documentos valem 1 no D1 e na planilha!
    const docRow = await env.DB.prepare(
      `SELECT cpf, ensino_medio FROM documentos WHERE aluno_id = ?`,
    )
      .bind(aluno.id)
      .first<{ cpf: number; ensino_medio: number }>();
    expect(docRow).toEqual({ cpf: 1, ensino_medio: 1 });

    expect(adapter.getFieldValue(SPREADSHEET_999_ID, TAB_FACE_CONTROL, aluno.ra, "cpf_documento")).toBe(1);
    expect(adapter.getFieldValue(SPREADSHEET_999_ID, TAB_FACE_CONTROL, aluno.ra, "ensino_medio")).toBe(1);
  });

  // =========================================================================
  // CENÁRIO 4: Escrita enviada ao Sheets, mas a confirmação da API falha
  // =========================================================================
  it("Cenário 4: Escrita enviada ao Sheets com falha de confirmação da API -> marca UNCERTAIN e reconcilia por releitura antes de repetir escrita", async () => {
    const alunoA = ALUNOS_FICTICIOS_999[2]; // 0090002001 (FCH_EAD)
    const alunoB = ALUNOS_FICTICIOS_999[3]; // 0090002002 (FCH_EAD)
    const recA = `rec-${PERIODO_999_ID}-${alunoA.groupKey}-${alunoA.ra}`;
    const recB = `rec-${PERIODO_999_ID}-${alunoB.groupKey}-${alunoB.ra}`;

    // --- Subcaso 4A: Operação persistida em UNCERTAIN após falha de confirmação quando o valor JÁ foi gravado no Sheets ---
    const opIdA = `op-c4a-${alunoA.ra}`;
    const mutA = await executeFieldMutation(env.DB, {
      commandId: `cmd-c4a-${alunoA.ra}`,
      actorId: "user:secretaria",
      recordId: recA,
      fieldKey: "residencia",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoA.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: opIdA,
    });
    expect(mutA.ok).toBe(true);

    // Simula que o valor chegou à planilha, mas o Worker anterior marcou UNCERTAIN por timeout
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FCH_CONTROL, alunoA.ra, { residencia: 1 });
    await env.DB.prepare(
      `UPDATE sync_operations
       SET state = 'UNCERTAIN', lease_owner = NULL, lease_until = NULL, next_attempt_at = datetime('now', '-10 seconds')
       WHERE operation_id = ?`,
    )
      .bind(opIdA)
      .run();

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-c4-verify",
      integrationId: INTEGRACAO_999_ID,
    });

    const batch4A = await orchestrator.executeBatch();
    expect(batch4A.processedCount).toBe(1);
    expect(batch4A.observedCount).toBe(1);
    expect(batch4A.operations[0].status).toBe("OBSERVED_VIA_VERIFY");

    // Confirma que NENHUMA nova chamada de escrita foi feita (0 writeCalls, 1 verifyCall)!
    expect(adapter.writeCalls).toHaveLength(0);
    expect(adapter.verifyCalls).toHaveLength(1);

    const opStateA = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(opIdA)
      .first<{ state: string }>();
    expect(opStateA?.state).toBe("OBSERVED");

    // --- Subcaso 4B: Operação em UNCERTAIN cujo efeito NÃO chegou à planilha -> verifyExternalEffect confirma ausência -> agenda RETRY_WAIT -> reenvia ---
    const opIdB = `op-c4b-${alunoB.ra}`;
    const mutB = await executeFieldMutation(env.DB, {
      commandId: `cmd-c4b-${alunoB.ra}`,
      actorId: "user:secretaria",
      recordId: recB,
      fieldKey: "titulo",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoB.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: opIdB,
    });
    expect(mutB.ok).toBe(true);

    // Na planilha, titulo continua 0 (efeito ausente)
    await env.DB.prepare(
      `UPDATE sync_operations
       SET state = 'UNCERTAIN', lease_owner = NULL, lease_until = NULL, next_attempt_at = datetime('now', '-10 seconds')
       WHERE operation_id = ?`,
    )
      .bind(opIdB)
      .run();

    // 1ª rodada: apenas verifica via releitura e agenda RETRY_WAIT (sem escrever ainda!)
    const batch4BVerify = await orchestrator.executeBatch();
    expect(batch4BVerify.processedCount).toBe(1);
    expect(batch4BVerify.retryScheduledCount).toBe(1);
    expect(batch4BVerify.operations[0].status).toBe("RETRY_SCHEDULED");
    expect(adapter.writeCalls).toHaveLength(0);

    // Simula vencimento do backoff e roda 2ª rodada: agora despacha e grava na planilha
    await env.DB.prepare(
      `UPDATE sync_operations SET next_attempt_at = datetime('now', '-1 second') WHERE operation_id = ?`,
    )
      .bind(opIdB)
      .run();

    const batch4BDispatch = await orchestrator.executeBatch();
    expect(batch4BDispatch.observedCount).toBe(1);
    expect(adapter.writeCalls).toHaveLength(1);
    expect(adapter.getFieldValue(SPREADSHEET_999_ID, TAB_FCH_CONTROL, alunoB.ra, "titulo")).toBe(1);
  });

  // =========================================================================
  // CENÁRIO 5: Duas execuções concorrentes tentam despachar a mesma operação
  // =========================================================================
  it("Cenário 5: Duas execuções concorrentes tentam despachar a mesma operação -> garante exclusão mútua por lease e impede escrita duplicada", async () => {
    const aluno = ALUNOS_FICTICIOS_999[0]; // 0090001001 (FACE_FEA)
    const recordId = `rec-${PERIODO_999_ID}-${aluno.groupKey}-${aluno.ra}`;

    const operationId = `op-c5-${aluno.ra}`;
    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-c5-${aluno.ra}`,
      actorId: "user:secretaria",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: operationId,
    });
    expect(mutRes.ok).toBe(true);

    // 1. Exclusão mútua no nível da operação (dois SyncV2Orchestrator concorrentes com Promise.all)
    const worker1 = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-concurrent-1",
      integrationId: INTEGRACAO_999_ID,
    });
    const worker2 = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-concurrent-2",
      integrationId: INTEGRACAO_999_ID,
    });

    const nowIso = new Date().toISOString();
    const [res1, res2] = await Promise.all([
      worker1.processPendingOperation(operationId, nowIso),
      worker2.processPendingOperation(operationId, nowIso),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual(["OBSERVED", "SKIPPED_NOT_ELIGIBLE"]);

    // Confirma que a escrita externa no Google Sheets ocorreu EXATAMENTE 1 vez!
    expect(adapter.writeCalls).toHaveLength(1);

    // 2. Exclusão mútua no nível do coordenador da integração (sync_coordinator_leases)
    const lease1 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId: INTEGRACAO_999_ID,
      owner: "coord-instance-1",
      durationSeconds: 60,
    });
    const lease2 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId: INTEGRACAO_999_ID,
      owner: "coord-instance-2",
      durationSeconds: 60,
    });

    expect(lease1.ok).toBe(true);
    expect(lease2.ok).toBe(false);
    if (!lease2.ok) {
      expect(lease2.currentOwner).toBe("coord-instance-1");
    }
  });

  // =========================================================================
  // CENÁRIO 6: Conflito resolvido manualmente (ACCEPT_EXTERNAL e KEEP_LOCAL)
  // =========================================================================
  it("Cenário 6: Conflito resolvido manualmente -> transiciona status, atualiza baseline/recibo e não deixa operações órfãs", async () => {
    const alunoAccept = ALUNOS_FICTICIOS_999[0]; // 0090001001 — ACCEPT_EXTERNAL
    const alunoKeep = ALUNOS_FICTICIOS_999[1];   // 0090001002 — KEEP_LOCAL
    const recAccept = `rec-${PERIODO_999_ID}-${alunoAccept.groupKey}-${alunoAccept.ra}`;
    const recKeep = `rec-${PERIODO_999_ID}-${alunoKeep.groupKey}-${alunoKeep.ra}`;

    // --- Subcaso 6A: ACCEPT_EXTERNAL ---
    // Site alterou 'identidade' (0 -> 1), mas vamos simular que uma operação ficou pendente na revisão 1
    // e o conflito foi registrado com external_value = 0 (planilha desmarcou ou manteve 0 após divergência).
    const mutAccept = await executeFieldMutation(env.DB, {
      commandId: `cmd-c6a-${alunoAccept.ra}`,
      actorId: "user:secretaria",
      recordId: recAccept,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoAccept.groupKey,
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutAccept.ok).toBe(true);
    await env.DB.prepare(`UPDATE documentos SET identidade = 1 WHERE aluno_id = ?`)
      .bind(alunoAccept.id)
      .run();

    const conflictAcceptId = "conf_c6_accept_ext";
    await env.DB.prepare(
      `INSERT INTO sync_conflicts (
         conflict_id, record_id, field_key, target_key,
         local_revision, local_value, external_value, reason, resolved
       ) VALUES (?, ?, 'identidade', 'CONTROLE', 1, 1, 0, 'Conflito para ACCEPT_EXTERNAL', 0)`,
    )
      .bind(conflictAcceptId, recAccept)
      .run();

    const credAccept = await generateAdminCredential({
      adminId: "admin:secretaria_homolog",
      conflictId: conflictAcceptId,
      chosenResolution: "ACCEPT_EXTERNAL",
      expectedLocalRevision: 1,
      secret: ADMIN_SECRET,
    });

    const resAccept = await applyAdminConflictResolution(env.DB, {
      conflictId: conflictAcceptId,
      authCredential: credAccept,
      chosenResolution: "ACCEPT_EXTERNAL",
      justification: "Prevalece conferência física da planilha (valor 0)",
      expectedLocalRevision: 1,
    });
    expect(resAccept.success).toBe(true);

    // Verifica que:
    // 1) Conflito está resolved = 1 com ACCEPT_EXTERNAL
    // 2) sync_field_state avançou para revision = 2, value = 0, status = 'CONFIRMED'
    // 3) tabela documentos foi atualizada para identidade = 0
    // 4) recibo OBSERVED foi emitido na revisão 2 (âncora causal íntegra)
    // 5) operação anterior da revisão 1 foi encerrada como OBSERVED (ZERO operações órfãs!)
    const stateAccept = await env.DB.prepare(
      `SELECT value, revision, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
    )
      .bind(recAccept)
      .first<{ value: number; revision: number; status: string }>();
    expect(stateAccept).toEqual({ value: 0, revision: 2, status: "CONFIRMED" });

    const docAccept = await env.DB.prepare(`SELECT identidade FROM documentos WHERE aluno_id = ?`)
      .bind(alunoAccept.id)
      .first<{ identidade: number }>();
    expect(docAccept?.identidade).toBe(0);

    const orphanOpsAccept = await env.DB.prepare(
      `SELECT count(*) as total FROM sync_operations WHERE record_id = ? AND state != 'OBSERVED'`,
    )
      .bind(recAccept)
      .first<{ total: number }>();
    expect(orphanOpsAccept?.total).toBe(0);

    const ctxAfterAccept = await loadReconciliationTargetContext(env.DB, {
      recordId: recAccept,
      fieldKey: "identidade",
      targetKey: "CONTROLE",
      currentExternal: null,
    });
    expect(ctxAfterAccept?.receiptAnchor?.revision).toBe(2);
    expect(ctxAfterAccept?.receiptAnchor?.confirmedValue).toBe(0);

    // --- Subcaso 6B: KEEP_LOCAL ---
    const opIdKeep = `op-c6b-${alunoKeep.ra}`;
    const mutKeep = await executeFieldMutation(env.DB, {
      commandId: `cmd-c6b-${alunoKeep.ra}`,
      actorId: "user:secretaria",
      recordId: recKeep,
      fieldKey: "residencia",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: alunoKeep.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: opIdKeep,
    });
    expect(mutKeep.ok).toBe(true);

    // Simula conflito detectado pelo Outbound CAS (planilha tinha 0, conflito aberto)
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FACE_CONTROL, alunoKeep.ra, { residencia: 0 });
    const conflictKeepId = "conf_c6_keep_local";
    await env.DB.prepare(
      `INSERT INTO sync_conflicts (
         conflict_id, record_id, field_key, target_key,
         local_revision, local_value, external_value, reason, resolved
       ) VALUES (?, ?, 'residencia', 'CONTROLE', 1, 1, 0, 'Conflito para KEEP_LOCAL', 0)`,
    )
      .bind(conflictKeepId, recKeep)
      .run();

    await env.DB.prepare(
      `UPDATE sync_operations SET state = 'RETRY_WAIT', next_attempt_at = datetime('now', '+1 hour')
       WHERE operation_id = ?`,
    )
      .bind(opIdKeep)
      .run();

    const credKeep = await generateAdminCredential({
      adminId: "admin:secretaria_homolog",
      conflictId: conflictKeepId,
      chosenResolution: "KEEP_LOCAL",
      expectedLocalRevision: 1,
      secret: ADMIN_SECRET,
    });

    const resKeep = await applyAdminConflictResolution(env.DB, {
      conflictId: conflictKeepId,
      authCredential: credKeep,
      chosenResolution: "KEEP_LOCAL",
      justification: "Manter documento validado na secretaria (valor 1)",
      expectedLocalRevision: 1,
    });
    expect(resKeep.success).toBe(true);

    // Operação foi imediatamente reabilitada para PENDING e o Outbound a despacha com sucesso
    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-c6-keep",
      integrationId: INTEGRACAO_999_ID,
    });
    const batchKeep = await orchestrator.executeBatch();
    expect(batchKeep.observedCount).toBe(1);
    expect(adapter.getFieldValue(SPREADSHEET_999_ID, TAB_FACE_CONTROL, alunoKeep.ra, "residencia")).toBe(1);

    const orphanOpsKeep = await env.DB.prepare(
      `SELECT count(*) as total FROM sync_operations WHERE record_id = ? AND state != 'OBSERVED'`,
    )
      .bind(recKeep)
      .first<{ total: number }>();
    expect(orphanOpsKeep?.total).toBe(0);
  });

  // =========================================================================
  // CENÁRIO 7: Operação outbound para período em PAUSED ou CAPTURE
  // =========================================================================
  it("Cenário 7: Operação outbound para período em PAUSED (999) ou CAPTURE (2027-1) -> bloqueio obrigatório impede qualquer escrita na planilha", async () => {
    // 1. Cria operação pendente no período 999 e em seguida coloca a integração 999 em PAUSED
    const aluno999 = ALUNOS_FICTICIOS_999[0];
    const rec999 = `rec-${PERIODO_999_ID}-${aluno999.groupKey}-${aluno999.ra}`;
    const op999Id = `op-c7-paused-${aluno999.ra}`;
    const mut999 = await executeFieldMutation(env.DB, {
      commandId: `cmd-c7-paused-${aluno999.ra}`,
      actorId: "user:secretaria",
      recordId: rec999,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno999.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: op999Id,
    });
    expect(mut999.ok).toBe(true);

    await env.DB.prepare(`UPDATE sync_integrations SET mode = 'PAUSED' WHERE integration_id = ?`)
      .bind(INTEGRACAO_999_ID)
      .run();

    // 2. Configura o período 2027-1 em modo CAPTURE com operação pendente na outbox
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, status)
       VALUES (?, '2027-1', 'ATIVO')`,
    )
      .bind(PERIODO_2027_1_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
       VALUES (?, ?, ?, 1, 1, 'CAPTURE')`,
    )
      .bind(INTEGRACAO_2027_1_ID, PERIODO_2027_1_ID, SPREADSHEET_2027_1_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO google_sheets_periodos (
         periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
         aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
       ) VALUES (?, ?, ?, ?, ?, ?, 'CANC_FACE', 'CANC_FCH')`,
    )
      .bind(
        PERIODO_2027_1_ID,
        SPREADSHEET_2027_1_ID,
        TAB_FACE_GENERAL,
        TAB_FCH_GENERAL,
        TAB_FACE_CONTROL,
        TAB_FCH_CONTROL,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (2027101, ?, '0090001001', 'Aluno 2027-1 Protegido', 'ADMINISTRAÇÃO', 'FACE FEA', 'ATIVO')`,
    )
      .bind(PERIODO_2027_1_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (2027101, 0, 0, 0, 0, 0, 0, 0)`,
    ).run();

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId: PERIODO_2027_1_ID,
      integrationId: INTEGRACAO_2027_1_ID,
      actorId: "seed:test-2027",
      targetRas: ["0090001001"],
    });

    const rec2027 = `rec-${PERIODO_2027_1_ID}-FACE_FEA-0090001001`;
    const op2027Id = "op-c7-capture-2027";
    const mut2027 = await executeFieldMutation(env.DB, {
      commandId: "cmd-c7-capture-2027",
      actorId: "user:secretaria",
      recordId: rec2027,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_2027_1_ID,
      periodoId: PERIODO_2027_1_ID,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: op2027Id,
    });
    expect(mut2027.ok).toBe(true);
    adapter.setStudentRow(SPREADSHEET_2027_1_ID, TAB_FACE_CONTROL, "0090001001", { identidade: 0 });

    // 3. Tenta rodar o ciclo automático coordenado (cron)
    const cycleRes = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      customAdapter: adapter,
    });

    const report999 = cycleRes.relatorios.find((i) => i.integrationId === INTEGRACAO_999_ID);
    const report2027 = cycleRes.relatorios.find((i) => i.integrationId === INTEGRACAO_2027_1_ID);

    // 999 (PAUSED) deve ser ignorado com SKIPPED_NOT_ELIGIBLE; 2027-1 (CAPTURE) roda apenas Inbound (outboundReport === undefined)
    expect(report999?.status).toBe("SKIPPED_NOT_ELIGIBLE");
    expect(report2027?.status).toBe("SUCCESS");
    expect(report2027?.outboundReport).toBeUndefined();

    // 4. Tenta forçar diretamente o SyncV2Orchestrator (executeBatch e processPendingOperation)
    const directOrchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-c7-direct",
    });

    const batchDirect = await directOrchestrator.executeBatch();
    expect(batchDirect.processedCount).toBe(0);

    const direct999 = await directOrchestrator.processPendingOperation(
      op999Id,
      new Date().toISOString(),
    );
    const direct2027 = await directOrchestrator.processPendingOperation(
      op2027Id,
      new Date().toISOString(),
    );

    expect(direct999.status).toBe("SKIPPED_NOT_ELIGIBLE");
    expect(direct2027.status).toBe("SKIPPED_NOT_ELIGIBLE");

    // GARANTIA ABSOLUTA: ZERO chamadas de escrita na planilha 999 (PAUSED) e na planilha 2027-1 (CAPTURE)!
    expect(adapter.writeCalls).toHaveLength(0);
    expect(adapter.getFieldValue(SPREADSHEET_2027_1_ID, TAB_FACE_CONTROL, "0090001001", "identidade")).toBe(0);
  });

  // =========================================================================
  // CENÁRIO 8: Reprocessamento após falha ou reinício do Worker
  // =========================================================================
  it("Cenário 8: Reprocessamento após falha ou reinício do Worker -> recupera leases expirados com segurança e idempotência", async () => {
    const aluno1 = ALUNOS_FICTICIOS_999[0]; // 0090001001 — operação presa em CLAIMED
    const aluno2 = ALUNOS_FICTICIOS_999[1]; // 0090001002 — operação presa em DISPATCHED (efeito já gravado no Sheets)
    const aluno3 = ALUNOS_FICTICIOS_999[2]; // 0090002001 — operação presa em VERIFYING (efeito NÃO gravado no Sheets)

    const rec1 = `rec-${PERIODO_999_ID}-${aluno1.groupKey}-${aluno1.ra}`;
    const rec2 = `rec-${PERIODO_999_ID}-${aluno2.groupKey}-${aluno2.ra}`;
    const rec3 = `rec-${PERIODO_999_ID}-${aluno3.groupKey}-${aluno3.ra}`;

    const op1 = `op-c8-1-${aluno1.ra}`;
    const op2 = `op-c8-2-${aluno2.ra}`;
    const op3 = `op-c8-3-${aluno3.ra}`;

    const mut1 = await executeFieldMutation(env.DB, {
      commandId: `cmd-c8-1-${aluno1.ra}`,
      actorId: "user:secretaria",
      recordId: rec1,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno1.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: op1,
    });
    const mut2 = await executeFieldMutation(env.DB, {
      commandId: `cmd-c8-2-${aluno2.ra}`,
      actorId: "user:secretaria",
      recordId: rec2,
      fieldKey: "cpf_documento",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno2.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: op2,
    });
    const mut3 = await executeFieldMutation(env.DB, {
      commandId: `cmd-c8-3-${aluno3.ra}`,
      actorId: "user:secretaria",
      recordId: rec3,
      fieldKey: "certidao",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: INTEGRACAO_999_ID,
      periodoId: PERIODO_999_ID,
      groupKey: aluno3.groupKey,
      generation: 1,
      expectedEpoch: 1,
      operationIdControle: op3,
    });
    expect(mut1.ok).toBe(true);
    expect(mut2.ok).toBe(true);
    expect(mut3.ok).toBe(true);

    // Simula Worker anterior ("worker-crashed") que adquiriu leases e morreu há 5 minutos
    const pastClaimTime = "2026-01-01 10:00:00";
    await env.DB.prepare(
      `UPDATE sync_operations SET next_attempt_at = '2026-01-01 09:59:00' WHERE operation_id IN (?, ?, ?)`,
    )
      .bind(op1, op2, op3)
      .run();

    const c1 = await claimOperation(env.DB, {
      operationId: op1,
      workerId: "worker-crashed",
      leaseDurationSeconds: 30,
      now: pastClaimTime,
    });
    expect(c1.ok).toBe(true);

    const c2 = await claimOperation(env.DB, {
      operationId: op2,
      workerId: "worker-crashed",
      leaseDurationSeconds: 30,
      now: pastClaimTime,
    });
    expect(c2.ok).toBe(true);
    if (c2.ok) {
      await dispatchOperation(env.DB, {
        operationId: op2,
        workerId: "worker-crashed",
        leaseEpoch: c2.leaseEpoch,
        payloadText: JSON.stringify(c2.payload),
        now: pastClaimTime,
      });
    }
    // Para op2 (DISPATCHED), simula que a escrita chegou a ser aplicada no Sheets antes da queda do worker!
    adapter.setStudentRow(SPREADSHEET_999_ID, TAB_FACE_CONTROL, aluno2.ra, { cpf_documento: 1 });

    // Para op3, simula que o worker caiu durante VERIFYING e o efeito NÃO estava no Sheets
    await env.DB.prepare(
      `UPDATE sync_operations
       SET state = 'VERIFYING', lease_owner = 'worker-crashed', lease_epoch = 2,
           lease_until = '2026-01-01 10:01:00', next_attempt_at = '2026-01-01 10:00:00'
       WHERE operation_id = ?`,
    )
      .bind(op3)
      .run();

    // 1. Novo Worker reinicia e executa lote de recuperação
    const recoveryWorker = new SyncV2Orchestrator({
      db: env.DB,
      adapter,
      workerId: "worker-restarted",
      integrationId: INTEGRACAO_999_ID,
    });

    const batch1 = await recoveryWorker.executeBatch();

    // Confirma recuperação dos leases expirados:
    // - op1 (CLAIMED expirado) -> recuperado para RETRY_WAIT com backoff de segurança (+10s)
    // - op2 (DISPATCHED expirado -> UNCERTAIN) -> reconciliado imediatamente por releitura (OBSERVED_VIA_VERIFY) SEM reescrever!
    // - op3 (VERIFYING expirado -> UNCERTAIN) -> verificado ausente por releitura e agendado para RETRY_WAIT (RETRY_SCHEDULED)
    expect(batch1.recoveredLeases.recoveredClaimed).toBe(1);
    expect(batch1.recoveredLeases.recoveredDispatchedToUncertain).toBe(1);
    expect(batch1.recoveredLeases.recoveredVerifyingToUncertain).toBe(1);
    expect(batch1.processedCount).toBe(2); // op2 e op3 (ambos em UNCERTAIN)
    expect(batch1.observedCount).toBe(1); // op2 (OBSERVED_VIA_VERIFY)
    expect(batch1.retryScheduledCount).toBe(1); // op3 (RETRY_SCHEDULED)

    // NENHUMA escrita foi repetida na 1ª rodada (op2 foi confirmada via releitura sem duplicar escrita!)
    expect(adapter.writeCalls).toHaveLength(0);
    expect(adapter.verifyCalls).toHaveLength(2);

    // 2. Avança o relógio do backoff de op1 e op3 e executa 2ª rodada para concluir ambos
    await env.DB.prepare(
      `UPDATE sync_operations SET next_attempt_at = datetime('now', '-1 second') WHERE operation_id IN (?, ?)`,
    )
      .bind(op1, op3)
      .run();

    const batch2 = await recoveryWorker.executeBatch();
    expect(batch2.processedCount).toBe(2);
    expect(batch2.observedCount).toBe(2);
    expect(adapter.writeCalls).toHaveLength(2); // op1 + op3 gravados exatamente 1 vez cada

    // 3. Idempotência: 3ª rodada imediata não processa nada e não gera escritas extras
    const batch3 = await recoveryWorker.executeBatch();
    expect(batch3.processedCount).toBe(0);
    expect(adapter.writeCalls).toHaveLength(2);
  });
});
