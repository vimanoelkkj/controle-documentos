import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import { usePeriodo } from "../contexts/periodo";
import PageLoading from "../components/PageLoading";

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

type RegistroLog = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
};

type CorPendencia = "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "purple";

const DOCUMENTOS: {
  campo: DocumentoCampo;
  nome: string;
  curto: string;
  icon: React.ComponentProps<typeof AppIcon>["name"];
  cor: CorPendencia;
}[] = [
  { campo: "ensino_medio", nome: "Histórico Escolar", curto: "Histórico", icon: "education", cor: "red" },
  { campo: "contrato", nome: "Contrato", curto: "Contrato", icon: "contract", cor: "orange" },
  { campo: "certidao", nome: "Certidão de Nascimento/Casamento", curto: "Certidão", icon: "certificate", cor: "yellow" },
  { campo: "residencia", nome: "Comprovante de Residência", curto: "Residência", icon: "residence", cor: "green" },
  { campo: "titulo", nome: "Título de Eleitor", curto: "Título", icon: "voter", cor: "blue" },
  { campo: "identidade", nome: "Identidade", curto: "Identidade", icon: "identity", cor: "indigo" },
  { campo: "cpf", nome: "CPF", curto: "CPF", icon: "cpf", cor: "purple" },
];

function statusDocumental(aluno: AlunoApi): StatusDocumental {
  const entregues = DOCUMENTOS.filter((doc) => aluno[doc.campo] === 1).length;
  if (entregues === DOCUMENTOS.length) return "COMPLETO";
  if (aluno.ensino_medio === 1 && aluno.contrato === 1) return "PARCIAL";
  return "CRITICO";
}

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 1000) / 10;
}


function normalizarNomeCursoExibicao(valor: string) {
  let nome = valor
    .replace(/\s+/g, " ")
    .trim();

  const prefixos = [
    /^(?:EAD|E\.?A\.?D\.?)\s*(?:[-–—:|/]\s*)?/i,
    /^(?:SEMI[\s-]*PRESENCIAL|SEMIPRESENCIAL)\s*(?:[-–—:|/]\s*)?/i,
    /^(?:CURSO\s+SUPERIOR\s+DE\s+TECNOLOGIA\s+EM)\s+/i,
    /^(?:SUPERIOR\s+DE\s+TECNOLOGIA\s+EM)\s+/i,
    /^(?:TECNOLOGIA\s+EM)\s+/i,
    /^(?:TECN[ÓO]LOGO\s+EM)\s+/i,
    /^(?:BACHARELADO\s+EM)\s+/i,
    /^(?:LICENCIATURA\s+EM)\s+/i,
  ];

  // Pode haver mais de um prefixo encadeado.
  let alterou = true;
  while (alterou && nome) {
    alterou = false;

    for (const prefixo of prefixos) {
      const novoNome = nome.replace(prefixo, "").trim();
      if (novoNome !== nome) {
        nome = novoNome;
        alterou = true;
      }
    }
  }

  // Remove modalidade também quando ela aparece no FIM do nome:
  // "ADMINISTRAÇÃO EAD", "NUTRIÇÃO SEMIPRESENCIAL",
  // "LOGÍSTICA-EAD.", etc.
  const sufixosModalidade = [
    /\s*(?:[-–—:|/]\s*)?(?:EAD|E\.?A\.?D\.?)\.?\s*$/i,
    /\s*(?:[-–—:|/]\s*)?(?:SEMI[\s-]*PRESENCIAL|SEMIPRESENCIAL)\.?\s*$/i,
  ];

  alterou = true;
  while (alterou && nome) {
    alterou = false;

    for (const sufixo of sufixosModalidade) {
      const novoNome = nome.replace(sufixo, "").trim();
      if (novoNome !== nome) {
        nome = novoNome;
        alterou = true;
      }
    }
  }

  nome = nome
    .replace(/^[\s\-–—:|/]+/, "")
    .replace(/[\s\-–—:|/]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!nome) return valor.trim().toLocaleUpperCase("pt-BR");

  // No gráfico, todos os nomes de curso são exibidos em MAIÚSCULO.
  return nome.toLocaleUpperCase("pt-BR");
}

