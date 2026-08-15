import { useEffect, useMemo } from "react";
import type { AlunoApi, Grupo } from "../model";
import { criarGrupos } from "../utils";

type Params = {
  alunos: AlunoApi[];
  unidade: string;
  buscaGrupo: string;
  grupoSelecionado: string;
  setGrupoSelecionado: (valor: string) => void;
};

type Resultado = {
  unidades: string[];
  grupos: Grupo[];
  grupo: Grupo | undefined;
};

export function useGruposComunicacao({
  alunos,
  unidade,
  buscaGrupo,
  grupoSelecionado,
  setGrupoSelecionado,
}: Params): Resultado {
  const unidades = useMemo(
    () =>
      [...new Set(alunos.map((aluno) => aluno.unidade))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [alunos],
  );

  const grupos = useMemo(() => {
    const base =
      unidade === "TODAS"
        ? alunos
        : alunos.filter((aluno) => aluno.unidade === unidade);

    const termo = buscaGrupo.trim().toLocaleLowerCase("pt-BR");

    return criarGrupos(base).filter(
      (grupo) =>
        !termo ||
        grupo.documentos.some((documento) =>
          documento.curto.toLocaleLowerCase("pt-BR").includes(termo),
        ),
    );
  }, [alunos, unidade, buscaGrupo]);

  useEffect(() => {
    if (!grupos.length) {
      setGrupoSelecionado("");
      return;
    }

    if (!grupos.some((grupo) => grupo.chave === grupoSelecionado)) {
      setGrupoSelecionado(grupos[0].chave);
    }
  }, [grupos, grupoSelecionado, setGrupoSelecionado]);

  const grupo = grupos.find((item) => item.chave === grupoSelecionado);

  return {
    unidades,
    grupos,
    grupo,
  };
}
