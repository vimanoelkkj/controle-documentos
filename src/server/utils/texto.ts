import { normalizarCampo } from "../../lib/texto";

export function normalizarTexto(valor: unknown) {
  return normalizarCampo(String(valor ?? ""));
}

export function normalizarComparacao(valor: unknown) {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}
