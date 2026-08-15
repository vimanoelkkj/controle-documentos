type Unidade = "FACE" | "FEA" | "FCH" | "EAD";

type AlunoImportacao = {
  ra: string;
  nome: string;
  curso: string;
  email?: string;
  email_outro?: string;
  contrato?: boolean;
};

type AlunoNormalizado = {
  ra: string;
  nome: string;
  curso: string;
  email: string | null;
  email_outro: string | null;
  contrato: boolean;
};

type AlunoExistente = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email: string | null;
  email_outro: string | null;
  status: "ATIVO" | "CANCELADO";
};

type AlunoInvalido = {
  indice: number;
  ra?: string;
  nome?: string;
  motivo: string;
};

type ImportacaoAlunosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  registrarPendencia: (
    ra: string,
    motivo: "NOVO ALUNO" | "CADASTRO",
  ) => Promise<void>;
};

const unidadesValidas: Unidade[] = ["FACE", "FEA", "FCH", "EAD"];

function normalizarAlunos(alunos: AlunoImportacao[]) {
  const invalidos: AlunoInvalido[] = [];
  const validos = alunos
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
    .filter((aluno): aluno is AlunoNormalizado => aluno !== null);

  return { validos, invalidos };
}

function removerDuplicados(alunos: AlunoNormalizado[]) {
  const rasDoLote = new Set<string>();
  const duplicados: string[] = [];
  const unicos = alunos.filter((aluno) => {
    if (rasDoLote.has(aluno.ra)) {
      duplicados.push(aluno.ra);
      return false;
    }
    rasDoLote.add(aluno.ra);
    return true;
  });

  return { unicos, duplicados };
}

async function carregarExistentes(
  db: D1Database,
  periodoId: number,
  alunos: AlunoNormalizado[],
) {
  const existentesPorRa = new Map<string, AlunoExistente>();
  const tamanhoConsulta = 80;

  for (let i = 0; i < alunos.length; i += tamanhoConsulta) {
    const lote = alunos.slice(i, i + tamanhoConsulta);
    const placeholders = lote.map(() => "?").join(",");
    const existentes = await db
      .prepare(
        `SELECT ra, nome, curso, unidade, email, email_outro, status
         FROM alunos
         WHERE periodo_id = ? AND ra IN (${placeholders})`,
      )
      .bind(periodoId, ...lote.map((aluno) => aluno.ra))
      .all<AlunoExistente>();

    for (const existente of existentes.results) {
      existentesPorRa.set(existente.ra, existente);
    }
  }

  return existentesPorRa;
}

function separarAlunos(
  alunos: AlunoNormalizado[],
  existentesPorRa: Map<string, AlunoExistente>,
  unidade: Unidade,
) {
  const normalizar = (valor: string | null | undefined) =>
    (valor ?? "").trim();
  const novos = alunos.filter((aluno) => !existentesPorRa.has(aluno.ra));
  const existentes = alunos.filter((aluno) => existentesPorRa.has(aluno.ra));
  const alterados = existentes.filter((aluno) => {
    const atual = existentesPorRa.get(aluno.ra)!;
    return (
      atual.status === "CANCELADO" ||
      normalizar(atual.nome) !== normalizar(aluno.nome) ||
      normalizar(atual.curso) !== normalizar(aluno.curso) ||
      normalizar(atual.unidade) !== normalizar(unidade) ||
      normalizar(atual.email) !== normalizar(aluno.email) ||
      normalizar(atual.email_outro) !== normalizar(aluno.email_outro)
    );
  });
  const alteradosRa = new Set(alterados.map((aluno) => aluno.ra));
  const semAlteracoes = existentes.filter(
    (aluno) => !alteradosRa.has(aluno.ra),
  );

  return { novos, existentes, alterados, semAlteracoes };
}

