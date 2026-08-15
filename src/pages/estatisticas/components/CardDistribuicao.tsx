type ItemDistribuicao = {
  entregues: number;
  quantidade: number;
};

type Props = {
  distribuicao: ItemDistribuicao[];
  maiorFaixa: number;
  totalAlunos: number;
};

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

function numero(valor: number) {
  return valor.toLocaleString("pt-BR");
}

export function CardDistribuicao({
  distribuicao,
  maiorFaixa,
  totalAlunos,
}: Props) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-header">
        <div>
          <span>DISTRIBUIÇÃO</span>
          <h2>Quantidade de documentos por aluno</h2>
        </div>
        <small>{numero(totalAlunos)} alunos ativos</small>
      </div>

      <div
        className="statistics-histogram"
        aria-label="Distribuição de documentos entregues"
      >
        {distribuicao.map((item) => (
          <div className="statistics-histogram-column" key={item.entregues}>
            <div className="statistics-histogram-value">{item.quantidade}</div>

            <div className="statistics-histogram-track">
              <div
                className={`statistics-histogram-bar ${
                  item.entregues === 7
                    ? "complete"
                    : item.entregues === 0
                      ? "critical"
                      : ""
                }`}
                style={{
                  height: `${Math.max(
                    item.quantidade ? 8 : 0,
                    (item.quantidade / maiorFaixa) * 100,
                  )}%`,
                }}
              />
            </div>

            <strong>{item.entregues}/7</strong>
            <small>{percentual(item.quantidade, totalAlunos)}%</small>
          </div>
        ))}
      </div>
    </article>
  );
}
