import { env } from "cloudflare:workers";
import { describe, expect, it, beforeEach } from "vitest";
import { handleSyncV2AdminRoute } from "../src/server/routes/sync-v2-admin";
import type { UsuarioSessao } from "../src/server/routes/auth";

describe("Endpoint Administrativo P0.2 — POST /seed-baseline (Transacional e Resiliente)", () => {
  const PERIODO_ID = 999;
  const INTEGRATION_ID = "integ-homolog-2026-2";
  const ADMIN_SECRET = "homolog-test-secret-42";
  const _RAS_HOMOLOG = ["00099901", "00099902", "00099903", "00099904"];

  const adminUser: UsuarioSessao = {
    id: 10,
    nome: "Admin Homolog",
    email: "admin@homolog.local",
    username: "admin_homolog",
    perfil: "ADMIN",
    ativo: 1,
    modo_apresentacao: 0,
  };

  const viewerUser: UsuarioSessao = {
    id: 20,
    nome: "Leitor Homolog",
    email: "leitor@homolog.local",
    username: "leitor_homolog",
    perfil: "LEITOR",
    ativo: 1,
    modo_apresentacao: 0,
  };

  const adminInPresentationMode: UsuarioSessao = {
    ...adminUser,
    id: 30,
    modo_apresentacao: 1,
  };

  let auditEvents: Array<{ periodoId: number; evento: any }> = [];
  const fakeRegistrarAuditoria = async (periodoId: number, evento: any) => {
    auditEvents.push({ periodoId, evento });
  };

  beforeEach(async () => {
    auditEvents = [];

    // Limpa dados das tabelas relevantes para o período 999
    await env.DB.prepare(`DELETE FROM sync_auth_nonces WHERE integration_id = ?`).bind(INTEGRATION_ID).run();
    await env.DB.prepare(`DELETE FROM sync_field_state WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`).run();
    await env.DB.prepare(`DELETE FROM sync_records WHERE integration_id = ?`).bind(INTEGRATION_ID).run();
    await env.DB.prepare(`DELETE FROM sync_conflicts WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`).run();
    await env.DB.prepare(`DELETE FROM sync_operations WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`).run();
    await env.DB.prepare(`DELETE FROM documentos WHERE aluno_id IN (SELECT id FROM alunos WHERE periodo_id = ?)`).bind(PERIODO_ID).run();
    await env.DB.prepare(`DELETE FROM alunos WHERE periodo_id = ?`).bind(PERIODO_ID).run();
    await env.DB.prepare(`DELETE FROM sync_integrations WHERE periodo_id = ?`).bind(PERIODO_ID).run();
    await env.DB.prepare(`DELETE FROM periodos WHERE id = ?`).bind(PERIODO_ID).run();
    await env.DB.prepare(`DELETE FROM logs WHERE periodo_id = ?`).bind(PERIODO_ID).run();

    // Cria ou atualiza período 999
    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, 'HOMOLOG-999', 'ATIVO')
       ON CONFLICT(id) DO UPDATE SET codigo = 'HOMOLOG-999', status = 'ATIVO'`,
    )
      .bind(PERIODO_ID)
      .run();

    // Cria integração padrão de homologação em PAUSED
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES (?, ?, 'sheet-homolog-ficticia-999', 1, 1, 'PAUSED')
       ON CONFLICT(integration_id) DO UPDATE SET
         periodo_id = excluded.periodo_id,
         epoch = 1,
         layout_revision = 1,
         mode = 'PAUSED'`,
    )
      .bind(INTEGRATION_ID, PERIODO_ID)
      .run();

    // Popula os 4 alunos de homologação no D1 com dados documentais
    const dadosAlunos = [
      { id: 99901, ra: "00099901", nome: "Aluno Homolog 1", unidade: "FACE", doc: [1, 1, 1, 1, 1, 1, 1] },
      { id: 99902, ra: "00099902", nome: "Aluno Homolog 2", unidade: "FEA", doc: [1, 1, 0, 1, 1, 1, 0] },
      { id: 99903, ra: "00099903", nome: "Aluno Homolog 3", unidade: "FCH", doc: [1, 0, 1, 1, 0, 1, 1] },
      { id: 99904, ra: "00099904", nome: "Aluno Homolog 4", unidade: "EAD", doc: [0, 1, 1, 1, 1, 0, 1] },
    ];

    for (const a of dadosAlunos) {
      await env.DB.prepare(
        `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
         VALUES (?, ?, ?, ?, 'Administracao', ?, 'ATIVO')`,
      )
        .bind(a.id, PERIODO_ID, a.ra, a.nome, a.unidade)
        .run();

      await env.DB.prepare(
        `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(a.id, ...a.doc)
        .run();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Bloqueio Estrito de Ambiente (Fail-Closed)
  // ---------------------------------------------------------------------------
  it("1.1. Bloqueia execução em produção com HTTP 403 AMBIENTE_PROIBIDO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Admin-Secret": ADMIN_SECRET,
        },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "production",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json() as any;
    expect(body.sucesso).toBe(false);
    expect(body.erro).toBe("AMBIENTE_PROIBIDO");
  });

  it("1.2. Bloqueia execução se ENVIRONMENT for indefinido ou staging", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Admin-Secret": ADMIN_SECRET,
        },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "staging",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(403);
    const body = await res!.json() as any;
    expect(body.erro).toBe("AMBIENTE_PROIBIDO");
  });

  // ---------------------------------------------------------------------------
  // 2. Feature Flag
  // ---------------------------------------------------------------------------
  it("2. Retorna HTTP 503 FEATURE_DISABLED se SYNC_V2_ENABLED não for true", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "false",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(503);
    const body = await res!.json() as any;
    expect(body.erro).toBe("FEATURE_DISABLED");
  });

  // ---------------------------------------------------------------------------
  // 3. Método HTTP
  // ---------------------------------------------------------------------------
  it("3. Rejeita requisições GET com HTTP 405 METODO_NAO_PERMITIDO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "GET",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(405);
    const body = await res!.json() as any;
    expect(body.erro).toBe("METODO_NAO_PERMITIDO");
  });

  // ---------------------------------------------------------------------------
  // 4. Autenticação e Diferenciação de Identidade (Humano vs Automação)
  // ---------------------------------------------------------------------------
  it("4.1. Rejeita chamada sem autenticação com HTTP 401 NAO_AUTENTICADO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: null,
      podeEditar: false,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(401);
    const body = await res!.json() as any;
    expect(body.erro).toBe("NAO_AUTENTICADO");
  });

  it("4.2. Rejeita chamada de automação com segredo incorreto com HTTP 403 SECRET_INVALIDO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Admin-Secret": "senha-errada",
        },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: null,
      podeEditar: false,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(403);
    const body = await res!.json() as any;
    expect(body.erro).toBe("SECRET_INVALIDO");
  });

  it("4.3. Usuário humano não-admin NÃO pode usar segredo de automação como bypass (403 PRIVILEGIO_INSUFICIENTE)", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Admin-Secret": ADMIN_SECRET, // Tenta usar segredo de automação
        },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: viewerUser, // Sessão humana com perfil LEITOR
      podeEditar: false,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(403);
    const body = await res!.json() as any;
    expect(body.erro).toBe("PRIVILEGIO_INSUFICIENTE");
  });

  it("4.4. Rejeita administrador em modo apresentação com HTTP 403 MODO_APRESENTACAO_BLOQUEADO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminInPresentationMode,
      podeEditar: false,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(403);
    const body = await res!.json() as any;
    expect(body.erro).toBe("MODO_APRESENTACAO_BLOQUEADO");
  });

  it("4.5. Bloqueia execução se a identidade do chamador divergir da emitida no token (403 IDENTIDADE_DIVERGENTE)", async () => {
    // 1. Gera prévia com adminUser (humano)
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Tenta executar Fase 2 via automação (sem sessão, usando secret)
    const resExec = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Admin-Secret": ADMIN_SECRET,
          "X-Sync-Caller-Id": "automation:runner",
        },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: null,
      podeEditar: false,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec!.status).toBe(403);
    const body = await resExec!.json() as any;
    expect(body.erro).toBe("IDENTIDADE_DIVERGENTE");
  });

  // ---------------------------------------------------------------------------
  // 5. Restrição de Escopo (Período, Integração e Modo)
  // ---------------------------------------------------------------------------
  it("5.1. Rejeita período divergente de 999 com HTTP 400 PERIODO_INVALIDO", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/123/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/123/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(400);
    const body = await res!.json() as any;
    expect(body.erro).toBe("PERIODO_INVALIDO");
  });

  it("5.2. Rejeita integração que não seja integ-homolog-2026-2", async () => {
    await env.DB.prepare(`UPDATE sync_integrations SET integration_id = 'outra-integracao' WHERE periodo_id = ?`)
      .bind(PERIODO_ID)
      .run();

    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(400);
    const body = await res!.json() as any;
    expect(body.erro).toBe("INTEGRACAO_INVALIDA");
  });

  it("5.3. Rejeita integração fora do modo PAUSED com HTTP 409 MODO_INVALIDO", async () => {
    for (const modoInvalido of ["SHADOW", "CAPTURE", "BIDIRECTIONAL", "QUARANTINED"]) {
      await env.DB.prepare(`UPDATE sync_integrations SET mode = ? WHERE periodo_id = ?`)
        .bind(modoInvalido, PERIODO_ID)
        .run();

      const res = await handleSyncV2AdminRoute({
        request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
          method: "POST",
          headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
          body: JSON.stringify({ dryRun: true }),
        }),
        url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
        db: env.DB,
        env: {
          ENVIRONMENT: "homolog",
          SYNC_V2_ENABLED: "true",
          SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
        },
        usuarioAtual: adminUser,
        podeEditar: true,
        registrarAuditoria: fakeRegistrarAuditoria,
      });

      expect(res!.status).toBe(409);
      const body = await res!.json() as any;
      expect(body.erro).toBe("MODO_INVALIDO");
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Validação de Allowlist de RAs
  // ---------------------------------------------------------------------------
  it("6. Rejeita RAs fora da allowlist com HTTP 400 RA_FORA_DA_ALLOWLIST", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({
          dryRun: true,
          targetRas: ["00099901", "RA_INVASOR_99"],
        }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(400);
    const body = await res!.json() as any;
    expect(body.erro).toBe("RA_FORA_DA_ALLOWLIST");
  });

  // ---------------------------------------------------------------------------
  // 7. Fase 1: Prévia Segura (dryRun = true) — ZERO escritas no D1
  // ---------------------------------------------------------------------------
  it("7. Fase 1 gera snapshot e token sem qualquer escrita no D1, nonces ou auditoria", async () => {
    const res = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res!.status).toBe(200);
    const data = await res!.json() as any;
    expect(data.sucesso).toBe(true);
    expect(data.fase).toBe("PREVIA");
    expect(data.dryRun).toBe(true);
    expect(data.confirmToken).toBeTruthy();
    expect(data.snapshot.snapshotHash).toBeTruthy();

    expect(data.metricas.totalAlunos).toBe(4);
    expect(data.metricas.alunosPreparados).toBe(4);
    expect(data.metricas.alunosJaExistentes).toBe(0);
    expect(data.metricas.totalCampos).toBe(28);
    expect(data.metricas.camposPreparados).toBe(28);

    // Confere que ZERO registros foram gravados em sync_records, sync_field_state, sync_auth_nonces ou logs
    const recordsCount = await env.DB.prepare(`SELECT count(*) as total FROM sync_records WHERE integration_id = ?`)
      .bind(INTEGRATION_ID)
      .first<{ total: number }>();
    expect(recordsCount?.total).toBe(0);

    const noncesCount = await env.DB.prepare(`SELECT count(*) as total FROM sync_auth_nonces WHERE integration_id = ?`)
      .bind(INTEGRATION_ID)
      .first<{ total: number }>();
    expect(noncesCount?.total).toBe(0);

    const logsCount = await env.DB.prepare(`SELECT count(*) as total FROM logs WHERE periodo_id = ?`)
      .bind(PERIODO_ID)
      .first<{ total: number }>();
    expect(logsCount?.total).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8. Fase 2: Snapshot Obsoleto e Rejeição
  // ---------------------------------------------------------------------------
  it("8.1. Rejeita Fase 2 se documentos forem alterados após a prévia (409 SNAPSHOT_OBSOLETO)", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Modifica documento no D1 antes da Fase 2
    await env.DB.prepare(`UPDATE documentos SET contrato = 0 WHERE aluno_id = 99901`).run();

    // 3. Execução rejeitada por divergência de snapshot
    const resExec = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec!.status).toBe(409);
    const body = await resExec!.json() as any;
    expect(body.erro).toBe("SNAPSHOT_OBSOLETO");
  });

  it("8.2. Rejeita Fase 2 se um conflito for registrado após a prévia (409 SNAPSHOT_OBSOLETO)", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Cria registro prévio e insere conflito aberto no D1
    await env.DB.prepare(
      `INSERT INTO sync_records (record_id, integration_id, aluno_id, ra_text, group_key, generation, lifecycle)
       VALUES ('rec-999-FACE_FEA-00099901', ?, 99901, '00099901', 'FACE_FEA', 1, 'ACTIVE')`,
    )
      .bind(INTEGRATION_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_conflicts (conflict_id, record_id, field_key, target_key, local_revision, local_value, external_value, reason, resolved)
       VALUES ('conf-1', 'rec-999-FACE_FEA-00099901', 'contrato', 'CONTROLE', 0, 1, 0, 'DIVERGENCIA_DETECTADA', 0)`,
    ).run();

    // 3. Execução rejeitada por divergência de snapshot
    const resExec = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec!.status).toBe(409);
    const body = await resExec!.json() as any;
    expect(body.erro).toBe("SNAPSHOT_OBSOLETO");
  });

  it("8.3. Rejeita Fase 2 se uma nova operação ativa for enfileirada após a prévia (409 SNAPSHOT_OBSOLETO)", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Cria registro e enfileira operação ativa
    const recordId = "rec-999-FACE_FEA-00099901";
    await env.DB.prepare(
      `INSERT INTO sync_records (record_id, integration_id, aluno_id, ra_text, group_key, generation, lifecycle)
       VALUES (?, ?, 99901, '00099901', 'FACE_FEA', 1, 'ACTIVE')`,
    )
      .bind(recordId, INTEGRATION_ID)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_commands (command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status)
       VALUES ('cmd-1', 'actor', ?, 'titulo', 0, 1, 'hash-1', 'ACCEPTED')`,
    )
      .bind(recordId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_events (event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id)
       VALUES ('ev-1', ?, 'titulo', 'cmd-1', 0, 1, 0, 1, 'actor')`,
    )
      .bind(recordId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (operation_id, event_id, record_id, field_key, target_key, target_revision, state)
       VALUES ('op-1', 'ev-1', ?, 'titulo', 'CONTROLE', 1, 'PENDING')`,
    )
      .bind(recordId)
      .run();

    // 3. Execução rejeitada por divergência de snapshot
    const resExec = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec!.status).toBe(409);
    const body = await resExec!.json() as any;
    expect(body.erro).toBe("SNAPSHOT_OBSOLETO");
  });

  // ---------------------------------------------------------------------------
  // 9. Fase 2: Execução Real Positiva e Consistência Transacional (ACID)
  // ---------------------------------------------------------------------------
  it("9. Fase 2 persiste 28 campos, consome nonce no D1 e registra auditoria atomicamente", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Executa confirmação da semeadura
    const resExec = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec!.status).toBe(200);
    const execData = await resExec!.json() as any;
    expect(execData.sucesso).toBe(true);
    expect(execData.fase).toBe("EXECUCAO");
    expect(execData.statusPersistencia).toBe("PERSISTIDO");
    expect(execData.auditoriaRegistrada).toBe(true);

    // Confere registros em sync_records
    const records = await env.DB.prepare(`SELECT record_id, ra_text, group_key FROM sync_records WHERE integration_id = ? ORDER BY ra_text ASC`)
      .bind(INTEGRATION_ID)
      .all<{ record_id: string; ra_text: string; group_key: string }>();
    expect(records.results).toHaveLength(4);

    // Confere 28 campos em sync_field_state com revision = 0 e status = CONFIRMED
    const fieldStates = await env.DB.prepare(
      `SELECT count(*) as total, sum(case when status = 'CONFIRMED' and revision = 0 then 1 else 0 end) as confirmados
       FROM sync_field_state
       WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`,
    ).first<{ total: number; confirmados: number }>();
    expect(fieldStates?.total).toBe(28);
    expect(fieldStates?.confirmados).toBe(28);

    // Confere que o nonce foi persistido na tabela D1 sync_auth_nonces
    const nonceCount = await env.DB.prepare(`SELECT count(*) as total FROM sync_auth_nonces WHERE integration_id = ?`)
      .bind(INTEGRATION_ID)
      .first<{ total: number }>();
    expect(nonceCount?.total).toBe(1);

    // Confere que o registro de auditoria foi gravado na tabela logs no D1
    const logs = await env.DB.prepare(`SELECT acao, entidade, usuario_id, usuario_username FROM logs WHERE periodo_id = ? AND acao = 'SYNC_V2_BASELINE_SEED'`)
      .bind(PERIODO_ID)
      .all<any>();
    expect(logs.results).toHaveLength(1);
    expect(logs.results[0].usuario_id).toBe(10);
    expect(logs.results[0].usuario_username).toBe("admin_homolog");
  });

  // ---------------------------------------------------------------------------
  // 10. Concorrência e Proteção Anti-Replay em D1 (Múltiplas Instâncias)
  // ---------------------------------------------------------------------------
  it("10.1. Rejeita requisições concorrentes simultâneas com o mesmo token via restrição D1 (400 TOKEN_JA_UTILIZADO)", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Simula duas instâncias concorrentes disparando Fase 2 simultaneamente com o mesmo token
    const call1 = handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    const call2 = handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    const [resp1, resp2] = await Promise.all([call1, call2]);

    const statuses = [resp1!.status, resp2!.status].sort();
    // Exatamente uma instância deve obter sucesso 200, e a concorrente deve falhar com 400
    expect(statuses).toEqual([200, 400]);

    const errorResp = resp1!.status === 400 ? resp1 : resp2;
    const errorBody = await errorResp!.json() as any;
    expect(errorBody.erro).toBe("TOKEN_JA_UTILIZADO");

    // Confere que apenas 1 nonce foi persistido no D1
    const noncesCount = await env.DB.prepare(`SELECT count(*) as total FROM sync_auth_nonces WHERE integration_id = ?`)
      .bind(INTEGRATION_ID)
      .first<{ total: number }>();
    expect(noncesCount?.total).toBe(1);
  });

  it("10.2. Rejeita replay persistente em nova chamada consultando sync_auth_nonces (400 TOKEN_JA_UTILIZADO)", async () => {
    // 1. Gera e executa token
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    const res1 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    expect(res1!.status).toBe(200);

    // 2. Replay posterior deve consultar a base persistente e rejeitar
    const res2 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(res2!.status).toBe(400);
    const body2 = await res2!.json() as any;
    expect(body2.erro).toBe("TOKEN_JA_UTILIZADO");
  });

  // ---------------------------------------------------------------------------
  // 11. Idempotência: Reexecução Segura com Novo Token
  // ---------------------------------------------------------------------------
  it("11. Idempotência: reexecução após persistência reporta NOOP_JA_SEMEADO sem mutações", async () => {
    // 1. Primeira execução: semeia os 4 alunos
    const resPrevia1 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const token1 = (await resPrevia1!.json() as any).confirmToken;

    await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken: token1 }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    // 2. Nova prévia (Fase 1) após persistência inicial
    const resPrevia2 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const previa2Data = await resPrevia2!.json() as any;
    expect(previa2Data.metricas.alunosPreparados).toBe(0);
    expect(previa2Data.metricas.alunosJaExistentes).toBe(4);
    const token2 = previa2Data.confirmToken;

    // 3. Segunda execução com novo token: deve ser NOOP
    const resExec2 = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: false, confirmToken: token2 }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });

    expect(resExec2!.status).toBe(200);
    const exec2Data = await resExec2!.json() as any;
    expect(exec2Data.sucesso).toBe(true);
    expect(exec2Data.statusPersistencia).toBe("NOOP_JA_SEMEADO");
    expect(exec2Data.metricas.alunosPreparados).toBe(0);
    expect(exec2Data.metricas.alunosJaExistentes).toBe(4);
    expect(exec2Data.metricas.camposPreparados).toBe(0);
    expect(exec2Data.metricas.camposJaExistentes).toBe(28);

    // Garante que o total de campos permanece 28
    const countTotal = await env.DB.prepare(`SELECT count(*) as total FROM sync_field_state WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`)
      .first<{ total: number }>();
    expect(countTotal?.total).toBe(28);
  });

  // ---------------------------------------------------------------------------
  // 12. Consistência Transacional (ACID): Rollback Total em Caso de Falha
  // ---------------------------------------------------------------------------
  it("12. Consistência Transacional: se a transação atômica falhar, toda a semeadura e o nonce sofrem rollback", async () => {
    // 1. Gera prévia
    const resPrevia = await handleSyncV2AdminRoute({
      request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
        method: "POST",
        headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
        body: JSON.stringify({ dryRun: true }),
      }),
      url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: fakeRegistrarAuditoria,
    });
    const { confirmToken } = await resPrevia!.json() as any;

    // 2. Cria trigger no SQLite para forçar falha no INSERT em logs (simulando falha transacional)
    await env.DB.prepare(
      `CREATE TRIGGER trigger_falha_auditoria_teste
       BEFORE INSERT ON logs
       WHEN NEW.acao = 'SYNC_V2_BASELINE_SEED'
       BEGIN
         SELECT RAISE(ABORT, 'FALHA_SIMULADA_AUDITORIA_TRANSACIONAL');
       END;`,
    ).run();

    try {
      const resExec = await handleSyncV2AdminRoute({
        request: new Request(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`, {
          method: "POST",
          headers: { "X-Sync-Admin-Secret": ADMIN_SECRET },
          body: JSON.stringify({ dryRun: false, confirmToken }),
        }),
        url: new URL(`https://local/api/periodos/${PERIODO_ID}/sync-v2/seed-baseline`),
        db: env.DB,
        env: {
          ENVIRONMENT: "homolog",
          SYNC_V2_ENABLED: "true",
          SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
        },
        usuarioAtual: adminUser,
        podeEditar: true,
        registrarAuditoria: fakeRegistrarAuditoria,
      });

      expect(resExec!.status).toBe(500);
      const body = await resExec!.json() as any;
      expect(body.erro).toBe("FALHA_TRANSACAO_D1");

      // PROVA DE ROLLBACK INTEGRAL:
      // ZERO registros em sync_records
      const recs = await env.DB.prepare(`SELECT count(*) as total FROM sync_records WHERE integration_id = ?`)
        .bind(INTEGRATION_ID)
        .first<{ total: number }>();
      expect(recs?.total).toBe(0);

      // ZERO registros em sync_field_state
      const fields = await env.DB.prepare(`SELECT count(*) as total FROM sync_field_state WHERE record_id LIKE 'rec-${PERIODO_ID}-%'`)
        .first<{ total: number }>();
      expect(fields?.total).toBe(0);

      // O nonce NÃO foi consumido porque a transação inteira deu rollback
      const nonces = await env.DB.prepare(`SELECT count(*) as total FROM sync_auth_nonces WHERE integration_id = ?`)
        .bind(INTEGRATION_ID)
        .first<{ total: number }>();
      expect(nonces?.total).toBe(0);
    } finally {
      await env.DB.prepare(`DROP TRIGGER IF EXISTS trigger_falha_auditoria_teste`).run();
    }
  });
});
