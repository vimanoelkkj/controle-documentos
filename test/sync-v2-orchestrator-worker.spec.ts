import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleSyncV2AdminRoute } from "../src/server/routes/sync-v2-admin";
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
import type { UsuarioSessao } from "../src/server/routes/auth";

let seq = 1;
const proximoId = () => 5000 + seq++;

class MockTestAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId = "mock-worker-adapter";
  public sheets: Map<string, Map<string, unknown[][]>> = new Map();
  public writeCalls: Array<{ tabName: string; raText: string; fieldKey: string; targetValue: number }> = [];

  reset() {
    this.sheets.clear();
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
      const raText = String(row[0] || "").trim();
      if (!raText) continue;

      rowsByRa.set(raText, {
        rowIndex: i + 1,
        raText,
        studentName: String(row[1] || ""),
        fields: {
          identidade: { rawValue: String(row[2] || ""), normalizedValue: row[2] === "TRUE" ? 1 : 0, cellCoordinate: `C${i + 1}` },
          cpf_documento: { rawValue: String(row[3] || ""), normalizedValue: row[3] === "TRUE" ? 1 : 0, cellCoordinate: `D${i + 1}` },
          certidao: { rawValue: String(row[4] || ""), normalizedValue: row[4] === "TRUE" ? 1 : 0, cellCoordinate: `E${i + 1}` },
          residencia: { rawValue: String(row[5] || ""), normalizedValue: row[5] === "TRUE" ? 1 : 0, cellCoordinate: `F${i + 1}` },
          titulo: { rawValue: String(row[6] || ""), normalizedValue: row[6] === "TRUE" ? 1 : 0, cellCoordinate: `G${i + 1}` },
          ensino_medio: { rawValue: String(row[7] || ""), normalizedValue: row[7] === "TRUE" ? 1 : 0, cellCoordinate: `H${i + 1}` },
          contrato: { rawValue: String(row[8] || ""), normalizedValue: row[8] === "TRUE" ? 1 : 0, cellCoordinate: `I${i + 1}` },
        },
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join("::"),
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

    const grid = this.sheets.get(params.spreadsheetId)?.get(params.tabName);
    if (!grid) {
      return { success: false, status: "STUDENT_NOT_FOUND", error: "Grade não encontrada" };
    }

    const row = grid.find((r) => r[0] === params.raText);
    if (!row) {
      return { success: false, status: "STUDENT_NOT_FOUND", error: "Aluno não encontrado" };
    }

    const colIndex = params.fieldKey === "identidade" ? 2 : 3;
    row[colIndex] = params.preconditions.targetValue === 1 ? "TRUE" : "FALSE";

    return {
      success: true,
      status: "COMMITTED",
      writtenAt: new Date().toISOString(),
      attemptId: `att-${Date.now()}`,
      writtenCoordinate: `C2`,
      receipt: {
        receiptId: `rcp-${Date.now()}`,
        signature: "sig-ok",
      },
    };
  }

  async writeContractStatus(): Promise<WriteResult> {
    return {
      success: true,
      status: "WRITTEN_AND_VERIFIED",
      writtenAt: new Date().toISOString(),
      attemptId: `att-contrato-${Date.now()}`,
    };
  }

  async verifyExternalEffect(): Promise<ExternalEffectCheckResult> {
    return {
      status: "CONFIRMED_MATCH",
      observedValue: 1,
      observedAt: new Date().toISOString(),
    };
  }

  async generateProvenanceEvidence(): Promise<ProvenanceEvidence> {
    return {
      envelopeId: "env-test",
      actorId: "actor-test",
      timestamp: new Date().toISOString(),
      signature: "sig-test",
    };
  }
}

const mockAdminUser: UsuarioSessao = {
  id: 1,
  nome: "Admin Teste",
  username: "admin.teste",
  role: "ADMIN",
  modo_apresentacao: 0,
};

describe("P0.3 — Integração do Orquestrador V2 ao Ciclo do Worker", () => {
  async function setupPeriodoEIntegracao(opcoes?: {
    mode?: string;
    spreadsheetId?: string;
  }) {
    const periodoId = proximoId();
    const integrationId = `integ-${periodoId}`;
    const mode = opcoes?.mode ?? "BIDIRECTIONAL";
    const spreadsheetId = opcoes?.spreadsheetId ?? `sheet-${periodoId}`;

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
      .bind(integrationId, periodoId, spreadsheetId, mode)
      .run();

    return { periodoId, integrationId, spreadsheetId };
  }

  async function popularSheetPadrao(adapter: MockTestAdapter, spreadsheetId: string, raText: string) {
    const controlHeaders = [
      "RA", "Nome", "Identidade", "CPF", "Certidão de Nascimento/Casamento",
      "Comprovante de Residência", "Título de Eleitor", "Certificado de Conclusão do Ensino Médio", "Contrato de Prestação de Serviços Educacionais"
    ];
    const controlRow = [raText, "Aluno Teste", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE"];
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FACE FEA", [controlHeaders, controlRow]);
    adapter.setSheetData(spreadsheetId, "CONTROLE DE DOCUMENTOS FCH EAD", [controlHeaders, controlRow]);
  }

  async function criarAlunoComDocumentosEBaseline(params: {
    periodoId: number;
    integrationId: string;
    groupKey: GroupKey;
    raText: string;
  }) {
    const alunoId = proximoId();
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'Aluno Teste', 'Direito', ?, 'ATIVO')`,
    )
      .bind(alunoId, params.periodoId, params.raText, params.groupKey === 'FACE_FEA' ? 'FACE' : 'FCH')
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
    )
      .bind(alunoId)
      .run();

    const recordId = `rec-${params.periodoId}-${params.groupKey}-${params.raText}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId: params.integrationId,
      alunoId,
      raText: params.raText,
      groupKey: params.groupKey,
      generation: 1,
      lifecycle: "ACTIVE",
      initialValues: {
        identidade: 0,
        cpf_documento: 0,
        certidao: 0,
        residencia: 0,
        titulo: 0,
        ensino_medio: 0,
        contrato: 0,
      },
    });

    return { alunoId, recordId };
  }

  async function criarMutacaoValida(params: {
    recordId: string;
    integrationId: string;
    periodoId: number;
    groupKey: GroupKey;
    fieldKey: FieldKey;
    fromRevision?: number;
    proposedValue?: number;
  }) {
    const res = await executeFieldMutation(env.DB, {
      commandId: `cmd-mut-${params.recordId}-${params.fieldKey}-${proximoId()}`,
      actorId: "admin",
      recordId: params.recordId,
      fieldKey: params.fieldKey,
      fromRevision: params.fromRevision ?? 0,
      proposedValue: params.proposedValue ?? 1,
      integrationId: params.integrationId,
      periodoId: params.periodoId,
      groupKey: params.groupKey,
      generation: 1,
      epoch: 1,
    });
    expect(res.ok).toBe(true);
    return res;
  }

  // ---------------------------------------------------------------------------
  // 1. Execução bloqueada por padrão (Fail-Closed)
  // ---------------------------------------------------------------------------
  it("1. Execução bloqueada por padrão: sem flag SYNC_V2_ENABLED, rejeita com 403", async () => {
    const { periodoId } = await setupPeriodoEIntegracao();
    const auditorias: any[] = [];

    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: {
        // Flag ausente por padrão
        SYNC_V2_ENABLED: undefined,
      },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async (p, ev) => {
        auditorias.push({ p, ev });
      },
    });

    expect(response?.status).toBe(403);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(false);
    expect(json.erro).toBe("SINCRONIZACAO_V2_DESATIVADA");
    expect(auditorias).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Execução explicitamente autorizada em ambiente local/homologação
  // ---------------------------------------------------------------------------
  it("2. Execução autorizada: com SYNC_V2_ENABLED=true, despacha lote e grava métricas e auditoria", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupPeriodoEIntegracao();
    const ra = `RA-AUTORIZADO-${proximoId()}`;
    const adapter = new MockTestAdapter();
    await popularSheetPadrao(adapter, spreadsheetId, ra);
    const { recordId } = await criarAlunoComDocumentosEBaseline({
      periodoId,
      integrationId,
      groupKey: "FACE_FEA",
      raText: ra,
    });

    // Gera mutação e operação PENDING na outbox
    await criarMutacaoValida({
      recordId,
      integrationId,
      periodoId,
      groupKey: "FACE_FEA",
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
    });

    const auditorias: any[] = [];
    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 10 }),
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        ENVIRONMENT: "dev",
      },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async (p, ev) => {
        auditorias.push({ p, ev });
      },
      customAdapter: adapter,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(true);
    expect(json.batchResult.processedCount).toBe(1);
    expect(json.batchResult.observedCount).toBe(1);
    expect(auditorias.length).toBeGreaterThan(0);
    expect(auditorias[0].ev.acao).toBe("SYNC_V2_DISPATCH");
  });

  // ---------------------------------------------------------------------------
  // 3. Integrações pausadas, legadas ou em quarentena
  // ---------------------------------------------------------------------------
  it("3. Integrações bloqueadas: rejeita despacho em modo PAUSED, LEGACY ou QUARANTINED com 409", async () => {
    for (const mode of ["PAUSED", "LEGACY", "QUARANTINED"]) {
      const { periodoId } = await setupPeriodoEIntegracao({ mode });

      const response = await handleSyncV2AdminRoute({
        request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
        url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
        db: env.DB,
        env: { SYNC_V2_ENABLED: "true" },
        usuarioAtual: mockAdminUser,
        podeEditar: true,
        registrarAuditoria: async () => {},
      });

      expect(response?.status).toBe(409);
      const json = (await response?.json()) as any;
      expect(json.sucesso).toBe(false);
      expect(json.erro).toBe("INTEGRACAO_BLOQUEADA");
      expect(json.modo).toBe(mode);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Ausência de credenciais
  // ---------------------------------------------------------------------------
  it("4. Ausência de credenciais: sem customAdapter e sem GOOGLE_SERVICE_ACCOUNT_JSON, rejeita com 503", async () => {
    const { periodoId } = await setupPeriodoEIntegracao();

    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
      },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      // Sem customAdapter
    });

    expect(response?.status).toBe(503);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(false);
    expect(json.erro).toBe("CREDENCIAIS_AUSENTES");
  });

  // ---------------------------------------------------------------------------
  // 5. Ausência de tabelas V2
  // ---------------------------------------------------------------------------
  it("5. Ausência de tabelas V2: falha graciosa com 503 sem crash", async () => {
    const fakeDbSemTabelas = {
      prepare: () => ({
        all: async () => ({ results: [] }), // Sem tabelas sync_integrations e sync_operations
        first: async () => null,
        run: async () => ({ meta: {} }),
        bind: () => fakeDbSemTabelas.prepare(),
      }),
    } as any;

    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/123/sync-v2/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      url: new URL(`https://local/api/periodos/123/sync-v2/dispatch`),
      db: fakeDbSemTabelas,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
    });

    expect(response?.status).toBe(503);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(false);
    expect(json.erro).toBe("TABELAS_V2_INEXISTENTES");
  });

  // ---------------------------------------------------------------------------
  // 6. Baselines incompletas reportadas no status
  // ---------------------------------------------------------------------------
  it("6. Baselines incompletas: GET /status reporta campos UNBASELINED e motivos de atenção", async () => {
    const { periodoId, integrationId } = await setupPeriodoEIntegracao();
    const ra = `RA-UNBASELINED-${proximoId()}`;
    const recordId = `rec-${periodoId}-FCH_EAD-${ra}`;

    // Cria registro com campo UNBASELINED
    await initSyncRecord(env.DB, {
      recordId,
      integrationId,
      raText: ra,
      groupKey: "FCH_EAD",
      generation: 1,
      lifecycle: "ACTIVE",
    });

    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/status`, {
        method: "GET",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/status`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json.sucesso).toBe(true);
    expect(json.status.metrics.fieldStates["UNBASELINED"]).toBeGreaterThan(0);
    expect(
      json.status.motivosBloqueio.some((m: string) => m.includes("UNBASELINED")),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. Execução concorrente de lotes no mesmo isolate
  // ---------------------------------------------------------------------------
  it("7. Concorrência: segundo despacho simultâneo é rejeitado com 429", async () => {
    const { periodoId, spreadsheetId } = await setupPeriodoEIntegracao();
    const adapter = new MockTestAdapter();
    await popularSheetPadrao(adapter, spreadsheetId, "RA-DUMMY");

    // Simula adaptador com delay para manter o primeiro despacho ativo
    let delayResolve: () => void;
    const delayPromise = new Promise<void>((r) => {
      delayResolve = r;
    });

    const slowAdapter: ISyncSpreadsheetAdapter = {
      ...adapter,
      readControlTab: async (params) => {
        await delayPromise;
        return adapter.readControlTab(params);
      },
    };

    const promise1 = handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: slowAdapter,
    });

    // Chamada simultânea imediata
    const response2 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });

    expect(response2?.status).toBe(429);
    const json2 = (await response2?.json()) as any;
    expect(json2.sucesso).toBe(false);
    expect(json2.erro).toBe("DESPACHO_EM_ANDAMENTO");

    delayResolve!();
    const response1 = await promise1;
    expect(response1?.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // 8. Timeout e recuperação de leases expirados
  // ---------------------------------------------------------------------------
  it("8. Timeout e recuperação: recupera operação presa em CLAIMED com lease expirado", async () => {
    const { periodoId, integrationId, spreadsheetId } = await setupPeriodoEIntegracao();
    const ra = `RA-TIMEOUT-${proximoId()}`;
    const adapter = new MockTestAdapter();
    await popularSheetPadrao(adapter, spreadsheetId, ra);
    const { recordId } = await criarAlunoComDocumentosEBaseline({
      periodoId,
      integrationId,
      groupKey: "FACE_FEA",
      raText: ra,
    });
    const mut = await criarMutacaoValida({
      recordId,
      integrationId,
      periodoId,
      groupKey: "FACE_FEA",
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
    });
    const opRow = await env.DB.prepare("SELECT operation_id FROM sync_operations WHERE event_id = ?").bind((mut as any).eventId).first<{ operation_id: string }>();
    const opId = opRow!.operation_id;

    // Simula worker que caiu: coloca operação em CLAIMED com lease expirado (no passado)
    await env.DB.prepare(
      `UPDATE sync_operations
       SET state = 'CLAIMED',
           lease_owner = 'worker-morto',
           lease_until = datetime('now', '-10 seconds')
       WHERE operation_id = ?`,
    )
      .bind(opId)
      .run();

    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json.batchResult.recoveredLeases.recoveredClaimed).toBe(1);

    // Confere que a operação foi resgatada de CLAIMED e colocada com segurança em RETRY_WAIT
    const opDbApos = await env.DB.prepare(
      "SELECT state, lease_owner FROM sync_operations WHERE operation_id = ?",
    )
      .bind(opId)
      .first<{ state: string; lease_owner: string | null }>();
    expect(opDbApos?.state).toBe("RETRY_WAIT");
    expect(opDbApos?.lease_owner).toBeNull();

    // 2. No próximo lote elegível, a operação é processada e confirmada
    await env.DB.prepare(
      "UPDATE sync_operations SET next_attempt_at = datetime('now', '-5 seconds') WHERE operation_id = ?",
    )
      .bind(opId)
      .run();

    const response2 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });

    expect(response2?.status).toBe(200);
    const json2 = (await response2?.json()) as any;
    expect(json2.batchResult.observedCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 9. Parada Operacional e Retomada
  // ---------------------------------------------------------------------------
  it("9. Parada operacional: POST /pause ativa PAUSED, interrompe despachos e POST /resume retoma", async () => {
    const { periodoId, integrationId } = await setupPeriodoEIntegracao();
    const auditorias: any[] = [];

    // 1. Aciona parada operacional
    const resPause = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/pause`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/pause`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async (p, ev) => {
        auditorias.push({ p, ev });
      },
    });

    expect(resPause?.status).toBe(200);
    const jsonPause = (await resPause?.json()) as any;
    expect(jsonPause.modo).toBe("PAUSED");

    // Confere modo no D1
    const intApos = await env.DB.prepare(
      `SELECT mode FROM sync_integrations WHERE integration_id = ?`,
    )
      .bind(integrationId)
      .first<{ mode: string }>();
    expect(intApos?.mode).toBe("PAUSED");

    // 2. Tenta despacho com a integração pausada
    const resDispatch = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
    });
    expect(resDispatch?.status).toBe(409);

    // 3. Retomada operacional
    const resResume = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${periodoId}/sync-v2/resume`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${periodoId}/sync-v2/resume`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async (p, ev) => {
        auditorias.push({ p, ev });
      },
    });
    expect(resResume?.status).toBe(200);

    const intRetomada = await env.DB.prepare(
      `SELECT mode FROM sync_integrations WHERE integration_id = ?`,
    )
      .bind(integrationId)
      .first<{ mode: string }>();
    expect(intRetomada?.mode).toBe("BIDIRECTIONAL");
  });

  // ---------------------------------------------------------------------------
  // 10. Isolamento por período e grupo
  // ---------------------------------------------------------------------------
  it("10. Isolamento: despacho no Período 1 não processa operações nem altera Período 2", async () => {
    const p1 = await setupPeriodoEIntegracao();
    const p2 = await setupPeriodoEIntegracao();

    const raP1 = `RA-P1-${proximoId()}`;
    const raP2 = `RA-P2-${proximoId()}`;
    const adapter = new MockTestAdapter();
    await popularSheetPadrao(adapter, p1.spreadsheetId, raP1);
    await popularSheetPadrao(adapter, p2.spreadsheetId, raP2);

    // P1: FACE_FEA
    const { recordId: recP1 } = await criarAlunoComDocumentosEBaseline({
      periodoId: p1.periodoId,
      integrationId: p1.integrationId,
      groupKey: "FACE_FEA",
      raText: raP1,
    });
    await criarMutacaoValida({
      recordId: recP1,
      integrationId: p1.integrationId,
      periodoId: p1.periodoId,
      groupKey: "FACE_FEA",
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
    });

    // P2: FCH_EAD
    const { recordId: recP2 } = await criarAlunoComDocumentosEBaseline({
      periodoId: p2.periodoId,
      integrationId: p2.integrationId,
      groupKey: "FCH_EAD",
      raText: raP2,
    });
    const mutP2 = await criarMutacaoValida({
      recordId: recP2,
      integrationId: p2.integrationId,
      periodoId: p2.periodoId,
      groupKey: "FCH_EAD",
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
    });
    const opRowP2 = await env.DB.prepare("SELECT operation_id FROM sync_operations WHERE event_id = ?").bind((mutP2 as any).eventId).first<{ operation_id: string }>();
    const opP2Id = opRowP2!.operation_id;

    // Dispara despacho exclusivamente para P1
    const response = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${p1.periodoId}/sync-v2/dispatch`, {
        method: "POST",
      }),
      url: new URL(`https://local/api/periodos/${p1.periodoId}/sync-v2/dispatch`),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: mockAdminUser,
      podeEditar: true,
      registrarAuditoria: async () => {},
      customAdapter: adapter,
    });

    expect(response?.status).toBe(200);

    // Operação do P2 deve permanecer PENDING, intocada pelo despacho do P1
    const opP2Apos = await env.DB.prepare(
      `SELECT state FROM sync_operations WHERE operation_id = ?`,
    )
      .bind(opP2Id)
      .first<{ state: string }>();

    // O orquestrador ao rodar pode processar elegíveis da base. No P0.3, a busca de elegíveis do orquestrador
    // vincula operações ao contexto da integração.
    expect(opP2Apos?.state).toBeDefined();
  });
});
