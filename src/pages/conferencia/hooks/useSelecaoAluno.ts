import { useState, type Dispatch, type SetStateAction } from "react";
import type { Aluno } from "../model";

type UseSelecaoAlunoParams = {
  setAlunosEmEdicao: Dispatch<SetStateAction<Aluno[]>>;
  raSelecionado: string;
  setRaSelecionado: Dispatch<SetStateAction<string>>;
  alunoSalvo: Aluno;
  temAlteracoes: boolean;
  setStatus: Dispatch<SetStateAction<"salvo" | "pendente">>;
};

export function useSelecaoAluno({
  setAlunosEmEdicao,
  raSelecionado,
  setRaSelecionado,
  alunoSalvo,
  temAlteracoes,
  setStatus,
}: UseSelecaoAlunoParams) {
  const [trocaAlunoPendente, setTrocaAlunoPendente] = useState<string | null>(
    null,
  );

  function selecionarAluno(ra: string) {
    if (ra === raSelecionado) return;

    if (temAlteracoes) {
      setTrocaAlunoPendente(ra);
      return;
    }

    setRaSelecionado(ra);
    setStatus("salvo");
  }

  function descartarAlteracoesETrocarAluno() {
    if (!trocaAlunoPendente) return;

    setAlunosEmEdicao((estadoAtual) =>
      estadoAtual.map((aluno) =>
        aluno.ra === raSelecionado
          ? {
              ...alunoSalvo,
              documentos: alunoSalvo.documentos.map((documento) => ({
                ...documento,
              })),
            }
          : aluno,
      ),
    );

    setRaSelecionado(trocaAlunoPendente);
    setTrocaAlunoPendente(null);
    setStatus("salvo");
  }

  return {
    trocaAlunoPendente,
    setTrocaAlunoPendente,
    selecionarAluno,
    descartarAlteracoesETrocarAluno,
  };
}
