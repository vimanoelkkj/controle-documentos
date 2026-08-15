import { useCallback, useState } from "react";
import { api } from "../../../lib/api";

export type UnidadeDev = "FACE" | "FEA" | "FCH" | "EAD" | "TODOS";

type Params = {
  admin: boolean;
};

export function useFerramentasDev({ admin }: Params) {
  const [devHabilitado, setDevHabilitado] = useState(false);
  const [unidadeDev, setUnidadeDev] = useState<UnidadeDev>("FCH");
  const [confirmacaoDev, setConfirmacaoDev] = useState("");
  const [limpandoDev, setLimpandoDev] = useState(false);
  const [mensagemDev, setMensagemDev] = useState("");

  const verificarFerramentasDev = useCallback(async () => {
    if (!admin) {
      setDevHabilitado(false);
      return;
    }

    try {
      const dados = await api.get<{ habilitado?: boolean }>(
        "/api/dev/alunos-reset/status",
      );

      setDevHabilitado(Boolean(dados.habilitado));
    } catch {
      setDevHabilitado(false);
    }
  }, [admin]);

  const confirmacaoEsperada =
    unidadeDev === "TODOS" ? "LIMPAR TODOS" : `LIMPAR ${unidadeDev}`;

  async function limparAlunosDev() {
    if (confirmacaoDev.trim().toUpperCase() !== confirmacaoEsperada) {
      return;
    }

    setLimpandoDev(true);
    setMensagemDev("");

    try {
      const dados = await api.delete<{
        removidos?: number;
        unidade?: string;
        periodo?: string;
      }>("/api/dev/alunos-reset", {
        unidade: unidadeDev,
        confirmacao: confirmacaoDev,
      });

      setMensagemDev(
        `✓ ${dados.removidos ?? 0} aluno(s) removido(s) de ${
          dados.unidade === "TODOS" ? "todas as unidades" : dados.unidade
        } no período ${dados.periodo ?? "atual"}.`,
      );

      setConfirmacaoDev("");
    } catch (erro) {
      setMensagemDev(
        erro instanceof Error
          ? erro.message
          : "Não foi possível acessar a ferramenta de desenvolvimento.",
      );
    } finally {
      setLimpandoDev(false);
    }
  }

  return {
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
  };
}
