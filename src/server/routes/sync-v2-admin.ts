import type { UsuarioSessao } from "./auth";
import {
  SyncV2Orchestrator,
  type SyncBatchResult,
  type TabNameResolver,
  createTabNameResolver,
} from "../services/sync-orchestrator";
import {
  GoogleSheetsRealAdapter,
} from "../services/sync-sheet-real-adapter";
import type { ISyncSpreadsheetAdapter } from "../services/sync-sheet-contracts";
import type { GroupKey } from "../services/sync-d1-core";
import { reconcileInboundFromSpreadsheet } from "../services/sync-inbound-reconciler";
import {
  acquireCoordinatorLease,
  releaseCoordinatorLease,
  runScheduledSyncV2,
} from "../services/sync-coordinator";
import {
  prepareExistingAlunosBaselines,
  type BaselineSeederReport,
} from "../services/sync-baseline-seeder";

export interface SyncV2AdminDependencies {
  request: Request;
  url: URL;
  db: D1Database;
  env: {
    SYNC_V2_ENABLED?: string;
    SYNC_V2_AUTO_ENABLED?: string;
    SYNC_V2_ADMIN_SECRET?: string;
    SYNC_ADMIN_SECRET?: string;
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
    ENVIRONMENT?: string;
  };
  usuarioAtual: UsuarioSessao | null;
  podeEditar: boolean;
  registrarAuditoria: (
    periodoId: number,
    evento: {
      acao: string;
      entidade: string;
      descricao: string;
    },
  ) => Promise<void>;
  customAdapter?: ISyncSpreadsheetAdapter;
}

// Conjunto em memória para exclusão mútua de despachos simultâneos no mesmo worker isolate
const activeDispatches = new Set<string>();

/**
 * Assina payload com HMAC-SHA256 usando Web Crypto API nativa do Cloudflare Workers / Node.js
 */
async function signHmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Valida assinatura HMAC-SHA256 em tempo constante
 */
async function verifyHmacSha256(
  secret: string,
  data: string,
  signatureHex: string,
): Promise<boolean> {
  if (!signatureHex || typeof signatureHex !== "string") return false;
  const expected = await signHmacSha256(secret, data);
  if (expected.length !== signatureHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return mismatch === 0;
}

const ALLOWED_HOMOLOG_RAS = [
  "00099901",
  "00099902",
  "00099903",
  "00099904",
] as const;

/**
 * Calcula o snapshot determinístico dos 4 alunos, documentos consolidados, estados de baseline,
 * conflitos abertos, operações ativas e parâmetros de integração no D1.
 * O hash SHA-256 gerado vincula o token de prévia e impede execução sobre estado obsoleto.
 */
async function computeBaselineScopeSnapshot(
  db: D1Database,
  periodoId: number,
  integrationId: string,
  targetRas: string[],
): Promise<{
  snapshotHash: string;
  summary: {
    totalAlunos: number;
    totalCamposD1: number;
    openConflicts: number;
    activeOperations: number;
  };
}> {
  const placeholders = targetRas.map(() => "?").join(", ");

  // 1. Alunos e Documentos Consolidados
  const alunosDocs = await db
    .prepare(
      `SELECT a.id, a.ra, a.unidade, a.status as aluno_status,
              d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
       FROM alunos a
       LEFT JOIN documentos d ON d.aluno_id = a.id
       WHERE a.periodo_id = ? AND a.ra IN (${placeholders})
       ORDER BY a.ra ASC`,
    )
    .bind(periodoId, ...targetRas)
    .all<any>();

  // 2. Estados existentes em sync_field_state
  const fieldStates = await db
    .prepare(
      `SELECT s.record_id, s.field_key, s.value, s.revision, s.status
       FROM sync_field_state s
       JOIN sync_records r ON r.record_id = s.record_id
       WHERE r.integration_id = ? AND r.ra_text IN (${placeholders})
       ORDER BY s.record_id ASC, s.field_key ASC`,
    )
    .bind(integrationId, ...targetRas)
    .all<any>();

  // 3. Conflitos abertos em sync_conflicts
  const openConflicts = await db
    .prepare(
      `SELECT c.conflict_id, c.record_id, c.field_key, c.target_key, c.local_revision
       FROM sync_conflicts c
       JOIN sync_records r ON r.record_id = c.record_id
       WHERE r.integration_id = ? AND r.ra_text IN (${placeholders}) AND c.resolved = 0
       ORDER BY c.conflict_id ASC`,
    )
    .bind(integrationId, ...targetRas)
    .all<any>();

  // 4. Operações ativas em sync_operations
  const activeOps = await db
    .prepare(
      `SELECT o.operation_id, o.record_id, o.field_key, o.target_key, o.target_revision, o.state
       FROM sync_operations o
       JOIN sync_records r ON r.record_id = o.record_id
       WHERE r.integration_id = ? AND r.ra_text IN (${placeholders})
         AND o.state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')
       ORDER BY o.operation_id ASC`,
    )
    .bind(integrationId, ...targetRas)
    .all<any>();

  // 5. Integração
  const integracao = await db
    .prepare(
      `SELECT integration_id, periodo_id, epoch, layout_revision, mode
       FROM sync_integrations
       WHERE integration_id = ? AND periodo_id = ?`,
    )
    .bind(integrationId, periodoId)
    .first<any>();

  const rawCanonicalData = JSON.stringify({
    integration: integracao || null,
    alunosDocs: alunosDocs.results || [],
    fieldStates: fieldStates.results || [],
    openConflicts: openConflicts.results || [],
    activeOps: activeOps.results || [],
  });

  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(rawCanonicalData),
  );
  const snapshotHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    snapshotHash,
    summary: {
      totalAlunos: (alunosDocs.results || []).length,
      totalCamposD1: (fieldStates.results || []).length,
      openConflicts: (openConflicts.results || []).length,
      activeOperations: (activeOps.results || []).length,
    },
  };
}

/**
 * Verifica de forma segura se uma tabela existe no D1 sem lançar exceção não tratada.
 */
async function verificarTabelasV2Existem(db: D1Database): Promise<boolean> {
  try {
    const res = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sync_integrations', 'sync_operations')`,
      )
      .all<{ name: string }>();
    return (res.results || []).length === 2;
  } catch {
    return false;
  }
}

type ResultadoAutorizacaoSyncV2 =
  | { autorizado: true; tipo: "HUMANO" | "AUTOMACAO" }
  | { autorizado: false; status: number; erro: string; mensagem: string };

/**
 * Valida autorização estrita da requisição administrativa:
 * 1. Se houver sessão humana (`usuarioAtual`), exige perfil ADMIN e `modo_apresentacao !== 1`.
 *    Sessões humanas não-ADMIN NUNCA podem usar `X-Sync-Admin-Secret` como bypass/elevação.
 * 2. Se não houver sessão humana (`usuarioAtual === null` e sem cookie `cd_session`),
 *    permite automação autenticada com `X-Sync-Admin-Secret` válido.
 */
