import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import AppSelect from "../components/AppSelect";

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

type DocumentoCampo =
  | "identidade"
  | "cpf"
  | "certidao"
  | "residencia"
  | "titulo"
  | "ensino_medio"
  | "contrato";

type StatusDocumental = "COMPLETO" | "PARCIAL" | "CRITICO";

const DOCUMENTOS: { campo: DocumentoCampo; nome: string }[] = [
  { campo: "identidade", nome: "Identidade" },
  { campo: "cpf", nome: "CPF" },
  { campo: "certidao", nome: "Certidão de Registro Civil" },
  { campo: "residencia", nome: "Comprovante de Residência" },
  { campo: "titulo", nome: "Título de Eleitor" },
  { campo: "ensino_medio", nome: "Histórico do Ensino Médio" },
  { campo: "contrato", nome: "Contrato" },
];

function statusDocumental(aluno: AlunoApi): StatusDocumental {
  const entregues = DOCUMENTOS.filter((doc) => aluno[doc.campo] === 1).length;

  if (entregues === DOCUMENTOS.length) return "COMPLETO";

  // Regra operacional já usada no fluxo: quando Histórico + Contrato
  // foram entregues, o aluno deixa de ser crítico mesmo com outras pendências.
  if (aluno.ensino_medio === 1 && aluno.contrato === 1) return "PARCIAL";

  return "CRITICO";
}

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

