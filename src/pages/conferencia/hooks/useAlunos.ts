import { useCallback, useState } from "react";
import { api } from "../../../lib/api";
import {
  clonarAlunos,
  converterAlunosApi,
  type Aluno,
  type AlunoApi,
  type FiltroStatus,
  type Unidade,
} from "../model";

export function useAlunos() {
  const [alunosSalvos, setAlunosSalvos] = useState<Aluno[]>([]);
  const [alunosEmEdicao, setAlunosEmEdicao] = useState<Aluno[]>([]);
  const [raSelecionado, setRaSelecionado] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregarAlunos = useCallback(async (
      raParaSelecionar: string | undefined,
      unidadeFiltro: Unidade | "",
      statusFiltro: FiltroStatus,
    ) => {
    try {
      setCarregando(true);
      setErro("");

      const dados = await api.get<AlunoApi[]>("/api/alunos");
      const alunosConvertidos = converterAlunosApi(dados);

      setAlunosSalvos(clonarAlunos(alunosConvertidos));
      setAlunosEmEdicao(clonarAlunos(alunosConvertidos));

      const pertenceAoFiltroAtual = (aluno: Aluno) =>
        aluno.unidade === unidadeFiltro &&
        (statusFiltro === "TODOS" || aluno.status === statusFiltro);

      if (raParaSelecionar) {
        const alunoSolicitado = alunosConvertidos.find(
          (aluno) => aluno.ra === raParaSelecionar,
        );

        if (alunoSolicitado && pertenceAoFiltroAtual(alunoSolicitado)) {
          setRaSelecionado(raParaSelecionar);
          return;
        }
      }

      setRaSelecionado("");
    } catch (erro) {
      console.error(erro);
      setErro("Não foi possível carregar os alunos.");
    } finally {
      setCarregando(false);
    }
    }, []);

  return {
    alunosSalvos,
    setAlunosSalvos,
    alunosEmEdicao,
    setAlunosEmEdicao,
    raSelecionado,
    setRaSelecionado,
    carregando,
    erro,
    carregarAlunos,
  };
}
