import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SyncV2Orchestrator,
} from "../src/server/services/sync-orchestrator";
import {
  initSyncRecord,
  establishFieldBaseline,
  executeFieldMutation,
  type GroupKey,
  type FieldKey,
} from "../src/server/services/sync-d1-core";
import {
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type GeneralTabReadResult,
  type WritePreconditions,
  type WriteResult,
  type ExternalEffectCheckResult,
  type ProvenanceEvidence,
  EXPECTED_CONTROL_HEADERS,
} from "../src/server/services/sync-sheet-contracts";
import { GoogleSheetsNetworkError } from "../src/server/services/sync-sheet-real-adapter";

/**
 * Adaptador Fake mockado em memória para testes da Orquestração F4-B
 */
class MockTestAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-test-adapter-f4b";
  public sheets: Map<string, Map<string, unknown[][]>> = new Map();
  public simulateWriteErrorStatus: string | null = null;
  public simulateNetworkException = false;
  public simulateNetworkDropAfterWrite = false;
  public writeCalls: Array<{ tabName: string; raText: string; fieldKey: string; targetValue: number }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.sheets.clear();
    this.simulateWriteErrorStatus = null;
    this.simulateNetworkException = false;
    this.simulateNetworkDropAfterWrite = false;
    this.writeCalls = [];
  }

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
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName) || [];
    const rowsByRa = new Map();

    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const raText = String(row[0] || '').trim();
      if (!raText) continue;

      rowsByRa.set(raText, {
        rowIndex: i + 1,
        raText,
        studentName: String(row[1] || ''),
        fields: {
          identidade: { rawValue: String(row[2] || ''), normalizedValue: row[2] === 'TRUE' ? 1 : 0, cellCoordinate: `C${i + 1}` },
          cpf_documento: { rawValue: String(row[3] || ''), normalizedValue: row[3] === 'TRUE' ? 1 : 0, cellCoordinate: `D${i + 1}` },
          certidao: { rawValue: String(row[4] || ''), normalizedValue: row[4] === 'TRUE' ? 1 : 0, cellCoordinate: `E${i + 1}` },
          residencia: { rawValue: String(row[5] || ''), normalizedValue: row[5] === 'TRUE' ? 1 : 0, cellCoordinate: `F${i + 1}` },
          titulo: { rawValue: String(row[6] || ''), normalizedValue: row[6] === 'TRUE' ? 1 : 0, cellCoordinate: `G${i + 1}` },
          ensino_medio: { rawValue: String(row[7] || ''), normalizedValue: row[7] === 'TRUE' ? 1 : 0, cellCoordinate: `H${i + 1}` },
          contrato: { rawValue: String(row[8] || ''), normalizedValue: row[8] === 'TRUE' ? 1 : 0, cellCoordinate: `I${i + 1}` },
        },
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join('::'),
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
      const raText = String(row[6] || '').trim();
      if (!raText) continue;

      rowsByRa.set(raText, {
        rowIndex: i + 1,
        raText,
        contractRawValue: String(row[0] || ''),
        contractNormalizedValue: String(row[0] || '').toUpperCase().includes('ENTREGUE') ? 1 : 0,
        cellCoordinate: `A${i + 1}`,
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: 'SITUAÇÃO CONTRATUAL::RA',
      readAt: new Date().toISOString(),
      rowsByRa,
    };
  }

  async writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: any;
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
        // mutação chegou à planilha antes de cair o socket
        const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
        if (grid) {
          const row = grid.find(r => r[0] === params.raText);
          if (row) row[2] = 'TRUE'; // atualiza identidade
        }
      }
      throw new GoogleSheetsNetworkError('Network socket reset during write', true);
    }

    if (this.simulateWriteErrorStatus) {
      return {
        success: false,
        status: this.simulateWriteErrorStatus as any,
        error: `Simulated error ${this.simulateWriteErrorStatus}`,
        observedValue: 'VALOR_DIVERGENTE_HUMANO',
      };
    }

    // Aplica no grid mockado
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    if (grid) {
      const row = grid.find(r => r[0] === params.raText);
      if (row) {
        row[2] = params.preconditions.targetValue === 1 ? 'TRUE' : 'FALSE';
      }
    }

    return {
      success: true,
      status: 'COMMITTED',
      cellCoordinate: 'C2',
      observedValue: params.preconditions.targetValue === 1 ? 'TRUE' : 'FALSE',
    };
  }

  async verifyExternalEffect(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: any;
    targetKey: any;
    expectedTargetValue: 0 | 1;
  }): Promise<ExternalEffectCheckResult> {
    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    const row = grid?.find(r => r[0] === params.raText);

    if (!row) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: new Date().toISOString(),
      };
    }

    const val = row[2] === 'TRUE' ? 1 : 0;
    const effectObserved = val === params.expectedTargetValue;
    const isAbsentConfirmed = val !== params.expectedTargetValue;

    return {
      effectObserved,
      isAbsentConfirmed,
      currentRawValue: String(row[2]),
      currentNormalizedValue: val,
      cellCoordinate: 'C2',
      inspectedAt: new Date().toISOString(),
    };
  }

  async generateProvenanceEvidence(): Promise<ProvenanceEvidence> {
    throw new Error('Not implemented in mock');
  }
}

