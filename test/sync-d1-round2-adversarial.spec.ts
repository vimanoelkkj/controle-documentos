import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeCanonicalCommandHash,
  computeCanonicalBaselineHash,
  establishFieldBaseline,
  executeFieldMutation,
  initSyncRecord,
  type FieldKey,
  type BaselineEvidence,
} from "../src/server/services/sync-d1-core";
import { registerServerTrustedAdapter } from "../src/server/services/sync-d1-auth";

describe("Segunda Rodada de Auditoria Adversarial (B1 - B5: Proxy Interception, Baseline & Strict Epoch)", () => {
  const periodoId = 9992;
  const integrationId = "int-round2-001";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status) VALUES (?, '2026-2-ROUND2', 'ATIVO')`
    )
      .bind(periodoId)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_integrations (
        integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
      ) VALUES (?, ?, 'planilha-round2', 1, 1, 'SHADOW')`
    )
      .bind(integrationId, periodoId)
      .run();

    // Registro confiável no servidor para fixtures fictícias do teste (C5)
    registerServerTrustedAdapter({
      adapterId: "fake-adapter",
      integrationId,
      periodoId,
      spreadsheetId: "planilha-ficticia-b4",
      allowedGroups: ["FACE_FEA", "FCH_EAD"],
      status: "ACTIVE",
      secret: "trusted-secret-b4",
    });
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

  // Wrapper / Proxy para D1Database: intercepta o método batch() exatamente APÓS o preflight
  function createRaceInterceptor(db: D1Database, onBeforeBatch: () => Promise<void>): D1Database {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            await onBeforeBatch();
            return target.batch(statements);
          };
        }
        const val = Reflect.get(target, prop, receiver);
        if (typeof val === "function") {
          return val.bind(target);
        }
        return val;
      },
    });
  }

  async function createEvidence(
    source: "SPREADSHEET_IMPORT" | "MANUAL_INITIALIZATION" | "LEGACY_MIGRATION",
    payload: string
  ): Promise<BaselineEvidence> {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { source, evidencePayload: payload, evidenceHash: hash };
  }

  // ==========================================================================
  // B1 — Corrida na Convergência e Semântica de head_command_id
  // ==========================================================================
  describe("B1 — Corrida na convergência e preservação de head_command_id", () => {
    it("B1.1: Intercalação real via Proxy: corrida entre preflight de convergência e batch aborta transação e preserva head_command_id", async () => {
      const ra = "RA-B1-RACE-PROXY";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B1 Race Proxy");
      const recordId = "rec-b1-race-proxy";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 1 },
      });

      // Estado inicial comprovado: valor = 1, revision = 0
      const initialField = await env.DB.prepare(
        `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      ).bind(recordId).first<any>();
      expect(initialField.value).toBe(1);
      expect(initialField.revision).toBe(0);

      // Criamos o banco interceptado via Proxy para pausar entre o preflight e o batch
      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        // Mutação concorrente B executa no banco real: altera de 1 para 0 (revision vai para 1)
        const resB = await executeFieldMutation(env.DB, {
          commandId: "cmd-b1-winning-mutation-b",
          actorId: "actor-b",
          recordId,
          fieldKey: "identidade",
          fromRevision: 0,
          proposedValue: 0,
          integrationId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
        });
        expect(resB.ok).toBe(true);
        expect(resB.status).toBe("COMMITTED");
      });

      // Requisição A observou preflight válido (valor 1, revision 0), mas tenta gravar CONVERGED durante a corrida:
      const resA = await executeFieldMutation(proxiedDb, {
        commandId: "cmd-b1-stale-convergence-a",
        actorId: "actor-a",
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

      expect(corridaOcorreu).toBe(true);
      expect(resA.ok).toBe(false);
      expect(resA.status).toBe("CAS_CONFLICT");

      // Comprovação de Snapshot: Nenhum comando ou recibo de convergência órfão gravado
      const cmdA = await env.DB.prepare(
        `SELECT * FROM sync_commands WHERE command_id = 'cmd-b1-stale-convergence-a'`
      ).first<any>();
      expect(cmdA).toBeNull();

      const receiptA = await env.DB.prepare(
        `SELECT * FROM sync_receipts WHERE command_id = 'cmd-b1-stale-convergence-a'`
      ).first<any>();
      expect(receiptA).toBeNull();

      // head_command_id pertence à mutação vencedora B e NÃO foi sobrescrito pela convergência falha
      const finalField = await env.DB.prepare(
        `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      ).bind(recordId).first<any>();
      expect(finalField.value).toBe(0);
      expect(finalField.revision).toBe(1);
      expect(finalField.head_command_id).toBe("cmd-b1-winning-mutation-b");
    });

    it("B1.2: Convergência bem-sucedida valida batch atomicamente, preserva head_command_id e emite recibo com status CONVERGED", async () => {
      const ra = "RA-B1-CONV-SUCCESS";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B1 Success");
      const recordId = "rec-b1-conv-success";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      // Mutação que realmente alterou o campo para 1
      const resMut = await executeFieldMutation(env.DB, {
        commandId: "cmd-b1-real-mutation",
        actorId: "actor-mut",
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
      expect(resMut.ok).toBe(true);

      const fieldBeforeConv = await env.DB.prepare(
        `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      ).bind(recordId).first<any>();
      expect(fieldBeforeConv.head_command_id).toBe("cmd-b1-real-mutation");

      // Executa convergência legítima (propõe valor 1 sobre revision 1)
      const resConv = await executeFieldMutation(env.DB, {
        commandId: "cmd-b1-legit-converged",
        actorId: "actor-conv",
        recordId,
        fieldKey: "identidade",
        fromRevision: 1,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      expect(resConv.ok).toBe(true);
      expect(resConv.status).toBe("CONVERGED");

      // Recibo gravado com status CONVERGED
      const receipt = await env.DB.prepare(
        `SELECT status, revision FROM sync_receipts WHERE command_id = 'cmd-b1-legit-converged'`
      ).first<any>();
      expect(receipt.status).toBe("CONVERGED");
      expect(receipt.revision).toBe(1);

      // SEMÂNTICA FORMAL: head_command_id NÃO foi alterado para cmd-b1-legit-converged!
      const fieldAfterConv = await env.DB.prepare(
        `SELECT value, revision, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'identidade'`
      ).bind(recordId).first<any>();
      expect(fieldAfterConv.head_command_id).toBe("cmd-b1-real-mutation");
    });

    it("B1.3: Idempotência de convergência sob requisições simultâneas com mesmo command ID", async () => {
      const ra = "RA-B1-IDEM-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B1 Idem");
      const recordId = "rec-b1-idem-001";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { titulo: 1 },
      });

      const mutationInput = {
        commandId: "cmd-b1-concurrent-conv-same-id",
        actorId: "actor-concurrent",
        recordId,
        fieldKey: "titulo" as FieldKey,
        fromRevision: 0,
        proposedValue: 1 as const,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA" as const,
        generation: 1,
        expectedEpoch: 1,
      };

      const [res1, res2] = await Promise.all([
        executeFieldMutation(env.DB, mutationInput),
        executeFieldMutation(env.DB, mutationInput),
      ]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain("CONVERGED");
      expect(statuses).toContain("IDEMPOTENT_REPLAY");
    });
  });

  // ==========================================================================
  // B2 — Prevenção Transacional de TOCTOU com Intercalação Real (Proxy D1)
  // ==========================================================================
  describe("B2 — Prevenção transacional de TOCTOU com intercalação real via Proxy", () => {
    it("B2.1: Invalidação de lifecycle para INACTIVE entre preflight e commit aborta o lote via subconsulta", async () => {
      const ra = "RA-B2-TOCTOU-INACT-PROXY";
      const alunoId = await criarAlunoComDocs(ra, "Aluno TOCTOU Inact Proxy");
      const recordId = "rec-b2-toctou-inact-proxy";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        // Inativação concorrente executada exatamente entre preflight e commit!
        await env.DB.prepare(`UPDATE sync_records SET lifecycle = 'INACTIVE' WHERE record_id = ?`)
          .bind(recordId)
          .run();
      });

      const res = await executeFieldMutation(proxiedDb, {
        commandId: "cmd-b2-toctou-inact-proxy",
        actorId: "actor-toctou",
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

      expect(corridaOcorreu).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");

      // Snapshot comprova zero efeitos colaterais
      const cmd = await env.DB.prepare(`SELECT * FROM sync_commands WHERE command_id = 'cmd-b2-toctou-inact-proxy'`).first<any>();
      expect(cmd).toBeNull();

      const evt = await env.DB.prepare(`SELECT * FROM sync_events WHERE record_id = ?`).bind(recordId).first<any>();
      expect(evt).toBeNull();
    });

    it("B2.2: Ativação concorrente de nova geração entre preflight e commit aborta o lote", async () => {
      const ra = "RA-B2-TOCTOU-GEN-PROXY";
      const alunoId = await criarAlunoComDocs(ra, "Aluno TOCTOU Gen Proxy");
      const recordIdGen1 = "rec-b2-toctou-gen1-p";
      const recordIdGen2 = "rec-b2-toctou-gen2-p";

      await initSyncRecord(env.DB, {
        recordId: recordIdGen1,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        // Geração 1 passa para INACTIVE e Geração 2 é ativada no meio da transação
        await env.DB.prepare(`UPDATE sync_records SET lifecycle = 'INACTIVE' WHERE record_id = ?`).bind(recordIdGen1).run();
        await initSyncRecord(env.DB, {
          recordId: recordIdGen2,
          integrationId,
          raText: ra,
          groupKey: "FACE_FEA",
          alunoId,
          generation: 2,
          lifecycle: "ACTIVE",
          initialValues: { identidade: 0 },
        });
      });

      const res = await executeFieldMutation(proxiedDb, {
        commandId: "cmd-b2-toctou-gen1-p",
        actorId: "actor-toctou",
        recordId: recordIdGen1,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      expect(corridaOcorreu).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");
    });

    it("B2.3: Alteração de epoch concorrente na integração entre preflight e commit aborta o lote", async () => {
      const ra = "RA-B2-TOCTOU-EPOCH-PROXY";
      const alunoId = await criarAlunoComDocs(ra, "Aluno TOCTOU Epoch Proxy");
      const recordId = "rec-b2-toctou-epoch-p";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        // Integração tem epoch incrementado para 2 durante a corrida
        await env.DB.prepare(`UPDATE sync_integrations SET epoch = 2 WHERE integration_id = ?`).bind(integrationId).run();
      });

      const res = await executeFieldMutation(proxiedDb, {
        commandId: "cmd-b2-toctou-epoch-p",
        actorId: "actor-toctou",
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

      expect(corridaOcorreu).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");

      // Restaura epoch para 1
      await env.DB.prepare(`UPDATE sync_integrations SET epoch = 1 WHERE integration_id = ?`).bind(integrationId).run();
    });

    it("B2.4: Remoção concorrente do vínculo documental entre preflight e commit aborta o lote", async () => {
      const ra = "RA-B2-TOCTOU-DOC-PROXY";
      const alunoId = await criarAlunoComDocs(ra, "Aluno TOCTOU Doc Proxy");
      const recordId = "rec-b2-toctou-doc-p";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { certidao: 0 },
      });

      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        await env.DB.prepare(`DELETE FROM documentos WHERE aluno_id = ?`).bind(alunoId).run();
      });

      const res = await executeFieldMutation(proxiedDb, {
        commandId: "cmd-b2-toctou-doc-p",
        actorId: "actor-toctou",
        recordId,
        fieldKey: "certidao",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      expect(corridaOcorreu).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");
    });
  });

  // ==========================================================================
  // B3 — Identidade Explícita e Fencing Obrigatório de Epoch
  // ==========================================================================
  describe("B3 — Contrato de escopo explícito e fencing obrigatório de epoch", () => {
    it("B3.1: Rejeita quando expectedEpoch é omitido (sem fallback silencioso)", async () => {
      const ra = "RA-B3-EXP-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B3");
      const recordId = "rec-b3-001";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      const resIncompleto = await executeFieldMutation(env.DB, {
        commandId: "cmd-b3-incompleto",
        actorId: "actor-b3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        // expectedEpoch omitido!
      } as any);

      expect(resIncompleto.ok).toBe(false);
      expect(resIncompleto.status).toBe("INTEGRITY_ERROR");
      expect(resIncompleto.error).toContain("expectedEpoch");
    });

    it("B3.2: Rejeita quando expectedEpoch diverge da época atual da integração", async () => {
      const ra = "RA-B3-EXP-002";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B3 Epoch Mismatch");
      const recordId = "rec-b3-002";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
        initialValues: { identidade: 0 },
      });

      const resEpochMismatch = await executeFieldMutation(env.DB, {
        commandId: "cmd-b3-epoch-mismatch",
        actorId: "actor-b3",
        recordId,
        fieldKey: "identidade",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 999, // Época inválida
      });

      expect(resEpochMismatch.ok).toBe(false);
      expect(resEpochMismatch.status).toBe("INTEGRITY_ERROR");
      expect(resEpochMismatch.error).toContain("Epoch informada (999) diverge da integração");
    });
  });

  // ==========================================================================
  // B4 — UNBASELINED e establishFieldBaseline
  // ==========================================================================
  describe("B4 — UNBASELINED e establishFieldBaseline()", () => {
    it("B4.1: initSyncRecord sem valores cria campos como UNBASELINED (value = NULL, revision = 0)", async () => {
      const ra = "RA-B4-UNBASE-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Unbase");
      const recordId = "rec-b4-001";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const field = await env.DB.prepare(
        `SELECT value, revision, status, baseline_command_id, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`
      ).bind(recordId).first<any>();

      expect(field.value).toBeNull();
      expect(field.revision).toBe(0);
      expect(field.status).toBe("UNBASELINED");
      expect(field.baseline_command_id).toBeNull();
      expect(field.head_command_id).toBeNull();
    });

    it("B4.2: Mutação comum (executeFieldMutation) sobre campo UNBASELINED é terminantemente rejeitada", async () => {
      const ra = "RA-B4-REJECT-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Reject");
      const recordId = "rec-b4-002";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const resMut = await executeFieldMutation(env.DB, {
        commandId: "cmd-b4-illegal-mutation",
        actorId: "actor-b4",
        recordId,
        fieldKey: "titulo",
        fromRevision: 0,
        proposedValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      expect(resMut.ok).toBe(false);
      expect(resMut.status).toBe("INTEGRITY_ERROR");
      expect(resMut.error).toContain("está no estado UNBASELINED. Não é permitido aplicar mutação comum");
    });

    it("B4.3: establishFieldBaseline() transiciona UNBASELINED para CONFIRMED com evidência rastreável, registrando baseline_command_id e preservando head_command_id = NULL", async () => {
      const ra = "RA-B4-BASE-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Base");
      const recordId = "rec-b4-003";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const rawEvidence = {
        evidenceId: "evid-b4-test",
        sourceAdapterId: "fake-adapter",
        spreadsheetId: "planilha-ficticia-b4",
        tabName: "CONTROLE_FACE",
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        raText: ra,
        fieldKey: "titulo",
        cellCoordinate: "G42",
        rawValue: "ENTREGUE",
        normalizedValue: 1,
        headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
        readTimestamp: "2026-10-19T15:00:00Z",
      };

      const canonicalStr = [
        rawEvidence.evidenceId,
        rawEvidence.sourceAdapterId,
        rawEvidence.integrationId,
        rawEvidence.periodoId,
        rawEvidence.groupKey,
        rawEvidence.spreadsheetId,
        rawEvidence.tabName,
        rawEvidence.raText,
        rawEvidence.fieldKey,
        rawEvidence.cellCoordinate,
        rawEvidence.rawValue,
        rawEvidence.normalizedValue,
        rawEvidence.headerFingerprint,
        rawEvidence.readTimestamp,
      ].join("|");

      const enc = new TextEncoder();
      const contentHashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(canonicalStr));
      const contentHash = Array.from(new Uint8Array(contentHashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode("trusted-secret-b4"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(contentHash));
      const adapterSignature = Array.from(new Uint8Array(sigBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const evidence = await createEvidence(
        "SPREADSHEET_IMPORT",
        JSON.stringify({
          ...rawEvidence,
          contentHash,
          adapterSignature,
        })
      );

      const resBase = await establishFieldBaseline(env.DB, {
        commandId: "cmd-b4-legit-baseline",
        actorId: "actor-import",
        recordId,
        fieldKey: "titulo",
        baselineValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence,
      });

      expect(resBase.ok).toBe(true);
      expect(resBase.status).toBe("BASELINE_ESTABLISHED");
      expect(resBase.revision).toBe(0);

      // Comprova estado no sync_field_state
      const field = await env.DB.prepare(
        `SELECT value, revision, status, baseline_command_id, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`
      ).bind(recordId).first<any>();

      expect(field.value).toBe(1);
      expect(field.revision).toBe(0);
      expect(field.status).toBe("CONFIRMED");
      expect(field.baseline_command_id).toBe("cmd-b4-legit-baseline");
      expect(field.head_command_id).toBeNull(); // SEMÂNTICA FORMAL: head_command_id continua NULL

      // Comprova projeção em documentos
      const doc = await env.DB.prepare(`SELECT titulo FROM documentos WHERE aluno_id = ?`).bind(alunoId).first<any>();
      expect(doc.titulo).toBe(1);

      // Agora que está CONFIRMED, executeFieldMutation pode operar normalmente na revision 0 -> 1
      const resNextMut = await executeFieldMutation(env.DB, {
        commandId: "cmd-b4-post-baseline-mut",
        actorId: "actor-next",
        recordId,
        fieldKey: "titulo",
        fromRevision: 0,
        proposedValue: 0,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      expect(resNextMut.ok).toBe(true);
      expect(resNextMut.status).toBe("COMMITTED");
      expect(resNextMut.toRevision).toBe(1);

      const fieldAfterMut = await env.DB.prepare(
        `SELECT value, revision, baseline_command_id, head_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`
      ).bind(recordId).first<any>();
      expect(fieldAfterMut.baseline_command_id).toBe("cmd-b4-legit-baseline");
      expect(fieldAfterMut.head_command_id).toBe("cmd-b4-post-baseline-mut");
    });

    it("B4.4: Baseline repetido (idempotência) recupera recibo existente", async () => {
      const ra = "RA-B4-IDEM-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Idem");
      const recordId = "rec-b4-004";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const evidence = await createEvidence("MANUAL_INITIALIZATION", "seed-initial-proof-123");
      const input = {
        commandId: "cmd-b4-idem-base",
        actorId: "actor-import",
        recordId,
        fieldKey: "identidade" as FieldKey,
        baselineValue: 1 as const,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA" as const,
        generation: 1,
        expectedEpoch: 1,
        evidence,
      };

      const res1 = await establishFieldBaseline(env.DB, input);
      expect(res1.ok).toBe(true);
      expect(res1.status).toBe("BASELINE_ESTABLISHED");

      const res2 = await establishFieldBaseline(env.DB, input);
      expect(res2.ok).toBe(true);
      expect(res2.status).toBe("IDEMPOTENT_REPLAY");
      expect(res2.receiptId).toBe(res1.receiptId);
    });

    it("B4.5: Baseline divergente com mesmo commandId é rejeitado com INTEGRITY_ERROR", async () => {
      const ra = "RA-B4-DIV-001";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Div");
      const recordId = "rec-b4-005";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const evidence1 = await createEvidence("LEGACY_MIGRATION", "proof-v1");
      await establishFieldBaseline(env.DB, {
        commandId: "cmd-b4-divergent-base",
        actorId: "actor-import",
        recordId,
        fieldKey: "identidade",
        baselineValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: evidence1,
      });

      // 2ª execução com mesmo commandId mas baselineValue divergente (0)
      const evidence2 = await createEvidence("LEGACY_MIGRATION", "proof-v2");
      const badRes = await establishFieldBaseline(env.DB, {
        commandId: "cmd-b4-divergent-base",
        actorId: "actor-import",
        recordId,
        fieldKey: "identidade",
        baselineValue: 0,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: evidence2,
      });

      expect(badRes.ok).toBe(false);
      expect(badRes.status).toBe("INTEGRITY_ERROR");
    });

    it("B4.6: Evidência com hash falsificado, payload vazio ou fonte desconhecida é rejeitada", async () => {
      const ra = "RA-B4-BAD-EVID";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Bad Evid");
      const recordId = "rec-b4-006";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      // 1. Hash falsificado
      const badHashRes = await establishFieldBaseline(env.DB, {
        commandId: "cmd-bad-hash",
        actorId: "actor-import",
        recordId,
        fieldKey: "titulo",
        baselineValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: {
          source: "SPREADSHEET_IMPORT",
          evidencePayload: "real-payload",
          evidenceHash: "fake-sha256-hash-12345",
        },
      });

      expect(badHashRes.ok).toBe(false);
      expect(badHashRes.status).toBe("INVALID_EVIDENCE");
      expect(badHashRes.error).toContain("diverge do cálculo canônico");

      // 2. Fonte inválida
      const badSourceRes = await establishFieldBaseline(env.DB, {
        commandId: "cmd-bad-source",
        actorId: "actor-import",
        recordId,
        fieldKey: "titulo",
        baselineValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: {
          source: "UNKNOWN_SOURCE" as any,
          evidencePayload: "some-data",
          evidenceHash: "some-hash",
        },
      });

      expect(badSourceRes.ok).toBe(false);
      expect(badSourceRes.status).toBe("INVALID_EVIDENCE");
    });

    it("B4.7: TOCTOU em establishFieldBaseline via Proxy: inativação concorrente aborta o lote integralmente", async () => {
      const ra = "RA-B4-BASE-TOCTOU";
      const alunoId = await criarAlunoComDocs(ra, "Aluno B4 Base TOCTOU");
      const recordId = "rec-b4-007";

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey: "FACE_FEA",
        alunoId,
        generation: 1,
      });

      const evidence = await createEvidence("MANUAL_INITIALIZATION", "toctou-baseline-proof");

      let corridaOcorreu = false;
      const proxiedDb = createRaceInterceptor(env.DB, async () => {
        corridaOcorreu = true;
        // Inativação concorrente executada após preflight de baseline
        await env.DB.prepare(`UPDATE sync_records SET lifecycle = 'INACTIVE' WHERE record_id = ?`).bind(recordId).run();
      });

      const res = await establishFieldBaseline(proxiedDb, {
        commandId: "cmd-b4-toctou-baseline",
        actorId: "actor-import",
        recordId,
        fieldKey: "titulo",
        baselineValue: 1,
        integrationId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence,
      });

      expect(corridaOcorreu).toBe(true);
      expect(res.ok).toBe(false);
      expect(res.status).toBe("CAS_CONFLICT");

      // O campo permanece UNBASELINED com zero resíduos
      const field = await env.DB.prepare(
        `SELECT value, status, baseline_command_id FROM sync_field_state WHERE record_id = ? AND field_key = 'titulo'`
      ).bind(recordId).first<any>();
      expect(field.value).toBeNull();
      expect(field.status).toBe("UNBASELINED");
      expect(field.baseline_command_id).toBeNull();
    });
  });
});
