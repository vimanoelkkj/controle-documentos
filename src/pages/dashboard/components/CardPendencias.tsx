type DocumentoCampo =
  | "identidade"
  | "cpf"
  | "certidao"
  | "residencia"
  | "titulo"
  | "ensino_medio"
  | "contrato";

type Pendencia = {
  campo: DocumentoCampo;
  nome: string;
  quantidade: number;
};

type Props = {
  pendencias: Pendencia[];
  total: number;
  pendenciasSelecionadas: DocumentoCampo[];
  quantidadePendenciasExatas: number;
  alternarPendencia: (campo: DocumentoCampo) => void;
  limparPendencias: () => void;
  abrirPendenciasSelecionadas: () => void;
};

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

export function CardPendencias({
  pendencias,
  total,
  pendenciasSelecionadas,
  quantidadePendenciasExatas,
  alternarPendencia,
  limparPendencias,
  abrirPendenciasSelecionadas,
}: Props) {
  const maiorPendencia = pendencias[0];

  return (
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
          const prioritario =
            item.campo === "contrato" || item.campo === "ensino_medio";
          const selecionado = pendenciasSelecionadas.includes(item.campo);

          return (
            <button
              type="button"
              className={`dashboard-bar-row dashboard-nav-bar ${
                prioritario ? "critical " : ""
              }${selecionado ? "selected" : ""}`}
              key={item.campo}
              aria-pressed={selecionado}
              onClick={() => alternarPendencia(item.campo)}
            >
              <div className="dashboard-bar-label">
                <span>
                  {item.nome}
                  {prioritario && (
                    <em className="dashboard-critical-tag">documento crítico</em>
                  )}
                </span>
                <strong>{item.quantidade.toLocaleString("pt-BR")}</strong>
              </div>

              <div className="dashboard-bar-track">
                <div
                  className={`dashboard-bar-fill ${
                    prioritario ? "priority" : ""
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
              onClick={limparPendencias}
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
  );
}
