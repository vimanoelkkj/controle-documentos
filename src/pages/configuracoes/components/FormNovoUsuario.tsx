import { useMemo, useState, type FormEvent } from "react";
import type { Perfil } from "../../../contexts/auth";
import AppSelect from "../../../components/AppSelect";

const DOMINIOS_EMAIL = ["fumec.edu.br", "gmail.com"] as const;

type Props = {
  nome: string;
  setNome: (valor: string) => void;
  username: string;
  setUsername: (valor: string) => void;
  email: string;
  setEmail: (valor: string) => void;
  senha: string;
  setSenha: (valor: string) => void;
  perfil: Perfil;
  setPerfil: (valor: Perfil) => void;
  modoApresentacao: boolean;
  setModoApresentacao: (valor: boolean) => void;
  erro: string;
  criarUsuario: () => void | Promise<void>;
};

export function FormNovoUsuario({
  nome,
  setNome,
  username,
  setUsername,
  email,
  setEmail,
  senha,
  setSenha,
  perfil,
  setPerfil,
  modoApresentacao,
  setModoApresentacao,
  erro,
  criarUsuario,
}: Props) {
  const [emailFocado, setEmailFocado] = useState(false);
  const sugestoesEmail = useMemo(() => {
    const local = email.trim().split("@")[0];
    if (!local) return DOMINIOS_EMAIL.map((dominio) => `@${dominio}`);
    return DOMINIOS_EMAIL.map((dominio) => `${local}@${dominio}`);
  }, [email]);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    void criarUsuario();
  }

  return (
    <form className="settings-user-form" onSubmit={enviar} autoComplete="off">
      <div>
        <span className="settings-section-eyebrow">NOVO USUÁRIO</span>
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
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setEmailFocado(true)}
            onBlur={() => setEmailFocado(false)}
            placeholder="nome@fumec.edu.br"
            autoComplete="off"
            required
          />

          {emailFocado && (
            <div className="settings-email-suggestions" role="listbox" aria-label="Sugestões de domínio de e-mail">
              {sugestoesEmail.map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  role="option"
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={() => {
                    setEmail(sugestao);
                    setEmailFocado(false);
                  }}
                >
                  {sugestao}
                </button>
              ))}
            </div>
          )}
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
          className="settings-role-select"
          menuClassName="settings-role-menu"
          options={[
            {
              value: "VISUALIZADOR",
              label: "Visualizador",
            },
            { value: "EDITOR", label: "Editor" },
            {
              value: "ADMIN",
              label: "Administrador",
            },
            {
              value: "APRESENTACAO",
              label: "Apresentação",
            },
          ]}
        />
      </label>

      {erro && <div className="settings-user-inline-error" role="alert">{erro}</div>}

      <button type="submit">Criar usuário</button>
    </form>
  );
}
