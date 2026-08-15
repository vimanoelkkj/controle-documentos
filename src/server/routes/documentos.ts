type DocumentosBody = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

type DocumentosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  registrarPendencia: (ra: string) => Promise<void>;
};

export async function handleDocumentosRoute({
  request,
  url,
  db,
  periodoId,
  registrarPendencia,
}: DocumentosRouteContext): Promise<Response | null> {
  const rotaDocumentos = url.pathname.match(
    /^\/api\/alunos\/([^/]+)\/documentos$/,
  );
  if (!rotaDocumentos || request.method !== "PUT") return null;

  const ra = decodeURIComponent(rotaDocumentos[1]);
  const body = await request.json<DocumentosBody>();
  const aluno = await db
    .prepare(`SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?`)
    .bind(periodoId, ra)
    .first<{ id: number }>();

  if (!aluno) {
    return Response.json(
      { erro: "Aluno não encontrado." },
      { status: 404 },
    );
  }

  await db
    .prepare(
      `UPDATE documentos
       SET identidade = ?,
           cpf = ?,
           certidao = ?,
           residencia = ?,
           titulo = ?,
           ensino_medio = ?,
           contrato = ?,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE aluno_id = ?`,
    )
    .bind(
      body.identidade ? 1 : 0,
      body.cpf ? 1 : 0,
      body.certidao ? 1 : 0,
      body.residencia ? 1 : 0,
      body.titulo ? 1 : 0,
      body.ensino_medio ? 1 : 0,
      body.contrato ? 1 : 0,
      aluno.id,
    )
    .run();

  await registrarPendencia(ra);
  return Response.json({ sucesso: true, ra });
}
