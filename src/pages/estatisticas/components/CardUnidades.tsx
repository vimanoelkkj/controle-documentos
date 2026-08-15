type UnidadeStats = {
  unidade: string;
  total: number;
  media: number;
  progresso: number;
  completos: number;
  taxaCompleta: number;
  criticos: number;
  taxaCritica: number;
  pendenciasPorAluno: number;
};

type Props = {
  unidades: UnidadeStats[];
};

function numero(valor: number, casas = 0) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function CardUnidades({ unidades }: Props) {
  return (
    <article className="statistics-card statistics-units-card">
      <div className="statistics-card-header">
        <div>
          <span>COMPARATIVO</span>
          <h2>Eficiência documental por unidade</h2>
        </div>

        <small>ordenado por progresso</small>
      </div>

      <div className="statistics-unit-table">
        <div className="statistics-unit-head">
          <span>Unidade</span>
          <span>Alunos</span>
          <span>Média</span>
          <span>Progresso</span>
          <span>7/7</span>
          <span>Críticos</span>
          <span>Pend./aluno</span>
        </div>

        {unidades.map((item) => (
          <div className="statistics-unit-row" key={item.unidade}>
            <strong>{item.unidade}</strong>
            <span>{item.total}</span>
            <span>{numero(item.media, 1)} / 7</span>

            <span className="statistics-unit-progress-cell">
              <span className="statistics-mini-progress">
                <i style={{ width: `${item.progresso}%` }} />
              </span>
              <b>{item.progresso}%</b>
            </span>

            <span className="complete">
              {item.completos} <small>({item.taxaCompleta}%)</small>
            </span>

            <span className="critical">
              {item.criticos} <small>({item.taxaCritica}%)</small>
            </span>

            <span>{numero(item.pendenciasPorAluno, 1)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
