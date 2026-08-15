import { useEffect, type RefObject } from "react";

type UseAtalhosConferenciaParams = {
  algumModalAberto: boolean;
  busca: string;
  raSelecionado: string;
  buscaAlunoRef: RefObject<HTMLInputElement | null>;
  listaAlunosRef: RefObject<HTMLDivElement | null>;
  setBusca: (valor: string) => void;
  podeSalvar: () => boolean;
  aoSalvar: () => void;
};

export function useAtalhosConferencia({
  algumModalAberto,
  busca,
  raSelecionado,
  buscaAlunoRef,
  listaAlunosRef,
  setBusca,
  podeSalvar,
  aoSalvar,
}: UseAtalhosConferenciaParams) {
  useEffect(() => {
    function atalhosConferencia(event: KeyboardEvent) {
      if (algumModalAberto) return;

      const tecla = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && tecla === "f") {
        event.preventDefault();
        buscaAlunoRef.current?.focus();
        buscaAlunoRef.current?.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && tecla === "s") {
        event.preventDefault();

        if (podeSalvar()) {
          aoSalvar();
        }

        return;
      }

      if (event.key === "Escape" && busca) {
        event.preventDefault();
        setBusca("");
        buscaAlunoRef.current?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const alvo = event.target as HTMLElement | null;

      const estaDigitando =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        alvo?.isContentEditable;

      // Na busca, as setas também percorrem os resultados. Nos demais campos,
      // preserva o comportamento normal de edição.
      if (estaDigitando && alvo !== buscaAlunoRef.current) return;

      const botoes = Array.from(
        listaAlunosRef.current?.querySelectorAll<HTMLButtonElement>(
          ".student-card",
        ) ?? [],
      );

      if (botoes.length === 0) return;

      event.preventDefault();

      const indiceAtual = botoes.findIndex(
        (botao) => botao === document.activeElement,
      );

      const indiceSelecionado = botoes.findIndex(
        (botao) => botao.dataset.ra === raSelecionado,
      );

      const base = indiceAtual >= 0 ? indiceAtual : indiceSelecionado;

      let proximoIndice: number;

      if (event.key === "ArrowDown") {
        proximoIndice =
          base < 0 ? 0 : Math.min(base + 1, botoes.length - 1);
      } else {
        proximoIndice =
          base < 0 ? botoes.length - 1 : Math.max(base - 1, 0);
      }

      botoes[proximoIndice]?.focus();

      botoes[proximoIndice]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }

    window.addEventListener("keydown", atalhosConferencia);

    return () => window.removeEventListener("keydown", atalhosConferencia);
  });
}