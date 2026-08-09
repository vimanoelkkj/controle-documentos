import { useEffect, useState, type FormEvent } from "react";
import { useAuth, type Perfil } from "../contexts/AuthContext";

type UsuarioLista = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: Perfil;
  ativo: number;
  criado_em: string;
};

type UnidadeDev = "FACE" | "FEA" | "FCH" | "EAD" | "TODOS";

function Configuracoes() {
  const { admin } = useAuth();

  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("VISUALIZADOR");
  const [erro, setErro] = useState("");

  const [devHabilitado, setDevHabilitado] = useState(false);
  const [unidadeDev, setUnidadeDev] = useState<UnidadeDev>("FCH");
  const [confirmacaoDev, setConfirmacaoDev] = useState("");
  const [limpandoDev, setLimpandoDev] = useState(false);
  const [mensagemDev, setMensagemDev] = useState("");

  async function carregar() {
    if (!admin) return;

    const r = await fetch("/api/usuarios");
    if (r.ok) setUsuarios((await r.json()) as UsuarioLista[]);
  }

  async function verificarFerramentasDev() {
    if (!admin) {
      setDevHabilitado(false);
      return;
    }

    try {
      const r = await fetch("/api/dev/alunos-reset/status");
      if (!r.ok) {
        setDevHabilitado(false);
        return;
      }

      const d = (await r.json()) as { habilitado?: boolean };
      setDevHabilitado(Boolean(d.habilitado));
    } catch {
      setDevHabilitado(false);
    }
  }

  useEffect(() => {
    void carregar();
    void verificarFerramentasDev();
  }, [admin]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro("");

    const r = await fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, username, email, senha, perfil }),
    });

    const d = (await r.json()) as { erro?: string };

    if (!r.ok) {
      setErro(d.erro || "Erro ao criar usuário.");
      return;
    }

    setNome("");
    setUsername("");
    setEmail("");
    setSenha("");
    setPerfil("VISUALIZADOR");
    void carregar();
  }

  async function alterar(id: number, dados: Record<string, unknown>) {
    const r = await fetch(`/api/usuarios/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });

    const d = (await r.json()) as { erro?: string };

    if (!r.ok) {
      setErro(d.erro || "Erro ao alterar usuário.");
      return;
    }

    void carregar();
  }

  const confirmacaoEsperada =
    unidadeDev === "TODOS" ? "LIMPAR TODOS" : `LIMPAR ${unidadeDev}`;

  async function limparAlunosDev() {
    if (confirmacaoDev.trim().toUpperCase() !== confirmacaoEsperada) return;

    setLimpandoDev(true);
    setMensagemDev("");

    try {
      const r = await fetch("/api/dev/alunos-reset", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unidade: unidadeDev,
          confirmacao: confirmacaoDev,
        }),
      });

      const d = (await r.json()) as {
        erro?: string;
        removidos?: number;
        unidade?: string;
        periodo?: string;
      };

      if (!r.ok) {
        setMensagemDev(d.erro || "Não foi possível limpar os alunos.");
        return;
      }

      setMensagemDev(
        `✓ ${d.removidos ?? 0} aluno(s) removido(s) de ${
          d.unidade === "TODOS" ? "todas as unidades" : d.unidade
        } no período ${d.periodo ?? "atual"}.`,
      );
      setConfirmacaoDev("");
    } catch {
      setMensagemDev("Não foi possível acessar a ferramenta de desenvolvimento.");
    } finally {
      setLimpandoDev(false);
    }
  }

  return (
    <section className="settings-page">
      <span>SISTEMA</span>
      <h1>Configurações</h1>
      <p>Preferências, integrações e controle de acesso.</p>

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
                      const nova = window.prompt(
                        `Nova senha para ${u.nome} (mínimo 8 caracteres):`,
                      );
                      if (nova) void alterar(u.id, { senha: nova });
                    }}
                  >
                    ⌁ Senha
                  </button>

                  <select
                    value={u.perfil}
                    onChange={(e) => alterar(u.id, { perfil: e.target.value })}
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="VISUALIZADOR">VISUALIZADOR</option>
                  </select>

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
              <select
                value={perfil}
                onChange={(e) => setPerfil(e.target.value as Perfil)}
              >
                <option value="VISUALIZADOR">Visualizador</option>
                <option value="EDITOR">Editor</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>

            {erro && <div className="login-error">{erro}</div>}

            <button type="submit">Criar usuário</button>
          </form>

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
                    <select
                      value={unidadeDev}
                      onChange={(e) => {
                        setUnidadeDev(e.target.value as UnidadeDev);
                        setConfirmacaoDev("");
                        setMensagemDev("");
                      }}
                      disabled={limpandoDev}
                    >
                      <option value="FACE">FACE</option>
                      <option value="FEA">FEA</option>
                      <option value="FCH">FCH</option>
                      <option value="EAD">EAD</option>
                      <option value="TODOS">TODOS OS ALUNOS</option>
                    </select>
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
    </section>
  );
}

export default Configuracoes;
