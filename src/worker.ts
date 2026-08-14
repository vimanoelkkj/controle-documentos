/// <reference path="../worker-configuration.d.ts" />

import { handleCursosRoute } from "./server/routes/cursos";
import { handlePeriodosRoute } from "./server/routes/periodos";
import { handleUsuariosRoute } from "./server/routes/usuarios";
import { handleCancelamentosRoute } from "./server/routes/cancelamentos";

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

type DadosAluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email?: string;
  email_outro?: string;
  documentos?: DocumentosBody;
};

type DocumentosBody = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

type SheetsConfig = {
  periodo_id: number;
  spreadsheet_id: string;
  aba_base_face_fea: string;
  aba_base_fch_ead: string;
  aba_docs_face_fea: string;
  aba_docs_fch_ead: string;
  aba_cancelados_face_fea: string;
  aba_cancelados_fch_ead: string;
  atualizado_em?: string;
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

type PerfilUsuario = "ADMIN" | "EDITOR" | "VISUALIZADOR";

type UsuarioSessao = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: PerfilUsuario;
  ativo: number;
  modo_apresentacao: number;
};

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

function bytesHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hashSenha(senha: string, saltHex?: string) {
  const salt = saltHex
    ? hexBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    chave,
    256,
  );
  return { hash: bytesHex(new Uint8Array(bits)), salt: bytesHex(salt) };
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesHex(new Uint8Array(digest));
}

const DURACAO_SESSAO_SEGUNDOS = 60 * 60;

function cookieSessao(
  token: string,
  request: Request,
  maxAge = DURACAO_SESSAO_SEGUNDOS,
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return `cd_session=${encodeURIComponent(
    token,
  )}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

class AuthStorageUnavailableError extends Error {
  constructor(causa?: unknown) {
    super("O banco de autenticação está temporariamente indisponível.");
    this.name = "AuthStorageUnavailableError";
    if (causa)
      console.error("Falha temporária no D1 durante autenticação:", causa);
  }
}

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EstadoExportacaoD1 = {
  at_bookmark?: string;
  status?: "complete" | "error";
  error?: string;
  result?: {
    filename?: string;
    signed_url?: string;
  };
};

type RespostaCloudflare<T> = {
  success: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
};

async function solicitarExportacaoD1(env: Env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const databaseId = env.D1_DATABASE_ID?.trim();

  if (!accountId || !apiToken || !databaseId) {
    throw new Error("O backup online ainda nao foi configurado no Worker.");
  }

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId,
    )}` + `/d1/database/${encodeURIComponent(databaseId)}/export`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  let bookmark: string | undefined;

  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const resposta = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        output_format: "polling",
        ...(bookmark ? { current_bookmark: bookmark } : {}),
      }),
    });

    const dados =
      (await resposta.json()) as RespostaCloudflare<EstadoExportacaoD1>;

    if (!resposta.ok || !dados.success || !dados.result) {
      const detalhe = dados.errors
        ?.map((erro) => erro.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(detalhe || "A Cloudflare recusou a exportacao do D1.");
    }

    bookmark = dados.result.at_bookmark || bookmark;

    if (dados.result.status === "error") {
      throw new Error(dados.result.error || "A exportacao do D1 falhou.");
    }

    if (dados.result.status === "complete") {
      const arquivo = dados.result.result?.filename;
      const downloadUrl = dados.result.result?.signed_url;
      if (!arquivo || !downloadUrl)
        throw new Error(
          "A exportacao terminou sem fornecer o arquivo para download.",
        );

      return { arquivo, downloadUrl };
    }

    if (!bookmark)
      throw new Error(
        "A Cloudflare nao forneceu o identificador da exportacao.",
      );

    await aguardar(1000);
  }

  throw new Error(
    "O backup demorou mais que o esperado. Tente novamente em instantes.",
  );
}

async function usuarioDaRequisicao(request: Request, env: Env) {
  const token = obterCookie(request, "cd_session");
  if (!token) return null;

  const tokenHash = await hashToken(token);

  // O D1/Miniflare pode ocasionalmente responder com erro interno transitório.
  // Uma nova tentativa curta evita transformar uma falha momentânea em logout/500.
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      return await env.DB.prepare(
        `
        SELECT u.id, u.nome, u.email, u.username, u.perfil, u.ativo,
        u.modo_apresentacao
 FROM sessoes s
 JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ?
          AND s.expira_em > CURRENT_TIMESTAMP
          AND u.ativo = 1
      `,
      )
        .bind(tokenHash)
        .first<UsuarioSessao>();
    } catch (erro) {
      if (tentativa === 2) {
        throw new AuthStorageUnavailableError(erro);
      }

      await aguardar(150);
    }
  }

  return null;
}

