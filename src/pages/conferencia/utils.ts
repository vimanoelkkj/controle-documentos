import { normalizarBusca } from "./model";

export function formatarDataHistorico(valor: string) {
  const valorNormalizado = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor)
    ? `${valor.replace(" ", "T")}Z`
    : valor;
  const data = new Date(valorNormalizado);

  if (Number.isNaN(data.getTime())) return valor;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

export function classeAcaoHistorico(acao: string) {
  const normalizada = normalizarBusca(acao);

  if (normalizada.includes("cancel")) return "danger";
  if (normalizada.includes("reativ")) return "success";
  if (normalizada.includes("document")) return "document";
  if (normalizada.includes("edicao") || normalizada.includes("cadastro")) {
    return "edit";
  }

  return "neutral";
}

export function quantidadeResultado(valor: number | unknown[] | undefined) {
  if (Array.isArray(valor)) return valor.length;
  return Number(valor ?? 0);
}
