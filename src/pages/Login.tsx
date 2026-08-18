import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/auth";
import MockupStyle from "../components/MockupStyle";
import loginCss from "../mockups/login.css?raw";

const PONTO_SENHA = "•";

// Diff simples entre o valor mascarado anterior (uma sequência de "•" do mesmo
// tamanho da senha real) e o que acabou de aparecer no input: o trecho que muda
// é exatamente o que o usuário digitou/colou/apagou, então dá pra reconstruir a
// senha real sem nunca guardar o texto verdadeiro dentro de um input nativo.
function aplicarEdicaoMascarada(
  senhaAtual: string,
  valorExibido: string,
): { senha: string; cursor: number } {
  const mascaraAnterior = PONTO_SENHA.repeat(senhaAtual.length);
  let inicio = 0;
  while (
    inicio < valorExibido.length &&
    inicio < mascaraAnterior.length &&
    valorExibido[inicio] === mascaraAnterior[inicio]
  ) inicio++;

  let fimExibido = valorExibido.length;
  let fimAnterior = mascaraAnterior.length;
  while (
    fimExibido > inicio &&
    fimAnterior > inicio &&
    valorExibido[fimExibido - 1] === mascaraAnterior[fimAnterior - 1]
  ) {
    fimExibido--;
    fimAnterior--;
  }

  const trechoDigitado = valorExibido.slice(inicio, fimExibido);
  return {
    senha: senhaAtual.slice(0, inicio) + trechoDigitado + senhaAtual.slice(fimAnterior),
    cursor: inicio + trechoDigitado.length,
  };
}

export default function Login() {
  const { usuario, carregando, recarregar } = useAuth();
  const [bootstrap, setBootstrap] = useState(false);
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const senhaInputRef = useRef<HTMLInputElement>(null);
  const cursorPendenteRef = useRef<number | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("tema-v3") === "dark");
  const [loginLiberado, setLoginLiberado] = useState(false);

  // Mantém o campo readOnly no instante exato do foco (é quando o Chrome decide se
  // mostra a sugestão de senha salva) e só libera a digitação um tick depois.
  const liberarLogin = () => {
    setTimeout(() => setLoginLiberado(true), 0);
  };

  // Depois de reescrever a senha com "•", o React reposiciona o cursor no fim do
  // valor por padrão — aqui devolvemos ele pro ponto exato onde o usuário estava
  // editando (importante quando edita no meio do texto, não só no fim).
  useEffect(() => {
    if (cursorPendenteRef.current !== null && senhaInputRef.current) {
      const pos = cursorPendenteRef.current;
      senhaInputRef.current.setSelectionRange(pos, pos);
      cursorPendenteRef.current = null;
    }
  }, [senha]);

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("tema-v3", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    fetch("/api/auth/bootstrap")
      .then(async (r) => {
        const text = await r.text();
        return text ? JSON.parse(text) as { necessario?: boolean } : {};
      })
      .then((d) => setBootstrap(Boolean(d.necessario)))
      .catch(() => {});
  }, []);

  if (carregando) return <><MockupStyle css={loginCss} /><div className="login-wrap">Carregando...</div></>;
  if (usuario) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setSucesso(false);

    if (!email.trim() || !senha.trim()) {
      setErro("Preencha os dois campos");
      return;
    }

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
      const text = await r.text();
      const d = text ? JSON.parse(text) as { erro?: string } : {};
      if (!r.ok) throw new Error(d.erro || "Não foi possível entrar.");
      if (bootstrap) {
        setBootstrap(false);
        setSenha("");
        setSucesso(true);
        return;
      }
      setSucesso(true);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao entrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <MockupStyle css={loginCss} />
      <div className="bg-blob" />
      <div className="login-wrap">
        <div className="theme-tabs" id="themeTabs">
          <button className={`theme-tab${!dark ? " active" : ""}`} type="button" onClick={() => setDark(false)}>
            <span className="t-icon">☀</span><span className="t-label">Claro</span>
          </button>
          <button className={`theme-tab${dark ? " active" : ""}`} type="button" onClick={() => setDark(true)}>
            <span className="t-icon">◐</span><span className="t-label">Escuro</span>
          </button>
        </div>

        <div className="login-icon-wrap"><div className="login-icon">▤</div></div>
        <div className="login-eyebrow">Controle de Documentos</div>
        <h1 className="login-title">{bootstrap ? "Criar administrador" : "Bem-vindo de volta"}</h1>
        <p className="login-sub">{bootstrap ? "Configure a primeira conta administrativa para começar." : "Acesse sua conta para continuar no sistema."}</p>

        <form autoComplete="off" className="login-form" id="loginForm" onSubmit={enviar}>
          {/* Isca de autofill: o navegador ignora autocomplete="off"/"new-password" quando já existe
              uma credencial salva para esta origem e insiste em preencher (e pintar de amarelo) o
              primeiro campo de usuário/senha que encontrar. Damos a ele campos escondidos pra preencher
              no lugar dos campos reais visíveis. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: 0, border: 0, opacity: 0, pointerEvents: "none", left: -9999 }}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: 0, border: 0, opacity: 0, pointerEvents: "none", left: -9999 }}
          />

          {bootstrap && (
            <>
              <label className="field">
                <span>Nome completo</span>
                <input autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <label className="field">
                <span>Nome de usuário</span>
                <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
            </>
          )}

          <label className="field">
            <span>{bootstrap ? "E-mail" : "E-mail ou usuário"}</span>
            <input
              autoComplete={bootstrap ? "email" : "new-password"}
              type="text"
              readOnly={!bootstrap && !loginLiberado}
              onPointerDown={liberarLogin}
              onKeyDown={liberarLogin}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <div className="password-row">
              {/* Nunca é type="password" de verdade — o navegador só oferece a caixinha de
                  senha salva pra inputs desse tipo, e isso não dá pra desligar via código
                  (é proposital, por segurança do usuário). Em vez disso mascaramos os
                  caracteres na mão com "•", então o campo continua sendo um input de texto
                  comum aos olhos do gerenciador de senhas do navegador. */}
              <input
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                type="text"
                readOnly={!bootstrap && !loginLiberado}
                ref={senhaInputRef}
                onPointerDown={liberarLogin}
                onKeyDown={liberarLogin}
                value={mostrarSenha ? senha : PONTO_SENHA.repeat(senha.length)}
                onChange={(e) => {
                  if (mostrarSenha) {
                    setSenha(e.target.value);
                    return;
                  }
                  const { senha: novaSenha, cursor } = aplicarEdicaoMascarada(senha, e.target.value);
                  cursorPendenteRef.current = cursor;
                  setSenha(novaSenha);
                }}
              />
              <a className="show-toggle" onClick={() => setMostrarSenha((v) => !v)}>{mostrarSenha ? "Ocultar" : "Mostrar"}</a>
            </div>
          </label>

          <div className="login-submit-row">
            <span className={`login-error${erro ? " show" : ""}`} id="loginError">{erro || "Preencha os dois campos"}</span>
            <button aria-label={bootstrap ? "Criar administrador" : "Entrar"} className={`login-submit${enviando ? " loading" : ""}`} type="submit" disabled={enviando}>
              <span className="arrow">→</span><span className="spinner" />
            </button>
          </div>
          <p className={`login-success${sucesso ? " show" : ""}`} id="loginSuccess">✓ {bootstrap ? "Administrador criado. Faça login para continuar." : "Acesso confirmado. Redirecionando…"}</p>
        </form>

        <div className="login-footnote"><span className="dot" />Por segurança, a sessão é encerrada após 1 hora de inatividade.</div>
      </div>
    </>
  );
}