function respostaAuthTemporariamenteIndisponivel() {
  return Response.json(
    {
      erro: "Autenticação temporariamente indisponível. Tente novamente em alguns instantes.",
      codigo: "AUTH_STORAGE_UNAVAILABLE",
      temporario: true,
    },
    {
      status: 503,
      headers: {
        "Retry-After": "2",
      },
    },
  );
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

function ambienteDesenvolvimento(request: Request, env: Env) {
  const hostname = new URL(request.url).hostname.toLowerCase();

  return (
    env.ENVIRONMENT?.toLowerCase() === "dev" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // =====================================================
    // AUTENTICAÇÃO E CONTROLE DE ACESSO
    // =====================================================
    if (url.pathname === "/api/auth/bootstrap" && request.method === "GET") {
      try {
        const total = await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM usuarios`,
        ).first<{ total: number }>();
        return Response.json({ necessario: Number(total?.total || 0) === 0 });
      } catch {
        return Response.json(
          {
            erro: "Autenticação indisponível. Execute a migration 005_auth.sql.",
          },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/api/auth/bootstrap" && request.method === "POST") {
      const total = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM usuarios`,
      ).first<{ total: number }>();
      if (Number(total?.total || 0) !== 0)
        return Response.json(
          { erro: "O administrador inicial já foi criado." },
          { status: 409 },
        );
      const body = await request.json<{
        nome?: string;
        email?: string;
        username?: string;
        senha?: string;
      }>();
      const nome = body.nome?.trim();
      const email = body.email?.trim().toLowerCase();
      const username = body.username?.trim().toLowerCase();
      const senha = body.senha || "";
      if (!nome || !email || !username || senha.length < 8)
        return Response.json(
          {
            erro: "Informe nome, usuário, e-mail e uma senha com pelo menos 8 caracteres.",
          },
          { status: 400 },
        );
      if (!/^[a-z0-9._-]{3,40}$/i.test(username))
        return Response.json(
          {
            erro: "O nome de usuário deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou underline.",
          },
          { status: 400 },
        );
      const cred = await hashSenha(senha);
      try {
        await env.DB.prepare(
          `INSERT INTO usuarios (nome, email, username, senha_hash, senha_salt, perfil, ativo) VALUES (?, ?, ?, ?, ?, 'ADMIN', 1)`,
        )
          .bind(nome, email, username, cred.hash, cred.salt)
          .run();
      } catch {
        return Response.json(
          { erro: "E-mail ou nome de usuário já cadastrado." },
          { status: 409 },
        );
      }
      return Response.json({ sucesso: true }, { status: 201 });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await request.json<{
        identificador?: string;
        email?: string;
        senha?: string;
      }>();

      const identificador = (body.identificador || body.email || "")
        .trim()
        .toLowerCase();

      const senha = body.senha || "";

      const usuario = identificador
        ? await env.DB.prepare(
            `SELECT id, nome, email, username, perfil, ativo, modo_apresentacao,
          senha_hash, senha_salt
   FROM usuarios
   WHERE email = ? OR username = ?
   LIMIT 1`,
          )
            .bind(identificador, identificador)
            .first<UsuarioSessao & { senha_hash: string; senha_salt: string }>()
        : null;

      if (!usuario || !usuario.ativo) {
        return Response.json(
          { erro: "Usuário/e-mail ou senha inválidos." },
          { status: 401 },
        );
      }

      const cred = await hashSenha(senha, usuario.senha_salt);

      if (cred.hash !== usuario.senha_hash) {
        return Response.json(
          { erro: "Usuário/e-mail ou senha inválidos." },
          { status: 401 },
        );
      }

      const token = bytesHex(crypto.getRandomValues(new Uint8Array(32)));

      const tokenHash = await hashToken(token);

      await env.DB.prepare(
        `DELETE FROM sessoes
     WHERE expira_em <= CURRENT_TIMESTAMP`,
      ).run();

      await env.DB.prepare(
        `INSERT INTO sessoes (
      usuario_id,
      token_hash,
      expira_em
    )
    VALUES (?, ?, datetime('now', '+1 hour'))`,
      )
        .bind(usuario.id, tokenHash)
        .run();

      return Response.json(
        {
          usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            username: usuario.username,
            perfil: usuario.perfil,
            modo_apresentacao: usuario.modo_apresentacao,
          },
        },
        {
          headers: {
            "Set-Cookie": cookieSessao(token, request),
          },
        },
      );
    }

    if (url.pathname === "/api/auth/atividade" && request.method === "POST") {
      try {
        const token = obterCookie(request, "cd_session");

        if (!token) {
          return Response.json({ erro: "Não autenticado." }, { status: 401 });
        }

        const tokenHash = await hashToken(token);

        const resultado = await env.DB.prepare(
          `UPDATE sessoes
       SET expira_em = datetime('now', '+1 hour')
       WHERE token_hash = ?
         AND expira_em > CURRENT_TIMESTAMP`,
        )
          .bind(tokenHash)
          .run();

        if (!resultado.meta.changes) {
          return Response.json(
            { erro: "Sessão expirada." },
            {
              status: 401,
              headers: {
                "Set-Cookie": cookieSessao("", request, 0),
              },
            },
          );
        }

        return Response.json(
          { sucesso: true },
          {
            headers: {
              "Set-Cookie": cookieSessao(token, request),
            },
          },
        );
      } catch (erro) {
        if (erro instanceof AuthStorageUnavailableError) {
          return respostaAuthTemporariamenteIndisponivel();
        }

        throw erro;
      }
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const token = obterCookie(request, "cd_session");

      if (token) {
        await env.DB.prepare(`DELETE FROM sessoes WHERE token_hash = ?`)
          .bind(await hashToken(token))
          .run();
      }

      return Response.json(
        { sucesso: true },
        {
          headers: {
            "Set-Cookie": cookieSessao("", request, 0),
          },
        },
      );
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      try {
        const usuario = await usuarioDaRequisicao(request, env);
        if (!usuario)
          return Response.json({ erro: "Não autenticado." }, { status: 401 });

        return Response.json({
          usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            username: usuario.username,
            perfil: usuario.perfil,
            modo_apresentacao: usuario.modo_apresentacao,
          },
        });
      } catch (erro) {
        if (erro instanceof AuthStorageUnavailableError) {
          return respostaAuthTemporariamenteIndisponivel();
        }
        throw erro;
      }
    }

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

    const rotaSheetsStatus = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets\/status$/,
    );

    if (rotaSheetsStatus && request.method === "GET") {
      const periodoId = Number(rotaSheetsStatus[1]);

      const config = await env.DB.prepare(
        `SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
        .bind(periodoId)
        .first<SheetsConfig>();

      if (!config) {
        return Response.json({
          configurado: false,
          conectado: false,
          spreadsheet_id: null,
          titulo: null,
          erro: null,
        });
      }

      try {
        const planilha = await testarConexaoGoogleSheets(env, config);

        return Response.json({
          configurado: true,
          conectado: true,
          spreadsheet_id: config.spreadsheet_id,
          titulo: planilha.properties?.title || null,
          erro: null,
        });
      } catch (erro) {
        console.error("Falha ao testar conexão com Google Sheets.", erro);

        return Response.json({
          configurado: true,
          conectado: false,
          spreadsheet_id: config.spreadsheet_id,
          titulo: null,
          erro:
            erro instanceof Error
              ? erro.message
              : "Não foi possível validar a conexão com o Google Sheets.",
        });
      }
    }

    const rotaSheetsConfig = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets$/,
    );
    if (rotaSheetsConfig && request.method === "GET") {
      const periodoId = Number(rotaSheetsConfig[1]);
      let ultimoErro: unknown = null;

      for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
        try {
          const config = await env.DB.prepare(
            `SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`,
          )
            .bind(periodoId)
            .first<SheetsConfig>();

          return Response.json(config ?? null);
        } catch (erro) {
          ultimoErro = erro;
          console.warn(
            `Falha temporária ao ler configuração do Google Sheets (tentativa ${tentativa}/3).`,
            erro,
          );

          if (tentativa < 3) {
            await aguardar(tentativa * 200);
          }
        }
      }

      console.error(
        "D1 indisponível ao carregar configuração do Google Sheets.",
        ultimoErro,
      );
      return Response.json(
        {
          erro: "Configuração do Google Sheets temporariamente indisponível.",
          codigo: "SHEETS_CONFIG_STORAGE_UNAVAILABLE",
        },
        { status: 503 },
      );
    }

    if (rotaSheetsConfig && request.method === "PUT") {
      try {
        const periodoId = Number(rotaSheetsConfig[1]);
        const body = await request.json<
          Omit<SheetsConfig, "periodo_id"> & { spreadsheet_id: string }
        >();
        const spreadsheetId = extrairSpreadsheetId(body.spreadsheet_id || "");
        const campos = [
          spreadsheetId,
          body.aba_base_face_fea,
          body.aba_base_fch_ead,
          body.aba_docs_face_fea,
          body.aba_docs_fch_ead,
          body.aba_cancelados_face_fea,
          body.aba_cancelados_fch_ead,
        ].map(normalizarTexto);
        if (campos.some((campo) => !campo))
          return Response.json(
            { erro: "Preencha a planilha e as seis abas da integração." },
            { status: 400 },
          );
        await env.DB.prepare(
          `
          INSERT INTO google_sheets_periodos (
            periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
            aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(periodo_id) DO UPDATE SET
            spreadsheet_id = excluded.spreadsheet_id,
            aba_base_face_fea = excluded.aba_base_face_fea,
            aba_base_fch_ead = excluded.aba_base_fch_ead,
            aba_docs_face_fea = excluded.aba_docs_face_fea,
            aba_docs_fch_ead = excluded.aba_docs_fch_ead,
            aba_cancelados_face_fea = excluded.aba_cancelados_face_fea,
            aba_cancelados_fch_ead = excluded.aba_cancelados_fch_ead,
            atualizado_em = CURRENT_TIMESTAMP
        `,
        )
          .bind(periodoId, ...campos)
          .run();
        await registrarAuditoria(env, usuarioAtual, periodoId, {
          acao: "CONFIGURAR",
          entidade: "GOOGLE_SHEETS",
          descricao: "Configuração da planilha e nomes das abas atualizados.",
        });
        return Response.json({ sucesso: true, spreadsheet_id: spreadsheetId });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível salvar a integração com Google Sheets." },
          { status: 500 },
        );
      }
    }

    const rotaSheetsMapeamentos = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets\/mapeamentos$/,
    );
    if (rotaSheetsMapeamentos && request.method === "GET") {
      const periodoId = Number(rotaSheetsMapeamentos[1]);
      const dados = await env.DB.prepare(
        `
        SELECT curso, unidade FROM google_sheets_mapeamentos WHERE periodo_id = ? ORDER BY curso
      `,
      )
        .bind(periodoId)
        .all<{ curso: string; unidade: string }>();
      return Response.json(dados.results);
    }

    if (rotaSheetsMapeamentos && request.method === "PUT") {
      try {
        const periodoId = Number(rotaSheetsMapeamentos[1]);
        const body = await request.json<{ curso?: string; unidade?: string }>();
        const curso = normalizarTexto(body.curso);
        const cursoChave = normalizarComparacao(curso);
        const unidade = normalizarComparacao(body.unidade);
        if (!curso || !["FACE", "FEA", "FCH", "EAD"].includes(unidade)) {
          return Response.json(
            { erro: "Informe um curso e uma unidade válida." },
            { status: 400 },
          );
        }
        await env.DB.prepare(
          `
          INSERT INTO google_sheets_mapeamentos (periodo_id, curso_chave, curso, unidade, atualizado_em)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(periodo_id, curso_chave) DO UPDATE SET
            curso = excluded.curso, unidade = excluded.unidade, atualizado_em = CURRENT_TIMESTAMP
        `,
        )
          .bind(periodoId, cursoChave, curso, unidade)
          .run();
        await registrarAuditoria(env, usuarioAtual, periodoId, {
          acao: "MAPEAR_UNIDADE",
          entidade: "GOOGLE_SHEETS",
          descricao: `Curso ${curso} mapeado para a unidade ${unidade}.`,
          unidade,
        });
        return Response.json({ sucesso: true, curso, unidade });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível salvar o mapeamento de curso." },
          { status: 500 },
        );
      }
    }

    const rotaSheetsPrevia = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets\/previa$/,
    );
    if (rotaSheetsPrevia && request.method === "POST") {
      try {
        const periodoId = Number(rotaSheetsPrevia[1]);
        const config = await env.DB.prepare(
          `SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`,
        )
          .bind(periodoId)
          .first<SheetsConfig>();
        if (!config)
          return Response.json(
            { erro: "Configure a planilha deste período primeiro." },
            { status: 409 },
          );
        const ranges = await lerRangesGoogle(env, config);
        const [
          baseFaceFea,
          baseFchEad,
          docsFaceFea,
          docsFchEad,
          cancelFaceFea,
          cancelFchEad,
        ] = ranges;

        type Origem = "FACE_FEA" | "FCH_EAD";
        type LinhaBase = {
          ra: string;
          nome: string;
          curso: string;
          email_outro: string;
          email: string;
          contrato: boolean;
          origem: Origem;
        };
        const lerBase = (linhas: unknown[][], origem: Origem): LinhaBase[] =>
          linhas
            .slice(1)
            .map((l) => ({
              contrato: normalizarComparacao(l[0]) === "ENTREGUE",
              curso: normalizarTexto(l[1]),
              email_outro: normalizarTexto(l[2]),
              email: normalizarTexto(l[3]),
              nome: normalizarTexto(l[4]),
              ra: normalizarTexto(l[5]),
              origem,
            }))
            .filter((a) => a.ra && a.nome && a.curso);
        const bases = [
          ...lerBase(baseFaceFea.linhas, "FACE_FEA"),
          ...lerBase(baseFchEad.linhas, "FCH_EAD"),
        ];

        const lerDocs = (linhas: unknown[][]) =>
          new Map(
            linhas
              .slice(1)
              .map((l) => [
                normalizarTexto(l[0]),
                {
                  identidade: valorBooleano(l[2]),
                  cpf: valorBooleano(l[3]),
                  certidao: valorBooleano(l[4]),
                  residencia: valorBooleano(l[5]),
                  titulo: valorBooleano(l[6]),
                  ensino_medio: valorBooleano(l[7]),
                  contrato: valorBooleano(l[8]),
                },
              ])
              .filter(([ra]) => Boolean(ra)) as Array<[string, DocumentosBody]>,
          );
        const docs = new Map([
          ...lerDocs(docsFaceFea.linhas),
          ...lerDocs(docsFchEad.linhas),
        ]);

        const documentosMarcados = [...docs.values()].reduce(
          (total, doc) =>
            total +
            [
              doc.identidade,
              doc.cpf,
              doc.certidao,
              doc.residencia,
              doc.titulo,
              doc.ensino_medio,
              doc.contrato,
            ].filter(Boolean).length,
          0,
        );

        const lerCancelados = (linhas: unknown[][]) =>
          new Set(
            linhas
              .slice(1)
              .map((l) => normalizarTexto(l[5] ?? l[0]))
              .filter(Boolean),
          );
        const cancelados = new Set([
          ...lerCancelados(cancelFaceFea.linhas),
          ...lerCancelados(cancelFchEad.linhas),
        ]);

        const atuais = await env.DB.prepare(
          `
          SELECT a.ra, a.nome, a.curso, a.unidade, a.email, a.email_outro, a.status,
                 d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
          FROM alunos a LEFT JOIN documentos d ON d.aluno_id = a.id WHERE a.periodo_id = ?
        `,
        )
          .bind(periodoId)
          .all<AlunoRow>();
        const porRa = new Map(atuais.results.map((a) => [a.ra, a]));
        const cursoUnidades = new Map<string, Set<string>>();
        for (const a of atuais.results) {
          const curso = normalizarComparacao(a.curso);
          if (!cursoUnidades.has(curso)) cursoUnidades.set(curso, new Set());
          cursoUnidades.get(curso)!.add(a.unidade);
        }
        const mapeamentosSalvos = await env.DB.prepare(
          `
          SELECT curso_chave, unidade FROM google_sheets_mapeamentos WHERE periodo_id = ?
        `,
        )
          .bind(periodoId)
          .all<{ curso_chave: string; unidade: string }>();
        const unidadePorCurso = new Map(
          mapeamentosSalvos.results.map((m) => [m.curso_chave, m.unidade]),
        );

        const resolverUnidade = (a: LinhaBase) => {
          const cursoChave = normalizarComparacao(a.curso);

          const mapeada = unidadePorCurso.get(cursoChave);
          if (mapeada) return mapeada;

          if (a.origem === "FCH_EAD") {
            return null;
          }

          const conhecidas = [...(cursoUnidades.get(cursoChave) ?? [])].filter(
            (u) => u === "FACE" || u === "FEA",
          );

          return conhecidas.length === 1 ? conhecidas[0] : null;
        };

        let novos = 0,
          cadastrais = 0,
          documentosAlterados = 0,
          cancelar = 0,
          reativar = 0,
          jaCancelados = 0,
          remover = 0;

        const detalhesRemocoes: Array<{
          ra: string;
          nome: string;
          unidade: string;
        }> = [];

        const semUnidade: Array<{ ra: string; nome: string; curso: string }> =
          [];
        const detalhesNovos: Array<{
          ra: string;
          nome: string;
          curso: string;
          unidade: string | null;
        }> = [];
        const detalhesCadastrais: Array<{
          ra: string;
          nome: string;
          detalhe: string;
        }> = [];
        const detalhesDocumentos: Array<{
          ra: string;
          nome: string;
          detalhe: string;
        }> = [];
        const detalhesCancelamentos: Array<{
          ra: string;
          nome: string;
          unidade: string;
        }> = [];
        const detalhesReativacoes: Array<{
          ra: string;
          nome: string;
          unidade: string;
        }> = [];

        for (const aluno of bases) {
          const atual = porRa.get(aluno.ra);
          const unidade = resolverUnidade(aluno);
          if (!unidade)
            semUnidade.push({
              ra: aluno.ra,
              nome: aluno.nome,
              curso: aluno.curso,
            });
          if (!atual) {
            novos += 1;
            detalhesNovos.push({
              ra: aluno.ra,
              nome: aluno.nome,
              curso: aluno.curso,
              unidade,
            });

            // Se o aluno já estiver na planilha de cancelados,
            // ele entrará no primeiro import já como CANCELADO.
            if (cancelados.has(aluno.ra)) {
              cancelar += 1;

              detalhesCancelamentos.push({
                ra: aluno.ra,
                nome: aluno.nome,
                unidade: unidade ?? "",
              });
            }
          } else {
            if (atual.status === "CANCELADO" && !cancelados.has(aluno.ra)) {
              reativar += 1;

              detalhesReativacoes.push({
                ra: aluno.ra,
                nome: aluno.nome,
                unidade: atual.unidade,
              });
            }

            const campos = [
              ["Nome", atual.nome, aluno.nome],
              ["Curso", atual.curso, aluno.curso],
              ["E-mail", atual.email ?? "", aluno.email],
              ["Unidade", atual.unidade ?? "", unidade ?? ""],
              [
                "E-mail alternativo",
                atual.email_outro ?? "",
                aluno.email_outro,
              ],
            ].filter(
              ([, antes, depois]) =>
                normalizarComparacao(antes) !== normalizarComparacao(depois),
            );

            if (campos.length) {
              cadastrais += 1;

              detalhesCadastrais.push({
                ra: aluno.ra,
                nome: aluno.nome,
                detalhe: campos
                  .map(
                    ([campo, antes, depois]) =>
                      `${campo}: ${antes || "—"} → ${depois || "—"}`,
                  )
                  .join("\n"),
              });
            }
          }
          const doc = docs.get(aluno.ra);

          const mudouUnidade =
            atual &&
            normalizarComparacao(atual.unidade) !==
              normalizarComparacao(unidade);

          if (atual && doc && !mudouUnidade) {
            const pares = [
              ["Identidade", Boolean(atual.identidade), doc.identidade],
              ["CPF", Boolean(atual.cpf), doc.cpf],
              ["Certidão", Boolean(atual.certidao), doc.certidao],
              ["Residência", Boolean(atual.residencia), doc.residencia],
              ["Título", Boolean(atual.titulo), doc.titulo],
              ["Ensino Médio", Boolean(atual.ensino_medio), doc.ensino_medio],
              ["Contrato", Boolean(atual.contrato), doc.contrato],
            ] as Array<[string, boolean, boolean]>;
            const diferentes = pares.filter(
              ([, antes, depois]) => antes !== depois,
            );

            if (diferentes.length) {
              documentosAlterados += 1;

              detalhesDocumentos.push({
                ra: aluno.ra,
                nome: aluno.nome,
                detalhe: diferentes
                  .map(
                    ([nome, antes, depois]) =>
                      `${nome}: ${antes ? "Entregue" : "Pendente"} → ${
                        depois ? "Entregue" : "Pendente"
                      }`,
                  )
                  .join("\n"),
              });
            }
          }
        }
        for (const ra of cancelados) {
          const atual = porRa.get(ra);

          // Alunos novos já foram contabilizados acima.
          if (!atual) continue;

          if (atual.status === "CANCELADO") {
            jaCancelados += 1;
          } else {
            cancelar += 1;

            detalhesCancelamentos.push({
              ra,
              nome: atual.nome,
              unidade: atual.unidade,
            });
          }
        }
        const rasAtivosNaPlanilha = new Set(bases.map((aluno) => aluno.ra));

        for (const [ra, atual] of porRa) {
          const estaNaBaseAtiva = rasAtivosNaPlanilha.has(ra);
          const estaNosCancelados = cancelados.has(ra);

          if (!estaNaBaseAtiva && !estaNosCancelados) {
            remover += 1;

            detalhesRemocoes.push({
              ra,
              nome: atual.nome,
              unidade: atual.unidade,
            });
          }
        }
        const cursosPendentes = new Map<
          string,
          {
            curso: string;
            quantidade: number;
            alunos: Array<{ ra: string; nome: string }>;
          }
        >();
        for (const item of semUnidade) {
          const chave = normalizarComparacao(item.curso);
          const grupo = cursosPendentes.get(chave) ?? {
            curso: item.curso,
            quantidade: 0,
            alunos: [],
          };
          grupo.quantidade += 1;
          grupo.alunos.push({ ra: item.ra, nome: item.nome });
          cursosPendentes.set(chave, grupo);
        }
        const modoApresentacaoAtivo =
          usuarioAtual && emModoApresentacao(usuarioAtual);

        const anonimizarPessoa = (
          item: { ra: string; nome: string },
          indice: number,
        ) => ({
          ...item,
          ra: `APRESENTACAO-${String(indice + 1).padStart(4, "0")}`,
          nome: `Aluno ${String(indice + 1).padStart(4, "0")}`,
        });

        const anonimizarLista = <T extends { ra: string; nome: string }>(
          itens: T[],
        ): T[] =>
          modoApresentacaoAtivo
            ? itens.map((item, indice) => anonimizarPessoa(item, indice) as T)
            : itens;
        const anonimizarDetalheCadastral = (detalhe: string) => {
          if (!modoApresentacaoAtivo) return detalhe;

          return detalhe
            .split("\n")
            .map((linha) => {
              const [campo] = linha.split(": ");

              if (
                campo === "Nome" ||
                campo === "E-mail" ||
                campo === "E-mail alternativo"
              ) {
                return `${campo}: dado oculto → dado oculto`;
              }

              return linha;
            })
            .join("\n");
        };
        return Response.json({
          sucesso: true,
          planilha: {
            spreadsheet_id: config.spreadsheet_id,
            abas_lidas: ranges.map((r) => r.aba),
          },
          encontrados: bases.length,
          documentos_encontrados: docs.size,
          documentos_marcados: documentosMarcados,
          cancelados_encontrados: cancelados.size,
          novos,
          alteracoes_cadastrais: cadastrais,
          documentos_alterados: documentosAlterados,
          prontos_para_cancelar: cancelar,
          prontos_para_reativar: reativar,
          prontos_para_remover: remover,
          ja_cancelados: jaCancelados,
          alunos_sem_unidade: semUnidade.length,
          cursos_nao_mapeados: cursosPendentes.size,
          unidades_nao_resolvidas: semUnidade.length,
          detalhes_unidades: anonimizarLista(semUnidade),
          cursos_pendentes: [...cursosPendentes.values()]
            .sort(
              (a, b) =>
                b.quantidade - a.quantidade || a.curso.localeCompare(b.curso),
            )
            .map((grupo) => ({
              ...grupo,
              alunos: anonimizarLista(grupo.alunos),
            })),
          detalhes: {
            novos: anonimizarLista(detalhesNovos),
            cadastros: anonimizarLista(detalhesCadastrais).map((item) => ({
              ...item,
              detalhe: anonimizarDetalheCadastral(item.detalhe),
            })),
            documentos: anonimizarLista(detalhesDocumentos),
            cancelamentos: anonimizarLista(detalhesCancelamentos),
            reativacoes: anonimizarLista(detalhesReativacoes),
            remocoes: anonimizarLista(detalhesRemocoes),
          },
          modo: "PREVIA_SOMENTE_LEITURA",
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          {
            erro:
              erro instanceof Error
                ? erro.message
                : "Não foi possível ler o Google Sheets.",
          },
          { status: 500 },
        );
      }
    }

    const rotaSheetsSincronizar = url.pathname.match(
      /^\/api\/periodos\/(\d+)\/google-sheets\/sincronizar$/,
    );

    if (rotaSheetsSincronizar && request.method === "POST") {
      try {
        if (!podeEditar(usuarioAtual!)) {
          return Response.json(
            { erro: "Seu perfil não permite sincronizar dados." },
            { status: 403 },
          );
        }

        const periodoId = Number(rotaSheetsSincronizar[1]);
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

        const ranges = await lerRangesGoogle(env, config);
        const [
          baseFaceFea,
          baseFchEad,
          docsFaceFea,
          docsFchEad,
          cancelFaceFea,
          cancelFchEad,
        ] = ranges;

        type OrigemSync = "FACE_FEA" | "FCH_EAD";
        type LinhaBaseSync = {
          ra: string;
          nome: string;
          curso: string;
          email_outro: string;
          email: string;
          contrato: boolean;
          origem: OrigemSync;
        };

        const lerBaseSync = (
          linhas: unknown[][],
          origem: OrigemSync,
        ): LinhaBaseSync[] =>
          linhas
            .slice(1)
            .map((l) => ({
              contrato: normalizarComparacao(l[0]) === "ENTREGUE",
              curso: normalizarTexto(l[1]),
              email_outro: normalizarTexto(l[2]),
              email: normalizarTexto(l[3]),
              nome: normalizarTexto(l[4]),
              ra: normalizarTexto(l[5]),
              origem,
            }))
            .filter((a) => a.ra && a.nome && a.curso);

        const bases = [
          ...lerBaseSync(baseFaceFea.linhas, "FACE_FEA"),
          ...lerBaseSync(baseFchEad.linhas, "FCH_EAD"),
        ];

        const lerDocsSync = (linhas: unknown[][]) =>
          new Map(
            linhas
              .slice(1)
              .map((l) => [
                normalizarTexto(l[0]),
                {
                  identidade: valorBooleano(l[2]),
                  cpf: valorBooleano(l[3]),
                  certidao: valorBooleano(l[4]),
                  residencia: valorBooleano(l[5]),
                  titulo: valorBooleano(l[6]),
                  ensino_medio: valorBooleano(l[7]),
                  contrato: valorBooleano(l[8]),
                },
              ])
              .filter(([ra]) => Boolean(ra)) as Array<[string, DocumentosBody]>,
          );

        const docs = new Map([
          ...lerDocsSync(docsFaceFea.linhas),
          ...lerDocsSync(docsFchEad.linhas),
        ]);

        const lerCanceladosSync = (linhas: unknown[][]) =>
          new Set(
            linhas
              .slice(1)
              .map((l) => normalizarTexto(l[5] ?? l[0]))
              .filter(Boolean),
          );

        const cancelados = new Set([
          ...lerCanceladosSync(cancelFaceFea.linhas),
          ...lerCanceladosSync(cancelFchEad.linhas),
        ]);

        const atuais = await env.DB.prepare(
          `
          SELECT a.id, a.ra, a.nome, a.curso, a.unidade, a.email, a.email_outro, a.status,
                 d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
          FROM alunos a
          LEFT JOIN documentos d ON d.aluno_id = a.id
          WHERE a.periodo_id = ?
        `,
        )
          .bind(periodoId)
          .all<AlunoRow & { id: number }>();

        const porRa = new Map(atuais.results.map((a) => [a.ra, a]));
        const cursoUnidades = new Map<string, Set<string>>();

        for (const a of atuais.results) {
          const curso = normalizarComparacao(a.curso);
          if (!cursoUnidades.has(curso)) cursoUnidades.set(curso, new Set());
          cursoUnidades.get(curso)!.add(a.unidade);
        }

        const mapeamentosSalvos = await env.DB.prepare(
          `
          SELECT curso_chave, unidade
          FROM google_sheets_mapeamentos
          WHERE periodo_id = ?
        `,
        )
          .bind(periodoId)
          .all<{ curso_chave: string; unidade: string }>();

        const unidadePorCurso = new Map(
          mapeamentosSalvos.results.map((m) => [m.curso_chave, m.unidade]),
        );

        const resolverUnidadeSync = (a: LinhaBaseSync) => {
          const cursoChave = normalizarComparacao(a.curso);

          const mapeada = unidadePorCurso.get(cursoChave);
          if (mapeada) return mapeada;

          if (a.origem === "FCH_EAD") {
            return null;
          }

          const conhecidas = [...(cursoUnidades.get(cursoChave) ?? [])].filter(
            (u) => u === "FACE" || u === "FEA",
          );

          return conhecidas.length === 1 ? conhecidas[0] : null;
        };

        const resolvidos = bases.map((aluno) => ({
          aluno,
          unidade: resolverUnidadeSync(aluno),
        }));

        const semUnidade = resolvidos.filter((item) => !item.unidade);

        if (semUnidade.length) {
          return Response.json(
            {
              erro: `Sincronização bloqueada: ${semUnidade.length} aluno(s) ainda estão sem unidade definida.`,
              unidades_nao_resolvidas: semUnidade.length,
            },
            { status: 409 },
          );
        }

        let novos = 0;
        let cadastros = 0;
        let documentosAlterados = 0;
        let cancelamentos = 0;
        let reativacoes = 0;
        let remocoes = 0;

        const comandos: D1PreparedStatement[] = [];

        for (const { aluno, unidade } of resolvidos) {
          const atual = porRa.get(aluno.ra);
          const doc = docs.get(aluno.ra);

          if (!atual) {
            novos += 1;

            const novoJaCancelado = cancelados.has(aluno.ra);

            if (novoJaCancelado) {
              cancelamentos += 1;
            }

            const statusInicial = novoJaCancelado ? "CANCELADO" : "ATIVO";

            comandos.push(
              env.DB.prepare(
                `
      INSERT INTO alunos (
        periodo_id, ra, nome, email, email_outro, curso, unidade, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
              ).bind(
                periodoId,
                aluno.ra,
                aluno.nome,
                aluno.email || null,
                aluno.email_outro || null,
                aluno.curso,
                unidade!,
                statusInicial,
              ),
            );

            comandos.push(
              env.DB.prepare(
                `
                INSERT INTO documentos (
                  aluno_id, identidade, cpf, certidao, residencia,
                  titulo, ensino_medio, contrato
                )
                SELECT id, ?, ?, ?, ?, ?, ?, ?
                FROM alunos
                WHERE periodo_id = ? AND ra = ?
              `,
              ).bind(
                doc?.identidade ? 1 : 0,
                doc?.cpf ? 1 : 0,
                doc?.certidao ? 1 : 0,
                doc?.residencia ? 1 : 0,
                doc?.titulo ? 1 : 0,
                doc?.ensino_medio ? 1 : 0,
                doc ? (doc.contrato ? 1 : 0) : aluno.contrato ? 1 : 0,
                periodoId,
                aluno.ra,
              ),
            );

            continue;
          }
          if (atual.status === "CANCELADO" && !cancelados.has(aluno.ra)) {
            reativacoes += 1;

            comandos.push(
              env.DB.prepare(
                `
      UPDATE alunos
      SET status = 'ATIVO', atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
              ).bind(atual.id),
            );
          }
          const cadastroMudou =
            normalizarComparacao(atual.nome) !==
              normalizarComparacao(aluno.nome) ||
            normalizarComparacao(atual.curso) !==
              normalizarComparacao(aluno.curso) ||
            normalizarComparacao(atual.unidade ?? "") !==
              normalizarComparacao(unidade ?? "") ||
            normalizarComparacao(atual.email ?? "") !==
              normalizarComparacao(aluno.email) ||
            normalizarComparacao(atual.email_outro ?? "") !==
              normalizarComparacao(aluno.email_outro);

          if (cadastroMudou) {
            cadastros += 1;

            comandos.push(
              env.DB.prepare(
                `
      UPDATE alunos
      SET nome = ?,
          email = ?,
          email_outro = ?,
          curso = ?,
          unidade = ?,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
              ).bind(
                aluno.nome,
                aluno.email || null,
                aluno.email_outro || null,
                aluno.curso,
                unidade!,
                atual.id,
              ),
            );
          }

          const mudouUnidade =
            normalizarComparacao(atual.unidade) !==
            normalizarComparacao(unidade);

          if (doc && !mudouUnidade) {
            const docMudou =
              Boolean(atual.identidade) !== doc.identidade ||
              Boolean(atual.cpf) !== doc.cpf ||
              Boolean(atual.certidao) !== doc.certidao ||
              Boolean(atual.residencia) !== doc.residencia ||
              Boolean(atual.titulo) !== doc.titulo ||
              Boolean(atual.ensino_medio) !== doc.ensino_medio ||
              Boolean(atual.contrato) !== doc.contrato;

            if (docMudou) {
              documentosAlterados += 1;
              comandos.push(
                env.DB.prepare(
                  `
                  INSERT INTO documentos (
                    aluno_id, identidade, cpf, certidao, residencia,
                    titulo, ensino_medio, contrato
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(aluno_id) DO UPDATE SET
                    identidade = excluded.identidade,
                    cpf = excluded.cpf,
                    certidao = excluded.certidao,
                    residencia = excluded.residencia,
                    titulo = excluded.titulo,
                    ensino_medio = excluded.ensino_medio,
                    contrato = excluded.contrato,
                    atualizado_em = CURRENT_TIMESTAMP
                `,
                ).bind(
                  atual.id,
                  doc.identidade ? 1 : 0,
                  doc.cpf ? 1 : 0,
                  doc.certidao ? 1 : 0,
                  doc.residencia ? 1 : 0,
                  doc.titulo ? 1 : 0,
                  doc.ensino_medio ? 1 : 0,
                  doc.contrato ? 1 : 0,
                ),
              );
            }
          }
        }

        for (const ra of cancelados) {
          const atual = porRa.get(ra);
          if (!atual || atual.status === "CANCELADO") continue;

          cancelamentos += 1;
          comandos.push(
            env.DB.prepare(
              `
              UPDATE alunos
              SET status = 'CANCELADO', atualizado_em = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
            ).bind(atual.id),
          );
        }

        const rasAtivosNaPlanilha = new Set(bases.map((aluno) => aluno.ra));

        for (const atual of atuais.results) {
          const estaNaBaseAtiva = rasAtivosNaPlanilha.has(atual.ra);
          const estaNosCancelados = cancelados.has(atual.ra);

          if (!estaNaBaseAtiva && !estaNosCancelados) {
            remocoes += 1;

            comandos.push(
              env.DB.prepare(
                `
        DELETE FROM alunos
        WHERE id = ?
      `,
              ).bind(atual.id),
            );
          }
        }

        // D1 batch é atômico: se uma instrução falhar, o lote inteiro é revertido.
        const TAMANHO_BATCH = 80;
        for (let i = 0; i < comandos.length; i += TAMANHO_BATCH) {
          await env.DB.batch(comandos.slice(i, i + TAMANHO_BATCH));
        }

        const periodo = await env.DB.prepare(
          `SELECT codigo FROM periodos WHERE id = ?`,
        )
          .bind(periodoId)
          .first<{ codigo: string }>();

        const descricao =
          `Google Sheets sincronizado no período ${
            periodo?.codigo ?? periodoId
          }: ` +
          `${novos} novo(s), ${cadastros} cadastro(s), ` +
          `${documentosAlterados} documento(s), ${cancelamentos} cancelamento(s), ` +
          `${reativacoes} reativação(ões) e ${remocoes} remoção(ões).`;

        await env.DB.prepare(
          `
          INSERT INTO logs (
            acao,
            entidade,
            descricao,
            ra,
            unidade,
            periodo_id,
            usuario_id,
            usuario_nome,
            usuario_username
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
          .bind(
            "SINCRONIZAR",
            "GOOGLE_SHEETS",
            descricao,
            null,
            null,
            periodoId,
            usuarioAtual?.id ?? null,
            usuarioAtual?.nome ?? null,
            usuarioAtual?.username ?? null,
          )
          .run();

        const novosCancelados = resolvidos.filter(
          ({ aluno }) => !porRa.has(aluno.ra) && cancelados.has(aluno.ra),
        ).length;

        return Response.json({
          sucesso: true,
          novos,
          alteracoes_cadastrais: cadastros,
          documentos_alterados: documentosAlterados,
          cancelamentos,
          reativacoes,
          remocoes,
          total_operacoes:
            novos +
            cadastros +
            documentosAlterados +
            cancelamentos +
            reativacoes +
            remocoes -
            novosCancelados,
        });
      } catch (erro) {
        console.error("Erro na sincronização Google Sheets:", erro);
        return Response.json(
          {
            erro:
              erro instanceof Error
                ? erro.message
                : "Não foi possível sincronizar o Google Sheets.",
          },
          { status: 500 },
        );
      }
    }

    if (
      url.pathname === "/api/admin/backup/status" &&
      request.method === "GET"
    ) {
      if (usuarioAtual?.perfil !== "ADMIN")
        return Response.json(
          { erro: "Apenas administradores podem acessar o backup." },
          { status: 403 },
        );

      return Response.json({
        configurado: Boolean(
          env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
          env.CLOUDFLARE_API_TOKEN?.trim() &&
          env.D1_DATABASE_ID?.trim(),
        ),
      });
    }

    if (url.pathname === "/api/admin/backup" && request.method === "POST") {
      if (usuarioAtual?.perfil !== "ADMIN")
        return Response.json(
          { erro: "Apenas administradores podem gerar backups." },
          { status: 403 },
        );

      try {
        const periodoAuditoria = await obterPeriodoAtual(request, env, url);
        await registrarAuditoria(
          env,
          usuarioAtual,
          periodoAuditoria?.id ?? null,
          {
            acao: "BACKUP",
            entidade: "BANCO_D1",
            descricao:
              "Exportacao manual do banco D1 solicitada pelo painel administrativo.",
          },
        );

        const exportacao = await solicitarExportacaoD1(env);
        return Response.json({
          sucesso: true,
          arquivo: exportacao.arquivo,
          download_url: exportacao.downloadUrl,
          expira_em_segundos: 3600,
        });
      } catch (erro) {
        console.error("Falha ao gerar backup do D1:", erro);
        return Response.json(
          {
            erro:
              erro instanceof Error
                ? erro.message
                : "Nao foi possivel gerar o backup do D1.",
          },
          { status: 500 },
        );
      }
    }

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

    // =====================================================
    // FERRAMENTAS DE DESENVOLVIMENTO — LIMPEZA DE ALUNOS
    // =====================================================

    if (
      url.pathname === "/api/dev/alunos-reset/status" &&
      request.method === "GET"
    ) {
      return Response.json({
        habilitado:
          ambienteDesenvolvimento(request, env) &&
          usuarioAtual?.perfil === "ADMIN",
      });
    }

    if (
      url.pathname === "/api/dev/alunos-reset" &&
      request.method === "DELETE"
    ) {
      if (!ambienteDesenvolvimento(request, env)) {
        return Response.json(
          {
            erro: "Ferramenta disponível somente no ambiente de desenvolvimento.",
          },
          { status: 403 },
        );
      }

      if (usuarioAtual?.perfil !== "ADMIN") {
        return Response.json(
          {
            erro: "Apenas administradores podem usar ferramentas de desenvolvimento.",
          },
          { status: 403 },
        );
      }

      try {
        const body = await request.json<{
          unidade?: string;
          confirmacao?: string;
        }>();

        const unidade = body.unidade?.trim().toUpperCase() || "TODOS";
        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD", "TODOS"];

        if (!unidadesValidas.includes(unidade)) {
          return Response.json({ erro: "Unidade inválida." }, { status: 400 });
        }

        const confirmacaoEsperada =
          unidade === "TODOS" ? "LIMPAR TODOS" : `LIMPAR ${unidade}`;

        if (body.confirmacao?.trim().toUpperCase() !== confirmacaoEsperada) {
          return Response.json(
            { erro: `Digite "${confirmacaoEsperada}" para confirmar.` },
            { status: 400 },
          );
        }

        const contagem =
          unidade === "TODOS"
            ? await env.DB.prepare(
                `SELECT COUNT(*) AS total FROM alunos WHERE periodo_id = ?`,
              )
                .bind(periodoAtual!.id)
                .first<{ total: number }>()
            : await env.DB.prepare(
                `SELECT COUNT(*) AS total FROM alunos WHERE periodo_id = ? AND unidade = ?`,
              )
                .bind(periodoAtual!.id, unidade)
                .first<{ total: number }>();

        if (unidade === "TODOS") {
          await env.DB.prepare(`DELETE FROM alunos WHERE periodo_id = ?`)
            .bind(periodoAtual!.id)
            .run();
        } else {
          await env.DB.prepare(
            `DELETE FROM alunos WHERE periodo_id = ? AND unidade = ?`,
          )
            .bind(periodoAtual!.id, unidade)
            .run();
        }

        return Response.json({
          sucesso: true,
          unidade,
          removidos: Number(contagem?.total ?? 0),
          periodo: periodoAtual!.codigo,
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível limpar os alunos de desenvolvimento." },
          { status: 500 },
        );
      }
    }

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

    // =====================================================
    // GET /api/log
    // =====================================================

    if (url.pathname === "/api/log" && request.method === "GET") {
      try {
        const limiteSolicitado = Number(url.searchParams.get("limit") || "200");
        const limite = Math.max(1, Math.min(500, limiteSolicitado));
        const escopoGlobal = url.searchParams.get("scope") === "all";

        const resultado = await env.DB.prepare(
          escopoGlobal
            ? `
            SELECT
              l.id,
              l.criado_em,
              l.acao,
              l.entidade,
              l.descricao,
              l.ra,
              l.unidade,
              l.usuario_id,
              l.usuario_nome,
              l.usuario_username,
              p.codigo AS periodo_codigo
            FROM logs l
            LEFT JOIN periodos p ON p.id = l.periodo_id
            ORDER BY l.id DESC
            LIMIT ?
          `
            : `
            SELECT
              id,
              criado_em,
              acao,
              entidade,
              descricao,
              ra,
              unidade,
              usuario_id,
              usuario_nome,
              usuario_username
            FROM logs
            WHERE periodo_id = ?
            ORDER BY id DESC
            LIMIT ?
          `,
        )
          .bind(...(escopoGlobal ? [limite] : [periodoAtual!.id, limite]))
          .all();

        return Response.json(resultado.results);
      } catch (erro) {
        console.error(erro);
        return Response.json(
          {
            erro: "LOG indisponível. Verifique se as migrations do LOG foram aplicadas no D1.",
          },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // POST /api/log
    // =====================================================

    if (url.pathname === "/api/log" && request.method === "POST") {
      try {
        const body = await request.json<{
          acao: string;
          entidade: string;
          descricao: string;
          ra?: string;
          unidade?: string;
        }>();

        if (
          !body.acao?.trim() ||
          !body.entidade?.trim() ||
          !body.descricao?.trim()
        ) {
          return Response.json(
            { erro: "Dados insuficientes para registrar o LOG." },
            { status: 400 },
          );
        }

        await env.DB.prepare(
          `
            INSERT INTO logs (
              acao,
              entidade,
              descricao,
              ra,
              unidade,
              periodo_id,
              usuario_id,
              usuario_nome,
              usuario_username
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            body.acao.trim(),
            body.entidade.trim(),
            body.descricao.trim(),
            body.ra?.trim() || null,
            body.unidade?.trim() || null,
            periodoAtual!.id,
            usuarioAtual?.id ?? null,
            usuarioAtual?.nome ?? null,
            usuarioAtual?.username ?? null,
          )
          .run();

        return Response.json({ sucesso: true }, { status: 201 });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível registrar o LOG." },
          { status: 500 },
        );
      }
    }

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
    // GET /api/alunos
    // =====================================================

    if (url.pathname === "/api/alunos" && request.method === "GET") {
      const resultado = await env.DB.prepare(
        `
          SELECT
            a.ra,
            a.nome,
            a.email,
            a.email_outro,
            a.curso,
            a.unidade,
            a.status,
            d.identidade,
            d.cpf,
            d.certidao,
            d.residencia,
            d.titulo,
            d.ensino_medio,
            d.contrato
          FROM alunos a
          INNER JOIN documentos d
            ON d.aluno_id = a.id
          WHERE a.periodo_id = ?
          ORDER BY a.nome
        `,
      )
        .bind(periodoAtual!.id)
        .all<AlunoRow>();

      if (usuarioAtual && emModoApresentacao(usuarioAtual)) {
        const alunosSanitizados = resultado.results.map((aluno, indice) => ({
          ra: `APRESENTACAO-${String(indice + 1).padStart(4, "0")}`,
          nome: `Aluno ${String(indice + 1).padStart(4, "0")}`,
          email: "",
          email_outro: "",
          curso: aluno.curso,
          unidade: aluno.unidade,
          status: aluno.status,
          identidade: aluno.identidade,
          cpf: aluno.cpf,
          certidao: aluno.certidao,
          residencia: aluno.residencia,
          titulo: aluno.titulo,
          ensino_medio: aluno.ensino_medio,
          contrato: aluno.contrato,
        }));

        return Response.json(alunosSanitizados);
      }

      return Response.json(resultado.results);
    }

    // =====================================================
    // POST /api/alunos
    // =====================================================

    if (url.pathname === "/api/alunos" && request.method === "POST") {
      try {
        const body = await request.json<DadosAluno>();

        const ra = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();

        if (!ra || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade são obrigatórios.",
            },
            {
              status: 400,
            },
          );
        }

        const existente = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, ra)
          .first<{ id: number }>();

        if (existente) {
          return Response.json(
            {
              erro: "Já existe um aluno com este RA.",
            },
            {
              status: 409,
            },
          );
        }

        const resultado = await env.DB.prepare(
          `
            INSERT INTO alunos (
              periodo_id,
              ra,
              nome,
              email,
              email_outro,
              curso,
              unidade
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            periodoAtual!.id,
            ra,
            nome,
            body.email?.trim() || null,
            body.email_outro?.trim() || null,
            curso,
            unidade,
          )
          .run();

        const alunoId = resultado.meta.last_row_id;

        const documentos = body.documentos;

        await env.DB.prepare(
          `
            INSERT INTO documentos (
              aluno_id,
              identidade,
              cpf,
              certidao,
              residencia,
              titulo,
              ensino_medio,
              contrato
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            alunoId,
            documentos?.identidade ? 1 : 0,
            documentos?.cpf ? 1 : 0,
            documentos?.certidao ? 1 : 0,
            documentos?.residencia ? 1 : 0,
            documentos?.titulo ? 1 : 0,
            documentos?.ensino_medio ? 1 : 0,
            documentos?.contrato ? 1 : 0,
          )
          .run();

        await registrarPendenciaGoogleSheets(
          env,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          "ATUALIZAR",
          "NOVO ALUNO",
        );

        return Response.json(
          {
            sucesso: true,
            ra,
            id: alunoId,
          },
          {
            status: 201,
          },
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível cadastrar o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // POST /api/alunos/importar
    // Sincronização em lote: cadastra novos e atualiza existentes
    // sem tocar nos documentos já conferidos.
    // =====================================================

    if (url.pathname === "/api/alunos/importar" && request.method === "POST") {
      try {
        type AlunoImportacao = {
          ra: string;
          nome: string;
          curso: string;
          email?: string;
          email_outro?: string;
          contrato?: boolean;
        };

        type AlunoExistenteImportacao = {
          ra: string;
          nome: string;
          curso: string;
          unidade: string;
          email: string | null;
          email_outro: string | null;
          status: "ATIVO" | "CANCELADO";
        };

        const body = await request.json<{
          unidade: "FACE" | "FEA" | "FCH" | "EAD";
          alunos: AlunoImportacao[];
        }>();

        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];

        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inválida." }, { status: 400 });
        }

        if (!Array.isArray(body.alunos) || body.alunos.length === 0) {
          return Response.json(
            { erro: "Nenhum aluno foi enviado para sincronização." },
            { status: 400 },
          );
        }

        const invalidos: Array<{
          indice: number;
          ra?: string;
          nome?: string;
          motivo: string;
        }> = [];

        const validos = body.alunos
          .map((aluno, indice) => {
            const ra = aluno.ra?.trim();
            const nome = aluno.nome?.trim();
            const curso = aluno.curso?.trim();

            if (!ra || !nome || !curso) {
              invalidos.push({
                indice,
                ra,
                nome,
                motivo: "RA, nome ou curso ausente.",
              });

              return null;
            }

            return {
              ra,
              nome,
              curso,
              email: aluno.email?.trim() || null,
              email_outro: aluno.email_outro?.trim() || null,
              contrato: Boolean(aluno.contrato),
            };
          })
          .filter(
            (
              aluno,
            ): aluno is {
              ra: string;
              nome: string;
              curso: string;
              email: string | null;
              email_outro: string | null;
              contrato: boolean;
            } => aluno !== null,
          );

        const rasDoLote = new Set<string>();
        const duplicadosNoLote: string[] = [];

        const unicos = validos.filter((aluno) => {
          if (rasDoLote.has(aluno.ra)) {
            duplicadosNoLote.push(aluno.ra);
            return false;
          }

          rasDoLote.add(aluno.ra);
          return true;
        });

        if (unicos.length === 0) {
          return Response.json({
            sucesso: true,
            encontrados: body.alunos.length,
            importados: 0,
            atualizados: 0,
            sem_alteracoes: 0,
            ja_cadastrados: 0,
            duplicados_no_lote: duplicadosNoLote.length,
            invalidos: invalidos.length,
            detalhes: {
              atualizados: [],
              sem_alteracoes: [],
              duplicados_no_lote: duplicadosNoLote,
              invalidos,
            },
          });
        }

        const TAMANHO_CONSULTA = 80;
        const existentesPorRa = new Map<string, AlunoExistenteImportacao>();

        for (let i = 0; i < unicos.length; i += TAMANHO_CONSULTA) {
          const lote = unicos.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");

          const existentes = await env.DB.prepare(
            `
              SELECT
                ra,
                nome,
                curso,
                unidade,
                email,
                email_outro,
                status
              FROM alunos
              WHERE periodo_id = ? AND ra IN (${placeholders})
            `,
          )
            .bind(periodoAtual!.id, ...lote.map((aluno) => aluno.ra))
            .all<AlunoExistenteImportacao>();

          for (const existente of existentes.results) {
            existentesPorRa.set(existente.ra, existente);
          }
        }

        const normalizar = (valor: string | null | undefined) =>
          (valor ?? "").trim();

        const novos = unicos.filter((aluno) => !existentesPorRa.has(aluno.ra));

        const existentes = unicos.filter((aluno) =>
          existentesPorRa.has(aluno.ra),
        );

        const alterados = existentes.filter((aluno) => {
          const atual = existentesPorRa.get(aluno.ra)!;

          return (
            atual.status === "CANCELADO" ||
            normalizar(atual.nome) !== normalizar(aluno.nome) ||
            normalizar(atual.curso) !== normalizar(aluno.curso) ||
            normalizar(atual.unidade) !== normalizar(body.unidade) ||
            normalizar(atual.email) !== normalizar(aluno.email) ||
            normalizar(atual.email_outro) !== normalizar(aluno.email_outro)
          );
        });

        const alteradosRa = new Set(alterados.map((aluno) => aluno.ra));

        const semAlteracoes = existentes.filter(
          (aluno) => !alteradosRa.has(aluno.ra),
        );

        // Novos: cadastra aluno e cria o controle documental.
        const TAMANHO_INSERCAO = 25;

        for (let i = 0; i < novos.length; i += TAMANHO_INSERCAO) {
          const lote = novos.slice(i, i + TAMANHO_INSERCAO);
          const comandos: D1PreparedStatement[] = [];

          for (const aluno of lote) {
            comandos.push(
              env.DB.prepare(
                `
                  INSERT INTO alunos (
                    periodo_id,
                    ra,
                    nome,
                    email,
                    email_outro,
                    curso,
                    unidade
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
              ).bind(
                periodoAtual!.id,
                aluno.ra,
                aluno.nome,
                aluno.email,
                aluno.email_outro,
                aluno.curso,
                body.unidade,
              ),
            );

            comandos.push(
              env.DB.prepare(
                `
                  INSERT INTO documentos (
                    aluno_id,
                    identidade,
                    cpf,
                    certidao,
                    residencia,
                    titulo,
                    ensino_medio,
                    contrato
                  )
                  SELECT
                    id,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    ?
                  FROM alunos
                  WHERE periodo_id = ? AND ra = ?
                `,
              ).bind(aluno.contrato ? 1 : 0, periodoAtual!.id, aluno.ra),
            );
          }

          await env.DB.batch(comandos);
        }

        // Existentes alterados: atualiza SOMENTE dados cadastrais.
        // A tabela documentos não é tocada, portanto nenhuma conferência
        // já realizada é perdida ou zerada.
        const TAMANHO_ATUALIZACAO = 50;

        for (let i = 0; i < alterados.length; i += TAMANHO_ATUALIZACAO) {
          const lote = alterados.slice(i, i + TAMANHO_ATUALIZACAO);

          const comandos = lote.map((aluno) =>
            env.DB.prepare(
              `
                UPDATE alunos
                SET
                  nome = ?,
                  email = ?,
                  email_outro = ?,
                  curso = ?,
                  unidade = ?,
                  status = 'ATIVO',
                  atualizado_em = CURRENT_TIMESTAMP
                WHERE periodo_id = ? AND ra = ?
              `,
            ).bind(
              aluno.nome,
              aluno.email,
              aluno.email_outro,
              aluno.curso,
              body.unidade,
              periodoAtual!.id,
              aluno.ra,
            ),
          );

          await env.DB.batch(comandos);
        }

        for (const aluno of [...novos, ...alterados]) {
          await registrarPendenciaGoogleSheets(
            env,
            usuarioAtual,
            periodoAtual!.id,
            aluno.ra,
            "ATUALIZAR",
            novos.includes(aluno) ? "NOVO ALUNO" : "CADASTRO",
          );
        }

        return Response.json({
          sucesso: true,
          encontrados: body.alunos.length,
          importados: novos.length,
          atualizados: alterados.length,
          sem_alteracoes: semAlteracoes.length,
          ja_cadastrados: existentes.length,
          duplicados_no_lote: duplicadosNoLote.length,
          invalidos: invalidos.length,
          detalhes: {
            atualizados: alterados.map((aluno) => aluno.ra),
            sem_alteracoes: semAlteracoes.map((aluno) => aluno.ra),
            duplicados_no_lote: duplicadosNoLote,
            invalidos,
          },
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          { erro: "Não foi possível sincronizar os alunos." },
          { status: 500 },
        );
      }
    }

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
    // PUT /api/alunos/:ra/documentos
    // =====================================================

    if (
      url.pathname.startsWith("/api/alunos/") &&
      url.pathname.endsWith("/documentos") &&
      request.method === "PUT"
    ) {
      const partes = url.pathname.split("/");
      const ra = decodeURIComponent(partes[3]);

      const body = await request.json<DocumentosBody>();

      const aluno = await env.DB.prepare(
        `
          SELECT id
          FROM alunos
          WHERE periodo_id = ? AND ra = ?
        `,
      )
        .bind(periodoAtual!.id, ra)
        .first<{ id: number }>();

      if (!aluno) {
        return Response.json(
          {
            erro: "Aluno não encontrado.",
          },
          {
            status: 404,
          },
        );
      }

      await env.DB.prepare(
        `
          UPDATE documentos
          SET
            identidade = ?,
            cpf = ?,
            certidao = ?,
            residencia = ?,
            titulo = ?,
            ensino_medio = ?,
            contrato = ?,
            atualizado_em = CURRENT_TIMESTAMP
          WHERE aluno_id = ?
        `,
      )
        .bind(
          body.identidade ? 1 : 0,
          body.cpf ? 1 : 0,
          body.certidao ? 1 : 0,
          body.residencia ? 1 : 0,
          body.titulo ? 1 : 0,
          body.ensino_medio ? 1 : 0,
          body.contrato ? 1 : 0,
          aluno.id,
        )
        .run();

      await registrarPendenciaGoogleSheets(
        env,
        usuarioAtual,
        periodoAtual!.id,
        ra,
        "ATUALIZAR",
        "DOCUMENTOS",
      );

      return Response.json({
        sucesso: true,
        ra,
      });
    }

    // =====================================================
    // PUT /api/alunos/:ra
    // Editar dados cadastrais
    // =====================================================

    const rotaAluno = url.pathname.match(/^\/api\/alunos\/([^/]+)$/);

    if (rotaAluno && request.method === "PUT") {
      try {
        const raAtual = decodeURIComponent(rotaAluno[1]);

        const body = await request.json<DadosAluno>();

        const novoRa = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();

        if (!novoRa || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade são obrigatórios.",
            },
            {
              status: 400,
            },
          );
        }

        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, raAtual)
          .first<{ id: number }>();

        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno não encontrado.",
            },
            {
              status: 404,
            },
          );
        }

        if (novoRa !== raAtual) {
          const raEmUso = await env.DB.prepare(
            `
              SELECT id
              FROM alunos
              WHERE periodo_id = ?
              AND ra = ?
              AND id <> ?
            `,
          )
            .bind(periodoAtual!.id, novoRa, aluno.id)
            .first<{ id: number }>();

          if (raEmUso) {
            return Response.json(
              {
                erro: "Já existe outro aluno com este RA.",
              },
              {
                status: 409,
              },
            );
          }
        }

        await env.DB.prepare(
          `
            UPDATE alunos
            SET
              ra = ?,
              nome = ?,
              email = ?,
              email_outro = ?,
              curso = ?,
              unidade = ?,
              atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
          .bind(
            novoRa,
            nome,
            body.email?.trim() || null,
            body.email_outro?.trim() || null,
            curso,
            unidade,
            aluno.id,
          )
          .run();

        if (novoRa !== raAtual) {
          await registrarPendenciaGoogleSheets(
            env,
            usuarioAtual,
            periodoAtual!.id,
            raAtual,
            "REMOVER",
            "TROCA DE RA",
          );
        }
        await registrarPendenciaGoogleSheets(
          env,
          usuarioAtual,
          periodoAtual!.id,
          novoRa,
          "ATUALIZAR",
          "CADASTRO",
        );

        return Response.json({
          sucesso: true,
          ra_anterior: raAtual,
          ra: novoRa,
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível atualizar o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // DELETE /api/alunos/:ra
    // =====================================================

    if (rotaAluno && request.method === "DELETE") {
      try {
        const ra = decodeURIComponent(rotaAluno[1]);

        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, ra)
          .first<{ id: number }>();

        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno não encontrado.",
            },
            {
              status: 404,
            },
          );
        }

        await env.DB.prepare(
          `
            DELETE FROM alunos
            WHERE id = ?
          `,
        )
          .bind(aluno.id)
          .run();

        await registrarPendenciaGoogleSheets(
          env,
          usuarioAtual,
          periodoAtual!.id,
          ra,
          "REMOVER",
          "EXCLUSÃO",
        );

        return Response.json({
          sucesso: true,
          ra,
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível excluir o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // GET /api/comunicacoes
    // =====================================================

    if (url.pathname === "/api/comunicacoes" && request.method === "GET") {
      try {
        const limiteSolicitado = Number(url.searchParams.get("limit") || "20");
        const limite = Math.max(1, Math.min(100, limiteSolicitado));

        const resultado = await env.DB.prepare(
          `
            SELECT
              id,
              criado_em,
              grupo_chave,
              unidade,
              documentos_json,
              quantidade_alunos,
              quantidade_emails,
              assunto,
              prazo,
              tipo_destinatario,
              ras_json
            FROM comunicacoes
            WHERE periodo_id = ?
            ORDER BY id DESC
            LIMIT ?
          `,
        )
          .bind(periodoAtual!.id, limite)
          .all<{
            id: number;
            criado_em: string;
            grupo_chave: string;
            unidade: string;
            documentos_json: string;
            quantidade_alunos: number;
            quantidade_emails: number;
            assunto: string;
            prazo: string;
            tipo_destinatario: string;
            ras_json: string;
          }>();

        return Response.json(
          resultado.results.map((registro) => ({
            id: registro.id,
            criado_em: registro.criado_em,
            grupo_chave: registro.grupo_chave,
            unidade: registro.unidade,
            documentos: JSON.parse(registro.documentos_json || "[]"),
            quantidade_alunos: registro.quantidade_alunos,
            quantidade_emails:
              usuarioAtual && emModoApresentacao(usuarioAtual)
                ? 0
                : registro.quantidade_emails,
            assunto: registro.assunto,
            prazo: registro.prazo,
            tipo_destinatario: registro.tipo_destinatario,
            ras:
              usuarioAtual && emModoApresentacao(usuarioAtual)
                ? []
                : JSON.parse(registro.ras_json || "[]"),
          })),
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Histórico indisponível. Execute a migration 001_comunicacoes.sql no D1.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // POST /api/comunicacoes
    // Registra a cobrança depois que o usuário conclui o envio.
    // =====================================================

    if (url.pathname === "/api/comunicacoes" && request.method === "POST") {
      if (usuarioAtual && emModoApresentacao(usuarioAtual)) {
        return Response.json(
          {
            erro: "Ação indisponível no modo apresentação.",
          },
          {
            status: 403,
          },
        );
      }
      try {
        const body = await request.json<{
          grupo_chave: string;
          unidade: string;
          documentos: string[];
          quantidade_alunos: number;
          quantidade_emails: number;
          assunto: string;
          prazo: string;
          tipo_destinatario: string;
          ras: string[];
        }>();

        if (
          !body.grupo_chave ||
          !Array.isArray(body.documentos) ||
          !Array.isArray(body.ras) ||
          body.quantidade_alunos < 1
        ) {
          return Response.json(
            {
              erro: "Dados insuficientes para registrar a cobrança.",
            },
            {
              status: 400,
            },
          );
        }

        const resultado = await env.DB.prepare(
          `
            INSERT INTO comunicacoes (
              grupo_chave,
              unidade,
              documentos_json,
              quantidade_alunos,
              quantidade_emails,
              assunto,
              prazo,
              tipo_destinatario,
              ras_json,
              periodo_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            body.grupo_chave,
            body.unidade || "TODAS",
            JSON.stringify(body.documentos),
            body.quantidade_alunos,
            body.quantidade_emails,
            body.assunto || "",
            body.prazo || "",
            body.tipo_destinatario || "institucional",
            JSON.stringify(body.ras),
            periodoAtual!.id,
          )
          .run();

        return Response.json(
          {
            sucesso: true,
            id: resultado.meta.last_row_id,
          },
          {
            status: 201,
          },
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível registrar a cobrança. Verifique se a migration 001_comunicacoes.sql foi executada.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // React / assets
    // =====================================================

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
