import { useState } from "react";
import { api } from "../../../lib/api";

type ConfirmacaoPeriodo = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
};

type UseGerenciamentoPeriodosParams = {
  recarregarPeriodos: () => Promise<void>;
  selecionarPeriodo: (codigo: string) => void;
};

export function formatarCodigoPeriodo(valor: string) {
  const numeros = valor.replace(/\D/g, "").slice(0, 5);

  if (numeros.length < 4) return numeros;
  if (numeros.length === 4) return `${numeros}-`;

  return `${numeros.slice(0, 4)}-${numeros.slice(4)}`;
}

function normalizarCodigo(valor: string) {
  return valor.trim().toUpperCase().replace(/\s+/g, "");
}

export function useGerenciamentoPeriodos({
  recarregarPeriodos,
  selecionarPeriodo,
}: UseGerenciamentoPeriodosParams) {
  const [novoCodigo, setNovoCodigo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoPeriodo | null>(
    null,
  );

  async function criarPeriodo() {
    const codigo = normalizarCodigo(novoCodigo);

    if (!/^\d{4}-(1|2)$/.test(codigo)) {
      setErro("Use o formato AAAA-1 ou AAAA-2. Ex.: 2027-1.");
      return;
    }

    try {
      setProcessando(true);
      setErro("");

      await api.post<{ sucesso: boolean; id: number }>("/api/periodos", {
        codigo,
      });

      setNovoCodigo("");

      await recarregarPeriodos();

      selecionarPeriodo(codigo);
    } catch (erro) {
      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível criar o período.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function alterarStatus(id: number, status: "ATIVO" | "ARQUIVADO") {
    try {
      setProcessando(true);
      setErro("");

      await api.put<{ sucesso: boolean }>(`/api/periodos/${id}`, {
        status,
      });

      await recarregarPeriodos();

      setConfirmacao(null);
    } catch (erro) {
      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível alterar o período.",
      );
    } finally {
      setProcessando(false);
    }
  }

  return {
    novoCodigo,
    setNovoCodigo,
    processando,
    erro,
    confirmacao,
    setConfirmacao,
    criarPeriodo,
    alterarStatus,
  };
}
