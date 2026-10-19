import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  executeFieldMutation,
  initSyncRecord,
  type FieldKey,
  type GroupKey,
} from "../src/server/services/sync-d1-core";

describe("F1-A: Núcleo Transacional D1, CAS Atômico, Idempotência e Outbox", () => {
  let periodoFicticioId = 9999;
  let integrationFaceId = "int-ficticia-face-001";
  let integrationFchId = "int-ficticia-fch-001";

  beforeAll(async () => {
    // 1. Comprovação de isolamento: Criar período e integração exclusivamente fictícios
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status)
       VALUES (?, '2026-2-FICTICIO-F1A', 'ATIVO')`
    )
      .bind(periodoFicticioId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-ficticia-f1a', 1, 1, 'SHADOW')`
    )
      .bind(integrationFaceId, periodoFicticioId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-ficticia-f1a', 1, 1, 'SHADOW')`
    )
      .bind(integrationFchId, periodoFicticioId)
      .run();
  });

  // Helper para criar aluno fictício e registrar documentos legados
  async function criarAlunoFicticio(ra: string, nome: string, unidade: string) {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO TESTE', ?, 'ATIVO')`
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
    eventId?: string;
    operationIdControle?: string;
    receiptId?: string;
  }) {
    return executeFieldMutation(env.DB, {
      integrationId: params.integrationId ?? integrationFaceId,
      periodoId: params.periodoId ?? periodoFicticioId,
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
      integrationId: params.integrationId ?? integrationFaceId,
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

  // ==========================================================================
  // PROVA P1: CAS vencedor confirma todos os efeitos locais
  // ==========================================================================
  it("P1: CAS vencedor confirma todos os efeitos locais (command, field_state, event, operations, documentos, receipt)", async () => {
    const ra = "RA-FICTICIO-P1-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P1", "FACE");
    const recordId = "rec-p1-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    // Muta campo 'ensino_medio' de 0 para 1
    const commandId = "cmd-p1-001";
    const res = await mutate({
      commandId,
      actorId: "actor-test-1",
      recordId,
      fieldKey: "ensino_medio",
      fromRevision: 0,
      proposedValue: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe("COMMITTED");
    expect(res.toRevision).toBe(1);

    // 1. sync_commands registrado
    const cmd = await env.DB.prepare(
      `SELECT command_id, status, from_revision, proposed_value FROM sync_commands WHERE command_id = ?`
    )
      .bind(commandId)
      .first<any>();
    expect(cmd).toBeDefined();
    expect(cmd.status).toBe("ACCEPTED");
    expect(cmd.proposed_value).toBe(1);

    // 2. sync_field_state atualizado
    const field = await env.DB.prepare(
      `SELECT value, revision, head_command_id, last_event_id FROM sync_field_state WHERE record_id = ? AND field_key = 'ensino_medio'`
    )
      .bind(recordId)
      .first<any>();
    expect(field.value).toBe(1);
    expect(field.revision).toBe(1);
    expect(field.head_command_id).toBe(commandId);
    expect(field.last_event_id).toBe(res.eventId);

    // 3. sync_events gravado
    const ev = await env.DB.prepare(
      `SELECT event_id, from_revision, to_revision, value_old, value_new FROM sync_events WHERE event_id = ?`
    )
      .bind(res.eventId)
      .first<any>();
    expect(ev.from_revision).toBe(0);
    expect(ev.to_revision).toBe(1);
    expect(ev.value_old).toBe(0);
    expect(ev.value_new).toBe(1);

    // 4. sync_operations criada no estado PENDING para CONTROLE
    const opControle = await env.DB.prepare(
      `SELECT operation_id, target_key, state, target_revision FROM sync_operations WHERE event_id = ? AND target_key = 'CONTROLE'`
    )
      .bind(res.eventId)
      .first<any>();
    expect(opControle.state).toBe("PENDING");
    expect(opControle.target_revision).toBe(1);

    // 5. documentos atualizada
    const doc = await env.DB.prepare(
      `SELECT ensino_medio FROM documentos WHERE aluno_id = ?`
    )
      .bind(alunoId)
      .first<any>();
    expect(doc.ensino_medio).toBe(1);

    // 6. sync_receipts registrado
    const receipt = await env.DB.prepare(
      `SELECT receipt_id, revision, status FROM sync_receipts WHERE receipt_id = ?`
    )
      .bind(res.receiptId)
      .first<any>();
    expect(receipt.revision).toBe(1);
    expect(receipt.status).toBe("D1_COMMITTED");

    // Teste de Contrato gerando 2 alvos na outbox
    const cmdContrato = "cmd-p1-contrato";
    const resContrato = await mutate({
      commandId: cmdContrato,
      actorId: "actor-test-1",
      recordId,
      fieldKey: "contrato",
      fromRevision: 0,
      proposedValue: 1,
    });

    expect(resContrato.ok).toBe(true);
    if (!resContrato.ok) return;

    const opsContrato = await env.DB.prepare(
      `SELECT target_key, state FROM sync_operations WHERE event_id = ? ORDER BY target_key`
    )
      .bind(resContrato.eventId)
      .all<any>();

    expect(opsContrato.results.length).toBe(2);
    expect(opsContrato.results[0].target_key).toBe("CONTROLE");
    expect(opsContrato.results[0].state).toBe("PENDING");
    expect(opsContrato.results[1].target_key).toBe("GERAL_CONTRATO");
    expect(opsContrato.results[1].state).toBe("PENDING");
  });

  // ==========================================================================
  // PROVA P2: CAS perdedor não modifica o campo em sync_field_state
  // ==========================================================================
  it("P2: CAS perdedor não modifica o campo em sync_field_state", async () => {
    const ra = "RA-FICTICIO-P2-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P2", "FACE");
    const recordId = "rec-p2-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    // Avança o campo para revision = 1
    await mutate({
      commandId: "cmd-p2-vencedor",
      actorId: "actor-1",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 1,
    });

    const beforeState = await env.DB.prepare(
      `SELECT value, revision, head_command_id, updated_at FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
    )
      .bind(recordId)
      .first<any>();

    expect(beforeState.revision).toBe(1);
    expect(beforeState.value).toBe(1);
    expect(beforeState.head_command_id).toBe("cmd-p2-vencedor");

    // Tentativa com base desatualizada fromRevision = 0 (CAS Perdedor)
    const resPerdedor = await mutate({
      commandId: "cmd-p2-perdedor",
      actorId: "actor-2",
      recordId,
      fieldKey: "identidade",
      fromRevision: 0,
      proposedValue: 0,
    });

    expect(resPerdedor.ok).toBe(false);
    expect(resPerdedor.status).toBe("CAS_CONFLICT");

    // Verifica que sync_field_state permaneceu absolutamente inalterado
    const afterState = await env.DB.prepare(
      `SELECT value, revision, head_command_id, updated_at FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
    )
      .bind(recordId)
      .first<any>();

    expect(afterState.revision).toBe(beforeState.revision);
    expect(afterState.value).toBe(beforeState.value);
    expect(afterState.head_command_id).toBe(beforeState.head_command_id);
    expect(afterState.updated_at).toBe(beforeState.updated_at);
  });

  // ==========================================================================
  // PROVA P3: CAS perdedor não deixa comandos, eventos, projeções ou operações órfãs
  // ==========================================================================
  it("P3: CAS perdedor não deixa comandos, eventos, projeções ou operações órfãs (rollback integral)", async () => {
    const ra = "RA-FICTICIO-P3-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P3", "FACE");
    const recordId = "rec-p3-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    // Avança para revision 1
    await mutate({
      commandId: "cmd-p3-ok",
      actorId: "actor-1",
      recordId,
      fieldKey: "cpf_documento",
      fromRevision: 0,
      proposedValue: 1,
    });

    const commandIdPerdedor = "cmd-p3-orphantest";
    const eventIdPerdedor = "evt-p3-orphantest";
    const opIdPerdedor = "op-p3-orphantest";
    const receiptIdPerdedor = "rec-p3-orphantest";

    const res = await mutate({
      commandId: commandIdPerdedor,
      actorId: "actor-2",
      recordId,
      fieldKey: "cpf_documento",
      fromRevision: 0, // Incorreto, já está na 1
      proposedValue: 0,
      eventId: eventIdPerdedor,
      operationIdControle: opIdPerdedor,
      receiptId: receiptIdPerdedor,
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("CAS_CONFLICT");

    // PROVA DE ZERO ORFÃOS
    const countCmd = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_commands WHERE command_id = ?`
    )
      .bind(commandIdPerdedor)
      .first<any>();
    expect(countCmd.c).toBe(0);

    const countEvt = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_events WHERE event_id = ?`
    )
      .bind(eventIdPerdedor)
      .first<any>();
    expect(countEvt.c).toBe(0);

    const countOp = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_operations WHERE operation_id = ?`
    )
      .bind(opIdPerdedor)
      .first<any>();
    expect(countOp.c).toBe(0);

    const countReceipt = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_receipts WHERE receipt_id = ?`
    )
      .bind(receiptIdPerdedor)
      .first<any>();
    expect(countReceipt.c).toBe(0);

    // Projeção em documentos inalterada
    const doc = await env.DB.prepare(
      `SELECT cpf FROM documentos WHERE aluno_id = ?`
    )
      .bind(alunoId)
      .first<any>();
    expect(doc.cpf).toBe(1); // Manteve 1 do vencedor
  });

  // ==========================================================================
  // PROVA P4: Erro SQL durante o batch provoca rollback integral
  // ==========================================================================
  it("P4: Erro SQL durante o batch provoca rollback integral", async () => {
    const ra = "RA-FICTICIO-P4-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P4", "FACE");
    const recordId = "rec-p4-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    const cmdId = "cmd-p4-sqlerror";
    // Monta lote direto no DB onde o último statement viola constraint NOT NULL de coluna não relacionada
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO sync_commands (
          command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
        ) VALUES (?, 'actor', ?, 'titulo', 0, 1, 'h', 'ACCEPTED')`
      ).bind(cmdId, recordId),

      env.DB.prepare(
        `UPDATE sync_field_state SET value = 1, revision = revision + 1, head_command_id = ? WHERE record_id = ? AND field_key = 'titulo'`
      ).bind(cmdId, recordId),

      // Statement com erro intencional: foreign key inexistente
      env.DB.prepare(
        `INSERT INTO sync_events (
          event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
        ) VALUES ('evt-bad', 'RECORD-INEXISTENTE', 'titulo', ?, 0, 1, 0, 1, 'actor')`
      ).bind(cmdId),
    ];

    let erroDisparado = false;
    try {
      await env.DB.batch(stmts);
    } catch (e: any) {
      erroDisparado = true;
    }

    expect(erroDisparado).toBe(true);

    // Comprova rollback total: command não foi gravado e field_state não foi alterado
    const cmdCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_commands WHERE command_id = ?`
    )
      .bind(cmdId)
      .first<any>();
    expect(cmdCount.c).toBe(0);

    const field = await env.DB.prepare(
      `SELECT revision, value FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`
    )
      .bind(recordId)
      .first<any>();
    expect(field.revision).toBe(0);
    expect(field.value).toBe(0);
  });

  // ==========================================================================
  // PROVA P5: Duas requisições concorrentes com mesma base não aceitam a mesma revisão
  // ==========================================================================
  it("P5: Duas requisições concorrentes com mesma base: exatamente uma vence e uma conflita", async () => {
    const ra = "RA-FICTICIO-P5-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P5", "FACE");
    const recordId = "rec-p5-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    // Ambas propõem a partir da revisão base 0
    const p1 = mutate({
      commandId: "cmd-p5-req1",
      actorId: "actor-1",
      recordId,
      fieldKey: "certidao",
      fromRevision: 0,
      proposedValue: 1,
    });

    const p2 = mutate({
      commandId: "cmd-p5-req2",
      actorId: "actor-2",
      recordId,
      fieldKey: "certidao",
      fromRevision: 0,
      proposedValue: 1,
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    const sucessos = [r1, r2].filter((r) => r.ok && r.status === "COMMITTED");
    const conflitos = [r1, r2].filter(
      (r) => !r.ok && (r.status === "CAS_CONFLICT" || r.status === "REVISION_CONFLICT")
    );

    expect(sucessos.length).toBe(1);
    expect(conflitos.length).toBe(1);

    // O banco está exatamente na revisão 1, com apenas 1 evento
    const field = await env.DB.prepare(
      `SELECT revision FROM sync_field_state WHERE record_id = ? AND field_key = 'certidao'`
    )
      .bind(recordId)
      .first<any>();
    expect(field.revision).toBe(1);

    const eventCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_events WHERE record_id = ? AND field_key = 'certidao'`
    )
      .bind(recordId)
      .first<any>();
    expect(eventCount.c).toBe(1);
  });

  // ==========================================================================
  // PROVA P6: Retry idêntico não produz uma segunda transição
  // ==========================================================================
  it("P6: Retry idêntico recupera recibo existente e não produz segunda transição", async () => {
    const ra = "RA-FICTICIO-P6-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P6", "FACE");
    const recordId = "rec-p6-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    const mutationData = {
      commandId: "cmd-p6-retry",
      actorId: "actor-retry",
      recordId,
      fieldKey: "residencia" as FieldKey,
      fromRevision: 0,
      proposedValue: 1 as const,
    };

    // 1ª Execução
    const firstRes = await mutate(mutationData);
    expect(firstRes.ok).toBe(true);
    if (!firstRes.ok) return;
    expect(firstRes.status).toBe("COMMITTED");

    // 2ª Execução (Retry idêntico)
    const retryRes = await mutate(mutationData);
    expect(retryRes.ok).toBe(true);
    if (!retryRes.ok) return;
    expect(retryRes.status).toBe("IDEMPOTENT_REPLAY");
    expect(retryRes.toRevision).toBe(1);
    expect(retryRes.receiptId).toBe(firstRes.receiptId);

    // Comprova que não houve segunda transição
    const evCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM sync_events WHERE record_id = ? AND field_key = 'residencia'`
    )
      .bind(recordId)
      .first<any>();
    expect(evCount.c).toBe(1);

    const field = await env.DB.prepare(
      `SELECT revision FROM sync_field_state WHERE record_id = ? AND field_key = 'residencia'`
    )
      .bind(recordId)
      .first<any>();
    expect(field.revision).toBe(1);
  });

  // ==========================================================================
  // PROVA P7: Mesmo ID de comando com payload/hash diferente é rejeitado
  // ==========================================================================
  it("P7: Mesmo ID de comando com payload/hash diferente é rejeitado como erro de integridade", async () => {
    const ra = "RA-FICTICIO-P7-001";
    const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio P7", "FACE");
    const recordId = "rec-p7-001";

    await initRecord({
      recordId,
      integrationId: integrationFaceId,
      raText: ra,
      groupKey: "FACE_FEA",
      alunoId,
    });

    const commandId = "cmd-p7-integrity";

    // 1ª execução com hash A
    await mutate({
      commandId,
      actorId: "actor-integrity",
      recordId,
      fieldKey: "titulo",
      fromRevision: 0,
      proposedValue: 1,
    });

    // 2ª execução com mesmo commandId mas payload divergente (proposedValue = 0)
    const badRes = await mutate({
      commandId,
      actorId: "actor-integrity",
      recordId,
      fieldKey: "titulo",
      fromRevision: 0,
      proposedValue: 0,
    });

    expect(badRes.ok).toBe(false);
    expect(badRes.status).toBe("INTEGRITY_ERROR");
  });

  // ==========================================================================
  // CASO A16: CAS nulo e Rollback Atômico Forçado em D1 Real Isolado
  // ==========================================================================
  describe("A16 — CAS nulo e rollback atômico forçado em D1 real isolado", () => {
    it("A16.1: Subconsulta escalar retorna NULL quando UPDATE afeta 0 linhas, disparando NOT NULL constraint failed: sync_events.to_revision", async () => {
      const ra = "RA-FICTICIO-A16-001";
      const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio A16", "FACE");
      const recordId = "rec-a16-001";

      await initRecord({
        recordId,
        integrationId: integrationFaceId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
      });

      // Avança a revisão para 1
      await mutate({
        commandId: "cmd-a16-vence",
        actorId: "actor-a16",
        recordId,
        fieldKey: "ensino_medio",
        fromRevision: 0,
        proposedValue: 1,
      });

      // Evidência ANTES da tentativa perdedora
      const snapshotBefore = {
        commands: await env.DB.prepare(
          `SELECT command_id, status FROM sync_commands WHERE record_id = ?`
        )
          .bind(recordId)
          .all<any>(),
        fieldState: await env.DB.prepare(
          `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .first<any>(),
        events: await env.DB.prepare(
          `SELECT event_id, to_revision FROM sync_events WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .all<any>(),
        operations: await env.DB.prepare(
          `SELECT operation_id, state FROM sync_operations WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .all<any>(),
        documentos: await env.DB.prepare(
          `SELECT ensino_medio FROM documentos WHERE aluno_id = ?`
        )
          .bind(alunoId)
          .first<any>(),
      };

      // Tentativa perdedora: propõe a partir de fromRevision = 0 quando o banco está na 1
      const res = await mutate({
        commandId: "cmd-a16-perde",
        actorId: "actor-a16",
        recordId,
        fieldKey: "ensino_medio",
        fromRevision: 0,
        proposedValue: 0,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");
      expect(res.error).toContain(
        "NOT NULL constraint failed: sync_events.to_revision"
      );

      // Evidência DEPOIS: Comprovação do ROLLBACK TOTAL de todos os statements anteriores do batch
      const snapshotAfter = {
        commands: await env.DB.prepare(
          `SELECT command_id, status FROM sync_commands WHERE record_id = ?`
        )
          .bind(recordId)
          .all<any>(),
        fieldState: await env.DB.prepare(
          `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .first<any>(),
        events: await env.DB.prepare(
          `SELECT event_id, to_revision FROM sync_events WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .all<any>(),
        operations: await env.DB.prepare(
          `SELECT operation_id, state FROM sync_operations WHERE record_id = ? AND field_key = 'ensino_medio'`
        )
          .bind(recordId)
          .all<any>(),
        documentos: await env.DB.prepare(
          `SELECT ensino_medio FROM documentos WHERE aluno_id = ?`
        )
          .bind(alunoId)
          .first<any>(),
      };

      // Os snapshots antes e depois são estritamente idênticos: ZERO vestígios do cmd-a16-perde
      expect(snapshotAfter.commands.results.length).toBe(
        snapshotBefore.commands.results.length
      );
      expect(
        snapshotAfter.commands.results.some(
          (c) => c.command_id === "cmd-a16-perde"
        )
      ).toBe(false);
      expect(snapshotAfter.fieldState.revision).toBe(1);
      expect(snapshotAfter.fieldState.head_command_id).toBe("cmd-a16-vence");
      expect(snapshotAfter.events.results.length).toBe(1);
      expect(snapshotAfter.operations.results.length).toBe(1);
      expect(snapshotAfter.documentos.ensino_medio).toBe(1);
    });

    it("A16.2: Violação de UNIQUE (record_id, field_key, to_revision) aborta e reverte o lote", async () => {
      const ra = "RA-FICTICIO-A16-002";
      const alunoId = await criarAlunoFicticio(ra, "Aluno Ficticio A16-2", "FACE");
      const recordId = "rec-a16-002";

      await initRecord({
        recordId,
        integrationId: integrationFaceId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
      });

      // Cria primeiro evento legítimo com to_revision = 1
      await mutate({
        commandId: "cmd-a16-2-ok",
        actorId: "actor",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
      });

      // Tenta forçar inserção de segundo evento com a mesma to_revision = 1
      const stmts: D1PreparedStatement[] = [
        env.DB.prepare(
          `INSERT INTO sync_commands (command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status)
           VALUES ('cmd-duplicaterev', 'actor', ?, 'identidade', 0, 1, 'hash-dup', 'ACCEPTED')`
        ).bind(recordId),
        env.DB.prepare(
          `INSERT INTO sync_events (event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id)
           VALUES ('evt-duplicaterev', ?, 'identidade', 'cmd-duplicaterev', 0, 1, 0, 1, 'actor')`
        ).bind(recordId),
      ];

      let erroDuplicata = "";
      try {
        await env.DB.batch(stmts);
      } catch (err: any) {
        erroDuplicata = err.message;
      }

      expect(erroDuplicata).toContain(
        "UNIQUE constraint failed: sync_events.record_id, sync_events.field_key, sync_events.to_revision"
      );

      // Comprova rollback total do batch
      const cmd = await env.DB.prepare(
        `SELECT COUNT(*) as c FROM sync_commands WHERE command_id = 'cmd-duplicaterev'`
      ).first<any>();
      expect(cmd.c).toBe(0);
    });
  });

  // ==========================================================================
  // CASO A29: Quatro Variações de Unicidade Ativa, Histórico e Isolamento Inter-Grupos
  // ==========================================================================
  describe("A29 — Isolamento, Unicidade Ativa e Histórico Inter-Grupos", () => {
    // Variação 1: Duas gerações ativas no mesmo grupo rejeitadas
    it("A29.1: Duas gerações ativas no mesmo grupo são deterministamente rejeitadas pelo índice parcial", async () => {
      const ra = "RA-FICTICIO-A29-DUP";
      const recordId1 = "rec-a29-gen1";
      const recordId2 = "rec-a29-gen2";

      // Geração 1 inserida como ACTIVE
      await env.DB.prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, 'FACE_FEA', 1, 'ACTIVE')`
      )
        .bind(recordId1, integrationFaceId, ra)
        .run();

      // Tentativa de inserir Geração 2 para o mesmo RA e mesmo grupo também como ACTIVE
      let erroIndiceParcial = "";
      try {
        await env.DB.prepare(
          `INSERT INTO sync_records (
            record_id, integration_id, ra_text, group_key, generation, lifecycle
          ) VALUES (?, ?, ?, 'FACE_FEA', 2, 'ACTIVE')`
        )
          .bind(recordId2, integrationFaceId, ra)
          .run();
      } catch (err: any) {
        erroIndiceParcial = err.message;
      }

      expect(erroIndiceParcial).toContain("UNIQUE constraint failed");
      expect(erroIndiceParcial).toContain(
        "sync_records.integration_id, sync_records.group_key, sync_records.ra_text"
      );

      // Comprova que somente a Geração 1 permanece ativa
      const activeRecords = await env.DB.prepare(
        `SELECT record_id, generation FROM sync_records WHERE integration_id = ? AND group_key = 'FACE_FEA' AND ra_text = ? AND lifecycle = 'ACTIVE'`
      )
        .bind(integrationFaceId, ra)
        .all<any>();

      expect(activeRecords.results.length).toBe(1);
      expect(activeRecords.results[0].record_id).toBe(recordId1);
    });

    // Variação 2: Histórico de gerações preservado (INACTIVE anterior + ACTIVE nova)
    it("A29.2: Geração anterior INATIVA permite nova geração ATIVA, preservando histórico", async () => {
      const ra = "RA-FICTICIO-A29-HIST";
      const recordIdGen1 = "rec-a29-hist-gen1";
      const recordIdGen2 = "rec-a29-hist-gen2";

      // 1. Geração 1 nasce ACTIVE
      await env.DB.prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, 'FACE_FEA', 1, 'ACTIVE')`
      )
        .bind(recordIdGen1, integrationFaceId, ra)
        .run();

      // 2. Transição de ciclo de vida: Geração 1 passa a INACTIVE
      await env.DB.prepare(
        `UPDATE sync_records SET lifecycle = 'INACTIVE' WHERE record_id = ?`
      )
        .bind(recordIdGen1)
        .run();

      // 3. Geração 2 é inserida como ACTIVE
      await env.DB.prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, 'FACE_FEA', 2, 'ACTIVE')`
      )
        .bind(recordIdGen2, integrationFaceId, ra)
        .run();

      // Comprovação: ambas as linhas existem no banco (histórico preservado)
      const allGens = await env.DB.prepare(
        `SELECT generation, lifecycle FROM sync_records WHERE integration_id = ? AND group_key = 'FACE_FEA' AND ra_text = ? ORDER BY generation`
      )
        .bind(integrationFaceId, ra)
        .all<any>();

      expect(allGens.results.length).toBe(2);
      expect(allGens.results[0].generation).toBe(1);
      expect(allGens.results[0].lifecycle).toBe("INACTIVE");
      expect(allGens.results[1].generation).toBe(2);
      expect(allGens.results[1].lifecycle).toBe("ACTIVE");

      // Mas o índice parcial garante exatamente 1 registro ATIVO
      const activeGen = await env.DB.prepare(
        `SELECT record_id, generation FROM sync_records WHERE integration_id = ? AND group_key = 'FACE_FEA' AND ra_text = ? AND lifecycle = 'ACTIVE'`
      )
        .bind(integrationFaceId, ra)
        .all<any>();
      expect(activeGen.results.length).toBe(1);
      expect(activeGen.results[0].record_id).toBe(recordIdGen2);
    });

    // Variação 3: Mesmo RA em FACE FEA e FCH EAD permitido com identidades independentes
    it("A29.3: Mesmo RA em FACE FEA e FCH EAD coexiste com identidades e outbox 100% isoladas", async () => {
      const raCompartilhado = "RA-FICTICIO-COMPARTILHADO";
      const recordIdFace = "rec-face-comp";
      const recordIdFch = "rec-fch-comp";

      // Cria aluno compartilhado com documentos para projeção atômica
      const alunoId = await criarAlunoFicticio(raCompartilhado, "Aluno Compartilhado", "FACE");

      // 1. Cria registro em FACE FEA com integrationFaceId
      await initRecord({
        recordId: recordIdFace,
        integrationId: integrationFaceId,
        raText: raCompartilhado,
        groupKey: "FACE_FEA",
        alunoId,
      });

      // 2. Cria mesmo RA em FCH EAD com o MESMO integrationId (integrationFaceId)
      await initRecord({
        recordId: recordIdFch,
        integrationId: integrationFaceId, // MESMO integration_id!
        raText: raCompartilhado,
        groupKey: "FCH_EAD",
        alunoId,
      });

      // Comprova que ambos coexistem como ACTIVE dentro do mesmo integration_id
      const activeRecords = await env.DB.prepare(
        `SELECT record_id, integration_id, group_key, lifecycle FROM sync_records WHERE ra_text = ? AND lifecycle = 'ACTIVE' ORDER BY group_key`
      )
        .bind(raCompartilhado)
        .all<any>();

      expect(activeRecords.results.length).toBe(2);
      expect(activeRecords.results[0].group_key).toBe("FACE_FEA");
      expect(activeRecords.results[0].record_id).toBe(recordIdFace);
      expect(activeRecords.results[0].integration_id).toBe(integrationFaceId);
      expect(activeRecords.results[1].group_key).toBe("FCH_EAD");
      expect(activeRecords.results[1].record_id).toBe(recordIdFch);
      expect(activeRecords.results[1].integration_id).toBe(integrationFaceId);

      // 3. Mutações simultâneas concorrentes: Ensino Médio no FACE FEA e Contrato no FCH EAD
      const [resFace, resFch] = await Promise.all([
        mutate({
          commandId: "cmd-face-comp-01",
          actorId: "actor-face",
          recordId: recordIdFace,
          fieldKey: "ensino_medio",
          fromRevision: 0,
          proposedValue: 1,
          groupKey: "FACE_FEA",
        }),
        mutate({
          commandId: "cmd-fch-comp-01",
          actorId: "actor-fch",
          recordId: recordIdFch,
          fieldKey: "contrato",
          fromRevision: 0,
          proposedValue: 1,
          groupKey: "FCH_EAD",
        }),
      ]);

      expect(resFace.ok).toBe(true);
      expect(resFch.ok).toBe(true);

      // Comprova isolamento estrito de revisões e campos
      const fieldFace = await env.DB.prepare(
        `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'ensino_medio'`
      )
        .bind(recordIdFace)
        .first<any>();
      expect(fieldFace.value).toBe(1);
      expect(fieldFace.revision).toBe(1);

      // O campo contrato em FACE FEA permanece 0
      const fieldFaceContrato = await env.DB.prepare(
        `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'contrato'`
      )
        .bind(recordIdFace)
        .first<any>();
      expect(fieldFaceContrato.value).toBe(0);
      expect(fieldFaceContrato.revision).toBe(0);

      // E no FCH EAD, contrato está 1 e ensino_medio está 0
      const fieldFchContrato = await env.DB.prepare(
        `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'contrato'`
      )
        .bind(recordIdFch)
        .first<any>();
      expect(fieldFchContrato.value).toBe(1);
      expect(fieldFchContrato.revision).toBe(1);

      const fieldFchEnsino = await env.DB.prepare(
        `SELECT value, revision FROM sync_field_state WHERE record_id = ? AND field_key = 'ensino_medio'`
      )
        .bind(recordIdFch)
        .first<any>();
      expect(fieldFchEnsino.value).toBe(0);
      expect(fieldFchEnsino.revision).toBe(0);

      // Comprova separação de eventos
      if (resFace.ok && resFch.ok) {
        expect(resFace.eventId).not.toBe(resFch.eventId);

        // Comprova outbox isolada: FACE FEA tem 1 op (CONTROLE); FCH EAD tem 2 ops (CONTROLE e GERAL_CONTRATO)
        const opsFace = await env.DB.prepare(
          `SELECT target_key FROM sync_operations WHERE event_id = ?`
        )
          .bind(resFace.eventId)
          .all<any>();
        expect(opsFace.results.length).toBe(1);
        expect(opsFace.results[0].target_key).toBe("CONTROLE");

        const opsFch = await env.DB.prepare(
          `SELECT target_key FROM sync_operations WHERE event_id = ? ORDER BY target_key`
        )
          .bind(resFch.eventId)
          .all<any>();
        expect(opsFch.results.length).toBe(2);
        expect(opsFch.results[0].target_key).toBe("CONTROLE");
        expect(opsFch.results[1].target_key).toBe("GERAL_CONTRATO");
      }
    });

    // Variação 4: Corrida concorrente de ativação duplicada
    it("A29.4: Tentativas concorrentes de ativação duplicada: exatamente uma vence e uma falha", async () => {
      const raConcorrente = "RA-FICTICIO-A29-RACE";
      const recA = "rec-a29-race-a";
      const recB = "rec-a29-race-b";

      // Dispara simultaneamente duas inserções com status ACTIVE
      const tA = env.DB.prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, 'FACE_FEA', 1, 'ACTIVE')`
      )
        .bind(recA, integrationFaceId, raConcorrente)
        .run();

      const tB = env.DB.prepare(
        `INSERT INTO sync_records (
          record_id, integration_id, ra_text, group_key, generation, lifecycle
        ) VALUES (?, ?, ?, 'FACE_FEA', 2, 'ACTIVE')`
      )
        .bind(recB, integrationFaceId, raConcorrente)
        .run();

      const results = await Promise.allSettled([tA, tB]);

      const aprovados = results.filter((r) => r.status === "fulfilled");
      const rejeitados = results.filter((r) => r.status === "rejected");

      expect(aprovados.length).toBe(1);
      expect(rejeitados.length).toBe(1);

      // Rejeição foi por violação de constraint
      const erro = (rejeitados[0] as PromiseRejectedResult).reason;
      expect(String(erro?.message ?? erro)).toContain("UNIQUE constraint failed");

      // Exatamente um registro ativo no banco
      const countAtivos = await env.DB.prepare(
        `SELECT COUNT(*) as c FROM sync_records WHERE integration_id = ? AND group_key = 'FACE_FEA' AND ra_text = ? AND lifecycle = 'ACTIVE'`
      )
        .bind(integrationFaceId, raConcorrente)
        .first<any>();
      expect(countAtivos.c).toBe(1);
    });
  });
});
