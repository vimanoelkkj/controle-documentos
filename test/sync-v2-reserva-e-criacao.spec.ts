import { describe, expect, it } from "vitest";
import { reconcileInboundFromSpreadsheet } from "../src/server/services/sync-inbound-reconciler";
import {
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";
import {
  EXPECTED_CONTROL_HEADERS,
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type GeneralTabReadResult,
  type WriteResult,
  type ExternalEffectCheckResult,
} from "../src/server/services/sync-sheet-contracts";
import { env } from "cloudflare:test";

const GENERAL_TAB_OFFICIAL_HEADERS = [
  "Contrato",
  "Cpf",
  "Curso",
  "E-mail (outro)",
  "E-mail",
  "Nome",
  "RA",
  "Situação do aluno",
  "Docs Pendentes",
];

class MockTestAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-test-adapter";
  private sheets = new Map<string, unknown[][]>();

  setSheetData(tabName: string, grid: unknown[][]) {
    this.sheets.set(tabName, grid);
  }

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const grid = this.sheets.get(params.tabName) || [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
    ];
    const rowsByRa = new Map<string, any>();
    const header = (grid[0] || []).map((h) => String(h ?? ""));

    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const ra = String(row[0] ?? "").trim();
      const nome = String(row[1] ?? "").trim();
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
        const raw = row[2 + f];
        let normalized: 0 | 1 | null = null;
        if (raw !== null && raw !== undefined && raw !== "") {
          const s = String(raw).trim().toUpperCase();
          if (["1", "SIM", "OK", "TRUE", "VERDADEIRO"].includes(s)) normalized = 1;
          else if (["0", "NAO", "NÃO", "FALSE", "FALSO"].includes(s)) normalized = 0;
        }
        fields[fieldKeys[f]] = {
          rawValue: String(raw ?? ""),
          normalizedValue: normalized,
          cellCoordinate: `${String.fromCharCode(67 + f)}${i + 1}`,
        };
      }
      rowsByRa.set(ra, { rowIndex: i + 1, raText: ra, studentName: nome, fields });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: header.slice(2, 9).join("::"),
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [],
    };
  }

  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const grid = this.sheets.get(params.tabName);
    const rowsByRa = new Map<string, any>();
    if (grid) {
      for (let i = 1; i < grid.length; i++) {
        const row = grid[i];
        // Coluna H (idx 7): Situação do aluno, Coluna C (idx 2): Curso, Coluna G (idx 6): RA
        const situacao = row.length >= 8 ? String(row[7] ?? "").trim() : String(row[0] ?? "").trim();
        const curso = row.length >= 3 ? String(row[2] ?? "").trim() : String(row[1] ?? "").trim();
        const ra = String(row[6] ?? "").trim();
        if (ra) {
          rowsByRa.set(ra, {
            rowIndex: i + 1,
            raText: ra,
            contractRawValue: situacao,
            courseName: curso,
            cellCoordinate: row.length >= 8 ? `H${i + 1}` : `A${i + 1}`,
          });
        }
      }
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: "HEADER",
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [],
    };
  }

  async writeDocumentField(): Promise<WriteResult> {
    throw new Error("No write");
  }

  async verifyExternalEffect(): Promise<ExternalEffectCheckResult> {
    throw new Error("No verify");
  }

  async generateProvenanceEvidence(): Promise<any> {
    throw new Error("No provenance");
  }
}

let seq = 80000;
function nextId() {
  return seq++;
}

async function setupPeriodoEnv() {
  const pId = nextId();
  const intId = `integ-reserva-${pId}`;
  const spreadId = `sheet-reserva-${pId}`;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`,
  )
    .bind(pId, `2027-1-${pId}`)
    .run();

  await env.DB.prepare(
    `INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode, epoch, layout_revision)
     VALUES (?, ?, ?, 'BIDIRECTIONAL', 1, 1)`,
  )
    .bind(intId, pId, spreadId)
    .run();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO google_sheets_periodos (
      periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
      aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
    ) VALUES (?, ?, 'BASE_FACE_FEA', 'BASE_FCH_EAD', 'CONTROLE DE DOCUMENTOS FACE FEA', 'CONTROLE DE DOCUMENTOS FCH EAD', 'CANC_FACE', 'CANC_FCH')`,
  )
    .bind(pId, spreadId)
    .run();

  return { pId, intId, spreadId };
}