function avaliarAutorizacaoAdminSyncV2(
  request: Request,
  usuarioAtual: UsuarioSessao | null,
  adminSecretConfigurado?: string,
  exige401QuandoSemCredenciais = false,
): ResultadoAutorizacaoSyncV2 {
  if (usuarioAtual) {
    if (usuarioAtual.modo_apresentacao === 1) {
      return {
        autorizado: false,
        status: 403,
        erro: "MODO_APRESENTACAO_BLOQUEADO",
        mensagem:
          "Operações administrativas da Sincronização V2 são estritamente bloqueadas no modo apresentação.",
      };
    }

    const isAdmin =
      usuarioAtual.perfil === "ADMIN" ||
      (usuarioAtual as unknown as { role?: string }).role === "ADMIN";

    if (!isAdmin) {
      return {
        autorizado: false,
        status: 403,
        erro: "PRIVILEGIO_INSUFICIENTE",
        mensagem:
          "Esta operação requer privilégio de Administrador do sistema. O segredo de automação não permite elevação de privilégio para sessões humanas não-admin.",
      };
    }

    return { autorizado: true, tipo: "HUMANO" };
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  if (/(?:^|;\s*)cd_session=/.test(cookieHeader)) {
    return {
      autorizado: false,
      status: 401,
      erro: "NAO_AUTENTICADO",
      mensagem:
        "Sessão humana expirada ou inválida. Segredo de automação não pode ser combinado com cookie de sessão.",
    };
  }

  const secretHeader = request.headers.get("X-Sync-Admin-Secret");
  if (!secretHeader) {
    if (exige401QuandoSemCredenciais) {
      return {
        autorizado: false,
        status: 401,
        erro: "NAO_AUTENTICADO",
        mensagem: "Não autenticado.",
      };
    }
    return {
      autorizado: false,
      status: 403,
      erro: "PRIVILEGIO_INSUFICIENTE",
      mensagem: "Esta operação requer privilégio de Administrador do sistema.",
    };
  }

  if (!adminSecretConfigurado || !adminSecretConfigurado.trim()) {
    return {
      autorizado: false,
      status: 503,
      erro: "SECRET_NAO_CONFIGURADO",
      mensagem:
        "O segredo administrativo (SYNC_V2_ADMIN_SECRET) não está configurado no ambiente.",
    };
  }

  if (secretHeader !== adminSecretConfigurado) {
    return {
      autorizado: false,
      status: 403,
      erro: "SECRET_INVALIDO",
      mensagem: "Segredo administrativo inválido ou incorreto.",
    };
  }

  return { autorizado: true, tipo: "AUTOMACAO" };
}

async function lerCorpoJsonOpcional(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, any> }
  | { ok: false; response: Response }
> {
  let rawText = "";
  try {
    rawText = await request.clone().text();
  } catch {
    return { ok: true, body: {} };
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: true, body: {} };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: Response.json(
          {
            sucesso: false,
            erro: "JSON_INVALIDO",
            mensagem: "O corpo da requisição deve ser um objeto JSON válido.",
          },
          { status: 400 },
        ),
      };
    }
    return { ok: true, body: parsed as Record<string, any> };
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          sucesso: false,
          erro: "JSON_INVALIDO",
          mensagem: "Corpo da requisição não contém JSON válido.",
        },
        { status: 400 },
      ),
    };
  }
}

