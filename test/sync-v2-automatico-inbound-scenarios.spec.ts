/**
 * ============================================================================
 * Suíte de Testes — Cenários Inbound Automáticos V2 (Google Sheets → Site)
 * ============================================================================
 * Valida os comportamentos críticos exigidos para a sincronização automática:
 *  1. Aluno que muda de reserva para "Em curso" (detecção e criação idempotente).
 *  2. Aluno que permanece em reserva (exclusão estrita sem criação no D1).
 *  3. Aluno elegível com mudança de checkbox (atualização causal sem eco).
 *  4. Aluno que entra posteriormente em reserva (bloqueio de atualizações automáticas).
 *  5. Execuções repetidas sem duplicações (idempotência e camposEmSincronia).
 *  6. Concorrência e recuperação de lease (fencing anti-split-brain).
 *  7. Conflito entre alteração local e alteração no Sheets (proteção F3 fail-closed).
 *  8. Preservação integral dos alunos fictícios do período 999.
 *  9. Preservação de RAs textuais e zeros à esquerda.
 * ============================================================================
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  runScheduledSyncV2,
  executeIntegrationSyncCycle,
  acquireCoordinatorLease,
} from "../src/server/services/sync-coordinator";
import {
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";
import {
  EXPECTED_CONTROL_HEADERS,
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type GeneralTabReadResult,
  type GeneralContractRowSnapshot,
  type WriteResult,
  type ExternalEffectCheckResult,
} from "../src/server/services/sync-sheet-contracts";
import { createTabNameResolver } from "../src/server/services/sync-orchestrator";

let testSeq = 5000;
const proximoId = () => testSeq++;

class InMemorySheetAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "in-memory-sheet-adapter";

  // Map: tabName -> grid
  public controlGrids: Map<string, unknown[][]> = new Map();
  public generalRows: Map<string, Map<string, { situacao: string; curso: string }>> = new Map();

  setControlData(tabName: string, grid: unknown[][]) {
    this.controlGrids.set(tabName, JSON.parse(JSON.stringify(grid)));
  }

  setGeneralStudent(tabName: string, ra: string, situacao: string, curso: string = "PSICOLOGIA") {
    if (!this.generalRows.has(tabName)) {
      this.generalRows.set(tabName, new Map());
    }
    this.generalRows.get(tabName)!.set(ra, { situacao, curso });
  }

  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const grid = this.controlGrids.get(params.tabName);
    if (!grid) {
      throw new Error(`Aba de controle '${params.tabName}' não encontrada`);
    }

    const header = (grid[0] || []).map((c) => String(c ?? ""));
    const headerCtoI = header.slice(2, 9);
    for (let idx = 0; idx < EXPECTED_CONTROL_HEADERS.length; idx++) {
      if ((headerCtoI[idx] || "").trim().toUpperCase() !== EXPECTED_CONTROL_HEADERS[idx]) {
        throw new Error(`STRUCTURAL_LAYOUT_MUTATED: cabeçalho divergente`);
      }
    }

    const rowsByRa = new Map();
    const fieldKeys: FieldKey[] = [
      "identidade",
      "cpf_documento",
      "certidao",
      "residencia",
      "titulo",
      "ensino_medio",
      "contrato",
    ];

    for (let i = 1; i < grid.length; i++) {
      const row = grid[i] || [];
      const ra = String(row[0] ?? "").trim();
      if (!ra) continue;

      const fields: any = {};
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
        studentName: String(row[1] ?? "").trim() || "ALUNO TESTE",
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
      duplicateRas: [],
    };
  }

  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const rowsMap = this.generalRows.get(params.tabName) || new Map();
    const rowsByRa = new Map<string, GeneralContractRowSnapshot>();

    let idx = 2;
    for (const [ra, data] of rowsMap.entries()) {
      rowsByRa.set(ra, {
        rowIndex: idx,
        raText: ra,
        contractRawValue: data.situacao,
        contractNormalizedValue: (data.situacao.toUpperCase().includes("RESERVA")
          ? "RESERVA_DE_VAGA"
          : data.situacao.toUpperCase().includes("EM CURSO")
            ? "EM_CURSO"
            : "OUTRO") as any,
        courseName: data.curso,
        cellCoordinate: `H${idx}`,
      });
      idx++;
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: "FCH_EAD",
      headerFingerprint: "GENERAL_CONTRACTS_FINGERPRINT",
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: [],
    };
  }

  async writeDocumentField(): Promise<WriteResult> {
    return {
      success: true,
      status: "COMMITTED",
    };
  }

  async verifyExternalEffect(): Promise<ExternalEffectCheckResult> {
    return {
      effectObserved: true,
      isAbsentConfirmed: false,
      currentRawValue: "TRUE",
      currentNormalizedValue: 1,
      inspectedAt: new Date().toISOString(),
    };
  }
}

function buildControlGrid(
  students: Array<{ ra: string; nome: string; docs: Record<FieldKey, string | boolean> }>,
) {
  const header = [
    "RA",
    "NOME DO ALUNO",
    ...EXPECTED_CONTROL_HEADERS,
    "TOTAL ENTREGUES",
    "STATUS DOCUMENTAL",
  ];
  const grid: unknown[][] = [header];
  for (const s of students) {
    grid.push([
      s.ra,
      s.nome,
      s.docs.identidade,
      s.docs.cpf_documento,
      s.docs.certidao,
      s.docs.residencia,
      s.docs.titulo,
      s.docs.ensino_medio,
      s.docs.contrato,
      "=CONT.SE(C2:I2; VERDADEIRO)",
      "=SE(J2=7; 'COMPLETO'; 'PENDENTE')",
    ]);
  }
  return grid;
}

describe("Sincronização Automática Inbound V2 — Cenários Específicos", () => {
  it("1. Aluno que muda de reserva para 'Em curso' é criado no D1 com baseline correto", async () => {
    const pId = proximoId();
    const intId = `integ-auto-reserva-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raComZero = "00202701";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST1', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();
    await env.DB.prepare(`INSERT INTO google_sheets_periodos (periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead, aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead) VALUES (?, 'sheet-test', 'FACE - FEA 2027 - 1', ?, 'CONTROLE DE DOCUMENTOS FACE FEA', ?, 'CANCELADOS FACE FEA', 'CANCELADOS FCH EAD')`).bind(pId, generalTab, controlTab).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raComZero,
          nome: "ALUNO TESTE MUDANCA",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "FALSE",
            ensino_medio: "TRUE",
            contrato: "FALSE",
          },
        },
      ]),
    );

    // Passo A: Inicialmente em Reserva de Vaga
    adapter.setGeneralStudent(generalTab, raComZero, "Em curso - (Reserva de vaga)", "PSICOLOGIA");

    const rep1 = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: {
        integration_id: intId,
        periodo_id: pId,
        spreadsheet_id: "sheet-test",
        mode: "CAPTURE",
        epoch: 1,
      },
      adapter,
      tabNameResolver: createTabNameResolver({
        sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
        periodoCodigo: "2027-1-TEST1",
      }),
      workerId: "test-w1",
    });

    expect(rep1.status).toBe("SUCCESS");
    expect(rep1.inboundReport?.alunosExcluidosPorReservaDeVaga).toContain(raComZero);
    expect(rep1.inboundReport?.alunosCriadosNoD1).toBe(0);

    // Confirma que não foi criado no D1
    const alunoAntes = await env.DB.prepare(`SELECT * FROM alunos WHERE periodo_id = ? AND ra = ?`).bind(pId, raComZero).first();
    expect(alunoAntes).toBeNull();

    // Passo B: Aluno sai da reserva e passa para "Em curso"
    adapter.setGeneralStudent(generalTab, raComZero, "Em curso", "PSICOLOGIA");

    const rep2 = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: {
        integration_id: intId,
        periodo_id: pId,
        spreadsheet_id: "sheet-test",
        mode: "CAPTURE",
        epoch: 1,
      },
      adapter,
      tabNameResolver: createTabNameResolver({
        sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
        periodoCodigo: "2027-1-TEST1",
      }),
      workerId: "test-w1",
    });

    expect(rep2.status).toBe("SUCCESS");
    expect(rep2.inboundReport?.alunosCriadosNoD1).toBe(1);

    // Confirma criação no D1 preservando RA textual com zero à esquerda
    const alunoDepois = await env.DB.prepare(`SELECT id, ra, nome, curso, unidade FROM alunos WHERE periodo_id = ? AND ra = ?`).bind(pId, raComZero).first<any>();
    expect(alunoDepois).not.toBeNull();
    expect(alunoDepois.ra).toBe(raComZero);
    expect(alunoDepois.unidade).toBe("FCH");
    expect(alunoDepois.curso).toBe("PSICOLOGIA");

    // Confirma os 7 documentos (5 entregues, 2 pendentes)
    const docs = await env.DB.prepare(`SELECT identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato FROM documentos WHERE aluno_id = ?`).bind(alunoDepois.id).first<any>();
    expect(docs.identidade).toBe(1);
    expect(docs.cpf).toBe(1);
    expect(docs.certidao).toBe(1);
    expect(docs.residencia).toBe(1);
    expect(docs.titulo).toBe(0);
    expect(docs.ensino_medio).toBe(1);
    expect(docs.contrato).toBe(0);

    // Confirma baseline em sync_field_state com revision = 0 e CONFIRMED
    const fieldStates = await env.DB.prepare(
      `SELECT fs.field_key, fs.value, fs.revision, fs.status
       FROM sync_field_state fs
       JOIN sync_records sr ON sr.record_id = fs.record_id
       WHERE sr.integration_id = ? AND sr.ra_text = ?`,
    ).bind(intId, raComZero).all<any>();

    expect(fieldStates.results.length).toBe(7);
    for (const fs of fieldStates.results) {
      expect(fs.revision).toBe(0);
      expect(fs.status).toBe("CONFIRMED");
    }
  });

  it("2. Aluno que permanece em reserva é mantido fora do D1 em execuções repetidas", async () => {
    const pId = proximoId();
    const intId = `integ-auto-reserva-fixo-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raReserva = "00202702";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST2', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(controlTab, buildControlGrid([{ ra: raReserva, nome: "ALUNO PERMANECE RESERVA", docs: { identidade: "TRUE", cpf_documento: "TRUE", certidao: "TRUE", residencia: "TRUE", titulo: "TRUE", ensino_medio: "TRUE", contrato: "TRUE" } }]));
    adapter.setGeneralStudent(generalTab, raReserva, "Em curso (reserva de vaga)", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    for (let ciclo = 1; ciclo <= 3; ciclo++) {
      const rep = await executeIntegrationSyncCycle({
        db: env.DB,
        integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: ciclo },
        adapter,
        tabNameResolver: tabResolver,
        workerId: `w-${ciclo}`,
      });

      expect(rep.status).toBe("SUCCESS");
      expect(rep.inboundReport?.alunosExcluidosPorReservaDeVaga).toContain(raReserva);
      expect(rep.inboundReport?.alunosCriadosNoD1).toBe(0);
    }

    const count = await env.DB.prepare(`SELECT COUNT(*) as total FROM alunos WHERE periodo_id = ?`).bind(pId).first<{ total: number }>();
    expect(count?.total).toBe(0);
  });

  it("3. Aluno elegível com mudança de checkbox na planilha tem documentos atualizados no D1 sem eco", async () => {
    const pId = proximoId();
    const intId = `integ-auto-checkbox-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raAluno = "00202703";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST3', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    // Inicialmente com contrato = FALSE
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raAluno,
          nome: "ALUNO CHECKBOX TESTE",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "TRUE",
            ensino_medio: "TRUE",
            contrato: "FALSE",
          },
        },
      ]),
    );
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    // 1º ciclo: Ingestão inicial
    await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-init",
    });

    const aluno = await env.DB.prepare(`SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?`).bind(pId, raAluno).first<{ id: number }>();
    expect(aluno).toBeDefined();

    const docsAntes = await env.DB.prepare(`SELECT contrato FROM documentos WHERE aluno_id = ?`).bind(aluno!.id).first<{ contrato: number }>();
    expect(docsAntes?.contrato).toBe(0);

    // 2º ciclo: Na planilha, a secretaria marca o contrato como TRUE
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raAluno,
          nome: "ALUNO CHECKBOX TESTE",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "TRUE",
            ensino_medio: "TRUE",
            contrato: "TRUE", // Marcado!
          },
        },
      ]),
    );

    const repUpdate = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 2 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-update",
    });

    expect(repUpdate.status).toBe("SUCCESS");
    expect(repUpdate.inboundReport?.camposAtualizadosNoD1).toBe(1);
    expect(repUpdate.inboundReport?.mutacoesAplicadas[0].fieldKey).toBe("contrato");
    expect(repUpdate.inboundReport?.mutacoesAplicadas[0].novoValor).toBe(1);

    // Confirma atualização na tabela documentos
    const docsDepois = await env.DB.prepare(`SELECT contrato FROM documentos WHERE aluno_id = ?`).bind(aluno!.id).first<{ contrato: number }>();
    expect(docsDepois?.contrato).toBe(1);

    // Confirma incremento causal de revisão em sync_field_state (revision 0 -> 1)
    const fieldContrato = await env.DB.prepare(
      `SELECT fs.value, fs.revision, fs.status
       FROM sync_field_state fs
       JOIN sync_records sr ON sr.record_id = fs.record_id
       WHERE sr.integration_id = ? AND sr.ra_text = ? AND fs.field_key = 'contrato'`,
    ).bind(intId, raAluno).first<any>();

    expect(fieldContrato.value).toBe(1);
    expect(fieldContrato.revision).toBe(1);
    expect(fieldContrato.status).toBe("CONFIRMED");

    // Garantia de ausência de eco: nenhuma linha em sync_operations criada pelo inbound
    const opsCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM sync_operations WHERE target_key = 'CONTROLE'`).first<{ total: number }>();
    expect(opsCount?.total).toBe(0);
  });

  it("4. Aluno que entra posteriormente em reserva não recebe mais atualizações automáticas", async () => {
    const pId = proximoId();
    const intId = `integ-auto-entra-reserva-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raAluno = "00202704";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST4', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raAluno,
          nome: "ALUNO QUE ENTRA EM RESERVA",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "TRUE",
            ensino_medio: "TRUE",
            contrato: "FALSE",
          },
        },
      ]),
    );
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    // 1. Ingestão inicial como "Em curso"
    await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-step1",
    });

    const aluno = await env.DB.prepare(`SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?`).bind(pId, raAluno).first<{ id: number }>();
    expect(aluno).toBeDefined();

    // 2. Aluno agora entra em reserva na aba geral e altera documentos na aba de controle
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso - (Reserva de vaga)", "PSICOLOGIA");
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raAluno,
          nome: "ALUNO QUE ENTRA EM RESERVA",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "TRUE",
            ensino_medio: "TRUE",
            contrato: "TRUE", // Mudança que deve ser BLOQUEADA pois o aluno entrou em reserva!
          },
        },
      ]),
    );

    const repBloqueado = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 2 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-step2",
    });

    expect(repBloqueado.status).toBe("SUCCESS");
    expect(repBloqueado.inboundReport?.alunosExcluidosPorReservaDeVaga).toContain(raAluno);
    expect(repBloqueado.inboundReport?.camposAtualizadosNoD1).toBe(0);

    // O documento no D1 DEVE continuar inalterado (contrato = 0)
    const docs = await env.DB.prepare(`SELECT contrato FROM documentos WHERE aluno_id = ?`).bind(aluno!.id).first<{ contrato: number }>();
    expect(docs?.contrato).toBe(0);
  });

  it("5. Execuções repetidas sem mutações são 100% idempotentes e sem duplicações", async () => {
    const pId = proximoId();
    const intId = `integ-auto-idemp-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raAluno = "00202705";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST5', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(controlTab, buildControlGrid([{ ra: raAluno, nome: "ALUNO IDEMPOTENTE", docs: { identidade: "TRUE", cpf_documento: "TRUE", certidao: "TRUE", residencia: "TRUE", titulo: "TRUE", ensino_medio: "TRUE", contrato: "TRUE" } }]));
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    // 1º Ciclo: Cria aluno
    const rep1 = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-idemp1",
    });
    expect(rep1.inboundReport?.alunosCriadosNoD1).toBe(1);

    // 2º e 3º Ciclos: Repetições com o mesmo estado da planilha
    for (let c = 2; c <= 3; c++) {
      const repN = await executeIntegrationSyncCycle({
        db: env.DB,
        integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: c },
        adapter,
        tabNameResolver: tabResolver,
        workerId: `w-idemp${c}`,
      });

      expect(repN.status).toBe("SUCCESS");
      expect(repN.inboundReport?.alunosCriadosNoD1).toBe(0);
      expect(repN.inboundReport?.camposAtualizadosNoD1).toBe(0);
      expect(repN.inboundReport?.camposEmSincronia).toBe(7);
    }

    // Contagem rigorosa no D1: exatamente 1 aluno e 1 linha de documentos
    const alunosCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM alunos WHERE periodo_id = ?`).bind(pId).first<{ total: number }>();
    expect(alunosCount?.total).toBe(1);

    const docsCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM documentos d JOIN alunos a ON a.id = d.aluno_id WHERE a.periodo_id = ?`).bind(pId).first<{ total: number }>();
    expect(docsCount?.total).toBe(1);
  });

  it("6. Concorrência e recuperação de lease: bloqueio atômico e usurpação pós-expiração", async () => {
    const pId = proximoId();
    const intId = `integ-auto-lease-${pId}`;

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST6', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    // 1. Worker 1 adquire lease válido por 45 segundos
    const acq1 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId: intId,
      owner: "worker-inst-1",
      durationSeconds: 45,
    });
    expect(acq1.ok).toBe(true);
    expect(acq1.epoch).toBe(1);

    // 2. Worker 2 tenta adquirir imediatamente -> deve falhar com LOCKED
    const acq2 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId: intId,
      owner: "worker-inst-2",
      durationSeconds: 45,
    });
    expect(acq2.ok).toBe(false);
    expect(acq2.status).toBe("LOCKED");

    // 3. Força expiração do lease no banco D1
    await env.DB.prepare(
      `UPDATE sync_coordinator_leases
       SET lease_until = '2000-01-01 00:00:00'
       WHERE integration_id = ?`,
    ).bind(intId).run();

    // 4. Worker 2 agora tenta novamente -> detecta lease expirado, incrementa epoch e assume titularidade
    const acq3 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId: intId,
      owner: "worker-inst-2",
      durationSeconds: 45,
    });
    expect(acq3.ok).toBe(true);
    expect(acq3.epoch).toBe(2);
    expect(acq3.owner).toBe("worker-inst-2");
  });

  it("7. Conflito entre alteração local (outbox pendente) e alteração na planilha: Fail-Closed e registro F3", async () => {
    const pId = proximoId();
    const intId = `integ-auto-conflict-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raAluno = "00202707";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST7', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(controlTab, buildControlGrid([{ ra: raAluno, nome: "ALUNO CONFLITO", docs: { identidade: "TRUE", cpf_documento: "TRUE", certidao: "TRUE", residencia: "TRUE", titulo: "FALSE", ensino_medio: "TRUE", contrato: "FALSE" } }]));
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    // 1. Ingestão inicial com baseline estabelecida
    await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-conf-init",
    });

    const recordId = `rec-${pId}-FCH_EAD-${raAluno}`;

    // 2. Simula alteração feita no site local que gerou operação pendente na outbox (titulo: 0 -> 1)
    const cmdId = `cmd-local-${pId}-1`;
    const opId = `op-local-${pId}-1`;
    const evtId = `evt-local-${pId}-1`;

    await env.DB.prepare(
      `INSERT INTO sync_commands (command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status)
       VALUES (?, 'user-secretaria', ?, 'titulo', 0, 1, 'hash-local-1', 'ACCEPTED')`,
    ).bind(cmdId, recordId).run();

    await env.DB.prepare(
      `INSERT INTO sync_events (event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id)
       VALUES (?, ?, 'titulo', ?, 0, 1, 0, 1, 'user-secretaria')`,
    ).bind(evtId, recordId, cmdId).run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, record_id, field_key, target_key, event_id, target_revision, state)
       VALUES (?, ?, 'titulo', 'CONTROLE', ?, 1, 'PENDING')`,
    ).bind(opId, recordId, evtId).run();

    // 3. Na planilha externa, alguém colocou simultaneamente valor divergente (TRUE)
    // porém o reconciliador detecta que há operação local em trânsito com valor_old = 0 e a planilha agora tem TRUE
    // mas com status PENDING não convergido
    adapter.setControlData(controlTab, buildControlGrid([{ ra: raAluno, nome: "ALUNO CONFLITO", docs: { identidade: "TRUE", cpf_documento: "TRUE", certidao: "TRUE", residencia: "TRUE", titulo: "TRUE", ensino_medio: "TRUE", contrato: "FALSE" } }]));

    // Modifica activeOp para UNCERTAIN para forçar detecção estrita de conflito
    await env.DB.prepare(`UPDATE sync_operations SET state = 'UNCERTAIN' WHERE operation_id = ?`).bind(opId).run();

    const repConflict = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 2 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-conf-run",
    });

    expect(repConflict.status).toBe("SUCCESS");
    expect(repConflict.inboundReport?.conflitosDetectados).toBeGreaterThanOrEqual(1);
    expect(repConflict.inboundReport?.divergenciasComOutboxPendente.length).toBeGreaterThanOrEqual(1);

    // O D1 NÃO foi sobrescrito cegamente: o conflito foi formalmente registrado na tabela sync_conflicts
    const conflictRecord = await env.DB.prepare(
      `SELECT conflict_id, record_id, field_key, target_key, reason, resolved
       FROM sync_conflicts
       WHERE record_id = ? AND field_key = 'titulo'`,
    ).bind(recordId).first<any>();

    expect(conflictRecord).toBeDefined();
    expect(conflictRecord.reason).toBe("DIVERGENCIA_COM_OPERACAO_PENDENTE");
    expect(conflictRecord.resolved).toBe(0);
  });

  it("8. Preservação integral dos alunos fictícios do período 999", async () => {
    // 1. Cadastra os 4 alunos fictícios no período 999
    await env.DB.prepare(`INSERT OR IGNORE INTO periodos (id, codigo, status) VALUES (999, '2026-2-HOMOLOG', 'ATIVO')`).run();

    const dummyRas = ["0090001001", "0090001002", "0090002001", "0090002002"];
    for (const ra of dummyRas) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO alunos (periodo_id, ra, nome, curso, unidade, status)
         VALUES (999, ?, 'ALUNO FICTICIO 999', 'ADMINISTRAÇÃO', 'FACE', 'ATIVO')`,
      ).bind(ra).run();
    }

    const count999Antes = await env.DB.prepare(`SELECT COUNT(*) as total FROM alunos WHERE periodo_id = 999`).first<{ total: number }>();
    expect(count999Antes?.total).toBe(4);

    // 2. Executa ciclo automático para um novo período 20271
    const pId = proximoId();
    const intId = `integ-auto-isolamento-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-TEST8', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(controlTab, buildControlGrid([{ ra: "00202708", nome: "NOVO ALUNO 2027", docs: { identidade: "TRUE", cpf_documento: "TRUE", certidao: "TRUE", residencia: "TRUE", titulo: "TRUE", ensino_medio: "TRUE", contrato: "TRUE" } }]));
    adapter.setGeneralStudent(generalTab, "00202708", "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-iso",
    });

    // 3. Confirma que os 4 alunos do período 999 continuam rigorosamente intactos
    const count999Depois = await env.DB.prepare(`SELECT COUNT(*) as total FROM alunos WHERE periodo_id = 999`).first<{ total: number }>();
    expect(count999Depois?.total).toBe(4);

    const alunos999 = await env.DB.prepare(`SELECT ra FROM alunos WHERE periodo_id = 999 ORDER BY ra ASC`).all<any>();
    expect(alunos999.results.map((a) => a.ra)).toEqual(dummyRas);
  });
  it("9. Modo SHADOW é estritamente não persistente mesmo com autoCreateMissingAlunos = true e dryRun = false", async () => {
    const pId = proximoId();
    const intId = `integ-auto-shadow-safe-${pId}`;
    const controlTab = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTab = "FCH - EAD 2027 - 1";
    const raAluno = "00202709";

    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-SHADOW', 'ATIVO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'SHADOW')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();
    adapter.setControlData(
      controlTab,
      buildControlGrid([
        {
          ra: raAluno,
          nome: "ALUNO SHADOW TEST",
          docs: {
            identidade: "TRUE",
            cpf_documento: "TRUE",
            certidao: "TRUE",
            residencia: "TRUE",
            titulo: "TRUE",
            ensino_medio: "TRUE",
            contrato: "TRUE",
          },
        },
      ]),
    );
    adapter.setGeneralStudent(generalTab, raAluno, "Em curso", "PSICOLOGIA");

    const tabResolver = createTabNameResolver({
      sheetsConfig: { aba_docs_fch_ead: controlTab, aba_base_fch_ead: generalTab },
    });

    // Executa ciclo em modo SHADOW
    const repShadow = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "SHADOW", epoch: 1 },
      adapter,
      tabNameResolver: tabResolver,
      workerId: "w-shadow",
    });

    expect(repShadow.status).toBe("SUCCESS");
    expect(repShadow.inboundReport?.dryRun).toBe(true);
    expect(repShadow.inboundReport?.alunosCriadosNoD1).toBe(1); // Simulado no relatório
    expect(repShadow.inboundReport?.mutacoesPersistidas).toBe(0);

    // Conferência rigorosa no D1: NENHUM aluno, documento, sync_record ou baseline persistido!
    const alunosCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM alunos WHERE periodo_id = ?`).bind(pId).first<{ total: number }>();
    expect(alunosCount?.total).toBe(0);

    const docsCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM documentos d JOIN alunos a ON a.id = d.aluno_id WHERE a.periodo_id = ?`).bind(pId).first<{ total: number }>();
    expect(docsCount?.total).toBe(0);

    const recordsCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM sync_records WHERE integration_id = ?`).bind(intId).first<{ total: number }>();
    expect(recordsCount?.total).toBe(0);

    const baselineCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM sync_field_state fs JOIN sync_records sr ON sr.record_id = fs.record_id WHERE sr.integration_id = ?`).bind(intId).first<{ total: number }>();
    expect(baselineCount?.total).toBe(0);
  });

  it("10. Multi-período: PAUSED em um período não bloqueia CAPTURE em outro, e mesmo RA permanece isolado", async () => {
    const p1 = proximoId();
    const p2 = proximoId();
    const int1 = `integ-multi-p1-${p1}`;
    const int2 = `integ-multi-p2-${p2}`;
    const raCompartilhado = "00202799";

    // Período 1: 2026-2 em PAUSED
    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2026-2-MULTI', 'ATIVO')`).bind(p1).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-p1', 'PAUSED')`).bind(int1, p1).run();

    // Período 2: 2027-1 em CAPTURE
    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2027-1-MULTI', 'ATIVO')`).bind(p2).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-p2', 'CAPTURE')`).bind(int2, p2).run();

    // Cadastra o aluno previamente no Período 1 com identidade = 0
    await env.DB.prepare(`INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status) VALUES (9801, ?, ?, 'ALUNO P1', 'ADMIN', 'FACE', 'ATIVO')`).bind(p1, raCompartilhado).run();
    await env.DB.prepare(`INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato) VALUES (9801, 0, 0, 0, 0, 0, 0, 0)`).run();

    // Na planilha do Período 2, o mesmo RA tem identidade = 1
    const adapter = new InMemorySheetAdapter();
    const controlTabP2 = "CONTROLE DE DOCUMENTOS FCH EAD";
    const generalTabP2 = "FCH - EAD 2027 - 1";
    adapter.setControlData(controlTabP2, buildControlGrid([{ ra: raCompartilhado, nome: "ALUNO P2", docs: { identidade: "TRUE", cpf_documento: "FALSE", certidao: "FALSE", residencia: "FALSE", titulo: "FALSE", ensino_medio: "FALSE", contrato: "FALSE" } }]));
    adapter.setGeneralStudent(generalTabP2, raCompartilhado, "Em curso", "PEDAGOGIA");

    // Executa ciclo do scheduler contendo ambos os períodos
    const schedReport = await runScheduledSyncV2({
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        SYNC_V2_AUTO_ENABLED: "true",
      },
      customAdapter: adapter,
      customTabNameResolver: createTabNameResolver({
        sheetsConfig: { aba_docs_fch_ead: controlTabP2, aba_base_fch_ead: generalTabP2 },
      }),
    });

    expect(schedReport.sucesso).toBe(true);
    // Período 1 foi ignorado (PAUSED), Período 2 executou com sucesso
    const repP1 = schedReport.relatorios.find((r) => r.integrationId === int1);
    const repP2 = schedReport.relatorios.find((r) => r.integrationId === int2);

    expect(repP1?.status).toBe("SKIPPED_NOT_ELIGIBLE");
    expect(repP2?.status).toBe("SUCCESS");

    // Isolamento de dados entre os dois períodos:
    // Aluno no Período 1 permaneceu com identidade = 0
    const docP1 = await env.DB.prepare(`SELECT identidade FROM documentos WHERE aluno_id = 9801`).first<{ identidade: number }>();
    expect(docP1?.identidade).toBe(0);

    // Aluno no Período 2 foi criado com identidade = 1
    const alunoP2 = await env.DB.prepare(`SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?`).bind(p2, raCompartilhado).first<{ id: number }>();
    expect(alunoP2).toBeDefined();
    expect(alunoP2?.id).not.toBe(9801);

    const docP2 = await env.DB.prepare(`SELECT identidade FROM documentos WHERE aluno_id = ?`).bind(alunoP2!.id).first<{ identidade: number }>();
    expect(docP2?.identidade).toBe(1);
  });

  it("11. Período encerrado/arquivado (status = 'ARQUIVADO') não sincroniza automaticamente sem reativação explícita", async () => {
    const pId = proximoId();
    const intId = `integ-auto-arquivado-${pId}`;

    // Cadastra período como ARQUIVADO
    await env.DB.prepare(`INSERT INTO periodos (id, codigo, status) VALUES (?, '2025-2-ARQ', 'ARQUIVADO')`).bind(pId).run();
    await env.DB.prepare(`INSERT INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, mode) VALUES (?, ?, 'sheet-test', 'CAPTURE')`).bind(intId, pId).run();

    const adapter = new InMemorySheetAdapter();

    // 1. O scheduler geral nem sequer busca integrações de períodos arquivados
    const schedReport = await runScheduledSyncV2({
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        SYNC_V2_AUTO_ENABLED: "true",
      },
      customAdapter: adapter,
      targetPeriodoId: pId,
    });

    expect(schedReport.sucesso).toBe(true);
    expect(schedReport.totalIntegracoesEncontradas).toBe(0);

    // 2. Se executeIntegrationSyncCycle for chamado diretamente, bloqueia com SKIPPED_NOT_ELIGIBLE
    const directRep = await executeIntegrationSyncCycle({
      db: env.DB,
      integration: { integration_id: intId, periodo_id: pId, spreadsheet_id: "sheet-test", mode: "CAPTURE", epoch: 1 },
      adapter,
      tabNameResolver: createTabNameResolver(),
      workerId: "w-arq-check",
    });

    expect(directRep.status).toBe("SKIPPED_NOT_ELIGIBLE");
    expect(directRep.motivo).toContain("status = 'ARQUIVADO'");
  });
});
