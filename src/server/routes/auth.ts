import { aguardar } from "../utils/async";
import { obterCookie } from "../utils/cookies";

interface AuthEnv {
  DB: D1Database;
}

export type PerfilUsuario = "ADMIN" | "EDITOR" | "VISUALIZADOR";

export type UsuarioSessao = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: PerfilUsuario;
  ativo: number;
  modo_apresentacao: number;
};

const DURACAO_SESSAO_SEGUNDOS = 60 * 60;

function bytesHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashSenha(senha: string, saltHex?: string) {
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

export class AuthStorageUnavailableError extends Error {
  constructor(causa?: unknown) {
    super("O banco de autenticação está temporariamente indisponível.");
    this.name = "AuthStorageUnavailableError";
    if (causa) console.error("Falha temporária no D1 durante autenticação:", causa);
  }
}

export async function usuarioDaRequisicao(request: Request, env: AuthEnv) {
  const token = obterCookie(request, "cd_session");
  if (!token) return null;

  const tokenHash = await hashToken(token);
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      return await env.DB.prepare(
        `SELECT u.id, u.nome, u.email, u.username, u.perfil, u.ativo,
                u.modo_apresentacao
         FROM sessoes s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token_hash = ?
           AND s.expira_em > CURRENT_TIMESTAMP
           AND u.ativo = 1`,
      )
        .bind(tokenHash)
        .first<UsuarioSessao>();
    } catch (erro) {
      if (tentativa === 2) throw new AuthStorageUnavailableError(erro);
      await aguardar(150);
    }
  }

  return null;
}

export function respostaAuthTemporariamenteIndisponivel() {
  return Response.json(
    {
      erro: "Autenticação temporariamente indisponível. Tente novamente em alguns instantes.",
      codigo: "AUTH_STORAGE_UNAVAILABLE",
      temporario: true,
    },
    { status: 503, headers: { "Retry-After": "2" } },
  );
}

function usuarioPublico(usuario: UsuarioSessao) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    username: usuario.username,
    perfil: usuario.perfil,
    modo_apresentacao: usuario.modo_apresentacao,
  };
}

export async function handleAuthRoute(
  request: Request,
  env: AuthEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === "/api/auth/bootstrap" && request.method === "GET") {
    try {
      const total = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM usuarios`,
      ).first<{ total: number }>();
      return Response.json({ necessario: Number(total?.total || 0) === 0 });
    } catch {
      return Response.json(
        { erro: "Autenticação indisponível. Execute a migration 005_auth.sql." },
        { status: 500 },
      );
    }
  }

  if (url.pathname === "/api/auth/bootstrap" && request.method === "POST") {
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM usuarios`,
    ).first<{ total: number }>();
    if (Number(total?.total || 0) !== 0) {
      return Response.json(
        { erro: "O administrador inicial já foi criado." },
        { status: 409 },
      );
    }

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
    if (!nome || !email || !username || senha.length < 8) {
      return Response.json(
        { erro: "Informe nome, usuário, e-mail e uma senha com pelo menos 8 caracteres." },
        { status: 400 },
      );
    }
    if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
      return Response.json(
        { erro: "O nome de usuário deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou underline." },
        { status: 400 },
      );
    }

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
      `DELETE FROM sessoes WHERE expira_em <= CURRENT_TIMESTAMP`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO sessoes (usuario_id, token_hash, expira_em)
       VALUES (?, ?, datetime('now', '+1 hour'))`,
    )
      .bind(usuario.id, tokenHash)
      .run();

    return Response.json(
      { usuario: usuarioPublico(usuario) },
      { headers: { "Set-Cookie": cookieSessao(token, request) } },
    );
  }

  if (url.pathname === "/api/auth/atividade" && request.method === "POST") {
    try {
      const token = obterCookie(request, "cd_session");
      if (!token) return Response.json({ erro: "Não autenticado." }, { status: 401 });

      const resultado = await env.DB.prepare(
        `UPDATE sessoes
         SET expira_em = datetime('now', '+1 hour')
         WHERE token_hash = ? AND expira_em > CURRENT_TIMESTAMP`,
      )
        .bind(await hashToken(token))
        .run();

      if (!resultado.meta.changes) {
        return Response.json(
          { erro: "Sessão expirada." },
          { status: 401, headers: { "Set-Cookie": cookieSessao("", request, 0) } },
        );
      }
      return Response.json(
        { sucesso: true },
        { headers: { "Set-Cookie": cookieSessao(token, request) } },
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
      { headers: { "Set-Cookie": cookieSessao("", request, 0) } },
    );
  }

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    try {
      const usuario = await usuarioDaRequisicao(request, env);
      if (!usuario) return Response.json({ erro: "Não autenticado." }, { status: 401 });
      return Response.json({ usuario: usuarioPublico(usuario) });
    } catch (erro) {
      if (erro instanceof AuthStorageUnavailableError) {
        return respostaAuthTemporariamenteIndisponivel();
      }
      throw erro;
    }
  }

  return null;
}
