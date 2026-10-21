import { describe, expect, it } from "vitest";
import { reconcileInboundFromSpreadsheet } from "../src/server/services/sync-inbound-reconciler";
import { prepareExistingAlunosBaselines } from "../src/server/services/sync-baseline-seeder";
import {
  initSyncRecord,
  derivarGroupKey,
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

class MockScenariosAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-scenarios-adapter";
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
      rowsByRa.set(ra, { rowIndex: i + 1, raText: ra, fields });
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

  async readGeneralTabContracts(): Promise<GeneralTabReadResult> {
    return {
      spreadsheetId: "",
      tabName: "",
      readAt: "",
      rowsByRa: new Map(),
      duplicateRas: [],
    };
  }
  async writeDocumentField(): Promise<WriteResult> {
    throw new Error("No write");
  }
  async verifyExternalEffect(): Promise<ExternalEffectCheckResult> {
    throw new Error("No verify");
  }
}

let seq = 40000;
function nextId() {
  return seq++;
}

async function setupTestEnvironment() {
  const pId = nextId();
  const intId = `integ-scenario-${pId}`;
  const spreadId = `sheet-scenario-${pId}`;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`,
  )
    .bind(pId, `PERIODO-${pId}`)
    .run();

  await env.DB.prepare(
    `INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode, epoch, layout_revision)
     VALUES (?, ?, ?, 'SHADOW', 1, 1)`,
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

  return { periodoId: pId, integrationId: intId, spreadsheetId: spreadId };
}

describe("Auditoria e Verificação de Cenários Inbound V2 e Seeder", () => {
  // -------------------------------------------------------------------------
  // Mapeamento canônico de GroupKey (Requisitos 1 e 2)
  // -------------------------------------------------------------------------
  describe("1. Mapeamento estrito e canônico de GroupKey (derivarGroupKey)", () => {
    it("reconhece FACE, FEA e todas as variantes autorizadas com normalização de separadores", () => {
      const faceFeaVariants = [
        "FACE",
        "FEA",
        "FACE FEA",
        "FEA FACE",
        "FACE/FEA",
        "FACE-FEA",
        "FACE_FEA",
        "FEA/FACE",
        "FEA-FACE",
        "FEA_FACE",
        "  face   fea  ",
        "Face/Fea",
        "fea_face",
      ];
      for (const v of faceFeaVariants) {
        expect(derivarGroupKey(v), `Falha ao derivar '${v}'`).toBe("FACE_FEA");
      }
    });

    it("reconhece FCH, EAD e todas as variantes autorizadas com normalização de separadores", () => {
      const fchEadVariants = [
        "FCH",
        "EAD",
        "FCH EAD",
        "EAD FCH",
        "FCH/EAD",
        "FCH-EAD",
        "FCH_EAD",
        "EAD/FCH",
        "EAD-FCH",
        "EAD_FCH",
        "  fch   ead  ",
        "Fch/Ead",
        "ead_fch",
      ];
      for (const v of fchEadVariants) {
        expect(derivarGroupKey(v), `Falha ao derivar '${v}'`).toBe("FCH_EAD");
      }
    });

    it("bloqueia e retorna null (fail-closed) para unidades desconhecidas sem substring matching", () => {
      const invalid = [
        "DIREITO",
        "MEDICINA",
        "FACEBOOK",
        "THREAD",
        "FEATHER",
        "HEAD",
        "",
        "   ",
        null,
        undefined,
      ];
      for (const inv of invalid) {
        expect(derivarGroupKey(inv as any)).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cenários Inbound
  // -------------------------------------------------------------------------
  it("Cenário 1: Sheets e D1 com valores iguais (com baseline inicializado) resulta em 100% camposEmSincronia", async () => {
    const { periodoId, integrationId } = await setupTestEnvironment();
    const alunoId = nextId();
    const ra = "0090001001";

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Teste Alfa', 'ADM', 'FACE FEA', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 1, 1, 0, 1, 0, 1, 1)`,
    )
      .bind(alunoId)
      .run();

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "test:seeder",
    });

    const adapter = new MockScenariosAdapter();
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [ra, "Aluno Teste Alfa", "1", "1", "0", "1", "0", "1", "1"],
    ]);

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(true);
    expect(report.camposEmSincronia).toBe(7);
    expect(report.camposAtualizadosNoD1).toBe(0);
    expect(report.conflitosDetectados).toBe(0);
    expect(report.mutacoesAplicadas).toHaveLength(0);
  });

  it("Cenário 2: Divergência legítima de 1 campo sobre baseline confirmado (aplica mutação de 0 para 1)", async () => {
    const { periodoId, integrationId } = await setupTestEnvironment();
    const alunoId = nextId();
    const ra = "0090001002";

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Teste Beta', 'ADM', 'FACE FEA', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(alunoId)
      .run();

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "test:seeder",
    });

    const adapter = new MockScenariosAdapter();
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [ra, "Aluno Teste Beta", "0", "0", "1", "0", "0", "0", "0"],
    ]);

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.sucesso).toBe(true);
    expect(report.camposEmSincronia).toBe(6);
    expect(report.camposAtualizadosNoD1).toBe(1);
    expect(report.mutacoesAplicadas).toHaveLength(1);
    expect(report.mutacoesAplicadas[0].fieldKey).toBe("certidao");
    expect(report.mutacoesAplicadas[0].valorAnterior).toBe(0);
    expect(report.mutacoesAplicadas[0].novoValor).toBe(1);
  });

  it("Cenário 3: Baseline não semeado com valores idênticos entre Sheets e D1 (reconhece em sincronia sem mutações cegas)", async () => {
    const { periodoId, integrationId } = await setupTestEnvironment();
    const alunoId = nextId();
    const ra = "0090001003";

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Teste Gama', 'ADM', 'FACE FEA', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 1, 1, 0, 1, 0, 1, 0)`,
    )
      .bind(alunoId)
      .run();

    // Planilha tem os mesmos valores que documentos
    const adapter = new MockScenariosAdapter();
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [ra, "Aluno Teste Gama", "1", "1", "0", "1", "0", "1", "0"],
    ]);

    // Execução em dryRun: NÃO reporta falsas mutações planejadas
    const reportDryRun = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      dryRun: true,
      adapter,
      db: env.DB,
    });

    expect(reportDryRun.camposEmSincronia).toBe(7);
    expect(reportDryRun.camposAtualizadosNoD1).toBe(0);
    expect(reportDryRun.conflitosDetectados).toBe(0);
    expect(reportDryRun.mutacoesAplicadas).toHaveLength(0);

    // Execução real: estabelece sync_field_state com revision=0 e status=CONFIRMED
    const reportReal = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      dryRun: false,
      adapter,
      db: env.DB,
    });

    expect(reportReal.camposEmSincronia).toBe(7);
    expect(reportReal.camposAtualizadosNoD1).toBe(0);
    expect(reportReal.conflitosDetectados).toBe(0);

    // Confere que sync_field_state foi estabelecido com revision 0
    const stateDb = await env.DB.prepare(
      `SELECT field_key, value, revision, status FROM sync_field_state WHERE record_id = ?`,
    )
      .bind(`rec-${periodoId}-FACE_FEA-${ra}`)
      .all<{ field_key: string; value: number; revision: number; status: string }>();

    expect(stateDb.results).toHaveLength(7);
    for (const f of stateDb.results) {
      expect(f.revision).toBe(0);
      expect(f.status).toBe("CONFIRMED");
    }
  });

  it("Cenário 4: Baseline não semeado com divergência em CAPTURE -> Fail-Closed (registra conflito sem sobrescrever)", async () => {
    const { periodoId, integrationId } = await setupTestEnvironment();
    const alunoId = nextId();
    const ra = "0090001004";

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Teste Delta', 'ADM', 'FACE FEA', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(alunoId)
      .run();

    // Planilha traz valores com 1 para aluno cujo baseline nunca foi estabelecido
    const adapter = new MockScenariosAdapter();
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [ra, "Aluno Teste Delta", "1", "0", "0", "0", "0", "0", "0"],
    ]);

    // Execução em CAPTURE (dryRun: false): Deve proteger contra escrita cega!
    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      dryRun: false,
      adapter,
      db: env.DB,
    });

    // 6 campos estavam iguais (0 == 0) -> sincronia
    expect(report.camposEmSincronia).toBe(6);
    // 1 campo divergente sem baseline -> FAIL-CLOSED CONFLICT
    expect(report.conflitosDetectados).toBe(1);
    expect(report.camposAtualizadosNoD1).toBe(0);
    expect(report.divergenciasComOutboxPendente[0].statusOperacaoLocal).toBe(
      "BASELINE_AUSENTE_DIVERGENCIA",
    );

    // O valor na tabela documentos DEVE permanecer intacto (0)
    const docDb = await env.DB.prepare(
      `SELECT identidade FROM documentos WHERE aluno_id = ?`,
    )
      .bind(alunoId)
      .first<{ identidade: number }>();
    expect(docDb?.identidade).toBe(0);
  });

  it("Cenário 5: Conflito com operação outbound pendente (não sobrescreve o D1)", async () => {
    const { periodoId, integrationId } = await setupTestEnvironment();
    const alunoId = nextId();
    const ra = "0090001005";
    const recordId = `rec-${periodoId}-FACE_FEA-${ra}`;

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Conflito', 'ADM', 'FACE', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(alunoId)
      .run();

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "test:seeder",
    });

    const cmdId = `cmd-pending-${ra}`;
    const evtId = `evt-pending-${ra}`;
    const opId = `op-pending-${ra}`;

    await env.DB.prepare(
      `INSERT INTO sync_commands (command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status)
       VALUES (?, 'user-secretaria', ?, 'titulo', 0, 1, 'hash-req', 'ACCEPTED')`,
    )
      .bind(cmdId, recordId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_events (event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id)
       VALUES (?, ?, 'titulo', ?, 0, 1, 0, 1, 'user-secretaria')`,
    )
      .bind(evtId, recordId, cmdId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, event_id, record_id, field_key, target_key, target_revision, state)
       VALUES (?, ?, ?, 'titulo', 'CONTROLE', 1, 'UNCERTAIN')`,
    )
      .bind(opId, evtId, recordId)
      .run();

    const adapter = new MockScenariosAdapter();
    adapter.setSheetData("CONTROLE DE DOCUMENTOS FACE FEA", [
      ["RA", "Nome", ...EXPECTED_CONTROL_HEADERS],
      [ra, "Aluno Conflito", "0", "0", "0", "0", "1", "0", "0"],
    ]);

    const report = await reconcileInboundFromSpreadsheet({
      periodoId,
      integrationId,
      actorId: "test:admin",
      adapter,
      db: env.DB,
    });

    expect(report.conflitosDetectados).toBe(1);
    expect(report.divergenciasComOutboxPendente).toHaveLength(1);
    expect(report.divergenciasComOutboxPendente[0].fieldKey).toBe("titulo");
    expect(report.divergenciasComOutboxPendente[0].statusOperacaoLocal).toBe("UNCERTAIN");
  });

  // -------------------------------------------------------------------------
  // Idempotência e Preservação de Timestamps do Seeder (Requisitos 4, 5, 6)
  // -------------------------------------------------------------------------
  describe("Idempotência do Seeder e Preservação de Timestamps", () => {
    it("seeder inicializa com revision=0, status=CONFIRMED e NÃO altera documentos.atualizado_em", async () => {
      const { periodoId, integrationId } = await setupTestEnvironment();
      const alunoId = nextId();
      const ra = "0090001006";

      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Timestamp', 'ADM', 'FACE FEA', 'ATIVO')`,
      )
        .bind(alunoId, periodoId, ra)
        .run();

      const timestampAntigo = "2026-01-01 12:00:00";
      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato, atualizado_em)
         VALUES (?, 1, 1, 0, 1, 0, 1, 1, ?)`,
      )
        .bind(alunoId, timestampAntigo)
        .run();

      // Executa seeder
      const report1 = await prepareExistingAlunosBaselines(env.DB, {
        periodoId,
        integrationId,
        actorId: "test:seeder",
      });

      expect(report1.sucesso).toBe(true);
      expect(report1.alunosPreparados).toBe(1);
      expect(report1.alunosJaExistentes).toBe(0);

      // Confere que atualizado_em na tabela documentos PERMANECEU INALTERADO
      const docDb = await env.DB.prepare(
        `SELECT atualizado_em FROM documentos WHERE aluno_id = ?`,
      )
        .bind(alunoId)
        .first<{ atualizado_em: string }>();
      expect(docDb?.atualizado_em).toBe(timestampAntigo);

      // Reexecuta o seeder: deve ser estritamente idempotente (JA_PREPARADO)
      const report2 = await prepareExistingAlunosBaselines(env.DB, {
        periodoId,
        integrationId,
        actorId: "test:seeder",
      });

      expect(report2.sucesso).toBe(true);
      expect(report2.alunosPreparados).toBe(0);
      expect(report2.alunosJaExistentes).toBe(1);
      expect(report2.detalhes[0].status).toBe("JA_PREPARADO");

      // Timestamp continua inalterado
      const docDb2 = await env.DB.prepare(
        `SELECT atualizado_em FROM documentos WHERE aluno_id = ?`,
      )
        .bind(alunoId)
        .first<{ atualizado_em: string }>();
      expect(docDb2?.atualizado_em).toBe(timestampAntigo);
    });

    it("seeder não sobrescreve campos com revision > 0, conflitos abertos ou operações pendentes", async () => {
      const { periodoId, integrationId } = await setupTestEnvironment();
      const alunoId = nextId();
      const ra = "0090001007";
      const recordId = `rec-${periodoId}-FACE_FEA-${ra}`;

      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Protegido', 'ADM', 'FACE FEA', 'ATIVO')`,
      )
        .bind(alunoId, periodoId, ra)
        .run();

      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, 1, 1, 1, 1, 1, 1, 1)`,
      )
        .bind(alunoId)
        .run();

      // Cria registro prévio com revision 2 e valor 0 em 'identidade'
      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
      });

      await env.DB.prepare(
        `UPDATE sync_field_state SET value = 0, revision = 2, status = 'CONFIRMED' WHERE record_id = ? AND field_key = 'identidade'`,
      )
        .bind(recordId)
        .run();

      // Executa seeder
      await prepareExistingAlunosBaselines(env.DB, {
        periodoId,
        integrationId,
        actorId: "test:seeder",
      });

      // 'identidade' DEVE manter revision 2 e valor 0 (NÃO sobrescrito com 1 do documentos)
      const fieldId = await env.DB.prepare(
        `SELECT value, revision, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
      )
        .bind(recordId)
        .first<{ value: number; revision: number; status: string }>();
      expect(fieldId?.value).toBe(0);
      expect(fieldId?.revision).toBe(2);
    });

    it("seeder com targetRas restringe a semeadura estritamente aos RAs fornecidos", async () => {
      const { periodoId, integrationId } = await setupTestEnvironment();
      const aluno1Id = nextId();
      const aluno2Id = nextId();
      const ra1 = "0090001008";
      const ra2 = "0090001009";

      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno RA 1', 'ADM', 'FACE FEA', 'ATIVO')`,
      ).bind(aluno1Id, periodoId, ra1).run();

      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, 1, 1, 1, 1, 1, 1, 1)`,
      ).bind(aluno1Id).run();

      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno RA 2', 'ADM', 'FACE FEA', 'ATIVO')`,
      ).bind(aluno2Id, periodoId, ra2).run();

      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, 1, 1, 1, 1, 1, 1, 1)`,
      ).bind(aluno2Id).run();

      // Executa seeder passando EXCLUSIVAMENTE ra1 em targetRas
      const report = await prepareExistingAlunosBaselines(env.DB, {
        periodoId,
        integrationId,
        actorId: "test:seeder",
        targetRas: [ra1],
      });

      expect(report.totalAlunosD1).toBe(1);
      expect(report.alunosPreparados).toBe(1);

      // ra1 foi semeado
      const rec1 = await env.DB.prepare(
        `SELECT record_id FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
      ).bind(integrationId, ra1).first();
      expect(rec1).toBeTruthy();

      // ra2 NÃO foi semeado
      const rec2 = await env.DB.prepare(
        `SELECT record_id FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
      ).bind(integrationId, ra2).first();
      expect(rec2).toBeNull();
    });
  });
});