function formatarData(valor?: string) {
  if (!valor) return "—";
  const normalizado = valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`;
  const data = new Date(normalizado);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarMomento(valor?: string) {
  if (!valor) return "—";
  const normalizado = valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`;
  const data = new Date(normalizado);
  if (Number.isNaN(data.getTime())) return valor;

  const agora = new Date();
  const hoje = data.toDateString() === agora.toDateString();
  const ontemData = new Date(agora);
  ontemData.setDate(agora.getDate() - 1);
  const ontem = data.toDateString() === ontemData.toDateString();
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (hoje) return `Hoje, ${hora}`;
  if (ontem) return `Ontem, ${hora}`;
  return formatarData(valor);
}


function DashboardUnitIcon({ unidade }: { unidade: string }) {
  const common = {
    viewBox: "0 0 48 48",
    width: 36,
    height: 36,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (unidade === "EAD") {
    return (
      <svg {...common}>
        <rect x="7" y="11" width="27" height="20" rx="3" />
        <path d="M14 36h14M21 31v5" />
        <path d="m14 20 7-4 7 4-7 4-7-4Z" />
        <path d="M16.5 22v4c2.8 1.8 6.2 1.8 9 0v-4" />
        <path d="M33 8c3 .3 5.3 2.6 5.6 5.6" />
        <path d="M33.5 3.8c5.2.4 9.3 4.5 9.7 9.7" />
      </svg>
    );
  }

  if (unidade === "FACE") {
    return (
      <svg {...common}>
        <path d="M10 39V10h18v29" />
        <path d="M28 18h10v21" />
        <path d="M6 39h36" />
        <rect x="14" y="15" width="4" height="4" rx=".5" />
        <rect x="21" y="15" width="4" height="4" rx=".5" />
        <rect x="14" y="23" width="4" height="4" rx=".5" />
        <rect x="21" y="23" width="4" height="4" rx=".5" />
        <rect x="14" y="31" width="4" height="4" rx=".5" />
        <rect x="21" y="31" width="4" height="4" rx=".5" />
        <path d="M32 25h3M32 31h3" />
      </svg>
    );
  }

  if (unidade === "FCH") {
    return (
      <svg {...common} className="dashboard-unit-gavel" viewBox="0 0 24 24">
        <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8" />
        <path d="m16 16 6-6" />
        <path d="m8 8 6-6" />
        <path d="m9 7 8 8" />
        <path d="m21 11-8-8" />
      </svg>
    );
  }

  if (unidade === "FEA") {
    return (
      <svg {...common}>
        <circle cx="24" cy="9" r="4" />
        <circle cx="24" cy="9" r="1" />
        <path d="M21.7 13 14 42M26.3 13 34 42" />
        <path d="M17.5 28h13" />
        <path d="M24 13v8" />
        <path d="M16 42h-4M32 42h4" />
      </svg>
    );
  }

  return <AppIcon name="courses" size={34} />;
}

function Dashboard() {
  const { periodoAtual } = usePeriodo();
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [logs, setLogs] = useState<RegistroLog[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [unidadeSelecionada, setUnidadeSelecionada] = useState("");

  useEffect(() => {
    let ativo = true;

    Promise.all([
      fetch("/api/alunos").then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      }),
      fetch("/api/log?limit=8").then((resposta) =>
        resposta.ok ? (resposta.json() as Promise<RegistroLog[]>) : Promise.resolve([]),
      ),
    ])
      .then(([dadosAlunos, dadosLogs]) => {
        if (!ativo) return;
        setAlunos(dadosAlunos);
        setLogs(dadosLogs);
      })
      .catch(() => ativo && setErro("Não foi possível carregar os dados do dashboard."))
      .finally(() => ativo && setCarregando(false));

    return () => {
      ativo = false;
    };
  }, [periodoAtual?.codigo]);

  const ativos = useMemo(() => alunos.filter((aluno) => aluno.status === "ATIVO"), [alunos]);

  const resumo = useMemo(() => {
    const resultado = { completo: 0, parcial: 0, critico: 0 };
    ativos.forEach((aluno) => {
      const status = statusDocumental(aluno);
      if (status === "COMPLETO") resultado.completo += 1;
      else if (status === "PARCIAL") resultado.parcial += 1;
      else resultado.critico += 1;
    });
    return resultado;
  }, [ativos]);

  const unidades = useMemo(() => {
    const nomes = [...new Set(ativos.map((aluno) => aluno.unidade).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

    return nomes.map((unidade) => {
      const itens = ativos.filter((aluno) => aluno.unidade === unidade);
      const completo = itens.filter((aluno) => statusDocumental(aluno) === "COMPLETO").length;
      const parcial = itens.filter((aluno) => statusDocumental(aluno) === "PARCIAL").length;
      return {
        unidade,
        total: itens.length,
        completo,
        parcial,
        critico: itens.length - completo - parcial,
      };
    });
  }, [ativos]);

  useEffect(() => {
    if (!unidades.length) return;
    if (unidades.some((item) => item.unidade === unidadeSelecionada)) return;

    const preferida = unidades.find((item) => item.unidade === "EAD") ?? unidades[0];
    setUnidadeSelecionada(preferida.unidade);
  }, [unidades, unidadeSelecionada]);

  const unidadeAtiva = useMemo(
    () => unidades.find((item) => item.unidade === unidadeSelecionada) ?? unidades[0],
    [unidades, unidadeSelecionada],
  );

  const cursosDaUnidade = useMemo(() => {
    if (!unidadeAtiva) return [];

    const contagem = new Map<string, number>();
    ativos
      .filter((aluno) => aluno.unidade === unidadeAtiva.unidade)
      .forEach((aluno) => {
        const curso = aluno.curso?.trim() || "Curso não informado";
        contagem.set(curso, (contagem.get(curso) ?? 0) + 1);
      });

    return [...contagem.entries()]
      .map(([curso, totalCurso]) => ({ curso, total: totalCurso }))
      .sort((a, b) => b.total - a.total || a.curso.localeCompare(b.curso, "pt-BR"));
  }, [ativos, unidadeAtiva]);

  const maxCurso = Math.max(...cursosDaUnidade.map((item) => item.total), 1);

  const escalaCursos = useMemo(() => {
    const divisores = 6;
    const bruto = maxCurso / divisores;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(bruto, 1)));
    const normalizado = bruto / magnitude;
    const fator =
      normalizado <= 1 ? 1 :
      normalizado <= 2 ? 2 :
      normalizado <= 2.5 ? 2.5 :
      normalizado <= 5 ? 5 : 10;
    const passo = Math.max(1, fator * magnitude);
    const maximo = passo * divisores;

    return {
      maximo,
      ticks: Array.from({ length: divisores + 1 }, (_, indice) => maximo - indice * passo),
    };
  }, [maxCurso]);

  const pendencias = useMemo(
    () =>
      DOCUMENTOS.map((doc) => ({
        ...doc,
        quantidade: ativos.filter((aluno) => aluno[doc.campo] !== 1).length,
      })).sort((a, b) => b.quantidade - a.quantidade),
    [ativos],
  );

  const total = ativos.length;
  const pctCompleto = percentual(resumo.completo, total);
  const pctParcial = percentual(resumo.parcial, total);
  const pctCritico = percentual(resumo.critico, total);
  const pctConclusao = percentual(
    ativos.reduce(
      (soma, aluno) => soma + DOCUMENTOS.filter((documento) => aluno[documento.campo] === 1).length,
      0,
    ),
    Math.max(total * DOCUMENTOS.length, 1),
  );

  const totalPendencias = pendencias.reduce((soma, item) => soma + item.quantidade, 0);

  const donutStyle = useMemo(() => {
    const cores: Record<CorPendencia, string> = {
      red: "#ff4d4f",
      orange: "#ff902f",
      yellow: "#ffc447",
      green: "#86c95a",
      blue: "#4a8df6",
      indigo: "#5a78ea",
      purple: "#8467d9",
    };

    let acumulado = 0;
    const segmentos = pendencias.map((item) => {
      const inicio = acumulado;
      const tamanho = totalPendencias ? (item.quantidade / totalPendencias) * 100 : 0;
      acumulado += tamanho;
      return `${cores[item.cor]} ${inicio}% ${acumulado}%`;
    });

    return {
      background: totalPendencias
        ? `conic-gradient(${segmentos.join(",")})`
        : "conic-gradient(#dfe6ee 0 100%)",
    } as React.CSSProperties;
  }, [pendencias, totalPendencias]);

  if (carregando) {
    return (
      <section className="dashboard-page dashboard-v16">
        <PageLoading label="Carregando dashboard..." />
      </section>
    );
  }

  if (erro) {
    return (
      <section className="dashboard-page dashboard-v16">
        <div className="page-loading-state error dashboard-v16-loading">{erro}</div>
      </section>
    );
  }

  return (
    <section className="dashboard-page dashboard-v16">
<div className="dashboard-v16-metrics" aria-label="Resumo do período">
        <div className="dashboard-v16-metric metric-blue">
          <span className="dashboard-v16-metric-icon"><AppIcon name="user" size={25} /></span>
          <div>
            <small>Total de alunos</small>
            <strong>{total.toLocaleString("pt-BR")}</strong>
            <em>100% do total</em>
          </div>
        </div>

        <div className="dashboard-v16-metric metric-green">
          <span className="dashboard-v16-metric-icon"><AppIcon name="check" size={25} /></span>
          <div>
            <small>Completos</small>
            <strong>{resumo.completo.toLocaleString("pt-BR")}</strong>
            <em>{pctCompleto}% do total</em>
          </div>
        </div>

        <div className="dashboard-v16-metric metric-amber">
          <span className="dashboard-v16-metric-icon"><AppIcon name="clock" size={25} /></span>
          <div>
            <small>Parciais</small>
            <strong>{resumo.parcial.toLocaleString("pt-BR")}</strong>
            <em>{pctParcial}% do total</em>
          </div>
        </div>

        <div className="dashboard-v16-metric metric-red">
          <span className="dashboard-v16-metric-icon"><AppIcon name="close" size={25} /></span>
          <div>
            <small>Críticos</small>
            <strong>{resumo.critico.toLocaleString("pt-BR")}</strong>
            <em>{pctCritico}% do total</em>
          </div>
        </div>

        <div className="dashboard-v16-metric metric-blue metric-conclusion">
          <span className="dashboard-v16-metric-icon"><AppIcon name="pie" size={25} /></span>
          <div>
            <small>% Conclusão geral</small>
            <strong>{pctConclusao}%</strong>
            <em>Média geral</em>
          </div>
        </div>
      </div>

      <div className="dashboard-v16-upper">
        <section className="dashboard-v16-section dashboard-v16-units">
          <header className="dashboard-v16-units-heading">
            <h2>Alunos por unidade</h2>
            <p>Selecione uma unidade para visualizar a distribuição de alunos por curso.</p>
          </header>

          <div className="dashboard-v16-unit-tabs" role="tablist" aria-label="Unidades">
            {unidades.map((item) => {
              const ativa = item.unidade === unidadeAtiva?.unidade;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={ativa}
                  className={`dashboard-v16-unit-tab${ativa ? " active" : ""}`}
                  key={item.unidade}
                  onClick={() => setUnidadeSelecionada(item.unidade)}
                >
                  <span className="dashboard-v16-unit-icon">
                    <DashboardUnitIcon unidade={item.unidade} />
                  </span>
                  <span className="dashboard-v16-unit-copy">
                    <small>{item.unidade}</small>
                    <strong>{item.total.toLocaleString("pt-BR")}</strong>
                    <em>{percentual(item.total, total)}% do total</em>
                  </span>
                </button>
              );
            })}
          </div>

          {unidadeAtiva && (
            <div className="dashboard-v16-course-area">
              <header className="dashboard-v16-course-head">
                <h3>{unidadeAtiva.unidade}</h3>
                <p>
                  {unidadeAtiva.total.toLocaleString("pt-BR")} alunos distribuídos em{" "}
                  {cursosDaUnidade.length} {cursosDaUnidade.length === 1 ? "curso" : "cursos"}
                </p>
              </header>

              <div className="dashboard-v16-course-chart-scroll">
                <div
                  className="dashboard-v16-course-chart"
                  style={{
                    minWidth: `${Math.max(760, cursosDaUnidade.length * 168)}px`,
                    ["--course-count" as string]: cursosDaUnidade.length,
                  }}
                  role="img"
                  aria-label={`Distribuição de alunos por curso na unidade ${unidadeAtiva.unidade}`}
                >
                  <div className="dashboard-v16-course-y-axis" aria-hidden="true">
                    {escalaCursos.ticks.map((tick) => (
                      <span key={tick}>{tick.toLocaleString("pt-BR")}</span>
                    ))}
                  </div>

                  <div className="dashboard-v16-course-plot">
                    <div className="dashboard-v16-course-grid" aria-hidden="true">
                      {escalaCursos.ticks.map((tick) => (
                        <i key={tick} />
                      ))}
                    </div>

                    <div
                      className="dashboard-v16-course-bars"
                      style={{ gridTemplateColumns: `repeat(${Math.max(cursosDaUnidade.length, 1)}, minmax(94px, 1fr))` }}
                    >
                      {cursosDaUnidade.map((item) => (
                        <div className="dashboard-v16-course-bar-item" key={item.curso}>
                          <div
                            className="dashboard-v16-course-bar-zone"
                            style={{ ["--bar-height" as string]: `${Math.max(5, (item.total / escalaCursos.maximo) * 100)}%` }}
                          >
                            <strong>{item.total.toLocaleString("pt-BR")}</strong>
                            <span
                              className="dashboard-v16-course-bar"
                              style={{ height: `${Math.max(5, (item.total / escalaCursos.maximo) * 100)}%` }}
                            />
                          </div>
                          <em title={normalizarNomeCursoExibicao(item.curso)}>{normalizarNomeCursoExibicao(item.curso)}</em>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="dashboard-v16-section dashboard-v16-pendencies">
          <header className="dashboard-v16-section-head">
            <h2>Pendências por tipo de documento</h2>
          </header>

          <div className="dashboard-v16-pendencies-body">
            <div className="dashboard-v16-donut" style={donutStyle}>
              <div>
                <strong>{totalPendencias.toLocaleString("pt-BR")}</strong>
                <span>Pendências</span>
              </div>
            </div>

            <div className="dashboard-v16-pendency-list">
              {pendencias.map((item) => (
                <button
                  type="button"
                  key={item.campo}
                  className={`dashboard-v16-pendency-row color-${item.cor}`}
                  onClick={() => window.location.assign(`/conferencia?status=ATIVO&pendencia=${item.campo}`)}
                >
                  <i />
                  <span>{item.curto}</span>
                  <strong>{item.quantidade.toLocaleString("pt-BR")}</strong>
                  <em>{percentual(item.quantidade, totalPendencias)}%</em>
                </button>
              ))}
            </div>
          </div>

          <footer className="dashboard-v16-section-note">
            <span>Total de pendências em todos os documentos.</span>
            <AppIcon name="document" size={19} />
          </footer>
        </section>
      </div>

      <div className="dashboard-v16-lower">
        <section className="dashboard-v16-section dashboard-v16-status-table">
          <header className="dashboard-v16-section-head">
            <h2>Situação dos alunos por unidade</h2>
          </header>

          <div className="dashboard-v16-table" role="table" aria-label="Situação documental por unidade">
            <div className="dashboard-v16-table-row dashboard-v16-table-head" role="row">
              <span>Unidade</span>
              <span className="green">Completos</span>
              <span className="amber">Parciais</span>
              <span className="red">Críticos</span>
              <span>Total</span>
            </div>
            {unidades.map((item) => (
              <button
                type="button"
                className="dashboard-v16-table-row"
                role="row"
                key={item.unidade}
                onClick={() => window.location.assign(`/conferencia?status=ATIVO&unidade=${encodeURIComponent(item.unidade)}`)}
              >
                <strong>{item.unidade}</strong>
                <span className="green">{item.completo} ({percentual(item.completo, item.total)}%)</span>
                <span className="amber">{item.parcial} ({percentual(item.parcial, item.total)}%)</span>
                <span className="red">{item.critico} ({percentual(item.critico, item.total)}%)</span>
                <strong>{item.total}</strong>
              </button>
            ))}
          </div>

          <footer className="dashboard-v16-section-note">
            <span>Distribuição da situação dos alunos em cada unidade.</span>
            <AppIcon name="stats" size={19} />
          </footer>
        </section>

        <section className="dashboard-v16-section dashboard-v16-activities">
          <header className="dashboard-v16-section-head">
            <h2>Atividades recentes</h2>
            <button type="button" onClick={() => window.location.assign("/log")}>Ver todas</button>
          </header>

          <div className="dashboard-v16-activity-list">
            {logs.length === 0 ? (
              <p className="dashboard-v16-empty">Nenhuma atividade recente.</p>
            ) : (
              logs.slice(0, 4).map((log, index) => {
                const iconName: React.ComponentProps<typeof AppIcon>["name"] =
                  index % 4 === 0 ? "check" : index % 4 === 1 ? "plus" : index % 4 === 2 ? "audit" : "mail";
                return (
                  <div className={`dashboard-v16-activity activity-${index % 4}`} key={log.id}>
                    <span className="dashboard-v16-activity-icon"><AppIcon name={iconName} size={19} /></span>
                    <div>
                      <strong>{log.acao || "Atividade registrada"}</strong>
                      <p>{log.descricao}</p>
                    </div>
                    <time>{formatarMomento(log.criado_em)}</time>
                  </div>
                );
              })
            )}
          </div>

          <footer className="dashboard-v16-section-note">
            <span>Últimas atividades realizadas no sistema.</span>
            <AppIcon name="clock" size={19} />
          </footer>
        </section>
      </div>
    </section>
  );
}

export default Dashboard;
