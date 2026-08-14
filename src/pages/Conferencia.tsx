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
import { useHistoricoAluno } from "./conferencia/hooks/useHistoricoAluno";
import { useImportacaoCancelados } from "./conferencia/hooks/useImportacaoCancelados";
import { useImportacaoAlunos } from "./conferencia/hooks/useImportacaoAlunos";
import { registrarLogAluno } from "./conferencia/operacoes";
import {
  DOCUMENTO_DASHBOARD_POR_CAMPO,
  clonarAlunos,
  converterAlunosApi,
  formularioVazio,
  normalizarBusca,
  statusDocumentalAluno,
  type Aluno,
  type AlunoApi,
  type FiltroStatus,
  type FormAluno,
  type Unidade,
} from "./conferencia/model";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

function Conferencia() {
  const [alunosSalvos, setAlunosSalvos] = useState<Aluno[]>([]);
  const [alunosEmEdicao, setAlunosEmEdicao] = useState<Aluno[]>([]);
  const [raSelecionado, setRaSelecionado] = useState("");
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
  const [status, setStatus] = useState<"salvo" | "pendente">("salvo");
  const [salvando, setSalvando] = useState(false);
  const [erroSalvamento, setErroSalvamento] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

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

  const [modalNovoAluno, setModalNovoAluno] = useState(false);
  const [modalEditarAluno, setModalEditarAluno] = useState(false);
  const [modalExcluirAluno, setModalExcluirAluno] = useState(false);
  const [modalStatusAluno, setModalStatusAluno] = useState(false);
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

  const [novoAluno, setNovoAluno] = useState<FormAluno>(formularioVazio);
  const [alunoEdicao, setAlunoEdicao] = useState<FormAluno>(formularioVazio);

  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [alterandoStatusAluno, setAlterandoStatusAluno] = useState(false);

  const [erroCadastro, setErroCadastro] = useState("");
  const [erroEdicao, setErroEdicao] = useState("");

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

  const painelListaRef = useRef<HTMLElement | null>(null);
  const detalhesAlunoRef = useRef<HTMLElement | null>(null);
  const conferenciaGridRef = useRef<HTMLDivElement | null>(null);
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

  useLayoutEffect(() => {
    const grid = conferenciaGridRef.current;
    const painel = painelListaRef.current;
    const detalhes = detalhesAlunoRef.current;

    if (!grid || !painel || !detalhes) return;

    const ajustarAltura = () => {
      if (window.matchMedia("(max-width: 1100px)").matches) {
        painel.style.removeProperty("height");
        detalhes.style.removeProperty("height");
        return;
      }

      // Mantém uma pequena margem visual até o fim da viewport.
      const margemInferior = 20;
      const topo = Math.ceil(grid.getBoundingClientRect().top);
      const alturaDisponivel = Math.max(
        460,
        window.innerHeight - topo - margemInferior,
      );

      painel.style.height = `${alturaDisponivel}px`;
      detalhes.style.height = `${alturaDisponivel}px`;
    };

    ajustarAltura();

    window.addEventListener("resize", ajustarAltura);

    // Se algo acima do grid mudar de tamanho, recalcula sem depender
    // apenas do resize da janela.
    const observer = new ResizeObserver(ajustarAltura);
    observer.observe(grid.parentElement ?? grid);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", ajustarAltura);
      painel.style.removeProperty("height");
      detalhes.style.removeProperty("height");
    };
  }, [carregando, raSelecionado, unidadeSelecionada, filtroStatus]);

  async function carregarAlunos(
    raParaSelecionar?: string,
    unidadeFiltro: Unidade | "" = unidadeSelecionada,
    statusFiltro: FiltroStatus = filtroStatus,
  ) {
    try {
      setCarregando(true);
      setErro("");

      const resposta = await fetch("/api/alunos");

      if (!resposta.ok) {
        throw new Error("Falha ao carregar alunos.");
      }

      const dados: AlunoApi[] = await resposta.json();
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
  }

  useEffect(() => {
    carregarAlunos();
  }, []);

  useEffect(() => {
    function atalhosConferencia(event: KeyboardEvent) {
      const algumModalAberto = Boolean(
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
      );

      if (algumModalAberto) return;

      const tecla = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && tecla === "f") {
        event.preventDefault();
        buscaAlunoRef.current?.focus();
        buscaAlunoRef.current?.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && tecla === "s") {
        event.preventDefault();

        if (temAlteracoes && temAlunoSelecionadoNoFiltro) {
          void salvarAlteracoes();
        }

        return;
      }

      if (event.key === "Escape" && busca) {
        event.preventDefault();
        setBusca("");
        buscaAlunoRef.current?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const alvo = event.target as HTMLElement | null;
      const estaDigitando =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        alvo?.isContentEditable;

      // Na busca, as setas também percorrem os resultados. Nos demais campos,
      // preserva o comportamento normal de edição.
      if (estaDigitando && alvo !== buscaAlunoRef.current) return;

      const botoes = Array.from(
        listaAlunosRef.current?.querySelectorAll<HTMLButtonElement>(
          ".student-card",
        ) ?? [],
      );

      if (botoes.length === 0) return;

      event.preventDefault();

      const indiceAtual = botoes.findIndex(
        (botao) => botao === document.activeElement,
      );
      const indiceSelecionado = botoes.findIndex(
        (botao) => botao.dataset.ra === raSelecionado,
      );
      const base = indiceAtual >= 0 ? indiceAtual : indiceSelecionado;

      let proximoIndice: number;

      if (event.key === "ArrowDown") {
        proximoIndice = base < 0 ? 0 : Math.min(base + 1, botoes.length - 1);
      } else {
        proximoIndice = base < 0 ? botoes.length - 1 : Math.max(base - 1, 0);
      }

      botoes[proximoIndice]?.focus();
      botoes[proximoIndice]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }

    window.addEventListener("keydown", atalhosConferencia);

    return () => window.removeEventListener("keydown", atalhosConferencia);
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

  const alunoVazio: Aluno = {
    ra: "",
    nome: "",
    unidade: "",
    curso: "",
    email: null,
    email_outro: null,
    status: "ATIVO",
    documentos: [
      { nome: "ID", entregue: false },
      { nome: "CPF", entregue: false },
      { nome: "CERTIDÃO", entregue: false },
      { nome: "RESIDÊNCIA", entregue: false },
      { nome: "TÍTULO", entregue: false },
      { nome: "ENSINO MÉDIO", entregue: false },
      { nome: "CONTRATO", entregue: false },
    ],
  };

  const alunoSelecionado =
    alunosEmEdicao.find((aluno) => aluno.ra === raSelecionado) ??
    alunosEmEdicao[0] ??
    alunoVazio;

  const alunoSalvo =
    alunosSalvos.find((aluno) => aluno.ra === raSelecionado) ??
    alunosSalvos[0] ??
    alunoVazio;

  const termo = normalizarBusca(busca);

  const correspondeFiltroStatus = (aluno: Aluno) =>
    filtroStatus === "TODOS" || aluno.status === filtroStatus;

  const alunosNoStatus = alunosEmEdicao.filter(correspondeFiltroStatus);

  const quantidadesPorUnidade = {
    FACE: alunosNoStatus.filter((aluno) => aluno.unidade === "FACE").length,
    FEA: alunosNoStatus.filter((aluno) => aluno.unidade === "FEA").length,
    FCH: alunosNoStatus.filter((aluno) => aluno.unidade === "FCH").length,
    EAD: alunosNoStatus.filter((aluno) => aluno.unidade === "EAD").length,
  };

  const temFiltroDashboard = Boolean(
    filtroDocumentalDashboard || pendenciasDashboard.length > 0,
  );

  const alunoCorrespondeFiltroDashboard = (aluno: Aluno) => {
    if (
      filtroDocumentalDashboard &&
      statusDocumentalAluno(aluno) !== filtroDocumentalDashboard
    ) {
      return false;
    }

    if (pendenciasDashboard.length > 0) {
      const pendenciasSelecionadas = new Set(
        pendenciasDashboard.map(
          (campo) => DOCUMENTO_DASHBOARD_POR_CAMPO[campo],
        ),
      );

      const pendenciasDoAluno = aluno.documentos
        .filter((documento) => !documento.entregue)
        .map((documento) => documento.nome);

      const correspondeExatamente =
        pendenciasDoAluno.length === pendenciasSelecionadas.size &&
        pendenciasDoAluno.every((nome) => pendenciasSelecionadas.has(nome));

      if (!correspondeExatamente) return false;
    }

    return true;
  };

  const alunosFiltrados = alunosSalvos
    .filter((aluno) => {
      const pertenceUnidade = unidadeSelecionada
        ? aluno.unidade === unidadeSelecionada
        : true;
      const pertenceStatus = correspondeFiltroStatus(aluno);
      const pertenceDashboard = alunoCorrespondeFiltroDashboard(aluno);

      const textoBuscaAluno = normalizarBusca(
        [aluno.nome, aluno.ra, aluno.curso, aluno.email, aluno.email_outro]
          .filter(Boolean)
          .join(" "),
      );

      const correspondeBusca = !termo || textoBuscaAluno.includes(termo);

      return (
        pertenceUnidade &&
        pertenceStatus &&
        pertenceDashboard &&
        correspondeBusca
      );
    })
    .sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", {
        sensitivity: "base",
      }),
    );

  const temAlunoSelecionadoNoFiltro = alunosSalvos.some(
    (aluno) =>
      aluno.ra === raSelecionado &&
      (unidadeSelecionada ? aluno.unidade === unidadeSelecionada : true) &&
      correspondeFiltroStatus(aluno) &&
      alunoCorrespondeFiltroDashboard(aluno),
  );

  const descricaoFiltroDashboard = filtroDocumentalDashboard
    ? filtroDocumentalDashboard === "COMPLETO"
      ? "Documentação completa"
      : filtroDocumentalDashboard === "PARCIAL"
        ? "Parcialmente completa"
        : "Documentação crítica"
    : pendenciasDashboard.length > 0
      ? `${pendenciasDashboard
          .map((campo) => DOCUMENTO_DASHBOARD_POR_CAMPO[campo])
          .join(" + ")} pendente(s)`
      : "";

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

  const temAlteracoes = alunoSelecionado.documentos.some(
    (documento, index) =>
      documento.entregue !== alunoSalvo.documentos[index].entregue,
  );

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

  function alternarDocumento(nomeDocumento: string) {
    setAlunosEmEdicao((estadoAtual) =>
      estadoAtual.map((aluno) => {
        if (aluno.ra !== raSelecionado) {
          return aluno;
        }

        return {
          ...aluno,
          documentos: aluno.documentos.map((documento) =>
            documento.nome === nomeDocumento
              ? {
                  ...documento,
                  entregue: !documento.entregue,
                }
              : documento,
          ),
        };
      }),
    );

    setStatus("pendente");
    setErroSalvamento("");
  }

  function restaurarAlteracoes() {
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

    setStatus("salvo");
    setErroSalvamento("");
  }

  async function salvarAlteracoes() {
    if (salvando || !temAlteracoes) return;

    setSalvando(true);
    setErroSalvamento("");

    try {
      const mapaDocumentos = Object.fromEntries(
        alunoSelecionado.documentos.map((documento) => [
          documento.nome,
          documento.entregue,
        ]),
      );

      const resposta = await fetch(
        `/api/alunos/${alunoSelecionado.ra}/documentos`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identidade: mapaDocumentos["ID"],
            cpf: mapaDocumentos["CPF"],
            certidao: mapaDocumentos["CERTIDÃO"],
            residencia: mapaDocumentos["RESIDÊNCIA"],
            titulo: mapaDocumentos["TÍTULO"],
            ensino_medio: mapaDocumentos["ENSINO MÉDIO"],
            contrato: mapaDocumentos["CONTRATO"],
          }),
        },
      );

      if (!resposta.ok) {
        throw new Error("Falha ao salvar alterações.");
      }

      setAlunosSalvos((estadoAtual) =>
        estadoAtual.map((aluno) =>
          aluno.ra === raSelecionado
            ? {
                ...alunoSelecionado,
                documentos: alunoSelecionado.documentos.map((documento) => ({
                  ...documento,
                })),
              }
            : aluno,
        ),
      );

      setStatus("salvo");

      const alteracoesDocumentais = alunoSelecionado.documentos
        .map((documento, index) => {
          const anterior = alunoSalvo.documentos[index];

          if (!anterior || anterior.entregue === documento.entregue) {
            return null;
          }

          return `${documento.nome} → ${
            documento.entregue ? "entregue" : "pendente"
          }`;
        })
        .filter(Boolean)
        .join("; ");

      await registrarLogAluno(
        "DOCUMENTOS",
        alteracoesDocumentais
          ? `Documentos atualizados: ${alteracoesDocumentais}.`
          : `Documentação de ${alunoSelecionado.nome} atualizada.`,
        alunoSelecionado.ra,
        alunoSelecionado.unidade,
      );
    } catch (erro) {
      console.error(erro);
      setErroSalvamento(
        "Não foi possível salvar. Suas alterações continuam nesta tela.",
      );
    } finally {
      setSalvando(false);
    }
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

      const resposta = await fetch("/api/alunos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(novoAluno),
      });

      const dados = (await resposta.json()) as {
        erro?: string;
        sucesso?: boolean;
        ra?: string;
        id?: number;
      };

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível cadastrar o aluno.");
      }

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

      const resposta = await fetch(
        `/api/alunos/${encodeURIComponent(alunoSelecionado.ra)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(alunoEdicao),
        },
      );

      const dados = (await resposta.json()) as {
        erro?: string;
        sucesso?: boolean;
        ra?: string;
      };

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível editar o aluno.");
      }

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

      const resposta = await fetch(
        `/api/alunos/${encodeURIComponent(alunoSelecionado.ra)}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: novoStatus,
          }),
        },
      );

      const dados = (await resposta.json()) as {
        erro?: string;
        sucesso?: boolean;
        status?: "ATIVO" | "CANCELADO";
      };

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível alterar o status da matrícula.",
        );
      }

      setModalStatusAluno(false);

      await registrarLogAluno(
        novoStatus === "CANCELADO" ? "CANCELAMENTO" : "REATIVAÇÃO",
        `${alunoSelecionado.nome} teve a matrícula ${novoStatus === "CANCELADO" ? "cancelada" : "reativada"}.`,
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

      const resposta = await fetch(
        `/api/alunos/${encodeURIComponent(alunoSelecionado.ra)}`,
        {
          method: "DELETE",
        },
      );

      const dados = (await resposta.json()) as {
        erro?: string;
        sucesso?: boolean;
      };

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível excluir o aluno.");
      }

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
        <aside ref={painelListaRef} className="student-panel">
          <div className="student-panel-header">
            <div>
              <span>ALUNOS POR UNIDADE</span>
              <div className="student-panel-title-row">
                <h2>Lista de conferência</h2>
                <button
                  type="button"
                  className="botao-atualizar-alunos"
                  onClick={() => carregarAlunos(raSelecionado)}
                >
                  ↻ Atualizar
                </button>
              </div>
            </div>

            {!modoApresentacao && (
              <div className="student-panel-actions">
                <button
                  type="button"
                  className="botao-importar-cancelados"
                  onClick={abrirImportacaoCancelados}
                  title="Importar lista de cancelados"
                >
                  ⊘ Cancelados
                </button>

                <button
                  type="button"
                  className="botao-novo-aluno"
                  onClick={() => setModalAdicionarAluno(true)}
                >
                  + Adicionar alunos
                </button>
              </div>
            )}
          </div>

          <div className="status-tabs">
            {(["ATIVO", "CANCELADO", "TODOS"] as FiltroStatus[]).map(
              (filtro) => (
                <button
                  key={filtro}
                  type="button"
                  className={filtroStatus === filtro ? "active" : ""}
                  onClick={() => {
                    setFiltroStatus(filtro);
                    setRaSelecionado("");
                    setStatus("salvo");
                  }}
                >
                  {filtro === "ATIVO"
                    ? "Ativos"
                    : filtro === "CANCELADO"
                      ? "Cancelados"
                      : "Todos"}
                </button>
              ),
            )}
          </div>

          <div className="unit-tabs">
            <button
              type="button"
              className={`unit-tab-all ${unidadeSelecionada === "" ? "active" : ""}`}
              onClick={() => {
                setUnidadeSelecionada("");
                setBusca("");
                setRaSelecionado("");
                setStatus("salvo");
              }}
            >
              Todas as Unidades
              <strong>{alunosNoStatus.length}</strong>
            </button>

            {(["EAD", "FACE", "FCH", "FEA"] as Unidade[]).map((unidade) => (
              <button
                key={unidade}
                type="button"
                className={unidadeSelecionada === unidade ? "active" : ""}
                onClick={() => {
                  setUnidadeSelecionada(unidade);
                  setBusca("");
                  setRaSelecionado("");
                  setStatus("salvo");
                }}
              >
                {unidade}
                <strong>{quantidadesPorUnidade[unidade]}</strong>
              </button>
            ))}
          </div>

          {temFiltroDashboard && (
            <div className="dashboard-context-filter">
              <div>
                <span>DASHBOARD</span>
                <strong>{descricaoFiltroDashboard}</strong>
                <small>
                  {unidadeSelecionada || "Todas as unidades"} ·{" "}
                  {alunosFiltrados.length} aluno(s)
                </small>
              </div>
              <button type="button" onClick={limparFiltroDashboard}>
                × Limpar
              </button>
            </div>
          )}

          <input
            ref={buscaAlunoRef}
            className="student-search"
            type="search"
            placeholder="Pesquisar nome, RA, curso ou e-mail..."
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />

          {busca.trim() && (
            <div className="student-search-result">
              <strong>{alunosFiltrados.length}</strong>
              <span>
                {alunosFiltrados.length === 1
                  ? "aluno encontrado"
                  : "alunos encontrados"}
              </span>
              <button type="button" onClick={() => setBusca("")}>
                × Limpar busca
              </button>
            </div>
          )}

          <div ref={listaAlunosRef} className="student-list">
            {alunosFiltrados.map((aluno) => {
              const entreguesAluno = aluno.documentos.filter(
                (documento) => documento.entregue,
              ).length;

              return (
                <button
                  key={aluno.ra}
                  type="button"
                  data-ra={aluno.ra}
                  className={`student-card ${
                    aluno.ra === raSelecionado ? "active" : ""
                  } ${aluno.status === "CANCELADO" ? "cancelled" : ""}`}
                  onClick={() => selecionarAluno(aluno.ra)}
                >
                  <div className="student-card-main">
                    <strong>{aluno.nome}</strong>

                    <span>
                      RA {aluno.ra} · {aluno.curso}
                    </span>
                  </div>

                  <div className="student-card-footer">
                    <span>{aluno.unidade}</span>

                    {aluno.status === "CANCELADO" && (
                      <span className="student-status-cancelled">
                        CANCELADO
                      </span>
                    )}

                    <strong>
                      {entreguesAluno}/{aluno.documentos.length}
                    </strong>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {temAlunoSelecionadoNoFiltro ? (
          <article
            ref={detalhesAlunoRef}
            key={alunoSelecionado.ra}
            className="student-details student-details-animated"
          >
            <header className="student-details-header">
              <div className="student-avatar">{iniciais}</div>

              <div className="student-identity">
                <h2>{alunoSelecionado.nome}</h2>

                <div className="student-tags">
                  <span>RA {alunoSelecionado.ra}</span>
                  <span>{alunoSelecionado.unidade}</span>
                  <span>{alunoSelecionado.curso}</span>
                  <span
                    className={
                      alunoSelecionado.status === "CANCELADO"
                        ? "student-tag-cancelled"
                        : "student-tag-active"
                    }
                  >
                    {alunoSelecionado.status}
                  </span>
                </div>
              </div>

              <div className="student-header-actions">
                <button
                  type="button"
                  className="student-history-button"
                  onClick={() => abrirHistoricoAluno(alunoSelecionado.ra)}
                >
                  Histórico
                </button>

                {!modoApresentacao && (
                  <>
                    <button
                      type="button"
                      className="student-edit-button"
                      onClick={abrirEdicaoAluno}
                    >
                      Editar aluno
                    </button>

                    <button
                      type="button"
                      className={
                        alunoSelecionado.status === "ATIVO"
                          ? "student-delete-button"
                          : "student-edit-button"
                      }
                      onClick={() => setModalStatusAluno(true)}
                    >
                      {alunoSelecionado.status === "ATIVO"
                        ? "Cancelar matrícula"
                        : "Reativar matrícula"}
                    </button>
                  </>
                )}
              </div>

              <div className="student-progress">
                <strong
                  className={`student-progress-percent student-progress-percent--${statusResumo.toLowerCase()}`}
                >
                  {percentual}%
                </strong>

                <span
                  className={`student-progress-status student-progress-status--${statusResumo.toLowerCase()}`}
                >
                  {statusResumo === "COMPLETO"
                    ? "COMPLETO"
                    : statusResumo === "PARCIAL"
                      ? "PARCIAL"
                      : "CRÍTICO"}
                </span>
              </div>
            </header>

            <div className="document-progress">
              <div className="document-progress-label">
                <span>Progresso documental</span>

                <span>
                  {entregues.length}/{alunoSelecionado.documentos.length}{" "}
                  documentos
                </span>
              </div>

              <div className="progress-track">
                <div
                  className="progress-value"
                  style={{ width: `${percentual}%` }}
                />
              </div>
            </div>

            <div className="documents-area">
              <div>
                <h3>Documentos</h3>

                <div className="documents-grid">
                  {alunoSelecionado.documentos.map((documento) => (
                    <label
                      key={documento.nome}
                      className={`document-card ${
                        documento.entregue ? "delivered" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={documento.entregue}
                        disabled={modoApresentacao}
                        onChange={() => alternarDocumento(documento.nome)}
                      />

                      <div>
                        <strong>{documento.nome}</strong>

                        <span>
                          {documento.entregue
                            ? "Documento entregue"
                            : "Documento pendente"}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <aside
                className={`summary-card summary-card--${statusResumo.toLowerCase()}`}
              >
                <span>RESUMO</span>

                {statusResumo === "COMPLETO" ? (
                  <div className="summary-complete">
                    <strong className="summary-check">✓</strong>
                    <span>Documentação Entregue</span>
                  </div>
                ) : (
                  <>
                    <div className="summary-number">
                      <strong>{pendentes.length}</strong>
                      <span>
                        {statusResumo === "PARCIAL"
                          ? "Pendências restantes"
                          : "Pendências críticas"}
                      </span>
                    </div>

                    <ul>
                      {pendentes.map((documento) => (
                        <li key={documento.nome}>{documento.nome}</li>
                      ))}
                    </ul>
                  </>
                )}
              </aside>
            </div>

            {!modoApresentacao && (
              <footer
                className={`conference-actions ${
                  erroSalvamento ? "conference-actions-error" : ""
                }`}
                style={
                  erroSalvamento
                    ? {
                        background: "rgba(220, 53, 69, 0.10)",
                        borderTopColor: "rgba(220, 53, 69, 0.45)",
                        boxShadow: "inset 4px 0 0 #dc3545",
                      }
                    : undefined
                }
              >
                <span
                  className={
                    erroSalvamento
                      ? "save-feedback error"
                      : salvando
                        ? "save-feedback saving"
                        : temAlteracoes
                          ? "pending"
                          : "saved"
                  }
                  role="status"
                  aria-live="polite"
                >
                  {erroSalvamento
                    ? `✕ ${erroSalvamento}`
                    : salvando
                      ? "↻ Salvando alterações..."
                      : temAlteracoes
                        ? "● Alterações pendentes"
                        : status === "salvo"
                          ? "✓ Alterações salvas"
                          : "Nenhuma alteração"}
                </span>

                <div>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!temAlteracoes || salvando}
                    onClick={restaurarAlteracoes}
                  >
                    Restaurar
                  </button>

                  <button
                    type="button"
                    className="primary-action"
                    disabled={!temAlteracoes || salvando}
                    onClick={salvarAlteracoes}
                  >
                    {salvando ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </footer>
            )}
          </article>
        ) : (
          <article
            ref={detalhesAlunoRef}
            className="student-details student-details-empty"
          >
            <div>
              <span className="empty-state-icon">
                <AppIcon name="info" size={24} />
              </span>
              <h2>Selecione um aluno</h2>
              <p>
                {!unidadeSelecionada
                  ? "Para começar, selecione uma unidade e em seguida selecione um aluno. Ele aparecerá aqui."
                  : alunosFiltrados.length > 0
                    ? "Agora selecione um aluno da lista para visualizar e conferir os documentos."
                    : "Não há alunos nesta unidade para o filtro selecionado."}
              </p>
            </div>
          </article>
        )}
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
