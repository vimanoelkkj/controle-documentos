import { useState, type ChangeEvent } from "react";
import { analisarTextoImportacao } from "../importacao";
import { registrarLogAluno } from "../operacoes";
import type {
  Aluno,
  AlunoImportacao,
  LinhaPreviaImportacao,
  ResultadoImportacao,
  Unidade,
} from "../model";

type Opcoes = {
  alunosSalvos: Aluno[];
  unidadeInicial: Unidade;
  aoSincronizar: (unidade: Unidade) => void;
  aoFecharSucesso: (unidade: Unidade) => Promise<void>;
};

export function useImportacaoAlunos({
  alunosSalvos,
  unidadeInicial,
  aoSincronizar,
  aoFecharSucesso,
}: Opcoes) {
  const [modalImportarAlunos, setModalImportarAlunos] = useState(false);
  const [modoImportacao, setModoImportacao] = useState<"colar" | "csv">(
    "colar",
  );
  const [unidadeImportacao, setUnidadeImportacao] =
    useState<Unidade>("FCH");
  const [textoImportacao, setTextoImportacao] = useState("");
  const [arquivoImportacao, setArquivoImportacao] = useState("");
  const [previaImportacao, setPreviaImportacao] = useState<
    LinhaPreviaImportacao[]
  >([]);
  const [importando, setImportando] = useState(false);
  const [finalizandoImportacao, setFinalizandoImportacao] = useState(false);
  const [erroImportacao, setErroImportacao] = useState("");
  const [resultadoImportacao, setResultadoImportacao] =
    useState<ResultadoImportacao | null>(null);
  const [sucessoImportacao, setSucessoImportacao] = useState<{
    resultado: ResultadoImportacao;
    unidade: Unidade;
  } | null>(null);

  function abrirImportacao() {
    setModoImportacao("colar");
    setUnidadeImportacao(unidadeInicial);
    setTextoImportacao("");
    setArquivoImportacao("");
    setPreviaImportacao([]);
    setErroImportacao("");
    setResultadoImportacao(null);
    setFinalizandoImportacao(false);
    setModalImportarAlunos(true);
  }

  function fecharImportacao() {
    if (importando || finalizandoImportacao) return;
    setModalImportarAlunos(false);
  }

  function limparImportacao() {
    setTextoImportacao("");
    setArquivoImportacao("");
    setPreviaImportacao([]);
    setErroImportacao("");
    setResultadoImportacao(null);
  }

  async function selecionarArquivoImportacao(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    setErroImportacao("");
    setResultadoImportacao(null);
    setPreviaImportacao([]);
    setArquivoImportacao(arquivo.name);

    try {
      const bytes = await arquivo.arrayBuffer();
      let conteudo: string;

      try {
        conteudo = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        conteudo = new TextDecoder("windows-1252").decode(bytes);
      }

      setTextoImportacao(conteudo);
    } catch (erro) {
      console.error(erro);
      setErroImportacao("Não foi possível ler o arquivo CSV.");
    }
  }

  function gerarPreviaImportacao() {
    setErroImportacao("");
    setResultadoImportacao(null);

    if (!textoImportacao.trim()) {
      setErroImportacao(
        modoImportacao === "csv"
          ? "Selecione um arquivo CSV."
          : "Cole os dados da planilha.",
      );
      return;
    }

    try {
      const previa = analisarTextoImportacao(
        textoImportacao,
        alunosSalvos,
        unidadeImportacao,
      );
      if (previa.length === 0) throw new Error("Nenhum aluno foi encontrado.");
      setPreviaImportacao(previa);
    } catch (erro) {
      setPreviaImportacao([]);
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível analisar os dados.",
      );
    }
  }

  async function confirmarImportacao() {
    setErroImportacao("");
    if (previaImportacao.length === 0) {
      setErroImportacao("Gere a prévia antes de confirmar.");
      return;
    }

    const alunos: AlunoImportacao[] = previaImportacao
      .filter((aluno) => aluno.status === "valido" || aluno.status === "alterado")
      .map((aluno) => ({
        ra: aluno.ra,
        nome: aluno.nome,
        curso: aluno.curso,
        ...(aluno.email ? { email: aluno.email } : {}),
        ...(aluno.email_outro ? { email_outro: aluno.email_outro } : {}),
        ...(aluno.contrato !== undefined ? { contrato: aluno.contrato } : {}),
      }));

    if (alunos.length === 0) {
      setErroImportacao("Não há alunos novos ou alterados para sincronizar.");
      return;
    }

    const inicioAnimacao = performance.now();
    try {
      setImportando(true);
      setFinalizandoImportacao(false);
      const resposta = await fetch("/api/alunos/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidade: unidadeImportacao, alunos }),
      });
      const dados = (await resposta.json()) as ResultadoImportacao;
      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível sincronizar os alunos.");
      }

      setResultadoImportacao(dados);
      await registrarLogAluno(
        "IMPORTAÇÃO",
        `${alunos.length} aluno(s) sincronizado(s) pela importação.`,
        undefined,
        unidadeImportacao,
      );
      aoSincronizar(unidadeImportacao);

      const tempoDecorrido = performance.now() - inicioAnimacao;
      const tempoMinimoLoading = 650;
      if (tempoDecorrido < tempoMinimoLoading) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, tempoMinimoLoading - tempoDecorrido),
        );
      }

      setImportando(false);
      setFinalizandoImportacao(true);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      setModalImportarAlunos(false);
      setFinalizandoImportacao(false);
      setSucessoImportacao({ resultado: dados, unidade: unidadeImportacao });
    } catch (erro) {
      console.error(erro);
      setFinalizandoImportacao(false);
      setErroImportacao(
        erro instanceof Error ? erro.message : "Erro ao sincronizar alunos.",
      );
    } finally {
      setImportando(false);
    }
  }

  async function fecharSucessoImportacao() {
    const unidade = sucessoImportacao?.unidade;
    setSucessoImportacao(null);
    if (unidade) await aoFecharSucesso(unidade);
  }

  return {
    modalImportarAlunos,
    modoImportacao,
    setModoImportacao,
    unidadeImportacao,
    setUnidadeImportacao,
    textoImportacao,
    setTextoImportacao,
    arquivoImportacao,
    previaImportacao,
    setPreviaImportacao,
    importando,
    finalizandoImportacao,
    erroImportacao,
    setErroImportacao,
    resultadoImportacao,
    sucessoImportacao,
    abrirImportacao,
    fecharImportacao,
    limparImportacao,
    selecionarArquivoImportacao,
    gerarPreviaImportacao,
    confirmarImportacao,
    fecharSucessoImportacao,
  };
}
