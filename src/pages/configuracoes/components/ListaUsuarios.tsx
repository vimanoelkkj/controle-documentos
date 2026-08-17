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
          <span className="settings-section-eyebrow">ACESSO</span>
          <h2>Usuários</h2>
          <span className="settings-users-count">{usuarios.length} usuários cadastrados</span>
        </div>
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
                Senha
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
                className="settings-role-select"
                menuClassName="settings-role-menu"
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
                {usuario.ativo ? "Desativar" : "Reativar"}
              </button>

              <button
                type="button"
                className="settings-user-delete"
                onClick={() => abrirModalExcluir(usuario)}
              >
                Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
