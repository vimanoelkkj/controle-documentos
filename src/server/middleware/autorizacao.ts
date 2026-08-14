import {
  AuthStorageUnavailableError,
  respostaAuthTemporariamenteIndisponivel,
  usuarioDaRequisicao,
  type UsuarioSessao,
} from "../routes/auth";

export function emModoApresentacao(usuario: UsuarioSessao) {
  return usuario.modo_apresentacao === 1;
}

export function podeEditar(usuario: UsuarioSessao) {
  return (
    !emModoApresentacao(usuario) &&
    (usuario.perfil === "ADMIN" || usuario.perfil === "EDITOR")
  );
}

export async function autorizarRequisicaoApi(
  request: Request,
  url: URL,
  db: D1Database,
): Promise<{
  usuario: UsuarioSessao | null;
  resposta: Response | null;
}> {
  if (!url.pathname.startsWith("/api/")) {
    return { usuario: null, resposta: null };
  }

  let usuario: UsuarioSessao | null;
  try {
    usuario = await usuarioDaRequisicao(request, { DB: db });
  } catch (erro) {
    if (erro instanceof AuthStorageUnavailableError) {
      return {
        usuario: null,
        resposta: respostaAuthTemporariamenteIndisponivel(),
      };
    }
    throw erro;
  }

  if (!usuario) {
    return {
      usuario: null,
      resposta: Response.json(
        { erro: "SessÃ£o expirada ou nÃ£o autenticada." },
        { status: 401 },
      ),
    };
  }

  const metodoMutavel = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );
  const rotaPermitidaNoModoApresentacao =
    url.pathname === "/api/auth/logout" ||
    url.pathname === "/api/auth/atividade" ||
    /^\/api\/periodos\/\d+\/google-sheets\/previa$/.test(url.pathname);

  if (
    emModoApresentacao(usuario) &&
    metodoMutavel &&
    !rotaPermitidaNoModoApresentacao
  ) {
    return {
      usuario,
      resposta: Response.json(
        { erro: "AÃ§Ã£o indisponÃ­vel no modo apresentaÃ§Ã£o." },
        { status: 403 },
      ),
    };
  }

  const rotaSensivelNoModoApresentacao =
    (url.pathname === "/api/log" && request.method === "GET") ||
    (request.method === "GET" &&
      /^\/api\/periodos\/\d+\/google-sheets\/pendencias$/.test(url.pathname));

  if (emModoApresentacao(usuario) && rotaSensivelNoModoApresentacao) {
    return {
      usuario,
      resposta: Response.json(
        { erro: "ConteÃºdo indisponÃ­vel no modo apresentaÃ§Ã£o." },
        { status: 403 },
      ),
    };
  }

  return { usuario, resposta: null };
}

export function bloquearEscritaSemPermissao(
  request: Request,
  url: URL,
  usuario: UsuarioSessao,
) {
  const rotaSomenteLeituraViaPost =
    /^\/api\/periodos\/\d+\/google-sheets\/previa$/.test(url.pathname);

  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !rotaSomenteLeituraViaPost &&
    !podeEditar(usuario)
  ) {
    return Response.json(
      { erro: "Seu perfil Ã© somente visualizaÃ§Ã£o." },
      { status: 403 },
    );
  }
  return null;
}