describe("F4-B: Orquestração da Sincronização V2 (SyncV2Orchestrator)", () => {
  const periodoId = 7777;
  const integrationFaceId = "int-f4b-face-001";
  const integrationFchId = "int-f4b-fch-001";
  const spreadsheetFaceId = "sheet-f4b-face";
  const spreadsheetFchId = "sheet-f4b-fch";
  let mockAdapter: MockTestAdapter;

  beforeAll(async () => {
    // 1. Criação do período e integrações no D1
    await env.DB.prepare(
      `INSERT OR REPLACE INTO periodos (id, codigo, criado_em, status)
       VALUES (?, '2027-1-F4B', datetime('now'), 'ATIVO')`
    )
      .bind(periodoId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, ?, 1, 1, 'SHADOW')`
    )
      .bind(integrationFaceId, periodoId, spreadsheetFaceId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, ?, 1, 1, 'SHADOW')`
    )
      .bind(integrationFchId, periodoId, spreadsheetFchId)
      .run();
  });

  async function createEvidence(
    source: "SPREADSHEET_IMPORT" | "MANUAL_INITIALIZATION" | "LEGACY_MIGRATION",
    payload: string
  ) {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { source, evidencePayload: payload, evidenceHash: hash };
  }

  async function resetarAmbiente() {
    mockAdapter = new MockTestAdapter();

    // Grades iniciais com colunas J e K de fórmulas
    mockAdapter.setSheetData(spreadsheetFaceId, 'CONTROLE DE DOCUMENTOS FACE FEA', [
      ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS, 'TOTAL_DOCS', 'STATUS_FINAL'],
      ['000123', 'Aluno Face', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '=CONT.SE(C2:I2, TRUE)', '=SE(J2=7, "OK", "PENDENTE")'],
      ['000456', 'Aluno Face 2', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '=CONT.SE(C3:I3, TRUE)', '=SE(J3=7, "OK", "PENDENTE")'],
    ]);

    mockAdapter.setSheetData(spreadsheetFchId, 'CONTROLE DE DOCUMENTOS FCH EAD', [
      ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS, 'TOTAL_DOCS', 'STATUS_FINAL'],
      ['000123', 'Aluno Fch', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '=CONT.SE(C2:I2, TRUE)', '=SE(J2=7, "OK", "PENDENTE")'],
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
    await env.DB.prepare(`DELETE FROM alunos WHERE periodo_id = ?`).bind(periodoId).run();
  }

  async function setupAlunoComBaseline(params: {
    ra: string;
    nome: string;
    groupKey?: GroupKey;
    fieldKey?: FieldKey;
    initialValue?: 0 | 1;
  }) {
    const groupKey = params.groupKey || 'FACE_FEA';
    const fieldKey = params.fieldKey || 'identidade';
    const initialValue = params.initialValue ?? 0;
    const integrationId = groupKey === 'FACE_FEA' ? integrationFaceId : integrationFchId;

    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'ADMINISTRACAO', ?, 'ATIVO')`
    )
      .bind(periodoId, params.ra, params.nome, groupKey === 'FACE_FEA' ? 'FACE' : 'FCH')
      .run();

    const alunoId = Number(res.meta.last_row_id);

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    )
      .bind(alunoId)
      .run();

    const recordId = `rec-${groupKey}-${params.ra}-${crypto.randomUUID().slice(0, 8)}`;
    await initSyncRecord(env.DB, {
      recordId,
      integrationId,
      groupKey,
      raText: params.ra,
      alunoId,
    });

    const evidence = await createEvidence(
      "LEGACY_MIGRATION",
      JSON.stringify({ alunoId, field: fieldKey, group: groupKey })
    );

    const bRes = await establishFieldBaseline(env.DB, {
      recordId,
      fieldKey,
      baselineValue: initialValue,
      commandId: `cmd-base-${recordId}-${fieldKey}`,
      actorId: "actor-setup",
      integrationId,
      periodoId,
      groupKey,
      generation: 1,
      expectedEpoch: 1,
      evidence,
    });
    expect(bRes.ok).toBe(true);

    return { alunoId, recordId, integrationId };
  }

  async function dispararMutacao(params: {
    recordId: string;
    integrationId: string;
    groupKey?: GroupKey;
    fieldKey?: FieldKey;
    fromRevision?: number;
    proposedValue?: number;
  }) {
    const groupKey = params.groupKey || 'FACE_FEA';
    const fieldKey = params.fieldKey || 'identidade';
    const fromRevision = params.fromRevision ?? 0;
    const proposedValue = params.proposedValue ?? 1;

    const res = await executeFieldMutation(env.DB, {
      commandId: `cmd-mut-${params.recordId}-${fieldKey}-${crypto.randomUUID().slice(0, 6)}`,
      actorId: "operator-f4b",
      recordId: params.recordId,
      fieldKey,
      fromRevision,
      proposedValue,
      integrationId: params.integrationId,
      periodoId,
      groupKey,
      generation: 1,
      epoch: 1,
    });
    expect(res.ok).toBe(true);
    return res;
  }

  it('F4-B.1 — Fluxo Completo de Execução em Lote (Happy Path)', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    // Gera mutação no D1 (fromRevision 0 -> 1 gera operação PENDING)
    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-primary-01',
    });

    // Executa a rodada de orquestração
    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.processedCount).toBe(1);
    expect(batchRes.observedCount).toBe(1);
    expect(batchRes.conflictCount).toBe(0);
    expect(batchRes.operations[0].status).toBe('OBSERVED');
    expect(batchRes.operations[0].receiptId).toBeDefined();

    // 1. Confirma que a operação foi marcada como OBSERVED no D1
    const opRow = await env.DB.prepare(`SELECT state, lease_owner FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string; lease_owner: string }>();

    expect(opRow?.state).toBe('OBSERVED');
    expect(opRow?.lease_owner).toBe('worker-primary-01');

    // 2. Confirma histórico imutável em sync_attempts (append-only)
    const attempts = await env.DB.prepare(`SELECT * FROM sync_attempts WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .all();
    expect(attempts.results.length).toBe(1);

    // 3. Confirma recibo em sync_receipts
    const receipts = await env.DB.prepare(`SELECT * FROM sync_receipts WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .all();
    expect(receipts.results.length).toBe(1);

    // 4. Confirma que a planilha recebeu a escrita cirúrgica
    expect(mockAdapter.writeCalls.length).toBe(1);
    expect(mockAdapter.writeCalls[0].raText).toBe('000123');
    expect(mockAdapter.writeCalls[0].targetValue).toBe(1);
  });

  it('F4-B.2 — Concorrência e Duplicidade de Workers: Claim Exclusivo Atômico', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    const orchestrator1 = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-node-alpha',
    });

    const orchestrator2 = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-node-beta',
    });

    // Ambos os workers tentam processar o lote concorrentemente
    const [res1, res2] = await Promise.all([
      orchestrator1.executeBatch(),
      orchestrator2.executeBatch(),
    ]);

    // Exatamente um worker consegue observar a operação
    const totalObserved = res1.observedCount + res2.observedCount;
    expect(totalObserved).toBe(1);

    // O outro worker recebe SKIPPED_NOT_ELIGIBLE
    const totalSkipped = res1.skippedCount + res2.skippedCount;
    expect(totalSkipped).toBe(1);
  });

  it('F4-B.3 — Fencing Token Vencido: Rejeição de Respostas Tardias', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    const op = await env.DB.prepare(`SELECT operation_id FROM sync_operations LIMIT 1`).first<{ operation_id: string }>()!;
    expect(op).toBeDefined();

    // Simula que outro worker assumiu a operação incrementando o lease_epoch
    await env.DB.prepare(`UPDATE sync_operations SET lease_epoch = 5, lease_owner = 'worker-new' WHERE operation_id = ?`)
      .bind(op!.operation_id)
      .run();

    // Worker 1 (lento) tenta despachar com epoch desatualizada
    const orchestratorSlow = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-slow',
    });

    const lateResult = await orchestratorSlow.processPendingOperation(op!.operation_id, '2026-10-20 12:05:00');
    // Deve ser rejeitado ou pulado por inconsistência de fencing/claim
    expect(lateResult.status === 'FENCING_REJECTED' || lateResult.status === 'SKIPPED_NOT_ELIGIBLE').toBe(true);
  });

  it('F4-B.4 — Conflito Externo com Edição Humana: Encaminhamento F3 sem sobrescrita cega', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    // Simula que o adaptador detectou CONFLICT_DETECTED
    mockAdapter.simulateWriteErrorStatus = 'CONFLICT_DETECTED';

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-conflict-test',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.conflictCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('CONFLICT_RECORDED');
    expect(batchRes.operations[0].conflictId).toBeDefined();

    // 1. Confirma que o conflito foi gravado no D1 em sync_conflicts
    const conflicts = await env.DB.prepare(`SELECT * FROM sync_conflicts WHERE conflict_id = ?`)
      .bind(batchRes.operations[0].conflictId)
      .all();

    expect(conflicts.results.length).toBe(1);
    expect(conflicts.results[0].resolved).toBe(0);

    // 2. Confirma que a operação foi colocada em RETRY_WAIT (sem loop infinito e sem sobrescrever a planilha)
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();

    expect(op?.state).toBe('RETRY_WAIT');
  });

  it('F4-B.5 — Incerteza de Rede com Efeito Recuperado na Releitura', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    // Simula que a gravação ocorreu no Google antes do socket cair
    mockAdapter.simulateNetworkException = true;
    mockAdapter.simulateNetworkDropAfterWrite = true;

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-uncertain-recovered',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.observedCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('OBSERVED_VIA_VERIFY');

    // Confirma que foi gerado recibo e o estado no D1 é OBSERVED
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();

    expect(op?.state).toBe('OBSERVED');
  });

  it('F4-B.6 — Incerteza de Rede com Efeito Comprovadamente Ausente (Retry Seguro)', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    // Simula que a gravação NÃO ocorreu no Google antes de cair o socket
    mockAdapter.simulateNetworkException = true;
    mockAdapter.simulateNetworkDropAfterWrite = false;

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-retry-safe',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.retryScheduledCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('RETRY_SCHEDULED');

    // Confirma que a operação está em RETRY_WAIT com agendamento seguro
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();

    expect(op?.state).toBe('RETRY_WAIT');
  });

  it('F4-B.7 — Incerteza de Rede Indeterminada: Preservação em Quarentena sem Retry Cego', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    // Mock que simula erro também na verificação pós-falha
    const brokenAdapter = new MockTestAdapter();
    brokenAdapter.simulateNetworkException = true;
    brokenAdapter.verifyExternalEffect = async () => {
      throw new Error('Planilha totalmente inacessível durante verificação');
    };

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: brokenAdapter,
      workerId: 'worker-quarantine',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.uncertainCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('UNCERTAIN_PRESERVED');

    // Confirma que a operação permanece em UNCERTAIN (sem retry cego e sem falso sucesso)
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();

    expect(op?.state).toBe('UNCERTAIN');
  });

  it('F4-B.8 — Erros Estruturais: Layout Adulterado ou RA Não Encontrado', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    mockAdapter.simulateWriteErrorStatus = 'STUDENT_NOT_FOUND';

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-structural-error',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.structuralErrorCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('STRUCTURAL_ERROR');
  });

  it('F4-B.9 — Isolamento Absoluto entre FACE FEA e FCH EAD com Mesmo RA Textual', async () => {
    await resetarAmbiente();

    // 1 aluno no D1 com o mesmo RA textual 000123
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, '000123', 'Aluno Hibrido', 'ADMINISTRACAO', 'FACE', 'ATIVO')`
    )
      .bind(periodoId)
      .run();

    const alunoId = Number(res.meta.last_row_id);

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    )
      .bind(alunoId)
      .run();

    // Inicializa dois sync_records distintos para o mesmo RA nos dois grupos
    const recordIdFace = `rec-FACE_FEA-000123-${crypto.randomUUID().slice(0, 8)}`;
    const recordIdFch = `rec-FCH_EAD-000123-${crypto.randomUUID().slice(0, 8)}`;

    await initSyncRecord(env.DB, {
      recordId: recordIdFace,
      integrationId: integrationFaceId,
      groupKey: 'FACE_FEA',
      raText: '000123',
      alunoId,
    });

    await initSyncRecord(env.DB, {
      recordId: recordIdFch,
      integrationId: integrationFchId,
      groupKey: 'FCH_EAD',
      raText: '000123',
      alunoId,
    });

    const evFace = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, group: "FACE_FEA" }));
    const evFch = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, group: "FCH_EAD" }));

    await establishFieldBaseline(env.DB, {
      recordId: recordIdFace,
      fieldKey: "identidade",
      baselineValue: 0,
      commandId: `cmd-base-${recordIdFace}`,
      actorId: "actor-iso",
      integrationId: integrationFaceId,
      periodoId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
      evidence: evFace,
    });

    await establishFieldBaseline(env.DB, {
      recordId: recordIdFch,
      fieldKey: "identidade",
      baselineValue: 0,
      commandId: `cmd-base-${recordIdFch}`,
      actorId: "actor-iso",
      integrationId: integrationFchId,
      periodoId,
      groupKey: "FCH_EAD",
      generation: 1,
      expectedEpoch: 1,
      evidence: evFch,
    });

    // Mutações independentes
    await dispararMutacao({ recordId: recordIdFace, integrationId: integrationFaceId, groupKey: 'FACE_FEA' });
    await dispararMutacao({ recordId: recordIdFch, integrationId: integrationFchId, groupKey: 'FCH_EAD' });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-isolation',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.processedCount).toBe(2);
    expect(batchRes.observedCount).toBe(2);

    // Confirma que foram feitas duas chamadas isoladas direcionadas para abas diferentes
    const faceCall = mockAdapter.writeCalls.find(c => c.tabName === 'CONTROLE DE DOCUMENTOS FACE FEA');
    const fchCall = mockAdapter.writeCalls.find(c => c.tabName === 'CONTROLE DE DOCUMENTOS FCH EAD');

    expect(faceCall).toBeDefined();
    expect(fchCall).toBeDefined();
    expect(faceCall?.raText).toBe('000123');
    expect(fchCall?.raText).toBe('000123');
  });

  it('F4-B.10 — Preservação Estrita das Fórmulas das Colunas J e K', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-preserve-formulas',
    });

    await orchestrator.executeBatch();

    // Inspeciona a grade na planilha mockada
    const grid = mockAdapter.sheets.get(spreadsheetFaceId)?.get('CONTROLE DE DOCUMENTOS FACE FEA');
    expect(grid).toBeDefined();
    if (!grid) return;
    // Colunas J (índice 9) e K (índice 10) permanecem estritamente intactas com suas fórmulas
    expect(grid[1][9]).toBe('=CONT.SE(C2:I2, TRUE)');
    expect(grid[1][10]).toBe('=SE(J2=7, "OK", "PENDENTE")');
  });

  it('F4-B.11 — Desativação Total da Sincronização V1 durante Ciclo V2', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-v1-deactivated',
    });

    await orchestrator.executeBatch();

    // Confirma que a tabela legada google_sheets_pendencias permanece 100% vazia
    const pendenciasV1 = await env.DB.prepare(`SELECT count(*) as total FROM google_sheets_pendencias`).first<{ total: number }>();
    expect(pendenciasV1?.total).toBe(0);
  });

  it('F4-B.12 — Bloqueio Estrito de Escrita com Conflito F3 Aberto (Sem Sobrescrita sem Resolução)', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    // Simula que já existe um conflito F3 aberto para este registro e campo
    const conflictId = 'conf_aberto_test_123';
    await env.DB.prepare(
      `INSERT INTO sync_conflicts (
        conflict_id, record_id, field_key, target_key, local_revision,
        local_value, external_value, reason, resolved
      ) VALUES (?, ?, 'identidade', 'CONTROLE', 1, 1, 0, 'Edição humana divergente na planilha', 0)`
    )
      .bind(conflictId, recordId)
      .run();

    let writeChamado = false;
    mockAdapter.writeDocumentField = async () => {
      writeChamado = true;
      throw new Error('writeDocumentField não deveria ter sido chamado enquanto conflito estiver aberto!');
    };

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-conflict-blocked',
    });

    const batchRes = await orchestrator.executeBatch();

    // 1. Confirma que a operação foi bloqueada sem chamar a planilha externa
    expect(writeChamado).toBe(false);
    expect(batchRes.blockedByConflictCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('BLOCKED_BY_OPEN_CONFLICT');
    expect(batchRes.operations[0].conflictId).toBe(conflictId);

    // 2. Confirma que a operação foi mantida em RETRY_WAIT no D1
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();
    expect(op?.state).toBe('RETRY_WAIT');

    // 3. Agora simula a resolução administrativa do conflito (resolved = 1)
    await env.DB.prepare(`UPDATE sync_conflicts SET resolved = 1 WHERE conflict_id = ?`)
      .bind(conflictId)
      .run();

    // Redefine o adaptador para comportamento normal
    mockAdapter.writeDocumentField = new MockTestAdapter().writeDocumentField;

    // Força next_attempt_at para agora para simular decurso do backoff
    await env.DB.prepare(`UPDATE sync_operations SET next_attempt_at = datetime('now', '-1 minute') WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .run();

    const secondBatch = await orchestrator.executeBatch();
    expect(secondBatch.observedCount).toBe(1);
    expect(secondBatch.operations[0].status).toBe('OBSERVED');
  });

  it('F4-B.13 — Janela Pré-HTTP: Perda de Fencing Aborta Escrita Externa Antes da Requisição de Rede', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    let writeExecutado = false;
    mockAdapter.writeDocumentField = async () => {
      writeExecutado = true;
      return { success: true, status: 'COMMITTED' };
    };

    // Cria orquestrador com hook que usurpa o lease do worker na janela imediata pré-HTTP
    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-zombie',
      beforeWriteHook: async (opId) => {
        // Simula que outro worker tomou a operação e avançou epoch antes da chamada HTTP
        await env.DB.prepare(
          `UPDATE sync_operations
           SET lease_owner = 'worker-usurper',
               lease_epoch = 99,
               lease_until = datetime('now', '+60 seconds')
           WHERE operation_id = ?`
        )
          .bind(opId)
          .run();
      },
    });

    const batchRes = await orchestrator.executeBatch();

    // 1. Confirma categoricamente que a escrita externa NÃO foi executada
    expect(writeExecutado).toBe(false);
    // 2. Confirma que a operação foi rejeitada por fencing antes da requisição HTTP
    expect(batchRes.fencingRejectedCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('FENCING_REJECTED');
  });

  it('F4-B.14 — Erro Estrutural (Layout Inválido ou RA Não Encontrado) Transiciona para UNCERTAIN sem Falso Atestado de Ausência', async () => {
    await resetarAmbiente();
    const { recordId, integrationId } = await setupAlunoComBaseline({
      ra: '000123',
      nome: 'Aluno Face 1',
    });

    await dispararMutacao({ recordId, integrationId, fieldKey: 'identidade' });

    mockAdapter.simulateWriteErrorStatus = 'STUDENT_NOT_FOUND';

    const orchestrator = new SyncV2Orchestrator({
      db: env.DB,
      adapter: mockAdapter,
      workerId: 'worker-structural-quarantine',
    });

    const batchRes = await orchestrator.executeBatch();

    expect(batchRes.structuralErrorCount).toBe(1);
    expect(batchRes.operations[0].status).toBe('STRUCTURAL_ERROR');

    // Confirma categoricamente que o estado no D1 é UNCERTAIN (quarentena segura),
    // e que a operação NÃO foi colocada em RETRY_WAIT com falsa prova de ausência de efeito
    const op = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
      .bind(batchRes.operations[0].operationId)
      .first<{ state: string }>();

    expect(op?.state).toBe('UNCERTAIN');
  });
});
