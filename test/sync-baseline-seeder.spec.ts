import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  prepareExistingAlunosBaselines,
} from "../src/server/services/sync-baseline-seeder";
import { handleAlunosRoute } from "../src/server/routes/alunos";
import { handleImportacaoAlunosRoute } from "../src/server/routes/importacao-alunos";
import { handleCancelamentosRoute } from "../src/server/routes/cancelamentos";
import {
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type ControlRowSnapshot,
  CONTROL_DOC_COLUMNS,
} from "../src/server/services/sync-sheet-contracts";

let seq = 1;
const proximoId = () => 2000 + seq++;

class FakeSpreadsheetSeederAdapter implements Partial<ISyncSpreadsheetAdapter> {
  readonly adapterId = "fake-seeder-adapter";
  controlRowsFaceFea = new Map<string, ControlRowSnapshot>();
  controlRowsFchEad = new Map<string, ControlRowSnapshot>();
  duplicateRasFaceFea: string[] = [];
  duplicateRasFchEad: string[] = [];

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: "FACE_FEA" | "FCH_EAD";
  }): Promise<ControlTabReadResult> {
    const rows =
      params.groupKey === "FACE_FEA"
        ? this.controlRowsFaceFea
        : this.controlRowsFchEad;
    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: "fingerprint-valid",
      readAt: new Date().toISOString(),
      rowsByRa: rows,
      duplicateRas:
        params.groupKey === "FACE_FEA"
          ? this.duplicateRasFaceFea
          : this.duplicateRasFchEad,
    };
  }
}

