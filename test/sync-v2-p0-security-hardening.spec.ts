import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleSyncV2AdminRoute } from "../src/server/routes/sync-v2-admin";
import { handleGoogleSheetsSyncRoute } from "../src/server/routes/google-sheets-sync";
import { handleGoogleSheetsOutboxRoute } from "../src/server/routes/google-sheets-outbox";
import { handleGoogleSheetsConfigRoute } from "../src/server/routes/google-sheets-config";
import { handlePeriodosRoute } from "../src/server/routes/periodos";
import { handleLogsRoute } from "../src/server/routes/logs";
import { registrarPendenciaGoogleSheets } from "../src/server/services/google-sheets-pendencias";
import { initSyncRecord } from "../src/server/services/sync-d1-core";
import type { UsuarioSessao } from "../src/server/routes/auth";

const V2_MODES = [
  "PAUSED",
  "SHADOW",
  "CAPTURE",
  "BIDIRECTIONAL",
  "QUARANTINED",
] as const;

const adminUser: UsuarioSessao = {
  id: 1,
  nome: "Admin P0",
  email: "admin@p0.local",
  username: "admin.p0",
  perfil: "ADMIN",
  ativo: 1,
  modo_apresentacao: 0,
};

const editorUser: UsuarioSessao = {
  id: 2,
  nome: "Editor P0",
  email: "editor@p0.local",
  username: "editor.p0",
  perfil: "EDITOR",
  ativo: 1,
  modo_apresentacao: 0,
};

const visualizadorUser: UsuarioSessao = {
  id: 3,
  nome: "Visualizador P0",
  email: "visualizador@p0.local",
  username: "visualizador.p0",
  perfil: "VISUALIZADOR",
  ativo: 1,
  modo_apresentacao: 0,
};

const adminApresentacaoUser: UsuarioSessao = {
  ...adminUser,
  id: 4,
  modo_apresentacao: 1,
};

const noopAudit = async () => {};

