import type { SheetsPrevia } from "./model";

type Props = {
  codigoPeriodo?: string;
  previa: SheetsPrevia;
  mostrarAlteracoes: boolean;
  setMostrarAlteracoes: React.Dispatch<React.SetStateAction<boolean>>;
  sincronizando: boolean;
  aoVoltar: () => void;
  aoConfirmar: () => void | Promise<void>;
};

function statusClass(valor: string) {
  return valor.toLowerCase() === "entregue" ? "is-delivered" : "is-pending";
}

function statusSymbol(valor: string) {
  return valor.toLowerCase() === "entregue" ? "✓" : "✕";
}

export function ModalConfirmarSincronizacao({
  codigoPeriodo,
  previa,
  mostrarAlteracoes,
  setMostrarAlteracoes,
  sincronizando,
  aoVoltar,
  aoConfirmar,
}: Props) {
  return (
    <div className="modal-overlay">
      <section
        className="period-sync-confirm-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <span>SINCRONIZAÇÃO</span>
          <h2>Aplicar Google Sheets?</h2>
          <p>
            As diferenças da prévia serão gravadas no período{" "}
            <strong>{codigoPeriodo}</strong>. Antes de escrever, o servidor lerá
            a planilha novamente.
          </p>
        </header>

        <div className="period-sync-confirm-grid">
          <div className="period-sync-confirm-metric">
            <strong>{previa.novos}</strong>
            <span>Novos</span>
          </div>
          <div className="period-sync-confirm-metric">
            <strong>{previa.alteracoes_cadastrais}</strong>
            <span>Cadastros</span>
          </div>
          <div className="period-sync-confirm-metric">
            <strong>{previa.documentos_alterados}</strong>
            <span>Documentos</span>
          </div>
          <div className="period-sync-confirm-metric">
            <strong>{previa.prontos_para_cancelar}</strong>
            <span>Cancelamentos</span>
          </div>
          <div className="period-sync-confirm-metric">
            <strong>{previa.prontos_para_reativar}</strong>
            <span>Reativações</span>
          </div>
          <div className="period-sync-confirm-metric">
            <strong>{previa.prontos_para_remover}</strong>
            <span>Remoções</span>
          </div>
        </div>

        <div className="period-sync-confirm-details">
          <button
            type="button"
            className="period-sync-confirm-details-toggle"
            onClick={() => setMostrarAlteracoes((atual) => !atual)}
          >
            {mostrarAlteracoes ? "Ocultar alterações" : "Ver alterações"}
          </button>

          {mostrarAlteracoes && (
            <div className="period-sync-confirm-details-content">
              {previa.detalhes.novos.map((item) => (
                <article key={`novo-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <span>RA {item.ra}</span>
                  </div>
                  <div className="period-preview-change">
                    <div>
                      <strong>Novo aluno</strong>
                      <span>
                        {item.curso} · {item.unidade || "Unidade pendente"}
                      </span>
                    </div>
                  </div>
                </article>
              ))}

              {previa.detalhes.cadastros.map((item) => (
                <article key={`cadastro-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <small>RA {item.ra}</small>
                  </div>
                  <div className="period-preview-change">
                    {item.detalhe.split("\n").map((linha) => {
                      const [campo, alteracao] = linha.split(": ");
                      return (
                        <div key={linha}>
                          <strong>{campo}</strong>
                          <span>{alteracao}</span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}

              {previa.detalhes.documentos.map((item) => (
                <article key={`documento-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <small>RA {item.ra}</small>
                  </div>
                  <div className="period-preview-change period-preview-documents">
                    {item.detalhe.split("\n").map((linha) => {
                      const [campo, alteracao = ""] = linha.split(": ");
                      const [origem = "", destino = ""] = alteracao
                        .split("→")
                        .map((valor) => valor.trim());

                      return (
                        <div
                          className="period-preview-document-change"
                          key={linha}
                        >
                          <strong>{campo}</strong>
                          <span className="period-preview-document-status">
                            <span
                              className={`period-preview-status-icon ${statusClass(origem)}`}
                              title={origem}
                              aria-label={origem}
                            >
                              {statusSymbol(origem)}
                            </span>
                            <span className="period-preview-status-arrow">
                              →
                            </span>
                            <span
                              className={`period-preview-status-icon ${statusClass(destino)}`}
                              title={destino}
                              aria-label={destino}
                            >
                              {statusSymbol(destino)}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}

              {previa.detalhes.cancelamentos.map((item) => (
                <article key={`cancelamento-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <span>RA {item.ra}</span>
                  </div>
                  <div className="period-preview-change">
                    <div>
                      <strong>Cancelamento</strong>
                      <span>Ativo → Cancelado · Unidade {item.unidade}</span>
                    </div>
                  </div>
                </article>
              ))}

              {previa.detalhes.reativacoes.map((item) => (
                <article key={`reativacao-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <small>RA {item.ra}</small>
                  </div>
                  <div className="period-preview-change">
                    <div>
                      <strong>Reativação</strong>
                      <span>Cancelado → Ativo · Unidade {item.unidade}</span>
                    </div>
                  </div>
                </article>
              ))}

              {previa.detalhes.remocoes.map((item) => (
                <article key={`remocao-${item.ra}`}>
                  <div>
                    <strong>{item.nome}</strong>
                    <small>RA {item.ra}</small>
                  </div>
                  <div className="period-preview-change">
                    <div>
                      <strong>Remoção</strong>
                      <span>Ausente da planilha · Unidade {item.unidade}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer>
          <div className="period-sync-confirm-note">
            <strong>Importante:</strong> esta operação altera o banco do sistema
            e será registrada no LOG.
          </div>
          <div className="period-sync-confirm-buttons">
            <button
              type="button"
              className="period-sync-back-button"
              onClick={aoVoltar}
              disabled={sincronizando}
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={aoConfirmar}
              disabled={sincronizando}
            >
              {sincronizando ? "Sincronizando..." : "Confirmar sincronização"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