describe("P0.2 — Preparação de Linha de Base e Ciclo de Vida V2", () => {
  async function criarPeriodoEIntegracao(opcoes?: {
    mode?: string;
    periodoId?: number;
  }) {
    const periodoId = opcoes?.periodoId ?? proximoId();
    const integrationId = `integ-${periodoId}`;
    const mode = opcoes?.mode ?? "BIDIRECTIONAL";

    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`,
    )
      .bind(periodoId, `PER-${periodoId}`)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, ?, 1, 1, ?)`,
    )
      .bind(integrationId, periodoId, `sheet-${periodoId}`, mode)
      .run();

    return { periodoId, integrationId };
  }

  // ---------------------------------------------------------------------------
  // 1. Alunos existentes: Seed inicializa sync_records e baseline V2
  // ---------------------------------------------------------------------------
  it("1. Alunos existentes: Seed prepara alunos no núcleo V2 com baseline comprovada", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const alunoId = proximoId();
    const ra = "RA-EXISTENTE-01";

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'Aluno Teste', 'Direito', 'FACE', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (
        aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
      ) VALUES (?, 1, 1, 0, 1, 0, 1, 1)`,
    )
      .bind(alunoId)
      .run();

    const report = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin-seeder",
      dryRun: false,
    });

    expect(report.sucesso).toBe(true);
    expect(report.totalAlunosD1).toBe(1);
    expect(report.alunosPreparados).toBe(1);
    expect(report.alunosJaExistentes).toBe(0);
    expect(report.duplicidades).toHaveLength(0);
    expect(report.divergencias).toHaveLength(0);

    // Confere sync_records
    const rec = await env.DB.prepare(
      `SELECT record_id, ra_text, group_key, lifecycle FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    )
      .bind(integrationId, ra)
      .first<{ record_id: string; ra_text: string; group_key: string; lifecycle: string }>();
    expect(rec).toBeTruthy();
    expect(rec?.ra_text).toBe(ra);
    expect(rec?.group_key).toBe("FACE_FEA");
    expect(rec?.lifecycle).toBe("ACTIVE");

    // Confere sync_field_state (todos os 7 campos inicializados com revision 0 e status CONFIRMED)
    const fields = await env.DB.prepare(
      `SELECT field_key, value, revision, status FROM sync_field_state WHERE record_id = ?`,
    )
      .bind(rec!.record_id)
      .all<{ field_key: string; value: number; revision: number; status: string }>();
    expect(fields.results).toHaveLength(7);
    for (const f of fields.results) {
      expect(f.status).toBe("CONFIRMED");
      expect(f.revision).toBe(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Alunos novos: Cadastro individual inicializa V2 automaticamente
  // ---------------------------------------------------------------------------
  it("2. Alunos novos: Cadastro individual cria aluno e registro V2 com outbox V1 suprimida", async () => {
    const { periodoId } = await criarPeriodoEIntegracao();
    const ra = "000888";
    const pendenciasV1: string[] = [];

    const body = {
      ra,
      nome: "Novo Aluno V2",
      curso: "Engenharia",
      unidade: "FEA",
      documentos: {
        identidade: true,
        cpf: true,
        certidao: false,
        residencia: false,
        titulo: false,
        ensino_medio: true,
        contrato: false,
      },
    };

    const response = await handleAlunosRoute({
      request: new Request("https://local/api/alunos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      url: new URL("https://local/api/alunos"),
      db: env.DB,
      periodoId,
      modoApresentacao: false,
      registrarPendencia: async (r) => {
        pendenciasV1.push(r);
      },
    });

    expect(response?.status).toBe(201);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(true);
    expect(json.ra).toBe(ra);

    // Registro V2 criado automaticamente
    const rec = await env.DB.prepare(
      `SELECT record_id, ra_text, group_key, lifecycle FROM sync_records WHERE ra_text = ? AND lifecycle = 'ACTIVE'`,
    )
      .bind(ra)
      .first<{ record_id: string; ra_text: string; group_key: string; lifecycle: string }>();
    expect(rec).toBeTruthy();
    expect(rec?.ra_text).toBe("000888");
    expect(rec?.group_key).toBe("FACE_FEA");

    // Outbox V1 estritamente suprimida
    expect(pendenciasV1).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Importação em lote integrada à V2
  // ---------------------------------------------------------------------------
  it("3. Importação em lote: cria novos alunos no D1 e no núcleo V2 com supressão da V1", async () => {
    const { periodoId } = await criarPeriodoEIntegracao();
    const pendenciasV1: string[] = [];

    const alunosLote = [
      { ra: "000901", nome: "Lote Um", curso: "Letras", contrato: true },
      { ra: "000902", nome: "Lote Dois", curso: "Letras", contrato: false },
    ];

    const response = await handleImportacaoAlunosRoute({
      request: new Request("https://local/api/alunos/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidade: "FCH", alunos: alunosLote }),
      }),
      url: new URL("https://local/api/alunos/importar"),
      db: env.DB,
      periodoId,
      registrarPendencia: async (r) => {
        pendenciasV1.push(r);
      },
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json.importados).toBe(2);

    // Ambos os alunos possuem sync_records no grupo FCH_EAD
    for (const al of alunosLote) {
      const rec = await env.DB.prepare(
        `SELECT record_id, group_key, lifecycle FROM sync_records WHERE ra_text = ? AND lifecycle = 'ACTIVE'`,
      )
        .bind(al.ra)
        .first<{ record_id: string; group_key: string; lifecycle: string }>();
      expect(rec).toBeTruthy();
      expect(rec?.group_key).toBe("FCH_EAD");
      expect(rec?.lifecycle).toBe("ACTIVE");
    }

    // Outbox V1 suprimida
    expect(pendenciasV1).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. RA com zeros à esquerda preservado em todo o ciclo
  // ---------------------------------------------------------------------------
  it("4. RA com zeros à esquerda: preservação estrita de string sem truncamento", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const raComZeros = "000042";
    const alunoId = proximoId();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'Aluno Zeros', 'Design', 'FCH', 'ATIVO')`,
    )
      .bind(alunoId, periodoId, raComZeros)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (
        aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(alunoId)
      .run();

    const report = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });

    expect(report.sucesso).toBe(true);
    const rec = await env.DB.prepare(
      `SELECT ra_text FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    )
      .bind(integrationId, raComZeros)
      .first<{ ra_text: string }>();
    expect(rec?.ra_text).toBe("000042");
  });

  // ---------------------------------------------------------------------------
  // 5. Mesmo RA em períodos e grupos distintos sem contaminação
  // ---------------------------------------------------------------------------
  it("5. Mesmo RA em períodos e grupos distintos: isolamento completo", async () => {
    const p1 = await criarPeriodoEIntegracao();
    const p2 = await criarPeriodoEIntegracao();
    const raDuplo = "RA-COMPARTILHADO-001";

    const a1 = proximoId();
    const a2 = proximoId();

    // P1: FACE (FACE_FEA)
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'P1 Aluno', 'Adm', 'FACE', 'ATIVO')`,
    ).bind(a1, p1.periodoId, raDuplo).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 1, 1, 1, 1, 1, 1, 1)`,
    ).bind(a1).run();

    // P2: FCH (FCH_EAD)
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'P2 Aluno', 'Letras', 'FCH', 'ATIVO')`,
    ).bind(a2, p2.periodoId, raDuplo).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    ).bind(a2).run();

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId: p1.periodoId,
      integrationId: p1.integrationId,
      actorId: "admin",
      dryRun: false,
    });

    await prepareExistingAlunosBaselines(env.DB, {
      periodoId: p2.periodoId,
      integrationId: p2.integrationId,
      actorId: "admin",
      dryRun: false,
    });

    const recP1 = await env.DB.prepare(
      `SELECT record_id, group_key FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(p1.integrationId, raDuplo).first<{ record_id: string; group_key: string }>();

    const recP2 = await env.DB.prepare(
      `SELECT record_id, group_key FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(p2.integrationId, raDuplo).first<{ record_id: string; group_key: string }>();

    expect(recP1?.group_key).toBe("FACE_FEA");
    expect(recP2?.group_key).toBe("FCH_EAD");
    expect(recP1?.record_id).not.toBe(recP2?.record_id);
  });

  // ---------------------------------------------------------------------------
  // 6. Divergência D1 vs Sheets detectada e reportada sem igualdade presumida
  // ---------------------------------------------------------------------------
  it("6. Divergência D1/Sheets: detectada, reportada e campo mantido UNBASELINED", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const ra = "RA-DIVERGENTE-01";
    const alunoId = proximoId();

    // D1 tem identidade = 1, contrato = 0
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Divergente', 'Direito', 'FACE', 'ATIVO')`,
    ).bind(alunoId, periodoId, ra).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 1, 0, 0, 0, 0, 0, 0)`,
    ).bind(alunoId).run();

    // Adaptador simulado onde na planilha identidade = 0 (divergência!)
    const fakeAdapter = new FakeSpreadsheetSeederAdapter();
    fakeAdapter.controlRowsFaceFea.set(ra, {
      rowIndex: 2,
      raText: ra,
      studentName: "Aluno Divergente",
      fields: {
        identidade: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "C2" },
        cpf_documento: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "D2" },
        certidao: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "E2" },
        residencia: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "F2" },
        titulo: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "G2" },
        ensino_medio: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "H2" },
        contrato: { rawValue: "NÃO ENTREGUE", normalizedValue: 0, cellCoordinate: "I2" },
      },
    });

    const report = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
      externalAdapter: fakeAdapter as any,
    });

    expect(report.sucesso).toBe(true);
    expect(report.divergencias.length).toBeGreaterThan(0);
    const divIdentidade = report.divergencias.find((d) => d.fieldKey === "identidade");
    expect(divIdentidade).toBeTruthy();
    expect(divIdentidade?.d1Value).toBe(1);
    expect(divIdentidade?.sheetValue).toBe(0);

    // O campo com divergência NÃO pode presumir igualdade: deve continuar UNBASELINED
    const rec = await env.DB.prepare(
      `SELECT record_id FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, ra).first<{ record_id: string }>();

    const estadoIdentidade = await env.DB.prepare(
      `SELECT status, value FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
    ).bind(rec!.record_id).first<{ status: string; value: number | null }>();
    expect(estadoIdentidade?.status).toBe("UNBASELINED");
  });

  // ---------------------------------------------------------------------------
  // 7. Duplicidades cadastrais detectadas e bloqueadas
  // ---------------------------------------------------------------------------
  it("7. Duplicidades: detecta múltiplos registros com mesmo RA na planilha e bloqueia", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const raDuplicado = "RA-DUPLICADO-SHEETS";
    const a1 = proximoId();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Dup 1', 'Adm', 'FACE', 'ATIVO')`,
    ).bind(a1, periodoId, raDuplicado).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    ).bind(a1).run();

    const fakeAdapter = new FakeSpreadsheetSeederAdapter();
    fakeAdapter.duplicateRasFaceFea = [raDuplicado];

    const report = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
      externalAdapter: fakeAdapter as any,
    });

    expect(report.duplicidades.length).toBe(1);
    expect(report.duplicidades[0].ra).toBe(raDuplicado);
    expect(report.bloqueios.length).toBeGreaterThan(0);

    // Nenhum sync_records foi criado para o RA ambíguo
    const count = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, raDuplicado).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8. Execução repetida do seed: Idempotência estrita
  // ---------------------------------------------------------------------------
  it("8. Execução repetida do seed: idempotente, sem sobrescrever baselines existentes", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const ra = "RA-IDEMPOTENTE-01";
    const alunoId = proximoId();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Idem', 'Eng', 'FEA', 'ATIVO')`,
    ).bind(alunoId, periodoId, ra).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 1, 0, 0, 0, 0, 0, 0)`,
    ).bind(alunoId).run();

    // Primeira execução
    const r1 = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });
    expect(r1.alunosPreparados).toBe(1);
    expect(r1.alunosJaExistentes).toBe(0);

    // Segunda execução
    const r2 = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });
    expect(r2.alunosPreparados).toBe(0);
    expect(r2.alunosJaExistentes).toBe(1);

    // Contagem de registros permanece exatamente 1
    const count = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, ra).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 9. Modo Dry-Run: emite relatório sem alterar o banco
  // ---------------------------------------------------------------------------
  it("9. Modo Dry-Run: reporta alunos a preparar sem criar sync_records no D1", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const ra = "RA-DRYRUN-01";
    const alunoId = proximoId();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Dry', 'Eng', 'FEA', 'ATIVO')`,
    ).bind(alunoId, periodoId, ra).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 1, 1, 1, 0, 0, 0, 0)`,
    ).bind(alunoId).run();

    const report = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.alunosPreparados).toBe(1);

    // Confere que NENHUM sync_records foi inserido
    const count = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, ra).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 10. Cancelamento com operação pendente: preservação de dados e histórico
  // ---------------------------------------------------------------------------
  it("10. Cancelamento seguro: preserva histórico, eventos e operações pendentes na outbox V2", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const ra = "RA-CANCELAMENTO-01";
    const alunoId = proximoId();
    const pendenciasV1: string[] = [];

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Cancelar', 'Dir', 'FACE', 'ATIVO')`,
    ).bind(alunoId, periodoId, ra).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 1, 0, 0, 0, 0, 0, 0)`,
    ).bind(alunoId).run();

    // Prepara baseline
    await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });

    const rec = await env.DB.prepare(
      `SELECT record_id FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, ra).first<{ record_id: string }>();

    // Cria uma operação pendente simulada na outbox V2
    const opId = `op-teste-${proximoId()}`;
    const cmdId = `cmd-teste-${proximoId()}`;
    const evtId = `evt-teste-${proximoId()}`;

    await env.DB.prepare(
      `INSERT INTO sync_commands (
        command_id, record_id, field_key, from_revision, proposed_value, request_hash, status, actor_id
      ) VALUES (?, ?, 'identidade', 0, 1, 'hash-dummy-cancel', 'ACCEPTED', 'admin')`,
    ).bind(cmdId, rec!.record_id).run();

    await env.DB.prepare(
      `INSERT INTO sync_events (
        event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
      ) VALUES (?, ?, 'identidade', ?, 0, 1, 0, 1, 'admin')`,
    ).bind(evtId, rec!.record_id, cmdId).run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (
        operation_id, event_id, record_id, field_key, target_key, target_revision, state
      ) VALUES (?, ?, ?, 'identidade', 'CONTROLE', 1, 'PENDING')`,
    ).bind(opId, evtId, rec!.record_id).run();

    // Executa cancelamento de matrícula
    const response = await handleCancelamentosRoute({
      request: new Request("https://local/api/alunos/cancelados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidade: "FACE", ras: [ra] }),
      }),
      url: new URL("https://local/api/alunos/cancelados"),
      db: env.DB,
      periodoId,
      registrarPendencia: async (r) => {
        pendenciasV1.push(r);
      },
    });

    expect(response?.status).toBe(200);

    // Confere que status do aluno passou para CANCELADO
    const aluno = await env.DB.prepare(`SELECT status FROM alunos WHERE id = ?`).bind(alunoId).first<{ status: string }>();
    expect(aluno?.status).toBe("CANCELADO");

    // Confere que a operação pendente na outbox V2 NÃO foi apagada!
    const op = await env.DB.prepare(
      `SELECT state FROM sync_operations WHERE operation_id = ?`,
    ).bind(opId).first<{ state: string }>();
    expect(op?.state).toBe("PENDING");

    // Confere que o sync_records e o histórico de campos permanecem íntegros
    const recApos = await env.DB.prepare(
      `SELECT lifecycle FROM sync_records WHERE record_id = ?`,
    ).bind(rec!.record_id).first<{ lifecycle: string }>();
    expect(recApos).toBeTruthy();

    // Outbox V1 suprimida
    expect(pendenciasV1).toHaveLength(0);
  });
  // ---------------------------------------------------------------------------
  // 11. Tentativa de nova baseline sobre registros existentes sem efeito colateral
  // ---------------------------------------------------------------------------
  it("11. Nova baseline sobre registros existentes: sem efeitos colaterais ou regressao de revisao", async () => {
    const { periodoId, integrationId } = await criarPeriodoEIntegracao();
    const ra = "RA-NOVA-BASELINE-01";
    const alunoId = proximoId();

    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (?, ?, ?, 'Aluno Recorrente', 'Direito', 'FACE', 'ATIVO')`,
    ).bind(alunoId, periodoId, ra).run();
    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    ).bind(alunoId).run();

    // 1. Executa primeira baseline
    const r1 = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });
    expect(r1.alunosPreparados).toBe(1);

    const rec = await env.DB.prepare(
      `SELECT record_id FROM sync_records WHERE integration_id = ? AND ra_text = ?`,
    ).bind(integrationId, ra).first<{ record_id: string }>();

    // 2. Simula avanço de revisão em um campo (identidade para rev 1, value 1)
    await env.DB.prepare(
      `UPDATE sync_field_state SET revision = 1, value = 1 WHERE record_id = ? AND field_key = 'identidade'`,
    ).bind(rec!.record_id).run();

    // 3. Executa seeder novamente
    const r2 = await prepareExistingAlunosBaselines(env.DB, {
      periodoId,
      integrationId,
      actorId: "admin",
      dryRun: false,
    });
    expect(r2.alunosPreparados).toBe(0);
    expect(r2.alunosJaExistentes).toBe(1);

    // 4. Confere que a revisão e valor avançados NÃO foram regredidos
    const fieldApos = await env.DB.prepare(
      `SELECT revision, value, status FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`,
    ).bind(rec!.record_id).first<{ revision: number; value: number; status: string }>();
    expect(fieldApos?.revision).toBe(1);
    expect(fieldApos?.value).toBe(1);
    expect(fieldApos?.status).toBe("CONFIRMED");
  });
});