export type PeriodoContexto = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  criado_em: string;
  atualizado_em: string;
};

function obterCookie(request: Request, nome: string) {
  const cookies = request.headers.get("Cookie") || "";
  for (const parte of cookies.split(";")) {
    const [chave, ...valor] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(valor.join("="));
  }
  return null;
}

export async function obterPeriodoAtual(
  request: Request,
  db: D1Database,
  url: URL,
) {
  const codigo =
    url.searchParams.get("periodo") || obterCookie(request, "periodo");

  if (codigo) {
    const periodo = await db
      .prepare(
        "SELECT id, codigo, status, criado_em, atualizado_em FROM periodos WHERE codigo = ?",
      )
      .bind(codigo)
      .first<PeriodoContexto>();
    if (periodo) return periodo;
  }

  return db
    .prepare(
      `SELECT id, codigo, status, criado_em, atualizado_em
       FROM periodos
       ORDER BY CASE status WHEN 'ATIVO' THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
    )
    .first<PeriodoContexto>();
}
