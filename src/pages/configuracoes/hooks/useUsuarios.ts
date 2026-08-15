import { useCallback, useState } from "react";
import type { Perfil } from "../../../contexts/auth";
import { api } from "../../../lib/api";
import type { UsuarioLista } from "../model";

type Params = {
  admin: boolean;
};

export function useUsuarios({ admin }: Params) {
  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("VISUALIZADOR");
  const [modoApresentacao, setModoApresentacao] = useState(false);
  const [erro, setErro] = useState("");

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

  async function criarUsuario() {
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

    await carregar();
  }

  async function alterarUsuario(id: number, dados: Record<string, unknown>) {
    try {
      await api.put<{ sucesso: boolean }>(`/api/usuarios/${id}`, dados);
    } catch (erro) {
      setErro(
        erro instanceof Error ? erro.message : "Erro ao alterar usuário.",
      );

      return;
    }

    await carregar();
  }

  return {
    usuarios,

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

    carregar,
    criarUsuario,
    alterarUsuario,
  };
}
