import type { UsuarioLista } from "../model";

type Props = {
  usuario: UsuarioLista;
  novaSenha: string;
  setNovaSenha: (valor: string) => void;
  mostrarNovaSenha: boolean;
  setMostrarNovaSenha: React.Dispatch<React.SetStateAction<boolean>>;
  salvandoSenha: boolean;
  erroSenha: string;
  setErroSenha: (valor: string) => void;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
};

export function ModalRedefinirSenha({
  usuario,
  novaSenha,
  setNovaSenha,
  mostrarNovaSenha,
  setMostrarNovaSenha,
  salvandoSenha,
  erroSenha,
  setErroSenha,
  aoFechar,
  aoSalvar,
}: Props) {
  const senhaValida = novaSenha.length >= 8;

  return (
    <div className="modal-overlay">
      <div
        className="modal-novo-aluno settings-password-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-password-modal-title"
        aria-describedby="settings-password-modal-description"
      >
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">SEGURANÇA</span>
            <h2 id="settings-password-modal-title">Redefinir senha</h2>
            <p id="settings-password-modal-description">
              Defina uma nova senha para <strong>{usuario.nome}</strong>.
            </p>
          </div>

          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={salvandoSenha}
            aria-label="Fechar modal de redefinição de senha"
          >
            ×
          </button>
        </div>

        <div className="settings-password-modal-content">
          <label htmlFor="settings-new-password">Nova senha</label>

          <div className="settings-password-field">
            <input
              id="settings-new-password"
              type={mostrarNovaSenha ? "text" : "password"}
              value={novaSenha}
              onChange={(e) => {
                setNovaSenha(e.target.value);
                setErroSenha("");
              }}
              autoComplete="new-password"
              minLength={8}
              autoFocus
              disabled={salvandoSenha}
              aria-invalid={Boolean(erroSenha)}
              aria-describedby={
                erroSenha
                  ? "settings-password-hint settings-password-error"
                  : "settings-password-hint"
              }
            />

            <button
              type="button"
              className="settings-password-toggle"
              onClick={() => setMostrarNovaSenha((valor) => !valor)}
              disabled={salvandoSenha}
              aria-pressed={mostrarNovaSenha}
              aria-label={
                mostrarNovaSenha ? "Ocultar nova senha" : "Mostrar nova senha"
              }
            >
              {mostrarNovaSenha ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          <div
            id="settings-password-hint"
            className={`settings-password-hint ${
              novaSenha.length > 0 && senhaValida ? "is-valid" : ""
            }`}
          >
            {senhaValida
              ? "Senha pronta para ser salva."
              : "Use pelo menos 8 caracteres."}
          </div>

          {erroSenha && (
            <div
              id="settings-password-error"
              className="modal-erro"
              role="alert"
            >
              {erroSenha}
            </div>
          )}
        </div>

        <div className="modal-acoes settings-password-actions">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={salvandoSenha}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="botao-cadastrar"
            onClick={() => void aoSalvar()}
            disabled={salvandoSenha || !senhaValida}
          >
            {salvandoSenha ? "Salvando..." : "Salvar nova senha"}
          </button>
        </div>
      </div>
    </div>
  );
}
