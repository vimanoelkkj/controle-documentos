import type { HistoricoComunicacao } from "../model";

type Props = {
  historico: HistoricoComunicacao[];
  historicoErro: string;
  aoAtualizar: () => void | Promise<void>;
};

export function HistoricoComunicacoes({
  historico,
  historicoErro,
  aoAtualizar,
}: Props) {
  return (
    <section className="communication-history">
      <div className="communication-history-header">
        <div>
          <span>HISTÓRICO DE COBRANÇAS</span>
          <strong>Últimos registros</strong>
        </div>

        <button type="button" onClick={() => void aoAtualizar()}>
          Atualizar
        </button>
      </div>

      {historicoErro ? (
        <div className="communication-history-error">{historicoErro}</div>
      ) : historico.length === 0 ? (
        <div className="communication-history-empty">
          Nenhuma cobrança registrada ainda.
        </div>
      ) : (
        <div className="communication-history-list">
          {historico.map((registro) => (
            <article key={registro.id} className="communication-history-item">
              <div>
                <strong>
                  {registro.documentos.length === 7
                    ? "Todos os documentos"
                    : registro.documentos.join(" + ")}
                </strong>

                <span>
                  {registro.unidade === "TODAS"
                    ? "Todas as unidades"
                    : registro.unidade}
                  {" • "}
                  {new Date(registro.criado_em).toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="communication-history-numbers">
                <strong>{registro.quantidade_alunos}</strong>
                <span>alunos</span>
              </div>

              <div className="communication-history-numbers">
                <strong>{registro.quantidade_emails}</strong>
                <span>e-mails</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
