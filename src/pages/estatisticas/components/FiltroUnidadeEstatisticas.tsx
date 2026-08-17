import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  valor: string;
  onChange: (valor: string) => void;
  unidades: string[];
  totais: Record<string, number>;
  totalGeral: number;
};

export function FiltroUnidadeEstatisticas({
  valor,
  onChange,
  unidades,
  totais,
  totalGeral,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [fechando, setFechando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const rotuloAtual = valor === "GERAL" ? "Geral — todas as unidades" : valor;

  const opcoes = useMemo(
    () => [
      { value: "GERAL", label: "Todas as unidades", total: totalGeral },
      ...unidades.map((unidade) => ({
        value: unidade,
        label: unidade,
        total: totais[unidade] ?? 0,
      })),
    ],
    [totalGeral, totais, unidades],
  );

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFechando(true);
        closeTimerRef.current = window.setTimeout(() => {
          setAberto(false);
          setFechando(false);
          closeTimerRef.current = null;
        }, 120);
      }
    };

    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFechando(true);
        closeTimerRef.current = window.setTimeout(() => {
          setAberto(false);
          setFechando(false);
          closeTimerRef.current = null;
        }, 120);
      }
    };

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);

    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const fechar = () => {
    if (!aberto || fechando) return;
    setFechando(true);
    closeTimerRef.current = window.setTimeout(() => {
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const selecionar = (proximo: string) => {
    if (fechando) return;
    setFechando(true);
    closeTimerRef.current = window.setTimeout(() => {
      onChange(proximo);
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  return (
    <div
      ref={containerRef}
      className={`statistics-unit-disclosure${aberto ? " is-open" : ""}${
        fechando ? " is-closing" : ""
      }`}
    >
      <button
        type="button"
        className="statistics-unit-disclosure-trigger"
        onClick={() => {
          if (aberto) fechar();
          else {
            setFechando(false);
            setAberto(true);
          }
        }}
        aria-expanded={aberto}
        aria-controls="statistics-unit-disclosure-menu"
      >
        <span>{aberto ? "Filtrar por unidade" : rotuloAtual}</span>
        <span className="statistics-unit-disclosure-chevron" aria-hidden="true" />
      </button>

      <div
        id="statistics-unit-disclosure-menu"
        className="statistics-unit-disclosure-menu"
        role="listbox"
        aria-hidden={!aberto}
      >
        {opcoes.map((opcao) => {
          const ativa = valor === opcao.value;
          return (
            <button
              key={opcao.value}
              type="button"
              role="option"
              tabIndex={aberto ? 0 : -1}
              aria-selected={ativa}
              className={ativa ? "active" : ""}
              onClick={() => selecionar(opcao.value)}
            >
              <span className="statistics-unit-disclosure-option-copy">
                <i className="statistics-unit-disclosure-radio" aria-hidden="true" />
                <span>{opcao.label}</span>
              </span>
              <strong>{opcao.total.toLocaleString("pt-BR")}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
