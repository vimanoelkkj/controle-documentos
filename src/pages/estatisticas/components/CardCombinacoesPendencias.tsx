type CombinacaoPendencia = {
  nomes: string[];
  quantidade: number;
};

type Props = {
  combinacoes: CombinacaoPendencia[];
  maiorCombinacao: number;
};

export function CardCombinacoesPendencias({
  combinacoes,
  maiorCombinacao,
}: Props) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-header">
        <div>
          <span>PADRÕES RECORRENTES</span>
          <h2>Combinações de pendências</h2>
        </div>

        <small>top {combinacoes.length}</small>
      </div>

      <div className="statistics-combination-list">
        {combinacoes.length ? (
          combinacoes.map((grupo, indice) => (
            <div
              className="statistics-combination-row"
              key={grupo.nomes.join("|")}
            >
              <div className="statistics-combination-number">#{indice + 1}</div>

              <div className="statistics-combination-main">
                <div className="statistics-combination-tags">
                  {grupo.nomes.map((nome) => (
                    <span key={nome}>{nome}</span>
                  ))}
                </div>

                <div className="statistics-combination-track">
                  <span
                    style={{
                      width: `${(grupo.quantidade / maiorCombinacao) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <div className="statistics-combination-count">
                <strong>{grupo.quantidade}</strong>
                <small>alunos</small>
              </div>
            </div>
          ))
        ) : (
          <div className="statistics-empty">
            Nenhuma pendência nesta seleção.
          </div>
        )}
      </div>
    </article>
  );
}
