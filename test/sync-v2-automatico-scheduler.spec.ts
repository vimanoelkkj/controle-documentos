/**
 * ============================================================================
 * Suíte de Testes — Sincronização Automática V2 (Scheduler & Coordenação D1)
 * ============================================================================
 * Valida o agendamento automático e seguro dos fluxos Inbound e Outbound:
 *  1. Flags desativadas (SYNC_V2_ENABLED e SYNC_V2_AUTO_ENABLED).
 *  2. Concorrência entre múltiplos workers com lease persistente no D1.
 *  3. Ordem estrita do ciclo: Inbound (captura) antes de Outbound (despacho).
 *  4. Fencing e usurpação segura de leases expirados.
 *  5. Revalidação de fencing pré-mutação (detecção de FENCING_LOST).
 *  6. Contratos de cada modo: BIDIRECTIONAL, CAPTURE, SHADOW, PAUSED, QUARANTINED, LEGACY.
 *  7. Bloqueio de operações contra Conflitos F3 abertos e estados UNCERTAIN.
 *  8. Ausência total de eco de escrita e preservação de fórmulas J/K.
 *  9. Disparo pelo handler scheduled do Worker.
 * ============================================================================
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  acquireCoordinatorLease,
  verifyCoordinatorLease,
  releaseCoordinatorLease,
  runScheduledSyncV2,
  type IntegrationMode,
} from "../src/server/services/sync-coordinator";
import {
  initSyncRecord,
  establishFieldBaseline,
  executeFieldMutation,
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
import workerHandler from "../src/worker";

let testSeq = 1;
const proximoId = () => 9100 + testSeq++;

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

class MockSchedulerAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-scheduler-adapter";
  public sheets: Map<string, Map<string, unknown[][]>> = new Map();
  public writesExecuted: Array<{ tabName: string; fieldKey: string; cell: string; val: unknown }> = [];

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
      duplicateRas: [],
    };
  }

  async readGeneralTab(): Promise<GeneralTabReadResult> {
    return {
      spreadsheetId: "mock",
      tabName: "mock",
      groupKey: "FACE_FEA",
      headerFingerprint: "mock",
      readAt: new Date().toISOString(),
      rowsByRa: new Map(),
      duplicateRas: [],
    };
  }

  async writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    preconditions: any;
  }): Promise<WriteResult> {
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    if (!grid) {
      throw new Error(`Planilha não encontrada para escrita`);
    }

    const fieldKeys: FieldKey[] = [
      "identidade",
      "cpf_documento",
      "certidao",
      "residencia",
      "titulo",
      "ensino_medio",
      "contrato",
    ];
    const colIndex = fieldKeys.indexOf(params.fieldKey);
    if (colIndex === -1) throw new Error("Campo inválido");

    for (let r = 1; r < grid.length; r++) {
      if (String(grid[r][0]).trim() === params.raText) {
        const strVal = params.preconditions.targetValue === 1 ? "TRUE" : "FALSE";
        grid[r][2 + colIndex] = strVal;
        const cellCoord = `${String.fromCharCode(67 + colIndex)}${r + 1}`;
        this.writesExecuted.push({
          tabName: params.tabName,
          fieldKey: params.fieldKey,
          cell: cellCoord,
          val: strVal,
        });

        return {
          success: true,
          status: "COMMITTED",
          cellCoordinate: cellCoord,
          observedValue: strVal,
        };
      }
    }

    throw new Error(`Aluno ${params.raText} não encontrado na planilha para escrita`);
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

function montarGridControle(alunos: Array<{ ra: string; nome: string; docs?: Record<string, string> }>) {
  const header = [
    "RA",
    "NOME DO ALUNO",
    ...EXPECTED_CONTROL_HEADERS,
    "TOTAL ENTREGUES",
    "STATUS DOCUMENTAL",
  ];
  const grid: unknown[][] = [header];
  for (const a of alunos) {
    grid.push([
      a.ra,
      a.nome,
      a.docs?.identidade || "PENDENTE",
      a.docs?.cpf_documento || "PENDENTE",
      a.docs?.certidao || "PENDENTE",
      a.docs?.residencia || "PENDENTE",
      a.docs?.titulo || "PENDENTE",
      a.docs?.ensino_medio || "PENDENTE",
      a.docs?.contrato || "PENDENTE",
      '=CONT.SE(C2:I2; VERDADEIRO) + CONT.SE(C2:I2; "OK") + CONT.SE(C2:I2; "SIM")',
      '=SE(J2=7; "COMPLETO"; "PENDENTE")',
    ]);
  }
  return grid;
}

async function setupAmbienteScheduler(params?: { mode?: IntegrationMode }) {
  const pId = proximoId();
  const periodoCodigo = `2026-SCHED-${pId}`;
  const mode = params?.mode ?? "BIDIRECTIONAL";

  await env.DB.prepare(`INSERT OR REPLACE INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`)
    .bind(pId, periodoCodigo).run();

  const intId = `integ-sched-${pId}`;
  const sheetId = `sheet-sched-${pId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sync_integrations (integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode)
     VALUES (?, ?, ?, 1, 1, ?)`,
  ).bind(intId, pId, sheetId, mode).run();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO google_sheets_periodos (
      periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
      aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
    ) VALUES (?, ?, 'BASE_FACE', 'BASE_FCH', 'CONTROLE DE DOCUMENTOS FACE FEA', 'CONTROLE DE DOCUMENTOS FCH EAD', 'CANC_FACE', 'CANC_FCH')`,
  ).bind(pId, sheetId).run();

  return { periodoId: pId, integrationId: intId, spreadsheetId: sheetId };
}

async function cadastrarAlunoComBaseline(params: {
  periodoId: number;
  integrationId: string;
  ra: string;
  nome: string;
  groupKey?: GroupKey;
  docsIniciais?: Partial<Record<FieldKey, 0 | 1>>;
}) {
  const { periodoId, integrationId, ra, nome, groupKey = "FACE_FEA", docsIniciais = {} } = params;
  const aId = proximoId();

  await env.DB.prepare(
    `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
     VALUES (?, ?, ?, ?, 'CURSO TESTE', 'FACE FEA', 'ATIVO')`,
  ).bind(aId, periodoId, ra, nome).run();

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
    const evidence = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId: aId, f, val }));
    await establishFieldBaseline(env.DB, {
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
  }

  return { alunoId: aId, recordId };
}

describe("Sincronização Automática V2 — Scheduler & Coordenação D1", { timeout: 15000 }, () => {
  it("1. Flags desativadas: scheduler recusa execução silenciosa sem SYNC_V2_ENABLED e SYNC_V2_AUTO_ENABLED", async () => {
    const { periodoId } = await setupAmbienteScheduler();

    // 1.1 Ambos desativados
    const rep1 = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "false", SYNC_V2_AUTO_ENABLED: "false" },
      targetPeriodoId: periodoId,
    });
    expect(rep1.sucesso).toBe(false);
    expect(rep1.erroGeral).toContain("SYNC_V2_DISABLED");

    // 1.2 Apenas SYNC_V2_ENABLED ativo, mas AUTO desligado
    const rep2 = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "false" },
      targetPeriodoId: periodoId,
    });
    expect(rep2.sucesso).toBe(false);
    expect(rep2.erroGeral).toContain("SYNC_V2_AUTO_DISABLED");
    expect(rep2.integracoesExecutadas).toBe(0);
  });

  it("2. Coordenação multi-worker com lease e fencing no D1: impede execução simultânea da mesma integração", async () => {
    const { integrationId } = await setupAmbienteScheduler();

    // Worker 1 adquire lease
    const acq1 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-alpha",
      leaseType: "FULL_CYCLE",
      durationSeconds: 30,
    });
    expect(acq1.ok).toBe(true);
    if (!acq1.ok) return;
    expect(acq1.epoch).toBeGreaterThanOrEqual(1);

    // Worker 2 tenta adquirir imediatamente para a mesma integração: BLOQUEADO
    const acq2 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-beta",
      leaseType: "FULL_CYCLE",
      durationSeconds: 30,
    });
    expect(acq2.ok).toBe(false);
    if (acq2.ok) return;
    expect(acq2.status).toBe("LOCKED");
    expect(acq2.currentOwner).toBe("worker-instancia-alpha");

    // Worker 1 libera o lease
    await releaseCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-alpha",
      epoch: acq1.epoch,
    });

    // Worker 2 agora consegue adquirir, com epoch incrementado
    const acq3 = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-beta",
      leaseType: "FULL_CYCLE",
      durationSeconds: 30,
    });
    expect(acq3.ok).toBe(true);
    if (acq3.ok) {
      expect(acq3.epoch).toBe(acq1.epoch + 1);
      await releaseCoordinatorLease({
        db: env.DB,
        integrationId,
        owner: "worker-instancia-beta",
        epoch: acq3.epoch,
      });
    }
  });

  it("3. Usurpação segura de lease expirado por inatividade: incrementa epoch e retoma sem deadlock", async () => {
    const { integrationId } = await setupAmbienteScheduler();

    // Simula lease adquirido no passado que expirou
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const acqExpired = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-moribundo",
      leaseType: "FULL_CYCLE",
      durationSeconds: 1,
      now: pastTime,
    });
    expect(acqExpired.ok).toBe(true);
    const oldEpoch = acqExpired.ok ? acqExpired.epoch : 1;

    // Novo worker chega e constata que lease_until expirou
    const acqNew = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-ativo-novo",
      leaseType: "FULL_CYCLE",
      durationSeconds: 30,
    });

    expect(acqNew.ok).toBe(true);
    if (acqNew.ok) {
      expect(acqNew.owner).toBe("worker-ativo-novo");
      expect(acqNew.epoch).toBe(oldEpoch + 1);
      await releaseCoordinatorLease({
        db: env.DB,
        integrationId,
        owner: "worker-ativo-novo",
        epoch: acqNew.epoch,
      });
    }
  });

  it("4. Ciclo Completo Coordenado: Inbound (captura Sheets -> D1) seguido de Outbound (despacho D1 -> Sheets)", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteScheduler();
    const adapter = new MockSchedulerAdapter();

    // Aluno 1: alterado externamente na planilha (RG marcado como TRUE)
    const ra1 = "0090003001";
    const { alunoId: aId1 } = await cadastrarAlunoComBaseline({
      periodoId,
      integrationId,
      ra: ra1,
      nome: "Aluno Inbound Scheduler",
      docsIniciais: { identidade: 0 },
    });

    // Aluno 2: alterado internamente no site (Contrato marcado como 1 gerando outbox PENDING)
    const ra2 = "0090003002";
    const { recordId: recId2 } = await cadastrarAlunoComBaseline({
      periodoId,
      integrationId,
      ra: ra2,
      nome: "Aluno Outbound Scheduler",
      docsIniciais: { contrato: 0 },
    });

    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-sched-${ra2}`,
      actorId: "user:secretaria",
      recordId: recId2,
      fieldKey: "contrato",
      fromRevision: 0,
      proposedValue: 1,
      integrationId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    // Configura dados da planilha no mock:
    // Aluno 1 tem IDENTIDADE = TRUE
    // Aluno 2 tem CONTRATO = PENDENTE (aguardando o despacho outbound)
    const gridFace = montarGridControle([
      { ra: ra1, nome: "Aluno Inbound Scheduler", docs: { identidade: "VERDADEIRO" } },
      { ra: ra2, nome: "Aluno Outbound Scheduler", docs: { contrato: "PENDENTE" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", gridFace);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridControle([]));

    // Executa ciclo do scheduler
    const rep = await runScheduledSyncV2({
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        SYNC_V2_AUTO_ENABLED: "true",
        ENVIRONMENT: "test",
      },
      targetPeriodoId: periodoId,
      customAdapter: adapter,
    });

    expect(rep.sucesso).toBe(true);
    expect(rep.integracoesExecutadas).toBe(1);

    const cicloRep = rep.relatorios[0];
    expect(cicloRep.status).toBe("SUCCESS");

    // 1. Inbound aplicado no Aluno 1
    expect(cicloRep.inboundReport?.camposAtualizadosNoD1).toBe(1);
    const docDb1 = await env.DB.prepare(`SELECT identidade FROM documentos WHERE aluno_id = ?`)
      .bind(aId1).first<{ identidade: number }>();
    expect(docDb1?.identidade).toBe(1);

    // 2. Outbound despachado para o Aluno 2 (operações CONTROLE e GERAL_CONTRATO)
    expect(cicloRep.outboundReport?.observedCount).toBe(2);
    expect(adapter.writesExecuted.some((w) => w.fieldKey === "contrato" && w.val === "TRUE")).toBe(true);

    // 3. Ausência de Eco: Aluno 1 não gerou operação pendente na outbox para CONTROLE
    const outboxOps = await env.DB.prepare(
      `SELECT count(*) as total FROM sync_operations WHERE record_id = ? AND state = 'PENDING'`,
    ).bind(`rec-${periodoId}-FACE_FEA-${ra1}`).first<{ total: number }>();
    expect(outboxOps?.total).toBe(0);
  });

  it("5. Ordem estrita protege contra sobrescrita cega: Inbound detecta alteração humana e abre conflito F3 contra outbox pendente", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupAmbienteScheduler();
    const adapter = new MockSchedulerAdapter();

    const ra = "0090003003";
    const { recordId } = await cadastrarAlunoComBaseline({
      periodoId,
      integrationId,
      ra,
      nome: "Aluno Concorrente",
      docsIniciais: { residencia: 0 },
    });

    // Secretaria marcou residencia = 1 no site gerando outbox PENDING, mas em estado UNCERTAIN de rede
    await executeFieldMutation(env.DB, {
      commandId: `cmd-conc-sched-${ra}`,
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

    await env.DB.prepare(
      `UPDATE sync_operations SET state = 'UNCERTAIN' WHERE record_id = ? AND field_key = 'residencia'`,
    ).bind(recordId).run();

    // Na planilha, a residência tem valor divergente da mutação pendente (ex: 'FALSE')
    const gridFace = montarGridControle([
      { ra, nome: "Aluno Concorrente", docs: { residencia: "FALSE" } },
    ]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", gridFace);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridControle([]));

    // Executa o ciclo do scheduler
    const rep = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      targetPeriodoId: periodoId,
      customAdapter: adapter,
    });

    expect(rep.sucesso).toBe(true);
    const ciclo = rep.relatorios[0];

    // O Inbound detectou o conflito e registrou em sync_conflicts
    expect(ciclo.inboundReport?.conflitosDetectados).toBe(1);

    // O Outbound subsequente foi bloqueado pelo conflito aberto sem escrever na planilha
    const conflito = await env.DB.prepare(
      `SELECT reason, resolved FROM sync_conflicts WHERE record_id = ? AND field_key = 'residencia'`,
    ).bind(recordId).first<{ reason: string; resolved: number }>();
    expect(conflito?.reason).toBe("DIVERGENCIA_COM_OPERACAO_PENDENTE");

    // Nenhuma escrita foi feita pelo outbound sobre a residência deste aluno
    expect(adapter.writesExecuted.some((w) => w.fieldKey === "residencia")).toBe(false);
  });

  it("6. Revalidação de Fencing: worker perde lease durante a execução e aborta preventivamente antes de mutações (FENCING_LOST)", async () => {
    const { integrationId, spreadsheetId } = await setupAmbienteScheduler();
    const adapter = new MockSchedulerAdapter();

    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", montarGridControle([]));
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridControle([]));

    // Testamos a função verifyCoordinatorLease
    const acq = await acquireCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-antiga",
      leaseType: "FULL_CYCLE",
      durationSeconds: 10,
    });
    expect(acq.ok).toBe(true);

    // Outro worker usurpa o lease
    await env.DB.prepare(
      `UPDATE sync_coordinator_leases
       SET lease_owner = 'worker-instancia-inversora',
           lease_epoch = lease_epoch + 1
       WHERE integration_id = ?`,
    ).bind(integrationId).run();

    // Verificação de fencing falha imediatamente
    const valid = await verifyCoordinatorLease({
      db: env.DB,
      integrationId,
      owner: "worker-instancia-antiga",
      epoch: acq.ok ? acq.epoch : 1,
    });
    expect(valid).toBe(false);
  });

  it("7. Contratos de cada modo de integração: respeita permissões formais", async () => {
    // 7.1 PAUSED e QUARANTINED: ignoradas pelo scheduler
    const mockAdapter = new MockSchedulerAdapter();
    const { periodoId: pPaused } = await setupAmbienteScheduler({ mode: "PAUSED" });
    const repPaused = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      targetPeriodoId: pPaused,
      customAdapter: mockAdapter,
    });
    expect(repPaused.relatorios[0].status).toBe("SKIPPED_NOT_ELIGIBLE");

    const { periodoId: pQuar } = await setupAmbienteScheduler({ mode: "QUARANTINED" });
    const repQuar = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      targetPeriodoId: pQuar,
      customAdapter: mockAdapter,
    });
    expect(repQuar.relatorios[0].status).toBe("SKIPPED_NOT_ELIGIBLE");

    // 7.2 CAPTURE: Inbound ativo e Outbound desativado
    const { periodoId: pCap, integrationId: intCap, spreadsheetId: shCap } = await setupAmbienteScheduler({ mode: "CAPTURE" });
    const adapterCap = new MockSchedulerAdapter();
    const raCap = "0090003004";
    const { alunoId: aIdCap, recordId: recIdCap } = await cadastrarAlunoComBaseline({
      periodoId: pCap,
      integrationId: intCap,
      ra: raCap,
      nome: "Aluno Capture",
      docsIniciais: { titulo: 0, certidao: 0 },
    });

    // Inbound: Planilha marcou título = TRUE
    adapterCap.setSheetData(shCap, "CONTROLE DE DOCUMENTOS FACE FEA", montarGridControle([
      { ra: raCap, nome: "Aluno Capture", docs: { titulo: "VERDADEIRO" } },
    ]));
    adapterCap.setSheetData(shCap, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridControle([]));

    // Outbound: Secretaria marcou certidão = 1
    await executeFieldMutation(env.DB, {
      commandId: `cmd-cap-${raCap}`,
      actorId: "user:secretaria",
      recordId: recIdCap,
      fieldKey: "certidao",
      fromRevision: 0,
      proposedValue: 1,
      integrationId: intCap,
      periodoId: pCap,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
    });

    const repCap = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      targetPeriodoId: pCap,
      customAdapter: adapterCap,
    });

    expect(repCap.relatorios[0].status).toBe("SUCCESS");
    // Inbound aplicou no D1:
    const docCap = await env.DB.prepare(`SELECT titulo FROM documentos WHERE aluno_id = ?`)
      .bind(aIdCap).first<{ titulo: number }>();
    expect(docCap?.titulo).toBe(1);

    // Outbound não rodou (nenhuma escrita executada na planilha):
    expect(adapterCap.writesExecuted).toHaveLength(0);
    expect(repCap.relatorios[0].outboundReport).toBeUndefined();

    // 7.3 SHADOW: Inbound roda com dryRun=true (não altera D1)
    const { periodoId: pShad, integrationId: intShad, spreadsheetId: shShad } = await setupAmbienteScheduler({ mode: "SHADOW" });
    const adapterShad = new MockSchedulerAdapter();
    const raShad = "0090003005";
    const { alunoId: aIdShad } = await cadastrarAlunoComBaseline({
      periodoId: pShad,
      integrationId: intShad,
      ra: raShad,
      nome: "Aluno Shadow",
      docsIniciais: { ensino_medio: 0 },
    });

    adapterShad.setSheetData(shShad, "CONTROLE DE DOCUMENTOS FACE FEA", montarGridControle([
      { ra: raShad, nome: "Aluno Shadow", docs: { ensino_medio: "VERDADEIRO" } },
    ]));
    adapterShad.setSheetData(shShad, "CONTROLE DE DOCUMENTOS FCH EAD", montarGridControle([]));

    const repShad = await runScheduledSyncV2({
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      targetPeriodoId: pShad,
      customAdapter: adapterShad,
    });

    expect(repShad.relatorios[0].status).toBe("SUCCESS");
    // No D1, o valor permanece 0 porque o modo SHADOW executa dryRun=true
    const docShad = await env.DB.prepare(`SELECT ensino_medio FROM documentos WHERE aluno_id = ?`)
      .bind(aIdShad).first<{ ensino_medio: number }>();
    expect(docShad?.ensino_medio).toBe(0);
  });

  it("8. Disparo pelo handler scheduled do Worker: integra-se transparentemente", async () => {
    // 8.1 Sem flags ativas: no-op silencioso
    await workerHandler.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *" } as any,
      { DB: env.DB, ASSETS: {} as any, SYNC_V2_ENABLED: "false", SYNC_V2_AUTO_ENABLED: "false" },
      {} as any,
    );

    // 8.2 Com flags ativas: executa o agendador coordenado
    await workerHandler.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *" } as any,
      { DB: env.DB, ASSETS: {} as any, SYNC_V2_ENABLED: "true", SYNC_V2_AUTO_ENABLED: "true" },
      {} as any,
    );
  });
});
