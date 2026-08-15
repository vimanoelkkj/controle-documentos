import { useState } from "react";
import { api } from "../../../lib/api";
import type { UsuarioLista } from "../model";

type Params = {
  aoExcluir: () => Promise<void> | void;
};

export function useExcluirUsuario({ aoExcluir }: Params) {
  const [usuarioExcluir, setUsuarioExcluir] = useState<UsuarioLista | null>(
    null,
  );
  const [confirmacaoExcluir, setConfirmacaoExcluir] = useState("");
  const [excluindoUsuario, setExcluindoUsuario] = useState(false);
  const [erroExcluir, setErroExcluir] = useState("");

  function abrirModalExcluir(usuario: UsuarioLista) {
    setUsuarioExcluir(usuario);
    setConfirmacaoExcluir("");
    setErroExcluir("");
  }

  function fecharModalExcluir() {
    if (excluindoUsuario) return;

    setUsuarioExcluir(null);
    setConfirmacaoExcluir("");
    setErroExcluir("");
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

      await aoExcluir();
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

  return {
    usuarioExcluir,
    confirmacaoExcluir,
    setConfirmacaoExcluir,
    excluindoUsuario,
    erroExcluir,
    setErroExcluir,
    abrirModalExcluir,
    fecharModalExcluir,
    excluirUsuario,
  };
}
