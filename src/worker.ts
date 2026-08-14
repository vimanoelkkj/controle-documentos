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

type RangeGoogle = Awaited<ReturnType<typeof lerRangesGoogle>>[number];

type PendenciaGoogleRow = {
  id: number;
  ra: string;
  operacao: "ATUALIZAR" | "REMOVER";
  payload_json: string | null;
  status: "PENDENTE" | "ENVIANDO" | "CONCLUIDA" | "CONFLITO" | "ERRO";
  atualizado_em: string;
};

type EscritaGoogle = { range: string; values: unknown[][] };

function abaA1(aba: string) {
  return `'${aba.replace(/'/g, "''")}'`;
}

function colunaA1(indice: number) {
  let valor = indice + 1;
  let coluna = "";
  while (valor > 0) {
    valor -= 1;
    coluna = String.fromCharCode(65 + (valor % 26)) + coluna;
    valor = Math.floor(valor / 26);
  }
  return coluna;
}

function chaveCabecalho(valor: unknown) {
  return normalizarComparacao(valor).replace(/[^A-Z0-9]/g, "");
}

function indiceRa(range: RangeGoogle, tipo: "BASE" | "DOCS" | "CANCELADOS") {
  const cabecalho = range.linhas[0] ?? [];
  const encontrados = cabecalho
    .map((valor, indice) => ({ valor: chaveCabecalho(valor), indice }))
    .filter((item) => item.valor === "RA");

  if (encontrados.length !== 1) {
    throw new Error(
      `A aba ${range.aba} precisa ter exatamente uma coluna com o cabeçalho RA.`,
    );
  }

  const indice = encontrados[0].indice;
  if (tipo === "BASE" && indice !== 5) {
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser a coluna F.`);
  }
  if (tipo === "DOCS" && indice !== 0) {
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser a coluna A.`);
  }
  if (tipo === "CANCELADOS" && indice !== 0 && indice !== 5) {
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser A ou F.`);
  }
  return indice;
}

function linhasPorRa(range: RangeGoogle, indice: number) {
  const mapa = new Map<string, number[]>();
  range.linhas.slice(1).forEach((linha, deslocamento) => {
    const ra = normalizarTexto(linha[indice]);
    if (!ra) return;
    const linhas = mapa.get(ra) ?? [];
    linhas.push(deslocamento + 2);
    mapa.set(ra, linhas);
  });
  return mapa;
}

function linhaBaseGoogle(aluno: AlunoRow) {
  return [
    aluno.contrato ? "ENTREGUE" : "",
    aluno.curso,
    aluno.email_outro ?? "",
    aluno.email ?? "",
    aluno.nome,
    aluno.ra,
  ];
}

function linhaDocumentosGoogle(aluno: AlunoRow) {
  return [
    aluno.ra,
    aluno.nome,
    Boolean(aluno.identidade),
    Boolean(aluno.cpf),
    Boolean(aluno.certidao),
    Boolean(aluno.residencia),
    Boolean(aluno.titulo),
    Boolean(aluno.ensino_medio),
    Boolean(aluno.contrato),
  ];
}

function linhaCanceladoGoogle(aluno: AlunoRow, indice: number) {
  if (indice === 5) return linhaBaseGoogle(aluno);
  const linha = Array(Math.max(indice + 1, 1)).fill("");
  linha[indice] = aluno.ra;
  return linha;
}

function escritaLinha(
  aba: string,
  linha: number,
  valores: unknown[],
): EscritaGoogle {
  return {
    range: `${abaA1(aba)}!A${linha}:${colunaA1(valores.length - 1)}${linha}`,
    values: [valores],
  };
}

function limparLinha(range: RangeGoogle, linha: number): EscritaGoogle {
  // A leitura da integração cobre A:K; a remoção limpa o mesmo limite,
  // inclusive quando o cabeçalho tem menos células preenchidas.
  const largura = Math.max(range.linhas[0]?.length ?? 0, 11);
  return escritaLinha(range.aba, linha, Array(largura).fill(""));
}

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


    // =====================================================
    // GET /api/periodos/:id/google-sheets/pendencias
    // Caixa de saida somente leitura. Nao escreve na planilha.
    // =====================================================

    const rotaSheetsPendencias = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets\/pendencias$/,
    );

    if (rotaSheetsPendencias && request.method === "POST") {
      const periodoId = Number(rotaSheetsPendencias[1]);
      if (usuarioAtual?.perfil !== "ADMIN") {
        return Response.json(
          {
            erro: "Apenas administradores podem enviar alterações à planilha.",
          },
          { status: 403 },
        );
      }

      const body = await request.json<{ confirmacao?: string }>();
      if (normalizarComparacao(body.confirmacao) !== "SINCRONIZAR") {
        return Response.json(
          { erro: 'Digite "SINCRONIZAR" para confirmar o envio.' },
          { status: 400 },
        );
      }

      const periodo = await env.DB.prepare(
        `SELECT id, codigo, status FROM periodos WHERE id = ?`,
      )
        .bind(periodoId)
        .first<{ id: number; codigo: string; status: string }>();
      if (!periodo) {
        return Response.json(
          { erro: "Período não encontrado." },
          { status: 404 },
        );
      }
      if (periodo.status !== "ATIVO") {
        return Response.json(
          { erro: "A escrita está bloqueada para períodos arquivados." },
          { status: 409 },
        );
      }

      const config = await env.DB.prepare(
        `SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
        .bind(periodoId)
        .first<SheetsConfig>();
      if (!config) {
        return Response.json(
          { erro: "Configure a planilha deste período primeiro." },
          { status: 409 },
        );
      }

      // Uma execução interrompida pode deixar itens em ENVIANDO. Depois de
      // quinze minutos eles voltam para ERRO e podem ser reenviados de forma
      // idempotente, pois o lote grava o estado desejado mais recente.
      await env.DB.prepare(
        `UPDATE google_sheets_pendencias
         SET status = 'ERRO',
             ultimo_erro = 'Execução anterior interrompida; pronta para nova tentativa.',
             atualizado_em = CURRENT_TIMESTAMP
         WHERE periodo_id = ?
           AND status = 'ENVIANDO'
           AND atualizado_em < datetime('now', '-15 minutes')`,
      )
        .bind(periodoId)
        .run();

      const resultado = await env.DB.prepare(
        `
        SELECT id, ra, operacao, payload_json, status, atualizado_em
        FROM google_sheets_pendencias
        WHERE periodo_id = ? AND status IN ('PENDENTE', 'ERRO', 'CONFLITO')
        ORDER BY id
        LIMIT 200
      `,
      )
        .bind(periodoId)
        .all<PendenciaGoogleRow>();

      if (!resultado.results.length) {
        return Response.json({ sucesso: true, enviados: 0, conflitos: 0 });
      }

      try {
        // A leitura acontece imediatamente antes da escrita para detectar
        // duplicidades, abas trocadas e cabeçalhos incompatíveis.
        const ranges = await lerRangesGoogle(env, config);
        const bases = ranges.slice(0, 2);
        const documentos = ranges.slice(2, 4);
        const cancelados = ranges.slice(4, 6);
        const indicesRa = new Map<string, number>();
        bases.forEach((range) =>
          indicesRa.set(range.aba, indiceRa(range, "BASE")),
        );
        documentos.forEach((range) =>
          indicesRa.set(range.aba, indiceRa(range, "DOCS")),
        );
        cancelados.forEach((range) =>
          indicesRa.set(range.aba, indiceRa(range, "CANCELADOS")),
        );
        const mapas = new Map(
          ranges.map((range) => [
            range.aba,
            linhasPorRa(range, indicesRa.get(range.aba)!),
          ]),
        );
        const proximasLinhas = new Map(
          ranges.map((range) => [
            range.aba,
            Math.max(range.linhas.length + 1, 2),
          ]),
        );
        const escritas: EscritaGoogle[] = [];
        const elegiveis: number[] = [];
        const conflitos: Array<{ id: number; ra: string; erro: string }> = [];

        const ocorrencias = (grupo: RangeGoogle[], ra: string) =>
          grupo.flatMap((range) =>
            (mapas.get(range.aba)?.get(ra) ?? []).map((linha) => ({
              range,
              linha,
            })),
          );
        const novaLinha = (range: RangeGoogle) => {
          const linha = proximasLinhas.get(range.aba)!;
          proximasLinhas.set(range.aba, linha + 1);
          return linha;
        };

        for (const pendencia of resultado.results) {
          try {
            const escritasPendencia: EscritaGoogle[] = [];
            const emBases = ocorrencias(bases, pendencia.ra);
            const emDocumentos = ocorrencias(documentos, pendencia.ra);
            const emCancelados = ocorrencias(cancelados, pendencia.ra);
            if (
              emBases.length > 1 ||
              emDocumentos.length > 1 ||
              emCancelados.length > 1
            ) {
              throw new Error("RA duplicado em uma ou mais abas da planilha.");
            }

            if (pendencia.operacao === "REMOVER") {
              [...emBases, ...emDocumentos, ...emCancelados].forEach(
                ({ range, linha }) =>
                  escritasPendencia.push(limparLinha(range, linha)),
              );
              escritas.push(...escritasPendencia);
              elegiveis.push(pendencia.id);
              continue;
            }

            const aluno = pendencia.payload_json
              ? (JSON.parse(pendencia.payload_json) as AlunoRow)
              : null;
            if (!aluno)
              throw new Error("Payload da pendência está ausente ou inválido.");
            const grupo =
              aluno.unidade === "FACE" || aluno.unidade === "FEA"
                ? 0
                : aluno.unidade === "FCH" || aluno.unidade === "EAD"
                  ? 1
                  : -1;
            if (grupo < 0)
              throw new Error(
                `Unidade ${aluno.unidade || "vazia"} não reconhecida.`,
              );

            const baseDestino = bases[grupo];
            const docsDestino = documentos[grupo];
            const cancelDestino = cancelados[grupo];
            if (emBases[0] && emBases[0].range.aba !== baseDestino.aba) {
              throw new Error(
                `RA encontrado na aba inesperada ${emBases[0].range.aba}.`,
              );
            }
            if (
              emDocumentos[0] &&
              emDocumentos[0].range.aba !== docsDestino.aba
            ) {
              throw new Error(
                `Documentos encontrados na aba inesperada ${emDocumentos[0].range.aba}.`,
              );
            }

            escritasPendencia.push(
              escritaLinha(
                baseDestino.aba,
                emBases[0]?.linha ?? novaLinha(baseDestino),
                linhaBaseGoogle(aluno),
              ),
              escritaLinha(
                docsDestino.aba,
                emDocumentos[0]?.linha ?? novaLinha(docsDestino),
                linhaDocumentosGoogle(aluno),
              ),
            );

            if (aluno.status === "CANCELADO") {
              if (
                emCancelados[0] &&
                emCancelados[0].range.aba !== cancelDestino.aba
              ) {
                throw new Error(
                  `Cancelamento encontrado na aba inesperada ${emCancelados[0].range.aba}.`,
                );
              }
              escritasPendencia.push(
                escritaLinha(
                  cancelDestino.aba,
                  emCancelados[0]?.linha ?? novaLinha(cancelDestino),
                  linhaCanceladoGoogle(
                    aluno,
                    indicesRa.get(cancelDestino.aba)!,
                  ),
                ),
              );
            } else {
              emCancelados.forEach(({ range, linha }) =>
                escritasPendencia.push(limparLinha(range, linha)),
              );
            }
            escritas.push(...escritasPendencia);
            elegiveis.push(pendencia.id);
          } catch (erro) {
            conflitos.push({
              id: pendencia.id,
              ra: pendencia.ra,
              erro:
                erro instanceof Error
                  ? erro.message
                  : "Conflito não identificado.",
            });
          }
        }

        if (conflitos.length) {
          await env.DB.batch(
            conflitos.map((item) =>
              env.DB.prepare(
                `UPDATE google_sheets_pendencias
                 SET status = 'CONFLITO', ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              ).bind(item.erro, item.id),
            ),
          );
        }

        const execucaoId = crypto.randomUUID();
        if (elegiveis.length) {
          await env.DB.batch(
            elegiveis.map((id) =>
              env.DB.prepare(
                `UPDATE google_sheets_pendencias
                 SET status = 'ENVIANDO', tentativas = tentativas + 1,
                     ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = ? AND status IN ('PENDENTE', 'ERRO', 'CONFLITO')`,
              ).bind(execucaoId, id),
            ),
          );
        }
        const reivindicadas = elegiveis.length
          ? await env.DB.prepare(
              `SELECT id FROM google_sheets_pendencias
               WHERE periodo_id = ? AND status = 'ENVIANDO' AND ultimo_erro = ?`,
            )
              .bind(periodoId, execucaoId)
              .all<{ id: number }>()
          : { results: [] as Array<{ id: number }> };
        const idsReivindicados = new Set(
          reivindicadas.results.map((item) => item.id),
        );

        if (idsReivindicados.size !== elegiveis.length) {
          throw new Error(
            "Outra sincronização assumiu parte das pendências. Atualize a prévia.",
          );
        }

        try {
          await escreverValoresGoogle(env, config, escritas);
          if (elegiveis.length) {
            await env.DB.batch(
              elegiveis.map((id) =>
                env.DB.prepare(
                  `UPDATE google_sheets_pendencias
                   SET status = 'CONCLUIDA', ultimo_erro = NULL,
                       atualizado_em = CURRENT_TIMESTAMP
                   WHERE id = ? AND ultimo_erro = ?`,
                ).bind(id, execucaoId),
              ),
            );
          }
        } catch (erro) {
          const mensagem =
            erro instanceof Error
              ? erro.message
              : "Falha ao escrever no Google Sheets.";
          if (elegiveis.length) {
            await env.DB.batch(
              elegiveis.map((id) =>
                env.DB.prepare(
                  `UPDATE google_sheets_pendencias
                   SET status = 'ERRO', ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
                   WHERE id = ? AND ultimo_erro = ?`,
                ).bind(mensagem, id, execucaoId),
              ),
            );
          }
          throw erro;
        }

        await registrarAuditoria(env, usuarioAtual, periodoId, {
          acao: "SINCRONIZAR",
          entidade: "GOOGLE_SHEETS",
          descricao: `${elegiveis.length} pendência(s) enviada(s) à planilha; ${conflitos.length} conflito(s) bloqueado(s).`,
        });
        return Response.json({
          sucesso: true,
          enviados: elegiveis.length,
          conflitos: conflitos.length,
          detalhes_conflitos: conflitos,
        });
      } catch (erro) {
        console.error("Falha na escrita segura do Google Sheets:", erro);
        return Response.json(
          {
            erro:
              erro instanceof Error
                ? erro.message
                : "Não foi possível escrever no Google Sheets.",
          },
          { status: 500 },
        );
      }
    }

    if (rotaSheetsPendencias && request.method === "GET") {
      try {
        const periodoId = Number(rotaSheetsPendencias[1]);
        const resultado = await env.DB.prepare(
          `
          SELECT id, ra, operacao, payload_json, status, tentativas, motivos,
                 ultimo_erro, usuario_nome, usuario_username,
                 criado_em, atualizado_em
          FROM google_sheets_pendencias
          WHERE periodo_id = ? AND status <> 'CONCLUIDA'
          ORDER BY atualizado_em DESC, id DESC
        `,
        )
          .bind(periodoId)
          .all<{
            id: number;
            ra: string;
            operacao: "ATUALIZAR" | "REMOVER";
            payload_json: string | null;
            status: "PENDENTE" | "ENVIANDO" | "CONFLITO" | "ERRO";
            tentativas: number;
            motivos: string;
            ultimo_erro: string | null;
            usuario_nome: string | null;
            usuario_username: string | null;
            criado_em: string;
            atualizado_em: string;
          }>();

        const pendencias = resultado.results.map((item) => {
          let payload: AlunoRow | null = null;
          try {
            payload = item.payload_json
              ? (JSON.parse(item.payload_json) as AlunoRow)
              : null;
          } catch {
            payload = null;
          }
          return {
            id: item.id,
            ra: item.ra,
            operacao: item.operacao,
            status: item.status,
            tentativas: item.tentativas,
            motivos: item.motivos.split("|").filter(Boolean),
            ultimo_erro: item.ultimo_erro,
            usuario_nome: item.usuario_nome,
            usuario_username: item.usuario_username,
            criado_em: item.criado_em,
            atualizado_em: item.atualizado_em,
            aluno: payload
              ? {
                  nome: payload.nome,
                  curso: payload.curso,
                  unidade: payload.unidade,
                  status: payload.status,
                  documentos: {
                    identidade: Boolean(payload.identidade),
                    cpf: Boolean(payload.cpf),
                    certidao: Boolean(payload.certidao),
                    residencia: Boolean(payload.residencia),
                    titulo: Boolean(payload.titulo),
                    ensino_medio: Boolean(payload.ensino_medio),
                    contrato: Boolean(payload.contrato),
                  },
                }
              : null,
          };
        });

        return Response.json({
          modo: "PREVIA_SOMENTE_LEITURA",
          total: pendencias.length,
          atualizar: pendencias.filter((item) => item.operacao === "ATUALIZAR")
            .length,
          remover: pendencias.filter((item) => item.operacao === "REMOVER")
            .length,
          conflitos: pendencias.filter((item) => item.status === "CONFLITO")
            .length,
          erros: pendencias.filter((item) => item.status === "ERRO").length,
          pendencias,
        });
      } catch (erro) {
        console.error("Falha ao listar pendencias do Google Sheets:", erro);
        return Response.json(
          {
            erro: "A caixa de saída ainda não está disponível. Aplique a migration 008.",
          },
          { status: 500 },
        );
      }
    }

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
