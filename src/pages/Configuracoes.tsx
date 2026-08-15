import AppIcon from "../components/AppIcon";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth, type Perfil } from "../contexts/auth";
import AppSelect from "../components/AppSelect";
import { api } from "../lib/api";
import { useBackup } from "./configuracoes/hooks/useBackup";
import { BackupSection } from "./configuracoes/components/BackupSection";
import { useFerramentasDev } from "./configuracoes/hooks/useFerramentasDev";
import { FerramentasDevSection } from "./configuracoes/components/FerramentasDevSection";
import { useRedefinirSenha } from "./configuracoes/hooks/useRedefinirSenha";
import { ModalRedefinirSenha } from "./configuracoes/components/ModalRedefinirSenha";
import type { UsuarioLista } from "./configuracoes/model";

function Configuracoes() {
  const { admin } = useAuth();

  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("VISUALIZADOR");
  const [modoApresentacao, setModoApresentacao] = useState(false);
  const [erro, setErro] = useState("");

  const {
    usuarioSenha,
    novaSenha,
    setNovaSenha,
    mostrarNovaSenha,
    setMostrarNovaSenha,
    salvandoSenha,
    erroSenha,
    setErroSenha,
    abrirModalSenha,
    fecharModalSenha,
    salvarNovaSenha,
  } = useRedefinirSenha();
  const [usuarioExcluir, setUsuarioExcluir] = useState<UsuarioLista | null>(
    null,
  );
  const [confirmacaoExcluir, setConfirmacaoExcluir] = useState("");
  const [excluindoUsuario, setExcluindoUsuario] = useState(false);
  const [erroExcluir, setErroExcluir] = useState("");

  const {
    devHabilitado,
    unidadeDev,
    setUnidadeDev,
    confirmacaoDev,
    setConfirmacaoDev,
    limpandoDev,
    mensagemDev,
    setMensagemDev,
    verificarFerramentasDev,
    confirmacaoEsperada,
    limparAlunosDev,
  } = useFerramentasDev({ admin });
  const {
    backupConfigurado,
    gerandoBackup,
    erroBackup,
    backupGerado,
    verificarBackup,
    gerarBackup,
  } = useBackup({ admin });

  const carregar = useCallback(async () => {
    if (!admin) return;

    try {
      setUsuarios(await api.get<UsuarioLista[]>("/api/usuarios"));
    } catch (erro) {
      setErro(
        erro instanceof Error ? erro.message : "Erro ao carregar usuários.",
      );
    }
  }, [admin]);

  useEffect(() => {
    void carregar();
    void verificarFerramentasDev();
    void verificarBackup();
  }, [carregar, verificarFerramentasDev, verificarBackup]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro("");

    try {
      await api.post<{ sucesso: boolean; id: number }>("/api/usuarios", {
        nome,
        username,
        email,
        senha,
        perfil: modoApresentacao ? "VISUALIZADOR" : perfil,
        modo_apresentacao: modoApresentacao,
      });
    } catch (erro) {
      setErro(erro instanceof Error ? erro.message : "Erro ao criar usuário.");
      return;
    }

    setNome("");
    setUsername("");
    setEmail("");
    setSenha("");
    setPerfil("VISUALIZADOR");
    setModoApresentacao(false);
    void carregar();
  }

  async function alterar(id: number, dados: Record<string, unknown>) {
    try {
      await api.put<{ sucesso: boolean }>(`/api/usuarios/${id}`, dados);
    } catch (erro) {
      setErro(
        erro instanceof Error ? erro.message : "Erro ao alterar usuário.",
      );
      return;
    }

    void carregar();
  }

  async function excluirUsuario() {
    if (!usuarioExcluir) return;

    if (confirmacaoExcluir.trim().toUpperCase() !== "EXCLUIR") {
      return;
    }

    setExcluindoUsuario(true);
    setErroExcluir("");

    try {
      await api.delete<{ sucesso: boolean }>(
        `/api/usuarios/${usuarioExcluir.id}`,
      );

      setUsuarioExcluir(null);
      setConfirmacaoExcluir("");
      setErroExcluir("");

      await carregar();
    } catch (erro) {
      setErroExcluir(
        erro instanceof Error
          ? erro.message
          : "Não foi possível excluir o usuário.",
      );
    } finally {
      setExcluindoUsuario(false);
    }
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <span>SISTEMA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="settings" size={22} />
            </span>
            <h1>Configurações</h1>
          </div>
          <p>Preferências, integrações e controle de acesso.</p>
        </div>
      </header>

      {!admin ? (
        <div className="settings-readonly">
          O gerenciamento de usuários é exclusivo para administradores.
        </div>
      ) : (
        <>
          <div className="settings-users-head">
            <div>
              <span>ACESSO</span>
              <h2>Usuários</h2>
            </div>
            <strong>{usuarios.length}</strong>
          </div>

          <div className="settings-users-grid">
            {usuarios.map((u) => (
              <article key={u.id} className={!u.ativo ? "disabled" : ""}>
                <div className="settings-user-main">
                  <div className="sidebar-user-avatar">{u.nome[0]}</div>
                  <div>
                    <strong>{u.nome}</strong>
                    <span>
                      @{u.username} · {u.email}
                    </span>
                  </div>
                </div>

                <div className="settings-user-actions">
                  <button
                    type="button"
                    className="settings-password-button"
                    onClick={() => {
                      abrirModalSenha(u);
                    }}
                  >
                    ⌁ Senha
                  </button>

                  <AppSelect
                    value={u.modo_apresentacao ? "APRESENTACAO" : u.perfil}
                    onChange={(valor) => {
                      if (valor === "APRESENTACAO") {
                        void alterar(u.id, {
                          perfil: "VISUALIZADOR",
                          modo_apresentacao: true,
                        });
                        return;
                      }

                      void alterar(u.id, {
                        perfil: valor,
                        modo_apresentacao: false,
                      });
                    }}
                    ariaLabel={`Perfil de ${u.nome}`}
                    options={[
                      { value: "ADMIN", label: "ADMIN" },
                      { value: "EDITOR", label: "EDITOR" },
                      { value: "VISUALIZADOR", label: "VISUALIZADOR" },
                      { value: "APRESENTACAO", label: "APRESENTAÇÃO" },
                    ]}
                  />

                  <button
                    type="button"
                    className={`settings-user-toggle ${
                      u.ativo ? "deactivate" : "reactivate"
                    }`}
                    onClick={() => alterar(u.id, { ativo: !u.ativo })}
                  >
                    <span aria-hidden="true">{u.ativo ? "⊘" : "↻"}</span>
                    {u.ativo ? "Desativar" : "Reativar"}
                  </button>

                  <button
                    type="button"
                    className="settings-user-delete"
                    onClick={() => {
                      setUsuarioExcluir(u);
                      setConfirmacaoExcluir("");
                      setErroExcluir("");
                    }}
                  >
                    <span aria-hidden="true">×</span>
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>

          <form className="settings-user-form" onSubmit={criar}>
            <div>
              <span>NOVO USUÁRIO</span>
              <h2>Criar acesso</h2>
            </div>

            <label>
              Nome
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
              />
            </label>

            <label>
              Usuário
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                placeholder="ex.: vitormanoel"
                required
              />
            </label>

            <label>
              E-mail
              <div className="settings-email-simple">
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@fumec.edu.br"
                  list="email-dominios"
                  required
                />
                <datalist id="email-dominios">
                  <option value="@fumec.edu.br" />
                  <option value="@gmail.com" />
                </datalist>
              </div>
            </label>

            <label>
              Senha inicial
              <input
                type="password"
                minLength={8}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </label>

            <label>
              Perfil
              <AppSelect
                value={modoApresentacao ? "APRESENTACAO" : perfil}
                onChange={(valor) => {
                  if (valor === "APRESENTACAO") {
                    setPerfil("VISUALIZADOR");
                    setModoApresentacao(true);
                    return;
                  }

                  setPerfil(valor as Perfil);
                  setModoApresentacao(false);
                }}
                ariaLabel="Perfil do novo usuário"
                options={[
                  { value: "VISUALIZADOR", label: "Visualizador" },
                  { value: "EDITOR", label: "Editor" },
                  { value: "ADMIN", label: "Administrador" },
                  { value: "APRESENTACAO", label: "Apresentação" },
                ]}
              />
            </label>

            {erro && <div className="login-error">{erro}</div>}

            <button type="submit">Criar usuário</button>
          </form>

          <BackupSection
            backupConfigurado={backupConfigurado}
            gerandoBackup={gerandoBackup}
            erroBackup={erroBackup}
            backupGerado={backupGerado}
            gerarBackup={gerarBackup}
          />
          {devHabilitado && (
            <FerramentasDevSection
              unidadeDev={unidadeDev}
              setUnidadeDev={setUnidadeDev}
              confirmacaoDev={confirmacaoDev}
              setConfirmacaoDev={setConfirmacaoDev}
              limpandoDev={limpandoDev}
              mensagemDev={mensagemDev}
              setMensagemDev={setMensagemDev}
              confirmacaoEsperada={confirmacaoEsperada}
              limparAlunosDev={limparAlunosDev}
            />
          )}
        </>
      )}
      {usuarioSenha && (
        <ModalRedefinirSenha
          usuario={usuarioSenha}
          novaSenha={novaSenha}
          setNovaSenha={setNovaSenha}
          mostrarNovaSenha={mostrarNovaSenha}
          setMostrarNovaSenha={setMostrarNovaSenha}
          salvandoSenha={salvandoSenha}
          erroSenha={erroSenha}
          setErroSenha={setErroSenha}
          aoFechar={fecharModalSenha}
          aoSalvar={salvarNovaSenha}
        />
      )}
      {usuarioExcluir && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno settings-delete-user-modal">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">CONTROLE DE ACESSO</span>
                <h2>Excluir usuário</h2>

                <p>
                  Você está prestes a excluir permanentemente{" "}
                  <strong>{usuarioExcluir.nome}</strong>.
                </p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={() => setUsuarioExcluir(null)}
                disabled={excluindoUsuario}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="settings-delete-user-content">
              <div className="settings-delete-user-target">
                <div className="sidebar-user-avatar">
                  {usuarioExcluir.nome[0]}
                </div>

                <div>
                  <strong>{usuarioExcluir.nome}</strong>
                  <span>
                    @{usuarioExcluir.username} · {usuarioExcluir.email}
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
                onClick={() => setUsuarioExcluir(null)}
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
                onClick={() => void excluirUsuario()}
              >
                {excluindoUsuario ? "Excluindo..." : "Excluir permanentemente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Configuracoes;
