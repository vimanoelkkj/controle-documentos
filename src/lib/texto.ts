export function normalizarCampo(valor: string | null | undefined) {
  return (valor ?? "").trim();
}
