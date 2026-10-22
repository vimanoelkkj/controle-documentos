type UsuarioLog = {
  id: number;
  nome: string;
  username: string;
  perfil?: string;
  modo_apresentacao?: number;
};

type LogBody = {
  acao: string;
  entidade: string;
  descricao: string;
  ra?: string;
  unidade?: string;
};

type LogsRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  usuario: UsuarioLog | null;
};

async function listarLogs(
  url: URL,
  db: D1Database,
  periodoId: number,
  usuario: UsuarioLog | null,
) {
  if (usuario?.modo_apresentacao === 1) {
    return Response.json(
      {
        erro: "Conteúdo indisponível no modo apresentação.",
        codigo: "MODO_APRESENTACAO_BLOQUEADO",
      },
      { status: 403 },
    );
  }

  const escopoGlobal = url.searchParams.get("scope") === "all";
  if (escopoGlobal && usuario?.perfil !== "ADMIN") {
    return Response.json(
      {
        erro: "Apenas administradores podem consultar o LOG global de todos os períodos.",
        codigo: "PRIVILEGIO_INSUFICIENTE",
      },
      { status: 403 },
    );
  }

  try {
    const limiteSolicitado = Number(url.searchParams.get("limit") || "200");
    const limite = Math.max(
      1,
      Math.min(500, Number.isFinite(limiteSolicitado) ? limiteSolicitado : 200),
    );
    const consulta = escopoGlobal
      ? `SELECT l.id,
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
         LIMIT ?`
      : `SELECT id,
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
         LIMIT ?`;

    const resultado = await db
      .prepare(consulta)
      .bind(...(escopoGlobal ? [limite] : [periodoId, limite]))
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

async function registrarLog(
  request: Request,
  db: D1Database,
  periodoId: number,
  usuario: UsuarioLog | null,
) {
  let body: LogBody;
  try {
    body = await request.json<LogBody>();
  } catch {
    return Response.json(
      { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
      { status: 400 },
    );
  }

  try {
    if (
      typeof body.acao !== "string" ||
      !body.acao.trim() ||
      typeof body.entidade !== "string" ||
      !body.entidade.trim() ||
      typeof body.descricao !== "string" ||
      !body.descricao.trim()
    ) {
      return Response.json(
        { erro: "Dados insuficientes para registrar o LOG." },
        { status: 400 },
      );
    }

    await db
      .prepare(
        `INSERT INTO logs (
           acao, entidade, descricao, ra, unidade, periodo_id,
           usuario_id, usuario_nome, usuario_username
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.acao.trim(),
        body.entidade.trim(),
        body.descricao.trim(),
        typeof body.ra === "string" ? body.ra.trim() || null : null,
        typeof body.unidade === "string" ? body.unidade.trim() || null : null,
        periodoId,
        usuario?.id ?? null,
        usuario?.nome ?? null,
        usuario?.username ?? null,
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

export async function handleLogsRoute({
  request,
  url,
  db,
  periodoId,
  usuario,
}: LogsRouteContext): Promise<Response | null> {
  if (url.pathname !== "/api/log") return null;

  if (request.method === "GET") {
    return listarLogs(url, db, periodoId, usuario);
  }
  if (request.method === "POST") {
    return registrarLog(request, db, periodoId, usuario);
  }

  return null;
}
