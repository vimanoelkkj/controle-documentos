/**
 * ============================================================================
 * Suíte de Testes — Sincronização Inbound V2 (Google Sheets → D1)
 * ============================================================================
 * Valida a captura de alterações feitas diretamente nas planilhas Google Sheets:
 *  - Marcação e desmarcação diretamente na planilha.
 *  - Ingestão sem operação local pendente (EXTERNAL_AHEAD).
 *  - Idempotência e ausência de duplicação em releituras consecutivas.
 *  - Concorrência entre site e planilha: abertura de conflito F3 contra outbox pendente.
 *  - Resiliência com alunos ausentes no D1 e RAs duplicados na planilha.
 *  - Preservação estrita de zeros à esquerda em RAs textuais.
 *  - Isolamento entre períodos e grupos FACE_FEA / FCH_EAD.
 *  - Falha graciosa em layout inesperado sem corrupção de banco.
 *  - Ausência total de eco de outbox para a planilha.
 *  - Proteção por feature flag e modo de integração (desativado por padrão).
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  reconcileInboundFromSpreadsheet,
} from "../src/server/services/sync-inbound-reconciler";
import { handleSyncV2AdminRoute } from "../src/server/routes/sync-v2-admin";
import {
  initSyncRecord,
  establishFieldBaseline,
  executeFieldMutation,
  type GroupKey,
  type FieldKey,
} from "../src/server/services/sync-d1-core";
import {
  EXPECTED_CONTROL_HEADERS,
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type GeneralTabReadResult,
  type WriteResult,
  type ExternalEffectCheckResult,
} from "../src/server/services/sync-sheet-contracts";
import type { UsuarioSessao } from "../src/server/routes/auth";

let testSeq = 1;
const proximoId = () => 8000 + testSeq++;

class MockInboundAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-inbound-adapter";
  public sheets: Map<string, Map<string, unknown[][]>> = new Map();
  public duplicateRasOverride: string[] = [];

  setSheetData(spreadsheetId: string, tabName: string, grid: unknown[][]) {
    if (!this.sheets.has(spreadsheetId)) {
      this.sheets.set(spreadsheetId, new Map());
    }
    this.sheets.get(spreadsheetId)!.set(tabName, JSON.parse(JSON.stringify(grid)));
  }

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    if (!grid) {
      throw new Error(`Aba '${params.tabName}' não encontrada na planilha '${params.spreadsheetId}'`);
    }

    const header = (grid[0] || []).map((c) => String(c ?? ""));
    const headerCtoI = header.slice(2, 9);
    for (let idx = 0; idx < EXPECTED_CONTROL_HEADERS.length; idx++) {
      if ((headerCtoI[idx] || "").trim().toUpperCase() !== EXPECTED_CONTROL_HEADERS[idx]) {
        const err: any = new Error(`STRUCTURAL_LAYOUT_MUTATED: cabeçalho divergente`);
        err.status = "LAYOUT_MUTATED";
        throw err;
      }
    }

    const rowsByRa = new Map();
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i] || [];
      const ra = String(row[0] ?? "").trim();
      if (!ra) continue;

      const fields: any = {};
      const fieldKeys: FieldKey[] = [
        "identidade",
        "cpf_documento",
        "certidao",
        "residencia",
        "titulo",
        "ensino_medio",
        "contrato",
      ];

      for (let f = 0; f < fieldKeys.length; f++) {
        const key = fieldKeys[f];
        const raw = row[2 + f];
        let normalized: 0 | 1 | null = null;
        if (raw !== null && raw !== undefined && raw !== "") {
          const s = String(raw).trim().toUpperCase();
          if (["1", "SIM", "OK", "TRUE", "VERDADEIRO"].includes(s)) normalized = 1;
          else if (["0", "NAO", "NÃO", "PENDENTE", "FALSE", "FALSO"].includes(s)) normalized = 0;
        }
        fields[key] = {
          rawValue: String(raw ?? ""),
          normalizedValue: normalized,
          cellCoordinate: `${String.fromCharCode(67 + f)}${i + 1}`,
        };
      }

      rowsByRa.set(ra, {
        rowIndex: i + 1,
        raText: ra,
        fields,
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: headerCtoI.join("::"),
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [...this.duplicateRasOverride],
    };
  }

  async readGeneralTab(): Promise<GeneralTabReadResult> {
    throw new Error("Não utilizado no inbound documental C:I");
  }

  async writeDocumentField(): Promise<WriteResult> {
    throw new Error("writeDocumentField não deve ser chamado durante a ingestão inbound");
  }

  async verifyExternalEffect(): Promise<ExternalEffectCheckResult> {
    throw new Error("verifyExternalEffect não deve ser chamado durante a ingestão inbound");
  }
}

async function createEvidence(
  source: "SPREADSHEET_IMPORT" | "MANUAL_INITIALIZATION" | "LEGACY_MIGRATION",
  payload: string,
) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { source, evidencePayload: payload, evidenceHash: hash };
}

async function setupAmbienteInbound() {
  const pId = proximoId();
  const periodoCodigo = `2026-INBOUND-${pId}`;
  await env.DB.prepare(`INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`)
    .bind(pId, periodoCodigo).run();

  const intId = `integ-inbound-${pId}`;
  const sheetId = `sheet-inbound-${pId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
     VALUES (?, ?, ?, 1, 1, 'BIDIRECTIONAL')`,
  ).bind(intId, pId, sheetId).run();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO google_sheets_periodos (
      periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
      aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
    ) VALUES (?, ?, 'BASE_FACE', 'BASE_FCH', 'CONTROLE DE DOCUMENTOS FACE FEA', 'CONTROLE DE DOCUMENTOS FCH EAD', 'CANC_FACE', 'CANC_FCH')`,
  ).bind(pId, sheetId).run();

  return { periodoId: pId, integrationId: intId, spreadsheetId: sheetId };
}

async function criarAlunoD1(params: {
  periodoId: number;
  ra: string;
  nome: string;
  unidade: string;
  docsIniciais: Partial<Record<FieldKey, 0 | 1>>;
  integrationId?: string;
  groupKey?: GroupKey;
}) {
  const {
    periodoId,
    ra,
    nome,
    unidade,
    docsIniciais,
    integrationId,
    groupKey = "FACE_FEA",
  } = params;
  const aId = proximoId();

  await env.DB.prepare(
    `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
     VALUES (?, ?, ?, ?, 'CURSO TESTE', ?, 'ATIVO')`,
  ).bind(aId, periodoId, ra, nome, unidade).run();

  await env.DB.prepare(
    `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    aId,
    docsIniciais.identidade ?? 0,
    docsIniciais.cpf_documento ?? 0,
    docsIniciais.certidao ?? 0,
    docsIniciais.residencia ?? 0,
    docsIniciais.titulo ?? 0,
    docsIniciais.ensino_medio ?? 0,
    docsIniciais.contrato ?? 0,
  ).run();

  if (integrationId) {
    const recordId = `rec-${periodoId}-${groupKey}-${ra}`;
    await initSyncRecord(env.DB, {
      recordId,
      integrationId,
      raText: ra,
      groupKey,
      alunoId: aId,
      generation: 1,
      lifecycle: "ACTIVE",
    });

    const fieldKeys: FieldKey[] = [
      "identidade",
      "cpf_documento",
      "certidao",
      "residencia",
      "titulo",
      "ensino_medio",
      "contrato",
    ];

    for (const f of fieldKeys) {
      const val = docsIniciais[f] ?? 0;
      const evidence = await createEvidence(
        "LEGACY_MIGRATION",
        JSON.stringify({ alunoId: aId, field: f, val }),
      );
      const bRes = await establishFieldBaseline(env.DB, {
        commandId: `cmd-base-${recordId}-${f}`,
        actorId: "setup-test",
        recordId,
        fieldKey: f,
        baselineValue: val,
        integrationId,
        periodoId,
        groupKey,
        generation: 1,
        expectedEpoch: 1,
        evidence,
      });
      if (!bRes.ok) {
        throw new Error(`Falha no baseline de ${f}: ${bRes.status}`);
      }
    }
  }

  return { alunoId: aId };
}

function montarGridAbaControle(linhasAlunos: Array<{ ra: string; nome: string; docs: Record<string, string> }>) {
  const header = [
    "RA",
    "NOME DO ALUNO",
    ...EXPECTED_CONTROL_HEADERS,
    "TOTAL ENTREGUES",
    "STATUS DOCUMENTAL",
  ];

  const grid: unknown[][] = [header];
  for (const a of linhasAlunos) {
    grid.push([
      a.ra,
      a.nome,
      a.docs.identidade || "PENDENTE",
      a.docs.cpf_documento || "PENDENTE",
      a.docs.certidao || "PENDENTE",
      a.docs.residencia || "PENDENTE",
      a.docs.titulo || "PENDENTE",
      a.docs.ensino_medio || "PENDENTE",
      a.docs.contrato || "PENDENTE",
      '=CONT.SE(C2:I2; VERDADEIRO) + CONT.SE(C2:I2; "OK")',
      '=SE(J2=7; "COMPLETO"; "PENDENTE")',
    ]);
  }
  return grid;
}

const mockAdminUser: UsuarioSessao = {
  id: 1,
  nome: "Admin Teste",
  email: "admin@fumec.br",
  username: "adm_inbound",
  perfil: "ADMIN",
};

describe("Sincronização Inbound V2 (Google Sheets → D1)", { timeout: 15000 }, () => {
  it("1. Ingestão sem operação pendente: captura marcação (0 -> 1) feita diretamente no Sheets sem eco", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const ra = "0090001001";
    const { alunoId } = await criarAlunoD1({
      periodoId,
      ra,
      nome: "Aluno Inbound Alfa",
      unidade: "FACE FEA",
      docsIniciais: { identidade: 0, contrato: 0 },
      integrationId,
    });

    const adapter = new MockInboundAdapter();
    // Na planilha, o RG (identidade) e o Contrato foram marcados como TRUE
    const grid = montarGridAbaControle([
      {
        ra,
        nome: "Aluno Inbound Alfa",
        docs: { identidade: "TRUE", contrato: "VERDADEIRO" },
      },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", grid);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(true);
    expect(report.camposAtualizadosNoD1).toBe(2);
    expect(report.conflitosDetectados).toBe(0);

    // Confirma atualização na tabela de visualização do site `documentos`
    const docDb = await env.DB.prepare(`SELECT identidade, contrato FROM documentos WHERE aluno_id = ?`)
      .bind(alunoId).first<{ identidade: number; contrato: number }>();
    expect(docDb?.identidade).toBe(1);
    expect(docDb?.contrato).toBe(1);

    // Confirma atualização em sync_field_state
    const stateDb = await env.DB.prepare(
      `SELECT value, revision, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
    ).bind(`rec-${periodoId}-FACE_FEA-${ra}`).first<{ value: number; revision: number; status: string }>();
    expect(stateDb?.value).toBe(1);
    expect(stateDb?.status).toBe("CONFIRMED");

    // GARANTIA CRÍTICA DE AUSÊNCIA DE ECO: nenhuma operação pendente de outbox para a planilha
    const outboxOps = await env.DB.prepare(
      `SELECT count(*) as total FROM sync_operations WHERE record_id = ? AND state = 'PENDING'`,
    ).bind(`rec-${periodoId}-FACE_FEA-${ra}`).first<{ total: number }>();
    expect(outboxOps?.total).toBe(0);
  });

  it("2. Desmarcação feita diretamente no Sheets: atualiza de 1 para 0 no D1", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const ra = "0090001002";
    const { alunoId } = await criarAlunoD1({
      periodoId,
      ra,
      nome: "Aluno Inbound Beta",
      unidade: "FACE FEA",
      docsIniciais: { titulo: 1 },
      integrationId,
    });

    const recordId = `rec-${periodoId}-FACE_FEA-${ra}`;

    const adapter = new MockInboundAdapter();
    // Na planilha, o documento TÍTULO foi desmarcado para FALSE
    const grid = montarGridAbaControle([
      {
        ra,
        nome: "Aluno Inbound Beta",
        docs: { titulo: "FALSE" },
      },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", grid);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(true);
    expect(report.camposAtualizadosNoD1).toBe(1);

    const docDb = await env.DB.prepare(`SELECT titulo FROM documentos WHERE aluno_id = ?`)
      .bind(alunoId).first<{ titulo: number }>();
    expect(docDb?.titulo).toBe(0);

    const stateDb = await env.DB.prepare(
      `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`,
    ).bind(recordId).first<{ value: number; revision: number }>();
    expect(stateDb?.value).toBe(0);
    expect(stateDb?.revision).toBe(1);
  });

  it("3. Idempotência estrita: releitura consecutiva sem alterações é no-op seguro", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const ra = "0090001003";
    await criarAlunoD1({
      periodoId,
      ra,
      nome: "Aluno Inbound Gama",
      unidade: "FACE FEA",
      docsIniciais: { certidao: 0 },
      integrationId,
    });

    const adapter = new MockInboundAdapter();
    const grid = montarGridAbaControle([
      { ra, nome: "Aluno Inbound Gama", docs: { certidao: "OK" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", grid);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    // Primeira execução: aplica mutação
    const report1 = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });
    expect(report1.camposAtualizadosNoD1).toBe(1);

    // Segunda execução imediata com a mesma planilha: 0 atualizações e 1 em sincronia
    const report2 = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });
    expect(report2.camposAtualizadosNoD1).toBe(0);
    expect(report2.camposEmSincronia).toBeGreaterThanOrEqual(1);
    expect(report2.conflitosDetectados).toBe(0);
  });

  it("4. Concorrência entre site e planilha: abre conflito F3 contra operação pendente na outbox sem sobrescrever", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const ra = "0090001004";
    await criarAlunoD1({
      periodoId,
      ra,
      nome: "Aluno Inbound Delta",
      unidade: "FACE FEA",
      docsIniciais: { residencia: 0 },
      integrationId,
    });

    const recordId = `rec-${periodoId}-FACE_FEA-${ra}`;

    // Simula uma mutação documental realizada pelo site que gerou outbox PENDING
    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-conc-${ra}`,
      actorId: "user:secretaria",
      recordId,
      fieldKey: "residencia",
      fromRevision: 0,
      proposedValue: 1,
      integrationId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    const adapter = new MockInboundAdapter();
    // Na planilha, o documento residência foi marcado com valor divergente (FALSE) enquanto a outbox tem PENDING (1)
    const grid = montarGridAbaControle([
      { ra, nome: "Aluno Inbound Delta", docs: { residencia: "FALSE" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", grid);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    // Detectou o conflito e NÃO sobrescreveu a alteração local
    expect(report.conflitosDetectados).toBe(1);
    expect(report.camposAtualizadosNoD1).toBe(0);
    expect(report.divergenciasComOutboxPendente).toHaveLength(1);
    expect(report.divergenciasComOutboxPendente[0].statusOperacaoLocal).toBe("PENDING");

    // Conflito formalmente registrado na tabela de auditoria F3
    const conflito = await env.DB.prepare(
      `SELECT reason, resolved FROM sync_conflicts WHERE record_id = ? AND field_key = 'residencia'`,
    ).bind(recordId).first<{ reason: string; resolved: number }>();
    expect(conflito?.reason).toBe("DIVERGENCIA_COM_OPERACAO_PENDENTE");
    expect(conflito?.resolved).toBe(0);
  });

  it("5. Alunos ausentes no D1 e RAs duplicados na planilha são isolados com segurança", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const adapter = new MockInboundAdapter();

    // Aluno ausente no D1: '0090009999'
    // Aluno duplicado na planilha: '0090008888'
    adapter.duplicateRasOverride = ["0090008888"];

    const grid = montarGridAbaControle([
      { ra: "0090009999", nome: "Fantasma", docs: { identidade: "TRUE" } },
      { ra: "0090008888", nome: "Duplicado A", docs: { identidade: "TRUE" } },
      { ra: "0090008888", nome: "Duplicado B", docs: { identidade: "TRUE" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", grid);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(true);
    expect(report.alunosNaoEncontradosNoD1).toContain("0090009999");
    expect(report.alunosDuplicadosNaPlanilha).toContain("0090008888");
    expect(report.camposAtualizadosNoD1).toBe(0);
  });

  it("6. Endpoint Administrativo POST /api/periodos/:id/sync-v2/inbound: executa com autorização estrita", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const ra = "0090002001";
    const { alunoId } = await criarAlunoD1({
      periodoId,
      ra,
      nome: "Aluno FCH Inbound",
      unidade: "FCH EAD",
      docsIniciais: { ensino_medio: 0 },
      integrationId,
      groupKey: "FCH_EAD",
    });

    const adapter = new MockInboundAdapter();
    const gridFch = montarGridAbaControle([
      { ra, nome: "Aluno FCH Inbound", docs: { ensino_medio: "SIM" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", montarGridAbaControle([]));
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", gridFch);

    // 1. Rejeita se SYNC_V2_ENABLED for false
    const resDisabled = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/inbound`, { method: "POST" }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/inbound`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "false" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });
    expect(resDisabled?.status).toBe(503);

    // 2. Rejeita sem perfil de ADMIN
    const resUser = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/inbound`, { method: "POST" }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/inbound`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: { ...mockAdminUser, perfil: "VISUALIZADOR" as any },
      podeEditar: false,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });
    expect(resUser?.status).toBe(403);

    // 3. Execução autorizada com sucesso via admin
    const resSuccess = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/inbound`, { method: "POST" }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/inbound`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });
    expect(resSuccess?.status).toBe(200);
    const json = (await resSuccess?.json()) as any;
    expect(json.sucesso).toBe(true);
    expect(json.report.camposAtualizadosNoD1).toBe(1);

    const docDb = await env.DB.prepare(`SELECT ensino_medio FROM documentos WHERE aluno_id = ?`)
      .bind(alunoId).first<{ ensino_medio: number }>();
    expect(docDb?.ensino_medio).toBe(1);
  });

  it("7. Falha de layout é isolada por grupo sem crash geral", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteInbound();
    const adapter = new MockInboundAdapter();

    // FACE com cabeçalho inválido / corrompido
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", [["CABEÇALHO_INVALIDO"]]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridAbaControle([]));

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(false);
    expect(report.errosLayout).toHaveLength(1);
    expect(report.errosLayout[0].groupKey).toBe("FACE_FEA");
    expect(report.errosLayout[0].erro).toContain("LAYOUT_MUTATED");
  });
});
