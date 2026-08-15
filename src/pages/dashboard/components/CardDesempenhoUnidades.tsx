type ComparacaoUnidade = {
  unidade: string;
  total: number;
  completo: number;
  parcial: number;
  critico: number;
};

type Props = {
  unidades: string[];
  comparacaoUnidades: ComparacaoUnidade[];
  abrirUnidade: (unidade: string) => void;
};

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

export function CardDesempenhoUnidades({
  unidades,
  comparacaoUnidades,
  abrirUnidade,
}: Props) {
  return (
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
            onClick={() => abrirUnidade(item.unidade)}
          >
            <strong>{item.unidade}</strong>
            <span>{item.total}</span>
            <span className="complete">{item.completo}</span>
            <span className="partial">{item.parcial}</span>
            <span className="critical">{item.critico}</span>

            <div className="dashboard-stacked">
              <span
                className="complete"
                style={{
                  width: `${percentual(item.completo, item.total)}%`,
                }}
              />

              <span
                className="partial"
                style={{
                  width: `${percentual(item.parcial, item.total)}%`,
                }}
              />

              <span
                className="critical"
                style={{
                  width: `${percentual(item.critico, item.total)}%`,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </article>
  );
}
