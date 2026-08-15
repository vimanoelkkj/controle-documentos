type UsuarioLog = {
  id: number;
  nome: string;
  username: string;
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

async function listarLogs(url: URL, db: D1Database, periodoId: number) {
  try {
    const limiteSolicitado = Number(url.searchParams.get("limit") || "200");
    const limite = Math.max(1, Math.min(500, limiteSolicitado));
    const escopoGlobal = url.searchParams.get("scope") === "all";
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
  try {
    const body = await request.json<LogBody>();
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
        body.ra?.trim() || null,
        body.unidade?.trim() || null,
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
    return listarLogs(url, db, periodoId);
  }
  if (request.method === "POST") {
    return registrarLog(request, db, periodoId, usuario);
  }

  return null;
}
