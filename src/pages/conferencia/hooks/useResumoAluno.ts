import { useMemo } from "react";
import { statusDocumentalAluno, type Aluno } from "../model";

export function useResumoAluno(aluno: Aluno) {
  return useMemo(() => {
    const entregues = aluno.documentos.filter(
      (documento) => documento.entregue,
    );

    const pendentes = aluno.documentos.filter(
      (documento) => !documento.entregue,
    );

    const statusResumo = statusDocumentalAluno(aluno);

    const percentual = aluno.documentos.length
      ? Math.round((entregues.length / aluno.documentos.length) * 100)
      : 0;

    const iniciais = aluno.nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("");

    return {
      entregues,
      pendentes,
      statusResumo,
      percentual,
      iniciais,
    };
  }, [aluno]);
}
