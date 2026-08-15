type EventoAuditoriaCurso = {
  acao: string;
  entidade: string;
  descricao: string;
  unidade?: string | null;
};

type CursosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  podeEditar: boolean;
  registrarAuditoria: (evento: EventoAuditoriaCurso) => Promise<void>;
};

function normalizarTexto(valor: unknown) {
  return String(valor ?? "").trim();
}

function normalizarComparacao(valor: unknown) {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export async function handleCursosRoute({
  request,
  url,
  db,
  periodoId,
  podeEditar,
  registrarAuditoria,
}: CursosRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/cursos" && request.method === "GET") {
    const resultado = await db
      .prepare(
        `SELECT curso, unidade, COUNT(*) AS total
         FROM alunos
         WHERE periodo_id = ?
         GROUP BY curso, unidade
         ORDER BY curso, unidade`,
      )
      .bind(periodoId)
      .all<{ curso: string; unidade: string; total: number }>();

    const cursos = new Map<
      string,
      {
        curso: string;
        total_alunos: number;
        unidades: Array<{ unidade: string; total: number }>;
      }
    >();

    for (const item of resultado.results) {
      const atual = cursos.get(item.curso) ?? {
        curso: item.curso,
        total_alunos: 0,
        unidades: [],
      };
      atual.total_alunos += Number(item.total);
      atual.unidades.push({
        unidade: item.unidade,
        total: Number(item.total),
      });
      cursos.set(item.curso, atual);
    }

    return Response.json([...cursos.values()]);
  }

  if (url.pathname !== "/api/cursos/unidade" || request.method !== "PUT") {
    return null;
  }

  if (!podeEditar) {
    return Response.json(
      { erro: "Seu perfil possui acesso somente para leitura." },
      { status: 403 },
    );
  }

  const body = await request.json<{
    curso?: string;
    unidade?: string;
    confirmacao?: string;
  }>();
  const curso = normalizarTexto(body.curso);
  const cursoChave = normalizarComparacao(curso);
  const unidade = normalizarComparacao(body.unidade);

  if (
    !curso ||
    !["FACE", "FEA", "FCH", "EAD"].includes(unidade) ||
    normalizarComparacao(body.confirmacao) !== "ALTERAR"
  ) {
    return Response.json(
      { erro: "Informe o curso, uma unidade válida e confirme com ALTERAR." },
      { status: 400 },
    );
  }

  const existente = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM alunos WHERE periodo_id = ? AND curso = ?",
    )
    .bind(periodoId, curso)
    .first<{ total: number }>();

  if (!existente?.total) {
    return Response.json(
      { erro: "Nenhum aluno desse curso foi encontrado no período atual." },
      { status: 404 },
    );
  }

  const resultados = await db.batch([
    db
      .prepare(
        `UPDATE alunos
         SET unidade = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE periodo_id = ? AND curso = ? AND unidade <> ?`,
      )
      .bind(unidade, periodoId, curso, unidade),
    db
      .prepare(
        `INSERT INTO google_sheets_mapeamentos
           (periodo_id, curso_chave, curso, unidade, atualizado_em)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(periodo_id, curso_chave) DO UPDATE SET
           curso = excluded.curso,
           unidade = excluded.unidade,
           atualizado_em = CURRENT_TIMESTAMP`,
      )
      .bind(periodoId, cursoChave, curso, unidade),
  ]);

  const alterados = Number(resultados[0].meta.changes ?? 0);
  await registrarAuditoria({
    acao: "MAPEAR_UNIDADE",
    entidade: "CURSO",
    descricao: `Unidade do curso ${curso} alterada para ${unidade}; ${alterados} aluno(s) atualizado(s).`,
    unidade,
  });

  return Response.json({
    sucesso: true,
    curso,
    unidade,
    alunos_total: Number(existente.total),
    alunos_alterados: alterados,
  });
}
