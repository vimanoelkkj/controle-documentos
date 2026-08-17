import { useFiltrosUrlConferencia } from "./conferencia/hooks/useFiltrosUrlConferencia";
import { useSelecaoAluno } from "./conferencia/hooks/useSelecaoAluno";
import "./HistoricoAluno.css";
import { useAuth } from "../contexts/auth";
import { ModalHistoricoAluno } from "./conferencia/ModalHistoricoAluno";
import { ModalAdicionarAluno } from "./conferencia/ModalAdicionarAluno";
import { ModalTrocaAluno } from "./conferencia/ModalTrocaAluno";
import { ModalNovoAluno } from "./conferencia/ModalNovoAluno";
import { ModalEditarAluno } from "./conferencia/ModalEditarAluno";
import { ModalStatusAluno } from "./conferencia/ModalStatusAluno";
import { ModalExcluirAluno } from "./conferencia/ModalExcluirAluno";
import { ModalImportarCancelados } from "./conferencia/ModalImportarCancelados";
import { ModalImportarAlunos } from "./conferencia/ModalImportarAlunos";
import { ModalSucessoImportacao } from "./conferencia/ModalSucessoImportacao";
import { PainelListaAlunos } from "./conferencia/PainelListaAlunos";
import { DetalhesAluno } from "./conferencia/DetalhesAluno";
import { useHistoricoAluno } from "./conferencia/hooks/useHistoricoAluno";
import { useImportacaoCancelados } from "./conferencia/hooks/useImportacaoCancelados";
import { useImportacaoAlunos } from "./conferencia/hooks/useImportacaoAlunos";
import { useAlunos } from "./conferencia/hooks/useAlunos";
import { useFiltrosConferencia } from "./conferencia/hooks/useFiltrosConferencia";
import { useLayoutConferencia } from "./conferencia/hooks/useLayoutConferencia";
import { useAtalhosConferencia } from "./conferencia/hooks/useAtalhosConferencia";
import { useDocumentosAluno } from "./conferencia/hooks/useDocumentosAluno";
import { useGerenciamentoAluno } from "./conferencia/hooks/useGerenciamentoAluno";
import { useResumoAluno } from "./conferencia/hooks/useResumoAluno";
import { type FiltroStatus, type Unidade } from "./conferencia/model";
import PageLoading from "../components/PageLoading";

