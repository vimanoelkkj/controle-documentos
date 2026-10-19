import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeCanonicalCommandHash,
  executeFieldMutation,
  initSyncRecord,
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";

describe("Testes de Validação e Integridade (C1 - C6)", () => {
  const periodoId = 9991;
  const integrationId = "int-audit-001";
  const integrationPausedId = "int-audit-paused";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status) VALUES (?, '2026-2-AUDIT', 'ATIVO')`
    )
      .bind(periodoId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-audit', 1, 1, 'SHADOW')`
    )
      .bind(integrationId, periodoId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-audit', 1, 1, 'PAUSED')`
    )
      .bind(integrationPausedId, periodoId)
      .run();
  });

  async function criarAlunoComDocs(ra: string, nome: string, unidade = "FACE") {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO TESTE', ?, 'ATIVO')`
    )
      .bind(periodoId, ra, nome, unidade)
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

  function mutate(params: {
    commandId: string;
    actorId: string;
    recordId: string;
    fieldKey: FieldKey;
    fromRevision: number;
    proposedValue: 0 | 1;
    integrationId?: string;
    periodoId?: number;
    groupKey?: GroupKey;
    generation?: number;
    requestHash?: string;
  }) {
    return executeFieldMutation(env.DB, {
      integrationId: params.integrationId ?? integrationId,
      periodoId: params.periodoId ?? periodoId,
      groupKey: params.groupKey ?? "FACE_FEA",
      generation: params.generation ?? 1,
      expectedEpoch: 1,
      ...params,
    });
  }

  function initRecord(params: {
    recordId: string;
    raText: string;
    alunoId?: number | null;
    integrationId?: string;
    groupKey?: GroupKey;
    generation?: number;
    lifecycle?: "ACTIVE" | "INACTIVE" | "TOMBSTONE";
    initialValues?: Partial<Record<FieldKey, 0 | 1>>;
  }) {
    return initSyncRecord(env.DB, {
      integrationId: params.integrationId ?? integrationId,
      groupKey: params.groupKey ?? "FACE_FEA",
      initialValues: params.initialValues ?? {
        identidade: 0,
        cpf_documento: 0,
        certidao: 0,
        residencia: 0,
        titulo: 0,
        ensino_medio: 0,
        contrato: 0,
      },
      ...params,
    });
  }

  // C1 — Projeção não confirmada
  describe("C1 — Projeção não confirmada", () => {
    it("C1.1: aluno_id = NULL não deve resultar em confirmação falsa (COMMITTED)", async () => {
      const recordId = "rec-c1-null-aluno";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C1-NULL",
        groupKey: "FACE_FEA",
        alunoId: null,
      });

      const res = await mutate({
        commandId: "cmd-c1-null",
        actorId: "actor-c1",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C1.2: Projeção inexistente (sem linha em documentos) não deve confirmar", async () => {
      const resAluno = await env.DB.prepare(
        `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
         VALUES (?, 'RA-C1-NODOC', 'Aluno Sem Doc', 'CURSO', 'FACE', 'ATIVO')`
      )
        .bind(periodoId)
        .run();
      const alunoSemDocId = Number(resAluno.meta.last_row_id);

      const recordId = "rec-c1-no-doc";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C1-NODOC",
        groupKey: "FACE_FEA",
        alunoId: alunoSemDocId,
      });

      const res = await mutate({
        commandId: "cmd-c1-nodoc",
        actorId: "actor-c1",
        recordId,
        fieldKey: "cpf_documento",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C1.3: Identidade inconsistente (RA do aluno diverge do RA do sync_record) não deve confirmar", async () => {
      const alunoIdReal = await criarAlunoComDocs("RA-C1-REAL", "Aluno Real");
      const recordId = "rec-c1-inconsistente";

      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C1-FORJADO",
        groupKey: "FACE_FEA",
        alunoId: alunoIdReal,
      });

      const res = await mutate({
        commandId: "cmd-c1-inconsistent",
        actorId: "actor-c1",
        recordId,
        fieldKey: "certidao",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });
  });

  // C2 — Idempotência e hash
  describe("C2 — Idempotência e hash canônico", () => {
    it("C2.1: Payload divergente com hash falsamente reutilizado deve ser rejeitado", async () => {
      const alunoId = await criarAlunoComDocs("RA-C2-001", "Aluno C2");
      const recordId = "rec-c2-001";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C2-001",
        groupKey: "FACE_FEA",
        alunoId,
      });

      const commandId = "cmd-c2-replay-forged";

      // 1ª execução legítima com proposedValue = 1
      const canonicalHash1 = await computeCanonicalCommandHash({
        commandId,
        actorId: "actor-c2",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      const res1 = await mutate({
        commandId,
        actorId: "actor-c2",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        requestHash: canonicalHash1,
      });
      expect(res1.ok).toBe(true);

      // 2ª execução com mesmo commandId, mas payload DIVERGENTE (proposedValue = 0),
      // falsamente reutilizando o canonicalHash1 da 1ª execução
      const res2 = await mutate({
        commandId,
        actorId: "actor-c2",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 0, // DIVERGENTE!
        requestHash: canonicalHash1, // Falsamente reutilizado!
      });

      expect(res2.ok).toBe(false);
      expect(res2.status).toBe("INTEGRITY_ERROR");
    });

    it("C2.2: Hash arbitrário não correspondente ao cálculo canônico é rejeitado imediatamente", async () => {
      const alunoId = await criarAlunoComDocs("RA-C2-002", "Aluno C2 Hash Forjado");
      const recordId = "rec-c2-002";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C2-002",
        groupKey: "FACE_FEA",
        alunoId,
      });

      const res = await mutate({
        commandId: "cmd-c2-forged-direct",
        actorId: "actor-c2",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        requestHash: "hash-inventado-pelo-chamador",
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C2.3: Requisições simultâneas com o mesmo command ID: exatamente uma confirma e outra recebe replay idêntico", async () => {
      const alunoId = await criarAlunoComDocs("RA-C2-003", "Aluno C2 Concorrente");
      const recordId = "rec-c2-003";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C2-003",
        groupKey: "FACE_FEA",
        alunoId,
      });

      const commandId = "cmd-c2-concurrent-same-id";
      const mutationData = {
        commandId,
        actorId: "actor-c2",
        recordId,
        fieldKey: "identidade" as const,
        fromRevision: 0,
        proposedValue: 1 as const,
      };

      const [resA, resB] = await Promise.all([
        mutate(mutationData),
        mutate(mutationData),
      ]);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain("COMMITTED");
      expect(statuses).toContain("IDEMPOTENT_REPLAY");
    });
  });

  // C3 — Identidade e ciclo de vida
  describe("C3 — Identidade e ciclo de vida", () => {
    it("C3.1: Registro INACTIVE deve ser rejeitado", async () => {
      const alunoId = await criarAlunoComDocs("RA-C3-INACT", "Aluno Inactive");
      const recordId = "rec-c3-inactive";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C3-INACT",
        groupKey: "FACE_FEA",
        alunoId,
        lifecycle: "INACTIVE",
      });

      const res = await mutate({
        commandId: "cmd-c3-inactive",
        actorId: "actor-c3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C3.2: Registro TOMBSTONE deve ser rejeitado", async () => {
      const alunoId = await criarAlunoComDocs("RA-C3-TOMB", "Aluno Tombstone");
      const recordId = "rec-c3-tombstone";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C3-TOMB",
        groupKey: "FACE_FEA",
        alunoId,
        lifecycle: "TOMBSTONE",
      });

      const res = await mutate({
        commandId: "cmd-c3-tomb",
        actorId: "actor-c3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C3.3: Geração obsoleta deve ser rejeitada", async () => {
      const alunoId = await criarAlunoComDocs("RA-C3-OBS", "Aluno Obsoleto");
      const recordIdGen1 = "rec-c3-gen1";
      const recordIdGen2 = "rec-c3-gen2";

      await initRecord({
        recordId: recordIdGen1,
        integrationId,
        raText: "RA-C3-OBS",
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        lifecycle: "INACTIVE",
      });

      await initRecord({
        recordId: recordIdGen2,
        integrationId,
        raText: "RA-C3-OBS",
        groupKey: "FACE_FEA",
        alunoId,
        generation: 2,
        lifecycle: "ACTIVE",
      });

      const res = await mutate({
        commandId: "cmd-c3-gen1",
        actorId: "actor-c3",
        recordId: recordIdGen1,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        generation: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C3.4: Integração incompatível ou pausada deve ser rejeitada", async () => {
      const alunoId = await criarAlunoComDocs("RA-C3-PAUSED", "Aluno Pausado");
      const recordId = "rec-c3-paused";
      await initRecord({
        recordId,
        integrationId: integrationPausedId,
        raText: "RA-C3-PAUSED",
        groupKey: "FACE_FEA",
        alunoId,
      });

      const res = await mutate({
        commandId: "cmd-c3-paused",
        actorId: "actor-c3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationPausedId,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });

    it("C3.5: Grupo incorreto no contrato explícito deve ser rejeitado", async () => {
      const alunoId = await criarAlunoComDocs("RA-C3-GRP", "Aluno Grupo");
      const recordId = "rec-c3-group";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C3-GRP",
        groupKey: "FACE_FEA",
        alunoId,
      });

      const res = await mutate({
        commandId: "cmd-c3-group",
        actorId: "actor-c3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        groupKey: "FCH_EAD", // Divergência contratual explícita!
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("INTEGRITY_ERROR");
    });
  });

  // C4 — Convergência
  describe("C4 — Convergência sem nova revisão ou evento", () => {
    it("C4.1: Mutação com valor idêntico (sem alteração semântica) não deve criar evento nem incrementar revisão", async () => {
      const alunoId = await criarAlunoComDocs("RA-C4-CONV", "Aluno Convergente");
      const recordId = "rec-c4-conv";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C4-CONV",
        groupKey: "FACE_FEA",
        alunoId,
        initialValues: { identidade: 1 },
      });

      // Campo 'identidade' já é 1 na revisão 0. Propomos valor 1 com fromRevision = 0.
      const res = await mutate({
        commandId: "cmd-c4-conv-1",
        actorId: "actor-c4",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(true);
      expect((res as any).status).toBe("CONVERGED");
      expect(res.toRevision).toBe(0);

      const events = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM sync_events WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ total: number }>();
      expect(events?.total).toBe(0);

      const ops = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM sync_operations WHERE record_id = ?`
      )
        .bind(recordId)
        .first<{ total: number }>();
      expect(ops?.total).toBe(0);

      // Replay subsequente deve recuperar o recibo sem transição
      const replay = await mutate({
        commandId: "cmd-c4-conv-1",
        actorId: "actor-c4",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });
      expect(replay.ok).toBe(true);
      expect(replay.status).toBe("IDEMPOTENT_REPLAY");
      expect(replay.toRevision).toBe(0);
    });

    it("C4.2: Distingue conflito de revisão quando fromRevision diverge da revisão atual", async () => {
      const alunoId = await criarAlunoComDocs("RA-C4-CONF", "Aluno Conflito");
      const recordId = "rec-c4-conf";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C4-CONF",
        groupKey: "FACE_FEA",
        alunoId,
        initialValues: { identidade: 0 },
      });

      // 1ª mutação incrementa para revisão 1
      await mutate({
        commandId: "cmd-c4-rev1",
        actorId: "actor-c4",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      // Tentativa de mutar com fromRevision obsoleta (0 em vez de 1)
      const resConflict = await mutate({
        commandId: "cmd-c4-stale",
        actorId: "actor-c4",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0, // Stale!
        proposedValue: 0,
      });

      expect(resConflict.ok).toBe(false);
      expect(["REVISION_CONFLICT", "CAS_CONFLICT"]).toContain(resConflict.status);
    });
  });

  // C6 — Rastreabilidade (last_event_id)
  describe("C6 — Rastreabilidade (last_event_id)", () => {
    it("C6.1: Transição vencedora atualiza last_event_id em sync_field_state e vincula evento/revisão/comando", async () => {
      const alunoId = await criarAlunoComDocs("RA-C6-001", "Aluno C6");
      const recordId = "rec-c6-001";
      await initRecord({
        recordId,
        integrationId,
        raText: "RA-C6-001",
        groupKey: "FACE_FEA",
        alunoId,
        initialValues: { identidade: 0 },
      });

      const commandId = "cmd-c6-001";
      const res = await mutate({
        commandId,
        actorId: "actor-c6",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const fieldState = await env.DB.prepare(
        `SELECT last_event_id, head_command_id, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      )
        .bind(recordId)
        .first<{ last_event_id: string | null; head_command_id: string; revision: number }>();

      expect(fieldState?.last_event_id).toBe(res.eventId);
      expect(fieldState?.head_command_id).toBe(commandId);
      expect(fieldState?.revision).toBe(1);

      // Vínculo no sync_events
      const event = await env.DB.prepare(
        `SELECT event_id, command_id, to_revision FROM sync_events WHERE event_id = ?`
      )
        .bind(res.eventId)
        .first<{ event_id: string; command_id: string; to_revision: number }>();
      expect(event?.command_id).toBe(commandId);
      expect(event?.to_revision).toBe(1);

      // Vínculo no sync_receipts
      const receipt = await env.DB.prepare(
        `SELECT receipt_id, command_id, revision FROM sync_receipts WHERE receipt_id = ?`
      )
        .bind(res.receiptId)
        .first<{ receipt_id: string; command_id: string; revision: number }>();
      expect(receipt?.command_id).toBe(commandId);
      expect(receipt?.revision).toBe(1);
    });
  });
});