describe("Sincronização V2 — Regra Definitiva Coluna H: Em curso vs Reserva vs Outros", () => {
  it("Cenário Integrado Misturado na Mesma Aba: 'Em curso', 'Em curso - (Reserva de vaga)', 'Em Curso (reserva de vaga)', 'Trancado' e RA sem correspondência", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raEmCurso1 = "00055101"; // "Em curso" -> IMPORTAR
    const raEmCurso2 = "00055102"; // "em curso" (minúsculo) -> IMPORTAR
    const raReserva1 = "00055103"; // "Em curso - (Reserva de vaga)" -> NÃO IMPORTAR
    const raReserva2 = "00055104"; // "Em Curso (reserva de vaga)" -> NÃO IMPORTAR
    const raReserva3 = "00055105"; // "Em curso - reserva de vaga" -> NÃO IMPORTAR
    const raTrancado = "00055106"; // "Trancado" -> OUTRA SITUAÇÃO -> NÃO IMPORTAR
    const raSemGeral = "00055107"; // Não consta na aba geral -> NÃO IMPORTAR

    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raEmCurso1, "Aluno Em Curso 1", "0", "0", "0", "0", "0", "0", "0"],
      [raEmCurso2, "Aluno Em Curso 2", "1", "0", "0", "0", "0", "0", "0"],
      [raReserva1, "Aluno Reserva 1", "0", "0", "0", "0", "0", "0", "0"],
      [raReserva2, "Aluno Reserva 2", "0", "0", "0", "0", "0", "0", "0"],
      [raReserva3, "Aluno Reserva 3", "0", "0", "0", "0", "0", "0", "0"],
      [raTrancado, "Aluno Trancado", "0", "0", "0", "0", "0", "0", "0"],
      [raSemGeral, "Aluno Sem Correspondencia", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    // Aba Geral FACE FEA com Coluna G = RA e Coluna H = Situação do aluno
    adapter.setSheetData("BASE_FACE_FEA", [
      GENERAL_TAB_OFFICIAL_HEADERS,
      ["Não Entregue", "000.111.222-33", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 1", raEmCurso1, "Em curso", "TODOS"],
      ["Não Entregue", "000.111.222-34", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 2", raEmCurso2, "em curso", "TODOS"],
      ["Não Entregue", "000.111.222-35", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 3", raReserva1, "Em curso - (Reserva de vaga)", "TODOS"],
      ["Não Entregue", "000.111.222-36", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 4", raReserva2, "Em Curso (reserva de vaga)", "TODOS"],
      ["Não Entregue", "000.111.222-37", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 5", raReserva3, "Em curso - reserva de vaga", "TODOS"],
      ["Não Entregue", "000.111.222-38", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Nome 6", raTrancado, "Trancado", "TODOS"],
    ]);

    const report = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: true,
    });

    // 1. Elegíveis (Em curso): exatamente 2 alunos
    expect(report.alunosCriadosNoD1).toBe(2);

    // 2. Reserva de vaga (Regra 2): exatamente 3 alunos
    expect(report.alunosExcluidosPorReservaDeVaga).toHaveLength(3);
    expect(report.alunosExcluidosPorReservaDeVaga).toContain(raReserva1);
    expect(report.alunosExcluidosPorReservaDeVaga).toContain(raReserva2);
    expect(report.alunosExcluidosPorReservaDeVaga).toContain(raReserva3);

    // 3. Outras situações / sem correspondência (Regra 3): exatamente 2 alunos bloqueados
    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toHaveLength(2);
    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toContain(raTrancado);
    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toContain(raSemGeral);

    // Confirmação no D1: apenas os 2 alunos "Em curso" foram criados
    const criados = await env.DB.prepare(
      `SELECT ra FROM alunos WHERE periodo_id = ? ORDER BY ra ASC`,
    )
      .bind(pId)
      .all<{ ra: string }>();

    expect(criados.results.map((r) => r.ra)).toEqual([raEmCurso1, raEmCurso2]);
  });

  it("Preservação de Aluno Existente que entra em Reserva de Vaga na Coluna H", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raExistente = "00055201";

    // Insere previamente o aluno com todos os documentos pendentes (0)
    const ins = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, 'Aluno Antigo', 'ADMINISTRAÇÃO', 'FACE', 'ATIVO')`,
    )
      .bind(pId, raExistente)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(ins.meta.last_row_id)
      .run();

    // Na planilha, marcaram 1 para contrato na aba de controle
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raExistente, "Aluno Antigo", "0", "0", "0", "0", "0", "0", "1"],
    ]);

    // Na aba geral, a situação na coluna H mudou para "Em Curso (reserva de vaga)"
    adapter.setSheetData("BASE_FACE_FEA", [
      GENERAL_TAB_OFFICIAL_HEADERS,
      ["Não Entregue", "000.111.222-39", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Aluno Antigo", raExistente, "Em Curso (reserva de vaga)", "TODOS"],
    ]);

    const report = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: false,
    });

    expect(report.alunosExcluidosPorReservaDeVaga).toContain(raExistente);
    expect(report.camposAtualizadosNoD1).toBe(0);

    // Documento no D1 deve continuar inalterado (0)
    const doc = await env.DB.prepare(
      `SELECT d.contrato FROM documentos d
       JOIN alunos a ON a.id = d.aluno_id
       WHERE a.periodo_id = ? AND a.ra = ?`,
    )
      .bind(pId, raExistente)
      .first<{ contrato: number }>();
    expect(doc?.contrato).toBe(0);
  });

  it("Idempotência e Preservação dos 4 Alunos Fictícios do Período 999", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    // Cria os 4 alunos no período 999
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (999, '999', 'ATIVO')`,
    ).run();

    const ras999 = ["00099901", "00099902", "00099903", "00099904"];
    for (const r of ras999) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO alunos (periodo_id, ra, nome, curso, unidade, status)
         VALUES (999, ?, 'Ficticio 999', 'CURSO 999', 'FACE', 'ATIVO')`,
      )
        .bind(r)
        .run();
    }

    const raValido = "00055301";
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raValido, "Aluno Elegivel", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    adapter.setSheetData("BASE_FACE_FEA", [
      GENERAL_TAB_OFFICIAL_HEADERS,
      ["Não Entregue", "000.111.222-40", "ADMINISTRAÇÃO", "email@test.com", "inst@test.com", "Aluno Elegivel", raValido, "Em curso", "TODOS"],
    ]);

    // Execução 1
    const r1 = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: true,
    });
    expect(r1.alunosCriadosNoD1).toBe(1);

    // Execução 2 (repetição)
    const r2 = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: true,
    });
    expect(r2.alunosCriadosNoD1 || 0).toBe(0);
    expect(r2.camposEmSincronia).toBe(7);

    // Os 4 alunos do período 999 continuam intactos
    const total999 = await env.DB.prepare(
      `SELECT COUNT(*) as t FROM alunos WHERE periodo_id = 999`,
    ).first<{ t: number }>();
    expect(total999?.t).toBe(4);
  });
});
