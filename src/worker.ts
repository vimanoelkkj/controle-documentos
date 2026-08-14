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
import {
  handleGoogleSheetsConfigRoute,
  type SheetsConfig,
} from "./server/routes/google-sheets-config";
import { handleGoogleSheetsPreviewRoute } from "./server/routes/google-sheets-preview";
import { handleGoogleSheetsSyncRoute } from "./server/routes/google-sheets-sync";
import { handleGoogleSheetsOutboxRoute } from "./server/routes/google-sheets-outbox";
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

type AlunoRow = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function base64Url(valor: ArrayBuffer | string) {
  const bytes =
    typeof valor === "string"
      ? new TextEncoder().encode(valor)
      : new Uint8Array(valor);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemParaArrayBuffer(pem: string) {
  const base64 = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

async function obterTokenGoogle(env: Env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurado no Worker.");
  }
  const conta = JSON.parse(
    env.GOOGLE_SERVICE_ACCOUNT_JSON,
  ) as GoogleServiceAccount;
  const agora = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: conta.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: conta.token_uri || "https://oauth2.googleapis.com/token",
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const chave = await crypto.subtle.importKey(
    "pkcs8",
    pemParaArrayBuffer(conta.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chave,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64Url(assinatura)}`;
  const resposta = await fetch(
    conta.token_uri || "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    },
  );
  if (!resposta.ok)
    throw new Error(`Falha na autenticação Google (${resposta.status}).`);
  const dados = await resposta.json<{ access_token: string }>();
  return dados.access_token;
}

function extrairSpreadsheetId(valor: string) {
  const limpo = valor.trim();
  const match = limpo.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || limpo;
}

function normalizarTexto(valor: unknown) {
  return String(valor ?? "").trim();
}

function normalizarComparacao(valor: unknown) {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function valorBooleano(valor: unknown) {
  if (typeof valor === "boolean") return valor;
  return ["TRUE", "VERDADEIRO", "1", "SIM", "X"].includes(
    normalizarComparacao(valor),
  );
}

async function testarConexaoGoogleSheets(env: Env, config: SheetsConfig) {
  const token = await obterTokenGoogle(env);

  const endpoint =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      config.spreadsheet_id,
    )}` + `?fields=spreadsheetId,properties.title`;

  const resposta = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }

  return resposta.json<{
    spreadsheetId: string;
    properties?: { title?: string };
  }>();
}

async function lerRangesGoogle(env: Env, config: SheetsConfig) {
  const token = await obterTokenGoogle(env);
  const abas = [
    config.aba_base_face_fea,
    config.aba_base_fch_ead,
    config.aba_docs_face_fea,
    config.aba_docs_fch_ead,
    config.aba_cancelados_face_fea,
    config.aba_cancelados_fch_ead,
  ];
  const params = new URLSearchParams();
  for (const aba of abas)
    params.append("ranges", `'${aba.replace(/'/g, "''")}'!A:K`);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    config.spreadsheet_id,
  )}/values:batchGet?${params}`;
  const resposta = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }
  const dados = await resposta.json<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>();
  return abas.map((aba, indice) => ({
    aba,
    linhas: dados.valueRanges?.[indice]?.values ?? [],
  }));
}
type EscritaGoogle = { range: string; values: unknown[][] };


async function escreverValoresGoogle(
  env: Env,
  config: SheetsConfig,
  escritas: EscritaGoogle[],
) {
  if (!escritas.length) return;
  const token = await obterTokenGoogle(env);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    config.spreadsheet_id,
  )}/values:batchUpdate`;
  const resposta = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ valueInputOption: "RAW", data: escritas }),
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }
}

type PeriodoRow = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  criado_em: string;
  atualizado_em: string;
};

function obterCookie(request: Request, nome: string) {
  const cookies = request.headers.get("Cookie") || "";
  for (const parte of cookies.split(";")) {
    const [chave, ...valor] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(valor.join("="));
  }
  return null;
}

async function obterPeriodoAtual(request: Request, env: Env, url: URL) {
  const codigo =
    url.searchParams.get("periodo") || obterCookie(request, "periodo");

  if (codigo) {
    const periodo = await env.DB.prepare(
      `SELECT id, codigo, status, criado_em, atualizado_em FROM periodos WHERE codigo = ?`,
    )
      .bind(codigo)
      .first<PeriodoRow>();
    if (periodo) return periodo;
  }

  return env.DB.prepare(
    `SELECT id, codigo, status, criado_em, atualizado_em FROM periodos ORDER BY CASE status WHEN 'ATIVO' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
  ).first<PeriodoRow>();
}

type EventoAuditoria = {
  acao: string;
  entidade: string;
  descricao: string;
  ra?: string | null;
  unidade?: string | null;
};

async function registrarAuditoria(
  env: Env,
  usuario: UsuarioSessao | null,
  periodoId: number | null,
  evento: EventoAuditoria,
) {
  try {
    await env.DB.prepare(
      `INSERT INTO logs (
        acao, entidade, descricao, ra, unidade, periodo_id,
        usuario_id, usuario_nome, usuario_username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        evento.acao,
        evento.entidade,
        evento.descricao,
        evento.ra || null,
        evento.unidade || null,
        periodoId,
        usuario?.id ?? null,
        usuario?.nome ?? null,
        usuario?.username ?? null,
      )
      .run();
  } catch (erro) {
    console.error("Falha ao registrar auditoria:", erro);
  }
}

