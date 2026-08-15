import { PeriodoCard } from "./PeriodoCard";

type PeriodoLista = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  total_alunos: number;
};

type DadosAlteracaoStatus = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
};

type Props = {
  tipo: "ativos" | "arquivados";
  periodos: PeriodoLista[];
  codigoPeriodoAtual?: string;
  modoApresentacao: boolean;
  processando: boolean;
  aoAbrir: (codigo: string) => void | Promise<void>;
  aoAlterarStatus: (dados: DadosAlteracaoStatus) => void;
};

export function ListaPeriodos({
  tipo,
  periodos,
  codigoPeriodoAtual,
  modoApresentacao,
  processando,
  aoAbrir,
  aoAlterarStatus,
}: Props) {
  const arquivados = tipo === "arquivados";

  return (
    <section
      className={`period-section ${
        arquivados ? `archived ${periodos.length === 0 ? "empty" : ""}` : ""
      }`}
    >
      <div className="period-section-header">
        <div>
          <span>{arquivados ? "HISTÓRICO" : "OPERAÇÃO"}</span>
          <h2>{arquivados ? "Períodos arquivados" : "Períodos ativos"}</h2>
        </div>

        <strong>{periodos.length}</strong>
      </div>

      {periodos.length > 0 ? (
        <div className="period-list">
          {periodos.map((periodo) => (
            <PeriodoCard
              key={periodo.id}
              periodo={periodo}
              codigoPeriodoAtual={codigoPeriodoAtual}
              modoApresentacao={modoApresentacao}
              processando={processando}
              aoAbrir={aoAbrir}
              aoAlterarStatus={aoAlterarStatus}
            />
          ))}
        </div>
      ) : arquivados ? (
        <div className="period-empty">
          <div className="period-empty-icon" aria-hidden="true">
            ◷
          </div>

          <strong>Nenhum período arquivado</strong>

          <p>
            Quando um período for arquivado, ele continuará disponível aqui para
            consulta, edição ou reativação.
          </p>
        </div>
      ) : null}
    </section>
  );
}
