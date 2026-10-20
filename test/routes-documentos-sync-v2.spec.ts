import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleDocumentosRoute } from "../src/server/routes/documentos";
import { initSyncRecord } from "../src/server/services/sync-d1-core";

type UsuarioSessao = {
  id: number;
  nome: string;
  username: string;
  perfil: "ADMIN" | "EDITOR" | "LEITOR";
  modo_apresentacao?: number;
};

const adminUser: UsuarioSessao = {
  id: 1,
  nome: "Admin Teste",
  username: "admin",
  perfil: "ADMIN",
};

const leitorUser: UsuarioSessao = {
  id: 2,
  nome: "Leitor Teste",
  username: "leitor",
  perfil: "LEITOR",
};

describe("P0.1 — Integração de Conferência Documental com Sincronização V2", () => {
  let seq = 1;
  const proximoId = () => 1000 + seq++;

  async function criarCenarioBase(opcoes?: {
    ra?: string;
    unidade?: string;
    v2Ativa?: boolean;
    initialDocs?: Partial<{
      identidade: number;
      cpf: number;
      certidao: number;
      residencia: number;
      titulo: number;
      ensino_medio: number;
      contrato: number;
    }>;
  }) {
    const periodoId = proximoId();
    const alunoId = proximoId();
    const ra = opcoes?.ra ?? `RA-${periodoId}`;
    const unidade = opcoes?.unidade ?? "FACE";
    const v2Ativa = opcoes?.v2Ativa ?? true;

    // 1. Período
    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, ?, 'ATIVO')`,
    )
      .bind(periodoId, `PER-${periodoId}`)
      .run();

    // 2. Aluno
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (?, ?, ?, ?, 'Administração', ?, 'ATIVO')`,
    )
      .bind(alunoId, periodoId, ra, `Aluno ${ra}`, unidade)
      .run();

    // 3. Documentos
    const docs = {
      identidade: 0,
      cpf: 0,
      certidao: 0,
      residencia: 0,
      titulo: 0,
      ensino_medio: 0,
      contrato: 0,
      ...opcoes?.initialDocs,
    };

    await env.DB.prepare(
      `INSERT INTO documentos (
        aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        alunoId,
        docs.identidade,
        docs.cpf,
        docs.certidao,
        docs.residencia,
        docs.titulo,
        docs.ensino_medio,
        docs.contrato,
      )
      .run();

    let integrationId = "";
    let recordId = "";

    if (v2Ativa) {
      integrationId = `integ-${periodoId}`;
      const groupKey = ["FACE", "FEA"].includes(unidade) ? "FACE_FEA" : "FCH_EAD";
      recordId = `rec-${periodoId}-${alunoId}`;

      await env.DB.prepare(
        `INSERT INTO sync_integrations (
          integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
        ) VALUES (?, ?, ?, 1, 1, 'BIDIRECTIONAL')`,
      )
        .bind(integrationId, periodoId, `sheet-${periodoId}`)
        .run();

      await initSyncRecord(env.DB, {
        recordId,
        integrationId,
        raText: ra,
        groupKey,
        alunoId,
        generation: 1,
        lifecycle: "ACTIVE",
        initialValues: {
          identidade: docs.identidade as 0 | 1,
          cpf_documento: docs.cpf as 0 | 1,
          certidao: docs.certidao as 0 | 1,
          residencia: docs.residencia as 0 | 1,
          titulo: docs.titulo as 0 | 1,
          ensino_medio: docs.ensino_medio as 0 | 1,
          contrato: docs.contrato as 0 | 1,
        },
      });
    }

    const pendenciasV1Registradas: string[] = [];
    const auditoriasRegistradas: any[] = [];

    const registrarPendencia = async (raP: string) => {
      pendenciasV1Registradas.push(raP);
    };

    const registrarAuditoria = async (evento: any) => {
      auditoriasRegistradas.push(evento);
    };

    return {
      periodoId,
      alunoId,
      ra,
      unidade,
      integrationId,
      recordId,
      pendenciasV1Registradas,
      auditoriasRegistradas,
      registrarPendencia,
      registrarAuditoria,
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Atualização com 1 documento alterado gerando evento V2 e outbox
  // ---------------------------------------------------------------------------
  it("1. Atualização com 1 documento alterado gerando evento V2 e outbox", async () => {
    const cenario = await criarCenarioBase();

    const body = {
      identidade: true,
      cpf: false,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json).toEqual({ sucesso: true, ra: cenario.ra });

    // Projeção em documentos
    const doc = await env.DB.prepare(
      `SELECT identidade, cpf FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenario.alunoId)
      .first<{ identidade: number; cpf: number }>();
    expect(doc?.identidade).toBe(1);
    expect(doc?.cpf).toBe(0);

    // Evento V2 gerado
    const events = await env.DB.prepare(
      `SELECT field_key, value_old, value_new, from_revision, to_revision FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .all();
    expect(events.results).toHaveLength(1);
    expect(events.results[0].field_key).toBe("identidade");
    expect(events.results[0].value_old).toBe(0);
    expect(events.results[0].value_new).toBe(1);

    // Outbox V2 CONTROLE
    const ops = await env.DB.prepare(
      `SELECT target_key, state FROM sync_operations WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .all();
    expect(ops.results).toHaveLength(1);
    expect(ops.results[0].target_key).toBe("CONTROLE");
    expect(ops.results[0].state).toBe("PENDING");

    // V1 suprimida
    expect(cenario.pendenciasV1Registradas).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Atualização com os 7 documentos alterados simultaneamente
  // ---------------------------------------------------------------------------
  it("2. Atualização com os 7 documentos alterados simultaneamente", async () => {
    const cenario = await criarCenarioBase();

    const body = {
      identidade: true,
      cpf: true,
      certidao: true,
      residencia: true,
      titulo: true,
      ensino_medio: true,
      contrato: true,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(200);

    // Projeção em documentos: todos 1
    const doc = await env.DB.prepare(
      `SELECT identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenario.alunoId)
      .first<any>();
    expect(doc?.identidade).toBe(1);
    expect(doc?.cpf).toBe(1);
    expect(doc?.certidao).toBe(1);
    expect(doc?.residencia).toBe(1);
    expect(doc?.titulo).toBe(1);
    expect(doc?.ensino_medio).toBe(1);
    expect(doc?.contrato).toBe(1);

    // 7 eventos V2
    const events = await env.DB.prepare(
      `SELECT field_key FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .all();
    expect(events.results).toHaveLength(7);

    // Outbox: 7 CONTROLE + 1 GERAL_CONTRATO = 8 operações
    const ops = await env.DB.prepare(
      `SELECT target_key FROM sync_operations WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .all<{ target_key: string }>();
    expect(ops.results).toHaveLength(8);

    const alvosControle = ops.results.filter((o) => o.target_key === "CONTROLE");
    const alvosGeral = ops.results.filter((o) => o.target_key === "GERAL_CONTRATO");
    expect(alvosControle).toHaveLength(7);
    expect(alvosGeral).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 3. Requisição no-op (sem alterações em relação ao estado atual)
  // ---------------------------------------------------------------------------
  it("3. Requisição no-op não gera eventos nem escritas espúrias", async () => {
    const cenario = await criarCenarioBase({
      initialDocs: { identidade: 1, cpf: 0 },
    });

    // Envia exatamente o mesmo estado
    const body = {
      identidade: true,
      cpf: false,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json).toEqual({ sucesso: true, ra: cenario.ra });

    // Nenhum evento ou operação criada
    const events = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(events?.count).toBe(0);

    const ops = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_operations WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(ops?.count).toBe(0);

    expect(cenario.pendenciasV1Registradas).toHaveLength(0);
    expect(cenario.auditoriasRegistradas).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Falha/rollback se validação ou CAS falhar
  // ---------------------------------------------------------------------------
  it("4. Falha/rollback: se o CAS falhar, nenhuma alteração é persistida", async () => {
    const cenario = await criarCenarioBase({
      initialDocs: { identidade: 0, cpf: 0 },
    });

    // Simulamos concorrência onde um dos campos está com status PENDING no CAS
    await env.DB.prepare(
      `UPDATE sync_field_state SET status = 'PENDING' WHERE record_id = ? AND field_key = 'cpf_documento'`,
    )
      .bind(cenario.recordId)
      .run();

    // Usuário tenta alterar dois campos na mesma requisição: identidade e cpf
    const body = {
      identidade: true,
      cpf: true,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(409);
    const json = (await response?.json()) as any;
    expect(json.erro).toContain("Conflito de concorrência");

    // Rollback total verificado: nenhum dos dois campos foi alterado na tabela documentos!
    const doc = await env.DB.prepare(
      `SELECT identidade, cpf FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenario.alunoId)
      .first<any>();
    expect(doc?.identidade).toBe(0);
    expect(doc?.cpf).toBe(0);

    // Nenhum evento gravado
    const events = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(events?.count).toBe(0);

    // Nenhuma operação na outbox
    const ops = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_operations WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(ops?.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Replay idempotente da mesma requisição
  // ---------------------------------------------------------------------------
  it("5. Replay idempotente da mesma requisição não duplica mutações", async () => {
    const cenario = await criarCenarioBase();
    const idempotencyKey = `idemp-${proximoId()}`;

    const body = {
      identidade: true,
      cpf: false,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const enviarRequisicao = () =>
      handleDocumentosRoute({
        request: new Request(
          `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-idempotency-key": idempotencyKey,
            },
            body: JSON.stringify(body),
          },
        ),
        url: new URL(
          `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        ),
        db: env.DB,
        periodoId: cenario.periodoId,
        usuarioAtual: adminUser,
        podeEditar: true,
        registrarAuditoria: cenario.registrarAuditoria,
        registrarPendencia: cenario.registrarPendencia,
      });

    // Primeira chamada
    const res1 = await enviarRequisicao();
    expect(res1?.status).toBe(200);

    // Contagem após primeira chamada
    const events1 = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(events1?.count).toBe(1);

    // Segunda chamada (replay)
    const res2 = await enviarRequisicao();
    expect(res2?.status).toBe(200);

    // Contagem não mudou
    const events2 = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(events2?.count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 6. Concorrência: corrida entre duas alterações tratada com CAS 409
  // ---------------------------------------------------------------------------
  it("6. Concorrência: conflito de revisão detectado e respondido com HTTP 409", async () => {
    const cenario = await criarCenarioBase();

    // Simulamos que antes da execução da mutação, uma escrita concorrente avançou a revisão
    // e o valor do campo em sync_field_state sem atualizar a tabela documentos ainda
    await env.DB.prepare(
      `UPDATE sync_field_state
       SET revision = revision + 1, value = 1
       WHERE record_id = ? AND field_key = 'residencia'`,
    )
      .bind(cenario.recordId)
      .run();

    // A tabela documentos ainda está com residencia = 0
    // O usuário tenta enviar residencia = true
    const body = {
      identidade: false,
      cpf: false,
      certidao: false,
      residencia: true,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    // Note: a rota detecta diff (0 != 1), mas quando tenta aplicar o CAS com a revisão antiga,
    // o CAS detecta conflito!
    // Para testar o CAS em corrida estrita (TOCTOU), simulamos a revisão mudando durante a transação:
    // Nós podemos testar a resposta do CAS_CONFLICT diretamente:
    await env.DB.prepare(
      `UPDATE sync_field_state
       SET status = 'PENDING'
       WHERE record_id = ? AND field_key = 'residencia'`,
    )
      .bind(cenario.recordId)
      .run();

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(409);
    const json = (await response?.json()) as any;
    expect(json.erro).toContain("Conflito de concorrência");
  });

  // ---------------------------------------------------------------------------
  // 7. RA com zeros à esquerda preservado em todo o ciclo
  // ---------------------------------------------------------------------------
  it("7. RA com zeros à esquerda preservado integralmente", async () => {
    const raComZeros = "000456";
    const cenario = await criarCenarioBase({ ra: raComZeros });

    const body = {
      identidade: true,
      cpf: true,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(raComZeros)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(raComZeros)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(json.ra).toBe("000456");

    // Confere no banco que o aluno preservou os zeros
    const aluno = await env.DB.prepare(
      `SELECT ra FROM alunos WHERE id = ?`,
    )
      .bind(cenario.alunoId)
      .first<{ ra: string }>();
    expect(aluno?.ra).toBe("000456");

    // Confere em sync_records
    const rec = await env.DB.prepare(
      `SELECT ra_text FROM sync_records WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ ra_text: string }>();
    expect(rec?.ra_text).toBe("000456");

    // Confere em auditoria
    expect(cenario.auditoriasRegistradas[0]?.ra).toBe("000456");
  });

  // ---------------------------------------------------------------------------
  // 8. Isolamento: mesmo RA em períodos distintos não sofre contaminação
  // ---------------------------------------------------------------------------
  it("8. Isolamento: mesmo RA em períodos distintos é 100% isolado", async () => {
    const raCompartilhado = "RA-DUPLO-001";
    const cenarioP1 = await criarCenarioBase({ ra: raCompartilhado });
    const cenarioP2 = await criarCenarioBase({ ra: raCompartilhado });

    // Altera somente no período 1
    const bodyP1 = {
      identidade: true,
      cpf: true,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const resP1 = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(raCompartilhado)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyP1),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(raCompartilhado)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenarioP1.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenarioP1.registrarAuditoria,
      registrarPendencia: cenarioP1.registrarPendencia,
    });
    expect(resP1?.status).toBe(200);

    // Documentos no P1 atualizados
    const docP1 = await env.DB.prepare(
      `SELECT identidade, cpf FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenarioP1.alunoId)
      .first<any>();
    expect(docP1?.identidade).toBe(1);
    expect(docP1?.cpf).toBe(1);

    // Documentos no P2 intactos!
    const docP2 = await env.DB.prepare(
      `SELECT identidade, cpf FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenarioP2.alunoId)
      .first<any>();
    expect(docP2?.identidade).toBe(0);
    expect(docP2?.cpf).toBe(0);

    // Eventos do P2 intactos (zero)
    const eventsP2 = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenarioP2.recordId)
      .first<{ count: number }>();
    expect(eventsP2?.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 9. Permissões: usuário sem permissão recebe 403 e nada é gravado
  // ---------------------------------------------------------------------------
  it("9. Permissões: usuário sem autorização de escrita recebe 403", async () => {
    const cenario = await criarCenarioBase();

    const body = {
      identidade: true,
      cpf: false,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    };

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: leitorUser,
      podeEditar: false,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(403);
    const json = (await response?.json()) as any;
    expect(json.erro).toContain("Seu perfil é somente visualização.");

    // Nada alterado em documentos
    const doc = await env.DB.prepare(
      `SELECT identidade FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenario.alunoId)
      .first<any>();
    expect(doc?.identidade).toBe(0);

    // Nenhum evento ou outbox criada
    const events = await env.DB.prepare(
      `SELECT count(*) as count FROM sync_events WHERE record_id = ?`,
    )
      .bind(cenario.recordId)
      .first<{ count: number }>();
    expect(events?.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 10. Verificação de cutover: gravação V1 suprimida com V2 ativa; fallback funcional
  // ---------------------------------------------------------------------------
  it("10. Cutover seguro: gravação V1 suprimida com V2 ativa; fallback funcional com V2 inativa", async () => {
    // Parte A: V2 Ativa -> V1 suprimida
    const cenarioV2 = await criarCenarioBase({ v2Ativa: true });
    await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenarioV2.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identidade: true,
            cpf: false,
            certidao: false,
            residencia: false,
            titulo: false,
            ensino_medio: false,
            contrato: false,
          }),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenarioV2.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenarioV2.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenarioV2.registrarAuditoria,
      registrarPendencia: cenarioV2.registrarPendencia,
    });
    expect(cenarioV2.pendenciasV1Registradas).toHaveLength(0);

    // Parte B: V2 Inativa (LEGACY / Sem V2) -> Fallback funcional com gravação na outbox V1
    const cenarioV1 = await criarCenarioBase({ v2Ativa: false });
    const resV1 = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenarioV1.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identidade: true,
            cpf: false,
            certidao: false,
            residencia: false,
            titulo: false,
            ensino_medio: false,
            contrato: false,
          }),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenarioV1.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenarioV1.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenarioV1.registrarAuditoria,
      registrarPendencia: cenarioV1.registrarPendencia,
    });

    expect(resV1?.status).toBe(200);

    // Documento foi atualizado
    const docV1 = await env.DB.prepare(
      `SELECT identidade FROM documentos WHERE aluno_id = ?`,
    )
      .bind(cenarioV1.alunoId)
      .first<any>();
    expect(docV1?.identidade).toBe(1);

    // Pendência V1 FOI REGISTRADA no fallback!
    expect(cenarioV1.pendenciasV1Registradas).toEqual([cenarioV1.ra]);
  });

  // ---------------------------------------------------------------------------
  // 11. Compatibilidade com a interface: resposta JSON { sucesso: true, ra }
  // ---------------------------------------------------------------------------
  it("11. Compatibilidade com a interface: resposta JSON { sucesso: true, ra }", async () => {
    const cenario = await criarCenarioBase();

    const response = await handleDocumentosRoute({
      request: new Request(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identidade: false,
            cpf: false,
            certidao: false,
            residencia: false,
            titulo: false,
            ensino_medio: false,
            contrato: true,
          }),
        },
      ),
      url: new URL(
        `https://local/api/alunos/${encodeURIComponent(cenario.ra)}/documentos`,
      ),
      db: env.DB,
      periodoId: cenario.periodoId,
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: cenario.registrarAuditoria,
      registrarPendencia: cenario.registrarPendencia,
    });

    expect(response?.status).toBe(200);
    const json = (await response?.json()) as any;
    expect(Object.keys(json).sort()).toEqual(["ra", "sucesso"]);
    expect(json.sucesso).toBe(true);
    expect(typeof json.ra).toBe("string");
    expect(json.ra).toBe(cenario.ra);
  });
});