async function inserirNovos(
  db: D1Database,
  periodoId: number,
  unidade: Unidade,
  alunos: AlunoNormalizado[],
) {
  const tamanhoInsercao = 25;
  for (let i = 0; i < alunos.length; i += tamanhoInsercao) {
    const lote = alunos.slice(i, i + tamanhoInsercao);
    const comandos: D1PreparedStatement[] = [];

    for (const aluno of lote) {
      comandos.push(
        db
          .prepare(
            `INSERT INTO alunos (
               periodo_id, ra, nome, email, email_outro, curso, unidade
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            periodoId,
            aluno.ra,
            aluno.nome,
            aluno.email,
            aluno.email_outro,
            aluno.curso,
            unidade,
          ),
      );
      comandos.push(
        db
          .prepare(
            `INSERT INTO documentos (
               aluno_id, identidade, cpf, certidao, residencia,
               titulo, ensino_medio, contrato
             )
             SELECT id, 0, 0, 0, 0, 0, 0, ?
             FROM alunos
             WHERE periodo_id = ? AND ra = ?`,
          )
          .bind(aluno.contrato ? 1 : 0, periodoId, aluno.ra),
      );
    }

    await db.batch(comandos);
  }
}

async function atualizarExistentes(
  db: D1Database,
  periodoId: number,
  unidade: Unidade,
  alunos: AlunoNormalizado[],
) {
  const tamanhoAtualizacao = 50;
  for (let i = 0; i < alunos.length; i += tamanhoAtualizacao) {
    const lote = alunos.slice(i, i + tamanhoAtualizacao);
    const comandos = lote.map((aluno) =>
      db
        .prepare(
          `UPDATE alunos
           SET nome = ?, email = ?, email_outro = ?, curso = ?, unidade = ?,
               status = 'ATIVO', atualizado_em = CURRENT_TIMESTAMP
           WHERE periodo_id = ? AND ra = ?`,
        )
        .bind(
          aluno.nome,
          aluno.email,
          aluno.email_outro,
          aluno.curso,
          unidade,
          periodoId,
          aluno.ra,
        ),
    );
    await db.batch(comandos);
  }
}

export async function handleImportacaoAlunosRoute({
  request,
  url,
  db,
  periodoId,
  registrarPendencia,
}: ImportacaoAlunosRouteContext): Promise<Response | null> {
  if (
    url.pathname !== "/api/alunos/importar" ||
    request.method !== "POST"
  ) {
    return null;
  }

  try {
    const body = await request.json<{
      unidade: Unidade;
      alunos: AlunoImportacao[];
    }>();

    if (!unidadesValidas.includes(body.unidade)) {
      return Response.json({ erro: "Unidade inválida." }, { status: 400 });
    }
    if (!Array.isArray(body.alunos) || body.alunos.length === 0) {
      return Response.json(
        { erro: "Nenhum aluno foi enviado para sincronização." },
        { status: 400 },
      );
    }

    const { validos, invalidos } = normalizarAlunos(body.alunos);
    const { unicos, duplicados } = removerDuplicados(validos);

    if (unicos.length === 0) {
      return Response.json({
        sucesso: true,
        encontrados: body.alunos.length,
        importados: 0,
        atualizados: 0,
        sem_alteracoes: 0,
        ja_cadastrados: 0,
        duplicados_no_lote: duplicados.length,
        invalidos: invalidos.length,
        detalhes: {
          atualizados: [],
          sem_alteracoes: [],
          duplicados_no_lote: duplicados,
          invalidos,
        },
      });
    }

    const existentesPorRa = await carregarExistentes(db, periodoId, unicos);
    const { novos, existentes, alterados, semAlteracoes } = separarAlunos(
      unicos,
      existentesPorRa,
      body.unidade,
    );

    await inserirNovos(db, periodoId, body.unidade, novos);
    await atualizarExistentes(db, periodoId, body.unidade, alterados);

    const novosRa = new Set(novos.map((aluno) => aluno.ra));
    for (const aluno of [...novos, ...alterados]) {
      await registrarPendencia(
        aluno.ra,
        novosRa.has(aluno.ra) ? "NOVO ALUNO" : "CADASTRO",
      );
    }

    return Response.json({
      sucesso: true,
      encontrados: body.alunos.length,
      importados: novos.length,
      atualizados: alterados.length,
      sem_alteracoes: semAlteracoes.length,
      ja_cadastrados: existentes.length,
      duplicados_no_lote: duplicados.length,
      invalidos: invalidos.length,
      detalhes: {
        atualizados: alterados.map((aluno) => aluno.ra),
        sem_alteracoes: semAlteracoes.map((aluno) => aluno.ra),
        duplicados_no_lote: duplicados,
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
