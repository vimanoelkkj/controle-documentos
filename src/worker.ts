/// <reference path="../worker-configuration.d.ts" />

import { handleCursosRoute } from "./server/routes/cursos";
import { handlePeriodosRoute } from "./server/routes/periodos";
import { handleUsuariosRoute } from "./server/routes/usuarios";
import { handleCancelamentosRoute } from "./server/routes/cancelamentos";
import { handleDocumentosRoute } from "./server/routes/documentos";
import { handleAlunosRoute } from "./server/routes/alunos";
import { handleImportacaoAlunosRoute } from "./server/routes/importacao-alunos";
import { handleLogsRoute } from "./server/routes/logs";
import { handleComunicacoesRoute } from "./server/routes/comunicacoes";
import { handleBackupRoute } from "./server/routes/backup";
import { handleDevToolsRoute } from "./server/routes/dev-tools";
import { handleGoogleSheetsConfigRoute } from "./server/routes/google-sheets-config";
import { handleGoogleSheetsPreviewRoute } from "./server/routes/google-sheets-preview";
import { handleGoogleSheetsSyncRoute } from "./server/routes/google-sheets-sync";
import { handleGoogleSheetsOutboxRoute } from "./server/routes/google-sheets-outbox";
import {
  escreverValoresGoogle,
  extrairSpreadsheetId,
  lerRangesGoogle,
  normalizarComparacao,
  normalizarTexto,
  testarConexaoGoogleSheets,
  valorBooleano,
} from "./server/services/google-sheets";
import { obterPeriodoAtual } from "./server/services/periodo-context";
import { registrarAuditoria } from "./server/services/auditoria";
import { registrarPendenciaGoogleSheets } from "./server/services/google-sheets-pendencias";
import {
  AuthStorageUnavailableError,
  handleAuthRoute,
  hashSenha,
  respostaAuthTemporariamenteIndisponivel,
  usuarioDaRequisicao,
  type UsuarioSessao,
} from "./server/routes/auth";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  D1_DATABASE_ID?: string;
  ENVIRONMENT?: string;
}
function emModoApresentacao(usuario: UsuarioSessao) {
  return usuario.modo_apresentacao === 1;
}

