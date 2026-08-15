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
  return (
    <div className="modal-overlay">
      <div className="modal-novo-aluno settings-password-modal">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">SEGURANÇA</span>
            <h2>Redefinir senha</h2>
            <p>
              Defina uma nova senha para <strong>{usuario.nome}</strong>.
            </p>
          </div>

          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={salvandoSenha}
          >
            ×
          </button>
        </div>

        <div className="settings-password-modal-content">
          <label>
            Nova senha
            <div className="settings-password-input">
              <input
                type={mostrarNovaSenha ? "text" : "password"}
                value={novaSenha}
                onChange={(e) => {
                  setNovaSenha(e.target.value);
                  setErroSenha("");
                }}
                autoComplete="new-password"
                disabled={salvandoSenha}
              />

              <button
                type="button"
                onClick={() => setMostrarNovaSenha((valor) => !valor)}
                disabled={salvandoSenha}
              >
                {mostrarNovaSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          {erroSenha && <div className="modal-erro">{erroSenha}</div>}
        </div>

        <div className="modal-acoes">
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
            disabled={salvandoSenha || novaSenha.length < 8}
          >
            {salvandoSenha ? "Salvando..." : "Salvar nova senha"}
          </button>
        </div>
      </div>
    </div>
  );
}
