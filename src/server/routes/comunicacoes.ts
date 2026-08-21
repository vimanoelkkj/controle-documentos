type ComunicacaoRow = {
  id: number;
  criado_em: string;
  grupo_chave: string;
  unidade: string;
  documentos_json: string;
  quantidade_alunos: number;
  quantidade_emails: number;
  assunto: string;
  prazo: string;
  tipo_destinatario: string;
  ras_json: string;
};

type ComunicacaoBody = {
  grupo_chave: string;
  unidade: string;
  documentos: string[];
  quantidade_alunos: number;
  quantidade_emails: number;
  assunto: string;
  prazo: string;
  tipo_destinatario: string;
  ras: string[];
};

type ComunicacoesRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  modoApresentacao: boolean;
};

async function listarComunicacoes(
  url: URL,
  db: D1Database,
  periodoId: number,
  modoApresentacao: boolean,
) {
  try {
    const limiteSolicitado = Number(url.searchParams.get("limit") || "20");
    const limite = Math.max(1, Math.min(500, limiteSolicitado));
    const resultado = await db
      .prepare(
        `SELECT id,
                criado_em,
                grupo_chave,
                unidade,
                documentos_json,
                quantidade_alunos,
                quantidade_emails,
                assunto,
                prazo,
                tipo_destinatario,
                ras_json
         FROM comunicacoes
         WHERE periodo_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .bind(periodoId, limite)
      .all<ComunicacaoRow>();

    return Response.json(
      resultado.results.map((registro) => ({
        id: registro.id,
        criado_em: registro.criado_em,
        grupo_chave: registro.grupo_chave,
        unidade: registro.unidade,
        documentos: JSON.parse(registro.documentos_json || "[]"),
        quantidade_alunos: registro.quantidade_alunos,
        quantidade_emails: modoApresentacao
          ? 0
          : registro.quantidade_emails,
        assunto: registro.assunto,
        prazo: registro.prazo,
        tipo_destinatario: registro.tipo_destinatario,
        ras: modoApresentacao
          ? []
          : JSON.parse(registro.ras_json || "[]"),
      })),
    );
  } catch (erro) {
    console.error(erro);
    return Response.json(
      {
        erro: "Histórico indisponível. Execute a migration 001_comunicacoes.sql no D1.",
      },
      { status: 500 },
    );
  }
}

async function registrarComunicacao(
  request: Request,
  db: D1Database,
  periodoId: number,
) {
  try {
    const body = await request.json<ComunicacaoBody>();
    if (
      !body.grupo_chave ||
      !Array.isArray(body.documentos) ||
      !Array.isArray(body.ras) ||
      body.quantidade_alunos < 1
    ) {
      return Response.json(
        { erro: "Dados insuficientes para registrar a cobrança." },
        { status: 400 },
      );
    }

    const resultado = await db
      .prepare(
        `INSERT INTO comunicacoes (
           grupo_chave, unidade, documentos_json, quantidade_alunos,
           quantidade_emails, assunto, prazo, tipo_destinatario,
           ras_json, periodo_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.grupo_chave,
        body.unidade || "TODAS",
        JSON.stringify(body.documentos),
        body.quantidade_alunos,
        body.quantidade_emails,
        body.assunto || "",
        body.prazo || "",
        body.tipo_destinatario || "institucional",
        JSON.stringify(body.ras),
        periodoId,
      )
      .run();

    return Response.json(
      { sucesso: true, id: resultado.meta.last_row_id },
      { status: 201 },
    );
  } catch (erro) {
    console.error(erro);
    return Response.json(
      {
        erro: "Não foi possível registrar a cobrança. Verifique se a migration 001_comunicacoes.sql foi executada.",
      },
      { status: 500 },
    );
  }
}

export async function handleComunicacoesRoute({
  request,
  url,
  db,
  periodoId,
  modoApresentacao,
}: ComunicacoesRouteContext): Promise<Response | null> {
  if (url.pathname !== "/api/comunicacoes") return null;

  if (request.method === "GET") {
    return listarComunicacoes(url, db, periodoId, modoApresentacao);
  }
  if (request.method === "POST") {
    if (modoApresentacao) {
      return Response.json(
        { erro: "Ação indisponível no modo apresentação." },
        { status: 403 },
      );
    }
    return registrarComunicacao(request, db, periodoId);
  }

  return null;
}
