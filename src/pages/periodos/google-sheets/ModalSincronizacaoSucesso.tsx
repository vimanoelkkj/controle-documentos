import type { SheetsResultadoSync } from "../hooks/useGoogleSheetsPeriodo";

type Props = {
  codigoPeriodo?: string;
  resultado: SheetsResultadoSync;
  aoFechar: () => void;
};

export function ModalSincronizacaoSucesso({
  codigoPeriodo,
  resultado,
  aoFechar,
}: Props) {
  return (
    <div className="modal-overlay">
      <div
        className="modal-importacao-sucesso sheets-sync-success-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheets-sync-success-title"
      >
        <div className="importacao-sucesso-conteudo">
          <div className="importacao-sucesso-icone">✓</div>

          <span className="modal-eyebrow">SINCRONIZAÇÃO CONCLUÍDA</span>
          <h2 id="sheets-sync-success-title">
            Google Planilhas sincronizado com sucesso
          </h2>

          <p>
            A sincronização do período <strong>{codigoPeriodo ?? "—"}</strong>{" "}
            foi concluída.
          </p>

          <div className="importacao-sucesso-resumo sheets-sync-success-resumo">
            <div>
              <strong>{resultado.novos}</strong>
              <span>novos</span>
            </div>
            <div>
              <strong>{resultado.alteracoes_cadastrais}</strong>
              <span>cadastros</span>
            </div>
            <div>
              <strong>{resultado.documentos_alterados}</strong>
              <span>documentos</span>
            </div>
            <div>
              <strong>{resultado.cancelamentos}</strong>
              <span>cancelamentos</span>
            </div>
            <div>
              <strong>{resultado.reativacoes}</strong>
              <span>reativações</span>
            </div>
            <div>
              <strong>{resultado.remocoes}</strong>
              <span>remoções</span>
            </div>
          </div>

          <small className="sheets-sync-success-total">
            {resultado.total_operacoes} operação(ões) aplicada(s) ao sistema
          </small>
        </div>

        <div className="modal-acoes importacao-sucesso-acoes">
          <button
            type="button"
            className="botao-cadastrar"
            onClick={aoFechar}
            autoFocus
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
