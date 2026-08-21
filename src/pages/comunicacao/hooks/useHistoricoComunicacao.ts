import { useCallback, useEffect, useState } from "react";
import type { HistoricoComunicacao } from "../model";

type RegistrarCobrancaPayload = {
  grupo_chave: string;
  unidade: string;
  documentos: string[];
  quantidade_alunos: number;
  quantidade_emails: number;
  assunto: string;
  prazo: string;
  tipo_destinatario: string;
  ras: string[];
};

export function useHistoricoComunicacao() {
  const [historico, setHistorico] = useState<HistoricoComunicacao[]>([]);
  const [historicoErro, setHistoricoErro] = useState("");
  const [registrandoHistorico, setRegistrandoHistorico] = useState(false);

  const carregarHistorico = useCallback(async () => {
    try {
      const resposta = await fetch("/api/comunicacoes?limit=500");

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as {
          erro?: string;
        };

        throw new Error(dados.erro || "Não foi possível carregar o histórico.");
      }

      const dados = (await resposta.json()) as HistoricoComunicacao[];

      setHistorico(dados);
      setHistoricoErro("");
    } catch (erro) {
      setHistoricoErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível carregar o histórico.",
      );
    }
  }, []);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  async function registrarCobranca(payload: RegistrarCobrancaPayload) {
    try {
      setRegistrandoHistorico(true);

      const resposta = await fetch("/api/comunicacoes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const dados = (await resposta.json().catch(() => ({}))) as {
        erro?: string;
      };

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível registrar a cobrança.");
      }

      await carregarHistorico();
    } finally {
      setRegistrandoHistorico(false);
    }
  }

  return {
    historico,
    historicoErro,
    registrandoHistorico,
    carregarHistorico,
    registrarCobranca,
  };
}
