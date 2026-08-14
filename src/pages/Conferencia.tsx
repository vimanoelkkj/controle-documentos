import AppIcon from "../components/AppIcon";
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
import {
  statusDocumentalAluno,
  type FiltroStatus,
  type Unidade,
} from "./conferencia/model";

import {
  useEffect,
  useRef,
  useState,
} from "react";
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

  const [unidadeSelecionada, setUnidadeSelecionada] = useState<Unidade | "">(
    () => {
      const valor = new URLSearchParams(window.location.search).get("unidade");
      return ["FACE", "FEA", "FCH", "EAD"].includes(valor || "")
        ? (valor as Unidade)
        : "";
    },
  );

  const [modalAdicionarAluno, setModalAdicionarAluno] = useState(false);
  const fluxoImportacao = useImportacaoAlunos({
    alunosSalvos,
    unidadeInicial: unidadeSelecionada || "FCH",
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
  const [trocaAlunoPendente, setTrocaAlunoPendente] = useState<string | null>(
    null,
  );
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

  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>(() => {
    const valor = new URLSearchParams(window.location.search).get("status");
    return valor === "CANCELADO" || valor === "TODOS" ? valor : "ATIVO";
  });

  const [filtroDocumentalDashboard, setFiltroDocumentalDashboard] = useState<
    "COMPLETO" | "PARCIAL" | "CRITICO" | ""
  >(() => {
    const valor = new URLSearchParams(window.location.search).get("docStatus");
    return valor === "COMPLETO" || valor === "PARCIAL" || valor === "CRITICO"
      ? valor
      : "";
  });

  const [pendenciasDashboard, setPendenciasDashboard] = useState<string[]>(
    () => {
      const valor = new URLSearchParams(window.location.search).get(
        "pendencia",
      );

      const validos = new Set([
        "identidade",
        "cpf",
        "certidao",
        "residencia",
        "titulo",
        "ensino_medio",
        "contrato",
      ]);

      return (valor || "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => validos.has(item));
    },
  );

  const {
    painelListaRef,
    detalhesAlunoRef,
    conferenciaGridRef,
  } = useLayoutConferencia({
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
        modalHistoricoAluno
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
    alunosEmEdicao,
    raSelecionado,
    busca,
    filtroStatus,
    unidadeSelecionada,
    filtroDocumentalDashboard,
    pendenciasDashboard,
  });
  
  if (carregando) {
    return (
      <section className="conference-page">
        <div className="page-loading-state">Carregando alunos...</div>
      </section>
    );
  }

  if (erro) {
    return (
      <section className="conference-page">
        <div className="page-loading-state error">{erro}</div>
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

  const entregues = alunoSelecionado.documentos.filter(
    (documento) => documento.entregue,
  );

  const pendentes = alunoSelecionado.documentos.filter(
    (documento) => !documento.entregue,
  );

  const statusResumo = statusDocumentalAluno(alunoSelecionado);

  const percentual = Math.round(
    (entregues.length / alunoSelecionado.documentos.length) * 100,
  );

  const iniciais = alunoSelecionado.nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("");

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
  return (
    <section className="conference-page">
      <header className="page-header">
        <span>FLUXO DE TRABALHO</span>
        <div className="page-title-row">
          <span className="page-title-icon">
            <AppIcon name="check" size={22} />
          </span>
          <h1>Conferência de documentos</h1>
        </div>
        <p>Confira e atualize a documentação dos alunos.</p>
      </header>

      <div ref={conferenciaGridRef} className="conference-grid">
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
