type Props = {
  novoCodigo: string;
  setNovoCodigo: (valor: string) => void;
  processando: boolean;
  erro?: string;
  limparErro?: () => void;
  criarPeriodo: () => void | Promise<void>;
  formatarCodigoPeriodo: (valor: string) => string;
};

export function CriarPeriodoCard({
  novoCodigo,
  setNovoCodigo,
  processando,
  erro,
  limparErro,
  criarPeriodo,
  formatarCodigoPeriodo,
}: Props) {
  return (
    <section className="period-create-card">
      <div>
        <span>NOVO PERÍODO</span>
        <h2>Criar período letivo</h2>
        <p>
          Use o padrão <strong>AAAA-1</strong> ou <strong>AAAA-2</strong>.
        </p>
      </div>

      <div className="period-create-form">
        <div className="period-create-field">
          <input
            className={erro ? "has-error" : undefined}
            value={novoCodigo}
            onChange={(e) => {
              setNovoCodigo(formatarCodigoPeriodo(e.target.value));
              limparErro?.();
            }}
            onKeyDown={(e) => {
              const input = e.currentTarget;
              const cursorNoFim =
                input.selectionStart === novoCodigo.length &&
                input.selectionEnd === novoCodigo.length;
  
              if (
                e.key === "Backspace" &&
                novoCodigo.endsWith("-") &&
                cursorNoFim
              ) {
                e.preventDefault();
                setNovoCodigo(novoCodigo.slice(0, -2));
              }
            }}
            placeholder="2027-1"
            maxLength={6}
            inputMode="numeric"
            aria-label="Novo período letivo no formato ano e semestre"
            aria-invalid={Boolean(erro)}
            aria-describedby={erro ? "period-create-error" : undefined}
          />
          {erro && (
            <div
              id="period-create-error"
              className="period-create-inline-error"
              role="alert"
            >
              <span aria-hidden="true">!</span>
              <small>{erro}</small>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void criarPeriodo()}
          disabled={processando}
        >
          + Criar período
        </button>
      </div>
    </section>
  );
}
