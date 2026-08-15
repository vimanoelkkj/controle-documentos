import { useState } from "react";
import { api } from "../../../lib/api";
import type { UsuarioLista } from "../model";

export function useRedefinirSenha() {
  const [usuarioSenha, setUsuarioSenha] = useState<UsuarioLista | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState("");

  function abrirModalSenha(usuario: UsuarioLista) {
    setUsuarioSenha(usuario);
    setNovaSenha("");
    setMostrarNovaSenha(false);
    setErroSenha("");
  }

  function fecharModalSenha() {
    if (salvandoSenha) return;

    setUsuarioSenha(null);
    setNovaSenha("");
    setMostrarNovaSenha(false);
    setErroSenha("");
  }

  async function salvarNovaSenha() {
    if (!usuarioSenha) return;

    if (novaSenha.length < 8) {
      setErroSenha("A senha deve ter pelo menos 8 caracteres.");
      return;
    }

    try {
      setSalvandoSenha(true);
      setErroSenha("");

      await api.put<{ sucesso: boolean }>(`/api/usuarios/${usuarioSenha.id}`, {
        senha: novaSenha,
      });

      setUsuarioSenha(null);
      setNovaSenha("");
      setMostrarNovaSenha(false);
    } catch (erro) {
      setErroSenha(
        erro instanceof Error
          ? erro.message
          : "Não foi possível redefinir a senha.",
      );
    } finally {
      setSalvandoSenha(false);
    }
  }

  return {
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
  };
}
