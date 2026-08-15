import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PeriodoContext, type Periodo } from "./periodo";

function salvarPeriodo(codigo: string) {
  localStorage.setItem("periodoAtual", codigo);
  document.cookie = `periodo=${encodeURIComponent(codigo)}; path=/; SameSite=Lax`;
}

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [codigoAtual, setCodigoAtual] = useState(() => localStorage.getItem("periodoAtual") || "");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  async function recarregarPeriodos() {
    const cargaInicial = periodos.length === 0;

    try {
      // Na primeira carga, mantém a tela global de inicialização.
      // Nas atualizações posteriores, preserva a página montada para não
      // perder estados locais como modais de sucesso.
      if (cargaInicial) {
        setCarregando(true);
      }

      setErro("");
      const resposta = await fetch("/api/periodos");
      if (!resposta.ok) throw new Error("Falha ao carregar períodos.");
      const dados = (await resposta.json()) as Periodo[];
      setPeriodos(dados);

      const salvo = codigoAtual || localStorage.getItem("periodoAtual") || "";
      const existe = dados.find((periodo) => periodo.codigo === salvo);
      const preferido = existe ?? dados.find((periodo) => periodo.status === "ATIVO") ?? dados[0] ?? null;

      if (preferido) {
        setCodigoAtual(preferido.codigo);
        salvarPeriodo(preferido.codigo);
      }
    } catch (e) {
      console.error(e);
      setErro("Não foi possível carregar os períodos letivos.");
    } finally {
      if (cargaInicial) {
        setCarregando(false);
      }
    }
  }

  useEffect(() => {
    void recarregarPeriodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodoAtual = useMemo(
    () => periodos.find((periodo) => periodo.codigo === codigoAtual) ?? null,
    [periodos, codigoAtual],
  );

  function selecionarPeriodo(codigo: string) {
    setCodigoAtual(codigo);
    salvarPeriodo(codigo);
    window.dispatchEvent(new CustomEvent("periodo-alterado", { detail: codigo }));
  }

  return (
    <PeriodoContext.Provider
      value={{ periodos, periodoAtual, carregando, erro, selecionarPeriodo, recarregarPeriodos }}
    >
      {children}
    </PeriodoContext.Provider>
  );
}
