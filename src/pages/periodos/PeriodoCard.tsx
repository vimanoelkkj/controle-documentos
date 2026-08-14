type PeriodoCardProps = {
  periodo: {
    id: number;
    codigo: string;
    status: "ATIVO" | "ARQUIVADO";
    total_alunos: number;
  };
  codigoPeriodoAtual?: string;
  modoApresentacao: boolean;
  processando: boolean;
  aoAbrir: (codigo: string) => void;
  aoAlterarStatus: (dados: {
    id: number;
    codigo: string;
    status: "ATIVO" | "ARQUIVADO";
  }) => void;
};

export function PeriodoCard({
  periodo,
  codigoPeriodoAtual,
  modoApresentacao,
  processando,
  aoAbrir,
  aoAlterarStatus,
}: PeriodoCardProps) {
  const periodoAtual = periodo.codigo === codigoPeriodoAtual;

  return (
    <article className={`period-card ${periodoAtual ? "current" : ""}`}>
      <div>
        <span className={`period-status ${periodo.status.toLowerCase()}`}>
          {periodo.status}
        </span>

        <h3>{periodo.codigo}</h3>

        <p>
          {periodo.total_alunos} aluno
          {periodo.total_alunos === 1 ? "" : "s"} vinculado
          {periodo.total_alunos === 1 ? "" : "s"}
        </p>
      </div>

      <div className="period-actions">
        <button
          type="button"
          onClick={() => aoAbrir(periodo.codigo)}
          disabled={periodoAtual}
        >
          Abrir período
        </button>

        {!modoApresentacao && (
          <button
            type="button"
            className={periodo.status === "ATIVO" ? "danger-soft" : "secondary"}
            onClick={() =>
              aoAlterarStatus({
                id: periodo.id,
                codigo: periodo.codigo,
                status: periodo.status === "ATIVO" ? "ARQUIVADO" : "ATIVO",
              })
            }
            disabled={processando}
          >
            {periodo.status === "ATIVO" ? "Arquivar" : "Reativar"}
          </button>
        )}
      </div>
    </article>
  );
}
