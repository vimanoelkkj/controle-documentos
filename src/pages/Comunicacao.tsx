import AppIcon from "../components/AppIcon";
import { ListaGrupos } from "./comunicacao/components/ListaGrupos";
import { useEffect, useMemo, useRef, useState } from "react";
import AppSelect from "../components/AppSelect";
import { useAuth } from "../contexts/auth";
import type { AlunoApi, HistoricoComunicacao } from "./comunicacao/model";
import { useHistoricoComunicacao } from "./comunicacao/hooks/useHistoricoComunicacao";
import { criarTextoEmail } from "./comunicacao/mensagens";
import { HistoricoComunicacoes } from "./comunicacao/components/HistoricoComunicacoes";
import { CartaoEmail } from "./comunicacao/components/CartaoEmail";
import { useAcoesComunicacao } from "./comunicacao/hooks/useAcoesComunicacao";
import { criarGrupos, normalizarEmail } from "./comunicacao/utils";
import { ListaAlunos } from "./comunicacao/components/ListaAlunos";

function Comunicacao() {
  const { modoApresentacao } = useAuth();
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [grupoSelecionado, setGrupoSelecionado] = useState("");
  const [unidade, setUnidade] = useState("TODAS");
  const [buscaGrupo, setBuscaGrupo] = useState("");
  const [buscaAluno, setBuscaAluno] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [prazo, setPrazo] = useState("01/07");
  const [assunto, setAssunto] = useState("Documentação pendente - Matrícula");
  const [feedback, setFeedback] = useState("");
  const {
    historico,
    historicoErro,
    registrandoHistorico,
    carregarHistorico,
    registrarCobranca: registrarCobrancaNoHistorico,
  } = useHistoricoComunicacao();
  const emailCardRef = useRef<HTMLElement | null>(null);
  const [alturaMaximaAlunos, setAlturaMaximaAlunos] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const elemento = emailCardRef.current;
    if (!elemento) return;

    const atualizarAltura = () => {
      setAlturaMaximaAlunos(Math.ceil(elemento.getBoundingClientRect().height));
    };

    atualizarAltura();

    const observer = new ResizeObserver(atualizarAltura);
    observer.observe(elemento);

    window.addEventListener("resize", atualizarAltura);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", atualizarAltura);
    };
  }, [grupoSelecionado, prazo, assunto]);

  useEffect(() => {
    fetch("/api/alunos")
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      })
      .then((dados) => setAlunos(dados))
      .catch(() => setErro("Não foi possível carregar os alunos."))
      .finally(() => setCarregando(false));
  }, []);

  const unidades = useMemo(
    () =>
      [...new Set(alunos.map((aluno) => aluno.unidade))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [alunos],
  );

  const grupos = useMemo(() => {
    const base =
      unidade === "TODAS"
        ? alunos
        : alunos.filter((aluno) => aluno.unidade === unidade);

    const termo = buscaGrupo.trim().toLocaleLowerCase("pt-BR");

    return criarGrupos(base).filter(
      (grupo) =>
        !termo ||
        grupo.documentos.some((documento) =>
          documento.curto.toLocaleLowerCase("pt-BR").includes(termo),
        ),
    );
  }, [alunos, unidade, buscaGrupo]);

  useEffect(() => {
    if (!grupos.length) {
      setGrupoSelecionado("");
      return;
    }

    if (!grupos.some((grupo) => grupo.chave === grupoSelecionado)) {
      setGrupoSelecionado(grupos[0].chave);
    }
  }, [grupos, grupoSelecionado]);

  const grupo = grupos.find((item) => item.chave === grupoSelecionado);

  useEffect(() => {
    if (!grupo) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(grupo.alunos.map((aluno) => aluno.ra)));
    setBuscaAluno("");
  }, [grupo]);

  const alunosVisiveis = useMemo(() => {
    if (!grupo) return [];
    const termo = buscaAluno.trim().toLocaleLowerCase("pt-BR");
    return grupo.alunos.filter(
      (aluno) =>
        !termo ||
        `${aluno.nome} ${aluno.ra} ${aluno.curso} ${aluno.email || ""} ${
          aluno.email_outro || ""
        }`
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
    );
  }, [grupo, buscaAluno]);

  const alunosSelecionados =
    grupo?.alunos.filter((aluno) => selecionados.has(aluno.ra)) || [];

  const emailsInstitucionais = [
    ...new Set(
      alunosSelecionados.map((a) => normalizarEmail(a.email)).filter(Boolean),
    ),
  ];

  const emailsAlternativos = [
    ...new Set(
      alunosSelecionados
        .map((a) => normalizarEmail(a.email_outro))
        .filter(Boolean),
    ),
  ];

  const selecionadosComInstitucional = alunosSelecionados.filter((a) =>
    normalizarEmail(a.email),
  ).length;
  const selecionadosSemInstitucional =
    alunosSelecionados.length - selecionadosComInstitucional;

  const emailsInstitucionaisBrutos = alunosSelecionados
    .map((a) => (a.email || "").trim())
    .filter(Boolean);

  const emailsInstitucionaisInvalidos = emailsInstitucionaisBrutos.filter(
    (email) => !normalizarEmail(email),
  );

  const emailsInstitucionaisDuplicados =
    emailsInstitucionaisBrutos.length -
    new Set(emailsInstitucionaisBrutos.map((email) => email.toLowerCase()))
      .size;

  const validacaoOk =
    alunosSelecionados.length > 0 &&
    selecionadosSemInstitucional === 0 &&
    emailsInstitucionaisInvalidos.length === 0;

  const cobrancasDaCombinacao = useMemo<HistoricoComunicacao[]>(
    () => historico.filter((registro) => registro.grupo_chave === grupo?.chave),
    [historico, grupo?.chave],
  );

  const cobrancasPorRa = useMemo(() => {
    const mapa = new Map<string, { quantidade: number; ultima: string }>();
    cobrancasDaCombinacao.forEach((registro) => {
      (registro.ras || []).forEach((ra) => {
        const atual = mapa.get(ra);
        if (!atual) mapa.set(ra, { quantidade: 1, ultima: registro.criado_em });
        else {
          atual.quantidade += 1;
          if (new Date(registro.criado_em) > new Date(atual.ultima))
            atual.ultima = registro.criado_em;
        }
      });
    });
    return mapa;
  }, [cobrancasDaCombinacao]);

  const alunosJaCobrados =
    grupo?.alunos.filter((aluno) => cobrancasPorRa.has(aluno.ra)) || [];
  const alunosNaoCobrados =
    grupo?.alunos.filter((aluno) => !cobrancasPorRa.has(aluno.ra)) || [];
  const ultimaCobrancaGrupo = cobrancasDaCombinacao[0]?.criado_em || "";

  const temContrato =
    grupo?.documentos.some((documento) => documento.campo === "contrato") ??
    false;

  const textoEmail = criarTextoEmail(grupo, prazo);

  function selecionarGrupo(chave: string) {
    setGrupoSelecionado(chave);
    setFeedback("");
  }

  function alternarAluno(ra: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(ra)) proximo.delete(ra);
      else proximo.add(ra);
      return proximo;
    });
  }

  const { copiarEmails, copiarComunicado, copiarAssunto, copiarPacoteOutlook } =
    useAcoesComunicacao({
      emailsInstitucionais,
      emailsAlternativos,
      assunto,
      textoEmail,
      setFeedback,
    });

  async function registrarCobranca() {
    if (!grupo || alunosSelecionados.length === 0) {
      setFeedback(
        "Selecione pelo menos um aluno antes de registrar a cobrança.",
      );
      return;
    }

    try {
      await registrarCobrancaNoHistorico({
        grupo_chave: grupo.chave,
        unidade,
        documentos: grupo.documentos.map((documento) => documento.curto),
        quantidade_alunos: alunosSelecionados.length,
        quantidade_emails: emailsInstitucionais.length,
        assunto: assunto || "Documentação pendente - Matrícula",
        prazo,
        tipo_destinatario: "institucional",
        ras: alunosSelecionados.map((aluno) => aluno.ra),
      });

      setFeedback(
        `✓ Cobrança registrada no histórico para ${
          alunosSelecionados.length
        } aluno${alunosSelecionados.length === 1 ? "" : "s"}.`,
      );
    } catch (erro) {
      setFeedback(
        erro instanceof Error
          ? `⚠ ${erro.message}`
          : "⚠ Não foi possível registrar a cobrança.",
      );
    }
  }

  if (carregando) {
    return (
      <section className="communication-page">
        Carregando comunicação...
      </section>
    );
  }

  if (erro) {
    return <section className="communication-page">{erro}</section>;
  }

  return (
    <section className="communication-page">
      <header className="communication-header">
        <div>
          <span className="communication-eyebrow">CENTRAL DE COMUNICAÇÃO</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="mail" size={22} />
            </span>
            <h1>Cobrança de documentos</h1>
          </div>
          <p>
            Grupos automáticos por combinação exata de pendências. Escolha um
            grupo, revise os alunos e copie os destinatários para o Outlook.
          </p>
        </div>

        <div className="communication-summary">
          <strong>{grupos.length}</strong>
          <span>combinações encontradas</span>
        </div>
      </header>

      <div className="communication-toolbar">
        <label>
          Unidade
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Filtrar comunicação por unidade"
            options={[
              { value: "TODAS", label: "Todas as unidades" },
              ...unidades.map((item) => ({ value: item, label: item })),
            ]}
          />
        </label>

        <label className="communication-search">
          Buscar combinação
          <input
            type="search"
            value={buscaGrupo}
            onChange={(e) => setBuscaGrupo(e.target.value)}
            placeholder="Ex.: Contrato, CPF, Histórico..."
          />
        </label>
      </div>
      <div className="communication-grid">
        <ListaGrupos
          grupos={grupos}
          grupoSelecionado={grupoSelecionado}
          aoSelecionarGrupo={selecionarGrupo}
        />

        <main className="communication-detail">
          {!grupo ? (
            <div className="communication-empty detail">
              Escolha uma combinação para começar.
            </div>
          ) : (
            <>
              <div className="communication-detail-header">
                <div>
                  <span>COMBINAÇÃO EXATA</span>
                  <h2>
                    {grupo.documentos.length === 7
                      ? "Todos os documentos"
                      : grupo.documentos.map((doc) => doc.curto).join(" + ")}
                  </h2>
                  <p>
                    Aqui entram somente alunos que devem exatamente estes
                    documentos — nenhum a mais e nenhum a menos.
                  </p>
                  <div className="communication-charge-summary">
                    <span>
                      <b>{alunosJaCobrados.length}</b> já cobrado(s)
                    </span>
                    <span>
                      <b>{alunosNaoCobrados.length}</b> ainda não cobrado(s)
                    </span>
                    {ultimaCobrancaGrupo && (
                      <span>
                        Última cobrança:{" "}
                        <b>
                          {new Date(ultimaCobrancaGrupo).toLocaleString(
                            "pt-BR",
                          )}
                        </b>
                      </span>
                    )}
                  </div>
                </div>
                <strong className="communication-big-count">
                  {grupo.alunos.length}
                </strong>
              </div>

              <div className="communication-tags">
                {grupo.documentos.map((documento) => (
                  <span
                    key={documento.campo}
                    className={documento.prioritario ? "priority" : ""}
                  >
                    {documento.curto}
                    {documento.prioritario ? " • prioritário" : ""}
                  </span>
                ))}
              </div>

              <div className="communication-actions">
                {modoApresentacao ? (
                  <div>
                    <span>MODO APRESENTAÇÃO</span>
                    <strong>
                      Dados pessoais e ações de comunicação ocultos
                    </strong>
                    <small>
                      A estrutura da combinação continua disponível apenas para
                      demonstração.
                    </small>
                  </div>
                ) : (
                  <>
                    <div>
                      <span>DESTINATÁRIOS</span>
                      <strong>
                        {alunosSelecionados.length} alunos selecionados
                      </strong>
                      <small>
                        {selecionadosComInstitucional} com e-mail institucional
                        • {selecionadosSemInstitucional} sem institucional •{" "}
                        {emailsAlternativos.length} alternativos
                      </small>
                    </div>

                    <div className="communication-action-buttons">
                      <button onClick={() => copiarEmails("institucional")}>
                        Copiar institucionais
                      </button>

                      <button onClick={() => copiarEmails("alternativo")}>
                        Copiar alternativos
                      </button>

                      <button onClick={() => copiarEmails("ambos")}>
                        Copiar ambos
                      </button>

                      <button
                        className="communication-outlook-button"
                        onClick={copiarPacoteOutlook}
                        title="Copia CCO, assunto e mensagem para a área de transferência"
                      >
                        Copiar pacote
                      </button>

                      <button
                        className="communication-register-button"
                        onClick={registrarCobranca}
                        disabled={
                          registrandoHistorico ||
                          alunosSelecionados.length === 0
                        }
                        title="Use depois de concluir o envio para registrar a cobrança no histórico"
                      >
                        {registrandoHistorico
                          ? "Registrando..."
                          : "Registrar cobrança"}
                      </button>
                    </div>
                  </>
                )}
              </div>
              {feedback && (
                <div className="communication-feedback">{feedback}</div>
              )}
              {!modoApresentacao && (
                <div
                  className={`communication-validation ${validacaoOk ? "ok" : "warning"}`}
                >
                  <div>
                    <span>VALIDAÇÃO DOS DESTINATÁRIOS</span>
                    <strong>
                      {validacaoOk
                        ? "Lista pronta para comunicação"
                        : "Revise a lista antes de copiar"}
                    </strong>
                  </div>

                  <div className="communication-validation-items">
                    <span
                      className={
                        selecionadosSemInstitucional === 0 ? "ok" : "warning"
                      }
                    >
                      {selecionadosSemInstitucional === 0 ? "✓" : "!"}{" "}
                      {selecionadosSemInstitucional} sem e-mail institucional
                    </span>

                    <span
                      className={
                        emailsInstitucionaisInvalidos.length === 0
                          ? "ok"
                          : "warning"
                      }
                    >
                      {emailsInstitucionaisInvalidos.length === 0 ? "✓" : "!"}{" "}
                      {emailsInstitucionaisInvalidos.length} e-mail(is)
                      inválido(s)
                    </span>

                    <span
                      className={
                        emailsInstitucionaisDuplicados === 0
                          ? "ok"
                          : "attention"
                      }
                    >
                      {emailsInstitucionaisDuplicados === 0 ? "✓" : "!"}{" "}
                      {emailsInstitucionaisDuplicados} duplicado(s)
                    </span>
                  </div>
                </div>
              )}
              <div
                className={`communication-content-grid ${
                  modoApresentacao ? "presentation-mode" : ""
                }`}
              >
                {!modoApresentacao && (
                  <CartaoEmail
                    emailCardRef={emailCardRef}
                    grupo={grupo}
                    prazo={prazo}
                    setPrazo={setPrazo}
                    assunto={assunto}
                    setAssunto={setAssunto}
                    quantidadeDestinatarios={alunosSelecionados.length}
                    temContrato={temContrato}
                    copiarAssunto={copiarAssunto}
                    copiarComunicado={copiarComunicado}
                  />
                )}
                <ListaAlunos
                  grupo={grupo}
                  modoApresentacao={modoApresentacao}
                  alturaMaximaAlunos={alturaMaximaAlunos}
                  buscaAluno={buscaAluno}
                  setBuscaAluno={setBuscaAluno}
                  selecionados={selecionados}
                  setSelecionados={setSelecionados}
                  alunosNaoCobrados={alunosNaoCobrados}
                  alunosVisiveis={alunosVisiveis}
                  cobrancasPorRa={cobrancasPorRa}
                  alternarAluno={alternarAluno}
                />
                <HistoricoComunicacoes
                  historico={historico}
                  historicoErro={historicoErro}
                  aoAtualizar={carregarHistorico}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

export default Comunicacao;
