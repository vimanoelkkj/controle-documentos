type Resumo = {
  completo: number;
  parcial: number;
  critico: number;
};

type ParteDonut = {
  chave: string;
  valor: number;
  classe: string;
  comprimento: number;
  deslocamento: number;
};

type Donut = {
  raio: number;
  circunferencia: number;
  partes: ParteDonut[];
};

type Props = {
  total: number;
  taxaCompleta: number;
  resumo: Resumo;
  donut: Donut;
  abrirConferencia: (filtros?: {
    docStatus?: "COMPLETO" | "PARCIAL" | "CRITICO";
  }) => void;
};

export function CardStatusDocumental({
  total,
  taxaCompleta,
  resumo,
  donut,
  abrirConferencia,
}: Props) {
  return (
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
  );
}
