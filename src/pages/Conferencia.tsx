import {
  useEffect,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";

type Documento = {
  nome: string;
  entregue: boolean;
};

type Aluno = {
  ra: string;
  nome: string;
  unidade: string;
  curso: string;
  email?: string | null;
  email_outro?: string | null;
  status: "ATIVO" | "CANCELADO";
  documentos: Documento[];
};

type AlunoApi = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

type FormAluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email: string;
  email_outro: string;
  documentos: {
    identidade: boolean;
    cpf: boolean;
    certidao: boolean;
    residencia: boolean;
    titulo: boolean;
    ensino_medio: boolean;
    contrato: boolean;
  };
};

function clonarAlunos(alunos: Aluno[]): Aluno[] {
  return alunos.map((aluno) => ({
    ...aluno,
    documentos: aluno.documentos.map((documento) => ({
      ...documento,
    })),
  }));
}

function converterAlunosApi(dados: AlunoApi[]): Aluno[] {
  return dados.map((aluno) => ({
    ra: aluno.ra,
    nome: aluno.nome,
    unidade: aluno.unidade,
    curso: aluno.curso,
    email: aluno.email,
    email_outro: aluno.email_outro,
    status: aluno.status,
    documentos: [
      { nome: "ID", entregue: aluno.identidade === 1 },
      { nome: "CPF", entregue: aluno.cpf === 1 },
      { nome: "CERTIDÃO", entregue: aluno.certidao === 1 },
      { nome: "RESIDÊNCIA", entregue: aluno.residencia === 1 },
      { nome: "TÍTULO", entregue: aluno.titulo === 1 },
      { nome: "ENSINO MÉDIO", entregue: aluno.ensino_medio === 1 },
      { nome: "CONTRATO", entregue: aluno.contrato === 1 },
    ],
  }));
}

const formularioVazio: FormAluno = {
  ra: "",
  nome: "",
  curso: "",
  unidade: "FCH",
  email: "",
  email_outro: "",
  documentos: {
    identidade: false,
    cpf: false,
    certidao: false,
    residencia: false,
    titulo: false,
    ensino_medio: false,
    contrato: false,
  },
};

