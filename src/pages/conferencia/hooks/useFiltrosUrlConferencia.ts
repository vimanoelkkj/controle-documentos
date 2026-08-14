import { useState } from "react";
import type { FiltroStatus, Unidade } from "../model";

type FiltroDocumental = "COMPLETO" | "PARCIAL" | "CRITICO" | "";

export function useFiltrosUrlConferencia() {
  const [unidadeSelecionada, setUnidadeSelecionada] = useState<Unidade | "">(
    () => {
      const valor = new URLSearchParams(window.location.search).get("unidade");

      return ["FACE", "FEA", "FCH", "EAD"].includes(valor || "")
        ? (valor as Unidade)
        : "";
    },
  );

  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>(() => {
    const valor = new URLSearchParams(window.location.search).get("status");

    return valor === "CANCELADO" || valor === "TODOS" ? valor : "ATIVO";
  });

  const [filtroDocumentalDashboard, setFiltroDocumentalDashboard] =
    useState<FiltroDocumental>(() => {
      const valor = new URLSearchParams(window.location.search).get(
        "docStatus",
      );

      return valor === "COMPLETO" || valor === "PARCIAL" || valor === "CRITICO"
        ? valor
        : "";
    });

  const [pendenciasDashboard, setPendenciasDashboard] = useState<string[]>(
    () => {
      const valor = new URLSearchParams(window.location.search).get(
        "pendencia",
      );

      const validos = new Set([
        "identidade",
        "cpf",
        "certidao",
        "residencia",
        "titulo",
        "ensino_medio",
        "contrato",
      ]);

      return (valor || "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => validos.has(item));
    },
  );

  return {
    unidadeSelecionada,
    setUnidadeSelecionada,
    filtroStatus,
    setFiltroStatus,
    filtroDocumentalDashboard,
    setFiltroDocumentalDashboard,
    pendenciasDashboard,
    setPendenciasDashboard,
  };
}
