export type AlunoRow = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

export type DocumentosBody = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

export type RangeGoogle = {
  aba: string;
  linhas: unknown[][];
};

export type OrigemGoogleSheets = "FACE_FEA" | "FCH_EAD";

export type LinhaBaseGoogleSheets = {
  ra: string;
  nome: string;
  curso: string;
  email_outro: string;
  email: string;
  contrato: boolean;
  origem: OrigemGoogleSheets;
};

export function lerBaseGoogleSheets(
  linhas: unknown[][],
  origem: OrigemGoogleSheets,
  normalizarTexto: (valor: unknown) => string,
  normalizarComparacao: (valor: unknown) => string,
): LinhaBaseGoogleSheets[] {
  return linhas
    .slice(1)
    .map((l) => ({
      contrato: normalizarComparacao(l[0]) === "ENTREGUE",
      curso: normalizarTexto(l[1]),
      email_outro: normalizarTexto(l[2]),
      email: normalizarTexto(l[3]),
      nome: normalizarTexto(l[4]),
      ra: normalizarTexto(l[5]),
      origem,
    }))
    .filter((aluno) => aluno.ra && aluno.nome && aluno.curso);
}

export function lerDocumentosGoogleSheets(
  linhas: unknown[][],
  normalizarTexto: (valor: unknown) => string,
  valorBooleano: (valor: unknown) => boolean,
): Map<string, DocumentosBody> {
  return new Map(
    linhas
      .slice(1)
      .map((l) => [
        normalizarTexto(l[0]),
        {
          identidade: valorBooleano(l[2]),
          cpf: valorBooleano(l[3]),
          certidao: valorBooleano(l[4]),
          residencia: valorBooleano(l[5]),
          titulo: valorBooleano(l[6]),
          ensino_medio: valorBooleano(l[7]),
          contrato: valorBooleano(l[8]),
        },
      ])
      .filter(([ra]) => Boolean(ra)) as Array<[string, DocumentosBody]>,
  );
}

export function lerCanceladosGoogleSheets(
  linhas: unknown[][],
  normalizarTexto: (valor: unknown) => string,
): Set<string> {
  return new Set(
    linhas
      .slice(1)
      .map((l) => normalizarTexto(l[5] ?? l[0]))
      .filter(Boolean),
  );
}

export function resolverUnidadeGoogleSheets(
  aluno: LinhaBaseGoogleSheets,
  unidadePorCurso: Map<string, string>,
  cursoUnidades: Map<string, Set<string>>,
  normalizarComparacao: (valor: unknown) => string,
): string | null {
  const cursoChave = normalizarComparacao(aluno.curso);

  const mapeada = unidadePorCurso.get(cursoChave);
  if (mapeada) return mapeada;

  if (aluno.origem === "FCH_EAD") {
    return null;
  }

  const conhecidas = [...(cursoUnidades.get(cursoChave) ?? [])].filter(
    (unidade) => unidade === "FACE" || unidade === "FEA",
  );

  return conhecidas.length === 1 ? conhecidas[0] : null;
}

export function montarCursoUnidades(
  alunos: Array<Pick<AlunoRow, "curso" | "unidade">>,
  normalizarComparacao: (valor: unknown) => string,
): Map<string, Set<string>> {
  const cursoUnidades = new Map<string, Set<string>>();

  for (const aluno of alunos) {
    const curso = normalizarComparacao(aluno.curso);

    if (!cursoUnidades.has(curso)) {
      cursoUnidades.set(curso, new Set());
    }

    cursoUnidades.get(curso)!.add(aluno.unidade);
  }

  return cursoUnidades;
}

export async function carregarUnidadePorCurso(
  db: D1Database,
  periodoId: number,
): Promise<Map<string, string>> {
  const mapeamentosSalvos = await db
    .prepare(
      `
      SELECT curso_chave, unidade
      FROM google_sheets_mapeamentos
      WHERE periodo_id = ?
    `,
    )
    .bind(periodoId)
    .all<{ curso_chave: string; unidade: string }>();

  return new Map(
    mapeamentosSalvos.results.map((mapeamento) => [
      mapeamento.curso_chave,
      mapeamento.unidade,
    ]),
  );
}
