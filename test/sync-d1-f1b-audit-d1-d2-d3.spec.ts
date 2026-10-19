import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  executeFieldMutation,
  initSyncRecord,
  establishFieldBaseline,
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
  toSqliteDatetime,
  type OperationRecord,
} from "../src/server/services/sync-d1-operations";

describe("F1-B: Auditoria Adversarial — Bloqueios D1, D2 e D3", () => {
  const periodoFicticioId = 7777;
  const integrationId = "int-f1b-audit-001";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status)
       VALUES (?, '2026-2-AUDIT-F1B', 'ATIVO')`
    )
      .bind(periodoFicticioId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-audit-f1b', 1, 1, 'SHADOW')`
    )
      .bind(integrationId, periodoFicticioId)
      .run();
  });

  async function criarAlunoFicticio(ra: string, nome: string) {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO AUDIT', 'FACE', 'ATIVO')`
    )
      .bind(periodoFicticioId, ra, nome)
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

  async function createEvidence(source: "SPREADSHEET_IMPORT" | "MANUAL_INITIALIZATION" | "LEGACY_MIGRATION", payload: string) {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { source, evidencePayload: payload, evidenceHash: hash };
  }

  async function setupOpPending(ra: string, nome: string) {
    const alunoId = await criarAlunoFicticio(ra, nome);
    const recordId = `rec-${ra}-${crypto.randomUUID().slice(0, 8)}`;

    await initSyncRecord(env.DB, {
      recordId,
      integrationId,
      groupKey: "FACE_FEA",
      raText: ra,
      alunoId,
    });

    const ev = await createEvidence("LEGACY_MIGRATION", JSON.stringify({ alunoId, field: "identidade" }));

    await establishFieldBaseline(env.DB, {
      recordId,
      fieldKey: "identidade",
      baselineValue: 0,
      commandId: `cmd-base-${recordId}`,
      actorId: "actor-setup",
      integrationId,
      periodoId: periodoFicticioId,
      groupKey: "FACE_FEA",
      generation: 1,
      expectedEpoch: 1,
      evidence: ev,
    });

    const mutRes = await executeFieldMutation(env.DB, {
      commandId: `cmd-mut-${recordId}`,
      actorId: "actor-mut",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
      integrationId,
      periodoId: periodoFicticioId,
      groupKey: "FACE_FEA",
      generation: 1,
      epoch: 1,
    });
    expect(mutRes.ok).toBe(true);

    const op = await env.DB.prepare(
      `SELECT operation_id, state, target_revision FROM sync_operations
       WHERE record_id = ? AND field_key = 'identidade' AND target_key = 'CONTROLE'`
    )
      .bind(recordId)
      .first<OperationRecord>();

    return { alunoId, recordId, op: op! };
  }

  // ==========================================================================
  // D1 — Retry de Operação Incerta e Proibição de Despacho Direto de VERIFYING
  // ==========================================================================
  describe("D1 — Retry de operação incerta e validação de estado", () => {
    it("D1.1: Rejeita markRetryWaitOperation chamada diretamente sobre operação em estado UNCERTAIN", async () => {
      const { op } = await setupOpPending("RA-D1-01", "Aluno D1.1");

      // Claim e Dispatch
      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d1" });
      expect(c.ok).toBe(true);
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D1.1",
      });
      expect(d.ok).toBe(true);

      // Transiciona para UNCERTAIN
      const u = await markUncertainOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        attemptId: (d as any).attemptId,
      });
      expect(u.ok).toBe(true);

      // Tenta chamar markRetryWaitOperation diretamente a partir de UNCERTAIN
      const retryRes = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        backoffSeconds: 30,
      });

      expect(retryRes.ok).toBe(false);
      expect((retryRes as any).code).toBe("INVALID_STATE");
      expect((retryRes as any).error).toContain("UNCERTAIN");
    });

    it("D1.2: Rejeita markRetryWaitOperation chamada diretamente sobre operação em estado DISPATCHED", async () => {
      const { op } = await setupOpPending("RA-D1-02", "Aluno D1.2");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d1" });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D1.2",
      });
      expect(d.ok).toBe(true);

      // Tentativa direta de ir de DISPATCHED para RETRY_WAIT sem passar por UNCERTAIN/VERIFYING
      const retryRes = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        backoffSeconds: 30,
      });

      expect(retryRes.ok).toBe(false);
      expect((retryRes as any).code).toBe("INVALID_STATE");
      expect((retryRes as any).error).toContain("DISPATCHED");
    });

    it("D1.3: Rejeita dispatchOperation diretamente a partir de VERIFYING sem resolução comprovada", async () => {
      const { op } = await setupOpPending("RA-D1-03", "Aluno D1.3");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d1" });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D1.3",
      });
      await markUncertainOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        attemptId: (d as any).attemptId,
      });

      // Assume em VERIFYING
      const v = await verifyOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (c as any).leaseEpoch,
      });
      expect(v.ok).toBe(true);

      // Tenta novo despacho direto a partir de VERIFYING (PROIBIDO)
      const dispatchFromVerifying = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (v as any).leaseEpoch,
        payloadText: "tentativa ilegal direto de VERIFYING",
      });

      expect(dispatchFromVerifying.ok).toBe(false);
      expect((dispatchFromVerifying as any).code).toBe("INVALID_STATE");
      expect((dispatchFromVerifying as any).error).toContain("CLAIMED");
    });

    it("D1.4: Rejeita markRetryWaitOperation em VERIFYING se confirmEffectAbsent for false, undefined ou null", async () => {
      const { op } = await setupOpPending("RA-D1-04", "Aluno D1.4");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d1" });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D1.4",
      });
      await markUncertainOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d1",
        leaseEpoch: (c as any).leaseEpoch,
        attemptId: (d as any).attemptId,
      });

      const v = await verifyOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (c as any).leaseEpoch,
      });
      expect(v.ok).toBe(true);

      // CASO 1: confirmEffectAbsent === false
      const resFalse = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (v as any).leaseEpoch,
        backoffSeconds: 30,
        confirmEffectAbsent: false,
      });
      expect(resFalse.ok).toBe(false);
      expect((resFalse as any).code).toBe("INVALID_STATE");

      // CASO 2: confirmEffectAbsent === undefined (omitido)
      const resUndefined = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (v as any).leaseEpoch,
        backoffSeconds: 30,
        // confirmEffectAbsent omitido (undefined)
      });
      expect(resUndefined.ok).toBe(false);
      expect((resUndefined as any).code).toBe("INVALID_STATE");

      // CASO 3: confirmEffectAbsent === null
      const resNull = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (v as any).leaseEpoch,
        backoffSeconds: 30,
        confirmEffectAbsent: null as any,
      });
      expect(resNull.ok).toBe(false);
      expect((resNull as any).code).toBe("INVALID_STATE");

      // Comprovação de ausência de efeitos colaterais: estado permanece VERIFYING e lease_owner preservado
      const opDbAfterRejections = await env.DB.prepare(
        `SELECT state, lease_owner, lease_epoch FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op.operation_id)
        .first<{ state: string; lease_owner: string; lease_epoch: number }>();

      expect(opDbAfterRejections!.state).toBe("VERIFYING");
      expect(opDbAfterRejections!.lease_owner).toBe("worker-ver");
      expect(opDbAfterRejections!.lease_epoch).toBe((v as any).leaseEpoch);

      // CASO 4: confirmEffectAbsent === true (sucesso legítimo)
      const resTrue = await markRetryWaitOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-ver",
        leaseEpoch: (v as any).leaseEpoch,
        backoffSeconds: 30,
        confirmEffectAbsent: true,
      });
      expect(resTrue.ok).toBe(true);

      const opDbFinal = await env.DB.prepare(
        `SELECT state, lease_owner, lease_until FROM sync_operations WHERE operation_id = ?`
      )
        .bind(op.operation_id)
        .first<{ state: string; lease_owner: string | null; lease_until: string | null }>();

      expect(opDbFinal!.state).toBe("RETRY_WAIT");
      expect(opDbFinal!.lease_owner).toBeNull();
      expect(opDbFinal!.lease_until).toBeNull();
    });
  });

  // ==========================================================================
  // D2 — Recibos e Tentativas: Exigência de Tentativa Válida e Bloqueio de CLAIMED
  // ==========================================================================
  describe("D2 — Recibos, tentativas e evidência de verificação", () => {
    it("D2.1: Rejeita observeOperation a partir do estado CLAIMED sem dispatch ou verificação", async () => {
      const { op } = await setupOpPending("RA-D2-01", "Aluno D2.1");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d2" });
      expect(c.ok).toBe(true);

      // Tenta forjar observação diretamente do estado CLAIMED
      const obsRes = await observeOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        targetRevision: 1,
        attemptId: "att-forjada",
      });

      expect(obsRes.ok).toBe(false);
      expect(["INVALID_STATE", "INVALID_ATTEMPT"]).toContain((obsRes as any).code);
    });

    it("D2.2: Rejeita observeOperation a partir do estado UNCERTAIN sem verificação prévia", async () => {
      const { op } = await setupOpPending("RA-D2-02", "Aluno D2.2");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d2" });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D2.2",
      });
      await markUncertainOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        attemptId: (d as any).attemptId,
      });

      // Tenta observar direto de UNCERTAIN
      const obsRes = await observeOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        targetRevision: 1,
        attemptId: (d as any).attemptId,
      });

      expect(obsRes.ok).toBe(false);
      expect(["INVALID_STATE", "FENCING_CONFLICT"]).toContain((obsRes as any).code);
    });

    it("D2.3: Rejeita observeOperation com attemptId inexistente no banco", async () => {
      const { op } = await setupOpPending("RA-D2-03", "Aluno D2.3");

      const c = await claimOperation(env.DB, { operationId: op.operation_id, workerId: "worker-d2" });
      await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "payload D2.3",
      });

      const obsRes = await observeOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d2",
        leaseEpoch: (c as any).leaseEpoch,
        targetRevision: 1,
        attemptId: "att-completamente-inexistente-12345",
      });

      expect(obsRes.ok).toBe(false);
      expect((obsRes as any).code).toBe("INVALID_ATTEMPT");
      expect((obsRes as any).error).toContain("não encontrado");
    });

    it("D2.4: Rejeita observeOperation com attemptId pertencente a outra operação", async () => {
      const op1 = await setupOpPending("RA-D2-04-A", "Aluno D2.4 A");
      const op2 = await setupOpPending("RA-D2-04-B", "Aluno D2.4 B");

      // Dispatch na op1
      const c1 = await claimOperation(env.DB, { operationId: op1.op.operation_id, workerId: "worker-1" });
      const d1 = await dispatchOperation(env.DB, {
        operationId: op1.op.operation_id,
        workerId: "worker-1",
        leaseEpoch: (c1 as any).leaseEpoch,
        payloadText: "payload op1",
      });

      // Dispatch na op2
      const c2 = await claimOperation(env.DB, { operationId: op2.op.operation_id, workerId: "worker-2" });
      await dispatchOperation(env.DB, {
        operationId: op2.op.operation_id,
        workerId: "worker-2",
        leaseEpoch: (c2 as any).leaseEpoch,
        payloadText: "payload op2",
      });

      // Worker 2 tenta confirmar op2 usando attemptId da op1
      const obsRes = await observeOperation(env.DB, {
        operationId: op2.op.operation_id,
        workerId: "worker-2",
        leaseEpoch: (c2 as any).leaseEpoch,
        targetRevision: 1,
        attemptId: (d1 as any).attemptId, // attempt da op1!
      });

      expect(obsRes.ok).toBe(false);
      expect((obsRes as any).code).toBe("INVALID_ATTEMPT");
      expect((obsRes as any).error).toContain("pertence à operação");
    });
  });

  // ==========================================================================
  // D3 — Lease Expirado (Janela entre Expiração e Execução do Scanner)
  // ==========================================================================
  describe("D3 — Lease expirado antes da execução do scanner", () => {
    it("D3.1: Rejeita dispatchOperation de worker com lease expirado mesmo antes de o scanner rodar", async () => {
      const { op } = await setupOpPending("RA-D3-01", "Aluno D3.1");

      const t0 = new Date();
      const tExpired = new Date(t0.getTime() + 5000); // 5s após

      // Claim com leaseDuration de 2s
      const c = await claimOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseDurationSeconds: 2,
        now: t0,
      });
      expect(c.ok).toBe(true);

      // O tempo avança para tExpired (5s > 2s). O scanner NÃO foi chamado!
      // Worker tenta despachar na janela entre expiração e scanner:
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "dispatch tardio",
        now: tExpired,
      });

      expect(d.ok).toBe(false);
      expect(["LEASE_EXPIRED", "FENCING_CONFLICT"]).toContain((d as any).code);

      // Estado permanece CLAIMED no banco (não transicionou para DISPATCHED)
      const opDb = await env.DB.prepare(`SELECT state FROM sync_operations WHERE operation_id = ?`)
        .bind(op.operation_id)
        .first<{ state: string }>();
      expect(opDb!.state).toBe("CLAIMED");
    });

    it("D3.2: Rejeita observeOperation de worker com lease expirado mesmo antes de o scanner rodar", async () => {
      const { op } = await setupOpPending("RA-D3-02", "Aluno D3.2");

      const t0 = new Date();
      const tDisp = new Date(t0.getTime() + 500);
      const tExpired = new Date(t0.getTime() + 5000);

      const c = await claimOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseDurationSeconds: 2,
        now: t0,
      });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "dispatch D3.2",
        now: tDisp,
      });
      expect(d.ok).toBe(true);

      // O lease expira no relógio em tExpired (5s > 2s). O scanner NÃO rodou!
      // Worker tenta confirmar a operação:
      const obsRes = await observeOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        targetRevision: 1,
        attemptId: (d as any).attemptId,
        now: tExpired,
      });

      expect(obsRes.ok).toBe(false);
      expect(["LEASE_EXPIRED", "FENCING_CONFLICT"]).toContain((obsRes as any).code);

      // Nenhum recibo foi gerado
      const rcpt = await env.DB.prepare(`SELECT * FROM sync_receipts WHERE attempt_id = ?`)
        .bind((d as any).attemptId)
        .first();
      expect(rcpt).toBeNull();
    });

    it("D3.3: Rejeita markUncertainOperation e markRetryWaitOperation se o lease já expirou", async () => {
      const { op } = await setupOpPending("RA-D3-03", "Aluno D3.3");

      const t0 = new Date();
      const tDisp = new Date(t0.getTime() + 500);
      const tExpired = new Date(t0.getTime() + 5000);

      const c = await claimOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseDurationSeconds: 2,
        now: t0,
      });
      const d = await dispatchOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        payloadText: "dispatch D3.3",
        now: tDisp,
      });

      // Worker tenta marcar UNCERTAIN após seu próprio lease expirar
      const uncRes = await markUncertainOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        attemptId: (d as any).attemptId,
        now: tExpired,
      });

      expect(uncRes.ok).toBe(false);
      expect(["LEASE_EXPIRED", "FENCING_CONFLICT"]).toContain((uncRes as any).code);
    });

    it("D3.4: Rejeita renewLease após o lease já ter expirado", async () => {
      const { op } = await setupOpPending("RA-D3-04", "Aluno D3.4");

      const t0 = new Date();
      const tExpired = new Date(t0.getTime() + 5000);

      const c = await claimOperation(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseDurationSeconds: 2,
        now: t0,
      });

      // Tenta renovar quando já expirou
      const renewRes = await renewLease(env.DB, {
        operationId: op.operation_id,
        workerId: "worker-d3",
        leaseEpoch: (c as any).leaseEpoch,
        extensionSeconds: 60,
        now: tExpired,
      });

      expect(renewRes.ok).toBe(false);
      expect((renewRes as any).code).toBe("FENCING_CONFLICT");
    });
  });
});

