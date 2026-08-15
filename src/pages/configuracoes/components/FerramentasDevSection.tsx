import AppSelect from "../../../components/AppSelect";
import type { UnidadeDev } from "../hooks/useFerramentasDev";

type Props = {
  unidadeDev: UnidadeDev;
  setUnidadeDev: (valor: UnidadeDev) => void;
  confirmacaoDev: string;
  setConfirmacaoDev: (valor: string) => void;
  limpandoDev: boolean;
  mensagemDev: string;
  setMensagemDev: (valor: string) => void;
  confirmacaoEsperada: string;
  limparAlunosDev: () => void | Promise<void>;
};

export function FerramentasDevSection({
  unidadeDev,
  setUnidadeDev,
  confirmacaoDev,
  setConfirmacaoDev,
  limpandoDev,
  mensagemDev,
  setMensagemDev,
  confirmacaoEsperada,
  limparAlunosDev,
}: Props) {
  return (
    <section className="settings-dev-tools">
      <div className="settings-dev-tools-head">
        <div>
          <span>AMBIENTE DE DESENVOLVIMENTO</span>
          <h2>Ferramentas de teste</h2>
          <p>
            Limpe alunos do período atual para repetir importações sem mexer em
            usuários, períodos ou configurações.
          </p>
        </div>

        <strong>DEV</strong>
      </div>

      <div className="settings-dev-danger">
        <div className="settings-dev-fields">
          <label>
            Alunos a remover
            <AppSelect
              value={unidadeDev}
              onChange={(valor) => {
                setUnidadeDev(valor as UnidadeDev);
                setConfirmacaoDev("");
                setMensagemDev("");
              }}
              disabled={limpandoDev}
              ariaLabel="Alunos a remover"
              options={[
                { value: "FACE", label: "FACE" },
                { value: "FEA", label: "FEA" },
                { value: "FCH", label: "FCH" },
                { value: "EAD", label: "EAD" },
                { value: "TODOS", label: "TODOS OS ALUNOS" },
              ]}
            />
          </label>

          <label>
            Digite <strong>{confirmacaoEsperada}</strong>
            <input
              value={confirmacaoDev}
              onChange={(e) => setConfirmacaoDev(e.target.value)}
              placeholder={confirmacaoEsperada}
              disabled={limpandoDev}
              autoComplete="off"
            />
          </label>
        </div>

        <button
          type="button"
          className="settings-dev-delete"
          onClick={() => void limparAlunosDev()}
          disabled={
            limpandoDev ||
            confirmacaoDev.trim().toUpperCase() !== confirmacaoEsperada
          }
        >
          {limpandoDev
            ? "Limpando..."
            : unidadeDev === "TODOS"
              ? "☢ Limpar todos os alunos"
              : `⊘ Limpar alunos da ${unidadeDev}`}
        </button>
      </div>

      {mensagemDev && <div className="settings-dev-message">{mensagemDev}</div>}
    </section>
  );
}