async function registrarPendenciaGoogleSheets(
  env: Env,
  usuario: UsuarioSessao | null,
  periodoId: number,
  ra: string,
  operacao: "ATUALIZAR" | "REMOVER" = "ATUALIZAR",
  motivo = "ATUALIZAÇÃO",
) {
  let payload: string | null = null;

  if (operacao === "ATUALIZAR") {
    const aluno = await env.DB.prepare(
      `
      SELECT a.ra, a.nome, a.email, a.email_outro, a.curso, a.unidade, a.status,
             d.identidade, d.cpf, d.certidao, d.residencia, d.titulo,
             d.ensino_medio, d.contrato
      FROM alunos a
      LEFT JOIN documentos d ON d.aluno_id = a.id
      WHERE a.periodo_id = ? AND a.ra = ?
    `,
    )
      .bind(periodoId, ra)
      .first<AlunoRow>();

    if (!aluno) operacao = "REMOVER";
    else payload = JSON.stringify(aluno);
  }

  await env.DB.prepare(
    `
    INSERT INTO google_sheets_pendencias (
      periodo_id, ra, operacao, payload_json, status,
      tentativas, ultimo_erro, usuario_id, usuario_nome, usuario_username, motivos
    ) VALUES (?, ?, ?, ?, 'PENDENTE', 0, NULL, ?, ?, ?, ?)
    ON CONFLICT(periodo_id, ra) DO UPDATE SET
      operacao = excluded.operacao,
      payload_json = excluded.payload_json,
      status = 'PENDENTE',
      tentativas = 0,
      ultimo_erro = NULL,
      usuario_id = excluded.usuario_id,
      usuario_nome = excluded.usuario_nome,
      usuario_username = excluded.usuario_username,
      motivos = CASE
        WHEN instr('|' || google_sheets_pendencias.motivos || '|', '|' || excluded.motivos || '|') > 0
          THEN google_sheets_pendencias.motivos
        WHEN google_sheets_pendencias.motivos = '' THEN excluded.motivos
        ELSE google_sheets_pendencias.motivos || '|' || excluded.motivos
      END,
      atualizado_em = CURRENT_TIMESTAMP
  `,
  )
    .bind(
      periodoId,
      ra,
      operacao,
      payload,
      usuario?.id ?? null,
      usuario?.nome ?? null,
      usuario?.username ?? null,
      motivo,
    )
    .run();
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
          (await obterPeriodoAtual(request, env, url))?.id ?? null,
        registrarAuditoria: (periodoId, evento) =>
          registrarAuditoria(env, usuarioAtual, periodoId, evento),
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
        registrarAuditoria(env, usuarioAtual, periodoId, evento),
    });
    if (respostaPeriodos) return respostaPeriodos;
    const respostaSheetsConfig = await handleGoogleSheetsConfigRoute({
      request,
      url,
      db: env.DB,
      extrairSpreadsheetId,
      normalizarTexto,
      normalizarComparacao,
      testarConexao: (config) => testarConexaoGoogleSheets(env, config),
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env, usuarioAtual, periodoId, evento),
    });
    if (respostaSheetsConfig) return respostaSheetsConfig;
    const respostaSheetsPreview = await handleGoogleSheetsPreviewRoute({
      request,
      url,
      db: env.DB,
      modoApresentacao:
        Boolean(usuarioAtual) && emModoApresentacao(usuarioAtual!),
      lerRanges: (config) => lerRangesGoogle(env, config),
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
      lerRanges: (config) => lerRangesGoogle(env, config),
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
        (await obterPeriodoAtual(request, env, url))?.id ?? null,
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env, usuarioAtual, periodoId, evento),
    });
    if (respostaBackup) return respostaBackup;


    const periodoAtual = url.pathname.startsWith("/api/")
      ? await obterPeriodoAtual(request, env, url)
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
      lerRanges: (config) => lerRangesGoogle(env, config),
      escreverValores: (config, escritas) =>
        escreverValoresGoogle(env, config, escritas),
      registrarAuditoria: (periodoId, evento) =>
        registrarAuditoria(env, usuarioAtual, periodoId, evento),
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
        registrarAuditoria(env, usuarioAtual!, periodoAtual!.id, evento),
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
          env,
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
          env,
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
          env,
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
          env,
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