function Conferencia() {
  const [alunosSalvos, setAlunosSalvos] = useState<Aluno[]>([]);
  const [alunosEmEdicao, setAlunosEmEdicao] = useState<Aluno[]>([]);
  const [raSelecionado, setRaSelecionado] = useState("");
  const [busca, setBusca] = useState("");

  const [unidadeSelecionada, setUnidadeSelecionada] = useState<Unidade>("FCH");
  const [status, setStatus] = useState<"salvo" | "pendente">("salvo");
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
  const [erroImportacao, setErroImportacao] = useState("");

  const [resultadoImportacao, setResultadoImportacao] =
    useState<ResultadoImportacao | null>(null);

  const [modalNovoAluno, setModalNovoAluno] = useState(false);
  const [modalEditarAluno, setModalEditarAluno] = useState(false);
  const [modalExcluirAluno, setModalExcluirAluno] = useState(false);
  const [modalStatusAluno, setModalStatusAluno] = useState(false);

  const [novoAluno, setNovoAluno] = useState<FormAluno>(formularioVazio);
  const [alunoEdicao, setAlunoEdicao] = useState<FormAluno>(formularioVazio);

  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [alterandoStatusAluno, setAlterandoStatusAluno] = useState(false);

  const [erroCadastro, setErroCadastro] = useState("");
  const [erroEdicao, setErroEdicao] = useState("");

  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("ATIVO");

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

  async function carregarAlunos(
    raParaSelecionar?: string,
    unidadeFiltro: Unidade = unidadeSelecionada,
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

      const primeiroDoFiltro = alunosConvertidos.find(pertenceAoFiltroAtual);
      setRaSelecionado(primeiroDoFiltro?.ra ?? "");
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

  if (carregando) {
    return (
      <section className="conference-page">
        <p>Carregando alunos...</p>
      </section>
    );
  }

  if (erro) {
    return (
      <section className="conference-page">
        <p>{erro}</p>
      </section>
    );
  }

  if (alunosEmEdicao.length === 0) {
    return (
      <section className="conference-page">
        <p>Nenhum aluno encontrado.</p>
      </section>
    );
  }

  const alunoSelecionado =
    alunosEmEdicao.find((aluno) => aluno.ra === raSelecionado) ??
    alunosEmEdicao[0];

  const alunoSalvo =
    alunosSalvos.find((aluno) => aluno.ra === raSelecionado) ?? alunosSalvos[0];

  const termo = busca.trim().toLowerCase();

  const correspondeFiltroStatus = (aluno: Aluno) =>
    filtroStatus === "TODOS" || aluno.status === filtroStatus;

  const alunosNoStatus = alunosEmEdicao.filter(correspondeFiltroStatus);

  const quantidadesPorUnidade = {
    FACE: alunosNoStatus.filter((aluno) => aluno.unidade === "FACE").length,
    FEA: alunosNoStatus.filter((aluno) => aluno.unidade === "FEA").length,
    FCH: alunosNoStatus.filter((aluno) => aluno.unidade === "FCH").length,
    EAD: alunosNoStatus.filter((aluno) => aluno.unidade === "EAD").length,
  };

  const alunosFiltrados = alunosEmEdicao.filter((aluno) => {
    const pertenceUnidade = aluno.unidade === unidadeSelecionada;
    const pertenceStatus = correspondeFiltroStatus(aluno);

    const correspondeBusca =
      !termo ||
      `${aluno.nome} ${aluno.ra} ${aluno.curso}`.toLowerCase().includes(termo);

    return pertenceUnidade && pertenceStatus && correspondeBusca;
  });

  const temAlunoSelecionadoNoFiltro = alunosEmEdicao.some(
    (aluno) =>
      aluno.ra === raSelecionado &&
      aluno.unidade === unidadeSelecionada &&
      correspondeFiltroStatus(aluno),
  );

  function selecionarPrimeiroDoFiltro(
    unidade: Unidade,
    filtro: FiltroStatus = filtroStatus,
  ) {
    const primeiro = alunosEmEdicao.find(
      (aluno) =>
        aluno.unidade === unidade &&
        (filtro === "TODOS" || aluno.status === filtro),
    );

    if (primeiro) {
      selecionarAluno(primeiro.ra);
    } else {
      setRaSelecionado("");
      setStatus("salvo");
    }
  }

  const entregues = alunoSelecionado.documentos.filter(
    (documento) => documento.entregue,
  );

  const pendentes = alunoSelecionado.documentos.filter(
    (documento) => !documento.entregue,
  );

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

  function abrirImportacao() {
    setModoImportacao("colar");
    setUnidadeImportacao(unidadeSelecionada);
    setTextoImportacao("");
    setArquivoImportacao("");
    setPreviaImportacao([]);
    setErroImportacao("");
    setResultadoImportacao(null);

    setModalImportarAlunos(true);
  }

  function fecharImportacao() {
    if (importando) return;

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
      const previa = analisarTextoImportacao(textoImportacao);

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

  function quantidadeResultado(valor: number | unknown[] | undefined) {
    if (Array.isArray(valor)) {
      return valor.length;
    }

    return Number(valor ?? 0);
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

    try {
      setImportando(true);

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

      setUnidadeSelecionada(unidadeImportacao);

      await carregarAlunos(undefined, unidadeImportacao, filtroStatus);
    } catch (erro) {
      console.error(erro);

      setErroImportacao(
        erro instanceof Error ? erro.message : "Erro ao sincronizar alunos.",
      );
    } finally {
      setImportando(false);
    }
  }

  function abrirImportacaoCancelados() {
    setModoCancelados("colar");
    setUnidadeCancelados(unidadeSelecionada);
    setTextoCancelados("");
    setArquivoCancelados("");
    setPreviaCancelados(null);
    setResultadoCancelados(null);
    setErroCancelados("");
    setModalImportarCancelados(true);
  }

  function fecharImportacaoCancelados() {
    if (processandoCancelados) return;
    setModalImportarCancelados(false);
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

  function extrairRasCancelados(texto: string) {
    const linhas = texto
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((linha) => linha.trim());

    if (linhas.length < 2) {
      throw new Error(
        "Cole o cabeçalho da planilha e pelo menos uma linha de aluno.",
      );
    }

    const separador = detectarSeparador(linhas[0]);

    const cabecalhos = separarLinhaCsv(linhas[0], separador).map(
      normalizarCabecalho,
    );

    const indiceRa = obterIndiceCabecalho(cabecalhos, [
      "ra",
      "registro academico",
      "registro do aluno",
    ]);

    if (indiceRa === -1) {
      throw new Error("Não encontrei a coluna RA na lista de cancelados.");
    }

    const ras = linhas
      .slice(1)
      .map((linha) => separarLinhaCsv(linha, separador)[indiceRa]?.trim() ?? "")
      .filter(Boolean);

    return [...new Set(ras)];
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
  }

  async function salvarAlteracoes() {
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
    } catch (erro) {
      console.error(erro);
      alert("Não foi possível salvar as alterações.");
    }
  }

  function selecionarAluno(ra: string) {
    setRaSelecionado(ra);
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

  function normalizarCabecalho(valor: string) {
    return valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function interpretarContrato(valor: string): boolean | undefined {
    const texto = normalizarCabecalho(valor);

    if (!texto) {
      return undefined;
    }

    if (
      ["1", "sim", "s", "true", "verdadeiro", "entregue", "ok", "x"].includes(
        texto,
      )
    ) {
      return true;
    }

    if (
      ["0", "nao", "n", "false", "falso", "pendente", "nao entregue"].includes(
        texto,
      )
    ) {
      return false;
    }

    return undefined;
  }

  function detectarSeparador(linha: string) {
    const candidatos = ["\t", ";", ","];

    let melhor = "\t";
    let maiorQuantidade = -1;

    for (const separador of candidatos) {
      const quantidade = linha.split(separador).length;

      if (quantidade > maiorQuantidade) {
        maiorQuantidade = quantidade;
        melhor = separador;
      }
    }

    return melhor;
  }

  function separarLinhaCsv(linha: string, separador: string) {
    const colunas: string[] = [];

    let atual = "";
    let dentroAspas = false;

    for (let i = 0; i < linha.length; i += 1) {
      const caractere = linha[i];

      if (caractere === '"') {
        if (dentroAspas && linha[i + 1] === '"') {
          atual += '"';
          i += 1;
        } else {
          dentroAspas = !dentroAspas;
        }

        continue;
      }

      if (caractere === separador && !dentroAspas) {
        colunas.push(atual.trim());
        atual = "";
        continue;
      }

      atual += caractere;
    }

    colunas.push(atual.trim());

    return colunas;
  }

  function obterIndiceCabecalho(
    cabecalhos: string[],
    possibilidades: string[],
  ) {
    return cabecalhos.findIndex((cabecalho) =>
      possibilidades.includes(cabecalho),
    );
  }

  function analisarTextoImportacao(texto: string): LinhaPreviaImportacao[] {
    const linhas = texto
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((linha) => linha.trim());

    if (linhas.length < 2) {
      throw new Error(
        "Cole o cabeçalho da planilha e pelo menos uma linha de aluno.",
      );
    }

    const separador = detectarSeparador(linhas[0]);

    const cabecalhos = separarLinhaCsv(linhas[0], separador).map(
      normalizarCabecalho,
    );

    const indiceRa = obterIndiceCabecalho(cabecalhos, [
      "ra",
      "registro academico",
      "registro do aluno",
    ]);

    const indiceNome = obterIndiceCabecalho(cabecalhos, [
      "nome",
      "nome aluno",
      "aluno",
    ]);

    const indiceCurso = obterIndiceCabecalho(cabecalhos, [
      "curso",
      "curso aluno",
    ]);

    const indiceEmail = obterIndiceCabecalho(cabecalhos, [
      "email",
      "e mail",
      "email institucional",
      "e mail institucional",
    ]);

    const indiceEmailOutro = obterIndiceCabecalho(cabecalhos, [
      "email outro",
      "e mail outro",
      "email alternativo",
      "e mail alternativo",
      "e-mail (outro)",
      "email (outro)",
    ]);

    const indiceContrato = obterIndiceCabecalho(cabecalhos, ["contrato"]);

    if (indiceRa === -1 || indiceNome === -1 || indiceCurso === -1) {
      throw new Error(
        "Não encontrei as colunas obrigatórias RA, Nome e Curso.",
      );
    }

    const ocorrenciasRa = new Map<string, number>();

    const alunos = linhas.slice(1).map((linha, indice) => {
      const colunas = separarLinhaCsv(linha, separador);

      const ra = colunas[indiceRa]?.trim() ?? "";
      const nome = colunas[indiceNome]?.trim() ?? "";
      const curso = colunas[indiceCurso]?.trim() ?? "";

      const email =
        indiceEmail >= 0
          ? colunas[indiceEmail]?.trim() || undefined
          : undefined;

      const email_outro =
        indiceEmailOutro >= 0
          ? colunas[indiceEmailOutro]?.trim() || undefined
          : undefined;

      const contrato =
        indiceContrato >= 0
          ? interpretarContrato(colunas[indiceContrato] ?? "")
          : undefined;

      if (ra) {
        ocorrenciasRa.set(ra, (ocorrenciasRa.get(ra) ?? 0) + 1);
      }

      return {
        linha: indice + 2,
        ra,
        nome,
        curso,
        email,
        email_outro,
        contrato,
        status: "valido" as const,
      };
    });

    return alunos.map((aluno) => {
      const camposFaltando: string[] = [];

      if (!aluno.ra) camposFaltando.push("RA");
      if (!aluno.nome) camposFaltando.push("Nome");
      if (!aluno.curso) camposFaltando.push("Curso");

      if (camposFaltando.length > 0) {
        return {
          ...aluno,
          status: "invalido" as const,
          motivo: `Campo(s) obrigatório(s): ${camposFaltando.join(", ")}`,
        };
      }

      if ((ocorrenciasRa.get(aluno.ra) ?? 0) > 1) {
        return {
          ...aluno,
          status: "duplicado" as const,
          motivo: "RA repetido neste lote.",
        };
      }

      const alunoSalvo = alunosSalvos.find(
        (cadastrado) => cadastrado.ra === aluno.ra,
      );

      if (alunoSalvo) {
        const normalizar = (valor: string | null | undefined) =>
          (valor ?? "").trim();

        const alteracoes: string[] = [];

        if (alunoSalvo.status === "CANCELADO") {
          alteracoes.push("Status: CANCELADO → ATIVO");
        }

        if (normalizar(alunoSalvo.nome) !== normalizar(aluno.nome)) {
          alteracoes.push(`Nome: ${alunoSalvo.nome} → ${aluno.nome}`);
        }

        if (normalizar(alunoSalvo.curso) !== normalizar(aluno.curso)) {
          alteracoes.push(`Curso: ${alunoSalvo.curso} → ${aluno.curso}`);
        }

        if (normalizar(alunoSalvo.unidade) !== normalizar(unidadeImportacao)) {
          alteracoes.push(
            `Unidade: ${alunoSalvo.unidade} → ${unidadeImportacao}`,
          );
        }

        if (normalizar(alunoSalvo.email) !== normalizar(aluno.email)) {
          alteracoes.push(
            `E-mail: ${alunoSalvo.email || "—"} → ${aluno.email || "—"}`,
          );
        }

        if (
          normalizar(alunoSalvo.email_outro) !== normalizar(aluno.email_outro)
        ) {
          alteracoes.push(
            `E-mail alternativo: ${alunoSalvo.email_outro || "—"} → ${
              aluno.email_outro || "—"
            }`,
          );
        }

        if (alteracoes.length > 0) {
          return {
            ...aluno,
            status: "alterado" as const,
            motivo: alteracoes.join(" | "),
          };
        }

        return {
          ...aluno,
          status: "igual" as const,
          motivo: "Cadastro já está atualizado.",
        };
      }

      return aluno;
    });
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
        <h1>Conferência de documentos</h1>
        <p>Confira e atualize a documentação dos alunos.</p>
      </header>

      <div className="conference-grid">
        <aside className="student-panel">
          <div className="student-panel-header">
            <div>
              <span>ALUNOS POR UNIDADE</span>
              <h2>Lista de conferência</h2>
            </div>

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

              <button
                type="button"
                className="icon-button"
                onClick={() => carregarAlunos(raSelecionado)}
                title="Atualizar alunos"
              >
                ↻
              </button>
            </div>
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
                    setBusca("");
                    selecionarPrimeiroDoFiltro(unidadeSelecionada, filtro);
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
            {(["FACE", "FEA", "FCH", "EAD"] as Unidade[]).map((unidade) => (
              <button
                key={unidade}
                type="button"
                className={unidadeSelecionada === unidade ? "active" : ""}
                onClick={() => {
                  setUnidadeSelecionada(unidade);
                  setBusca("");

                  selecionarPrimeiroDoFiltro(unidade);
                }}
              >
                {unidade}
                <strong>{quantidadesPorUnidade[unidade]}</strong>
              </button>
            ))}
          </div>

          <input
            className="student-search"
            type="search"
            placeholder="Pesquisar aluno..."
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />

          <div className="student-list">
            {alunosFiltrados.map((aluno) => {
              const entreguesAluno = aluno.documentos.filter(
                (documento) => documento.entregue,
              ).length;

              return (
                <button
                  key={aluno.ra}
                  type="button"
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
          <article className="student-details">
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
              </div>

              <div className="student-progress">
                <strong>{percentual}%</strong>

                <span>
                  {percentual === 100
                    ? "COMPLETO"
                    : percentual >= 50
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

              <aside className="summary-card">
                <span>RESUMO</span>

                <div className="summary-number">
                  <strong>{pendentes.length}</strong>
                  <span>Pendências</span>
                </div>

                <ul>
                  {pendentes.map((documento) => (
                    <li key={documento.nome}>{documento.nome}</li>
                  ))}
                </ul>
              </aside>
            </div>

            <footer className="conference-actions">
              <span className={temAlteracoes ? "pending" : "saved"}>
                {temAlteracoes
                  ? "● Alterações pendentes"
                  : status === "salvo"
                    ? "✓ Alterações salvas"
                    : "Nenhuma alteração"}
              </span>

              <div>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={!temAlteracoes}
                  onClick={restaurarAlteracoes}
                >
                  Restaurar
                </button>

                <button
                  type="button"
                  className="primary-action"
                  disabled={!temAlteracoes}
                  onClick={salvarAlteracoes}
                >
                  Salvar alterações
                </button>
              </div>
            </footer>
          </article>
        ) : (
          <article className="student-details">
            <div style={{ padding: "32px" }}>
              <h2>Nenhum aluno encontrado</h2>
              <p>Não há alunos nesta unidade para o filtro selecionado.</p>
            </div>
          </article>
        )}
      </div>

      {modalAdicionarAluno && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno modal-adicionar-aluno">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">ALUNOS</span>
                <h2>Adicionar alunos</h2>
                <p>Escolha como deseja incluir alunos na conferência.</p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={() => setModalAdicionarAluno(false)}
              >
                ×
              </button>
            </div>

            <div className="adicionar-aluno-opcoes">
              <button
                type="button"
                onClick={() => {
                  setModalAdicionarAluno(false);
                  setErroCadastro("");
                  setModalNovoAluno(true);
                }}
              >
                <strong>+ Novo aluno</strong>
                <span>Cadastrar um aluno manualmente.</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalAdicionarAluno(false);
                  abrirImportacao();
                }}
              >
                <strong>⇧ Importar lista</strong>
                <span>Adicionar ou atualizar vários alunos de uma vez.</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {modalNovoAluno && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">CADASTRO</span>
                <h2>Novo aluno</h2>
                <p>Adicione um aluno ao controle de documentos.</p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={() => setModalNovoAluno(false)}
                disabled={cadastrando}
              >
                ×
              </button>
            </div>

            <FormularioAluno
              dados={novoAluno}
              setDados={setNovoAluno}
              mostrarDocumentos
            />

            {erroCadastro && <div className="modal-erro">{erroCadastro}</div>}

            <div className="modal-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setModalNovoAluno(false)}
                disabled={cadastrando}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="botao-cadastrar"
                onClick={cadastrarAluno}
                disabled={cadastrando}
              >
                {cadastrando ? "Cadastrando..." : "Cadastrar aluno"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalEditarAluno && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">EDIÇÃO</span>
                <h2>Editar aluno</h2>
                <p>Atualize os dados cadastrais do aluno.</p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={() => setModalEditarAluno(false)}
                disabled={editando}
              >
                ×
              </button>
            </div>

            <FormularioAluno dados={alunoEdicao} setDados={setAlunoEdicao} />

            {erroEdicao && <div className="modal-erro">{erroEdicao}</div>}

            <div
              style={{
                margin: "18px 24px 0",
                padding: "16px",
                border: "1px solid #6f3a34",
                borderRadius: "10px",
                background: "#241817",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: "6px",
                  color: "#ff9f91",
                  fontSize: "11px",
                }}
              >
                ZONA DE PERIGO
              </strong>

              <p
                style={{
                  margin: "0 0 12px",
                  color: "#9eaab3",
                  fontSize: "10px",
                  lineHeight: 1.5,
                }}
              >
                Excluir permanentemente deve ser usado apenas quando este
                cadastro foi criado por engano. Para saída do aluno, use o
                cancelamento de matrícula.
              </p>

              <button
                type="button"
                className="student-delete-button"
                onClick={() => {
                  setModalEditarAluno(false);
                  setModalExcluirAluno(true);
                }}
                disabled={editando}
              >
                Excluir permanentemente
              </button>
            </div>

            <div className="modal-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setModalEditarAluno(false)}
                disabled={editando}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="botao-cadastrar"
                onClick={salvarEdicaoAluno}
                disabled={editando}
              >
                {editando ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalImportarAlunos && (
        <div className="modal-overlay">
          <div className="modal-importacao">
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
                disabled={importando}
              >
                ×
              </button>
            </div>

            <div className="importacao-conteudo">
              {!resultadoImportacao && (
                <>
                  <label className="importacao-unidade">
                    <span>Unidade de destino</span>

                    <select
                      value={unidadeImportacao}
                      onChange={(event) => {
                        setUnidadeImportacao(event.target.value as Unidade);

                        setPreviaImportacao([]);
                      }}
                      disabled={importando}
                    >
                      <option value="FACE">FACE</option>
                      <option value="FEA">FEA</option>
                      <option value="FCH">FCH</option>
                      <option value="EAD">EAD</option>
                    </select>
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

              {resultadoImportacao && (
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
          </div>
        </div>
      )}

      {modalImportarCancelados && (
        <div className="modal-overlay">
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

                    <select
                      value={unidadeCancelados}
                      onChange={(event) => {
                        setUnidadeCancelados(event.target.value as Unidade);
                        setPreviaCancelados(null);
                      }}
                      disabled={processandoCancelados}
                    >
                      <option value="FACE">FACE</option>
                      <option value="FEA">FEA</option>
                      <option value="FCH">FCH</option>
                      <option value="EAD">EAD</option>
                    </select>
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

      {modalStatusAluno && (
        <div className="modal-overlay">
          <div className="modal-excluir-aluno">
            <div
              className={
                alunoSelecionado.status === "ATIVO"
                  ? "modal-excluir-icon"
                  : "modal-reativar-icon"
              }
            >
              {alunoSelecionado.status === "ATIVO" ? "!" : "↻"}
            </div>

            <div className="modal-excluir-conteudo">
              <span
                className={
                  alunoSelecionado.status === "ATIVO"
                    ? "modal-eyebrow modal-eyebrow-danger"
                    : "modal-eyebrow"
                }
              >
                {alunoSelecionado.status === "ATIVO"
                  ? "CANCELAMENTO"
                  : "REATIVAÇÃO"}
              </span>

              <h2>
                {alunoSelecionado.status === "ATIVO"
                  ? "Cancelar matrícula?"
                  : "Reativar matrícula?"}
              </h2>

              <p>
                {alunoSelecionado.status === "ATIVO"
                  ? "O aluno será retirado da lista de ativos, mas todo o cadastro e a conferência documental serão preservados."
                  : "O aluno voltará para a lista de ativos e manterá todo o histórico documental existente."}
              </p>

              <div className="aluno-exclusao-card">
                <strong>{alunoSelecionado.nome}</strong>

                <span>
                  RA {alunoSelecionado.ra} · {alunoSelecionado.curso}
                </span>
              </div>

              <p className="modal-excluir-aviso">
                {alunoSelecionado.status === "ATIVO"
                  ? `Status atual: ATIVO → novo status: CANCELADO`
                  : `Status atual: CANCELADO → novo status: ATIVO`}
              </p>
            </div>

            <div className="modal-excluir-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setModalStatusAluno(false)}
                disabled={alterandoStatusAluno}
              >
                Voltar
              </button>

              <button
                type="button"
                className={
                  alunoSelecionado.status === "ATIVO"
                    ? "botao-confirmar-exclusao"
                    : "botao-cadastrar"
                }
                onClick={alterarStatusMatricula}
                disabled={alterandoStatusAluno}
              >
                {alterandoStatusAluno
                  ? "Salvando..."
                  : alunoSelecionado.status === "ATIVO"
                    ? "Cancelar matrícula"
                    : "Reativar matrícula"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalExcluirAluno && (
        <div className="modal-overlay">
          <div className="modal-excluir-aluno">
            <div className="modal-excluir-icon">!</div>

            <div className="modal-excluir-conteudo">
              <span className="modal-eyebrow modal-eyebrow-danger">
                EXCLUSÃO
              </span>

              <h2>Excluir permanentemente?</h2>

              <p>Este recurso é reservado para cadastros criados por engano:</p>

              <div className="aluno-exclusao-card">
                <strong>{alunoSelecionado.nome}</strong>

                <span>
                  RA {alunoSelecionado.ra} · {alunoSelecionado.curso}
                </span>
              </div>

              <p className="modal-excluir-aviso">
                O aluno e todo o controle de documentos associado serão
                excluídos. Esta ação não pode ser desfeita.
              </p>
            </div>

            <div className="modal-excluir-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setModalExcluirAluno(false)}
                disabled={excluindo}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="botao-confirmar-exclusao"
                onClick={excluirAluno}
                disabled={excluindo}
              >
                {excluindo ? "Excluindo..." : "Excluir permanentemente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type Unidade = "FACE" | "FEA" | "FCH" | "EAD";
type FiltroStatus = "ATIVO" | "CANCELADO" | "TODOS";

type LinhaPreviaCancelado = {
  ra: string;
  nome?: string;
  curso?: string;
  unidade?: string;
  status?: "ATIVO" | "CANCELADO";
  status_previa: "PRONTO" | "JA_CANCELADO" | "NAO_ENCONTRADO" | "OUTRA_UNIDADE";
};

type PreviaCancelados = {
  sucesso?: boolean;
  recebidos: number;
  prontos_para_cancelar: number;
  ja_cancelados: number;
  nao_encontrados: number;
  outra_unidade: number;
  alunos: LinhaPreviaCancelado[];
  erro?: string;
};

type ResultadoCancelados = {
  sucesso?: boolean;
  recebidos: number;
  cancelados: number;
  ja_cancelados: number;
  nao_encontrados: number;
  outra_unidade: number;
  erro?: string;
};

type AlunoImportacao = {
  ra: string;
  nome: string;
  curso: string;
  email?: string;
  email_outro?: string;
  contrato?: boolean;
};

type LinhaPreviaImportacao = AlunoImportacao & {
  linha: number;
  status: "valido" | "alterado" | "igual" | "duplicado" | "invalido";
  motivo?: string;
};

type ResultadoImportacao = {
  encontrados: number | unknown[];
  importados: number | unknown[];
  atualizados?: number | unknown[];
  sem_alteracoes?: number | unknown[];
  ja_cadastrados: number | unknown[];
  duplicados_no_lote: number | unknown[];
  invalidos: number | unknown[];
  detalhes?: unknown;
  erro?: string;
};

type FormularioAlunoProps = {
  dados: FormAluno;
  setDados: Dispatch<SetStateAction<FormAluno>>;
  mostrarDocumentos?: boolean;
};

function FormularioAluno({
  dados,
  setDados,
  mostrarDocumentos = false,
}: FormularioAlunoProps) {
  return (
    <div className="modal-formulario">
      <label>
        RA *
        <input
          value={dados.ra}
          onChange={(event) => {
            const raAnterior = dados.ra.trim();
            const novoRa = event.target.value;
            const emailAutomaticoAnterior = raAnterior
              ? `a${raAnterior}@fumec.edu.br`
              : "";
            const deveAtualizarEmail =
              mostrarDocumentos &&
              (!dados.email.trim() || dados.email === emailAutomaticoAnterior);

            setDados({
              ...dados,
              ra: novoRa,
              ...(deveAtualizarEmail
                ? {
                    email: novoRa.trim()
                      ? `a${novoRa.trim()}@fumec.edu.br`
                      : "",
                  }
                : {}),
            });
          }}
          placeholder="Ex.: 2910136038"
        />
      </label>

      <label>
        Nome *
        <input
          value={dados.nome}
          onChange={(event) =>
            setDados({
              ...dados,
              nome: event.target.value.toLocaleUpperCase("pt-BR"),
            })
          }
          placeholder="Nome completo"
        />
      </label>

      <label>
        Curso *
        <input
          value={dados.curso}
          onChange={(event) =>
            setDados({
              ...dados,
              curso: event.target.value.toLocaleUpperCase("pt-BR"),
            })
          }
          placeholder="Ex.: PSICOLOGIA"
        />
      </label>

      <label>
        Unidade *
        <select
          value={dados.unidade}
          onChange={(event) =>
            setDados({
              ...dados,
              unidade: event.target.value,
            })
          }
        >
          <option value="FACE">FACE</option>
          <option value="FEA">FEA</option>
          <option value="FCH">FCH</option>
          <option value="EAD">EAD</option>
        </select>
      </label>

      <label>
        E-mail institucional
        <input
          type="email"
          value={dados.email}
          onChange={(event) =>
            setDados({
              ...dados,
              email: event.target.value,
            })
          }
          placeholder="a0000000000@fumec.edu.br"
        />
      </label>

      <label>
        E-mail alternativo
        <input
          type="email"
          value={dados.email_outro}
          onChange={(event) =>
            setDados({
              ...dados,
              email_outro: event.target.value,
            })
          }
          placeholder="aluno@email.com"
        />
      </label>

      {mostrarDocumentos && (
        <fieldset className="cadastro-documentos">
          <legend>Documentos já entregues</legend>
          <p>Marque somente o que já estiver conferido no cadastro inicial.</p>
          <div className="cadastro-documentos-grid">
            {[
              ["identidade", "Identidade"],
              ["cpf", "CPF"],
              ["certidao", "Certidão de Registro Civil"],
              ["residencia", "Comprovante de Residência"],
              ["titulo", "Título de Eleitor"],
              ["ensino_medio", "Histórico do Ensino Médio"],
              ["contrato", "Contrato"],
            ].map(([campo, nome]) => {
              const chave = campo as keyof FormAluno["documentos"];

              return (
                <label className="cadastro-documento-check" key={campo}>
                  <input
                    type="checkbox"
                    checked={dados.documentos[chave]}
                    onChange={(event) =>
                      setDados({
                        ...dados,
                        documentos: {
                          ...dados.documentos,
                          [chave]: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>{nome}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export default Conferencia;
