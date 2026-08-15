import type { FormEvent } from "react";
import type { Perfil } from "../../../contexts/auth";
import AppSelect from "../../../components/AppSelect";

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
  function enviar(evento: FormEvent) {
    evento.preventDefault();
    void criarUsuario();
  }

  return (
    <form className="settings-user-form" onSubmit={enviar}>
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

      {erro && <div className="login-error">{erro}</div>}

      <button type="submit">Criar usuário</button>
    </form>
  );
}