export async function handleSyncV2AdminRoute(
  deps: SyncV2AdminDependencies,
): Promise<Response | null> {
  const {
    request,
    url,
    db,
    env,
    usuarioAtual,
    podeEditar: _podeEditar,
    registrarAuditoria,
    customAdapter,
  } = deps;

  const matchPeriodo = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/sync-v2\/(status|dispatch|pause|resume|inbound|schedule-run|seed-baseline)$/,
  );

  let periodoId: number | null = null;
  let action: string | null = null;

  if (matchPeriodo) {
    periodoId = Number(matchPeriodo[1]);
    action = matchPeriodo[2];
  } else {
    const matchDirect = url.pathname.match(
      /^\/api\/sync-v2\/(status|dispatch|pause|resume|inbound|schedule-run|seed-baseline)$/,
    );
    if (matchDirect) {
      action = matchDirect[1];
      const q = url.searchParams.get("periodoId");
      if (q !== null) {
        const parsedQ = Number(q);
        if (!Number.isInteger(parsedQ) || parsedQ <= 0) {
          return Response.json(
            {
              sucesso: false,
              erro: "PERIODO_INVALIDO",
              mensagem: "O parâmetro periodoId informado é inválido.",
            },
            { status: 400 },
          );
        }
        periodoId = parsedQ;
      }
    }
  }

  if (!action) return null;

  if (periodoId === null && (request.method === "POST" || request.method === "PATCH")) {
    try {
      const cloned = (await request.clone().json()) as Record<string, unknown> | null;
      if (cloned && cloned.periodoId !== undefined) {
        if (typeof cloned.periodoId !== "number" || !Number.isInteger(cloned.periodoId) || cloned.periodoId <= 0) {
          return Response.json(
            {
              sucesso: false,
              erro: "PERIODO_INVALIDO",
              mensagem: "O campo periodoId no corpo da requisição deve ser um inteiro positivo.",
            },
            { status: 400 },
          );
        }
        periodoId = cloned.periodoId;
      }
    } catch {
      // Será validado pelo parser de body da rota específica
    }
  }

  if (periodoId === null) {
    const integracaoDefault = await db
      .prepare(`SELECT periodo_id FROM sync_integrations ORDER BY updated_at DESC LIMIT 1`)
      .first<{ periodo_id: number }>();
    if (integracaoDefault?.periodo_id) {
      periodoId = integracaoDefault.periodo_id;
    } else {
      return Response.json(
        {
          sucesso: false,
          erro: "PERIODO_ID_OBRIGATORIO",
          mensagem: "O parâmetro periodoId é obrigatório na URL (/api/periodos/:id/sync-v2/...) ou no corpo da requisição.",
        },
        { status: 400 },
      );
    }
  }

  if (!Number.isInteger(periodoId) || periodoId <= 0) {
    return Response.json(
      {
        sucesso: false,
        erro: "PERIODO_INVALIDO",
        mensagem: "O identificador do período deve ser um número inteiro positivo.",
      },
      { status: 400 },
    );
  }

  const adminSecret = env.SYNC_V2_ADMIN_SECRET || env.SYNC_ADMIN_SECRET;

  // ---------------------------------------------------------------------------
  // 1. GET /status — Consulta de Saúde e Prontidão (Isolado por Período)
  // ---------------------------------------------------------------------------
  if (action === "status" && request.method === "GET") {
    const authStatus = avaliarAutorizacaoAdminSyncV2(
      request,
      usuarioAtual,
      adminSecret,
      true,
    );
    if (!authStatus.autorizado) {
      return Response.json(
        {
          sucesso: false,
          erro: authStatus.erro,
          mensagem: authStatus.mensagem,
        },
        { status: authStatus.status },
      );
    }

    const enabled = env.SYNC_V2_ENABLED === "true";
    const tablesExist = await verificarTabelasV2Existem(db);
    const motivosBloqueio: string[] = [];

    if (!enabled) {
      motivosBloqueio.push("Sincronização V2 desativada por configuração (SYNC_V2_ENABLED !== 'true').");
    }

    if (!tablesExist) {
      motivosBloqueio.push("Tabelas do núcleo V2 não existem no banco de dados.");
      return Response.json({
        sucesso: true,
        status: {
          enabled,
          environment: env.ENVIRONMENT || "production",
          tablesExist: false,
          credentialsConfigured: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
          integracao: null,
          metrics: null,
          readyForDispatch: false,
          motivosBloqueio,
        },
      });
    }

    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode, updated_at
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
        updated_at: string;
      }>();

    if (!integracao) {
      motivosBloqueio.push(`Nenhuma integração V2 vinculada ao período letivo ${periodoId}.`);
    } else if (["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao.mode)) {
      motivosBloqueio.push(`Integração está em modo '${integracao.mode}'.`);
    }

    let credentialsConfigured = Boolean(customAdapter);
    if (!credentialsConfigured && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        credentialsConfigured = Boolean(parsed.client_email && parsed.private_key);
      } catch {
        credentialsConfigured = false;
      }
    }

    if (!credentialsConfigured) {
      motivosBloqueio.push("Credenciais de conta de serviço Google Sheets ausentes ou inválidas.");
    }

    // Métricas operacionais do D1 estritamente filtradas pelo integration_id do período solicitado
    const operacoesMetrics: Record<string, number> = {};
    const camposMetrics: Record<string, number> = {};
    let openConflictsCount = 0;

    if (integracao) {
      const operacoesPorEstado = await db
        .prepare(
          `SELECT o.state as state, count(*) as total
           FROM sync_operations o
           INNER JOIN sync_records r ON r.record_id = o.record_id
           WHERE r.integration_id = ?
           GROUP BY o.state`,
        )
        .bind(integracao.integration_id)
        .all<{ state: string; total: number }>();

      for (const r of operacoesPorEstado.results || []) {
        operacoesMetrics[r.state] = r.total;
      }

      const camposState = await db
        .prepare(
          `SELECT s.status as status, count(*) as total
           FROM sync_field_state s
           INNER JOIN sync_records r ON r.record_id = s.record_id
           WHERE r.integration_id = ?
           GROUP BY s.status`,
        )
        .bind(integracao.integration_id)
        .all<{ status: string; total: number }>();

      for (const r of camposState.results || []) {
        camposMetrics[r.status] = r.total;
      }

      const conflitosAbertos = await db
        .prepare(
          `SELECT count(*) as total
           FROM sync_conflicts c
           INNER JOIN sync_records r ON r.record_id = c.record_id
           WHERE r.integration_id = ? AND c.resolved = 0`,
        )
        .bind(integracao.integration_id)
        .first<{ total: number }>();

      openConflictsCount = conflitosAbertos?.total ?? 0;
    }

    const unbaselinedCount = camposMetrics["UNBASELINED"] ?? 0;
    if (unbaselinedCount > 0) {
      motivosBloqueio.push(`Existem ${unbaselinedCount} campos sem baseline estabelecida (UNBASELINED).`);
    }

    const readyForDispatch =
      enabled &&
      tablesExist &&
      Boolean(integracao) &&
      !["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao?.mode ?? "") &&
      credentialsConfigured &&
      unbaselinedCount === 0;

    let activeLease: {
      lease_owner: string;
      lease_epoch: number;
      lease_type: string;
      lease_until: string;
    } | null = null;

    if (integracao) {
      try {
        const leaseRow = await db
          .prepare(
            `SELECT lease_owner, lease_epoch, lease_type, lease_until
             FROM sync_coordinator_leases
             WHERE integration_id = ? AND datetime(lease_until) >= datetime('now')`,
          )
          .bind(integracao.integration_id)
          .first<{
            lease_owner: string;
            lease_epoch: number;
            lease_type: string;
            lease_until: string;
          }>();
        activeLease = leaseRow || null;
      } catch {
        // Tabela de leases ainda não criada
      }
    }

    return Response.json({
      sucesso: true,
      status: {
        enabled,
        autoEnabled: env.SYNC_V2_AUTO_ENABLED === "true",
        environment: env.ENVIRONMENT || "production",
        tablesExist,
        credentialsConfigured,
        integracao,
        activeLease,
        metrics: {
          operations: operacoesMetrics,
          fieldStates: camposMetrics,
          openConflicts: openConflictsCount,
        },
        readyForDispatch,
        motivosBloqueio,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 1.1 POST /seed-baseline — Semeadura Administrativa P0.2 Controlada
  // ---------------------------------------------------------------------------
  if (action === "seed-baseline") {
    // 1. Exige método POST estritamente
    if (request.method !== "POST") {
      return Response.json(
        {
          sucesso: false,
          erro: "METODO_NAO_PERMITIDO",
          mensagem: "O endpoint de semeadura aceita exclusivamente requisições POST.",
        },
        { status: 405 },
      );
    }

    // 2. Isolamento de ambiente: fail-closed absoluto fora de homologação
    if (env.ENVIRONMENT !== "homolog") {
      return Response.json(
        {
          sucesso: false,
          erro: "AMBIENTE_PROIBIDO",
          mensagem:
            "A semeadura administrativa de baseline é exclusiva do ambiente de homologação.",
        },
        { status: 403 },
      );
    }

    // 3. Feature flag mestre
    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "FEATURE_DISABLED",
          mensagem:
            "Sincronização V2 está desativada por configuração (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 503 },
      );
    }

    // 4. Autenticação e Autorização com Diferenciação Estrita de Identidade
    let callerIdentity:
      | {
          type: "HUMAN";
          id: number;
          username: string;
          nome: string;
          email: string;
          role: "ADMIN";
        }
      | {
          type: "AUTOMATION";
          id: string;
          callerType: string;
          authMethod: "SECRET_HEADER";
        };

    const secretHeader = request.headers.get("X-Sync-Admin-Secret");

    if (usuarioAtual) {
      // 4.1 Identidade Humana
      if (usuarioAtual.modo_apresentacao === 1) {
        return Response.json(
          {
            sucesso: false,
            erro: "MODO_APRESENTACAO_BLOQUEADO",
            mensagem:
              "A semeadura administrativa de baseline está bloqueada no modo apresentação.",
          },
          { status: 403 },
        );
      }

      const isAdmin =
        usuarioAtual.perfil === "ADMIN" ||
        (usuarioAtual as unknown as { role?: string }).role === "ADMIN";

      if (!isAdmin) {
        // SEGURANÇA: Usuário humano sem privilégio ADMIN NÃO pode usar o segredo de automação como bypass
        return Response.json(
          {
            sucesso: false,
            erro: "PRIVILEGIO_INSUFICIENTE",
            mensagem:
              "A semeadura administrativa de baseline exige privilégio de Administrador do sistema. O segredo de automação não permite elevação de privilégio para sessões humanas não-admin.",
          },
          { status: 403 },
        );
      }

      callerIdentity = {
        type: "HUMAN",
        id: usuarioAtual.id,
        username: usuarioAtual.username,
        nome: usuarioAtual.nome,
        email: usuarioAtual.email,
        role: "ADMIN",
      };
    } else {
      // 4.2 Identidade de Automação
      if (!secretHeader) {
        return Response.json(
          {
            sucesso: false,
            erro: "NAO_AUTENTICADO",
            mensagem:
              "Acesso não autenticado. Requer sessão de Administrador ou credencial administrativa via header.",
          },
          { status: 401 },
        );
      }

      if (!adminSecret || !adminSecret.trim()) {
        return Response.json(
          {
            sucesso: false,
            erro: "SECRET_NAO_CONFIGURADO",
            mensagem:
              "O segredo administrativo (SYNC_V2_ADMIN_SECRET) não está configurado no ambiente.",
          },
          { status: 503 },
        );
      }

      const secretValido = Boolean(secretHeader === adminSecret);

      if (!secretValido) {
        return Response.json(
          {
            sucesso: false,
            erro: "SECRET_INVALIDO",
            mensagem: "Segredo administrativo inválido ou incorreto.",
          },
          { status: 403 },
        );
      }

      const callerId =
        request.headers.get("X-Sync-Caller-Id") || "automation:homolog-seeder";
      const callerType =
        request.headers.get("X-Sync-Caller-Type") || "automation";

      callerIdentity = {
        type: "AUTOMATION",
        id: callerId,
        callerType,
        authMethod: "SECRET_HEADER",
      };
    }

    // 4.3 Fail-closed: segredo obrigatório para assinar/verificar tokens de confirmação
    if (!adminSecret || !adminSecret.trim()) {
      return Response.json(
        {
          sucesso: false,
          erro: "SECRET_NAO_CONFIGURADO",
          mensagem:
            "O segredo administrativo (SYNC_V2_ADMIN_SECRET) é obrigatório para assinar e verificar tokens de confirmação e não está configurado no ambiente.",
        },
        { status: 503 },
      );
    }
    const tokenSecret = adminSecret;

    // 5. Restrição estrita de escopo ao período 999
    if (periodoId !== 999) {
      return Response.json(
        {
          sucesso: false,
          erro: "PERIODO_INVALIDO",
          mensagem:
            "A semeadura de baseline P0.2 é restrita exclusivamente ao período de homologação 999.",
        },
        { status: 400 },
      );
    }

    // 6. Validação da integração e modo obrigatório PAUSED
    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
      }>();

    if (!integracao) {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_NAO_ENCONTRADA",
          mensagem: "Nenhuma integração V2 vinculada ao período 999.",
        },
        { status: 404 },
      );
    }

    if (integracao.integration_id !== "integ-homolog-2026-2") {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_INVALIDA",
          mensagem: `Integração '${integracao.integration_id}' incompatível com a homologação P0.2. Esperada 'integ-homolog-2026-2'.`,
        },
        { status: 400 },
      );
    }

    if (integracao.mode !== "PAUSED") {
      return Response.json(
        {
          sucesso: false,
          erro: "MODO_INVALIDO",
          mensagem: `A semeadura de baseline exige que a integração esteja estritamente em modo PAUSED (modo atual: '${integracao.mode}').`,
        },
        { status: 409 },
      );
    }

    // 7. Parse de opções do corpo e validação estrita da allowlist de RAs
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return Response.json(
        {
          sucesso: false,
          erro: "PARAMETRO_INVALIDO",
          mensagem: "O parâmetro dryRun deve ser booleano.",
        },
        { status: 400 },
      );
    }

    const dryRun = body?.dryRun !== false; // Padrão defensivo: dryRun=true
    const confirmToken =
      typeof body?.confirmToken === "string" ? body.confirmToken.trim() : null;

    let targetRas: string[] = [...ALLOWED_HOMOLOG_RAS];
    if (body?.targetRas !== undefined) {
      if (!Array.isArray(body.targetRas)) {
        return Response.json(
          {
            sucesso: false,
            erro: "PARAMETRO_INVALIDO",
            mensagem: "O parâmetro targetRas deve ser uma lista de RAs.",
          },
          { status: 400 },
        );
      }
      if (body.targetRas.length > 0) {
        const invalidRas = body.targetRas.filter(
          (ra: any) =>
            typeof ra !== "string" ||
            !ALLOWED_HOMOLOG_RAS.includes(ra as (typeof ALLOWED_HOMOLOG_RAS)[number]),
        );
        if (invalidRas.length > 0) {
          return Response.json(
            {
              sucesso: false,
              erro: "RA_FORA_DA_ALLOWLIST",
              mensagem: `Os seguintes RAs não pertencem à allowlist fixa de homologação: ${invalidRas.join(
                ", ",
              )}. RAs autorizados: ${ALLOWED_HOMOLOG_RAS.join(", ")}.`,
            },
            { status: 400 },
          );
        }
        targetRas = Array.from(new Set(body.targetRas as string[])).sort();
      }
    }

    let adapter = customAdapter;
    if (!adapter && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (parsed.client_email && parsed.private_key) {
          adapter = new GoogleSheetsRealAdapter({
            serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
          });
        }
      } catch {
        // ignora erro ao inicializar adapter opcional
      }
    }

    // -------------------------------------------------------------------------
    // FASE 1: Prévia Segura (dryRun = true) — ZERO escritas no D1, ZERO auditoria
    // -------------------------------------------------------------------------
    if (dryRun) {
      // Snapshot abrangente de validação
      const snapshot = await computeBaselineScopeSnapshot(
        db,
        999,
        integracao.integration_id,
        targetRas,
      );

      // Executa prévia do seeder (dryRun = true) — zero mutações no D1
      const report = await prepareExistingAlunosBaselines(db, {
        periodoId: 999,
        integrationId: integracao.integration_id,
        actorId: String(callerIdentity.id),
        dryRun: true,
        targetRas,
        externalAdapter: adapter,
      });

      const nonce = crypto.randomUUID();
      const now = Date.now();
      const expiresAt = now + 5 * 60 * 1000; // 5 minutos de validade

      const tokenPayload = {
        periodoId: 999,
        integrationId: integracao.integration_id,
        epoch: integracao.epoch,
        layoutRevision: integracao.layout_revision,
        targetRas,
        snapshotHash: snapshot.snapshotHash,
        snapshotSummary: snapshot.summary,
        caller: {
          type: callerIdentity.type,
          id: String(callerIdentity.id),
        },
        nonce,
        exp: expiresAt,
      };

      const payloadStr = JSON.stringify(tokenPayload);
      const sig = await signHmacSha256(tokenSecret, payloadStr);
      const generatedToken = `${btoa(payloadStr)}.${sig}`;

      const totalCampos = report.totalAlunosD1 * 7;
      const camposJaExistentes = report.alunosJaExistentes * 7;
      const camposComDivergencia = report.divergencias.length;
      const camposPreparados =
        report.alunosPreparados * 7 - camposComDivergencia;
      const camposBloqueados = report.bloqueios.length * 7;

      return Response.json({
        sucesso: report.sucesso,
        fase: "PREVIA",
        dryRun: true,
        confirmToken: generatedToken,
        tokenExpiraEm: new Date(expiresAt).toISOString(),
        snapshot: {
          periodoId: 999,
          integrationId: integracao.integration_id,
          epoch: integracao.epoch,
          layoutRevision: integracao.layout_revision,
          mode: integracao.mode,
          targetRas,
          snapshotHash: snapshot.snapshotHash,
          snapshotSummary: snapshot.summary,
        },
        metricas: {
          totalAlunos: report.totalAlunosD1,
          alunosPreparados: report.alunosPreparados,
          alunosJaExistentes: report.alunosJaExistentes,
          alunosBloqueados: report.bloqueios.length,
          totalCampos,
          camposPreparados,
          camposJaExistentes,
          camposComDivergencia,
          camposBloqueados,
        },
        report,
        instrucoes:
          "Prévia concluída sem qualquer escrita no banco D1. Para persistência real com garantia transacional, envie POST com { \"dryRun\": false, \"confirmToken\": \"<confirmToken>\" } dentro da janela de 5 minutos.",
      });
    }

    // -------------------------------------------------------------------------
    // FASE 2: Execução com Confirmação e Consistência Transacional (dryRun = false)
    // -------------------------------------------------------------------------
    if (!confirmToken) {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_CONFIRMACAO_OBRIGATORIO",
          mensagem:
            "A execução real (dryRun=false) requer a realização prévia da prévia e o envio do 'confirmToken'.",
        },
        { status: 400 },
      );
    }

    const tokenParts = confirmToken.split(".");
    if (tokenParts.length !== 2) {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_CONFIRMACAO_INVALIDO",
          mensagem: "Estrutura do token de confirmação inválida.",
        },
        { status: 400 },
      );
    }

    const [b64Payload, sig] = tokenParts;
    let payloadStr: string;
    let tokenPayload: any;
    try {
      payloadStr = atob(b64Payload);
      tokenPayload = JSON.parse(payloadStr);
    } catch {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_CONFIRMACAO_INVALIDO",
          mensagem: "Decodificação do payload do token falhou.",
        },
        { status: 400 },
      );
    }

    const isSigValid = await verifyHmacSha256(tokenSecret, payloadStr, sig);
    if (!isSigValid) {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_CONFIRMACAO_INVALIDO",
          mensagem:
            "Assinatura do token de confirmação inválida ou forjada.",
        },
        { status: 400 },
      );
    }

    const now = Date.now();
    if (now > tokenPayload.exp) {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_CONFIRMACAO_EXPIRADO",
          mensagem:
            "O token de confirmação expirou. Gere uma nova prévia antes de executar.",
        },
        { status: 400 },
      );
    }

    // Validação de vinculação de identidade do chamador ao token
    if (
      !tokenPayload.caller ||
      tokenPayload.caller.type !== callerIdentity.type ||
      tokenPayload.caller.id !== String(callerIdentity.id)
    ) {
      return Response.json(
        {
          sucesso: false,
          erro: "IDENTIDADE_DIVERGENTE",
          mensagem:
            "O token de confirmação foi emitido para outra identidade e não pode ser executado pelo chamador atual.",
        },
        { status: 403 },
      );
    }

    // Consulta persistente anti-replay em D1
    const existingNonce = await db
      .prepare(`SELECT nonce FROM sync_auth_nonces WHERE nonce = ?`)
      .bind(tokenPayload.nonce)
      .first<{ nonce: string }>();

    if (existingNonce) {
      return Response.json(
        {
          sucesso: false,
          erro: "TOKEN_JA_UTILIZADO",
          mensagem:
            "Este token de confirmação já foi utilizado (ataque de repetição prevenido). Gere uma nova prévia.",
        },
        { status: 400 },
      );
    }

    // Se o corpo informar targetRas, deve coincidir exatamente com os RAs assinados no token
    if (Array.isArray(body?.targetRas)) {
      const sortedBodyRas = Array.from(
        new Set(body.targetRas as string[]),
      ).sort();
      const sortedTokenRas = Array.from(
        new Set(tokenPayload.targetRas as string[]),
      ).sort();
      if (JSON.stringify(sortedBodyRas) !== JSON.stringify(sortedTokenRas)) {
        return Response.json(
          {
            sucesso: false,
            erro: "PARAMETRO_DIVERGENTE",
            mensagem:
              "A lista de targetRas no corpo diverge dos RAs vinculados e assinados no token de confirmação.",
          },
          { status: 400 },
        );
      }
    }

    // Revalidação estrita contra snapshot abrangente do token (alunos, docs, baseline, conflitos, operações)
    const currentSnapshot = await computeBaselineScopeSnapshot(
      db,
      999,
      integracao.integration_id,
      tokenPayload.targetRas,
    );

    if (currentSnapshot.snapshotHash !== tokenPayload.snapshotHash) {
      return Response.json(
        {
          sucesso: false,
          erro: "SNAPSHOT_OBSOLETO",
          mensagem:
            "O estado dos dados (alunos, documentos, baselines, conflitos ou operações) divergiu do snapshot verificado na prévia. A execução foi rejeitada para prevenir inconsistências. Gere uma nova prévia.",
          snapshotEsperado: tokenPayload.snapshotHash,
          snapshotAtual: currentSnapshot.snapshotHash,
        },
        { status: 409 },
      );
    }

    if (
      tokenPayload.periodoId !== 999 ||
      tokenPayload.integrationId !== integracao.integration_id ||
      tokenPayload.epoch !== integracao.epoch ||
      tokenPayload.layoutRevision !== integracao.layout_revision ||
      integracao.mode !== "PAUSED"
    ) {
      return Response.json(
        {
          sucesso: false,
          erro: "ESTADO_ALTERADO",
          mensagem:
            "O estado da integração ou do período foi modificado após a geração da prévia. Revalidação falhou; gere uma nova prévia.",
        },
        { status: 409 },
      );
    }

    // -------------------------------------------------------------------------
    // Consistência Transacional: Nonce D1 + Semeadura + Auditoria em Lote Único
    // -------------------------------------------------------------------------
    const nonceStmt = db
      .prepare(
        `INSERT INTO sync_auth_nonces (nonce, sender_id, integration_id, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        tokenPayload.nonce,
        String(callerIdentity.id),
        integracao.integration_id,
        new Date(tokenPayload.exp).toISOString(),
      );

    const auditDesc = JSON.stringify({
      integration_id: integracao.integration_id,
      periodo_id: periodoId,
      caller_type: callerIdentity.type,
      caller_id: callerIdentity.id,
      nonce: tokenPayload.nonce,
      snapshot_hash: tokenPayload.snapshotHash,
      target_ras: tokenPayload.targetRas,
    });

    const auditStmt = db
      .prepare(
        `INSERT INTO logs (
           acao, entidade, descricao, ra, unidade, periodo_id,
           usuario_id, usuario_nome, usuario_username
         ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        "SYNC_V2_BASELINE_SEED",
        "SYNC_BASELINE",
        auditDesc,
        periodoId,
        callerIdentity.type === "HUMAN" ? callerIdentity.id : null,
        callerIdentity.type === "HUMAN" ? callerIdentity.nome : null,
        callerIdentity.type === "HUMAN"
          ? callerIdentity.username
          : `automation:${callerIdentity.id}`,
      );

    let report: BaselineSeederReport;
    try {
      report = await prepareExistingAlunosBaselines(db, {
        periodoId: 999,
        integrationId: integracao.integration_id,
        actorId: String(callerIdentity.id),
        dryRun: false,
        targetRas: tokenPayload.targetRas,
        externalAdapter: adapter,
        prependStatements: [nonceStmt],
        appendStatements: [auditStmt],
      });
    } catch (err: any) {
      if (
        err?.message?.includes("UNIQUE constraint failed") &&
        err?.message?.includes("sync_auth_nonces")
      ) {
        return Response.json(
          {
            sucesso: false,
            erro: "TOKEN_JA_UTILIZADO",
            mensagem:
              "Este token de confirmação já foi consumido por outra execução concorrente (concorrência D1 prevenida).",
          },
          { status: 400 },
        );
      }
      return Response.json(
        {
          sucesso: false,
          erro: "FALHA_TRANSACAO_D1",
          mensagem: `A transação atômica contendo semeadura e auditoria falhou e foi integralmente revertida: ${
            err?.message ?? err
          }`,
        },
        { status: 500 },
      );
    }

    // Listener de auditoria para espionagem em suítes de teste (não-bloqueante, D1 já commitado na transação)
    try {
      await registrarAuditoria(periodoId, {
        acao: "SYNC_V2_BASELINE_SEED",
        entidade: "SYNC_BASELINE",
        descricao: auditDesc,
      });
    } catch {
      // Ignora falha em listener externo, pois auditStmt foi gravado atomicamente no D1
    }

    const totalCampos = report.totalAlunosD1 * 7;
    const camposJaExistentes = report.alunosJaExistentes * 7;
    const camposComDivergencia = report.divergencias.length;
    const camposPreparados =
      report.alunosPreparados * 7 - camposComDivergencia;
    const camposBloqueados = report.bloqueios.length * 7;

    const statusPersistencia =
      report.alunosPreparados > 0
        ? "PERSISTIDO"
        : report.alunosJaExistentes > 0
        ? "NOOP_JA_SEMEADO"
        : "SEM_ALUNOS";

    const mensagemResultado =
      report.alunosPreparados > 0
        ? `Semeadura executada com sucesso: ${report.alunosPreparados} alunos e ${camposPreparados} campos preparados no D1.`
        : report.alunosJaExistentes > 0
        ? "Todos os alunos e campos já estavam semeados e confirmados. Nenhuma mutação adicional foi persistida."
        : "Nenhum aluno encontrado para semeadura.";

    return Response.json({
      sucesso: report.sucesso,
      fase: "EXECUCAO",
      dryRun: false,
      statusPersistencia,
      auditoriaRegistrada: true,
      metricas: {
        totalAlunos: report.totalAlunosD1,
        alunosPreparados: report.alunosPreparados,
        alunosJaExistentes: report.alunosJaExistentes,
        alunosBloqueados: report.bloqueios.length,
        totalCampos,
        camposPreparados,
        camposJaExistentes,
        camposComDivergencia,
        camposBloqueados,
      },
      report,
      mensagem: mensagemResultado,
    });
  }

  // Para endpoints modificadores (dispatch, pause, resume, inbound, schedule-run), exige autorização administrativa estrita
  const authAdmin = avaliarAutorizacaoAdminSyncV2(
    request,
    usuarioAtual,
    adminSecret,
    false,
  );
  if (!authAdmin.autorizado) {
    return Response.json(
      {
        sucesso: false,
        erro: authAdmin.erro,
        mensagem: authAdmin.mensagem,
      },
      { status: authAdmin.status },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. POST /pause — Parada Operacional Imediata
  // ---------------------------------------------------------------------------
  if (action === "pause" && request.method === "POST") {
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;

    const integracao = await db
      .prepare(`SELECT integration_id, mode FROM sync_integrations WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    if (!integracao) {
      return Response.json(
        { erro: "INTEGRACAO_NAO_ENCONTRADA", mensagem: "Integração V2 não encontrada." },
        { status: 404 },
      );
    }

    await db
      .prepare(
        `UPDATE sync_integrations SET mode = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .run();

    const modoAnterior = integracao.mode;
    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_PARADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: JSON.stringify({
        integration_id: integracao.integration_id,
        modo_anterior: modoAnterior,
        motivo: "Parada operacional acionada por administrador",
      }),
    });

    return Response.json({
      sucesso: true,
      modo: "PAUSED",
      mensagem: "Parada operacional ativada com sucesso. Novos despachos estão bloqueados.",
    });
  }

  // ---------------------------------------------------------------------------
  // 3. POST /resume — Retomada Operacional
  // ---------------------------------------------------------------------------
  if (action === "resume" && request.method === "POST") {
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const integracao = await db
      .prepare(`SELECT integration_id, mode FROM sync_integrations WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    if (!integracao) {
      return Response.json(
        { erro: "INTEGRACAO_NAO_ENCONTRADA", mensagem: "Integração V2 não encontrada." },
        { status: 404 },
      );
    }

    let modoDestino = body?.modo;

    if (!modoDestino) {
      const ultimaParada = await db
        .prepare(
          `SELECT descricao FROM logs WHERE periodo_id = ? AND acao = 'SYNC_V2_PARADA_OPERACIONAL' ORDER BY id DESC LIMIT 1`,
        )
        .bind(periodoId)
        .first<{ descricao: string }>();

      if (ultimaParada?.descricao) {
        try {
          const parsed = JSON.parse(ultimaParada.descricao);
          if (["SHADOW", "CAPTURE", "BIDIRECTIONAL"].includes(parsed.modo_anterior)) {
            modoDestino = parsed.modo_anterior;
          }
        } catch {
          // parsing legado
        }
      }
    }

    if (!modoDestino || !["SHADOW", "CAPTURE", "BIDIRECTIONAL"].includes(modoDestino)) {
      return Response.json(
        {
          sucesso: false,
          erro: "MODO_EXPLICITO_OBRIGATORIO",
          mensagem:
            "O modo anterior não pôde ser determinado com segurança. É obrigatório informar explicitamente o modo autorizado no corpo da requisição (ex: { \"modo\": \"SHADOW\" | \"CAPTURE\" | \"BIDIRECTIONAL\" }).",
        },
        { status: 400 },
      );
    }

    await db
      .prepare(
        `UPDATE sync_integrations SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE periodo_id = ?`,
      )
      .bind(modoDestino, periodoId)
      .run();

    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_RETOMADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: `Integração '${integracao.integration_id}' retomada para modo ${modoDestino}.`,
    });

    return Response.json({
      sucesso: true,
      modo: modoDestino,
      mensagem: `Integração retomada para modo ${modoDestino} com sucesso.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. POST /dispatch — Despacho Controlado de Lote V2
  // ---------------------------------------------------------------------------
  if (action === "dispatch" && request.method === "POST") {
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (
      body.batchSize !== undefined &&
      (typeof body.batchSize !== "number" ||
        !Number.isInteger(body.batchSize) ||
        body.batchSize <= 0 ||
        body.batchSize > 500)
    ) {
      return Response.json(
        {
          sucesso: false,
          erro: "PARAMETRO_INVALIDO",
          mensagem: "O parâmetro batchSize deve ser um número inteiro positivo (1..500).",
        },
        { status: 400 },
      );
    }

    // 1. Fail-closed: bloqueado por padrão se flag não estiver ativa
    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "SINCRONIZACAO_V2_DESATIVADA",
          mensagem:
            "O processamento V2 está desativado por padrão neste ambiente (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 403 },
      );
    }

    // 2. Existência de tabelas
    const tablesExist = await verificarTabelasV2Existem(db);
    if (!tablesExist) {
      return Response.json(
        {
          sucesso: false,
          erro: "TABELAS_V2_INEXISTENTES",
          mensagem: "Tabelas do núcleo Sync V2 não foram encontradas no banco D1.",
        },
        { status: 503 },
      );
    }

    // 3. Integração do período
    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
      }>();

    if (!integracao) {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_NAO_ENCONTRADA",
          mensagem: `Nenhuma integração V2 configurada para o período ${periodoId}.`,
        },
        { status: 404 },
      );
    }

    // 4. Bloqueio de integrações LEGACY, PAUSED ou QUARANTINED
    if (["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao.mode)) {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRACAO_BLOQUEADA",
          modo: integracao.mode,
          mensagem: `Integração está em modo '${integracao.mode}'. Despachos estão bloqueados.`,
        },
        { status: 409 },
      );
    }

    // 4.1 Bloqueio estrito de modo CAPTURE (fluxo outbound desativado)
    if (integracao.mode === "CAPTURE") {
      return Response.json(
        {
          sucesso: false,
          erro: "OUTBOUND_BLOQUEADO_EM_CAPTURE",
          modo: integracao.mode,
          mensagem: "Integração está em modo 'CAPTURE'. Despachos de saída para o Google Sheets estão estritamente bloqueados.",
        },
        { status: 409 },
      );
    }

    const isShadow = integracao.mode === "SHADOW";

    // 5. Verificação de credenciais
    let adapter = customAdapter;
    if (!adapter) {
      if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_AUSENTES",
            mensagem:
              "Credenciais de serviço do Google Sheets (GOOGLE_SERVICE_ACCOUNT_JSON) não configuradas no ambiente.",
          },
          { status: 503 },
        );
      }
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error("Campos client_email ou private_key ausentes.");
        }
      } catch (err: any) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_INVALIDAS",
            mensagem: `Formato de credenciais inválido: ${err?.message ?? err}`,
          },
          { status: 503 },
        );
      }
      adapter = new GoogleSheetsRealAdapter({
        serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
        readOnly: isShadow,
      });
    }

    // 6. Prevenção de simultaneidade persistente com lease D1 (multi-instância)
    const dispatchKey = `${integracao.integration_id}:${periodoId}`;
    if (activeDispatches.has(dispatchKey)) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um lote de sincronização em execução ativa para esta integração.",
        },
        { status: 429 },
      );
    }

    const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
    const leaseAcq = await acquireCoordinatorLease({
      db,
      integrationId: integracao.integration_id,
      owner: workerId,
      leaseType: "OUTBOUND",
      durationSeconds: 30,
    });

    if (!leaseAcq.ok) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um processo de sincronização em execução ativa para esta integração.",
          bloqueadoPor: leaseAcq.currentOwner,
          expiraEm: leaseAcq.leaseUntil,
        },
        { status: 429 },
      );
    }

    // 7. Parse de opções da requisição
    let batchSize = 20;
    if (typeof body.batchSize === "number" && body.batchSize > 0) {
      batchSize = Math.min(body.batchSize, 50);
    }

    activeDispatches.add(dispatchKey);

    // Monta resolver dinâmico de abas a partir de google_sheets_periodos e periodos
    const sheetsConfig = await db
      .prepare(`SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead FROM google_sheets_periodos WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<{
        aba_docs_face_fea?: string;
        aba_docs_fch_ead?: string;
        aba_base_face_fea?: string;
        aba_base_fch_ead?: string;
      }>();

    const periodoRow = await db
      .prepare(`SELECT codigo FROM periodos WHERE id = ?`)
      .bind(periodoId)
      .first<{ codigo?: string }>();

    const tabNameResolver: TabNameResolver = createTabNameResolver({
      sheetsConfig,
      periodoCodigo: periodoRow?.codigo,
    });

    try {
      // Cria instância do orquestrador com hook de parada operacional graciosa
      const orchestrator = new SyncV2Orchestrator({
        db,
        adapter,
        workerId,
        integrationId: integracao.integration_id,
        batchSize,
        tabNameResolver,
        dryRun: isShadow,
        shouldAbort: async () => {
          const row = await db
            .prepare(`SELECT mode FROM sync_integrations WHERE integration_id = ?`)
            .bind(integracao.integration_id)
            .first<{ mode: string }>();
          return row?.mode === "PAUSED" || row?.mode === "QUARANTINED";
        },
      });

      const batchResult: SyncBatchResult = await orchestrator.executeBatch({
        batchSize,
        dryRun: isShadow,
      });

      // 8. Registro de métricas e auditoria
      await registrarAuditoria(periodoId, {
        acao: "SYNC_V2_DISPATCH",
        entidade: "SYNC_ORCHESTRATOR",
        descricao: `Lote V2 executado pelo worker ${workerId}: ${batchResult.processedCount} processadas, ${batchResult.observedCount} confirmadas, ${batchResult.conflictCount} conflitos, ${batchResult.uncertainCount} incertas, ${batchResult.fencingRejectedCount} fencing rejeitadas, ${batchResult.recoveredLeases.recoveredClaimed} leases recuperadas.`,
      });

      return Response.json({
        sucesso: true,
        periodoId,
        integrationId: integracao.integration_id,
        batchResult,
      });
    } finally {
      activeDispatches.delete(dispatchKey);
      await releaseCoordinatorLease({
        db,
        integrationId: integracao.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 5. POST /inbound — Ingestão Inbound a partir do Google Sheets (Fluxo Inverso)
  // ---------------------------------------------------------------------------
  if (action === "inbound" && request.method === "POST") {
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return Response.json(
        {
          sucesso: false,
          erro: "PARAMETRO_INVALIDO",
          mensagem: "O parâmetro dryRun deve ser booleano.",
        },
        { status: 400 },
      );
    }
    if (
      body.autoCreateMissingAlunos !== undefined &&
      typeof body.autoCreateMissingAlunos !== "boolean"
    ) {
      return Response.json(
        {
          sucesso: false,
          erro: "PARAMETRO_INVALIDO",
          mensagem: "O parâmetro autoCreateMissingAlunos deve ser booleano.",
        },
        { status: 400 },
      );
    }
    if (
      body.groupKey !== undefined &&
      body.groupKey !== "FACE_FEA" &&
      body.groupKey !== "FCH_EAD"
    ) {
      return Response.json(
        {
          sucesso: false,
          erro: "PARAMETRO_INVALIDO",
          mensagem: "O parâmetro groupKey deve ser FACE_FEA ou FCH_EAD.",
        },
        { status: 400 },
      );
    }

    // 1. Verificação de flag mestre
    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "FEATURE_DISABLED",
          mensagem:
            "Sincronização V2 está desativada por configuração (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 503 },
      );
    }

    // 2. Busca e validação da integração
    const integracao = await db
      .prepare(
        `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        integration_id: string;
        periodo_id: number;
        spreadsheet_id: string;
        epoch: number;
        layout_revision: number;
        mode: string;
      }>();

    if (!integracao) {
      return Response.json(
        {
          erro: "INTEGRACAO_NAO_ENCONTRADA",
          mensagem: "Nenhuma integração V2 vinculada a este período.",
        },
        { status: 404 },
      );
    }

    if (integracao.mode === "PAUSED") {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRATION_PAUSED",
          mensagem: `A integração '${integracao.integration_id}' está em pausa operacional.`,
        },
        { status: 409 },
      );
    }

    if (integracao.mode === "QUARANTINED") {
      return Response.json(
        {
          sucesso: false,
          erro: "INTEGRATION_QUARANTINED",
          mensagem: `A integração '${integracao.integration_id}' está em quarentena por inconsistência estrutural.`,
        },
        { status: 409 },
      );
    }

    // 3. Verificação de credenciais / adapter
    let adapter = customAdapter;
    if (!adapter) {
      if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_AUSENTES",
            mensagem:
              "Credenciais de serviço do Google Sheets (GOOGLE_SERVICE_ACCOUNT_JSON) não configuradas no ambiente.",
          },
          { status: 503 },
        );
      }
      try {
        const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error("Campos client_email ou private_key ausentes.");
        }
      } catch (err: any) {
        return Response.json(
          {
            sucesso: false,
            erro: "CREDENCIAIS_INVALIDAS",
            mensagem: `Formato de credenciais inválido: ${err?.message ?? err}`,
          },
          { status: 503 },
        );
      }
      adapter = new GoogleSheetsRealAdapter({
        serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
      });
    }

    // 4. Parse de opções do body (dryRun, targetGroupKey)
    // Em modo SHADOW, dryRun é estritamente forçado como true para impedir mutações no D1
    let dryRun = integracao.mode === "SHADOW";
    let targetGroupKey: GroupKey | undefined;
    let autoCreateMissingAlunos = false;
    if (body.dryRun === true) dryRun = true;
    if (body.autoCreateMissingAlunos === true) autoCreateMissingAlunos = true;
    if (body.groupKey === "FACE_FEA" || body.groupKey === "FCH_EAD") {
      targetGroupKey = body.groupKey;
    }

    // 5. Monta resolver dinâmico de abas a partir de google_sheets_periodos e periodos
    const sheetsConfig = await db
      .prepare(
        `SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        aba_docs_face_fea?: string;
        aba_docs_fch_ead?: string;
        aba_base_face_fea?: string;
        aba_base_fch_ead?: string;
      }>();

    const periodoRow = await db
      .prepare(`SELECT codigo FROM periodos WHERE id = ?`)
      .bind(periodoId)
      .first<{ codigo?: string }>();

    const tabNameResolver: TabNameResolver = createTabNameResolver({
      sheetsConfig,
      periodoCodigo: periodoRow?.codigo,
    });

    const actorId = usuarioAtual?.email || `admin-secret:${periodoId}`;

    const workerId = `inbound-${crypto.randomUUID().slice(0, 8)}`;
    const leaseAcq = await acquireCoordinatorLease({
      db,
      integrationId: integracao.integration_id,
      owner: workerId,
      leaseType: "INBOUND",
      durationSeconds: 30,
    });

    if (!leaseAcq.ok) {
      return Response.json(
        {
          sucesso: false,
          erro: "DESPACHO_EM_ANDAMENTO",
          mensagem:
            "Já existe um processo de sincronização em execução ativa para esta integração.",
          bloqueadoPor: leaseAcq.currentOwner,
          expiraEm: leaseAcq.leaseUntil,
        },
        { status: 429 },
      );
    }

    try {
      const report = await reconcileInboundFromSpreadsheet({
        periodoId,
        integrationId: integracao.integration_id,
        actorId,
        dryRun,
        adapter,
        tabNameResolver,
        db,
        targetGroupKey,
        autoCreateMissingAlunos,
      });

      const persistidos = dryRun ? 0 : report.camposAtualizadosNoD1;
      const planejados = dryRun ? report.camposAtualizadosNoD1 : 0;
      const descMutacoes = dryRun
        ? `${planejados} mutações planejadas (0 persistidas)`
        : `${persistidos} campos persistidos no D1`;

      await registrarAuditoria(periodoId, {
        acao: "SYNC_V2_INBOUND_INGEST",
        entidade: "SYNC_INBOUND",
        descricao: `Ingestão Inbound V2 executada (${dryRun ? "DRY-RUN" : "REAL"}): ${descMutacoes}, ${report.camposEmSincronia} em sincronia, ${report.conflitosDetectados} conflitos detectados, ${report.totalAlunosLidosNaPlanilha} alunos processados na planilha.`,
      });

      return Response.json({
        sucesso: report.sucesso,
        report,
      });
    } finally {
      await releaseCoordinatorLease({
        db,
        integrationId: integracao.integration_id,
        owner: workerId,
        epoch: leaseAcq.epoch,
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 6. POST /schedule-run — Disparo do Ciclo Completo do Scheduler (Fail-Closed)
  // ---------------------------------------------------------------------------
  if (action === "schedule-run" && request.method === "POST") {
    const parsedBody = await lerCorpoJsonOpcional(request);
    if (!parsedBody.ok) return parsedBody.response;

    if (env.SYNC_V2_ENABLED !== "true") {
      return Response.json(
        {
          sucesso: false,
          erro: "SINCRONIZACAO_V2_DESATIVADA",
          mensagem:
            "O processamento V2 está desativado por padrão neste ambiente (SYNC_V2_ENABLED !== 'true').",
        },
        { status: 403 },
      );
    }

    if (env.SYNC_V2_AUTO_ENABLED === "false") {
      return Response.json(
        {
          sucesso: false,
          erro: "SINCRONIZACAO_V2_AUTO_DESATIVADA",
          mensagem:
            "O agendamento automático V2 está explicitamente desativado neste ambiente (SYNC_V2_AUTO_ENABLED === 'false').",
        },
        { status: 403 },
      );
    }

    const report = await runScheduledSyncV2({
      db,
      env: {
        ...env,
        SYNC_V2_ENABLED: "true",
        SYNC_V2_AUTO_ENABLED: env.SYNC_V2_AUTO_ENABLED ?? "true",
      },
      targetPeriodoId: periodoId,
      customAdapter,
      registrarAuditoria: async (pId, evento) => {
        await registrarAuditoria(pId, evento);
      },
    });

    return Response.json({
      sucesso: report.sucesso,
      report,
    });
  }

  return null;
}
