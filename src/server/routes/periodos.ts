type EventoAuditoriaPeriodo = {
  acao: string;
  entidade: string;
  descricao: string;
};

type PeriodosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  registrarAuditoria: (
    periodoId: number,
    evento: EventoAuditoriaPeriodo,
  ) => Promise<void>;
};

type PeriodoComTotal = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  criado_em: string;
  atualizado_em: string;
  total_alunos: number;
};

export async function handlePeriodosRoute({
  request,
  url,
  db,
  registrarAuditoria,
}: PeriodosRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/periodos" && request.method === "GET") {
    try {
      const resultado = await db.prepare(
        `
          SELECT
            p.id, p.codigo, p.status, p.criado_em, p.atualizado_em,
            COUNT(a.id) AS total_alunos
          FROM periodos p
          LEFT JOIN alunos a ON a.periodo_id = p.id
          GROUP BY p.id
          ORDER BY p.codigo DESC
        `,
      ).all<PeriodoComTotal>();
      return Response.json(resultado.results);
    } catch (erro) {
      console.error(erro);
      return Response.json(
        {
          erro: "Períodos indisponíveis. Execute a migration 003_periodos.sql no D1.",
        },
        { status: 500 },
      );
    }
  }

  if (url.pathname === "/api/periodos" && request.method === "POST") {
    try {
      const body = await request.json<{ codigo: string }>();
      const codigo = body.codigo?.trim().toUpperCase();
      if (!/^\d{4}-(1|2)$/.test(codigo || "")) {
        return Response.json(
          { erro: "Período inválido. Use AAAA-1 ou AAAA-2." },
          { status: 400 },
        );
      }

      const existente = await db
        .prepare(`SELECT id FROM periodos WHERE codigo = ?`)
        .bind(codigo)
        .first();
      if (existente) {
        return Response.json(
          { erro: "Este período já existe." },
          { status: 409 },
        );
      }

      const resultado = await db
        .prepare(`INSERT INTO periodos (codigo, status) VALUES (?, 'ATIVO')`)
        .bind(codigo)
        .run();
      const periodoId = Number(resultado.meta.last_row_id);

      await registrarAuditoria(periodoId, {
        acao: "CRIAR",
        entidade: "PERIODO",
        descricao: `Período letivo ${codigo} criado.`,
      });

      return Response.json(
        { sucesso: true, id: resultado.meta.last_row_id, codigo },
        { status: 201 },
      );
    } catch (erro) {
      console.error(erro);
      return Response.json(
        { erro: "Não foi possível criar o período." },
        { status: 500 },
      );
    }
  }

  const rotaPeriodo = url.pathname.match(/^\/api\/periodos\/(\d+)$/);
  if (!rotaPeriodo || request.method !== "PUT") return null;

  try {
    const id = Number(rotaPeriodo[1]);
    const body = await request.json<{ status: "ATIVO" | "ARQUIVADO" }>();
    if (!["ATIVO", "ARQUIVADO"].includes(body.status)) {
      return Response.json(
        { erro: "Status de período inválido." },
        { status: 400 },
      );
    }

    const periodo = await db
      .prepare(`SELECT id, codigo FROM periodos WHERE id = ?`)
      .bind(id)
      .first<{ id: number; codigo: string }>();
    if (!periodo) {
      return Response.json(
        { erro: "Período não encontrado." },
        { status: 404 },
      );
    }

    await db
      .prepare(
        `UPDATE periodos SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status, id)
      .run();
    await registrarAuditoria(id, {
      acao: body.status === "ARQUIVADO" ? "ARQUIVAR" : "REATIVAR",
      entidade: "PERIODO",
      descricao: `Período ${periodo.codigo} alterado para ${body.status}.`,
    });

    return Response.json({
      sucesso: true,
      id,
      codigo: periodo.codigo,
      status: body.status,
    });
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível alterar o período." },
      { status: 500 },
    );
  }
}