function podeEditar(usuario: UsuarioSessao) {
  return (
    !emModoApresentacao(usuario) &&
    (usuario.perfil === "ADMIN" || usuario.perfil === "EDITOR")
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const authResponse = await handleAuthRoute(request, env, url);
    if (authResponse) return authResponse;

    let usuarioAtual: UsuarioSessao | null = null;
    if (url.pathname.startsWith("/api/")) {
      try {
        usuarioAtual = await usuarioDaRequisicao(request, env);
      } catch (erro) {
        if (erro instanceof AuthStorageUnavailableError) {
          return respostaAuthTemporariamenteIndisponivel();
        }
        throw erro;
      }

      if (!usuarioAtual) {
        return Response.json(
          { erro: "Sessão expirada ou não autenticada." },
          { status: 401 },
        );
      }

      const metodoMutavel = ["POST", "PUT", "PATCH", "DELETE"].includes(
        request.method,
      );

      const rotaPermitidaNoModoApresentacao =
        url.pathname === "/api/auth/logout" ||
        url.pathname === "/api/auth/atividade" ||
        /^\/api\/periodos\/\d+\/google-sheets\/previa$/.test(url.pathname);

      if (
        emModoApresentacao(usuarioAtual) &&
        metodoMutavel &&
        !rotaPermitidaNoModoApresentacao
      ) {
        return Response.json(
          {
            erro: "Ação indisponível no modo apresentação.",
          },
          {
            status: 403,
          },
        );
      }

      const rotaSensivelNoModoApresentacao =
        (url.pathname === "/api/log" && request.method === "GET") ||
        (request.method === "GET" &&
          /^\/api\/periodos\/\d+\/google-sheets\/pendencias$/.test(
            url.pathname,
          ));

      if (
        emModoApresentacao(usuarioAtual) &&
        rotaSensivelNoModoApresentacao
      ) {
        return Response.json(
          { erro: "Conteúdo indisponível no modo apresentação." },
          { status: 403 },
        );
      }

      const respostaUsuarios = await handleUsuariosRoute({
        request,
        url,
        db: env.DB,
        usuarioAtual,
        hashSenha,
        obterPeriodoAuditoriaId: async () =>
          (await obterPeriodoAtual(request, env.DB, url))?.id ?? null,
        registrarAuditoria: (periodoId, evento) =>
          registrarAuditoria(env.DB, usuarioAtual, periodoId, evento),
      });
      if (respostaUsuarios) return respostaUsuarios;

      const rotaSomenteLeituraViaPost =
        /^\/api\/periodos\/\d+\/google-sheets\/previa$/.test(url.pathname);

      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !rotaSomenteLeituraViaPost &&
        !podeEditar(usuarioAtual)
      ) {
        return Response.json(
          { erro: "Seu perfil é somente visualização." },
          { status: 403 },
        );
      }
    }

    // =====================================================
    // PERÍODOS LETIVOS
    // =====================================================

    const respostaPeriodos = await handlePeriodosRoute({
      request,
      url,
      db: env.DB,
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env.DB, usuarioAtual, periodoId, evento),
    });
    if (respostaPeriodos) return respostaPeriodos;
    const respostaSheetsConfig = await handleGoogleSheetsConfigRoute({
      request,
      url,
      db: env.DB,
      extrairSpreadsheetId,
      normalizarTexto,
      normalizarComparacao,
      testarConexao: (config) =>
        testarConexaoGoogleSheets(env.GOOGLE_SERVICE_ACCOUNT_JSON, config),
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env.DB, usuarioAtual, periodoId, evento),
    });
    if (respostaSheetsConfig) return respostaSheetsConfig;
    const respostaSheetsPreview = await handleGoogleSheetsPreviewRoute({
      request,
      url,
      db: env.DB,
      modoApresentacao:
        Boolean(usuarioAtual) && emModoApresentacao(usuarioAtual!),
      lerRanges: (config) =>
        lerRangesGoogle(env.GOOGLE_SERVICE_ACCOUNT_JSON, config),
      normalizarTexto,
      normalizarComparacao,
      valorBooleano,
    });
    if (respostaSheetsPreview) return respostaSheetsPreview;
    const respostaSheetsSync = await handleGoogleSheetsSyncRoute({
      request,
      url,
      db: env.DB,
      usuarioAtual,
      podeEditar: Boolean(usuarioAtual) && podeEditar(usuarioAtual!),
      lerRanges: (config) =>
        lerRangesGoogle(env.GOOGLE_SERVICE_ACCOUNT_JSON, config),
      normalizarTexto,
      normalizarComparacao,
      valorBooleano,
    });
    if (respostaSheetsSync) return respostaSheetsSync;

    const respostaBackup = await handleBackupRoute({
      request,
      url,
      env,
      usuarioAtual,
      obterPeriodoAuditoriaId: async () =>
        (await obterPeriodoAtual(request, env.DB, url))?.id ?? null,
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env.DB, usuarioAtual, periodoId, evento),
    });
    if (respostaBackup) return respostaBackup;


    const periodoAtual = url.pathname.startsWith("/api/")
      ? await obterPeriodoAtual(request, env.DB, url)
      : null;

    if (
      url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/api/periodos") &&
      !periodoAtual
    ) {
      return Response.json(
        {
          erro: "Nenhum período letivo disponível. Crie ou migre um período antes de continuar.",
        },
        { status: 409 },
      );
    }
    const respostaDevTools = await handleDevToolsRoute({
      request,
      url,
      env,
      usuarioAtual,
      periodoAtual,
    });
    if (respostaDevTools) return respostaDevTools;



    const respostaSheetsOutbox = await handleGoogleSheetsOutboxRoute({
      request,
      url,
      db: env.DB,
      usuarioAtual,
      normalizarTexto,
      normalizarComparacao,
      lerRanges: (config) =>
        lerRangesGoogle(env.GOOGLE_SERVICE_ACCOUNT_JSON, config),
      escreverValores: (config, escritas) =>
        escreverValoresGoogle(
          env.GOOGLE_SERVICE_ACCOUNT_JSON,
          config,
          escritas,
        ),
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env.DB, usuarioAtual, periodoId, evento),
    });
    if (respostaSheetsOutbox) return respostaSheetsOutbox;

    const respostaLogs = await handleLogsRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      usuario: usuarioAtual
        ? {
            id: usuarioAtual.id,
            nome: usuarioAtual.nome,
            username: usuarioAtual.username,
          }
        : null,
    });
    if (respostaLogs) return respostaLogs;
    const respostaCursos = await handleCursosRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      podeEditar: podeEditar(usuarioAtual!),
      registrarAuditoria: (evento) =>
        registrarAuditoria(env.DB, usuarioAtual!, periodoAtual!.id, evento),
    });
    if (respostaCursos) return respostaCursos;

    // =====================================================
    const respostaAlunos = await handleAlunosRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      modoApresentacao:
        Boolean(usuarioAtual) && emModoApresentacao(usuarioAtual!),
      registrarPendencia: (ra, tipo, motivo) =>
        registrarPendenciaGoogleSheets(
          env.DB,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          tipo,
          motivo,
        ),
    });
    if (respostaAlunos) return respostaAlunos;

    // =====================================================
    const respostaImportacaoAlunos = await handleImportacaoAlunosRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      registrarPendencia: (ra, motivo) =>
        registrarPendenciaGoogleSheets(
          env.DB,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          "ATUALIZAR",
          motivo,
        ),
    });
    if (respostaImportacaoAlunos) return respostaImportacaoAlunos;
    // =====================================================
    const respostaCancelamentos = await handleCancelamentosRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      registrarPendencia: (ra) =>
        registrarPendenciaGoogleSheets(
          env.DB,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          "ATUALIZAR",
          "STATUS",
        ),
    });
    if (respostaCancelamentos) return respostaCancelamentos;

    // =====================================================
    const respostaDocumentos = await handleDocumentosRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      registrarPendencia: (ra) =>
        registrarPendenciaGoogleSheets(
          env.DB,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          "ATUALIZAR",
          "DOCUMENTOS",
        ),
    });
    if (respostaDocumentos) return respostaDocumentos;

    const respostaComunicacoes = await handleComunicacoesRoute({
      request,
      url,
      db: env.DB,
      periodoId: periodoAtual!.id,
      modoApresentacao:
        Boolean(usuarioAtual) && emModoApresentacao(usuarioAtual!),
    });
    if (respostaComunicacoes) return respostaComunicacoes;
    // =====================================================
    // React / assets
    // =====================================================

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
