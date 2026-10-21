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
        const situacao = String(row[0] ?? "").trim();
        const curso = String(row[1] ?? "").trim();
        const ra = String(row[6] ?? "").trim();
        if (ra) {
          rowsByRa.set(ra, {
            rowIndex: i + 1,
            raText: ra,
            contractRawValue: situacao,
            courseName: curso,
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

let seq = 70000;
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

describe("Sincronização V2 — Regras de Reserva de Vaga, Situação Desconhecida e Criação Idempotente", () => {
  it("Regra 1: RESERVA DE VAGA — Não importa nem cria novo aluno no D1", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raReserva = "00055001";
    // Aba de Controle FACE FEA
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raReserva, "Aluno Candidato Reserva", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    // Aba Geral FACE FEA
    // Col A: Situação, Col B: Curso, Col C..F: diversos, Col G (idx 6): RA
    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["RESERVA DE VAGA", "ADMINISTRAÇÃO", "", "", "", "", raReserva],
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

    // Deve excluir e reportar na lista de reservas
    expect(report.alunosExcluidosPorReservaDeVaga).toContain(raReserva);
    expect(report.alunosCriadosNoD1).toBe(0);

    // Confirma que não foi inserido no D1
    const aluno = await env.DB.prepare(
      `SELECT * FROM alunos WHERE periodo_id = ? AND ra = ?`,
    )
      .bind(pId, raReserva)
      .first();
    expect(aluno).toBeNull();
  });

  it("Regra 2: RESERVA DE VAGA — Aluno existente que entra em reserva não é atualizado no D1", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raExistente = "00055002";

    // Cria aluno existente previamente no D1 com 0 em todos os documentos
    const insertAluno = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, 'Aluno Já Existente', 'ADMINISTRAÇÃO', 'FACE', 'ATIVO')`,
    )
      .bind(pId, raExistente)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(insertAluno.meta.last_row_id)
      .run();

    // Na planilha de controle, alguém marcou '1' para identidade
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raExistente, "Aluno Já Existente", "1", "0", "0", "0", "0", "0", "0"],
    ]);

    // Mas na aba geral, sua situação mudou para 'RESERVA DE VAGA'
    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["RESERVA DE VAGA", "ADMINISTRAÇÃO", "", "", "", "", raExistente],
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

    // Documento no D1 deve continuar intacto (0, não atualizado para 1)
    const doc = await env.DB.prepare(
      `SELECT d.identidade FROM documentos d
       JOIN alunos a ON a.id = d.aluno_id
       WHERE a.periodo_id = ? AND a.ra = ?`,
    )
      .bind(pId, raExistente)
      .first<{ identidade: number }>();
    expect(doc?.identidade).toBe(0);
  });

  it("Regra 3: Situação ausente, vazia ou desconhecida na aba geral — Bloqueia e reporta (Fail-Closed)", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raSemCorrespondencia = "00055003";
    const raSituacaoVazia = "00055004";
    const raSituacaoTraco = "00055005";

    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raSemCorrespondencia, "Sem Correspondencia", "0", "0", "0", "0", "0", "0", "0"],
      [raSituacaoVazia, "Situacao Vazia", "0", "0", "0", "0", "0", "0", "0"],
      [raSituacaoTraco, "Situacao Traco", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    // Aba geral só tem linha para raSituacaoVazia (com string vazia) e raSituacaoTraco (com '-')
    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["", "ADMINISTRAÇÃO", "", "", "", "", raSituacaoVazia],
      ["-", "ADMINISTRAÇÃO", "", "", "", "", raSituacaoTraco],
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

    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toContain(raSemCorrespondencia);
    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toContain(raSituacaoVazia);
    expect(report.alunosBloqueadosPorSituacaoDesconhecida).toContain(raSituacaoTraco);
    expect(report.alunosCriadosNoD1).toBe(0);
  });

  it("Regra 4: Situação válida (não reserva) — Cria aluno novo com RA canônico, zeros à esquerda, curso e 7 documentos", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raValido = "00055006"; // Com zeros à esquerda
    const nomeAluno = "Maria Aluna Valida";
    const cursoAluno = "CIÊNCIAS CONTÁBEIS";

    // 2 documentos entregues (identidade e cpf), 5 pendentes
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raValido, nomeAluno, "1", "1", "0", "0", "0", "0", "0"],
    ]);

    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["MATRICULADO", cursoAluno, "", "", "", "", raValido],
    ]);

    // Execução REAL
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

    expect(report.sucesso).toBe(true);
    expect(report.alunosCriadosNoD1).toBe(1);
    expect(report.camposEmSincronia).toBe(7);

    // Valida no D1
    const alunoD1 = await env.DB.prepare(
      `SELECT * FROM alunos WHERE periodo_id = ? AND ra = ?`,
    )
      .bind(pId, raValido)
      .first<any>();

    expect(alunoD1).not.toBeNull();
    expect(alunoD1.ra).toBe("00055006"); // Preserva estritamente zeros à esquerda
    expect(alunoD1.nome).toBe(nomeAluno);
    expect(alunoD1.curso).toBe(cursoAluno);
    expect(alunoD1.unidade).toBe("FACE");

    // Valida os 7 documentos no D1
    const docD1 = await env.DB.prepare(
      `SELECT * FROM documentos WHERE aluno_id = ?`,
    )
      .bind(alunoD1.id)
      .first<any>();

    expect(docD1.identidade).toBe(1);
    expect(docD1.cpf).toBe(1);
    expect(docD1.certidao).toBe(0);
    expect(docD1.residencia).toBe(0);
    expect(docD1.titulo).toBe(0);
    expect(docD1.ensino_medio).toBe(0);
    expect(docD1.contrato).toBe(0);
  });

  it("Regra 5: Idempotência — Executar a importação novamente não duplica alunos nem gera conflitos", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    const raValido = "00055007";
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raValido, "Aluno Idempotencia", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["CONTRATO ASSINADO", "ADMINISTRAÇÃO", "", "", "", "", raValido],
    ]);

    // Primeira execução (criação)
    const report1 = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: true,
    });
    expect(report1.alunosCriadosNoD1).toBe(1);

    // Segunda execução idêntica (repetição)
    const report2 = await reconcileInboundFromSpreadsheet({
      db: env.DB,
      periodoId: pId,
      integrationId: intId,
      actorId: "test-runner",
      dryRun: false,
      adapter,
      targetGroupKey: "FACE_FEA",
      autoCreateMissingAlunos: true,
    });

    expect(report2.sucesso).toBe(true);
    expect(report2.alunosCriadosNoD1 || 0).toBe(0); // Não recriou
    expect(report2.camposAtualizadosNoD1).toBe(0); // 0 mutações
    expect(report2.conflitosDetectados).toBe(0); // 0 conflitos
    expect(report2.camposEmSincronia).toBe(7); // 100% em sincronia

    // Confirma que não duplicou registro no D1
    const count = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM alunos WHERE periodo_id = ? AND ra = ?`,
    )
      .bind(pId, raValido)
      .first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it("Regra 6: Isolamento Estrito do Período 999 — 4 alunos fictícios permanecem 100% inalterados", async () => {
    const { pId, intId } = await setupPeriodoEnv();
    const adapter = new MockTestAdapter();

    // Garante que o período 999 existe e possui 4 alunos com dados e documentos específicos
    const periodo999Id = 999;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (?, '999', 'ATIVO')`,
    )
      .bind(periodo999Id)
      .run();

    const ras999 = ["00099901", "00099902", "00099903", "00099904"];
    for (const r of ras999) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO alunos (periodo_id, ra, nome, curso, unidade, status)
         VALUES (?, ?, 'Aluno Ficticio 999', 'CURSO 999', 'FACE', 'ATIVO')`,
      )
        .bind(periodo999Id, r)
        .run();

      const al = await env.DB.prepare(
        `SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?`,
      )
        .bind(periodo999Id, r)
        .first<{ id: number }>();

      await env.DB.prepare(
        `INSERT OR REPLACE INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, 1, 1, 1, 1, 1, 1, 1)`,
      )
        .bind(al!.id)
        .run();
    }

    // Configura planilha para período pId (ex: 2027-1) com novos alunos
    const raNovo = "00055008";
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [raNovo, "Aluno Periodo Atual", "0", "0", "0", "0", "0", "0", "0"],
    ]);

    adapter.setSheetData("BASE_FACE_FEA", [
      ["Situação Contratual", "Curso", "C", "D", "E", "F", "RA"],
      ["PAGAMENTO CONFIRMADO", "ADMINISTRAÇÃO", "", "", "", "", raNovo],
    ]);

    // Executa importação no período pId
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

    expect(report.sucesso).toBe(true);
    expect(report.alunosCriadosNoD1).toBe(1);

    // Valida que os 4 alunos do período 999 continuam existindo e com todos os 7 documentos com valor 1
    const total999 = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM alunos WHERE periodo_id = 999`,
    ).first<{ total: number }>();
    expect(total999?.total).toBe(4);

    for (const r of ras999) {
      const doc999 = await env.DB.prepare(
        `SELECT d.* FROM documentos d
         JOIN alunos a ON a.id = d.aluno_id
         WHERE a.periodo_id = 999 AND a.ra = ?`,
      )
        .bind(r)
        .first<any>();

      expect(doc999).not.toBeNull();
      expect(doc999.identidade).toBe(1);
      expect(doc999.cpf).toBe(1);
      expect(doc999.certidao).toBe(1);
      expect(doc999.residencia).toBe(1);
      expect(doc999.titulo).toBe(1);
      expect(doc999.ensino_medio).toBe(1);
      expect(doc999.contrato).toBe(1);
    }
  });
});
