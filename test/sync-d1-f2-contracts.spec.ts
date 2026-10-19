import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  validateCanonicalRa,
  validateCanonicalIdentity,
  canonicalizeEnvelopeData,
  signEnvelopeData,
  verifyEnvelopeSignature,
  authenticateAndAuthorizeEnvelope,
  registerServerTrustedAdapter,
  type AuthIdentity,
  type AuthEnvelope,
} from "../src/server/services/sync-d1-auth";
import {
  CONTROL_DOC_COLUMNS,
  FIELD_TO_CONTROL_COLUMN_INDEX,
  CONTROL_COLUMN_LETTERS,
  EXPECTED_CONTROL_HEADERS,
  normalizeDocumentCellValue,
  normalizeContractCellValue,
  type ProvenanceEvidence,
} from "../src/server/services/sync-sheet-contracts";
import { FakeSpreadsheetAdapter } from "../src/server/services/sync-sheet-fake-adapter";
import {
  initSyncRecord,
  establishFieldBaseline,
  executeFieldMutation,
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
} from "../src/server/services/sync-d1-operations";

describe("F2: Identidade, Autenticação e Contratos dos Adaptadores (D1 ↔ Sheets)", () => {
  const periodoId = 6666;
  const integrationFaceId = "int-f2-face-001";
  const integrationFchId = "int-f2-fch-001";
  const spreadsheetFaceId = "sheet-f2-face-mock";
  const spreadsheetFchId = "sheet-f2-fch-mock";
  const secretKey = "super-secret-hmac-key-f2";

  // Identidades conhecidas no servidor (Registry Confiável do Servidor)
  const serverIdentities: Record<string, AuthIdentity> = {
    "worker:face_fea": {
      senderId: "worker:face_fea",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA"],
      allowedScopes: ["read:snapshot", "write:mutation", "baseline:establish", "verify:effect", "observe:receipt"],
      status: "ACTIVE",
      secret: secretKey,
    },
    "worker:fch_ead": {
      senderId: "worker:fch_ead",
      integrationId: integrationFchId,
      periodoId,
      allowedGroups: ["FCH_EAD"],
      allowedScopes: ["read:snapshot", "write:mutation", "baseline:establish", "verify:effect", "observe:receipt"],
      status: "ACTIVE",
      secret: secretKey,
    },
    "webhook:read_only": {
      senderId: "webhook:read_only",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA"],
      allowedScopes: ["read:snapshot"],
      status: "ACTIVE",
      secret: secretKey,
    },
    "worker:revoked": {
      senderId: "worker:revoked",
      integrationId: integrationFaceId,
      periodoId,
      allowedGroups: ["FACE_FEA"],
      allowedScopes: ["read:snapshot", "write:mutation"],
      status: "REVOKED",
      secret: secretKey,
    },
  };

  async function identityLookup(senderId: string) {
    return serverIdentities[senderId] || null;
  }

  beforeAll(async () => {
    // 1. Setup no D1 local isolado
    await env.DB.prepare(
      `INSERT OR IGNORE INTO periodos (id, codigo, status)
       VALUES (?, '2026-2-FICTICIO-F2', 'ATIVO')`
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

    // 2. Registro de adaptador confiável no servidor (C5)
    registerServerTrustedAdapter({
      adapterId: "fake-sheet-adapter-01",
      integrationId: integrationFaceId,
      periodoId,
      spreadsheetId: spreadsheetFaceId,
      allowedGroups: ["FACE_FEA"],
      status: "ACTIVE",
      secret: secretKey,
    });
  });

  // Helper para criar aluno fictício e registrar documentos legados
  async function criarAlunoFicticio(ra: string, nome: string) {
    const res = await env.DB.prepare(
      `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, 'CURSO TESTE F2', 'FACE', 'ATIVO')`
    )
      .bind(periodoId, ra, nome)
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

  // ==========================================================================
  // F2.1 — IDENTIDADE E AUTENTICAÇÃO
  // ==========================================================================
  describe("F2.1: Identidade, Autenticação e Autorização", () => {
    it("F2.1.1 — Deve preservar RA textual integralmente, inclusive múltiplos zeros à esquerda", () => {
      const raWithLeadingZeros = "00012345";
      const res = validateCanonicalRa(raWithLeadingZeros);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.raText).toBe("00012345");
        expect(res.raText.length).toBe(8);
      }
    });

    it("F2.1.2 — Deve rejeitar RA vazio, com espaços, nulo ou com caracteres não numéricos", () => {
      expect(validateCanonicalRa("").valid).toBe(false);
      expect(validateCanonicalRa("   ").valid).toBe(false);
      expect(validateCanonicalRa(null).valid).toBe(false);
      expect(validateCanonicalRa(undefined).valid).toBe(false);
      expect(validateCanonicalRa(12345 as any).valid).toBe(false); // Tipo number não permitido
      expect(validateCanonicalRa(" 00123 ").valid).toBe(false);   // Whitespace leading/trailing
      expect(validateCanonicalRa("RA-12345").valid).toBe(false);  // Letras ou traços
    });

    it("F2.1.3 — Validação canônica completa de identidade deve exigir todos os contratos estruturais", () => {
      const valid = validateCanonicalIdentity({
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        raText: "009876",
        generation: 1,
        expectedEpoch: 1,
      });
      expect(valid.valid).toBe(true);
      if (valid.valid) {
        expect(valid.canonical.raText).toBe("009876");
        expect(valid.canonical.periodoId).toBe(periodoId);
      }

      // Invalidação por geração <= 0
      const genInvalid = validateCanonicalIdentity({
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        raText: "009876",
        generation: 0,
        expectedEpoch: 1,
      });
      expect(genInvalid.valid).toBe(false);

      // Invalidação por grupo inexistente
      const groupInvalid = validateCanonicalIdentity({
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "OUTRO_GRUPO" as any,
        raText: "009876",
        generation: 1,
        expectedEpoch: 1,
      });
      expect(groupInvalid.valid).toBe(false);
    });

    it("F2.1.4 — Condição 1: Privilégios resolvidos no servidor impedem privilégio autodeclarado pelo chamador", async () => {
      const nowMs = Date.now();
      const nonce = crypto.randomUUID();
      const envelopeData = {
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA" as GroupKey,
        expectedEpoch: 1,
        senderId: "webhook:read_only", // Remetente possui apenas 'read:snapshot' no servidor
        timestamp: nowMs,
        nonce,
        payload: { doc: "rg" },
      };

      const canonicalStr = canonicalizeEnvelopeData(envelopeData);
      const signature = await signEnvelopeData(canonicalStr, secretKey);

      const envelope: AuthEnvelope = {
        ...envelopeData,
        signature,
      };

      // Tenta executar operação que exige 'write:mutation'
      const authRes = await authenticateAndAuthorizeEnvelope(
        env.DB,
        envelope,
        "write:mutation",
        identityLookup,
        { nowMs }
      );

      expect(authRes.valid).toBe(false);
      if (!authRes.valid) {
        expect(authRes.error).toBe("SCOPE_UNAUTHORIZED");
        expect(authRes.details).toContain("lacks required server-resolved scope");
      }
    });

    it("F2.1.5 — Condição 1: Replay concorrente ou duplicado de nonce é bloqueado atomicamente", async () => {
      const nowMs = Date.now();
      const nonce = `nonce-replay-${crypto.randomUUID()}`;
      const envelopeData = {
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA" as GroupKey,
        expectedEpoch: 1,
        senderId: "worker:face_fea",
        timestamp: nowMs,
        nonce,
        payload: { command: "test" },
      };

      const canonicalStr = canonicalizeEnvelopeData(envelopeData);
      const signature = await signEnvelopeData(canonicalStr, secretKey);
      const envelope: AuthEnvelope = { ...envelopeData, signature };

      // Primeira execução: sucesso
      const firstRes = await authenticateAndAuthorizeEnvelope(
        env.DB,
        envelope,
        "write:mutation",
        identityLookup,
        { nowMs }
      );
      expect(firstRes.valid).toBe(true);

      // Segunda execução com mesmo nonce: REPLAY_ATTEMPT_DETECTED
      const replayRes = await authenticateAndAuthorizeEnvelope(
        env.DB,
        envelope,
        "write:mutation",
        identityLookup,
        { nowMs }
      );
      expect(replayRes.valid).toBe(false);
      if (!replayRes.valid) {
        expect(replayRes.error).toBe("REPLAY_ATTEMPT_DETECTED");
      }
    });

    it("F2.1.6 — Rejeição de remetente revogado ou assinatura adulterada", async () => {
      const nowMs = Date.now();
      const nonce = crypto.randomUUID();
      const envelopeData = {
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA" as GroupKey,
        expectedEpoch: 1,
        senderId: "worker:revoked", // Revogado no servidor
        timestamp: nowMs,
        nonce,
        payload: { test: true },
      };
      const canonicalStr = canonicalizeEnvelopeData(envelopeData);
      const signature = await signEnvelopeData(canonicalStr, secretKey);
      const envelope: AuthEnvelope = { ...envelopeData, signature };

      const res = await authenticateAndAuthorizeEnvelope(
        env.DB,
        envelope,
        "read:snapshot",
        identityLookup,
        { nowMs }
      );
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toBe("IDENTITY_REVOKED");
      }

      // Adulteração de assinatura
      const tamperedEnvelope: AuthEnvelope = {
        ...envelopeData,
        senderId: "worker:face_fea",
        signature: "0000000000000000000000000000000000000000000000000000000000000000",
      };
      const tamperRes = await authenticateAndAuthorizeEnvelope(
        env.DB,
        tamperedEnvelope,
        "write:mutation",
        identityLookup,
        { nowMs }
      );
      expect(tamperRes.valid).toBe(false);
      if (!tamperRes.valid) {
        expect(tamperRes.error).toBe("INVALID_SIGNATURE");
      }
    });

    it("F2.1.7 — Isolamento de grupos: worker FACE_FEA não pode emitir requisição para FCH_EAD", async () => {
      const nowMs = Date.now();
      const nonce = crypto.randomUUID();
      const envelopeData = {
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FCH_EAD" as GroupKey, // Incompatível com a autorização de worker:face_fea
        expectedEpoch: 1,
        senderId: "worker:face_fea",
        timestamp: nowMs,
        nonce,
        payload: { action: "cross-group" },
      };
      const canonicalStr = canonicalizeEnvelopeData(envelopeData);
      const signature = await signEnvelopeData(canonicalStr, secretKey);
      const envelope: AuthEnvelope = { ...envelopeData, signature };

      const res = await authenticateAndAuthorizeEnvelope(
        env.DB,
        envelope,
        "write:mutation",
        identityLookup,
        { nowMs }
      );
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toBe("GROUP_UNAUTHORIZED");
      }
    });
  });

  // ==========================================================================
  // F2.2 & F2.3 — ADAPTADOR DE PLANILHA SIMULADO DETERMINÍSTICO
  // ==========================================================================
  describe("F2.2 & F2.3: Contratos e Adaptador Simulado de Planilha", () => {
    let adapter: FakeSpreadsheetAdapter;

    beforeAll(() => {
      adapter = new FakeSpreadsheetAdapter("fake-sheet-adapter-01");
    });

    it("F2.2.1 — Leitura de aba de controle C:I valida cabeçalhos exatos e extrai RAs com zeros", async () => {
      adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
        {
          raText: "001234",
          studentName: "Aluno Zeros",
          fields: {
            identidade: "ENTREGUE",
            cpf_documento: "SIM",
            certidao: "PENDENTE",
            residencia: "NÃO",
            titulo: "1",
            ensino_medio: "0",
            contrato: "OK",
          },
        },
        {
          raText: "005678",
          studentName: "Aluno Dois",
          fields: {
            identidade: "SIM",
            cpf_documento: "SIM",
            certidao: "SIM",
            residencia: "SIM",
            titulo: "SIM",
            ensino_medio: "SIM",
            contrato: "SIM",
          },
        },
      ]);

      const readRes = await adapter.readControlTab({
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        groupKey: "FACE_FEA",
      });

      expect(readRes.rowsByRa.size).toBe(2);
      const row1 = readRes.rowsByRa.get("001234");
      expect(row1).toBeDefined();
      expect(row1?.raText).toBe("001234");
      expect(row1?.fields.identidade.normalizedValue).toBe(1);
      expect(row1?.fields.cpf_documento.normalizedValue).toBe(1);
      expect(row1?.fields.certidao.normalizedValue).toBe(0);
      expect(row1?.fields.residencia.normalizedValue).toBe(0);
      expect(row1?.fields.titulo.normalizedValue).toBe(1);
      expect(row1?.fields.ensino_medio.normalizedValue).toBe(0);
      expect(row1?.fields.contrato.normalizedValue).toBe(1);
      expect(row1?.fields.identidade.cellCoordinate).toBe("C2");
      expect(row1?.fields.contrato.cellCoordinate).toBe("I2");
    });

    it("F2.2.2 — Detecção de alteração estrutural no layout da planilha (STRUCTURAL_LAYOUT_MUTATED)", async () => {
      // Cria aba de controle com cabeçalho adulterado (inserção de coluna ou renomeação)
      const corruptedHeaders = [
        "NUM",
        "ALUNO_RA",
        "IDENTIDADE",
        "CPF",
        "COLUNA_INTRUSA", // Layout quebrado na coluna E!
        "CERTIDÃO",
        "COMP. RESIDÊNCIA",
        "TÍTULO",
        "ENSINO MÉDIO",
      ];

      adapter.loadControlTab(
        spreadsheetFaceId,
        "ABA_CORROMPIDA",
        [{ raText: "009999", fields: { identidade: "SIM" } }],
        corruptedHeaders
      );

      await expect(
        adapter.readControlTab({
          spreadsheetId: spreadsheetFaceId,
          tabName: "ABA_CORROMPIDA",
          groupKey: "FACE_FEA",
        })
      ).rejects.toThrow("STRUCTURAL_LAYOUT_MUTATED");
    });

    it("F2.2.3 — Leitura de aba geral exclusivamente pela coluna A (Situação Contratual) via RA coluna G", async () => {
      adapter.loadGeneralTab(spreadsheetFaceId, "ABA_GERAL_CONTRATOS", [
        {
          raText: "001234",
          contractStatus: "ACEITO",
        },
        {
          raText: "005678",
          contractStatus: "PENDENTE",
        },
        {
          raText: "009999",
          contractStatus: "Texto Desconhecido Não Mapeável",
        },
      ]);

      const generalRes = await adapter.readGeneralTabContracts({
        spreadsheetId: spreadsheetFaceId,
        tabName: "ABA_GERAL_CONTRATOS",
      });

      expect(generalRes.rowsByRa.size).toBe(3);
      expect(generalRes.rowsByRa.get("001234")?.contractNormalizedValue).toBe(1);
      expect(generalRes.rowsByRa.get("001234")?.cellCoordinate).toBe("A2");
      expect(generalRes.rowsByRa.get("005678")?.contractNormalizedValue).toBe(0);
      expect(generalRes.rowsByRa.get("009999")?.contractNormalizedValue).toBe(null); // Desconhecido preservado
    });

    it("F2.2.4 — Condição 3: Bloqueio estrito de escrita fora dos limites (OUT_OF_BOUNDS)", async () => {
      // Tentativa de gravar na aba geral com campo diferente de 'contrato' deve ser sumariamente bloqueada
      const outOfBoundsRes = await adapter.writeDocumentField({
        spreadsheetId: spreadsheetFaceId,
        tabName: "ABA_GERAL_CONTRATOS",
        groupKey: "FACE_FEA",
        raText: "001234",
        fieldKey: "identidade", // Campo inválido para ABA_GERAL!
        preconditions: {
          targetKey: "GERAL_CONTRATO",
          expectedCurrentValue: 0,
          targetValue: 1,
          targetRevision: 1,
          operationId: "op-test-oob",
        },
      });

      expect(outOfBoundsRes.success).toBe(false);
      expect(outOfBoundsRes.status).toBe("OUT_OF_BOUNDS");
      expect(outOfBoundsRes.error).toContain("strictly allowed only for field 'contrato'");
    });

    it("F2.2.5 — Condição 3: Preservação de edições humanas (CONFLICT_DETECTED quando precondição diverge)", async () => {
      // Aba com RA 001234 contendo 'ENTREGUE' (norm: 1)
      // Um worker tenta gravar supondo que a planilha está em '0' (desatualizada ou editada por humano)
      const conflictRes = await adapter.writeDocumentField({
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        groupKey: "FACE_FEA",
        raText: "001234",
        fieldKey: "identidade",
        preconditions: {
          targetKey: "CONTROLE",
          expectedCurrentValue: 0, // Esperava 0, mas humano já marcou como 1!
          targetValue: 1,
          targetRevision: 2,
          operationId: "op-test-conflict",
          allowHumanOverwrite: false,
        },
      });

      expect(conflictRes.success).toBe(false);
      expect(conflictRes.status).toBe("CONFLICT_DETECTED");
      expect(conflictRes.observedValue).toBe("ENTREGUE");
      expect(conflictRes.error).toContain("Human or external modification detected");
    });

    it("F2.2.6 — Escrita legítima respeitando precondição e confirmação no grid", async () => {
      // Aba com RA 001234 certidao = 'PENDENTE' (norm: 0)
      const commitRes = await adapter.writeDocumentField({
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        groupKey: "FACE_FEA",
        raText: "001234",
        fieldKey: "certidao",
        preconditions: {
          targetKey: "CONTROLE",
          expectedCurrentValue: 0,
          targetValue: 1,
          targetRevision: 1,
          operationId: "op-commit-ok",
        },
      });

      expect(commitRes.success).toBe(true);
      expect(commitRes.status).toBe("COMMITTED");
      expect(commitRes.cellCoordinate).toBe("E2");

      // Verificação de efeito externo
      const effectRes = await adapter.verifyExternalEffect({
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        groupKey: "FACE_FEA",
        raText: "001234",
        fieldKey: "certidao",
        targetKey: "CONTROLE",
        expectedTargetValue: 1,
      });

      expect(effectRes.effectObserved).toBe(true);
      expect(effectRes.isAbsentConfirmed).toBe(false);
      expect(effectRes.currentNormalizedValue).toBe(1);
    });

    it("F2.2.7 — Condição 4: Proveniência de evidência completa e integração com establishFieldBaseline()", async () => {
      const raText = "008881";
      const alunoId = await criarAlunoFicticio(raText, "Aluno Proveniencia F2");
      const recordId = `rec-prov-${raText}`;

      // 1. Inicializa record UNBASELINED no D1
      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        raText,
        groupKey: "FACE_FEA",
        alunoId,
      });

      // Carrega o aluno no adapter simulado
      adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
        {
          raText,
          studentName: "Aluno Proveniencia F2",
          fields: { identidade: "ENTREGUE" },
        },
      ]);

      // 2. O adaptador lê a planilha e gera evidência completa de proveniência assinada criptograficamente
      const evidence = await adapter.generateProvenanceEvidence({
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        raText,
        fieldKey: "identidade",
        adapterSecret: secretKey,
      });

      expect(evidence.sourceAdapterId).toBe("fake-sheet-adapter-01");
      expect(evidence.contentHash.length).toBe(64); // SHA-256

      const evidencePayload = JSON.stringify(evidence);
      const evidenceBytes = new TextEncoder().encode(evidencePayload);
      const evidenceDigest = await crypto.subtle.digest("SHA-256", evidenceBytes);
      const evidenceHash = Array.from(new Uint8Array(evidenceDigest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 3. Estabelece baseline na F1-A usando a evidência de proveniência
      const baselineRes = await establishFieldBaseline(env.DB, {
        commandId: `cmd-baseline-${crypto.randomUUID()}`,
        actorId: "worker:face_fea",
        recordId,
        fieldKey: "identidade",
        baselineValue: 1,
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: {
          source: "SPREADSHEET_IMPORT",
          evidencePayload,
          evidenceHash,
        },
      });

      expect(baselineRes.ok).toBe(true);
      if (baselineRes.ok) {
        expect(baselineRes.status).toBe("BASELINE_ESTABLISHED");
        expect(baselineRes.revision).toBe(0);
      }
    });

    it("F2.2.8 — Fluxo Integrado F1-B + F2: Dispatch com FakeSpreadsheetAdapter, Verificação e Confirmação de Efeito", async () => {
      const raText = "008882";
      const alunoId = await criarAlunoFicticio(raText, "Aluno Fluxo F1B-F2");
      const recordId = `rec-f1b-f2-${raText}`;

      await initSyncRecord(env.DB, {
        recordId,
        integrationId: integrationFaceId,
        raText,
        groupKey: "FACE_FEA",
        alunoId,
      });

      // Carrega o aluno na planilha simulada com titulo = 'PENDENTE' (norm: 0)
      adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
        {
          raText: "001234",
          studentName: "Aluno 1",
          fields: { identidade: "SIM", certidao: "SIM" },
        },
        {
          raText,
          studentName: "Aluno Fluxo F1B-F2",
          fields: { titulo: "PENDENTE" },
        },
      ]);

      // Estabelece baseline em 0 com evidência assinada pelo adaptador autorizado
      const evidence = await adapter.generateProvenanceEvidence({
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        raText,
        fieldKey: "titulo",
        adapterSecret: secretKey,
      });

      const evidencePayload = JSON.stringify(evidence);
      const evidenceBytes = new TextEncoder().encode(evidencePayload);
      const evidenceDigest = await crypto.subtle.digest("SHA-256", evidenceBytes);
      const evidenceHash = Array.from(new Uint8Array(evidenceDigest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const baseRes = await establishFieldBaseline(env.DB, {
        commandId: `cmd-f1b-base-${crypto.randomUUID()}`,
        actorId: "worker:face_fea",
        recordId,
        fieldKey: "titulo",
        baselineValue: 0,
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
        evidence: {
          source: "SPREADSHEET_IMPORT",
          evidencePayload,
          evidenceHash,
        },
      });
      expect(baseRes.ok).toBe(true);

      // Mutação documental: 0 -> 1 (Gera operação PENDING na F1-A a partir de revision 0)
      const mutRes = await executeFieldMutation(env.DB, {
        commandId: `cmd-f1b-mut-${crypto.randomUUID()}`,
        actorId: "worker:face_fea",
        recordId,
        fieldKey: "titulo",
        fromRevision: 0,
        proposedValue: 1,
        integrationId: integrationFaceId,
        periodoId,
        groupKey: "FACE_FEA",
        generation: 1,
        expectedEpoch: 1,
      });

      if (!mutRes.ok) {
        console.log("F2.2.8 mutRes failure:", mutRes);
      }
      expect(mutRes.ok).toBe(true);
      if (!mutRes.ok) return;

      // Consulta a operação pendente gerada no outbox
      const pendingOp = await env.DB.prepare(
        `SELECT operation_id, state, lease_epoch FROM sync_operations
         WHERE record_id = ? AND field_key = 'titulo' AND target_key = 'CONTROLE'`
      )
        .bind(recordId)
        .first<{ operation_id: string; state: string; lease_epoch: number }>();

      expect(pendingOp).toBeDefined();
      expect(pendingOp?.state).toBe("PENDING");

      // Claim da operação pela F1-B
      const claimRes = await claimOperation(env.DB, {
        operationId: pendingOp!.operation_id,
        workerId: "worker:face_fea",
        leaseDurationSeconds: 60,
      });

      expect(claimRes.ok).toBe(true);
      if (!claimRes.ok) return;

      // Dispatch para o adaptador simulado
      const dispatchRes = await dispatchOperation(env.DB, {
        operationId: pendingOp!.operation_id,
        workerId: "worker:face_fea",
        leaseEpoch: claimRes.leaseEpoch,
        payloadText: JSON.stringify({ target: "CONTROLE", value: 1 }),
      });
      expect(dispatchRes.ok).toBe(true);

      // Simula falha/timeout transitório: operação vai para UNCERTAIN
      const uncertainRes = await markUncertainOperation(env.DB, {
        operationId: pendingOp!.operation_id,
        workerId: "worker:face_fea",
        leaseEpoch: claimRes.leaseEpoch,
        attemptId: (dispatchRes as any).attemptId!,
        errorMessage: "Network socket timeout to Sheets API",
      });
      expect(uncertainRes.ok).toBe(true);

      // Transição para VERIFYING
      const verifyRes = await verifyOperation(env.DB, {
        operationId: pendingOp!.operation_id,
        workerId: "worker:face_fea",
        leaseEpoch: claimRes.leaseEpoch,
      });
      expect(verifyRes.ok).toBe(true);

      // O worker consulta o FakeSpreadsheetAdapter: o efeito NÃO ocorreu na planilha
      const effectCheck = await adapter.verifyExternalEffect({
        spreadsheetId: spreadsheetFaceId,
        tabName: "CONTROLE_FACE",
        groupKey: "FACE_FEA",
        raText,
        fieldKey: "titulo",
        targetKey: "CONTROLE",
        expectedTargetValue: 1,
      });

      expect(effectCheck.effectObserved).toBe(false);
      expect(effectCheck.isAbsentConfirmed).toBe(true);

      // Com ausência do efeito confirmada, o worker pode com segurança agendar RETRY_WAIT
      const retryRes = await markRetryWaitOperation(env.DB, {
        operationId: pendingOp!.operation_id,
        workerId: "worker:face_fea",
        leaseEpoch: (verifyRes as any).leaseEpoch,
        backoffSeconds: 10,
        confirmEffectAbsent: effectCheck.isAbsentConfirmed,
      });

      expect(retryRes.ok).toBe(true);
      if (retryRes.ok) {
        const opFinal = await env.DB.prepare(
          `SELECT state, lease_owner FROM sync_operations WHERE operation_id = ?`
        )
          .bind(pendingOp!.operation_id)
          .first<{ state: string; lease_owner: string | null }>();

        expect(opFinal?.state).toBe("RETRY_WAIT");
        expect(opFinal?.lease_owner).toBeNull();
      }
    });

    // ========================================================================
    // CORREÇÃO AUDITORIA INDEPENDENTE: C1, C2, C3, C4
    // ========================================================================
    describe("F2 — Auditoria Adversarial (C1, C2, C3, C4)", () => {
      it("C1 — HMAC: Adulteração de propriedade aninhada profunda invalida a assinatura sem alterar cabeçalhos externos", async () => {
        const nowMs = Date.now();
        const nonce = crypto.randomUUID();
        const envelopeData = {
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA" as GroupKey,
          expectedEpoch: 1,
          senderId: "worker:face_fea",
          timestamp: nowMs,
          nonce,
          payload: {
            command: "sync_batch",
            details: {
              nestedKey: "original_value",
              items: [{ id: 1, allowed: true }],
            },
          },
        };

        const canonicalStr = canonicalizeEnvelopeData(envelopeData);
        const signature = await signEnvelopeData(canonicalStr, secretKey);

        // 1. Envelope original deve ser válido
        const validRes = await authenticateAndAuthorizeEnvelope(
          env.DB,
          { ...envelopeData, signature },
          "write:mutation",
          identityLookup,
          { nowMs }
        );
        expect(validRes.valid).toBe(true);

        // 2. Modifica apenas propriedade profunda aninhada (details.items[0].allowed = false)
        const tamperedEnvelope = {
          ...envelopeData,
          nonce: crypto.randomUUID(), // Novo nonce para não cair no anti-replay
          payload: {
            command: "sync_batch",
            details: {
              nestedKey: "original_value",
              items: [{ id: 1, allowed: false }], // Alteração profunda!
            },
          },
          signature, // Mesma assinatura anterior
        };

        const tamperRes = await authenticateAndAuthorizeEnvelope(
          env.DB,
          tamperedEnvelope,
          "write:mutation",
          identityLookup,
          { nowMs }
        );
        expect(tamperRes.valid).toBe(false);
        if (!tamperRes.valid) {
          expect(tamperRes.error).toBe("INVALID_SIGNATURE");
        }
      });

      it("C2 — Limites de escrita: Rejeita escrita com aba trocada, grupo incompatível ou tentativa de alterar colunas indevidas", async () => {
        // Tentativa 1: targetKey 'CONTROLE' tentando escrever em aba geral ('GENERAL')
        const tabMismatchRes = await adapter.writeDocumentField({
          spreadsheetId: spreadsheetFaceId,
          tabName: "ABA_GERAL_CONTRATOS",
          groupKey: "FACE_FEA",
          raText: "001234",
          fieldKey: "identidade",
          preconditions: {
            targetKey: "CONTROLE",
            expectedCurrentValue: 0,
            targetValue: 1,
            targetRevision: 1,
            operationId: "op-c2-tab-mismatch",
          },
        });
        expect(tabMismatchRes.success).toBe(false);
        expect(tabMismatchRes.status).toBe("OUT_OF_BOUNDS");
        expect(tabMismatchRes.error).toContain("cannot write to tab of type 'GENERAL'");

        // Tentativa 2: targetKey 'GERAL_CONTRATO' tentando escrever em aba de controle
        const generalInControlRes = await adapter.writeDocumentField({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          groupKey: "FACE_FEA",
          raText: "001234",
          fieldKey: "contrato",
          preconditions: {
            targetKey: "GERAL_CONTRATO",
            expectedCurrentValue: 0,
            targetValue: 1,
            targetRevision: 1,
            operationId: "op-c2-general-in-control",
          },
        });
        expect(generalInControlRes.success).toBe(false);
        expect(generalInControlRes.status).toBe("OUT_OF_BOUNDS");
        expect(generalInControlRes.error).toContain("cannot write to tab of type 'CONTROL'");
      });

      it("C3 — Identidade e Retry: Rejeita RAs duplicados/ambíguos e nunca confirma ausência para valores inconclusivos", async () => {
        // Carrega aba de controle com RA DUPLICADO (duas linhas com mesmo RA 007777)
        adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_DUPLICADOS", [
          {
            raText: "007777",
            studentName: "Aluno Duplicado Linha 1",
            fields: { identidade: "SIM" },
          },
          {
            raText: "007777",
            studentName: "Aluno Duplicado Linha 2",
            fields: { identidade: "NÃO" },
          },
        ]);

        // Leitura deve rejeitar por AMBIGUOUS_IDENTITY
        await expect(
          adapter.readControlTab({
            spreadsheetId: spreadsheetFaceId,
            tabName: "CONTROLE_DUPLICADOS",
            groupKey: "FACE_FEA",
          })
        ).rejects.toThrow("AMBIGUOUS_IDENTITY");

        // Escrita deve rejeitar por AMBIGUOUS_IDENTITY
        const writeRes = await adapter.writeDocumentField({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_DUPLICADOS",
          groupKey: "FACE_FEA",
          raText: "007777",
          fieldKey: "identidade",
          preconditions: {
            targetKey: "CONTROLE",
            expectedCurrentValue: 0,
            targetValue: 1,
            targetRevision: 1,
            operationId: "op-c3-dup-write",
          },
        });
        expect(writeRes.success).toBe(false);
        expect(writeRes.status).toBe("AMBIGUOUS_IDENTITY");

        // verifyExternalEffect para RA ambíguo NÃO pode confirmar ausência
        const verifyAmbiguous = await adapter.verifyExternalEffect({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_DUPLICADOS",
          groupKey: "FACE_FEA",
          raText: "007777",
          fieldKey: "identidade",
          targetKey: "CONTROLE",
          expectedTargetValue: 1,
        });
        expect(verifyAmbiguous.effectObserved).toBe(false);
        expect(verifyAmbiguous.isAbsentConfirmed).toBe(false); // BLOQUEADO: não conclusivo!

        // verifyExternalEffect para célula com texto desconhecido/nulo NÃO pode confirmar ausência
        adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_DESCONHECIDO", [
          {
            raText: "008888",
            studentName: "Aluno Desconhecido",
            fields: { identidade: "TEXTO LIVRE INCONCLUSIVO" },
          },
        ]);

        const verifyUnknown = await adapter.verifyExternalEffect({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_DESCONHECIDO",
          groupKey: "FACE_FEA",
          raText: "008888",
          fieldKey: "identidade",
          targetKey: "CONTROLE",
          expectedTargetValue: 1,
        });
        expect(verifyUnknown.effectObserved).toBe(false);
        expect(verifyUnknown.currentNormalizedValue).toBeNull();
        expect(verifyUnknown.isAbsentConfirmed).toBe(false); // BLOQUEADO: valor desconhecido!
      });

      it("C4 — Edições humanas: Detecta alteração de snapshot mesmo quando valor normalizado não muda", async () => {
        adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_HUMANO", [
          {
            raText: "009111",
            studentName: "Aluno Snapshot",
            fields: { identidade: "SIM" }, // norm: 1, cellVersion: 1
          },
        ]);

        // Simula que houve uma mutação prévia que incrementou a versão da célula para 2
        // Primeira escrita legítima
        const firstWrite = await adapter.writeDocumentField({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_HUMANO",
          groupKey: "FACE_FEA",
          raText: "009111",
          fieldKey: "identidade",
          preconditions: {
            targetKey: "CONTROLE",
            expectedCurrentValue: 1,
            targetValue: 1,
            targetRevision: 2,
            operationId: "op-c4-first",
          },
        });
        expect(firstWrite.success).toBe(true); // Célula agora está na versão 2

        // Segunda escrita com precondição baseada no snapshot antigo (versão 1)
        const concurrentWrite = await adapter.writeDocumentField({
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_HUMANO",
          groupKey: "FACE_FEA",
          raText: "009111",
          fieldKey: "identidade",
          preconditions: {
            targetKey: "CONTROLE",
            expectedCurrentValue: 1,
            targetValue: 1,
            targetRevision: 2,
            operationId: "op-c4-concurrent",
            expectedSnapshotHash: "1", // Esperava snapshot versão 1, mas a célula já mudou para 2!
          },
        });

        expect(concurrentWrite.success).toBe(false);
        expect(concurrentWrite.status).toBe("CONFLICT_DETECTED");
        expect(concurrentWrite.error).toContain("Concurrent modification detected between snapshot and write");
      });

      it("C5 — Autenticidade da evidência de baseline: Rejeita evidências fabricadas e dados arbitrários", async () => {
        const raReal = "009222";
        const alunoId = await criarAlunoFicticio(raReal, "Aluno C5 Teste");
        const recordId = `rec-c5-${raReal}`;

        await initSyncRecord(env.DB, {
          recordId,
          integrationId: integrationFaceId,
          raText: raReal,
          groupKey: "FACE_FEA",
          alunoId,
        });

        // Carrega planilha com 'PENDENTE' (norm: 0)
        adapter.loadControlTab(spreadsheetFaceId, "CONTROLE_FACE", [
          {
            raText: raReal,
            studentName: "Aluno C5 Teste",
            fields: { identidade: "PENDENTE" },
          },
        ]);

        // Cenário 1: Chamador tenta gerar evidência declarando falsamente que a planilha tem 'ENTREGUE' (norm: 1)
        await expect(
          adapter.generateProvenanceEvidence({
            integrationId: integrationFaceId,
            periodoId,
            groupKey: "FACE_FEA",
            spreadsheetId: spreadsheetFaceId,
            tabName: "CONTROLE_FACE",
            raText: raReal,
            fieldKey: "identidade",
            rawValue: "ENTREGUE", // Diverge da planilha!
          })
        ).rejects.toThrow("Provenance rejected: declared rawValue 'ENTREGUE' does not match observed 'PENDENTE'");

        // Cenário 2: Chamador tenta gerar evidência para RA que não existe na planilha
        await expect(
          adapter.generateProvenanceEvidence({
            integrationId: integrationFaceId,
            periodoId,
            groupKey: "FACE_FEA",
            spreadsheetId: spreadsheetFaceId,
            tabName: "CONTROLE_FACE",
            raText: "009999", // Não existe na planilha!
            fieldKey: "identidade",
          })
        ).rejects.toThrow("RA '009999' does not exist in tab 'CONTROLE_FACE'");

        // Cenário 3: Chamador fabricou um JSON arbitrário e calculou um SHA-256 matematicamente perfeito,
        // mas com integrationId divergente da integração autorizada.
        const fakePayload = JSON.stringify({
          evidenceId: "evid_fake_123",
          sourceAdapterId: "fake-sheet-adapter-01",
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          integrationId: "int-OUTRA-INTEGRACAO", // Falsificado!
          periodoId,
          groupKey: "FACE_FEA",
          raText: raReal,
          fieldKey: "identidade",
          cellCoordinate: "C2",
          rawValue: "ENTREGUE",
          normalizedValue: 1,
          headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
        });

        const enc = new TextEncoder();
        const fakeDigest = await crypto.subtle.digest("SHA-256", enc.encode(fakePayload));
        const fakeHash = Array.from(new Uint8Array(fakeDigest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const fakeBaselineRes = await establishFieldBaseline(env.DB, {
          commandId: `cmd-fake-baseline-${crypto.randomUUID()}`,
          actorId: "worker:face_fea",
          recordId,
          fieldKey: "identidade",
          baselineValue: 1,
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
          evidence: {
            source: "SPREADSHEET_IMPORT",
            evidencePayload: fakePayload,
            evidenceHash: fakeHash, // Hash SHA-256 autêntico do payload fabricado!
          },
        });

        expect(fakeBaselineRes.ok).toBe(false);
        if (!fakeBaselineRes.ok) {
          expect(fakeBaselineRes.status).toBe("INVALID_EVIDENCE");
          expect(fakeBaselineRes.error).toContain("Evidência fabricada/incompatível: integrationId da evidência");
        }

        // Cenário 4: Chamador tenta passar evidência onde o valor normalizado é 0, mas tenta estabelecer baseline 1
        const fakePayloadDivergentValue = JSON.stringify({
          evidenceId: "evid_fake_456",
          sourceAdapterId: "fake-sheet-adapter-01",
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          raText: raReal,
          fieldKey: "identidade",
          cellCoordinate: "C2",
          rawValue: "PENDENTE",
          normalizedValue: 0, // Evidência diz que é 0
          headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
        });
        const fakeDigest2 = await crypto.subtle.digest("SHA-256", enc.encode(fakePayloadDivergentValue));
        const fakeHash2 = Array.from(new Uint8Array(fakeDigest2))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const fakeValueBaselineRes = await establishFieldBaseline(env.DB, {
          commandId: `cmd-fake-value-${crypto.randomUUID()}`,
          actorId: "worker:face_fea",
          recordId,
          fieldKey: "identidade",
          baselineValue: 1, // Chamador pede baseline 1!
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
          evidence: {
            source: "SPREADSHEET_IMPORT",
            evidencePayload: fakePayloadDivergentValue,
            evidenceHash: fakeHash2,
          },
        });

        expect(fakeValueBaselineRes.ok).toBe(false);
        if (!fakeValueBaselineRes.ok) {
          expect(fakeValueBaselineRes.status).toBe("INVALID_EVIDENCE");
          expect(fakeValueBaselineRes.error).toContain("valor normalizado observado (0) diverge do baseline solicitado (1)");
        }

        // Cenário 5: Chamador fabrica um JSON contendo TODOS os metadados corretos
        // Cenário 5: Chamador fabrica um JSON contendo TODOS os metadados corretos
        // (integrationId, periodoId, groupKey, fieldKey e normalizedValue idênticos ao esperado),
        // calcula um SHA-256 matematicamente perfeito, mas a evidência NÃO possui assinatura do adaptador.
        // O servidor rejeita OBRIGATORIAMENTE sem necessidade de flags (não há como desativar).
        const fakePerfectMetadataPayload = JSON.stringify({
          evidenceId: "evid_fake_perfect_match",
          sourceAdapterId: "fake-sheet-adapter-01",
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          integrationId: integrationFaceId, // Correto!
          periodoId,                       // Correto!
          groupKey: "FACE_FEA",             // Correto!
          raText: raReal,                  // Correto!
          fieldKey: "identidade",           // Correto!
          cellCoordinate: "C2",
          rawValue: "ENTREGUE",
          normalizedValue: 1,              // Correto!
          headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
          contentHash: "hash-fabricado-sem-assinatura-valida",
          // adapterSignature ausente!
        });

        const fakeDigest5 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fakePerfectMetadataPayload));
        const fakeHash5 = Array.from(new Uint8Array(fakeDigest5))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        // Tentativa 5A: Rejeitada incondicionalmente pelo servidor (sem flags no input)
        const fakeAuthRes = await establishFieldBaseline(env.DB, {
          commandId: `cmd-fake-perfect-${crypto.randomUUID()}`,
          actorId: "worker:face_fea",
          recordId,
          fieldKey: "identidade",
          baselineValue: 1,
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
          // Sem qualquer flag opcional!
          evidence: {
            source: "SPREADSHEET_IMPORT",
            evidencePayload: fakePerfectMetadataPayload,
            evidenceHash: fakeHash5,
          },
        });

        expect(fakeAuthRes.ok).toBe(false);
        if (!fakeAuthRes.ok) {
          expect(fakeAuthRes.status).toBe("INVALID_EVIDENCE");
          expect(fakeAuthRes.error).toContain("adapterSignature ausente. Toda importação de planilha exige assinatura criptográfica de origem");
        }

        // Tentativa 5B: Chamador tenta forjar uma assinatura com chave própria
        // O servidor consulta sua configuração confiável (secretKey do servidor) e detecta a falsificação
        const fakeSignedPayload = JSON.stringify({
          evidenceId: "evid_fake_forged_sig",
          sourceAdapterId: "fake-sheet-adapter-01",
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          raText: raReal,
          fieldKey: "identidade",
          cellCoordinate: "C2",
          rawValue: "ENTREGUE",
          normalizedValue: 1,
          headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
          contentHash: "fake-content-hash",
          readTimestamp: "2026-10-19T17:00:00.000Z",
          adapterSignature: "0000000000000000000000000000000000000000000000000000000000000000", // Assinatura forjada!
        });

        const fakeDigest5B = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fakeSignedPayload));
        const fakeHash5B = Array.from(new Uint8Array(fakeDigest5B))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const fakeForgedSigRes = await establishFieldBaseline(env.DB, {
          commandId: `cmd-fake-forged-${crypto.randomUUID()}`,
          actorId: "worker:face_fea",
          recordId,
          fieldKey: "identidade",
          baselineValue: 1,
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
          // Não aceita segredo do chamador! O servidor usa o seu próprio registro
          evidence: {
            source: "SPREADSHEET_IMPORT",
            evidencePayload: fakeSignedPayload,
            evidenceHash: fakeHash5B,
          },
        });

        expect(fakeForgedSigRes.ok).toBe(false);
        if (!fakeForgedSigRes.ok) {
          expect(fakeForgedSigRes.status).toBe("INVALID_EVIDENCE");
          // Rejeitado por divergência entre o contentHash e a assinatura ou os metadados
          expect(
            fakeForgedSigRes.error.includes("Falsificação de evidência detectada") ||
            fakeForgedSigRes.error.includes("contentHash da evidência")
          ).toBe(true);
        }

        // Tentativa 5C: Chamador declara adaptador que não está no registro confiável do servidor
        const unknownAdapterPayload = JSON.stringify({
          evidenceId: "evid_unknown_adapter",
          sourceAdapterId: "unauthorized-malicious-adapter",
          spreadsheetId: spreadsheetFaceId,
          tabName: "CONTROLE_FACE",
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          raText: raReal,
          fieldKey: "identidade",
          cellCoordinate: "C2",
          rawValue: "ENTREGUE",
          normalizedValue: 1,
          headerFingerprint: "IDENTIDADE::CPF::CERTIDÃO::COMP. RESIDÊNCIA::TÍTULO::ENSINO MÉDIO::CONTRATO",
          contentHash: "dummy-hash",
          readTimestamp: "2026-10-19T17:00:00.000Z",
          adapterSignature: "deadbeef",
        });
        const fakeDigest5C = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(unknownAdapterPayload));
        const fakeHash5C = Array.from(new Uint8Array(fakeDigest5C))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const unknownAdapterRes = await establishFieldBaseline(env.DB, {
          commandId: `cmd-unknown-adapter-${crypto.randomUUID()}`,
          actorId: "worker:face_fea",
          recordId,
          fieldKey: "identidade",
          baselineValue: 1,
          integrationId: integrationFaceId,
          periodoId,
          groupKey: "FACE_FEA",
          generation: 1,
          expectedEpoch: 1,
          evidence: {
            source: "SPREADSHEET_IMPORT",
            evidencePayload: unknownAdapterPayload,
            evidenceHash: fakeHash5C,
          },
        });

        expect(unknownAdapterRes.ok).toBe(false);
        if (!unknownAdapterRes.ok) {
          expect(unknownAdapterRes.status).toBe("INVALID_EVIDENCE");
          expect(unknownAdapterRes.error).toContain("não está registrado como confiável no servidor");
        }
      });
    });
  });
});
