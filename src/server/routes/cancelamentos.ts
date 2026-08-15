type Unidade = "FACE" | "FEA" | "FCH" | "EAD";
type StatusMatricula = "ATIVO" | "CANCELADO";

type CancelamentosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  registrarPendencia: (ra: string) => Promise<void>;
};

type AlunoCancelamento = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  status: StatusMatricula;
};

const unidadesValidas: Unidade[] = ["FACE", "FEA", "FCH", "EAD"];
const tamanhoConsulta = 80;

function normalizarRas(ras: string[]) {
  return [...new Set(ras.map((ra) => String(ra ?? "").trim()).filter(Boolean))];
}

async function buscarAlunosPorRa(
  db: D1Database,
  periodoId: number,
  ras: string[],
) {
  const encontrados = new Map<string, AlunoCancelamento>();
  for (let i = 0; i < ras.length; i += tamanhoConsulta) {
    const lote = ras.slice(i, i + tamanhoConsulta);
    const placeholders = lote.map(() => "?").join(",");
    const resultado = await db
      .prepare(
        `SELECT ra, nome, curso, unidade, status
         FROM alunos
         WHERE periodo_id = ? AND ra IN (${placeholders})`,
      )
      .bind(periodoId, ...lote)
      .all<AlunoCancelamento>();
    for (const aluno of resultado.results) encontrados.set(aluno.ra, aluno);
  }
  return encontrados;
}

export async function handleCancelamentosRoute({
  request,
  url,
  db,
  periodoId,
  registrarPendencia,
}: CancelamentosRouteContext): Promise<Response | null> {
  if (
    url.pathname === "/api/alunos/cancelados/previa" &&
    request.method === "POST"
  ) {
    try {
      const body = await request.json<{ unidade: Unidade; ras: string[] }>();
      if (!unidadesValidas.includes(body.unidade)) {
        return Response.json({ erro: "Unidade inválida." }, { status: 400 });
      }
      if (!Array.isArray(body.ras) || body.ras.length === 0) {
        return Response.json(
          { erro: "Nenhum RA foi enviado." },
          { status: 400 },
        );
      }

      const ras = normalizarRas(body.ras);
      const encontrados = await buscarAlunosPorRa(db, periodoId, ras);
      const alunos = ras.map((ra) => {
        const aluno = encontrados.get(ra);
        if (!aluno) return { ra, status_previa: "NAO_ENCONTRADO" as const };
        if (aluno.status === "CANCELADO") {
          return { ...aluno, status_previa: "JA_CANCELADO" as const };
        }
        return {
          ...aluno,
          status_previa:
            aluno.unidade === body.unidade
              ? ("PRONTO" as const)
              : ("OUTRA_UNIDADE" as const),
        };
      });

      return Response.json({
        sucesso: true,
        recebidos: ras.length,
        prontos_para_cancelar: alunos.filter(
          (aluno) => aluno.status_previa === "PRONTO",
        ).length,
        ja_cancelados: alunos.filter(
          (aluno) => aluno.status_previa === "JA_CANCELADO",
        ).length,
        nao_encontrados: alunos.filter(
          (aluno) => aluno.status_previa === "NAO_ENCONTRADO",
        ).length,
        outra_unidade: alunos.filter(
          (aluno) => aluno.status_previa === "OUTRA_UNIDADE",
        ).length,
        alunos,
      });
    } catch (erro) {
      console.error(erro);
      return Response.json(
        { erro: "Não foi possível analisar os cancelados." },
        { status: 500 },
      );
    }
  }

  if (
    url.pathname === "/api/alunos/cancelados" &&
    request.method === "POST"
  ) {
    try {
      const body = await request.json<{ unidade: Unidade; ras: string[] }>();
      if (!unidadesValidas.includes(body.unidade)) {
        return Response.json({ erro: "Unidade inválida." }, { status: 400 });
      }
      if (!Array.isArray(body.ras) || body.ras.length === 0) {
        return Response.json(
          { erro: "Nenhum RA foi enviado para cancelamento." },
          { status: 400 },
        );
      }

      const ras = normalizarRas(body.ras);
      const encontrados = await buscarAlunosPorRa(db, periodoId, ras);
      const paraCancelar = ras.filter((ra) => {
        const aluno = encontrados.get(ra);
        return (
          aluno &&
          aluno.unidade === body.unidade &&
          aluno.status !== "CANCELADO"
        );
      });
      const jaCancelados = ras.filter((ra) => {
        const aluno = encontrados.get(ra);
        return Boolean(
          aluno &&
            aluno.unidade === body.unidade &&
            aluno.status === "CANCELADO",
        );
      });
      const naoEncontrados = ras.filter((ra) => !encontrados.has(ra));
      const outraUnidade = ras.filter((ra) => {
        const aluno = encontrados.get(ra);
        return Boolean(aluno && aluno.unidade !== body.unidade);
      });

      const tamanhoAtualizacao = 50;
      for (let i = 0; i < paraCancelar.length; i += tamanhoAtualizacao) {
        const lote = paraCancelar.slice(i, i + tamanhoAtualizacao);
        await db.batch(
          lote.map((ra) =>
            db
              .prepare(
                `UPDATE alunos
                 SET status = 'CANCELADO', atualizado_em = CURRENT_TIMESTAMP
                 WHERE periodo_id = ? AND ra = ? AND unidade = ?`,
              )
              .bind(periodoId, ra, body.unidade),
          ),
        );
      }
      for (const ra of paraCancelar) await registrarPendencia(ra);

      return Response.json({
        sucesso: true,
        recebidos: ras.length,
        cancelados: paraCancelar.length,
        ja_cancelados: jaCancelados.length,
        nao_encontrados: naoEncontrados.length,
        outra_unidade: outraUnidade.length,
        detalhes: {
          cancelados: paraCancelar,
          ja_cancelados: jaCancelados,
          nao_encontrados: naoEncontrados,
          outra_unidade: outraUnidade,
        },
      });
    } catch (erro) {
      console.error(erro);
      return Response.json(
        { erro: "Não foi possível cancelar os alunos." },
        { status: 500 },
      );
    }
  }

  const rotaStatusAluno = url.pathname.match(
    /^\/api\/alunos\/([^/]+)\/status$/,
  );
  if (!rotaStatusAluno || request.method !== "PUT") return null;

  try {
    const ra = decodeURIComponent(rotaStatusAluno[1]);
    const body = await request.json<{ status: StatusMatricula }>();
    if (!["ATIVO", "CANCELADO"].includes(body.status)) {
      return Response.json({ erro: "Status inválido." }, { status: 400 });
    }

    const aluno = await db
      .prepare(
        `SELECT id, status FROM alunos WHERE periodo_id = ? AND ra = ?`,
      )
      .bind(periodoId, ra)
      .first<{ id: number; status: StatusMatricula }>();
    if (!aluno) {
      return Response.json(
        { erro: "Aluno não encontrado." },
        { status: 404 },
      );
    }
    if (aluno.status === body.status) {
      return Response.json({
        sucesso: true,
        ra,
        status: body.status,
        alterado: false,
      });
    }

    await db
      .prepare(
        `UPDATE alunos
         SET status = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(body.status, aluno.id)
      .run();
    await registrarPendencia(ra);

    return Response.json({
      sucesso: true,
      ra,
      status: body.status,
      alterado: true,
    });
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível alterar o status da matrícula." },
      { status: 500 },
    );
  }
}