describe("P0 — Hardening de Segurança e Isolamento Operacional V1/V2", () => {
  const PERIODO_999 = 999;
  const PERIODO_20271 = 20271;
  const PERIODO_LEGACY = 888;
  const ADMIN_SECRET = "p0-hardening-secret-key-2027";

  beforeEach(async () => {
    for (const pId of [PERIODO_999, PERIODO_20271, PERIODO_LEGACY]) {
      await env.DB.prepare(
        `DELETE FROM sync_operations WHERE record_id LIKE 'rec-${pId}-%'`,
      ).run();
      await env.DB.prepare(
        `DELETE FROM sync_conflicts WHERE record_id LIKE 'rec-${pId}-%'`,
      ).run();
      await env.DB.prepare(
        `DELETE FROM sync_field_state WHERE record_id LIKE 'rec-${pId}-%'`,
      ).run();
      await env.DB.prepare(
        `DELETE FROM sync_records WHERE record_id LIKE 'rec-${pId}-%'`,
      ).run();
      await env.DB.prepare(
        `DELETE FROM google_sheets_pendencias WHERE periodo_id = ?`,
      )
        .bind(pId)
        .run();
      await env.DB.prepare(
        `DELETE FROM documentos WHERE aluno_id IN (SELECT id FROM alunos WHERE periodo_id = ?)`,
      )
        .bind(pId)
        .run();
      await env.DB.prepare(`DELETE FROM alunos WHERE periodo_id = ?`)
        .bind(pId)
        .run();
      await env.DB.prepare(
        `DELETE FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
        .bind(pId)
        .run();
      await env.DB.prepare(
        `DELETE FROM sync_integrations WHERE periodo_id = ?`,
      )
        .bind(pId)
        .run();
      await env.DB.prepare(`DELETE FROM periodos WHERE id = ?`).bind(pId).run();
    }

    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, 'HOMOLOG-999', 'ATIVO')`,
    )
      .bind(PERIODO_999)
      .run();

    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, 'HOMOLOG-2027-1', 'ATIVO')`,
    )
      .bind(PERIODO_20271)
      .run();

    await env.DB.prepare(
      `INSERT INTO periodos (id, codigo, status) VALUES (?, 'LEGACY-888', 'ATIVO')`,
    )
      .bind(PERIODO_LEGACY)
      .run();

    for (const pId of [PERIODO_999, PERIODO_20271, PERIODO_LEGACY]) {
      await env.DB.prepare(
        `INSERT INTO google_sheets_periodos (
           periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
           aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead
         ) VALUES (?, ?, 'BASE_FACE', 'BASE_FCH', 'DOCS_FACE', 'DOCS_FCH', 'CANC_FACE', 'CANC_FCH')`,
      )
        .bind(pId, `sheet-${pId}`)
        .run();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Bloqueio de POST /api/periodos/:id/google-sheets/sincronizar em modos V2
  // ---------------------------------------------------------------------------
  it("1. Bloqueia POST /api/periodos/:id/google-sheets/sincronizar com HTTP 409 em todos os modos V2 (PAUSED, SHADOW, CAPTURE, BIDIRECTIONAL, QUARANTINED)", async () => {
    let rangeCalls = 0;

    for (const mode of V2_MODES) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO sync_integrations (
           integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, ?)`,
      )
        .bind(PERIODO_999, mode)
        .run();

      const res = await handleGoogleSheetsSyncRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_999}/google-sheets/sincronizar`,
          { method: "POST" },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_999}/google-sheets/sincronizar`,
        ),
        db: env.DB,
        usuarioAtual: adminUser,
        podeEditar: true,
        lerRanges: async () => {
          rangeCalls += 1;
          return [];
        },
        normalizarTexto: (v) => String(v ?? "").trim(),
        normalizarComparacao: (v) =>
          String(v ?? "")
            .trim()
            .toUpperCase(),
        valorBooleano: (v) => Boolean(v),
      });

      expect(res).not.toBeNull();
      expect(res!.status).toBe(409);
      const body = (await res!.json()) as any;
      expect(body).toMatchObject({
        sucesso: false,
        erro: "PERIODO_GERENCIADO_POR_SYNC_V2",
        integrationId: "integ-homolog-2026-2",
        modo: mode,
      });
    }

    // Garante que nenhuma leitura externa à planilha foi disparada
    expect(rangeCalls).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Bloqueio de POST /api/periodos/:id/google-sheets/pendencias em modos V2
  // ---------------------------------------------------------------------------
  it("2. Bloqueia POST /api/periodos/:id/google-sheets/pendencias com HTTP 409 em todos os modos V2 sem tocar na planilha", async () => {
    let writeCalls = 0;

    for (const mode of V2_MODES) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO sync_integrations (
           integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         ) VALUES ('integ-homolog-2027-1', ?, 'sheet-20271', 1, 1, ?)`,
      )
        .bind(PERIODO_20271, mode)
        .run();

      const res = await handleGoogleSheetsOutboxRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_20271}/google-sheets/pendencias`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmacao: "SINCRONIZAR" }),
          },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_20271}/google-sheets/pendencias`,
        ),
        db: env.DB,
        usuarioAtual: adminUser,
        normalizarTexto: (v) => String(v ?? "").trim(),
        normalizarComparacao: (v) =>
          String(v ?? "")
            .trim()
            .toUpperCase(),
        lerRanges: async () => [],
        escreverValores: async () => {
          writeCalls += 1;
        },
        registrarAuditoria: noopAudit,
      });

      expect(res).not.toBeNull();
      expect(res!.status).toBe(409);
      const body = (await res!.json()) as any;
      expect(body).toMatchObject({
        sucesso: false,
        erro: "PERIODO_GERENCIADO_POR_SYNC_V2",
        integrationId: "integ-homolog-2027-1",
        modo: mode,
      });
    }

    expect(writeCalls).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Não geração de pendências legadas em períodos V2
  // ---------------------------------------------------------------------------
  it("3. Impede criação de pendências legadas em google_sheets_pendencias para períodos com integração V2 ativa", async () => {
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (99910, ?, '00099901', 'Aluno V2', 'Direito', 'FACE', 'ATIVO')`,
    )
      .bind(PERIODO_999)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (99910, 1, 1, 1, 1, 1, 1, 1)`,
    ).run();

    for (const mode of V2_MODES) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO sync_integrations (
           integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, ?)`,
      )
        .bind(PERIODO_999, mode)
        .run();

      await registrarPendenciaGoogleSheets(
        env.DB,
        adminUser,
        PERIODO_999,
        "00099901",
        "ATUALIZAR",
        "DOCUMENTOS",
      );

      const count = await env.DB.prepare(
        `SELECT count(*) as total FROM google_sheets_pendencias WHERE periodo_id = ?`,
      )
        .bind(PERIODO_999)
        .first<{ total: number }>();

      expect(count?.total).toBe(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Funcionamento preservado da V1 em períodos LEGACY ou sem integração V2
  // ---------------------------------------------------------------------------
  it("4. Preserva o funcionamento da V1 exclusivamente em períodos LEGACY ou sem integração V2", async () => {
    await env.DB.prepare(
      `INSERT INTO alunos (id, periodo_id, ra, nome, curso, unidade, status)
       VALUES (88801, ?, 'RA-LEG-01', 'Aluno Legado', 'Direito', 'FACE', 'ATIVO')`,
    )
      .bind(PERIODO_LEGACY)
      .run();

    await env.DB.prepare(
      `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
       VALUES (88801, 1, 0, 0, 0, 0, 0, 1)`,
    ).run();

    // 4.1 Sem linha em sync_integrations: registra pendência V1 normalmente
    await registrarPendenciaGoogleSheets(
      env.DB,
      null,
      PERIODO_LEGACY,
      "RA-LEG-01",
      "ATUALIZAR",
      "CADASTRO",
    );

    const countSemInt = await env.DB.prepare(
      `SELECT count(*) as total FROM google_sheets_pendencias WHERE periodo_id = ?`,
    )
      .bind(PERIODO_LEGACY)
      .first<{ total: number }>();
    expect(countSemInt?.total).toBe(1);

    // 4.2 Com linha em sync_integrations no modo LEGACY: continua permitindo V1
    await env.DB.prepare(
      `DELETE FROM google_sheets_pendencias WHERE periodo_id = ?`,
    )
      .bind(PERIODO_LEGACY)
      .run();

    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-legacy-888', ?, 'sheet-888', 1, 1, 'LEGACY')`,
    )
      .bind(PERIODO_LEGACY)
      .run();

    await registrarPendenciaGoogleSheets(
      env.DB,
      null,
      PERIODO_LEGACY,
      "RA-LEG-01",
      "ATUALIZAR",
      "DOCUMENTOS",
    );

    const countLegacy = await env.DB.prepare(
      `SELECT count(*) as total FROM google_sheets_pendencias WHERE periodo_id = ?`,
    )
      .bind(PERIODO_LEGACY)
      .first<{ total: number }>();
    expect(countLegacy?.total).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 5. Isolamento por período em GET /api/periodos/:id/sync-v2/status (999 vs 20271)
  // ---------------------------------------------------------------------------
  it("5. Isola métricas e bloqueios por período em GET /api/periodos/:id/sync-v2/status (adversarial 999 vs 20271)", async () => {
    // Configura período 999 (PAUSED) com campos UNBASELINED, conflito aberto e operação UNCERTAIN
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, 'PAUSED')`,
    )
      .bind(PERIODO_999)
      .run();

    await initSyncRecord(env.DB, {
      recordId: "rec-999-FACE_FEA-00099901",
      integrationId: "integ-homolog-2026-2",
      raText: "00099901",
      groupKey: "FACE_FEA",
      generation: 1,
      lifecycle: "ACTIVE",
      // Sem initialValues -> 7 campos UNBASELINED no período 999!
    });

    await env.DB.prepare(
      `INSERT INTO sync_conflicts (
         conflict_id, record_id, field_key, target_key, local_revision, local_value, external_value, reason, resolved
       ) VALUES ('conf-999-1', 'rec-999-FACE_FEA-00099901', 'identidade', 'CONTROLE', 1, 1, 0, 'CONFLITO_TESTE_999', 0)`,
    ).run();

    await env.DB.prepare(
      `INSERT INTO sync_commands (
         command_id, actor_id, record_id, field_key, from_revision, proposed_value, request_hash, status
       ) VALUES ('cmd-999-1', 'admin', 'rec-999-FACE_FEA-00099901', 'cpf_documento', 0, 1, 'hash-999-1', 'ACCEPTED')`,
    ).run();

    await env.DB.prepare(
      `INSERT INTO sync_events (
         event_id, record_id, field_key, command_id, from_revision, to_revision, value_old, value_new, actor_id
       ) VALUES ('ev-999-1', 'rec-999-FACE_FEA-00099901', 'cpf_documento', 'cmd-999-1', 0, 1, 0, 1, 'admin')`,
    ).run();

    await env.DB.prepare(
      `INSERT INTO sync_operations (
         operation_id, event_id, record_id, field_key, target_key, target_revision, state
       ) VALUES ('op-999-1', 'ev-999-1', 'rec-999-FACE_FEA-00099901', 'cpf_documento', 'CONTROLE', 1, 'UNCERTAIN')`,
    ).run();

    // Configura período 20271 (CAPTURE) com 2 alunos 100% CONFIRMED e 0 conflitos/operações
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-homolog-2027-1', ?, 'sheet-20271', 1, 1, 'CAPTURE')`,
    )
      .bind(PERIODO_20271)
      .run();

    for (const ra of ["20271001", "20271002"]) {
      await initSyncRecord(env.DB, {
        recordId: `rec-20271-FACE_FEA-${ra}`,
        integrationId: "integ-homolog-2027-1",
        raText: ra,
        groupKey: "FACE_FEA",
        generation: 1,
        lifecycle: "ACTIVE",
        initialValues: {
          identidade: 1,
          cpf_documento: 1,
          certidao: 1,
          residencia: 1,
          titulo: 1,
          ensino_medio: 0,
          contrato: 0,
        },
      });
    }

    // Consulta status do período 20271: NÃO pode sofrer contaminação do período 999
    const res20271 = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_20271}/sync-v2/status`,
        { method: "GET" },
      ),
      url: new URL(
        `https://local/api/periodos/${PERIODO_20271}/sync-v2/status`,
      ),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "sa@test.local",
          private_key: "key",
        }),
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });

    expect(res20271?.status).toBe(200);
    const body20271 = (await res20271!.json()) as any;
    expect(body20271.status.integracao.integration_id).toBe(
      "integ-homolog-2027-1",
    );
    expect(body20271.status.metrics.fieldStates).toEqual({ CONFIRMED: 14 });
    expect(body20271.status.metrics.operations).toEqual({});
    expect(body20271.status.metrics.openConflicts).toBe(0);
    expect(body20271.status.readyForDispatch).toBe(true);
    expect(body20271.status.motivosBloqueio).toEqual([]);

    // Consulta status do período 999: reflete exclusivamente seus próprios dados
    const res999 = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/status`,
        { method: "GET" },
      ),
      url: new URL(`https://local/api/periodos/${PERIODO_999}/sync-v2/status`),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "sa@test.local",
          private_key: "key",
        }),
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });

    expect(res999?.status).toBe(200);
    const body999 = (await res999!.json()) as any;
    expect(body999.status.integracao.integration_id).toBe(
      "integ-homolog-2026-2",
    );
    expect(body999.status.metrics.fieldStates).toEqual({ UNBASELINED: 7 });
    expect(body999.status.metrics.operations).toEqual({ UNCERTAIN: 1 });
    expect(body999.status.metrics.openConflicts).toBe(1);
    expect(body999.status.readyForDispatch).toBe(false);
    expect(
      body999.status.motivosBloqueio.some((m: string) =>
        m.includes("UNBASELINED"),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. Rejeição de EDITOR e VISUALIZADOR nas rotas administrativas e estruturais
  // ---------------------------------------------------------------------------
  it("6. Rejeita EDITOR e VISUALIZADOR em rotas administrativas de períodos, planilhas, logs globais e Sync V2", async () => {
    for (const nonAdmin of [editorUser, visualizadorUser]) {
      // 6.1 POST /api/periodos
      const resCriarPeriodo = await handlePeriodosRoute({
        request: new Request("https://local/api/periodos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: "2028-1" }),
        }),
        url: new URL("https://local/api/periodos"),
        db: env.DB,
        usuarioAtual: nonAdmin,
        registrarAuditoria: noopAudit,
      });
      expect(resCriarPeriodo?.status).toBe(403);

      // 6.2 PUT /api/periodos/:id
      const resAtualizarPeriodo = await handlePeriodosRoute({
        request: new Request(`https://local/api/periodos/${PERIODO_999}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ARQUIVADO" }),
        }),
        url: new URL(`https://local/api/periodos/${PERIODO_999}`),
        db: env.DB,
        usuarioAtual: nonAdmin,
        registrarAuditoria: noopAudit,
      });
      expect(resAtualizarPeriodo?.status).toBe(403);

      // 6.3 PUT /api/periodos/:id/google-sheets
      const resConfigSheets = await handleGoogleSheetsConfigRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_999}/google-sheets`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spreadsheet_id: "nova-planilha-indevida",
              aba_base_face_fea: "A",
              aba_base_fch_ead: "B",
              aba_docs_face_fea: "C",
              aba_docs_fch_ead: "D",
              aba_cancelados_face_fea: "E",
              aba_cancelados_fch_ead: "F",
            }),
          },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_999}/google-sheets`,
        ),
        db: env.DB,
        usuarioAtual: nonAdmin,
        extrairSpreadsheetId: (v) => v,
        normalizarTexto: (v) => String(v ?? "").trim(),
        normalizarComparacao: (v) =>
          String(v ?? "")
            .trim()
            .toUpperCase(),
        testarConexao: async () => ({}),
        registrarAuditoria: noopAudit,
      });
      expect(resConfigSheets?.status).toBe(403);

      // 6.4 PUT /api/periodos/:id/google-sheets/mapeamentos
      const resMapeamentos = await handleGoogleSheetsConfigRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_999}/google-sheets/mapeamentos`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ curso: "DIREITO", unidade: "FACE" }),
          },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_999}/google-sheets/mapeamentos`,
        ),
        db: env.DB,
        usuarioAtual: nonAdmin,
        extrairSpreadsheetId: (v) => v,
        normalizarTexto: (v) => String(v ?? "").trim(),
        normalizarComparacao: (v) =>
          String(v ?? "")
            .trim()
            .toUpperCase(),
        testarConexao: async () => ({}),
        registrarAuditoria: noopAudit,
      });
      expect(resMapeamentos?.status).toBe(403);

      // 6.5 GET /api/log?scope=all
      const resLogsAll = await handleLogsRoute({
        request: new Request("https://local/api/log?scope=all", {
          method: "GET",
        }),
        url: new URL("https://local/api/log?scope=all"),
        db: env.DB,
        periodoId: PERIODO_999,
        usuario: {
          id: nonAdmin.id,
          nome: nonAdmin.nome,
          username: nonAdmin.username,
          perfil: nonAdmin.perfil,
          modo_apresentacao: nonAdmin.modo_apresentacao,
        },
      });
      expect(resLogsAll?.status).toBe(403);

      // 6.6 GET /api/periodos/:id/sync-v2/status
      const resSyncStatus = await handleSyncV2AdminRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_999}/sync-v2/status`,
          { method: "GET" },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_999}/sync-v2/status`,
        ),
        db: env.DB,
        env: { SYNC_V2_ENABLED: "true" },
        usuarioAtual: nonAdmin,
        podeEditar: nonAdmin.perfil === "EDITOR",
        registrarAuditoria: noopAudit,
      });
      expect(resSyncStatus?.status).toBe(403);
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Rejeição de X-Sync-Admin-Secret com sessão humana não-ADMIN (Anti-Escalation)
  // ---------------------------------------------------------------------------
  it("7. Impede que X-Sync-Admin-Secret eleve privilégios de sessão humana não-ADMIN, preservando automação sem sessão", async () => {
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, 'CAPTURE')`,
    )
      .bind(PERIODO_999)
      .run();

    // 7.1 Sessão humana EDITOR ou VISUALIZADOR enviando X-Sync-Admin-Secret válido -> 403 PRIVILEGIO_INSUFICIENTE
    for (const nonAdmin of [editorUser, visualizadorUser]) {
      for (const action of [
        "status",
        "pause",
        "resume",
        "dispatch",
        "inbound",
        "schedule-run",
      ]) {
        const method = action === "status" ? "GET" : "POST";
        const res = await handleSyncV2AdminRoute({
          request: new Request(
            `https://local/api/periodos/${PERIODO_999}/sync-v2/${action}`,
            {
              method,
              headers: {
                "X-Sync-Admin-Secret": ADMIN_SECRET,
              },
            },
          ),
          url: new URL(
            `https://local/api/periodos/${PERIODO_999}/sync-v2/${action}`,
          ),
          db: env.DB,
          env: {
            SYNC_V2_ENABLED: "true",
            SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
          },
          usuarioAtual: nonAdmin,
          podeEditar: nonAdmin.perfil === "EDITOR",
          registrarAuditoria: noopAudit,
        });

        expect(res?.status).toBe(403);
        const body = (await res!.json()) as any;
        expect(body.erro).toBe("PRIVILEGIO_INSUFICIENTE");
      }
    }

    // 7.2 Requisição com cookie de sessão humana inválido/expirado + X-Sync-Admin-Secret -> 401 NAO_AUTENTICADO
    const resCookieComSecret = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/pause`,
        {
          method: "POST",
          headers: {
            Cookie: "cd_session=token-expirado-ou-invalido",
            "X-Sync-Admin-Secret": ADMIN_SECRET,
          },
        },
      ),
      url: new URL(`https://local/api/periodos/${PERIODO_999}/sync-v2/pause`),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: null,
      podeEditar: false,
      registrarAuditoria: noopAudit,
    });
    expect(resCookieComSecret?.status).toBe(401);

    // 7.3 Automação legítima (sem sessão humana e sem cookie cd_session) com X-Sync-Admin-Secret válido -> 200 OK
    const resAutomacao = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/pause`,
        {
          method: "POST",
          headers: {
            "X-Sync-Admin-Secret": ADMIN_SECRET,
          },
        },
      ),
      url: new URL(`https://local/api/periodos/${PERIODO_999}/sync-v2/pause`),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
      },
      usuarioAtual: null,
      podeEditar: false,
      registrarAuditoria: noopAudit,
    });
    expect(resAutomacao?.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // 8. Bloqueio estrito em modo_apresentacao
  // ---------------------------------------------------------------------------
  it("8. Bloqueia mutações administrativas e leituras sensíveis quando modo_apresentacao === 1, mesmo para ADMIN com X-Sync-Admin-Secret", async () => {
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, 'CAPTURE')`,
    )
      .bind(PERIODO_999)
      .run();

    for (const action of [
      "status",
      "pause",
      "resume",
      "dispatch",
      "inbound",
      "schedule-run",
    ]) {
      const method = action === "status" ? "GET" : "POST";
      const res = await handleSyncV2AdminRoute({
        request: new Request(
          `https://local/api/periodos/${PERIODO_999}/sync-v2/${action}`,
          {
            method,
            headers: {
              "X-Sync-Admin-Secret": ADMIN_SECRET,
            },
          },
        ),
        url: new URL(
          `https://local/api/periodos/${PERIODO_999}/sync-v2/${action}`,
        ),
        db: env.DB,
        env: {
          SYNC_V2_ENABLED: "true",
          SYNC_V2_ADMIN_SECRET: ADMIN_SECRET,
        },
        usuarioAtual: adminApresentacaoUser,
        podeEditar: false,
        registrarAuditoria: noopAudit,
      });

      expect(res?.status).toBe(403);
      const body = (await res!.json()) as any;
      expect(body.erro).toBe("MODO_APRESENTACAO_BLOQUEADO");
    }

    // Periodos e Google Sheets Config também bloqueiam adminApresentacaoUser
    const resPeriodo = await handlePeriodosRoute({
      request: new Request("https://local/api/periodos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: "2028-2" }),
      }),
      url: new URL("https://local/api/periodos"),
      db: env.DB,
      usuarioAtual: adminApresentacaoUser,
      registrarAuditoria: noopAudit,
    });
    expect(resPeriodo?.status).toBe(403);

    const resSheetsGet = await handleGoogleSheetsConfigRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/google-sheets`,
        { method: "GET" },
      ),
      url: new URL(`https://local/api/periodos/${PERIODO_999}/google-sheets`),
      db: env.DB,
      usuarioAtual: adminApresentacaoUser,
      extrairSpreadsheetId: (v) => v,
      normalizarTexto: (v) => String(v ?? ""),
      normalizarComparacao: (v) => String(v ?? ""),
      testarConexao: async () => ({}),
      registrarAuditoria: noopAudit,
    });
    expect(resSheetsGet?.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // 9. Fail-closed em POST /schedule-run, remoção de segredo fallback e validação JSON/CSRF
  // ---------------------------------------------------------------------------
  it("9. Garante fail-closed em POST /schedule-run, exige SYNC_V2_ADMIN_SECRET em seed-baseline e valida JSON/Origin", async () => {
    await env.DB.prepare(
      `INSERT INTO sync_integrations (
         integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       ) VALUES ('integ-homolog-2026-2', ?, 'sheet-999', 1, 1, 'PAUSED')`,
    )
      .bind(PERIODO_999)
      .run();

    // 9.1 POST /schedule-run com SYNC_V2_ENABLED !== 'true' deve falhar com 403 SINCRONIZACAO_V2_DESATIVADA
    const resScheduleDisabled = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/schedule-run`,
        { method: "POST" },
      ),
      url: new URL(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/schedule-run`,
      ),
      db: env.DB,
      env: {
        SYNC_V2_ENABLED: "false",
        SYNC_V2_AUTO_ENABLED: "true",
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });
    expect(resScheduleDisabled?.status).toBe(403);
    const bodyScheduleDisabled = (await resScheduleDisabled!.json()) as any;
    expect(bodyScheduleDisabled.erro).toBe("SINCRONIZACAO_V2_DESATIVADA");

    // 9.2 POST /seed-baseline sem SYNC_V2_ADMIN_SECRET configurado -> 503 SECRET_NAO_CONFIGURADO (sem fallback hardcoded)
    const resSeedSemSecret = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/seed-baseline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        },
      ),
      url: new URL(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/seed-baseline`,
      ),
      db: env.DB,
      env: {
        ENVIRONMENT: "homolog",
        SYNC_V2_ENABLED: "true",
        SYNC_V2_ADMIN_SECRET: undefined,
      },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });
    expect(resSeedSemSecret?.status).toBe(503);
    const bodySeedSemSecret = (await resSeedSemSecret!.json()) as any;
    expect(bodySeedSemSecret.erro).toBe("SECRET_NAO_CONFIGURADO");

    // 9.3 Validação estrita de JSON malformado -> 400 JSON_INVALIDO
    const resJsonInvalido = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{ json_quebrado: ",
        },
      ),
      url: new URL(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/dispatch`,
      ),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });
    expect(resJsonInvalido?.status).toBe(400);
    const bodyJsonInvalido = (await resJsonInvalido!.json()) as any;
    expect(bodyJsonInvalido.erro).toBe("JSON_INVALIDO");

    // 9.4 Validação estrita de tipos de parâmetros -> 400 PARAMETRO_INVALIDO
    const resParamInvalido = await handleSyncV2AdminRoute({
      request: new Request(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: -5 }),
        },
      ),
      url: new URL(
        `https://local/api/periodos/${PERIODO_999}/sync-v2/dispatch`,
      ),
      db: env.DB,
      env: { SYNC_V2_ENABLED: "true" },
      usuarioAtual: adminUser,
      podeEditar: true,
      registrarAuditoria: noopAudit,
    });
    expect(resParamInvalido?.status).toBe(400);
    const bodyParamInvalido = (await resParamInvalido!.json()) as any;
    expect(bodyParamInvalido.erro).toBe("PARAMETRO_INVALIDO");

    // 9.5 Validação CSRF por Origin em requisição mutável autenticada por sessão
    await exports.default.fetch(
      "https://controle-documentos.test/api/auth/bootstrap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Admin CSRF",
          email: "admin.csrf@teste.local",
          username: "admin.csrf",
          senha: "SenhaSegura123",
        }),
      },
    );
    const loginRes = await exports.default.fetch(
      "https://controle-documentos.test/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificador: "admin.csrf",
          senha: "SenhaSegura123",
        }),
      },
    );
    const cookie = loginRes.headers.get("Set-Cookie")?.split(";", 1)[0] ?? "";
    if (cookie) {
      const csrfRes = await exports.default.fetch(
        "https://controle-documentos.test/api/periodos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: "https://atacante-externo.evil",
          },
          body: JSON.stringify({ codigo: "2029-1" }),
        },
      );
      expect(csrfRes.status).toBe(403);
      const csrfBody = (await csrfRes.json()) as any;
      expect(csrfBody.codigo).toBe("ORIGEM_NAO_AUTORIZADA");
    }
  });
});
