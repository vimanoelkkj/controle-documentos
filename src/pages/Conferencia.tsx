import AppIcon from "../components/AppIcon";
import "./HistoricoAluno.css";
import AppSelect from "../components/AppSelect";
import { useAuth } from "../contexts/auth";
import { ModalHistoricoAluno } from "./conferencia/ModalHistoricoAluno";
import { ModalAdicionarAluno } from "./conferencia/ModalAdicionarAluno";
import { ModalTrocaAluno } from "./conferencia/ModalTrocaAluno";
import { ModalNovoAluno } from "./conferencia/ModalNovoAluno";
import { ModalEditarAluno } from "./conferencia/ModalEditarAluno";
import { ModalStatusAluno } from "./conferencia/ModalStatusAluno";
import { ModalExcluirAluno } from "./conferencia/ModalExcluirAluno";
import { useHistoricoAluno } from "./conferencia/hooks/useHistoricoAluno";
import {
  analisarTextoImportacao,
  extrairRasCancelados,
} from "./conferencia/importacao";
import { quantidadeResultado } from "./conferencia/utils";
import {
  DOCUMENTO_DASHBOARD_POR_CAMPO,
  clonarAlunos,
  converterAlunosApi,
  formularioVazio,
  normalizarBusca,
  statusDocumentalAluno,
  type Aluno,
  type AlunoApi,
  type AlunoImportacao,
  type FiltroStatus,
  type FormAluno,
  type LinhaPreviaImportacao,
  type PreviaCancelados,
  type ResultadoCancelados,
  type ResultadoImportacao,
  type Unidade,
} from "./conferencia/model";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
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
  const [modalImportarAlunos, setModalImportarAlunos] = useState(false);

  const [modoImportacao, setModoImportacao] = useState<"colar" | "csv">(
    "colar",
  );

  const [unidadeImportacao, setUnidadeImportacao] = useState<Unidade>("FCH");

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

  const [modalImportarCancelados, setModalImportarCancelados] = useState(false);
  const [modoCancelados, setModoCancelados] = useState<"colar" | "csv">(
    "colar",
  );
  const [unidadeCancelados, setUnidadeCancelados] = useState<Unidade>("FACE");
  const [textoCancelados, setTextoCancelados] = useState("");
  const [arquivoCancelados, setArquivoCancelados] = useState("");
  const [previaCancelados, setPreviaCancelados] =
    useState<PreviaCancelados | null>(null);
  const [resultadoCancelados, setResultadoCancelados] =
    useState<ResultadoCancelados | null>(null);
  const [processandoCancelados, setProcessandoCancelados] = useState(false);
  const [erroCancelados, setErroCancelados] = useState("");

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

  async function registrarLog(
    acao: string,
    descricao: string,
    ra?: string,
    unidade?: string,
  ) {
    try {
      await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao,
          entidade: "ALUNO",
          descricao,
          ra,
          unidade,
        }),
      });
    } catch (erro) {
      console.error("Não foi possível registrar o LOG.", erro);
    }
  }

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

  function abrirImportacao() {
    setModoImportacao("colar");
    setUnidadeImportacao(unidadeSelecionada || "FCH");
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

    if (!arquivo) {
      return;
    }

    setErroImportacao("");
    setResultadoImportacao(null);
    setPreviaImportacao([]);
    setArquivoImportacao(arquivo.name);

    try {
      const bytes = await arquivo.arrayBuffer();

      let conteudo: string;

      try {
        // Primeiro tenta UTF-8 estrito.
        conteudo = new TextDecoder("utf-8", {
          fatal: true,
        }).decode(bytes);
      } catch {
        // O CSV do sistema pode vir em Windows-1252/ANSI.
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

      if (previa.length === 0) {
        throw new Error("Nenhum aluno foi encontrado.");
      }

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
      .filter(
        (aluno) => aluno.status === "valido" || aluno.status === "alterado",
      )
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

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          unidade: unidadeImportacao,
          alunos,
        }),
      });

      const dados = (await resposta.json()) as ResultadoImportacao;

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível sincronizar os alunos.",
        );
      }

      setResultadoImportacao(dados);

      await registrarLog(
        "IMPORTAÇÃO",
        `${alunos.length} aluno(s) sincronizado(s) pela importação.`,
        undefined,
        unidadeImportacao,
      );

      setUnidadeSelecionada(unidadeImportacao);

      // A lista será atualizada somente depois que o usuário fechar o modal
      // de sucesso. Assim a confirmação aparece antes da tela de loading.

      // Evita um loading que pisca rápido demais quando a API responde na hora.
      const tempoDecorrido = performance.now() - inicioAnimacao;
      const tempoMinimoLoading = 650;

      if (tempoDecorrido < tempoMinimoLoading) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, tempoMinimoLoading - tempoDecorrido),
        );
      }

      setImportando(false);
      setFinalizandoImportacao(true);

      // Dá tempo para o modal atual fazer o fade/scale-out antes do sucesso.
      await new Promise((resolve) => window.setTimeout(resolve, 180));

      setModalImportarAlunos(false);
      setFinalizandoImportacao(false);
      setSucessoImportacao({
        resultado: dados,
        unidade: unidadeImportacao,
      });
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

    if (!unidade) return;

    await carregarAlunos(undefined, unidade, filtroStatus);
  }

  function abrirImportacaoCancelados() {
    setModoCancelados("colar");
    setUnidadeCancelados(unidadeSelecionada || "FACE");
    setTextoCancelados("");
    setArquivoCancelados("");
    setPreviaCancelados(null);
    setResultadoCancelados(null);
    setErroCancelados("");
    setModalImportarCancelados(true);
  }

  function fecharImportacaoCancelados() {
    if (processandoCancelados) return;

    fecharModalAnimado("importar-cancelados", () =>
      setModalImportarCancelados(false),
    );
  }

  function limparImportacaoCancelados() {
    setTextoCancelados("");
    setArquivoCancelados("");
    setPreviaCancelados(null);
    setResultadoCancelados(null);
    setErroCancelados("");
  }

  async function selecionarArquivoCancelados(
    event: ChangeEvent<HTMLInputElement>,
  ) {
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
      setErroCancelados(
        modoCancelados === "csv"
          ? "Selecione um arquivo CSV."
          : "Cole os dados da planilha.",
      );
      return;
    }

    try {
      setProcessandoCancelados(true);

      const ras = extrairRasCancelados(textoCancelados);

      if (ras.length === 0) {
        throw new Error("Nenhum RA foi encontrado.");
      }

      const resposta = await fetch("/api/alunos/cancelados/previa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unidade: unidadeCancelados,
          ras,
        }),
      });

      const dados = (await resposta.json()) as PreviaCancelados;

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível analisar os cancelados.",
        );
      }

      setPreviaCancelados(dados);
    } catch (erro) {
      console.error(erro);
      setPreviaCancelados(null);
      setErroCancelados(
        erro instanceof Error
          ? erro.message
          : "Não foi possível analisar os cancelados.",
      );
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

      const resposta = await fetch("/api/alunos/cancelados", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unidade: unidadeCancelados,
          ras,
        }),
      });

      const dados = (await resposta.json()) as ResultadoCancelados;

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível cancelar os alunos.");
      }

      setResultadoCancelados(dados);

      await registrarLog(
        "CANCELAMENTO EM LOTE",
        `${ras.length} matrícula(s) processada(s) pela lista de cancelados.`,
        undefined,
        unidadeCancelados,
      );

      setUnidadeSelecionada(unidadeCancelados);
      setFiltroStatus("CANCELADO");

      await carregarAlunos(ras[0], unidadeCancelados, "CANCELADO");
    } catch (erro) {
      console.error(erro);
      setErroCancelados(
        erro instanceof Error ? erro.message : "Erro ao cancelar alunos.",
      );
    } finally {
      setProcessandoCancelados(false);
    }
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

      await registrarLog(
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

      await registrarLog(
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

      await registrarLog(
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

      await registrarLog(
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

      await registrarLog(
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

      {modalImportarAlunos && (
        <div
          className={`modal-overlay ${
            finalizandoImportacao ? "modal-overlay-finalizando" : ""
          } ${modalSaindo === "importar-alunos" ? "modal-overlay-exit" : ""}`}
        >
          <div
            className={`modal-importacao ${
              finalizandoImportacao ? "modal-importacao-finalizando" : ""
            }`}
          >
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">IMPORTAÇÃO EM LOTE</span>

                <h2>Importar alunos</h2>

                <p>
                  Cole os dados da planilha ou selecione um arquivo CSV e
                  confira a prévia antes de confirmar.
                </p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={fecharImportacao}
                disabled={importando || finalizandoImportacao}
              >
                ×
              </button>
            </div>

            <div className="importacao-conteudo">
              {(importando || finalizandoImportacao) && (
                <div
                  className={`importacao-processando ${
                    finalizandoImportacao ? "concluindo" : ""
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <div
                    className="importacao-processando-spinner"
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </div>

                  <strong>
                    {finalizandoImportacao
                      ? "Sincronização concluída"
                      : "Sincronizando alunos..."}
                  </strong>

                  <span>
                    {finalizandoImportacao
                      ? "Preparando o resumo da importação."
                      : "Atualizando a base e conferindo os dados importados."}
                  </span>
                </div>
              )}

              {!resultadoImportacao &&
                !importando &&
                !finalizandoImportacao && (
                  <>
                    <label className="importacao-unidade">
                      <span>Unidade de destino</span>

                      <AppSelect
                        value={unidadeImportacao}
                        onChange={(valor) => {
                          setUnidadeImportacao(valor as Unidade);
                          setPreviaImportacao([]);
                        }}
                        disabled={importando}
                        ariaLabel="Unidade de destino"
                        options={[
                          { value: "FACE", label: "FACE" },
                          { value: "FEA", label: "FEA" },
                          { value: "FCH", label: "FCH" },
                          { value: "EAD", label: "EAD" },
                        ]}
                      />
                    </label>

                    <div className="importacao-tabs">
                      <button
                        type="button"
                        className={modoImportacao === "colar" ? "active" : ""}
                        onClick={() => {
                          setModoImportacao("colar");
                          limparImportacao();
                        }}
                      >
                        Colar dados
                      </button>

                      <button
                        type="button"
                        className={modoImportacao === "csv" ? "active" : ""}
                        onClick={() => {
                          setModoImportacao("csv");
                          limparImportacao();
                        }}
                      >
                        Arquivo CSV
                      </button>
                    </div>

                    {previaImportacao.length === 0 ? (
                      <>
                        {modoImportacao === "colar" ? (
                          <div className="importacao-colar">
                            <textarea
                              value={textoImportacao}
                              onChange={(event) => {
                                setTextoImportacao(event.target.value);

                                setErroImportacao("");
                              }}
                              placeholder={`Cole aqui os dados copiados da planilha.

Exemplo:
Contrato    Curso    E-mail (outro)    E-mail    Nome    RA
SIM    PSICOLOGIA    aluno@gmail.com    a123@fumec.edu.br    JOÃO DA SILVA    2910130000`}
                            />
                          </div>
                        ) : (
                          <div className="importacao-arquivo">
                            <input
                              id="arquivo-importacao"
                              type="file"
                              accept=".csv,text/csv"
                              onChange={selecionarArquivoImportacao}
                            />

                            <label
                              htmlFor="arquivo-importacao"
                              className="importacao-dropzone"
                            >
                              <strong>
                                {arquivoImportacao || "Selecionar arquivo CSV"}
                              </strong>

                              <span>
                                {arquivoImportacao
                                  ? "Arquivo carregado e pronto para análise."
                                  : "Clique para selecionar um arquivo .csv"}
                              </span>
                            </label>
                          </div>
                        )}

                        <button
                          type="button"
                          className="botao-analisar-importacao"
                          onClick={gerarPreviaImportacao}
                          disabled={!textoImportacao.trim()}
                        >
                          Analisar dados
                        </button>
                      </>
                    ) : (
                      <div className="importacao-previa">
                        <div className="importacao-previa-cabecalho">
                          <div>
                            <span>PRÉVIA</span>
                            <h3>Confira antes de importar</h3>
                          </div>

                          <button
                            type="button"
                            onClick={() => setPreviaImportacao([])}
                          >
                            ← Editar dados
                          </button>
                        </div>

                        <div className="importacao-resumo resultado">
                          <div>
                            <strong>{previaImportacao.length}</strong>
                            <span>Encontrados</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "valido",
                                ).length
                              }
                            </strong>
                            <span>Novos</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "alterado",
                                ).length
                              }
                            </strong>
                            <span>Com alterações</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "igual",
                                ).length
                              }
                            </strong>
                            <span>Sem alterações</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) =>
                                    aluno.status === "duplicado" ||
                                    aluno.status === "invalido",
                                ).length
                              }
                            </strong>
                            <span>Problemas</span>
                          </div>
                        </div>

                        <div className="importacao-lista">
                          {previaImportacao.map((aluno, indice) => (
                            <div
                              key={`${aluno.ra}-${indice}`}
                              className={`importacao-item ${
                                aluno.status === "alterado"
                                  ? "valido"
                                  : aluno.status === "igual"
                                    ? "duplicado"
                                    : aluno.status
                              }`}
                            >
                              <div className="importacao-item-principal">
                                <strong>
                                  {aluno.nome || "Nome não informado"}
                                </strong>

                                <span>
                                  RA {aluno.ra || "—"}
                                  {" · "}
                                  {aluno.curso || "Curso não informado"}
                                </span>

                                {(aluno.email || aluno.email_outro) && (
                                  <small>
                                    {aluno.email || aluno.email_outro}
                                  </small>
                                )}
                              </div>

                              <div className="importacao-item-status">
                                <strong>
                                  {aluno.status === "valido"
                                    ? "NOVO"
                                    : aluno.status === "alterado"
                                      ? "ALTERADO"
                                      : aluno.status === "igual"
                                        ? "SEM ALTERAÇÕES"
                                        : aluno.status === "duplicado"
                                          ? "REPETIDO NO ARQUIVO"
                                          : "INVÁLIDO"}
                                </strong>

                                {aluno.motivo && <span>{aluno.motivo}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

              {resultadoImportacao && !importando && !finalizandoImportacao && (
                <div className="importacao-resultado">
                  <div className="importacao-resultado-ok">✓</div>

                  <h3>Importação concluída</h3>

                  <p>O servidor terminou de processar o lote.</p>

                  <div className="importacao-resumo resultado">
                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.encontrados)}
                      </strong>
                      <span>Processados</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.importados)}
                      </strong>
                      <span>Novos</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.atualizados)}
                      </strong>
                      <span>Atualizados</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(
                          resultadoImportacao.sem_alteracoes,
                        )}
                      </strong>
                      <span>Sem alterações</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.invalidos)}
                      </strong>
                      <span>Inválidos</span>
                    </div>
                  </div>
                </div>
              )}

              {erroImportacao && (
                <div className="modal-erro">{erroImportacao}</div>
              )}
            </div>

            {!importando && !finalizandoImportacao && (
              <div className="modal-acoes">
                {!resultadoImportacao ? (
                  <>
                    <button
                      type="button"
                      className="botao-cancelar"
                      onClick={fecharImportacao}
                      disabled={importando}
                    >
                      Cancelar
                    </button>

                    {previaImportacao.length > 0 && (
                      <button
                        type="button"
                        className="botao-cadastrar"
                        onClick={confirmarImportacao}
                        disabled={
                          importando ||
                          !previaImportacao.some(
                            (aluno) =>
                              aluno.status === "valido" ||
                              aluno.status === "alterado",
                          )
                        }
                      >
                        {importando ? "Importando..." : `Confirmar importação`}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="botao-cadastrar"
                    onClick={fecharImportacao}
                  >
                    Concluir
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {sucessoImportacao && (
        <div className="modal-overlay">
          <div
            className="modal-importacao-sucesso"
            role="dialog"
            aria-modal="true"
          >
            <div className="importacao-sucesso-conteudo">
              <div className="importacao-sucesso-icone">✓</div>

              <span className="modal-eyebrow">IMPORTAÇÃO CONCLUÍDA</span>
              <h2>Alunos sincronizados com sucesso</h2>

              <p>
                A importação para a unidade{" "}
                <strong>{sucessoImportacao.unidade}</strong> foi concluída.
              </p>

              <div className="importacao-sucesso-resumo">
                <div>
                  <strong>
                    {quantidadeResultado(
                      sucessoImportacao.resultado.importados,
                    )}
                  </strong>
                  <span>incluídos</span>
                </div>

                <div>
                  <strong>
                    {quantidadeResultado(
                      sucessoImportacao.resultado.atualizados,
                    )}
                  </strong>
                  <span>atualizados</span>
                </div>

                <div>
                  <strong>
                    {quantidadeResultado(
                      sucessoImportacao.resultado.sem_alteracoes,
                    )}
                  </strong>
                  <span>sem alterações</span>
                </div>
              </div>
            </div>

            <div className="modal-acoes importacao-sucesso-acoes">
              <button
                type="button"
                className="botao-cadastrar"
                onClick={() => void fecharSucessoImportacao()}
                autoFocus
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalImportarCancelados && (
        <div
          className={`modal-overlay ${modalSaindo === "importar-cancelados" ? "modal-overlay-exit" : ""}`}
        >
          <div className="modal-importacao">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow modal-eyebrow-danger">
                  CANCELAMENTOS
                </span>
                <h2>Importar cancelados</h2>
                <p>
                  Informe a lista oficial. O sistema apenas altera o status do
                  aluno e preserva toda a conferência documental.
                </p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={fecharImportacaoCancelados}
                disabled={processandoCancelados}
              >
                ×
              </button>
            </div>

            <div className="importacao-conteudo">
              {!resultadoCancelados && (
                <>
                  <label className="importacao-unidade">
                    <span>Unidade da lista</span>

                    <AppSelect
                      value={unidadeCancelados}
                      onChange={(valor) => {
                        setUnidadeCancelados(valor as Unidade);
                        setPreviaCancelados(null);
                      }}
                      disabled={processandoCancelados}
                      ariaLabel="Unidade da lista"
                      options={[
                        { value: "FACE", label: "FACE" },
                        { value: "FEA", label: "FEA" },
                        { value: "FCH", label: "FCH" },
                        { value: "EAD", label: "EAD" },
                      ]}
                    />
                  </label>

                  <div className="importacao-tabs">
                    <button
                      type="button"
                      className={modoCancelados === "colar" ? "active" : ""}
                      onClick={() => {
                        setModoCancelados("colar");
                        limparImportacaoCancelados();
                      }}
                    >
                      Colar dados
                    </button>

                    <button
                      type="button"
                      className={modoCancelados === "csv" ? "active" : ""}
                      onClick={() => {
                        setModoCancelados("csv");
                        limparImportacaoCancelados();
                      }}
                    >
                      Arquivo CSV
                    </button>
                  </div>

                  {!previaCancelados ? (
                    <>
                      {modoCancelados === "colar" ? (
                        <div className="importacao-colar">
                          <textarea
                            value={textoCancelados}
                            onChange={(event) => {
                              setTextoCancelados(event.target.value);
                              setErroCancelados("");
                            }}
                            placeholder={`Cole a lista com cabeçalho.

Exemplo:
Contrato    Curso    E-mail (outro)    E-mail    Nome    RA
Não Entregue    PSICOLOGIA    aluno@gmail.com    a123@fumec.edu.br    JOÃO DA SILVA    2910130000`}
                          />
                        </div>
                      ) : (
                        <div className="importacao-arquivo">
                          <input
                            id="arquivo-cancelados"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={selecionarArquivoCancelados}
                          />

                          <label
                            htmlFor="arquivo-cancelados"
                            className="importacao-dropzone"
                          >
                            <strong>
                              {arquivoCancelados ||
                                "Selecionar arquivo de cancelados"}
                            </strong>
                            <span>
                              {arquivoCancelados
                                ? "Arquivo carregado e pronto para análise."
                                : "Clique para selecionar um arquivo .csv"}
                            </span>
                          </label>
                        </div>
                      )}

                      <button
                        type="button"
                        className="botao-analisar-importacao"
                        onClick={gerarPreviaCancelados}
                        disabled={
                          !textoCancelados.trim() || processandoCancelados
                        }
                      >
                        {processandoCancelados
                          ? "Analisando..."
                          : "Analisar cancelados"}
                      </button>
                    </>
                  ) : (
                    <div className="importacao-previa">
                      <div className="importacao-previa-cabecalho">
                        <div>
                          <span>PRÉVIA</span>
                          <h3>Confira antes de cancelar</h3>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPreviaCancelados(null)}
                        >
                          ← Editar dados
                        </button>
                      </div>

                      <div className="importacao-resumo resultado">
                        <div>
                          <strong>{previaCancelados.recebidos}</strong>
                          <span>Encontrados</span>
                        </div>
                        <div>
                          <strong>
                            {previaCancelados.prontos_para_cancelar}
                          </strong>
                          <span>Prontos</span>
                        </div>
                        <div>
                          <strong>{previaCancelados.ja_cancelados}</strong>
                          <span>Já cancelados</span>
                        </div>
                        <div>
                          <strong>{previaCancelados.nao_encontrados}</strong>
                          <span>Não encontrados</span>
                        </div>
                        <div>
                          <strong>{previaCancelados.outra_unidade}</strong>
                          <span>Outra unidade</span>
                        </div>
                      </div>

                      <div className="importacao-lista">
                        {previaCancelados.alunos.map((aluno, indice) => (
                          <div
                            key={`${aluno.ra}-${indice}`}
                            className={`importacao-item ${
                              aluno.status_previa === "PRONTO"
                                ? "cancelar"
                                : aluno.status_previa === "JA_CANCELADO"
                                  ? "duplicado"
                                  : "invalido"
                            }`}
                          >
                            <div className="importacao-item-principal">
                              <strong>
                                {aluno.nome || "Aluno não encontrado"}
                              </strong>
                              <span>
                                RA {aluno.ra}
                                {aluno.curso ? ` · ${aluno.curso}` : ""}
                              </span>
                              {aluno.unidade && (
                                <small>Unidade atual: {aluno.unidade}</small>
                              )}
                            </div>

                            <div className="importacao-item-status">
                              <strong>
                                {aluno.status_previa === "PRONTO"
                                  ? "ATIVO → CANCELADO"
                                  : aluno.status_previa === "JA_CANCELADO"
                                    ? "JÁ CANCELADO"
                                    : aluno.status_previa === "OUTRA_UNIDADE"
                                      ? "OUTRA UNIDADE"
                                      : "NÃO ENCONTRADO"}
                              </strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {resultadoCancelados && (
                <div className="importacao-resultado">
                  <div className="importacao-resultado-ok">✓</div>
                  <h3>Cancelamentos concluídos</h3>
                  <p>Os registros documentais foram preservados.</p>

                  <div className="importacao-resumo resultado">
                    <div>
                      <strong>{resultadoCancelados.recebidos}</strong>
                      <span>Processados</span>
                    </div>
                    <div>
                      <strong>{resultadoCancelados.cancelados}</strong>
                      <span>Cancelados</span>
                    </div>
                    <div>
                      <strong>{resultadoCancelados.ja_cancelados}</strong>
                      <span>Já cancelados</span>
                    </div>
                    <div>
                      <strong>{resultadoCancelados.nao_encontrados}</strong>
                      <span>Não encontrados</span>
                    </div>
                    <div>
                      <strong>{resultadoCancelados.outra_unidade}</strong>
                      <span>Outra unidade</span>
                    </div>
                  </div>
                </div>
              )}

              {erroCancelados && (
                <div className="modal-erro">{erroCancelados}</div>
              )}
            </div>

            <div className="modal-acoes">
              {!resultadoCancelados ? (
                <>
                  <button
                    type="button"
                    className="botao-cancelar"
                    onClick={fecharImportacaoCancelados}
                    disabled={processandoCancelados}
                  >
                    Cancelar
                  </button>

                  {previaCancelados && (
                    <button
                      type="button"
                      className="botao-confirmar-exclusao"
                      onClick={confirmarCancelados}
                      disabled={
                        processandoCancelados ||
                        previaCancelados.prontos_para_cancelar === 0
                      }
                    >
                      {processandoCancelados
                        ? "Cancelando..."
                        : `Cancelar ${previaCancelados.prontos_para_cancelar} aluno(s)`}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="botao-cadastrar"
                  onClick={fecharImportacaoCancelados}
                >
                  Concluir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
