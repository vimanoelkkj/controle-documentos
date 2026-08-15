type StatusDocumental = "COMPLETO" | "PARCIAL" | "CRITICO";

type Resumo = {
  completo: number;
  parcial: number;
  critico: number;
  documentosEntregues: number;
  documentosPossiveis: number;
};

type Props = {
  total: number;
  unidade: string;
  resumo: Resumo;
  taxaCompleta: number;
  progressoGeral: number;
  percentualCritico: number;
  abrirConferencia: (filtros?: { docStatus?: StatusDocumental }) => void;
};

export function DashboardKpis({
  total,
  unidade,
  resumo,
  taxaCompleta,
  progressoGeral,
  percentualCritico,
  abrirConferencia,
}: Props) {
  return (
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
        <small>{percentualCritico}% dos alunos</small>
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
  );
}
