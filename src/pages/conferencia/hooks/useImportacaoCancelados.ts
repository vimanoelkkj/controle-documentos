import { useState, type ChangeEvent } from "react";
import { api } from "../../../lib/api";
import { extrairRasCancelados } from "../importacao";
import type { PreviaCancelados, ResultadoCancelados, Unidade } from "../model";
import { registrarLogAluno } from "../operacoes";

type Opcoes = {
  unidadeInicial: Unidade;
  aoConcluir: (ra: string, unidade: Unidade) => Promise<void>;
};

export function useImportacaoCancelados({ unidadeInicial, aoConcluir }: Opcoes) {
  const [modalImportarCancelados, setModalImportarCancelados] = useState(false);
  const [modoCancelados, setModoCancelados] = useState<"colar" | "csv">("colar");
  const [unidadeCancelados, setUnidadeCancelados] = useState<Unidade>("FACE");
  const [textoCancelados, setTextoCancelados] = useState("");
  const [arquivoCancelados, setArquivoCancelados] = useState("");
  const [previaCancelados, setPreviaCancelados] = useState<PreviaCancelados | null>(null);
  const [resultadoCancelados, setResultadoCancelados] = useState<ResultadoCancelados | null>(null);
  const [processandoCancelados, setProcessandoCancelados] = useState(false);
  const [erroCancelados, setErroCancelados] = useState("");

  function limparImportacaoCancelados() {
    setTextoCancelados("");
    setArquivoCancelados("");
    setPreviaCancelados(null);
    setResultadoCancelados(null);
    setErroCancelados("");
  }

  function abrirImportacaoCancelados() {
    setModoCancelados("colar");
    setUnidadeCancelados(unidadeInicial);
    limparImportacaoCancelados();
    setModalImportarCancelados(true);
  }

  async function selecionarArquivoCancelados(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    setErroCancelados("");
    setPreviaCancelados(null);
    setResultadoCancelados(null);
    setArquivoCancelados(arquivo.name);

    try {
      const bytes = await arquivo.arrayBuffer();
      let conteudo: string;
      try {
        conteudo = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        conteudo = new TextDecoder("windows-1252").decode(bytes);
      }
      setTextoCancelados(conteudo);
    } catch (erro) {
      console.error(erro);
      setErroCancelados("Não foi possível ler o arquivo CSV.");
    }
  }

  async function gerarPreviaCancelados() {
    setErroCancelados("");
    setResultadoCancelados(null);
    if (!textoCancelados.trim()) {
      setErroCancelados(modoCancelados === "csv" ? "Selecione um arquivo CSV." : "Cole os dados da planilha.");
      return;
    }

    try {
      setProcessandoCancelados(true);
      const ras = extrairRasCancelados(textoCancelados);
      if (ras.length === 0) throw new Error("Nenhum RA foi encontrado.");
      const dados = await api.post<PreviaCancelados>("/api/alunos/cancelados/previa", {
        unidade: unidadeCancelados,
        ras,
      });
      setPreviaCancelados(dados);
    } catch (erro) {
      console.error(erro);
      setPreviaCancelados(null);
      setErroCancelados(erro instanceof Error ? erro.message : "Não foi possível analisar os cancelados.");
    } finally {
      setProcessandoCancelados(false);
    }
  }

  async function confirmarCancelados() {
    if (!previaCancelados) return;
    const ras = previaCancelados.alunos
      .filter((aluno) => aluno.status_previa === "PRONTO")
      .map((aluno) => aluno.ra);
    if (ras.length === 0) {
      setErroCancelados("Não há alunos prontos para cancelar.");
      return;
    }

    try {
      setProcessandoCancelados(true);
      setErroCancelados("");
      const dados = await api.post<ResultadoCancelados>("/api/alunos/cancelados", {
        unidade: unidadeCancelados,
        ras,
      });
      setResultadoCancelados(dados);
      await registrarLogAluno(
        "CANCELAMENTO EM LOTE",
        `${ras.length} matrícula(s) processada(s) pela lista de cancelados.`,
        undefined,
        unidadeCancelados,
      );
      await aoConcluir(ras[0], unidadeCancelados);
    } catch (erro) {
      console.error(erro);
      setErroCancelados(erro instanceof Error ? erro.message : "Erro ao cancelar alunos.");
    } finally {
      setProcessandoCancelados(false);
    }
  }

  return {
    modalImportarCancelados, setModalImportarCancelados,
    modoCancelados, setModoCancelados,
    unidadeCancelados, setUnidadeCancelados,
    textoCancelados, setTextoCancelados,
    arquivoCancelados, previaCancelados, setPreviaCancelados,
    resultadoCancelados, processandoCancelados,
    erroCancelados, setErroCancelados,
    abrirImportacaoCancelados, limparImportacaoCancelados,
    selecionarArquivoCancelados, gerarPreviaCancelados, confirmarCancelados,
  };
}
