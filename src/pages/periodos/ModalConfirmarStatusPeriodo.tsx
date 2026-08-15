type ConfirmacaoPeriodo = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
};

type Props = {
  confirmacao: ConfirmacaoPeriodo;
  processando: boolean;
  aoFechar: () => void;
  aoConfirmar: (
    id: number,
    status: "ATIVO" | "ARQUIVADO",
  ) => void | Promise<void>;
};

export function ModalConfirmarStatusPeriodo({
  confirmacao,
  processando,
  aoFechar,
  aoConfirmar,
}: Props) {
  const arquivando = confirmacao.status === "ARQUIVADO";

  return (
    <div
      className="modal-overlay"
      onMouseDown={() => !processando && aoFechar()}
    >
      <div
        className="period-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="period-confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">PERÍODOS LETIVOS</span>

            <h2 id="period-confirm-title">
              {arquivando ? "Arquivar período?" : "Reativar período?"}
            </h2>

            <p>
              {arquivando ? (
                <>
                  O período <strong>{confirmacao.codigo}</strong> sairá da
                  operação diária, mas continuará acessível e poderá ser editado
                  quando necessário.
                </>
              ) : (
                <>
                  O período <strong>{confirmacao.codigo}</strong> voltará para a
                  lista de períodos ativos e poderá ser usado normalmente.
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={processando}
          >
            ×
          </button>
        </div>

        <div className="modal-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={processando}
          >
            Cancelar
          </button>

          <button
            type="button"
            className={arquivando ? "period-confirm-danger" : "botao-cadastrar"}
            onClick={() => void aoConfirmar(confirmacao.id, confirmacao.status)}
            disabled={processando}
          >
            {processando
              ? "Processando..."
              : arquivando
                ? "Arquivar período"
                : "Reativar período"}
          </button>
        </div>
      </div>
    </div>
  );
}