function Dashboard() {
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("GERAL");
  const [pendenciasSelecionadas, setPendenciasSelecionadas] = useState<
    DocumentoCampo[]
  >([]);

  function abrirConferencia(
    filtros: {
      unidade?: string;
      docStatus?: StatusDocumental;
      pendencias?: DocumentoCampo[];
    } = {},
  ) {
    const params = new URLSearchParams();
    params.set("status", "ATIVO");

    const unidadeDestino =
      filtros.unidade ?? (unidade !== "GERAL" ? unidade : "");

    if (unidadeDestino) params.set("unidade", unidadeDestino);
    if (filtros.docStatus) params.set("docStatus", filtros.docStatus);

    const pendencias = filtros.pendencias ?? [];
    if (pendencias.length > 0) {
      params.set("pendencia", pendencias.join(","));
    }

    window.location.assign(`/conferencia?${params.toString()}`);
  }

  function alternarPendenciaDashboard(campo: DocumentoCampo) {
    setPendenciasSelecionadas((atuais) =>
      atuais.includes(campo)
        ? atuais.filter((item) => item !== campo)
        : [...atuais, campo],
    );
  }

  function abrirPendenciasSelecionadas() {
    if (pendenciasSelecionadas.length === 0) return;

    abrirConferencia({
      pendencias: pendenciasSelecionadas,
    });
  }

  useEffect(() => {
    fetch("/api/alunos")
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      })
      .then(setAlunos)
      .catch(() => setErro("Não foi possível carregar os dados do dashboard."))
      .finally(() => setCarregando(false));
  }, []);

  const ativos = useMemo(
    () => alunos.filter((aluno) => aluno.status === "ATIVO"),
    [alunos],
  );

  const unidades = useMemo(
    () =>
      [...new Set(ativos.map((aluno) => aluno.unidade))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [ativos],
  );

  const base = useMemo(
    () =>
      unidade === "GERAL"
        ? ativos
        : ativos.filter((aluno) => aluno.unidade === unidade),
    [ativos, unidade],
  );

  const resumo = useMemo(() => {
    const contagem = {
      completo: 0,
      parcial: 0,
      critico: 0,
      documentosEntregues: 0,
      documentosPossiveis: base.length * DOCUMENTOS.length,
    };

    base.forEach((aluno) => {
      const status = statusDocumental(aluno);

      if (status === "COMPLETO") contagem.completo += 1;
      if (status === "PARCIAL") contagem.parcial += 1;
      if (status === "CRITICO") contagem.critico += 1;

      DOCUMENTOS.forEach((doc) => {
        if (aluno[doc.campo] === 1) contagem.documentosEntregues += 1;
      });
    });

    return contagem;
  }, [base]);

  const pendencias = useMemo(
    () =>
      DOCUMENTOS.map((doc) => ({
        ...doc,
        quantidade: base.filter((aluno) => aluno[doc.campo] !== 1).length,
      })).sort((a, b) => b.quantidade - a.quantidade),
    [base],
  );

  const comparacaoUnidades = useMemo(
    () =>
      unidades.map((nomeUnidade) => {
        const alunosUnidade = ativos.filter(
          (aluno) => aluno.unidade === nomeUnidade,
        );

        const completo = alunosUnidade.filter(
          (aluno) => statusDocumental(aluno) === "COMPLETO",
        ).length;
        const parcial = alunosUnidade.filter(
          (aluno) => statusDocumental(aluno) === "PARCIAL",
        ).length;
        const critico = alunosUnidade.length - completo - parcial;

        return {
          unidade: nomeUnidade,
          total: alunosUnidade.length,
          completo,
          parcial,
          critico,
        };
      }),
    [ativos, unidades],
  );

  const total = base.length;
  const taxaCompleta = percentual(resumo.completo, total);
  const progressoGeral = percentual(
    resumo.documentosEntregues,
    resumo.documentosPossiveis,
  );

  const quantidadePendenciasExatas = useMemo(() => {
    if (pendenciasSelecionadas.length === 0) return 0;

    const selecionadas = new Set(pendenciasSelecionadas);

    return base.filter((aluno) => {
      const pendenciasDoAluno = DOCUMENTOS.filter(
        (doc) => aluno[doc.campo] !== 1,
      ).map((doc) => doc.campo);

      return (
        pendenciasDoAluno.length === selecionadas.size &&
        pendenciasDoAluno.every((campo) => selecionadas.has(campo))
      );
    }).length;
  }, [base, pendenciasSelecionadas]);

  const maiorPendencia = pendencias[0];

  const donut = useMemo(() => {
    const raio = 54;
    const circunferencia = 2 * Math.PI * raio;
    const partes = [
      { chave: "completo", valor: resumo.completo, classe: "complete" },
      { chave: "parcial", valor: resumo.parcial, classe: "partial" },
      { chave: "critico", valor: resumo.critico, classe: "critical" },
    ];

    let acumulado = 0;

    return {
      raio,
      circunferencia,
      partes: partes.map((parte) => {
        const fracao = total ? parte.valor / total : 0;
        const comprimento = circunferencia * fracao;
        const atual = {
          ...parte,
          comprimento,
          deslocamento: -acumulado,
        };
        acumulado += comprimento;
        return atual;
      }),
    };
  }, [resumo, total]);

  if (carregando) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-state">Carregando visão geral...</div>
      </section>
    );
  }

  if (erro) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-state error">{erro}</div>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <header className="dashboard-hero">
        <div>
          <span className="dashboard-eyebrow">VISÃO EXECUTIVA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="dashboard" size={22} />
            </span>
            <h1>Dashboard documental</h1>
          </div>
          <p>
            Panorama da documentação ativa, pendências prioritárias e desempenho
            por unidade.
          </p>
        </div>

        <div className="dashboard-unit-filter">
          <span>VISUALIZAÇÃO</span>
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Visualização por unidade"
            options={[
              { value: "GERAL", label: "Geral — todas as unidades" },
              ...unidades.map((item) => ({ value: item, label: item })),
            ]}
          />
        </div>
      </header>

      <div className="dashboard-kpis">
        <button
          type="button"
          className="dashboard-kpi dashboard-nav-card"
          onClick={() => abrirConferencia()}
        >
          <span>ALUNOS ATIVOS</span>
          <strong>{total.toLocaleString("pt-BR")}</strong>
          <small>{unidade === "GERAL" ? "Todas as unidades" : unidade}</small>
        </button>

        <button
          type="button"
          className="dashboard-kpi complete dashboard-nav-card"
          onClick={() => abrirConferencia({ docStatus: "COMPLETO" })}
        >
          <span>DOCUMENTAÇÃO COMPLETA</span>
          <strong>{resumo.completo.toLocaleString("pt-BR")}</strong>
          <small>{taxaCompleta}% dos alunos</small>
        </button>

        <button
          type="button"
          className="dashboard-kpi partial dashboard-nav-card"
          onClick={() => abrirConferencia({ docStatus: "PARCIAL" })}
        >
          <span>PARCIALMENTE COMPLETA</span>
          <strong>{resumo.parcial.toLocaleString("pt-BR")}</strong>
          <small>Histórico + Contrato entregues</small>
        </button>

        <button
          type="button"
          className="dashboard-kpi critical dashboard-nav-card"
          onClick={() => abrirConferencia({ docStatus: "CRITICO" })}
        >
          <span>DOCUMENTAÇÃO CRÍTICA</span>
          <strong>{resumo.critico.toLocaleString("pt-BR")}</strong>
          <small>{percentual(resumo.critico, total)}% dos alunos</small>
        </button>

        <button
          type="button"
          className="dashboard-kpi progress dashboard-nav-card"
          onClick={() => abrirConferencia()}
        >
          <span>PROGRESSO DOCUMENTAL</span>
          <strong>{progressoGeral}%</strong>
          <small>
            {resumo.documentosEntregues.toLocaleString("pt-BR")} de{" "}
            {resumo.documentosPossiveis.toLocaleString("pt-BR")} documentos
          </small>
        </button>
      </div>

      <div className="dashboard-main-grid">
        <article className="dashboard-card dashboard-status-card">
          <div className="dashboard-card-header">
            <div>
              <span>DISTRIBUIÇÃO</span>
              <h2>Status documental</h2>
            </div>
            <small>{total.toLocaleString("pt-BR")} alunos</small>
          </div>

          <div className="dashboard-donut-wrap">
            <div className="dashboard-donut">
              <svg viewBox="0 0 140 140" aria-label="Distribuição documental">
                <circle
                  className="dashboard-donut-track"
                  cx="70"
                  cy="70"
                  r={donut.raio}
                />
                {donut.partes.map((parte) => (
                  <circle
                    key={parte.chave}
                    className={`dashboard-donut-segment ${parte.classe}`}
                    cx="70"
                    cy="70"
                    r={donut.raio}
                    strokeDasharray={`${parte.comprimento} ${
                      donut.circunferencia - parte.comprimento
                    }`}
                    strokeDashoffset={parte.deslocamento}
                  />
                ))}
              </svg>

              <div className="dashboard-donut-center">
                <strong>{taxaCompleta}%</strong>
                <span>completos</span>
              </div>
            </div>

            <div className="dashboard-legend">
              <button
                type="button"
                onClick={() => abrirConferencia({ docStatus: "COMPLETO" })}
              >
                <span className="dashboard-dot complete" />
                <p>
                  <strong>{resumo.completo}</strong>
                  <span>Completos</span>
                </p>
              </button>
              <button
                type="button"
                onClick={() => abrirConferencia({ docStatus: "PARCIAL" })}
              >
                <span className="dashboard-dot partial" />
                <p>
                  <strong>{resumo.parcial}</strong>
                  <span>Parciais</span>
                </p>
              </button>
              <button
                type="button"
                onClick={() => abrirConferencia({ docStatus: "CRITICO" })}
              >
                <span className="dashboard-dot critical" />
                <p>
                  <strong>{resumo.critico.toLocaleString("pt-BR")}</strong>
                  <span>Críticos</span>
                </p>
              </button>
            </div>
          </div>
        </article>

        <article className="dashboard-card dashboard-pendencias-card">
          <div className="dashboard-card-header">
            <div>
              <span>PENDÊNCIAS</span>
              <h2>Documentos mais devidos</h2>
            </div>
            {maiorPendencia && (
              <small>
                maior: {maiorPendencia.quantidade.toLocaleString("pt-BR")}
              </small>
            )}
          </div>

          <div className="dashboard-bars">
            {pendencias.map((item) => {
              const largura = percentual(item.quantidade, total);

              return (
                <button
                  type="button"
                  className={`dashboard-bar-row dashboard-nav-bar ${
                    pendenciasSelecionadas.includes(item.campo)
                      ? "selected"
                      : ""
                  }`}
                  key={item.campo}
                  aria-pressed={pendenciasSelecionadas.includes(item.campo)}
                  onClick={() => alternarPendenciaDashboard(item.campo)}
                >
                  <div className="dashboard-bar-label">
                    <span>{item.nome}</span>
                    <strong>{item.quantidade.toLocaleString("pt-BR")}</strong>
                  </div>
                  <div className="dashboard-bar-track">
                    <div
                      className={`dashboard-bar-fill ${
                        item.campo === "contrato" ||
                        item.campo === "ensino_medio"
                          ? "priority"
                          : ""
                      }`}
                      style={{ width: `${largura}%` }}
                    />
                  </div>
                  <small>{largura}% dos alunos</small>
                </button>
              );
            })}
          </div>

          {pendenciasSelecionadas.length > 0 && (
            <div className="dashboard-pending-selection">
              <div>
                <span>PENDÊNCIAS SELECIONADAS</span>
                <strong>
                  {quantidadePendenciasExatas.toLocaleString("pt-BR")} aluno(s)
                  encontrado(s)
                </strong>
                <small>
                  {pendenciasSelecionadas.length} documento(s) selecionado(s) ·
                  correspondência exata
                </small>
              </div>

              <div className="dashboard-pending-selection-actions">
                <button
                  type="button"
                  className="dashboard-pending-clear"
                  onClick={() => setPendenciasSelecionadas([])}
                >
                  Limpar
                </button>

                <button
                  type="button"
                  className="dashboard-pending-open"
                  onClick={abrirPendenciasSelecionadas}
                  disabled={quantidadePendenciasExatas === 0}
                >
                  Ver alunos na Conferência
                </button>
              </div>
            </div>
          )}
        </article>
      </div>

      <article className="dashboard-card dashboard-units-card">
        <div className="dashboard-card-header">
          <div>
            <span>COMPARATIVO</span>
            <h2>Desempenho por unidade</h2>
          </div>
          <small>{unidades.length} unidade(s)</small>
        </div>

        <div className="dashboard-unit-table">
          <div className="dashboard-unit-head">
            <span>Unidade</span>
            <span>Alunos</span>
            <span>Completa</span>
            <span>Parcial</span>
            <span>Crítica</span>
            <span>Distribuição</span>
          </div>

          {comparacaoUnidades.map((item) => (
            <button
              type="button"
              className="dashboard-unit-row dashboard-nav-row"
              key={item.unidade}
              onClick={() => abrirConferencia({ unidade: item.unidade })}
            >
              <strong>{item.unidade}</strong>
              <span>{item.total}</span>
              <span className="complete">{item.completo}</span>
              <span className="partial">{item.parcial}</span>
              <span className="critical">{item.critico}</span>

              <div className="dashboard-stacked">
                <span
                  className="complete"
                  style={{ width: `${percentual(item.completo, item.total)}%` }}
                />
                <span
                  className="partial"
                  style={{ width: `${percentual(item.parcial, item.total)}%` }}
                />
                <span
                  className="critical"
                  style={{ width: `${percentual(item.critico, item.total)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

export default Dashboard;
