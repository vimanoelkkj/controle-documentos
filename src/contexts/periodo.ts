import { createContext, useContext } from "react";

export type Periodo = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  criado_em: string;
  atualizado_em: string;
  total_alunos: number;
};

export type PeriodoContextValue = {
  periodos: Periodo[];
  periodoAtual: Periodo | null;
  carregando: boolean;
  erro: string;
  selecionarPeriodo: (codigo: string) => void;
  recarregarPeriodos: () => Promise<void>;
};

export const PeriodoContext = createContext<PeriodoContextValue | null>(null);

export function usePeriodo() {
  const contexto = useContext(PeriodoContext);
  if (!contexto) {
    throw new Error("usePeriodo deve ser usado dentro de PeriodoProvider.");
  }
  return contexto;
}
