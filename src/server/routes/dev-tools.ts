import type { UsuarioSessao } from "./auth";

interface DevToolsEnv {
  DB: D1Database;
  ENVIRONMENT?: string;
}

type PeriodoAtual = {
  id: number;
  codigo: string;
};

type DevToolsRouteContext = {
  request: Request;
  url: URL;
  env: DevToolsEnv;
  usuarioAtual: UsuarioSessao | null;
  periodoAtual: PeriodoAtual | null;
};

function ambienteDesenvolvimento(request: Request, env: DevToolsEnv) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return (
    env.ENVIRONMENT?.toLowerCase() === "dev" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

export async function handleDevToolsRoute({
  request,
  url,
  env,
  usuarioAtual,
  periodoAtual,
}: DevToolsRouteContext): Promise<Response | null> {
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
    url.pathname !== "/api/dev/alunos-reset" ||
    request.method !== "DELETE"
  ) {
    return null;
  }

  if (!ambienteDesenvolvimento(request, env)) {
    return Response.json(
      { erro: "Ferramenta disponível somente no ambiente de desenvolvimento." },
      { status: 403 },
    );
  }
  if (usuarioAtual?.perfil !== "ADMIN") {
    return Response.json(
      { erro: "Apenas administradores podem usar ferramentas de desenvolvimento." },
      { status: 403 },
    );
  }
  if (!periodoAtual) {
    return Response.json(
      { erro: "Nenhum período letivo disponível." },
      { status: 409 },
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

    const filtroUnidade = unidade === "TODOS" ? "" : " AND unidade = ?";
    const parametros = unidade === "TODOS" ? [periodoAtual.id] : [periodoAtual.id, unidade];
    const contagem = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM alunos WHERE periodo_id = ?${filtroUnidade}`,
    )
      .bind(...parametros)
      .first<{ total: number }>();
    await env.DB.prepare(
      `DELETE FROM alunos WHERE periodo_id = ?${filtroUnidade}`,
    )
      .bind(...parametros)
      .run();

    return Response.json({
      sucesso: true,
      unidade,
      removidos: Number(contagem?.total ?? 0),
      periodo: periodoAtual.codigo,
    });
  } catch (erro) {
    console.error("Falha ao limpar alunos de desenvolvimento:", erro);
    return Response.json(
      { erro: "Não foi possível limpar os alunos de desenvolvimento." },
      { status: 500 },
    );
  }
}
