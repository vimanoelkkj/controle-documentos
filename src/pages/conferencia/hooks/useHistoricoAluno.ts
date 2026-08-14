import { useState } from "react";
import { api } from "../../../lib/api";
import type { HistoricoLog } from "../model";

export function useHistoricoAluno() {
  const [modalHistoricoAluno, setModalHistoricoAluno] = useState(false);
  const [historicoAluno, setHistoricoAluno] = useState<HistoricoLog[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState("");
  const [historicoPossivelmenteLimitado, setHistoricoPossivelmenteLimitado] =
    useState(false);

  async function carregarHistoricoAluno(ra: string) {
    if (!ra) return;

    try {
      setCarregandoHistorico(true);
      setErroHistorico("");

      const dados = await api.get<HistoricoLog[]>("/api/log?limit=500");
      const raAtual = ra.trim();

      setHistoricoAluno(
        dados.filter((registro) => registro.ra?.trim() === raAtual),
      );
      setHistoricoPossivelmenteLimitado(dados.length >= 500);
    } catch (erro) {
      console.error(erro);
      setHistoricoAluno([]);
      setHistoricoPossivelmenteLimitado(false);
      setErroHistorico(
        erro instanceof Error
          ? erro.message
          : "Não foi possível carregar o histórico.",
      );
    } finally {
      setCarregandoHistorico(false);
    }
  }

  function abrirHistoricoAluno(ra: string) {
    setModalHistoricoAluno(true);
    void carregarHistoricoAluno(ra);
  }

  return {
    modalHistoricoAluno,
    setModalHistoricoAluno,
    historicoAluno,
    carregandoHistorico,
    erroHistorico,
    historicoPossivelmenteLimitado,
    carregarHistoricoAluno,
    abrirHistoricoAluno,
  };
}
