import {
  AuthStorageUnavailableError,
  respostaAuthTemporariamenteIndisponivel,
  usuarioDaRequisicao,
  type UsuarioSessao,
} from "../routes/auth";

export function emModoApresentacao(usuario: UsuarioSessao | null | undefined) {
  return Boolean(usuario && usuario.modo_apresentacao === 1);
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
    const cookieHeader = request.headers.get("Cookie") || "";
    const temCookieSessao = /(?:^|;\s*)cd_session=/.test(cookieHeader);
    const rotaSyncV2Admin = /^\/api\/periodos\/\d+\/sync-v2\/[a-z0-9-]+$/.test(
      url.pathname,
    );
    const temSecretHeader = Boolean(
      request.headers.get("X-Sync-Admin-Secret")?.trim(),
    );

    if (rotaSyncV2Admin && !temCookieSessao && temSecretHeader) {
      return { usuario: null, resposta: null };
    }

    return {
      usuario: null,
      resposta: Response.json(
        { erro: "Sessão expirada ou não autenticada." },
        { status: 401 },
      ),
    };
  }

  const metodoMutavel = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );

  if (metodoMutavel) {
    const originHeader = request.headers.get("Origin");
    if (originHeader) {
      let origemValida = false;
      try {
        origemValida = new URL(originHeader).origin === url.origin;
      } catch {
        origemValida = false;
      }
      if (!origemValida) {
        return {
          usuario,
          resposta: Response.json(
            {
              erro: "Origem da requisição não autorizada.",
              codigo: "ORIGEM_NAO_AUTORIZADA",
            },
            { status: 403 },
          ),
        };
      }
    }
  }

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
        {
          erro: "Ação indisponível no modo apresentação.",
          codigo: "MODO_APRESENTACAO_BLOQUEADO",
        },
        { status: 403 },
      ),
    };
  }

  const rotaSensivelNoModoApresentacao =
    (url.pathname === "/api/log" && request.method === "GET") ||
    (request.method === "GET" &&
      /^\/api\/periodos\/\d+\/google-sheets(\/pendencias|\/status)?$/.test(
        url.pathname,
      )) ||
    /^\/api\/periodos\/\d+\/sync-v2\/[a-z0-9-]+$/.test(url.pathname);

  if (emModoApresentacao(usuario) && rotaSensivelNoModoApresentacao) {
    return {
      usuario,
      resposta: Response.json(
        {
          erro: "Conteúdo indisponível no modo apresentação.",
          codigo: "MODO_APRESENTACAO_BLOQUEADO",
        },
        { status: 403 },
      ),
    };
  }

  const rotaEstruturalExclusivaAdmin =
    (url.pathname === "/api/periodos" && request.method === "POST") ||
    (/^\/api\/periodos\/\d+$/.test(url.pathname) && request.method === "PUT") ||
    (/^\/api\/periodos\/\d+\/google-sheets(\/mapeamentos)?$/.test(
      url.pathname,
    ) &&
      request.method === "PUT");

  if (rotaEstruturalExclusivaAdmin && usuario.perfil !== "ADMIN") {
    return {
      usuario,
      resposta: Response.json(
        {
          erro: "Apenas administradores podem gerenciar períodos e configurações de integração.",
          codigo: "PRIVILEGIO_INSUFICIENTE",
        },
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
      { erro: "Seu perfil é somente visualização." },
      { status: 403 },
    );
  }
  return null;
}
