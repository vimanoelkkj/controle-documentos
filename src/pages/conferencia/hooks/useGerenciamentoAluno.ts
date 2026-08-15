import { useState } from "react";
import {
  alterarStatusAluno,
  cadastrarAluno as cadastrarAlunoApi,
  editarAluno,
  excluirAluno as excluirAlunoApi,
  registrarLogAluno,
} from "../operacoes";
import {
  formularioVazio,
  type Aluno,
  type FiltroStatus,
  type FormAluno,
  type Unidade,
} from "../model";

type UseGerenciamentoAlunoParams = {
  alunoSelecionado: Aluno;
  carregarAlunos: (
    raParaSelecionar?: string,
    unidadeFiltro?: Unidade | "",
    statusFiltro?: FiltroStatus,
  ) => Promise<void>;
  setFiltroStatus: (status: FiltroStatus) => void;
  setUnidadeSelecionada: (unidade: Unidade | "") => void;
};

export function useGerenciamentoAluno({
  alunoSelecionado,
  carregarAlunos,
  setFiltroStatus,
  setUnidadeSelecionada,
}: UseGerenciamentoAlunoParams) {
  const [novoAluno, setNovoAluno] = useState<FormAluno>(formularioVazio);
  const [alunoEdicao, setAlunoEdicao] = useState<FormAluno>(formularioVazio);

  const [modalNovoAluno, setModalNovoAluno] = useState(false);
  const [modalEditarAluno, setModalEditarAluno] = useState(false);
  const [modalExcluirAluno, setModalExcluirAluno] = useState(false);
  const [modalStatusAluno, setModalStatusAluno] = useState(false);

  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [alterandoStatusAluno, setAlterandoStatusAluno] = useState(false);

  const [erroCadastro, setErroCadastro] = useState("");
  const [erroEdicao, setErroEdicao] = useState("");

  async function cadastrarAluno() {
    setErroCadastro("");

    if (
      !novoAluno.ra.trim() ||
      !novoAluno.nome.trim() ||
      !novoAluno.curso.trim() ||
      !novoAluno.unidade.trim()
    ) {
      setErroCadastro("Preencha RA, nome, curso e unidade.");
      return;
    }

    try {
      setCadastrando(true);

      await cadastrarAlunoApi(novoAluno);

      const raCadastrado = novoAluno.ra.trim();

      await registrarLogAluno(
        "CADASTRO",
        `${novoAluno.nome.trim()} cadastrado no sistema.`,
        raCadastrado,
        novoAluno.unidade,
      );

      setNovoAluno(formularioVazio);
      setModalNovoAluno(false);

      await carregarAlunos(raCadastrado);
    } catch (erro) {
      setErroCadastro(
        erro instanceof Error ? erro.message : "Erro ao cadastrar aluno.",
      );
    } finally {
      setCadastrando(false);
    }
  }

  function abrirEdicaoAluno() {
    setErroEdicao("");

    setAlunoEdicao({
      ra: alunoSelecionado.ra,
      nome: alunoSelecionado.nome,
      curso: alunoSelecionado.curso,
      unidade: alunoSelecionado.unidade,
      email: alunoSelecionado.email ?? "",
      email_outro: alunoSelecionado.email_outro ?? "",
      documentos: { ...formularioVazio.documentos },
    });

    setModalEditarAluno(true);
  }

  async function salvarEdicaoAluno() {
    setErroEdicao("");

    if (
      !alunoEdicao.ra.trim() ||
      !alunoEdicao.nome.trim() ||
      !alunoEdicao.curso.trim() ||
      !alunoEdicao.unidade.trim()
    ) {
      setErroEdicao("Preencha RA, nome, curso e unidade.");
      return;
    }

    try {
      setEditando(true);

      await editarAluno(alunoSelecionado.ra, alunoEdicao);

      const novoRa = alunoEdicao.ra.trim();

      await registrarLogAluno(
        "EDIÇÃO",
        `Dados cadastrais de ${alunoEdicao.nome.trim()} atualizados.`,
        novoRa,
        alunoEdicao.unidade,
      );

      setModalEditarAluno(false);

      await carregarAlunos(novoRa);
    } catch (erro) {
      setErroEdicao(
        erro instanceof Error ? erro.message : "Erro ao editar aluno.",
      );
    } finally {
      setEditando(false);
    }
  }

  async function alterarStatusMatricula() {
    const novoStatus =
      alunoSelecionado.status === "ATIVO" ? "CANCELADO" : "ATIVO";

    try {
      setAlterandoStatusAluno(true);

      await alterarStatusAluno(alunoSelecionado.ra, novoStatus);

      setModalStatusAluno(false);

      await registrarLogAluno(
        novoStatus === "CANCELADO" ? "CANCELAMENTO" : "REATIVAÇÃO",
        `${alunoSelecionado.nome} teve a matrícula ${
          novoStatus === "CANCELADO" ? "cancelada" : "reativada"
        }.`,
        alunoSelecionado.ra,
        alunoSelecionado.unidade,
      );

      const unidadeDoAluno = alunoSelecionado.unidade as Unidade;

      setFiltroStatus(novoStatus);
      setUnidadeSelecionada(unidadeDoAluno);

      await carregarAlunos(alunoSelecionado.ra, unidadeDoAluno, novoStatus);
    } catch (erro) {
      console.error(erro);

      alert(
        erro instanceof Error
          ? erro.message
          : "Erro ao alterar o status da matrícula.",
      );
    } finally {
      setAlterandoStatusAluno(false);
    }
  }

  async function excluirAluno() {
    try {
      setExcluindo(true);

      await excluirAlunoApi(alunoSelecionado.ra);

      setModalExcluirAluno(false);

      await registrarLogAluno(
        "EXCLUSÃO",
        `${alunoSelecionado.nome} excluído do sistema.`,
        alunoSelecionado.ra,
        alunoSelecionado.unidade,
      );

      await carregarAlunos();
    } catch (erro) {
      alert(erro instanceof Error ? erro.message : "Erro ao excluir aluno.");
    } finally {
      setExcluindo(false);
    }
  }

  return {
    novoAluno,
    setNovoAluno,
    alunoEdicao,
    setAlunoEdicao,

    modalNovoAluno,
    setModalNovoAluno,
    modalEditarAluno,
    setModalEditarAluno,
    modalExcluirAluno,
    setModalExcluirAluno,
    modalStatusAluno,
    setModalStatusAluno,

    cadastrando,
    editando,
    excluindo,
    alterandoStatusAluno,

    erroCadastro,
    setErroCadastro,
    erroEdicao,

    cadastrarAluno,
    abrirEdicaoAluno,
    salvarEdicaoAluno,
    alterarStatusMatricula,
    excluirAluno,
  };
}
