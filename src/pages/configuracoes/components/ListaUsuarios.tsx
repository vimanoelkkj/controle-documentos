import AppSelect from "../../../components/AppSelect";
import type { UsuarioLista } from "../model";

type Props = {
  usuarios: UsuarioLista[];
  alterarUsuario: (
    id: number,
    dados: Record<string, unknown>,
  ) => void | Promise<void>;
  abrirModalSenha: (usuario: UsuarioLista) => void;
  abrirModalExcluir: (usuario: UsuarioLista) => void;
};

export function ListaUsuarios({
  usuarios,
  alterarUsuario,
  abrirModalSenha,
  abrirModalExcluir,
}: Props) {
  return (
    <>
      <div className="settings-users-head">
        <div>
          <span>ACESSO</span>
          <h2>Usuários</h2>
        </div>

        <strong>{usuarios.length}</strong>
      </div>

      <div className="settings-users-grid">
        {usuarios.map((usuario) => (
          <article
            key={usuario.id}
            className={!usuario.ativo ? "disabled" : ""}
          >
            <div className="settings-user-main">
              <div className="sidebar-user-avatar">{usuario.nome[0]}</div>

              <div>
                <strong>{usuario.nome}</strong>
                <span>
                  @{usuario.username} · {usuario.email}
                </span>
              </div>
            </div>

            <div className="settings-user-actions">
              <button
                type="button"
                className="settings-password-button"
                onClick={() => abrirModalSenha(usuario)}
              >
                ⌘ Senha
              </button>

              <AppSelect
                value={
                  usuario.modo_apresentacao ? "APRESENTACAO" : usuario.perfil
                }
                onChange={(valor) => {
                  if (valor === "APRESENTACAO") {
                    void alterarUsuario(usuario.id, {
                      perfil: "VISUALIZADOR",
                      modo_apresentacao: true,
                    });

                    return;
                  }

                  void alterarUsuario(usuario.id, {
                    perfil: valor,
                    modo_apresentacao: false,
                  });
                }}
                ariaLabel={`Perfil de ${usuario.nome}`}
                options={[
                  { value: "ADMIN", label: "ADMIN" },
                  { value: "EDITOR", label: "EDITOR" },
                  {
                    value: "VISUALIZADOR",
                    label: "VISUALIZADOR",
                  },
                  {
                    value: "APRESENTACAO",
                    label: "APRESENTAÇÃO",
                  },
                ]}
              />

              <button
                type="button"
                className={`settings-user-toggle ${
                  usuario.ativo ? "deactivate" : "reactivate"
                }`}
                onClick={() =>
                  void alterarUsuario(usuario.id, {
                    ativo: !usuario.ativo,
                  })
                }
              >
                <span aria-hidden="true">{usuario.ativo ? "⊘" : "↻"}</span>

                {usuario.ativo ? "Desativar" : "Reativar"}
              </button>

              <button
                type="button"
                className="settings-user-delete"
                onClick={() => abrirModalExcluir(usuario)}
              >
                <span aria-hidden="true">×</span>
                Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
