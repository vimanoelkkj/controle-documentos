import { useEffect, useMemo, useState } from "react";

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
          <h1>Dashboard documental</h1>
          <p>
            Panorama da documentação ativa, pendências prioritárias e desempenho
            por unidade.
          </p>
        </div>

        <label className="dashboard-unit-filter">
          <span>VISUALIZAÇÃO</span>
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            <option value="GERAL">Geral — todas as unidades</option>
            {unidades.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="dashboard-kpis">
        <article className="dashboard-kpi">
          <span>ALUNOS ATIVOS</span>
          <strong>{total.toLocaleString("pt-BR")}</strong>
          <small>
            {unidade === "GERAL" ? "Todas as unidades" : unidade}
          </small>
        </article>

        <article className="dashboard-kpi complete">
          <span>DOCUMENTAÇÃO COMPLETA</span>
          <strong>{resumo.completo.toLocaleString("pt-BR")}</strong>
          <small>{taxaCompleta}% dos alunos</small>
        </article>

        <article className="dashboard-kpi partial">
          <span>PARCIALMENTE COMPLETA</span>
          <strong>{resumo.parcial.toLocaleString("pt-BR")}</strong>
          <small>Histórico + Contrato entregues</small>
        </article>

        <article className="dashboard-kpi critical">
          <span>DOCUMENTAÇÃO CRÍTICA</span>
          <strong>{resumo.critico.toLocaleString("pt-BR")}</strong>
          <small>{percentual(resumo.critico, total)}% dos alunos</small>
        </article>

        <article className="dashboard-kpi progress">
          <span>PROGRESSO DOCUMENTAL</span>
          <strong>{progressoGeral}%</strong>
          <small>
            {resumo.documentosEntregues.toLocaleString("pt-BR")} de{" "}
            {resumo.documentosPossiveis.toLocaleString("pt-BR")} documentos
          </small>
        </article>
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
              <div>
                <span className="dashboard-dot complete" />
                <p>
                  <strong>{resumo.completo}</strong>
                  <span>Completos</span>
                </p>
              </div>
              <div>
                <span className="dashboard-dot partial" />
                <p>
                  <strong>{resumo.parcial}</strong>
                  <span>Parciais</span>
                </p>
              </div>
              <div>
                <span className="dashboard-dot critical" />
                <p>
                  <strong>{resumo.critico}</strong>
                  <span>Críticos</span>
                </p>
              </div>
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
                <div className="dashboard-bar-row" key={item.campo}>
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
                </div>
              );
            })}
          </div>
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
            <div className="dashboard-unit-row" key={item.unidade}>
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
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

export default Dashboard;