import { useEffect, useRef, useState } from "react";
function Conferencia() {
  const {
    alunosSalvos,
    setAlunosSalvos,
    alunosEmEdicao,
    setAlunosEmEdicao,
    raSelecionado,
    setRaSelecionado,
    carregando,
    erro,
    carregarAlunos: carregarAlunosDoServidor,
  } = useAlunos();
  const [busca, setBusca] = useState("");
  const { modoApresentacao } = useAuth();

  const {
    unidadeSelecionada,
    setUnidadeSelecionada,
    filtroStatus,
    setFiltroStatus,
    filtroDocumentalDashboard,
    setFiltroDocumentalDashboard,
    pendenciasDashboard,
    setPendenciasDashboard,
  } = useFiltrosUrlConferencia();

  const [modalAdicionarAluno, setModalAdicionarAluno] = useState(false);

  const fluxoImportacao = useImportacaoAlunos({
    alunosSalvos,
    unidadeInicial: unidadeSelecionada,
    aoSincronizar: setUnidadeSelecionada,
    aoFecharSucesso: async (unidade) => {
      await carregarAlunos(undefined, unidade, filtroStatus);
    },
  });

  const {
    modalImportarAlunos,
    sucessoImportacao,
    abrirImportacao,
    fecharSucessoImportacao,
  } = fluxoImportacao;

  const [modalSaindo, setModalSaindo] = useState<string | null>(null);

  const {
    modalHistoricoAluno,
    setModalHistoricoAluno,
    historicoAluno,
    carregandoHistorico,
    erroHistorico,
    historicoPossivelmenteLimitado,
    carregarHistoricoAluno,
    abrirHistoricoAluno,
  } = useHistoricoAluno();

  const { painelListaRef, detalhesAlunoRef, conferenciaGridRef } =
    useLayoutConferencia({
      carregando,
      raSelecionado,
      unidadeSelecionada,
      filtroStatus,
    });
  const buscaAlunoRef = useRef<HTMLInputElement | null>(null);
  const listaAlunosRef = useRef<HTMLDivElement | null>(null);

  const fluxoCancelados = useImportacaoCancelados({
    unidadeInicial: unidadeSelecionada || "FACE",
    aoConcluir: async (ra, unidade) => {
      setUnidadeSelecionada(unidade);
      setFiltroStatus("CANCELADO");
      await carregarAlunos(ra, unidade, "CANCELADO");
    },
  });

  const {
    modalImportarCancelados,
    setModalImportarCancelados,
    processandoCancelados,
    abrirImportacaoCancelados,
  } = fluxoCancelados;

  async function carregarAlunos(
    raParaSelecionar?: string,
    unidadeFiltro: Unidade | "" = unidadeSelecionada,
    statusFiltro: FiltroStatus = filtroStatus,
  ) {
    await carregarAlunosDoServidor(
      raParaSelecionar,
      unidadeFiltro,
      statusFiltro,
    );
  }

  useEffect(() => {
    void carregarAlunosDoServidor(undefined, "", "ATIVO");
  }, [carregarAlunosDoServidor]);

  const {
    alunoSelecionado,
    alunoSalvo,
    status,
    setStatus,
    salvando,
    erroSalvamento,
    temAlteracoes,
    alternarDocumento,
    restaurarAlteracoes,
    salvarAlteracoes,
  } = useDocumentosAluno({
    alunosSalvos,
    setAlunosSalvos,
    alunosEmEdicao,
    setAlunosEmEdicao,
    raSelecionado,
  });

  const {
    trocaAlunoPendente,
    setTrocaAlunoPendente,
    selecionarAluno,
    descartarAlteracoesETrocarAluno,
  } = useSelecaoAluno({
    setAlunosEmEdicao,
    raSelecionado,
    setRaSelecionado,
    alunoSalvo,
    temAlteracoes,
    setStatus,
  });

  const {
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
  } = useGerenciamentoAluno({
    alunoSelecionado,
    carregarAlunos,
    setFiltroStatus,
    setUnidadeSelecionada,
  });

  useAtalhosConferencia({
    algumModalAberto: Boolean(
      modalAdicionarAluno ||
      modalImportarAlunos ||
      sucessoImportacao ||
      modalNovoAluno ||
      modalEditarAluno ||
      modalExcluirAluno ||
      modalStatusAluno ||
      modalImportarCancelados ||
      trocaAlunoPendente ||
      modalHistoricoAluno,
    ),
    busca,
    raSelecionado,
    buscaAlunoRef,
    listaAlunosRef,
    setBusca,
    podeSalvar: () => temAlteracoes && temAlunoSelecionadoNoFiltro,
    aoSalvar: () => void salvarAlteracoes(),
  });

  const {
    alunosNoStatus,
    quantidadesPorUnidade,
    temFiltroDashboard,
    alunosFiltrados,
    temAlunoSelecionadoNoFiltro,
    descricaoFiltroDashboard,
  } = useFiltrosConferencia({
    alunosSalvos,
    raSelecionado,
    busca,
    filtroStatus,
    unidadeSelecionada,
    filtroDocumentalDashboard,
    pendenciasDashboard,
  });

  const { entregues, pendentes, statusResumo, percentual, iniciais } =
    useResumoAluno(alunoSelecionado);

  if (carregando) {
    return (
      <section className="conference-page conference-page--replica">
        <PageLoading label="Carregando alunos..." />
      </section>
    );
  }

  if (erro) {
    return (
      <section className="conference-page conference-page--replica">
<div className="conference-replica-loading error">{erro}</div>
      </section>
    );
  }

  function limparFiltroDashboard() {
    setFiltroDocumentalDashboard("");
    setPendenciasDashboard([]);
    setRaSelecionado("");
    setStatus("salvo");
    window.history.replaceState(null, "", "/conferencia");
  }

  function fecharModalAnimado(
    nome: string,
    fechar: () => void,
    depois?: () => void,
  ) {
    if (modalSaindo) return;

    setModalSaindo(nome);

    window.setTimeout(() => {
      fechar();
      setModalSaindo(null);
      depois?.();
    }, 180);
  }

  function fecharImportacaoCancelados() {
    if (processandoCancelados) return;

    fecharModalAnimado("importar-cancelados", () =>
      setModalImportarCancelados(false),
    );
  }

  return (
    <section className="conference-page conference-page--replica">
<div ref={conferenciaGridRef} className="conference-grid conference-grid--replica">
        <PainelListaAlunos
          painelListaRef={painelListaRef}
          buscaAlunoRef={buscaAlunoRef}
          listaAlunosRef={listaAlunosRef}
          modoApresentacao={modoApresentacao}
          raSelecionado={raSelecionado}
          busca={busca}
          filtroStatus={filtroStatus}
          unidadeSelecionada={unidadeSelecionada}
          alunosNoStatus={alunosNoStatus}
          alunosFiltrados={alunosFiltrados}
          quantidadesPorUnidade={quantidadesPorUnidade}
          temFiltroDashboard={temFiltroDashboard}
          descricaoFiltroDashboard={descricaoFiltroDashboard}
          carregarAlunos={async (ra) => carregarAlunos(ra)}
          abrirImportacaoCancelados={abrirImportacaoCancelados}
          setModalAdicionarAluno={setModalAdicionarAluno}
          setFiltroStatus={setFiltroStatus}
          setRaSelecionado={setRaSelecionado}
          setStatus={setStatus}
          setUnidadeSelecionada={setUnidadeSelecionada}
          setBusca={setBusca}
          limparFiltroDashboard={limparFiltroDashboard}
          selecionarAluno={selecionarAluno}
        />

        <DetalhesAluno
          detalhesAlunoRef={detalhesAlunoRef}
          temAlunoSelecionadoNoFiltro={temAlunoSelecionadoNoFiltro}
          alunoSelecionado={alunoSelecionado}
          iniciais={iniciais}
          modoApresentacao={modoApresentacao}
          statusResumo={statusResumo}
          percentual={percentual}
          entregues={entregues}
          pendentes={pendentes}
          erroSalvamento={erroSalvamento}
          salvando={salvando}
          temAlteracoes={temAlteracoes}
          status={status}
          unidadeSelecionada={unidadeSelecionada}
          alunosFiltrados={alunosFiltrados}
          abrirHistoricoAluno={abrirHistoricoAluno}
          abrirEdicaoAluno={abrirEdicaoAluno}
          abrirModalStatusAluno={() => setModalStatusAluno(true)}
          alternarDocumento={alternarDocumento}
          restaurarAlteracoes={restaurarAlteracoes}
          salvarAlteracoes={salvarAlteracoes}
        />
      </div>

      <ModalHistoricoAluno
        aberto={modalHistoricoAluno}
        aluno={alunoSelecionado}
        historico={historicoAluno}
        carregando={carregandoHistorico}
        erro={erroHistorico}
        possivelmenteLimitado={historicoPossivelmenteLimitado}
        aoAtualizar={() => void carregarHistoricoAluno(alunoSelecionado.ra)}
        aoFechar={() => setModalHistoricoAluno(false)}
      />

      <ModalTrocaAluno
        aberto={Boolean(trocaAlunoPendente)}
        nomeAluno={alunoSelecionado.nome}
        aoVoltar={() => setTrocaAlunoPendente(null)}
        aoDescartar={descartarAlteracoesETrocarAluno}
      />

      <ModalAdicionarAluno
        aberto={modalAdicionarAluno}
        saindo={modalSaindo === "adicionar-aluno"}
        aoFechar={() =>
          fecharModalAnimado("adicionar-aluno", () =>
            setModalAdicionarAluno(false),
          )
        }
        aoNovoAluno={() =>
          fecharModalAnimado(
            "adicionar-aluno",
            () => setModalAdicionarAluno(false),
            () => {
              setErroCadastro("");
              setModalNovoAluno(true);
            },
          )
        }
        aoImportar={() =>
          fecharModalAnimado(
            "adicionar-aluno",
            () => setModalAdicionarAluno(false),
            abrirImportacao,
          )
        }
      />

      <ModalNovoAluno
        aberto={modalNovoAluno}
        saindo={modalSaindo === "novo-aluno"}
        dados={novoAluno}
        setDados={setNovoAluno}
        erro={erroCadastro}
        cadastrando={cadastrando}
        aoFechar={() =>
          fecharModalAnimado("novo-aluno", () => setModalNovoAluno(false))
        }
        aoCadastrar={() => void cadastrarAluno()}
      />

      <ModalEditarAluno
        aberto={modalEditarAluno}
        saindo={modalSaindo === "editar-aluno"}
        dados={alunoEdicao}
        setDados={setAlunoEdicao}
        erro={erroEdicao}
        editando={editando}
        aoFechar={() =>
          fecharModalAnimado("editar-aluno", () => setModalEditarAluno(false))
        }
        aoSalvar={() => void salvarEdicaoAluno()}
        aoExcluir={() =>
          fecharModalAnimado(
            "editar-aluno",
            () => setModalEditarAluno(false),
            () => setModalExcluirAluno(true),
          )
        }
      />

      <ModalImportarAlunos
        fluxo={fluxoImportacao}
        saindo={modalSaindo === "importar-alunos"}
      />

      <ModalSucessoImportacao
        sucesso={sucessoImportacao}
        aoFechar={() => void fecharSucessoImportacao()}
      />

      <ModalImportarCancelados
        fluxo={fluxoCancelados}
        saindo={modalSaindo === "importar-cancelados"}
        aoFechar={fecharImportacaoCancelados}
      />

      <ModalStatusAluno
        aberto={modalStatusAluno}
        saindo={modalSaindo === "status-aluno"}
        aluno={alunoSelecionado}
        processando={alterandoStatusAluno}
        aoFechar={() =>
          fecharModalAnimado("status-aluno", () => setModalStatusAluno(false))
        }
        aoConfirmar={() => void alterarStatusMatricula()}
      />

      <ModalExcluirAluno
        aberto={modalExcluirAluno}
        saindo={modalSaindo === "excluir-aluno"}
        aluno={alunoSelecionado}
        excluindo={excluindo}
        aoFechar={() =>
          fecharModalAnimado("excluir-aluno", () => setModalExcluirAluno(false))
        }
        aoConfirmar={() => void excluirAluno()}
      />
    </section>
  );
}

export default Conferencia;
