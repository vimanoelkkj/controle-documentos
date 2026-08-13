import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AppIcon from "../components/AppIcon";

type Tema = "light" | "dark" | "black";

const temas: Array<{ valor: Tema; rotulo: string; simbolo: string }> = [
  { valor: "light", rotulo: "Claro", simbolo: "☀" },
  { valor: "dark", rotulo: "Escuro", simbolo: "◐" },
  { valor: "black", rotulo: "Preto", simbolo: "●" },
];

function Login() {
  const { usuario, carregando, recarregar } = useAuth();
  const [bootstrap, setBootstrap] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tema, setTema] = useState<Tema>(() => {
    const salvo = localStorage.getItem("tema");
    return salvo === "light" || salvo === "black" ? salvo : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
    document.documentElement.style.colorScheme = tema === "light" ? "light" : "dark";
    localStorage.setItem("tema", tema);
  }, [tema]);

  useEffect(() => {
    fetch("/api/auth/bootstrap")
      .then((r) => r.json())
      .then((d) => {
        const dados = d as { necessario?: boolean };
        setBootstrap(Boolean(dados.necessario));
      })
      .catch(() => {});
  }, []);
  if (carregando)
    return (
      <div className="login-shell">
        <div className="login-card">Carregando...</div>
      </div>
    );
  if (usuario) return <Navigate to="/" replace />;
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const endpoint = bootstrap ? "/api/auth/bootstrap" : "/api/auth/login";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bootstrap
            ? { nome, email, username, senha }
            : { identificador: email, senha },
        ),
      });
      const d = (await r.json()) as { erro?: string };
      if (!r.ok) throw new Error(d.erro || "Não foi possível entrar.");
      if (bootstrap) {
        setBootstrap(false);
        setSenha("");
        return;
      }
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao entrar.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="login-shell">
      <div className="login-backdrop" aria-hidden="true" />

      <main className="login-card">
        <div className="login-theme-selector" role="group" aria-label="Tema da interface">
          {temas.map((opcao) => (
            <button
              type="button"
              key={opcao.valor}
              className={tema === opcao.valor ? "active" : ""}
              aria-pressed={tema === opcao.valor}
              onClick={() => setTema(opcao.valor)}
              title={`Usar tema ${opcao.rotulo.toLowerCase()}`}
            >
              <span aria-hidden="true">{opcao.simbolo}</span>
              {opcao.rotulo}
            </button>
          ))}
        </div>

        <header className="login-brand">
          <div className="login-logo">
            <AppIcon name="document" size={25} strokeWidth={1.9} />
          </div>
          <div className="login-brand-copy">
            <span>CONTROLE DE DOCUMENTOS</span>
            <h1>{bootstrap ? "Criar administrador" : "Bem-vindo de volta"}</h1>
            <p>
              {bootstrap
                ? "Configure a primeira conta administrativa para começar."
                : "Acesse sua conta para continuar no sistema."}
            </p>
          </div>
        </header>

        <form onSubmit={enviar} className="login-form">
          {bootstrap && (
            <label>
              <span>Nome completo</span>
              <input
                autoFocus
                autoComplete="name"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome"
                required
              />
            </label>
          )}

          {bootstrap && (
            <label>
              <span>Nome de usuário</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex.: vitormanoel"
                minLength={3}
                required
              />
            </label>
          )}

          <label>
            <span>{bootstrap ? "E-mail" : "E-mail ou usuário"}</span>
            <input
              type="text"
              autoFocus={!bootstrap}
              autoComplete={bootstrap ? "email" : "username"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                bootstrap
                  ? "nome@exemplo.com"
                  : "seu.usuario ou nome@exemplo.com"
              }
              required
            />
          </label>

          <label>
            <span>Senha</span>
            <div className="login-password-field">
              <input
                type={mostrarSenha ? "text" : "password"}
                autoComplete={bootstrap ? "new-password" : "current-password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setMostrarSenha((atual) => !atual)}
              >
                {mostrarSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          {erro && (
            <div className="login-error" role="alert">
              {erro}
            </div>
          )}

          <button className="login-submit" type="submit" disabled={enviando}>
            <span>
              {enviando
                ? "Aguarde..."
                : bootstrap
                  ? "Criar administrador"
                  : "Entrar"}
            </span>
            {!enviando && <span aria-hidden="true">→</span>}
          </button>
        </form>

        <footer className="login-footer">
          <span className="login-security-dot" aria-hidden="true" />
          <small>
            {bootstrap
              ? "Use uma senha com pelo menos 8 caracteres."
              : "Por segurança, a sessão é encerrada após 1 hora de inatividade."}
          </small>
        </footer>
      </main>
    </div>
  );
}
export default Login;
