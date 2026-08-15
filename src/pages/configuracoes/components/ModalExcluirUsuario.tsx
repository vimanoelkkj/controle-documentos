import type { UsuarioLista } from "../model";

type Props = {
  usuario: UsuarioLista;
  confirmacaoExcluir: string;
  setConfirmacaoExcluir: (valor: string) => void;
  excluindoUsuario: boolean;
  erroExcluir: string;
  setErroExcluir: (valor: string) => void;
  aoFechar: () => void;
  aoExcluir: () => void | Promise<void>;
};

export function ModalExcluirUsuario({
  usuario,
  confirmacaoExcluir,
  setConfirmacaoExcluir,
  excluindoUsuario,
  erroExcluir,
  setErroExcluir,
  aoFechar,
  aoExcluir,
}: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal-novo-aluno settings-delete-user-modal">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">CONTROLE DE ACESSO</span>
            <h2>Excluir usuário</h2>

            <p>
              Você está prestes a excluir permanentemente{" "}
              <strong>{usuario.nome}</strong>.
            </p>
          </div>

          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={excluindoUsuario}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="settings-delete-user-content">
          <div className="settings-delete-user-target">
            <div className="sidebar-user-avatar">{usuario.nome[0]}</div>

            <div>
              <strong>{usuario.nome}</strong>
              <span>
                @{usuario.username} · {usuario.email}
              </span>
            </div>
          </div>

          <div className="settings-delete-user-warning">
            <strong>Esta ação não poderá ser desfeita.</strong>

            <span>
              O acesso será removido e todas as sessões desse usuário serão
              encerradas. Os registros históricos de auditoria serão
              preservados.
            </span>
          </div>

          <div className="settings-delete-user-confirm">
            <div className="settings-delete-user-confirm-copy">
              <strong>Confirmação de segurança</strong>
              <span>
                Digite <b>EXCLUIR</b> abaixo para confirmar a exclusão.
              </span>
            </div>

            <input
              value={confirmacaoExcluir}
              onChange={(e) => {
                setConfirmacaoExcluir(e.target.value);
                setErroExcluir("");
              }}
              placeholder="Digite EXCLUIR"
              autoComplete="off"
              autoFocus
              disabled={excluindoUsuario}
            />
          </div>

          {erroExcluir && <div className="modal-erro">{erroExcluir}</div>}
        </div>

        <div className="modal-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={excluindoUsuario}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="settings-delete-user-confirm-button"
            disabled={
              excluindoUsuario ||
              confirmacaoExcluir.trim().toUpperCase() !== "EXCLUIR"
            }
            onClick={() => void aoExcluir()}
          >
            {excluindoUsuario ? "Excluindo..." : "Excluir permanentemente"}
          </button>
        </div>
      </div>
    </div>
  );
}
