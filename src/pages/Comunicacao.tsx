import "../styles/index/250-communication-reference-replica.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../contexts/auth";
import type { AlunoApi, HistoricoComunicacao } from "./comunicacao/model";
import { useHistoricoComunicacao } from "./comunicacao/hooks/useHistoricoComunicacao";
import { criarTextoEmail } from "./comunicacao/mensagens";
import { useAcoesComunicacao } from "./comunicacao/hooks/useAcoesComunicacao";
import { criarGrupos, formatarPrazo, normalizarEmail } from "./comunicacao/utils";
import PageLoading from "../components/PageLoading";


type CommunicationUnitFilterProps = {
  unidade: string;
  unidades: string[];
  totalAlunos: number;
  quantidadesPorUnidade: Record<string, number>;
  onChange: (unidade: string) => void;
};

function CommunicationUnitFilter({
  unidade,
  unidades,
  totalAlunos,
  quantidadesPorUnidade,
  onChange,
}: CommunicationUnitFilterProps) {
  const [aberto, setAberto] = useState(false);
  const [fechando, setFechando] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const fechar = () => {
    if (!aberto || fechando) return;

    setFechando(true);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const selecionar = (valor: string) => {
    if (!aberto || fechando) return;

    const scrollContainer = document.querySelector<HTMLElement>(".app-content");
    const scrollTopAntes = scrollContainer?.scrollTop ?? 0;

    setFechando(true);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      onChange(valor);
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;

      requestAnimationFrame(() => {
        if (!scrollContainer) return;
        scrollContainer.scrollTop = scrollTopAntes;

        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTopAntes;
        });
      });
    }, 120);
  };

  return (
    <div className="communication-unit-filter-wrap">
      <span className="communication-toolbar-label">Unidade</span>

      <div
        className={`conference-replica-unit-filter communication-unit-filter ${
          aberto ? "is-open" : ""
        } ${fechando ? "is-closing" : ""}`}
      >
        <button
          type="button"
          className="conference-replica-unit-trigger"
          onClick={() => {
            if (aberto) {
              fechar();
            } else {
              setFechando(false);
              setAberto(true);
            }
          }}
          aria-expanded={aberto}
          aria-controls="communication-unit-disclosure"
        >
          <span>
            {aberto
              ? "Filtrar por unidade"
              : unidade === "TODAS"
                ? "Todas as unidades"
                : unidade}
          </span>
          <span
            className="conference-replica-chevron communication-unit-chevron"
            aria-hidden="true"
          />
        </button>

        <div
          id="communication-unit-disclosure"
          className="conference-replica-unit-menu communication-unit-disclosure"
          role="listbox"
          aria-hidden={!aberto}
        >
          <div className="communication-unit-disclosure-inner">
            <button
              type="button"
              role="option"
              tabIndex={aberto ? 0 : -1}
              aria-selected={unidade === "TODAS"}
              className={unidade === "TODAS" ? "active" : ""}
              onClick={() => selecionar("TODAS")}
            >
              <span className="conference-replica-unit-option-copy">
                <i className="conference-replica-unit-radio" aria-hidden="true" />
                <span>Todas as unidades</span>
              </span>
              <strong>{totalAlunos}</strong>
            </button>

            {unidades.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                tabIndex={aberto ? 0 : -1}
                aria-selected={unidade === item}
                className={unidade === item ? "active" : ""}
                onClick={() => selecionar(item)}
              >
                <span className="conference-replica-unit-option-copy">
                  <i className="conference-replica-unit-radio" aria-hidden="true" />
                  <span>{item}</span>
                </span>
                <strong>{quantidadesPorUnidade[item] || 0}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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

  const quantidadesPorUnidade = useMemo(() => {
    const contagens: Record<string, number> = {};
    for (const aluno of alunos) {
      if (!aluno.unidade) continue;
      contagens[aluno.unidade] = (contagens[aluno.unidade] || 0) + 1;
    }
    return contagens;
  }, [alunos]);

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
        <PageLoading label="Carregando comunicação..." />
      </section>
    );
  }

  if (erro) {
    return <section className="communication-page">{erro}</section>;
  }

  return (
    <section className="communication-page">
<div className="communication-section-heading">
        <button type="button" className="communication-section-tab" aria-current="page">
          Cobranças
        </button>
        <span className="communication-section-count">{grupos.length} combinações</span>
      </div>

      <div className="communication-toolbar">
        <CommunicationUnitFilter
          unidade={unidade}
          unidades={unidades}
          totalAlunos={alunos.length}
          quantidadesPorUnidade={quantidadesPorUnidade}
          onChange={(novaUnidade) => {
            setUnidade(novaUnidade);
            setGrupoSelecionado("");
          }}
        />

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
        <aside className="communication-groups">
          <div className="communication-panel-title">
            <span>COMBINAÇÕES EXATAS</span>
          </div>

          <div className="communication-group-list">
            {grupos.map((item) => (
              <button
                key={item.chave}
                type="button"
                className={`communication-group-card ${
                  item.chave === grupoSelecionado ? "active" : ""
                }`}
                onClick={() => selecionarGrupo(item.chave)}
              >
                <div className="communication-group-copy">
                  <strong>
                    {item.documentos.length === 7
                      ? "Todos os documentos"
                      : `${item.documentos.length} documentos pendentes`}
                  </strong>
                  {item.documentos.length !== 7 && (
                    <div className="communication-mini-tags">
                      {item.documentos.map((doc) => (
                        <span
                          key={doc.campo}
                          className={doc.prioritario ? "priority" : ""}
                        >
                          {doc.curto}
                        </span>
                      ))}
                    </div>
                  )}
                  <span>
                    {item.alunos.length} aluno
                    {item.alunos.length === 1 ? "" : "s"}

                  </span>
                </div>
                <span className="communication-group-count">
                  {item.alunos.length}
                </span>
              </button>
            ))}

            {!grupos.length && (
              <div className="communication-empty">
                Nenhuma combinação encontrada.
              </div>
            )}
          </div>
        </aside>

        <main className="communication-detail">
          {!grupo ? (
            <div className="communication-empty detail">
              Escolha uma combinação para começar.
            </div>
          ) : (
            <>
              <div className="communication-detail-top">
                <div className="communication-detail-primary">
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
                              {new Date(ultimaCobrancaGrupo).toLocaleString("pt-BR")}
                            </b>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`communication-tags ${
                      grupo.documentos.some((documento) => documento.prioritario)
                        ? "has-priority"
                        : "no-priority"
                    }`}
                  >
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
                </div>

                <section className="communication-history">
                  <div className="communication-history-header">
                    <div>
                      <span>HISTÓRICO DE COBRANÇAS</span>
                      <strong>Últimos registros</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => void carregarHistorico()}
                    >
                      Atualizar
                    </button>
                  </div>

                  {historicoErro ? (
                    <div className="communication-history-error">
                      {historicoErro}
                    </div>
                  ) : historico.length === 0 ? (
                    <div className="communication-history-empty">
                      Nenhuma cobrança registrada ainda.
                    </div>
                  ) : (
                    <div className="communication-history-list">
                      {historico.map((registro) => (
                        <article
                          key={registro.id}
                          className="communication-history-item"
                        >
                          <div>
                            <strong>
                              {registro.documentos.length === 7
                                ? "Todos os documentos"
                                : registro.documentos.join(" + ")}
                            </strong>
                            <span>
                              {registro.unidade === "TODAS"
                                ? "Todas as unidades"
                                : registro.unidade}
                              {" • "}
                              {new Date(registro.criado_em).toLocaleString(
                                "pt-BR",
                              )}
                            </span>
                          </div>
                          <div className="communication-history-numbers">
                            <strong>{registro.quantidade_alunos}</strong>
                            <span>alunos</span>
                          </div>
                          <div className="communication-history-numbers">
                            <strong>{registro.quantidade_emails}</strong>
                            <span>e-mails</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="communication-recipient-block">
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
              </div>
              <div
                className={`communication-content-grid ${
                  modoApresentacao ? "presentation-mode" : ""
                }`}
              >
                {!modoApresentacao && (
                  <section
                    ref={emailCardRef}
                    className="communication-email-card"
                  >
                    <div className="communication-email-settings">
                      <label className="communication-deadline-field">
                        <span>
                          Data limite <small>DD/MM</small>
                        </span>
                        <input
                          value={prazo}
                          onChange={(e) =>
                            setPrazo(formatarPrazo(e.target.value))
                          }
                          placeholder="__/__"
                          inputMode="numeric"
                          maxLength={5}
                          aria-label="Data limite no formato dia e mês"
                        />
                      </label>
                      <label className="communication-subject-field">
                        <span>Assunto</span>
                        <input
                          value={assunto}
                          onChange={(e) => setAssunto(e.target.value)}
                          placeholder="Ex.: Documentação pendente — Matrícula"
                        />
                      </label>
                    </div>

                    {!modoApresentacao && (
                      <div className="communication-copy-actions">
                        <button type="button" onClick={copiarAssunto}>
                          Copiar assunto
                        </button>

                        <button type="button" onClick={copiarComunicado}>
                          Copiar texto
                        </button>
                      </div>
                    )}

                    <div className="communication-preview">
                      <div className="communication-preview-top">
                        <div className="communication-preview-heading">
                          <div className="communication-preview-icon">✉</div>
                          <div>
                            <span>PRÉVIA DA MENSAGEM</span>
                            <strong>{assunto || "Sem assunto"}</strong>
                            <small>
                              Para: {alunosSelecionados.length} destinatário(s)
                            </small>
                          </div>
                        </div>
                        <span className="communication-preview-count">
                          {grupo.documentos.length} pendência(s)
                        </span>
                      </div>

                      <div className="communication-email-body">
                        <p className="communication-warning">
                          ⚠️ <b>ATENÇÃO! NÃO RESPONDER A ESTE E-MAIL.</b> MANDE
                          A SUA RESPOSTA PARA O E-MAIL ABAIXO⬇️:
                        </p>
                        <p className="communication-address">
                          matriculadecalouro@fumec.br
                        </p>
                        <p>Prezado(a), boa tarde.</p>
                        <p>
                          Informo que em verificação ao nosso sistema a sua
                          matrícula está pendente alguns documentos importantes.
                          Peço que realize o envio dos mesmos o mais rápido
                          possível via e-mail para{" "}
                          <b>matriculadecalouro@fumec.br</b> ou, se preferir,
                          pode comparecer pessoalmente na secretaria acadêmica
                          até o dia <b>{prazo || "___/___"}</b>. Informo que a
                          não apresentação destes documentos poderá resultar no
                          bloqueio da sua matrícula. Segue lista abaixo:
                        </p>

                        <ul>
                          {grupo.documentos.map((documento) => (
                            <li
                              key={documento.campo}
                              className={
                                documento.prioritario ? "priority" : ""
                              }
                            >
                              {documento.email};
                            </li>
                          ))}
                        </ul>

                        {temContrato && (
                          <p>
                            Caso esteja pendente o{" "}
                            <b className="communication-priority-text">
                              CONTRATO DE MATRÍCULA
                            </b>{" "}
                            assinado, você irá receber no seu e-mail o link para
                            o portal de visualização e assinatura do contrato.
                            Caso contrário, desconsidere as orientações.
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
                <section
                  className="communication-students-card"
                  style={
                    alturaMaximaAlunos
                      ? { maxHeight: `${alturaMaximaAlunos}px` }
                      : undefined
                  }
                >
                  <div className="communication-students-header">
                    <div>
                      <span>ALUNOS DO GRUPO</span>
                      <strong>
                        {modoApresentacao
                          ? `${grupo.alunos.length} aluno(s)`
                          : `${selecionados.size}/${grupo.alunos.length} selecionados`}
                      </strong>
                    </div>
                    <input
                      type="search"
                      value={buscaAluno}
                      onChange={(e) => setBuscaAluno(e.target.value)}
                      placeholder={
                        modoApresentacao
                          ? "Nome, RA ou curso"
                          : "Nome, RA, curso ou e-mail"
                      }
                    />
                  </div>

                  {!modoApresentacao && (
                    <div className="communication-select-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setSelecionados(
                            new Set(grupo.alunos.map((aluno) => aluno.ra)),
                          )
                        }
                      >
                        Selecionar todos
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelecionados(
                            new Set(alunosNaoCobrados.map((aluno) => aluno.ra)),
                          )
                        }
                        disabled={alunosNaoCobrados.length === 0}
                      >
                        Selecionar não cobrados
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelecionados(new Set())}
                      >
                        Limpar seleção
                      </button>
                    </div>
                  )}
                  <div className="communication-student-list">
                    {alunosVisiveis.map((aluno) => (
                      <label key={aluno.ra} className="communication-student">
                        {!modoApresentacao && (
                          <input
                            type="checkbox"
                            checked={selecionados.has(aluno.ra)}
                            onChange={() => alternarAluno(aluno.ra)}
                          />
                        )}
                        <div>
                          <strong>{aluno.nome}</strong>
                          <span>
                            RA {aluno.ra} • {aluno.curso} • {aluno.unidade}
                          </span>
                          {!modoApresentacao && (
                            <small>
                              {normalizarEmail(aluno.email) ||
                                "Sem e-mail institucional"}
                              {" • "}
                              {normalizarEmail(aluno.email_outro) ||
                                "Sem e-mail alternativo"}
                            </small>
                          )}
                          {!modoApresentacao &&
                            cobrancasPorRa.has(aluno.ra) && (
                              <span className="communication-charged-badge">
                                ✓ Cobrado em{" "}
                                {new Date(
                                  cobrancasPorRa.get(aluno.ra)!.ultima,
                                ).toLocaleDateString("pt-BR")}{" "}
                                • {cobrancasPorRa.get(aluno.ra)!.quantidade}x
                              </span>
                            )}
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

export default Comunicacao;
