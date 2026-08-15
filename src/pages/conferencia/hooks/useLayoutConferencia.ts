import { useLayoutEffect, useRef } from "react";

type UseLayoutConferenciaParams = {
  carregando: boolean;
  raSelecionado: string;
  unidadeSelecionada: string;
  filtroStatus: string;
};

export function useLayoutConferencia({
  carregando,
  raSelecionado,
  unidadeSelecionada,
  filtroStatus,
}: UseLayoutConferenciaParams) {
  const painelListaRef = useRef<HTMLElement | null>(null);
  const detalhesAlunoRef = useRef<HTMLElement | null>(null);
  const conferenciaGridRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const grid = conferenciaGridRef.current;
    const painel = painelListaRef.current;
    const detalhes = detalhesAlunoRef.current;

    if (!grid || !painel || !detalhes) return;

    const ajustarAltura = () => {
      if (window.matchMedia("(max-width: 1100px)").matches) {
        painel.style.removeProperty("height");
        detalhes.style.removeProperty("height");
        return;
      }

      const margemInferior = 20;
      const topo = Math.ceil(grid.getBoundingClientRect().top);

      const alturaDisponivel = Math.max(
        460,
        window.innerHeight - topo - margemInferior,
      );

      painel.style.height = `${alturaDisponivel}px`;
      detalhes.style.height = `${alturaDisponivel}px`;
    };

    ajustarAltura();

    window.addEventListener("resize", ajustarAltura);

    const observer = new ResizeObserver(ajustarAltura);
    observer.observe(grid.parentElement ?? grid);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", ajustarAltura);
      painel.style.removeProperty("height");
      detalhes.style.removeProperty("height");
    };
  }, [carregando, raSelecionado, unidadeSelecionada, filtroStatus]);

  return {
    painelListaRef,
    detalhesAlunoRef,
    conferenciaGridRef,
  };
}