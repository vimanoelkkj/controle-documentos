import type { UsuarioSessao } from "./auth";
import {
  SyncV2Orchestrator,
  type SyncBatchResult,
} from "../services/sync-orchestrator";
import {
  GoogleSheetsRealAdapter,
} from "../services/sync-sheet-real-adapter";
import type { ISyncSpreadsheetAdapter } from "../services/sync-sheet-contracts";

export interface SyncV2AdminDependencies {
  request: Request;
  url: URL;
  db: D1Database;
  env: {
    SYNC_V2_ENABLED?: string;
    SYNC_V2_ADMIN_SECRET?: string;
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

/**
 * Valida autorização da requisição administrativa:
 * Exige usuário com privilégio de escrita OU secret administrativo no header.
 */
function estaAutorizado(
  request: Request,
  usuarioAtual: UsuarioSessao | null,
  podeEditar: boolean,
  adminSecretConfigurado?: string,
): boolean {
  if (usuarioAtual && podeEditar) {
    return true;
  }
  const secretHeader = request.headers.get("X-Sync-Admin-Secret");
  if (
    adminSecretConfigurado &&
    secretHeader &&
    secretHeader === adminSecretConfigurado
  ) {
    return true;
  }
  return false;
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
    podeEditar,
    registrarAuditoria,
    customAdapter,
  } = deps;

  const match = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/sync-v2\/(status|dispatch|pause|resume)$/,
  );
  if (!match) return null;

  const periodoId = Number(match[1]);
  const action = match[2];

  // ---------------------------------------------------------------------------
  // 1. GET /status — Consulta de Saúde e Prontidão
  // ---------------------------------------------------------------------------
  if (action === "status" && request.method === "GET") {
    if (!usuarioAtual) {
      return Response.json(
        { erro: "Não autenticado." },
        { status: 401 },
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

    // Métricas operacionais do D1
    const operacoesPorEstado = await db
      .prepare(
        `SELECT state, count(*) as total
         FROM sync_operations
         GROUP BY state`,
      )
      .all<{ state: string; total: number }>();

    const operacoesMetrics: Record<string, number> = {};
    for (const r of operacoesPorEstado.results || []) {
      operacoesMetrics[r.state] = r.total;
    }

    const camposState = await db
      .prepare(
        `SELECT status, count(*) as total
         FROM sync_field_state
         GROUP BY status`,
      )
      .all<{ status: string; total: number }>();

    const camposMetrics: Record<string, number> = {};
    for (const r of camposState.results || []) {
      camposMetrics[r.status] = r.total;
    }

    const conflitosAbertos = await db
      .prepare(
        `SELECT count(*) as total FROM sync_conflicts WHERE resolved = 0`,
      )
      .first<{ total: number }>();

    const unbaselinedCount = camposMetrics["UNBASELINED"] ?? 0;
    if (unbaselinedCount > 0) {
      motivosBloqueio.push(`Existem ${unbaselinedCount} campos sem baseline estabelecida (UNBASELINED).`);
    }

    const readyForDispatch =
      enabled &&
      tablesExist &&
      Boolean(integracao) &&
      !["LEGACY", "PAUSED", "QUARANTINED"].includes(integracao?.mode ?? "") &&
      credentialsConfigured;

    return Response.json({
      sucesso: true,
      status: {
        enabled,
        environment: env.ENVIRONMENT || "production",
        tablesExist,
        credentialsConfigured,
        integracao,
        metrics: {
          operations: operacoesMetrics,
          fieldStates: camposMetrics,
          openConflicts: conflitosAbertos?.total ?? 0,
        },
        readyForDispatch,
        motivosBloqueio,
      },
    });
  }

  // Para endpoints modificadores (dispatch, pause, resume), exige autorização de escrita
  if (!estaAutorizado(request, usuarioAtual, podeEditar, env.SYNC_V2_ADMIN_SECRET)) {
    return Response.json(
      { erro: "Acesso não autorizado para operação de sincronização V2." },
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. POST /pause — Parada Operacional Imediata
  // ---------------------------------------------------------------------------
  if (action === "pause" && request.method === "POST") {
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

    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_PARADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: `Integração '${integracao.integration_id}' colocada em PAUSED por parada operacional.`,
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
        `UPDATE sync_integrations SET mode = 'BIDIRECTIONAL', updated_at = CURRENT_TIMESTAMP WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .run();

    await registrarAuditoria(periodoId, {
      acao: "SYNC_V2_RETOMADA_OPERACIONAL",
      entidade: "SYNC_INTEGRATION",
      descricao: `Integração '${integracao.integration_id}' retomada para modo BIDIRECTIONAL.`,
    });

    return Response.json({
      sucesso: true,
      modo: "BIDIRECTIONAL",
      mensagem: "Integração retomada para modo BIDIRECTIONAL com sucesso.",
    });
  }

  // ---------------------------------------------------------------------------
  // 4. POST /dispatch — Despacho Controlado de Lote V2
  // ---------------------------------------------------------------------------
  if (action === "dispatch" && request.method === "POST") {
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
      });
    }

    // 6. Prevenção de simultaneidade descontrolada (mesmo isolate)
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

    // 7. Parse de opções da requisição
    let batchSize = 20;
    try {
      const body = (await request.json().catch(() => ({}))) as any;
      if (body && typeof body.batchSize === "number" && body.batchSize > 0) {
        batchSize = Math.min(body.batchSize, 50);
      }
    } catch {
      // Ignora erro de parse de body
    }

    activeDispatches.add(dispatchKey);
    const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

    try {
      // Cria instância do orquestrador com hook de parada operacional graciosa
      const orchestrator = new SyncV2Orchestrator({
        db,
        adapter,
        workerId,
        integrationId: integracao.integration_id,
        batchSize,
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
    }
  }

  return null;
}
