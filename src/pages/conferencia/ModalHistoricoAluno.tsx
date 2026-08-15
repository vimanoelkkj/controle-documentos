import type { Aluno, HistoricoLog } from "./model";
import { classeAcaoHistorico, formatarDataHistorico } from "./utils";

type ModalHistoricoAlunoProps = {
  aberto: boolean;
  aluno: Aluno;
  historico: HistoricoLog[];
  carregando: boolean;
  erro: string;
  possivelmenteLimitado: boolean;
  aoAtualizar: () => void;
  aoFechar: () => void;
};

export function ModalHistoricoAluno({
  aberto,
  aluno,
  historico,
  carregando,
  erro,
  possivelmenteLimitado,
  aoAtualizar,
  aoFechar,
}: ModalHistoricoAlunoProps) {
  if (!aberto) return null;

  return (
    <div className="modal-overlay">
      <section
        className="student-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-history-title"
      >
        <header className="student-history-header">
          <div className="student-history-heading">
            <div className="student-history-icon">↺</div>
            <div>
              <span>HISTÓRICO DO ALUNO</span>
              <h2 id="student-history-title">{aluno.nome}</h2>
              <p>
                RA {aluno.ra} · {aluno.unidade} · {aluno.curso}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="student-history-close"
            onClick={aoFechar}
            aria-label="Fechar histórico"
          >
            ×
          </button>
        </header>

        <div className="student-history-toolbar">
          <div>
            <strong>{historico.length}</strong>
            <span>
              {historico.length === 1
                ? " ocorrência encontrada"
                : " ocorrências encontradas"}
            </span>
          </div>
          <button type="button" onClick={aoAtualizar} disabled={carregando}>
            {carregando ? "Atualizando..." : "↻ Atualizar"}
          </button>
        </div>

        <div className="student-history-content">
          {carregando && historico.length === 0 ? (
            <div className="student-history-state">
              <div className="student-history-spinner" />
              <strong>Carregando histórico...</strong>
              <span>Buscando registros deste período letivo.</span>
            </div>
          ) : erro ? (
            <div className="student-history-state error">
              <strong>Não foi possível carregar o histórico.</strong>
              <span>{erro}</span>
              <button type="button" onClick={aoAtualizar}>
                Tentar novamente
              </button>
            </div>
          ) : historico.length === 0 ? (
            <div className="student-history-state">
              <div className="student-history-empty-icon">○</div>
              <strong>Nenhum registro encontrado</strong>
              <span>As próximas alterações feitas neste aluno aparecerão aqui.</span>
            </div>
          ) : (
            <div className="student-history-timeline">
              {historico.map((registro) => (
                <article className="student-history-item" key={registro.id}>
                  <div
                    className={`student-history-marker ${classeAcaoHistorico(
                      registro.acao,
                    )}`}
                  />
                  <div className="student-history-event">
                    <div className="student-history-event-top">
                      <span
                        className={`student-history-action ${classeAcaoHistorico(
                          registro.acao,
                        )}`}
                      >
                        {registro.acao}
                      </span>
                      <div className="student-history-meta">
                        <span className="student-history-user">
                          {registro.usuario_nome
                            ? `${registro.usuario_nome}${
                                registro.usuario_username
                                  ? ` · @${registro.usuario_username}`
                                  : ""
                              }`
                            : "Usuário não registrado"}
                        </span>
                        <time>{formatarDataHistorico(registro.criado_em)}</time>
                      </div>
                    </div>
                    <p>{registro.descricao}</p>
                    {registro.unidade && (
                      <small>Unidade {registro.unidade}</small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {possivelmenteLimitado && (
          <div className="student-history-limit">
            Exibindo ocorrências encontradas entre os 500 registros mais
            recentes deste período.
          </div>
        )}

        <footer className="student-history-footer">
          <span>Somente leitura · dados do LOG do período atual</span>
          <button type="button" onClick={aoFechar}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
