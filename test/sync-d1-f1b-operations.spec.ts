import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  executeFieldMutation,
  initSyncRecord,
  establishFieldBaseline,
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";
import {
  claimOperation,
  dispatchOperation,
  observeOperation,
  markUncertainOperation,
  verifyOperation,
  markRetryWaitOperation,
  renewLease,
  recoverExpiredLeases,
  FakeExternalAdapter,
  toSqliteDatetime,
  type OperationRecord,
} from "../src/server/services/sync-d1-operations";

describe("F1-B: Protocolo de Operações, Claims Versionados, Leases e Recibos", () => {
  const periodoFicticioId = 8888;
  const integrationFaceId = "int-f1b-face-001";
  const integrationFchId = "int-f1b-fch-001";

  beforeAll(async () => {
    // 1. Setup de período e integrações fictícias isoladas
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status)
       VALUES (?, '2026-2-FICTICIO-F1B', 'ATIVO')`
    )
      .bind(periodoFicticioId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-ficticia-f1b-face', 1, 1, 'SHADOW')`
    )
      .bind(integrationFaceId, periodoFicticioId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-ficticia-f1b-fch', 1, 1, 'SHADOW')`
    )
      .bind(integrationFchId, periodoFicticioId)
      .run();
  });

  async function criarAlunoFicticio(ra: string, nome: string, unidade: string) {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO TESTE F1B', ?, 'ATIVO')`
    )
      .bind(periodoFicticioId, ra, nome, unidade)
      .run();

    const alunoId = Number(res.meta.last_row_id);

    await env.DB.prepare(
      `INSERT INTO documentos (
        aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`
    )
      .bind(alunoId)
      .run();

    return alunoId;
  }

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

  async function setupAlunoComBaseline(params: {
    ra: string;
    nome: string;
    unidade: string;
    groupKey: GroupKey;
    integrationId: string;
  }) {
    const alunoId = await criarAlunoFicticio(params.ra, params.nome, params.unidade);
    const recordId = `rec-${params.groupKey}-${params.ra}-${crypto.randomUUID().slice(0, 8)}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId: params.integrationId,
      groupKey: params.groupKey,
      raText: params.ra,
      alunoId,
    });

    const evidence = await createEvidence(
      "LEGACY_MIGRATION",
      JSON.stringify({ alunoId, field: "identidade", source: "SISTEMA_LEGADO", ts: "2026-10-19T00:00:00Z" })
    );

    // Estabelece baseline para o campo 'identidade' com valor inicial 0
    const bRes = await establishFieldBaseline(env.DB, {
      recordId,
      fieldKey: "identidade",
      baselineValue: 0,
      commandId: `cmd-base-${recordId}-identidade`,
      actorId: "actor-setup",
      integrationId: params.integrationId,
      periodoId: periodoFicticioId,
      groupKey: params.groupKey,
      generation: 1,
      expectedEpoch: 1,
      evidence,
    });
    expect(bRes.ok).toBe(true);

    return { alunoId, recordId };
  }

  // ==========================================================================
  // G1 & P10: Claim Exclusivo e Atômico sob Concorrência
  // ==========================================================================
  describe("G1 & P10 — Claim exclusivo e atômico", () => {
    it("deve permitir que apenas um worker ganhe o claim concorrente da mesma operação (G1)", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G1-001",
        nome: "Aluno G1 Concorrencia",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      // Executa mutação F1-A para gerar uma operação PENDING
      const mutRes = await executeFieldMutation(env.DB, {
        commandId: `cmd-mut-g1-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });
      expect(mutRes.ok).toBe(true);
      expect((mutRes as any).status).toBe("COMMITTED");

      // Consulta a operação gerada para CONTROLE
      const op = await env.DB.prepare(
        `SELECT operation_id, state, lease_epoch FROM sync_operations
         WHERE record_id = ? AND field_key = 'identidade' AND target_key = 'CONTROLE'`
      )
        .bind(recordId)
        .first<OperationRecord>();
      expect(op).toBeDefined();
      expect(op!.state).toBe("PENDING");
      expect(op!.lease_epoch).toBe(0);

      // Disputa concorrente entre Worker A e Worker B via Promise.all
      const [claimA, claimB] = await Promise.all([
        claimOperation(env.DB, {
          operationId: op!.operation_id,
          workerId: "worker-A",
          leaseDurationSeconds: 60,
        }),
        claimOperation(env.DB, {
          operationId: op!.operation_id,
          workerId: "worker-B",
          leaseDurationSeconds: 60,
        }),
      ]);

      // Exatamente um teve sucesso e o outro recebeu ALREADY_CLAIMED
      const successes = [claimA, claimB].filter((r) => r.ok);
      const failures = [claimA, claimB].filter((r) => !r.ok);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const winner = successes[0] as any;
      const loser = failures[0] as any;

      expect(winner.leaseEpoch).toBe(1);
      expect(winner.operation.state).toBe("CLAIMED");
      expect(loser.code).toBe("ALREADY_CLAIMED");

      // Verificação no banco: estado CLAIMED com o vencedor registrado
      const opDb = await env.DB.prepare(
        `SELECT state, lease_owner, lease_epoch FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string; lease_owner: string; lease_epoch: number }>();

      expect(opDb!.state).toBe("CLAIMED");
      expect(opDb!.lease_epoch).toBe(1);
      expect(["worker-A", "worker-B"]).toContain(opDb!.lease_owner);
    });

    it("rejeita claim se a operação não estiver elegível ou já expirada para retry futuro", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G1-002",
        nome: "Aluno Inelegivel",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      const mutRes = await executeFieldMutation(env.DB, {
        commandId: `cmd-mut-inelegivel-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });
      expect(mutRes.ok).toBe(true);

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      // Worker 1 reivindica
      const claim1 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseDurationSeconds: 120,
      });
      expect(claim1.ok).toBe(true);

      // Worker 2 tenta reivindicar com lease ainda válido
      const claim2 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
      });
      expect(claim2.ok).toBe(false);
      expect((claim2 as any).code).toBe("ALREADY_CLAIMED");
    });
  });

  // ==========================================================================
  // G2: Fencing por lease_epoch e Renovação de Lease
  // ==========================================================================
  describe("G2 — Fencing por lease_epoch e renovação", () => {
    it("permite renovação de lease pelo dono legítimo com epoch idêntico", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G2-001",
        nome: "Aluno Fencing Renew",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-mut-g2-1-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      const claim = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-heartbeat",
        leaseDurationSeconds: 30,
      });
      expect(claim.ok).toBe(true);
      const claimRes = claim as any;

      // Renovação legítima
      const renewRes = await renewLease(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-heartbeat",
        leaseEpoch: claimRes.leaseEpoch,
        extensionSeconds: 60,
      });
      expect(renewRes.ok).toBe(true);

      // Tentativa de renovação por outro worker ou com epoch defasada
      const renewInvalidWorker = await renewLease(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-intruso",
        leaseEpoch: claimRes.leaseEpoch,
        extensionSeconds: 60,
      });
      expect(renewInvalidWorker.ok).toBe(false);
      expect((renewInvalidWorker as any).code).toBe("FENCING_CONFLICT");

      const renewInvalidEpoch = await renewLease(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-heartbeat",
        leaseEpoch: claimRes.leaseEpoch + 99,
        extensionSeconds: 60,
      });
      expect(renewInvalidEpoch.ok).toBe(false);
      expect((renewInvalidEpoch as any).code).toBe("FENCING_CONFLICT");
    });
  });

  // ==========================================================================
  // G3 & P8: Rejeição de Respostas Tardias e Revisão Divergente
  // ==========================================================================
  describe("G3 & P8 — Rejeição de respostas tardias e revisão divergente", () => {
    it("P8: Operação com revisão defasada não pode confirmar revisão mais nova (revisão exata)", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-P8-001",
        nome: "Aluno P8 Stale Rev",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      // 1. Primeira mutação: transita 0 -> 1 (target_revision = 1)
      const mut1 = await executeFieldMutation(env.DB, {
        commandId: `cmd-p8-mut1-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });
      expect(mut1.ok).toBe(true);

      const op1 = await env.DB.prepare(
        `SELECT operation_id, target_revision FROM sync_operations
         WHERE record_id = ? AND field_key = 'identidade' AND target_key = 'CONTROLE'`
      )
        .bind(recordId)
        .first<OperationRecord>();
      expect(op1!.target_revision).toBe(1);

      // Worker reivindica a op1
      const claim1 = await claimOperation(env.DB, {
        operationId: op1!.operation_id,
        workerId: "worker-p8",
      });
      expect(claim1.ok).toBe(true);

      // Dispatch de op1
      const disp1 = await dispatchOperation(env.DB, {
        operationId: op1!.operation_id,
        workerId: "worker-p8",
        leaseEpoch: (claim1 as any).leaseEpoch,
        payloadText: JSON.stringify({ action: "UPDATE", rev: 1 }),
      });
      expect(disp1.ok).toBe(true);

      // 2. Agora, o campo sofre uma segunda mutação F1-A: 1 -> 0 (target_revision = 2)
      // (Isso gera uma nova operação no outbox com target_revision = 2)
      const mut2 = await executeFieldMutation(env.DB, {
        commandId: `cmd-p8-mut2-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 1,
        proposedValue: 0,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });
      expect(mut2.ok).toBe(true);

      // 3. Worker da op1 tenta chamar observeOperation passando targetRevision = 2 (tentando confirmar a rev 2 com a op 1)
      const obsMismatch = await observeOperation(env.DB, {
        operationId: op1!.operation_id,
        workerId: "worker-p8",
        leaseEpoch: (claim1 as any).leaseEpoch,
        targetRevision: 2, // Incompatível com op1.target_revision (que é 1)
        attemptId: (disp1 as any).attemptId,
      });

      expect(obsMismatch.ok).toBe(false);
      expect((obsMismatch as any).code).toBe("REVISION_MISMATCH");

      // 4. Mas se passar a targetRevision correta (1), ela é confirmada para a op1
      const obsCorrect = await observeOperation(env.DB, {
        operationId: op1!.operation_id,
        workerId: "worker-p8",
        leaseEpoch: (claim1 as any).leaseEpoch,
        targetRevision: 1,
        attemptId: (disp1 as any).attemptId,
      });
      expect(obsCorrect.ok).toBe(true);
      expect((obsCorrect as any).receiptId).toBeDefined();

      // Verifica que o estado de op1 foi para OBSERVED
      const op1Final = await env.DB.prepare(
        `SELECT state FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op1!.operation_id)
        .first<{ state: string }>();
      expect(op1Final!.state).toBe("OBSERVED");
    });
  });

  // ==========================================================================
  // G3 & P9: Lease Expirado + Callback Tardio Rejeitado por Fencing
  // ==========================================================================
  describe("G3 & P9 — Expiração de lease e rejeição de callback tardio", () => {
    it("P9: Worker antigo com lease expirado não consegue confirmar operação reivindicada por novo worker", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-P9-001",
        nome: "Aluno P9 Expired Lease",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-p9-mut-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      const t0 = new Date();
      const tDisp = new Date(t0.getTime() + 1000);
      const tExpired = new Date(t0.getTime() + 10000);
      const tVerify = new Date(t0.getTime() + 11000);
      const tLate = new Date(t0.getTime() + 15000);
      const tFinish = new Date(t0.getTime() + 16000);

      // 1. Worker 1 reivindica op com leaseDurationSeconds = 1
      const claim1 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseDurationSeconds: 1,
        now: t0,
      });
      expect(claim1.ok).toBe(true);
      const epoch1 = (claim1 as any).leaseEpoch;
      expect(epoch1).toBe(1);

      // Worker 1 faz dispatch
      const disp1 = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseEpoch: epoch1,
        payloadText: "dispatch payload 1",
        now: tDisp,
      });
      expect(disp1.ok).toBe(true);

      // 2. Tempo avança (lease já expirou).
      // Executa recoverExpiredLeases: como estava em DISPATCHED, vai para UNCERTAIN (G4)!
      const rec = await recoverExpiredLeases(env.DB, tExpired);
      expect(rec.recoveredDispatchedToUncertain).toBeGreaterThanOrEqual(1);

      const opUncertain = await env.DB.prepare(
        `SELECT state FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string }>();
      expect(opUncertain!.state).toBe("UNCERTAIN");

      // 3. Worker 2 assume a verificação (verifyOperation) com incremento de lease
      const ver2 = await verifyOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
        leaseEpoch: epoch1, // Worker 2 adota com fencing incrementado
        leaseExtensionSeconds: 60,
        now: tVerify,
      });
      expect(ver2.ok).toBe(true);

      const opDbAfterVerify = await env.DB.prepare(
        `SELECT state, lease_owner, lease_epoch FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string; lease_owner: string; lease_epoch: number }>();
      expect(opDbAfterVerify!.state).toBe("VERIFYING");
      expect(opDbAfterVerify!.lease_owner).toBe("worker-2");
      expect(opDbAfterVerify!.lease_epoch).toBe(epoch1 + 1); // 2

      // 4. Worker 1 tardio tenta agora commitar com seu leaseEpoch antigo (1)
      const lateObserveWorker1 = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseEpoch: epoch1, // 1 (defasado!)
        targetRevision: 1,
        attemptId: (disp1 as any).attemptId,
        now: tLate,
      });

      expect(lateObserveWorker1.ok).toBe(false);
      expect((lateObserveWorker1 as any).code).toBe("FENCING_CONFLICT");

      // 5. NENHUM recibo foi gravado pelo Worker 1
      const receiptWorker1 = await env.DB.prepare(
        `SELECT * FROM sync_receipts WHERE attempt_id = ?`
      )
        .bind((disp1 as any).attemptId)
        .first();
      expect(receiptWorker1).toBeNull();

      // 6. Worker 2 conclui a observação no epoch 2 com sucesso
      const observeWorker2 = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
        leaseEpoch: opDbAfterVerify!.lease_epoch, // 2
        targetRevision: 1,
        attemptId: (ver2 as any).attemptId,
        now: tFinish,
      });
      expect(observeWorker2.ok).toBe(true);

      const opFinal = await env.DB.prepare(
        `SELECT state FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string }>();
      expect(opFinal!.state).toBe("OBSERVED");
    });
  });

  // ==========================================================================
  // G4: Timeout Incerto e Reconciliação sem Dispatch Cego
  // ==========================================================================
  describe("G4 — Timeout incerto e ciclo de reconciliação", () => {
    it("G4: Falha com timeout externo transita para UNCERTAIN e impede re-despacho cego", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G4-001",
        nome: "Aluno G4 Timeout",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-g4-mut-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      // Worker dá claim
      const claim = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-timeout",
      });
      expect(claim.ok).toBe(true);
      const claimInfo = claim as any;

      // Worker despacha
      const disp = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-timeout",
        leaseEpoch: claimInfo.leaseEpoch,
        payloadText: "payload dispatch G4",
      });
      expect(disp.ok).toBe(true);
      const attemptId = (disp as any).attemptId;

      // Simulação de chamada externa com timeout (FakeExternalAdapter)
      const adapter = new FakeExternalAdapter({ simulateTimeout: true });
      let timedOut = false;
      try {
        await adapter.apply({
          targetKey: "CONTROLE",
          recordId,
          fieldKey: "identidade",
          targetRevision: 1,
          value: 1,
        });
      } catch (err: any) {
        expect(err.message).toContain("ETIMEDOUT");
        timedOut = true;
      }
      expect(timedOut).toBe(true);

      // Como o adapter sofreu timeout, o efeito PODE ter sido aplicado no destino.
      // O worker registra markUncertainOperation
      const uncRes = await markUncertainOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-timeout",
        leaseEpoch: claimInfo.leaseEpoch,
        attemptId,
        errorMessage: "ETIMEDOUT: Target did not reply in time",
      });
      expect(uncRes.ok).toBe(true);

      // Verifica estado no banco: UNCERTAIN
      const opUncertain = await env.DB.prepare(
        `SELECT state, next_attempt_at FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string; next_attempt_at: string }>();
      expect(opUncertain!.state).toBe("UNCERTAIN");

      // INVARIANTE G4: NENHUM worker pode reivindicar diretamente essa operação para dispatch cego!
      const blindClaim = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-cego",
      });
      expect(blindClaim.ok).toBe(false);
      expect((blindClaim as any).code).toBe("NOT_ELIGIBLE");

      // 4. Ciclo de reconciliação seguro: Worker de verificação entra em ação
      const verRes = await verifyOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-verifier",
        leaseEpoch: claimInfo.leaseEpoch,
      });
      expect(verRes.ok).toBe(true);

      // Consulta o adapter para descobrir se a revisão foi observada
      const observedRev = await adapter.queryObservedRevision("CONTROLE", recordId, "identidade");
      expect(observedRev).toBe(1); // Sim! O efeito realmente ocorreu no destino!

      // Portanto, confirma a operação via observeOperation sem re-despacho cego
      const obsRes = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-verifier",
        leaseEpoch: (verRes as any).leaseEpoch,
        targetRevision: 1,
        attemptId: (verRes as any).attemptId,
      });
      expect(obsRes.ok).toBe(true);

      const opFinal = await env.DB.prepare(
        `SELECT state FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string }>();
      expect(opFinal!.state).toBe("OBSERVED");
    });

    it("G4: Reconciliação confirma ausência de efeito e agenda retry seguro com backoff", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G4-002",
        nome: "Aluno G4 RetryWait",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-g4-drop-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      const claim = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-drop",
      });
      const claimInfo = claim as any;

      const disp = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-drop",
        leaseEpoch: claimInfo.leaseEpoch,
        payloadText: "payload drop",
      });
      const attemptId = (disp as any).attemptId;

      // Simula queda de conexão antes de processar no destino (simulateDrop)
      const adapter = new FakeExternalAdapter({ simulateDrop: true });
      try {
        await adapter.apply({
          targetKey: "CONTROLE",
          recordId,
          fieldKey: "identidade",
          targetRevision: 1,
          value: 1,
        });
      } catch (err: any) {
        expect(err.message).toContain("ECONNRESET");
      }

      await markUncertainOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-drop",
        leaseEpoch: claimInfo.leaseEpoch,
        attemptId,
        errorMessage: "ECONNRESET",
      });

      // Verificação entra
      const verRes = await verifyOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-recon",
        leaseEpoch: claimInfo.leaseEpoch,
      });
      expect(verRes.ok).toBe(true);

      // Consulta se o efeito ocorreu
      const rev = await adapter.queryObservedRevision("CONTROLE", recordId, "identidade");
      expect(rev).toBeNull(); // Não ocorreu!

      // Como não ocorreu, move com segurança para RETRY_WAIT com backoff
      const retryRes = await markRetryWaitOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-recon",
        leaseEpoch: (verRes as any).leaseEpoch,
        confirmEffectAbsent: true,
        backoffSeconds: 45,
      });
      expect(retryRes.ok).toBe(true);

      const opRetry = await env.DB.prepare(
        `SELECT state, lease_owner, lease_until FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string; lease_owner: string | null; lease_until: string | null }>();

      expect(opRetry!.state).toBe("RETRY_WAIT");
      expect(opRetry!.lease_owner).toBeNull(); // Liberado para nova tentativa quando expirar backoff
      expect(opRetry!.lease_until).toBeNull();
    });
  });

  // ==========================================================================
  // G5 & G7: Imutabilidade do Payload e Histórico em sync_attempts
  // ==========================================================================
  describe("G5 & G7 — Imutabilidade e rastreabilidade de tentativas", () => {
    it("G5 & G7: Preserva histórico append-only em sync_attempts e imutabilidade dos dados originais", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-G5-001",
        nome: "Aluno Imutabilidade",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-g5-mut-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      // Tentativa 1: Claim e Dispatch com falha
      const claim1 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-1",
      });
      const disp1 = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-1",
        leaseEpoch: (claim1 as any).leaseEpoch,
        payloadText: "Tentativa 1 Payload",
      });

      await markUncertainOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-1",
        leaseEpoch: (claim1 as any).leaseEpoch,
        attemptId: (disp1 as any).attemptId,
        errorMessage: "Network drop try 1",
      });

      // Tentativa 2: Reconciliação e Retry Wait
      const ver2 = await verifyOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-2",
        leaseEpoch: (claim1 as any).leaseEpoch,
      });
      expect(ver2.ok).toBe(true);

      const retry2 = await markRetryWaitOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-2",
        leaseEpoch: (ver2 as any).leaseEpoch,
        confirmEffectAbsent: true,
        backoffSeconds: 0, // Imediato para testar o re-claim
      });
      expect(retry2.ok).toBe(true);

      // Tentativa 3: Novo Claim, Dispatch e Sucesso
      const claim3 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-3",
      });
      expect(claim3.ok).toBe(true);
      const claim3Info = claim3 as any;
      expect(claim3Info.leaseEpoch).toBe((claim1 as any).leaseEpoch + 2);

      const disp3 = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-3",
        leaseEpoch: claim3Info.leaseEpoch,
        payloadText: "Tentativa 3 Payload Final",
      });
      expect(disp3.ok).toBe(true);

      const obs3 = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-try-3",
        leaseEpoch: claim3Info.leaseEpoch,
        targetRevision: 1,
        attemptId: (disp3 as any).attemptId,
        responsePayload: JSON.stringify({ external_ack: true }),
      });
      expect(obs3.ok).toBe(true);

      // Verificação em sync_attempts: exatamente 3 tentativas registradas (disp1, ver2, disp3)
      const attempts = await env.DB.prepare(
        `SELECT * FROM sync_attempts WHERE operation_id = ? ORDER BY started_at ASC`
      )
        .bind(op!.operation_id)
        .all();

      expect(attempts.results).toHaveLength(3);

      const att1 = attempts.results[0] as any;
      expect(att1.attempt_id).toBe((disp1 as any).attemptId);
      expect(att1.lease_owner).toBe("worker-try-1");
      expect(att1.state).toBe("UNCERTAIN");
      expect(att1.error_message).toBe("Network drop try 1");

      const attVer = attempts.results[1] as any;
      expect(attVer.attempt_id).toBe((ver2 as any).attemptId);
      expect(attVer.lease_owner).toBe("worker-try-2");
      expect(attVer.state).toBe("FAILED"); // atualizada para FAILED pelo markRetryWaitOperation

      const att2 = attempts.results[2] as any;
      expect(att2.attempt_id).toBe((disp3 as any).attemptId);
      expect(att2.lease_owner).toBe("worker-try-3");
      expect(att2.state).toBe("OBSERVED");
      expect(att2.response_payload).toContain("external_ack");

      // Verificação em sync_receipts: recibo gerado vinculado à tentativa 2 e ao comando original
      const receipt = await env.DB.prepare(
        `SELECT * FROM sync_receipts WHERE receipt_id = ?`
      )
        .bind((obs3 as any).receiptId)
        .first<any>();

      expect(receipt).toBeDefined();
      expect(receipt.operation_id).toBe(op!.operation_id);
      expect(receipt.attempt_id).toBe((disp3 as any).attemptId);
      expect(receipt.target_key).toBe("CONTROLE");
    });
  });

  // ==========================================================================
  // A15: Corrida Adversarial de Claims e Fencing
  // ==========================================================================
  describe("A15 — Corrida adversarial de claims (2 competidores + fencing)", () => {
    it("A15: Intercala Worker 1 e Worker 2 com expiração de lease e bloqueio de callback tardio", async () => {
      const { recordId } = await setupAlunoComBaseline({
        ra: "RA-F1B-A15-001",
        nome: "Aluno A15 Adversarial",
        unidade: "FACULDADE FEA",
        groupKey: "FACE_FEA",
        integrationId: integrationFaceId,
      });

      await executeFieldMutation(env.DB, {
        commandId: `cmd-a15-${recordId}`,
        actorId: "operator-f1b",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });

      const op = await env.DB.prepare(
        `SELECT operation_id FROM sync_operations WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ operation_id: string }>();

      const t0 = new Date();
      const tEarly = new Date(t0.getTime() + 500);
      const tDisp = new Date(t0.getTime() + 1000);
      const tExpired = new Date(t0.getTime() + 10000);
      const tVerify = new Date(t0.getTime() + 11000);
      const tLate = new Date(t0.getTime() + 15000);
      const tFinish = new Date(t0.getTime() + 16000);

      // 1. Worker 1 reivindica
      const c1 = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseDurationSeconds: 2,
        now: t0,
      });
      expect(c1.ok).toBe(true);
      const epochW1 = (c1 as any).leaseEpoch;

      // Worker 2 tenta dar claim simultaneamente -> rejeitado
      const c2Early = await claimOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
        now: tEarly,
      });
      expect(c2Early.ok).toBe(false);
      expect((c2Early as any).code).toBe("ALREADY_CLAIMED");

      // 2. Worker 1 faz dispatch
      const d1 = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseEpoch: epochW1,
        payloadText: "dispatch A15",
        now: tDisp,
      });
      expect(d1.ok).toBe(true);

      // 3. Worker 1 fica mudo (timeout / freeze de processo)
      // O lease de 2s expira. Executa recoverExpiredLeases:
      const rec = await recoverExpiredLeases(env.DB, tExpired);
      expect(rec.recoveredDispatchedToUncertain).toBe(1);

      // 4. Worker 2 assume a operação em modo VERIFYING com fencing incrementado
      const v2 = await verifyOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
        leaseEpoch: epochW1,
        now: tVerify,
      });
      expect(v2.ok).toBe(true);
      const epochW2 = (v2 as any).leaseEpoch;

      // 5. Worker 1 acorda do freeze e tenta:
      // a) Despachar com epoch antiga
      const lateDispW1 = await dispatchOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseEpoch: epochW1,
        payloadText: "late dispatch",
        now: tLate,
      });
      expect(lateDispW1.ok).toBe(false);
      expect((lateDispW1 as any).code).toBe("FENCING_CONFLICT");

      // b) Confirmar com observeOperation e epoch antiga
      const lateObsW1 = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-1",
        leaseEpoch: epochW1,
        targetRevision: 1,
        attemptId: (d1 as any).attemptId,
        now: tLate,
      });
      expect(lateObsW1.ok).toBe(false);
      expect(["FENCING_CONFLICT", "LEASE_EXPIRED"]).toContain((lateObsW1 as any).code);

      // 6. Worker 2 confirma legitimamente no epoch 2
      const obsW2 = await observeOperation(env.DB, {
        operationId: op!.operation_id,
        workerId: "worker-2",
        leaseEpoch: epochW2,
        targetRevision: 1,
        attemptId: (v2 as any).attemptId,
        now: tFinish,
      });
      expect(obsW2.ok).toBe(true);

      const opFinal = await env.DB.prepare(
        `SELECT state, lease_owner, lease_epoch FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op!.operation_id)
        .first<{ state: string; lease_owner: string; lease_epoch: number }>();

      expect(opFinal!.state).toBe("OBSERVED");
      expect(opFinal!.lease_owner).toBe("worker-2");
      expect(opFinal!.lease_epoch).toBe(epochW2);
    });
  });

  // ==========================================================================
  // G6 & A29 (F1-B): Isolamento entre FACE FEA e FCH EAD com Mesmo RA
  // ==========================================================================
  describe("G6 & A29 (F1-B) — Isolamento FACE FEA e FCH EAD", () => {
    it("A29 F1-B: Mesmo RA textual em grupos distintos gera operações, claims, attempts e recibos estritamente isolados", async () => {
      const mesmoRa = "RA-F1B-A29-MESMO";

      // 1. Setup do aluno no grupo FACE_FEA
      const alunoId = await criarAlunoFicticio(mesmoRa, "Aluno RA Duplo Compartilhado", "FACULDADE FEA");
      const recordIdFace = `rec-face-${mesmoRa}-${crypto.randomUUID().slice(0, 8)}`;
      await initSyncRecord(env.DB, {
        recordId: recordIdFace,
        integrationId: integrationFaceId,
        groupKey: "FACE_FEA",
        raText: mesmoRa,
        alunoId,
      });

      // 2. Setup do aluno no grupo FCH_EAD (mesmo alunoId e mesmo RA textual)
      const recordIdFch = `rec-fch-${mesmoRa}-${crypto.randomUUID().slice(0, 8)}`;
      await initSyncRecord(env.DB, {
        recordId: recordIdFch,
        integrationId: integrationFchId,
        groupKey: "FCH_EAD",
        raText: mesmoRa,
        alunoId,
      });

      expect(recordIdFace).not.toBe(recordIdFch);

      const evFace = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, group: "FACE_FEA" }));
      const evFch = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, group: "FCH_EAD" }));

      // Baseline para o campo 'contrato' nos dois grupos (0)
      const baseFace = await establishFieldBaseline(env.DB, {
        recordId: recordIdFace,
        fieldKey: "contrato",
        baselineValue: 0,
        commandId: `cmd-base-face-${recordIdFace}`,
        actorId: "actor-a29",
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: evFace,
      });
      expect(baseFace.ok).toBe(true);

      const baseFch = await establishFieldBaseline(env.DB, {
        recordId: recordIdFch,
        fieldKey: "contrato",
        baselineValue: 0,
        commandId: `cmd-base-fch-${recordIdFch}`,
        actorId: "actor-a29",
        integrationId: integrationFchId,
        periodoId: periodoFicticioId,
        groupKey: "FCH_EAD",
        generation: 1,
        expectedEpoch: 1,
        evidence: evFch,
      });
      expect(baseFch.ok).toBe(true);

      // 3. Mutação em FACE_FEA para contrato (gera CONTROLE e GERAL_CONTRATO)
      const mutFace = await executeFieldMutation(env.DB, {
        commandId: `cmd-mut-face-${recordIdFace}`,
        actorId: "operator-face",
        recordId: recordIdFace,
        fieldKey: "contrato",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId: periodoFicticioId,
        groupKey: "FACE_FEA",
        generation: 1,
        epoch: 1,
      });
      expect(mutFace.ok).toBe(true);

      // 4. Mutação em FCH_EAD para contrato (gera CONTROLE e GERAL_CONTRATO)
      const mutFch = await executeFieldMutation(env.DB, {
        commandId: `cmd-mut-fch-${recordIdFch}`,
        actorId: "operator-fch",
        recordId: recordIdFch,
        fieldKey: "contrato",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFchId,
        periodoId: periodoFicticioId,
        groupKey: "FCH_EAD",
        generation: 1,
        epoch: 1,
      });
      expect(mutFch.ok).toBe(true);

      // 5. Verifica as operações geradas para FACE_FEA e FCH_EAD
      const opsFace = await env.DB.prepare(
        `SELECT * FROM sync_operations WHERE record_id = ? ORDER BY target_key ASC`
      )
        .bind(recordIdFace)
        .all<OperationRecord>();
      expect(opsFace.results).toHaveLength(2); // CONTROLE e GERAL_CONTRATO

      const opsFch = await env.DB.prepare(
        `SELECT * FROM sync_operations WHERE record_id = ? ORDER BY target_key ASC`
      )
        .bind(recordIdFch)
        .all<OperationRecord>();
      expect(opsFch.results).toHaveLength(2); // CONTROLE e GERAL_CONTRATO

      // 6. Workers dedicados reivindicam e processam separadamente
      const opFaceControle = opsFace.results.find((o) => o.target_key === "CONTROLE")!;
      const opFaceGeral = opsFace.results.find((o) => o.target_key === "GERAL_CONTRATO")!;
      const opFchControle = opsFch.results.find((o) => o.target_key === "CONTROLE")!;
      const opFchGeral = opsFch.results.find((o) => o.target_key === "GERAL_CONTRATO")!;

      // Claim simultâneo dos 4 targets por 4 workers diferentes
      const [cFaceCtrl, cFaceGeral, cFchCtrl, cFchGeral] = await Promise.all([
        claimOperation(env.DB, { operationId: opFaceControle.operation_id, workerId: "worker-face-ctrl" }),
        claimOperation(env.DB, { operationId: opFaceGeral.operation_id, workerId: "worker-face-geral" }),
        claimOperation(env.DB, { operationId: opFchControle.operation_id, workerId: "worker-fch-ctrl" }),
        claimOperation(env.DB, { operationId: opFchGeral.operation_id, workerId: "worker-fch-geral" }),
      ]);

      expect(cFaceCtrl.ok).toBe(true);
      expect(cFaceGeral.ok).toBe(true);
      expect(cFchCtrl.ok).toBe(true);
      expect(cFchGeral.ok).toBe(true);

      // Dispatch dos 4
      const [dFaceCtrl, dFaceGeral, dFchCtrl, dFchGeral] = await Promise.all([
        dispatchOperation(env.DB, {
          operationId: opFaceControle.operation_id,
          workerId: "worker-face-ctrl",
          leaseEpoch: (cFaceCtrl as any).leaseEpoch,
          payloadText: "FACE CONTROLE",
        }),
        dispatchOperation(env.DB, {
          operationId: opFaceGeral.operation_id,
          workerId: "worker-face-geral",
          leaseEpoch: (cFaceGeral as any).leaseEpoch,
          payloadText: "FACE GERAL",
        }),
        dispatchOperation(env.DB, {
          operationId: opFchControle.operation_id,
          workerId: "worker-fch-ctrl",
          leaseEpoch: (cFchCtrl as any).leaseEpoch,
          payloadText: "FCH CONTROLE",
        }),
        dispatchOperation(env.DB, {
          operationId: opFchGeral.operation_id,
          workerId: "worker-fch-geral",
          leaseEpoch: (cFchGeral as any).leaseEpoch,
          payloadText: "FCH GERAL",
        }),
      ]);

      expect(dFaceCtrl.ok).toBe(true);
      expect(dFaceGeral.ok).toBe(true);
      expect(dFchCtrl.ok).toBe(true);
      expect(dFchGeral.ok).toBe(true);

      // Observe dos 4
      const [oFaceCtrl, oFaceGeral, oFchCtrl, oFchGeral] = await Promise.all([
        observeOperation(env.DB, {
          operationId: opFaceControle.operation_id,
          workerId: "worker-face-ctrl",
          leaseEpoch: (cFaceCtrl as any).leaseEpoch,
          targetRevision: 1,
          attemptId: (dFaceCtrl as any).attemptId,
        }),
        observeOperation(env.DB, {
          operationId: opFaceGeral.operation_id,
          workerId: "worker-face-geral",
          leaseEpoch: (cFaceGeral as any).leaseEpoch,
          targetRevision: 1,
          attemptId: (dFaceGeral as any).attemptId,
        }),
        observeOperation(env.DB, {
          operationId: opFchControle.operation_id,
          workerId: "worker-fch-ctrl",
          leaseEpoch: (cFchCtrl as any).leaseEpoch,
          targetRevision: 1,
          attemptId: (dFchCtrl as any).attemptId,
        }),
        observeOperation(env.DB, {
          operationId: opFchGeral.operation_id,
          workerId: "worker-fch-geral",
          leaseEpoch: (cFchGeral as any).leaseEpoch,
          targetRevision: 1,
          attemptId: (dFchGeral as any).attemptId,
        }),
      ]);

      expect(oFaceCtrl.ok).toBe(true);
      expect(oFaceGeral.ok).toBe(true);
      expect(oFchCtrl.ok).toBe(true);
      expect(oFchGeral.ok).toBe(true);

      // Comprovação de isolamento estrito de recibos:
      // Exatamente 2 recibos para o record FACE e 2 recibos para o record FCH
      const rcptsFace = await env.DB.prepare(
        `SELECT r.* FROM sync_receipts r
         JOIN sync_operations o ON o.operation_id = r.operation_id
         WHERE o.record_id = ?`
      )
        .bind(recordIdFace)
        .all();
      expect(rcptsFace.results).toHaveLength(2);

      const rcptsFch = await env.DB.prepare(
        `SELECT r.* FROM sync_receipts r
         JOIN sync_operations o ON o.operation_id = r.operation_id
         WHERE o.record_id = ?`
      )
        .bind(recordIdFch)
        .all();
      expect(rcptsFch.results).toHaveLength(2);

      // Recibos são mutualmente exclusivos
      const faceRcptIds = rcptsFace.results.map((r: any) => r.receipt_id);
      const fchRcptIds = rcptsFch.results.map((r: any) => r.receipt_id);
      for (const id of faceRcptIds) {
        expect(fchRcptIds).not.toContain(id);
      }
    });
  });
});
