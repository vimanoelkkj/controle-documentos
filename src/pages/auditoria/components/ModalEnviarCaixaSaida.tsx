type CaixaSaidaResumo = {
  atualizar: number;
  remover: number;
  total: number;
};

type Props = {
  caixaSaida: CaixaSaidaResumo;
  periodoCodigo?: string | null;
  confirmacaoEnvio: string;
  setConfirmacaoEnvio: (valor: string) => void;
  enviandoCaixa: boolean;
  aoFechar: () => void;
  aoEnviar: () => void | Promise<void>;
};

export function ModalEnviarCaixaSaida({
  caixaSaida,
  periodoCodigo,
  confirmacaoEnvio,
  setConfirmacaoEnvio,
  enviandoCaixa,
  aoFechar,
  aoEnviar,
}: Props) {
  const confirmacaoValida =
    confirmacaoEnvio.trim().toUpperCase() === "SINCRONIZAR";

  return (
    <div className="modal-overlay">
      <div className="modal-novo-aluno audit-sync-modal">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">SISTEMA → GOOGLE SHEETS</span>

            <h2>Confirmar escrita na planilha</h2>

            <p>
              O sistema relerá as seis abas e bloqueará conflitos antes de
              escrever.
            </p>
          </div>

          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={enviandoCaixa}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="audit-sync-content">
          <div className="audit-sync-summary">
            <article>
              <span>A atualizar</span>
              <strong>{caixaSaida.atualizar}</strong>
            </article>

            <article>
              <span>A remover</span>
              <strong>{caixaSaida.remover}</strong>
            </article>

            <article>
              <span>Total</span>
              <strong>{caixaSaida.total}</strong>
            </article>
          </div>

          <div className="audit-sync-warning">
            <strong>Alteração externa</strong>

            <span>
              A operação modificará a planilha configurada para o período{" "}
              {periodoCodigo || "atual"}. RAs duplicados, abas trocadas e
              cabeçalhos incompatíveis serão bloqueados.
            </span>
          </div>

          <label className="audit-sync-confirm">
            <span>
              Digite <b>SINCRONIZAR</b> para confirmar
            </span>

            <input
              value={confirmacaoEnvio}
              onChange={(event) => setConfirmacaoEnvio(event.target.value)}
              autoComplete="off"
              autoFocus
              disabled={enviandoCaixa}
            />
          </label>
        </div>

        <div className="modal-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={enviandoCaixa}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="audit-sync-confirm-button"
            onClick={() => void aoEnviar()}
            disabled={enviandoCaixa || !confirmacaoValida}
          >
            {enviandoCaixa ? "Validando e enviando..." : "Confirmar envio"}
          </button>
        </div>
      </div>
    </div>
  );
}
