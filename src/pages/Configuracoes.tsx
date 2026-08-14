import AppIcon from "../components/AppIcon";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth, type Perfil } from "../contexts/auth";
import AppSelect from "../components/AppSelect";
import { api } from "../lib/api";

type UsuarioLista = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: Perfil;
  ativo: number;
  modo_apresentacao: number;
  criado_em: string;
};

type UnidadeDev = "FACE" | "FEA" | "FCH" | "EAD" | "TODOS";

type BackupGerado = {
  arquivo: string;
  download_url: string;
  expira_em_segundos: number;
};

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

  const [usuarioSenha, setUsuarioSenha] = useState<UsuarioLista | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState("");
  const [usuarioExcluir, setUsuarioExcluir] = useState<UsuarioLista | null>(
    null
  );
  const [confirmacaoExcluir, setConfirmacaoExcluir] = useState("");
  const [excluindoUsuario, setExcluindoUsuario] = useState(false);
  const [erroExcluir, setErroExcluir] = useState("");

  const [devHabilitado, setDevHabilitado] = useState(false);
  const [unidadeDev, setUnidadeDev] = useState<UnidadeDev>("FCH");
  const [confirmacaoDev, setConfirmacaoDev] = useState("");
  const [limpandoDev, setLimpandoDev] = useState(false);
  const [mensagemDev, setMensagemDev] = useState("");
  const [backupConfigurado, setBackupConfigurado] = useState<boolean | null>(
    null
  );
  const [gerandoBackup, setGerandoBackup] = useState(false);
  const [erroBackup, setErroBackup] = useState("");
  const [backupGerado, setBackupGerado] = useState<BackupGerado | null>(null);

  const carregar = useCallback(async () => {
    if (!admin) return;

    try {
      setUsuarios(await api.get<UsuarioLista[]>("/api/usuarios"));
    } catch (erro) {
      setErro(
        erro instanceof Error ? erro.message : "Erro ao carregar usuários."
      );
    }
  }, [admin]);

  const verificarFerramentasDev = useCallback(async () => {
    if (!admin) {
      setDevHabilitado(false);
      return;
    }

    try {
      const d = await api.get<{ habilitado?: boolean }>(
        "/api/dev/alunos-reset/status"
      );
      setDevHabilitado(Boolean(d.habilitado));
    } catch {
      setDevHabilitado(false);
    }
  }, [admin]);

  const verificarBackup = useCallback(async () => {
    if (!admin) {
      setBackupConfigurado(null);
      return;
    }

    try {
      const d = await api.get<{ configurado?: boolean }>(
        "/api/admin/backup/status"
      );
      setBackupConfigurado(Boolean(d.configurado));
    } catch {
      setBackupConfigurado(false);
    }
  }, [admin]);

  useEffect(() => {
    void carregar();
    void verificarFerramentasDev();
    void verificarBackup();
  }, [carregar, verificarFerramentasDev, verificarBackup]);

  async function gerarBackup() {
    setGerandoBackup(true);
    setErroBackup("");
    setBackupGerado(null);

    try {
      const d = await api.post<BackupGerado>("/api/admin/backup");
      setBackupGerado(d);
    } catch (erro) {
      setErroBackup(
        erro instanceof Error
          ? erro.message
          : "Não foi possível acessar o serviço de backup."
      );
    } finally {
      setGerandoBackup(false);
    }
  }

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
        erro instanceof Error ? erro.message : "Erro ao alterar usuário."
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
        `/api/usuarios/${usuarioExcluir.id}`
      );

      setUsuarioExcluir(null);
      setConfirmacaoExcluir("");
      setErroExcluir("");

      await carregar();
    } catch (erro) {
      setErroExcluir(
        erro instanceof Error
          ? erro.message
          : "Não foi possível excluir o usuário."
      );
    } finally {
      setExcluindoUsuario(false);
    }
  }

  const confirmacaoEsperada =
    unidadeDev === "TODOS" ? "LIMPAR TODOS" : `LIMPAR ${unidadeDev}`;

  async function limparAlunosDev() {
    if (confirmacaoDev.trim().toUpperCase() !== confirmacaoEsperada) return;

    setLimpandoDev(true);
    setMensagemDev("");

    try {
      const d = await api.delete<{
        removidos?: number;
        unidade?: string;
        periodo?: string;
      }>("/api/dev/alunos-reset", {
        unidade: unidadeDev,
        confirmacao: confirmacaoDev,
      });

      setMensagemDev(
        `✓ ${d.removidos ?? 0} aluno(s) removido(s) de ${
          d.unidade === "TODOS" ? "todas as unidades" : d.unidade
        } no período ${d.periodo ?? "atual"}.`
      );
      setConfirmacaoDev("");
    } catch (erro) {
      setMensagemDev(
        erro instanceof Error
          ? erro.message
          : "Não foi possível acessar a ferramenta de desenvolvimento."
      );
    } finally {
      setLimpandoDev(false);
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
                      setUsuarioSenha(u);
                      setNovaSenha("");
                      setMostrarNovaSenha(false);
                      setErroSenha("");
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

          <section className="settings-backup">
            <div className="settings-backup-head">
              <div className="settings-backup-title">
                <span className="settings-backup-icon">
                  <AppIcon name="document" size={22} />
                </span>
                <div>
                  <span>PROTEÇÃO DOS DADOS</span>
                  <h2>Backup do banco</h2>
                  <p>
                    Gere uma cópia SQL completa do D1 para guardar fora do
                    repositório. O arquivo contém dados pessoais e hashes de
                    senha.
                  </p>
                </div>
              </div>
              <strong className={backupConfigurado ? "ready" : "pending"}>
                <i aria-hidden="true" />
                {backupConfigurado === null
                  ? "VERIFICANDO"
                  : backupConfigurado
                  ? "CONFIGURADO"
                  : "PENDENTE"}
              </strong>
            </div>

            <div className="settings-backup-action">
              <div className="settings-backup-action-copy">
                <span className="settings-backup-action-icon">
                  <AppIcon name="audit" size={18} />
                </span>
                <div>
                  <strong>Exportação manual segura</strong>
                  <span>
                    A Cloudflare pode deixar o banco indisponível por alguns
                    instantes durante a exportação.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void gerarBackup()}
                disabled={!backupConfigurado || gerandoBackup}
              >
                {gerandoBackup ? "Gerando backup..." : "Gerar backup agora"}
              </button>
            </div>

            {backupConfigurado === false && (
              <div className="settings-backup-message warning">
                <AppIcon name="info" size={16} />
                <span>
                  <strong>Configuração necessária</strong>
                  Adicione as três credenciais protegidas no Worker para
                  habilitar o botão.
                </span>
              </div>
            )}

            {erroBackup && (
              <div className="settings-backup-message error">{erroBackup}</div>
            )}

            {backupGerado && (
              <div className="settings-backup-result">
                <div>
                  <strong>✓ Backup pronto</strong>
                  <span>
                    {backupGerado.arquivo} · link válido por 1 hora · use Ctrl+S
                    para salvar
                  </span>
                </div>
                <a
                  href={backupGerado.download_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir arquivo SQL
                </a>
              </div>
            )}
          </section>

          {devHabilitado && (
            <section className="settings-dev-tools">
              <div className="settings-dev-tools-head">
                <div>
                  <span>AMBIENTE DE DESENVOLVIMENTO</span>
                  <h2>Ferramentas de teste</h2>
                  <p>
                    Limpe alunos do período atual para repetir importações sem
                    mexer em usuários, períodos ou configurações.
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

              {mensagemDev && (
                <div className="settings-dev-message">{mensagemDev}</div>
              )}
            </section>
          )}
        </>
      )}

      {usuarioSenha && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno settings-password-modal">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">SEGURANÇA</span>
                <h2>Redefinir senha</h2>
                <p>
                  Defina uma nova senha para{" "}
                  <strong>{usuarioSenha.nome}</strong>.
                </p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={() => setUsuarioSenha(null)}
                disabled={salvandoSenha}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="settings-password-modal-content">
              <label>
                Nova senha
                <div className="settings-password-field">
                  <input
                    type={mostrarNovaSenha ? "text" : "password"}
                    value={novaSenha}
                    onChange={(e) => {
                      setNovaSenha(e.target.value);
                      setErroSenha("");
                    }}
                    minLength={8}
                    autoFocus
                    disabled={salvandoSenha}
                    placeholder="Mínimo de 8 caracteres"
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
                onClick={() => setUsuarioSenha(null)}
                disabled={salvandoSenha}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="botao-cadastrar"
                disabled={salvandoSenha || novaSenha.length < 8}
                onClick={async () => {
                  if (novaSenha.length < 8) {
                    setErroSenha("A senha deve ter pelo menos 8 caracteres.");
                    return;
                  }

                  setSalvandoSenha(true);
                  setErroSenha("");

                  try {
                    await api.put<{ sucesso: boolean }>(
                      `/api/usuarios/${usuarioSenha.id}`,
                      { senha: novaSenha }
                    );

                    setUsuarioSenha(null);
                    setNovaSenha("");
                    void carregar();
                  } catch (erro) {
                    setErroSenha(
                      erro instanceof Error
                        ? erro.message
                        : "Não foi possível alterar a senha."
                    );
                  } finally {
                    setSalvandoSenha(false);
                  }
                }}
              >
                {salvandoSenha ? "Salvando..." : "Salvar nova senha"}
              </button>
            </div>
          </div>
        </div>
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
