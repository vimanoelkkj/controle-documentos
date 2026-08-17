import { aguardar } from "../utils/async";

export type SheetsConfig = {
  periodo_id: number;
  spreadsheet_id: string;
  aba_base_face_fea: string;
  aba_base_fch_ead: string;
  aba_docs_face_fea: string;
  aba_docs_fch_ead: string;
  aba_cancelados_face_fea: string;
  aba_cancelados_fch_ead: string;
  atualizado_em?: string;
};

type EventoSheetsConfig = {
  acao: "CONFIGURAR" | "MAPEAR_UNIDADE";
  entidade: "GOOGLE_SHEETS";
  descricao: string;
  unidade?: string;
};

type SheetsConfigRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  extrairSpreadsheetId: (valor: string) => string;
  normalizarTexto: (valor: unknown) => string;
  normalizarComparacao: (valor: unknown) => string;
  testarConexao: (
    config: SheetsConfig,
  ) => Promise<{ properties?: { title?: string } }>;
  registrarAuditoria: (
    periodoId: number,
    evento: EventoSheetsConfig,
  ) => Promise<void>;
};

export async function handleGoogleSheetsConfigRoute({
  request,
  url,
  db,
  extrairSpreadsheetId,
  normalizarTexto,
  normalizarComparacao,
  testarConexao,
  registrarAuditoria,
}: SheetsConfigRouteContext): Promise<Response | null> {
  const rotaStatus = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets\/status$/,
  );
  if (rotaStatus && request.method === "GET") {
    const periodoId = Number(rotaStatus[1]);
    const config = await db
      .prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`)
      .bind(periodoId)
      .first<SheetsConfig>();
    if (!config) {
      return Response.json({
        configurado: false,
        conectado: false,
        spreadsheet_id: null,
        titulo: null,
        erro: null,
      });
    }
    try {
      const planilha = await testarConexao(config);
      return Response.json({
        configurado: true,
        conectado: true,
        spreadsheet_id: config.spreadsheet_id,
        titulo: planilha.properties?.title || null,
        erro: null,
      });
    } catch (erro) {
      console.error("Falha ao testar conexão com Google Sheets.", erro);
      return Response.json({
        configurado: true,
        conectado: false,
        spreadsheet_id: config.spreadsheet_id,
        titulo: null,
        erro:
          erro instanceof Error
            ? erro.message
            : "Não foi possível validar a conexão com o Google Sheets.",
      });
    }
  }

  const rotaConfig = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets$/,
  );
  if (rotaConfig && request.method === "GET") {
    const periodoId = Number(rotaConfig[1]);
    let ultimoErro: unknown = null;
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      try {
        const config = await db
          .prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`)
          .bind(periodoId)
          .first<SheetsConfig>();
        return Response.json(config ?? null);
      } catch (erro) {
        ultimoErro = erro;
        console.warn(
          `Falha temporária ao ler configuração do Google Sheets (tentativa ${tentativa}/3).`,
          erro,
        );
        if (tentativa < 3) await aguardar(tentativa * 200);
      }
    }
    console.error(
      "D1 indisponível ao carregar configuração do Google Sheets.",
      ultimoErro,
    );
    return Response.json(
      {
        erro: "Configuração do Google Sheets temporariamente indisponível.",
        codigo: "SHEETS_CONFIG_STORAGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  if (rotaConfig && request.method === "PUT") {
    try {
      const periodoId = Number(rotaConfig[1]);
      const body = await request.json<
        Omit<SheetsConfig, "periodo_id"> & { spreadsheet_id: string }
      >();
      const spreadsheetId = extrairSpreadsheetId(body.spreadsheet_id || "");
      const campos = [
        spreadsheetId,
        body.aba_base_face_fea,
        body.aba_base_fch_ead,
        body.aba_docs_face_fea,
        body.aba_docs_fch_ead,
        body.aba_cancelados_face_fea,
        body.aba_cancelados_fch_ead,
      ].map(normalizarTexto);
      if (campos.some((campo) => !campo)) {
        return Response.json(
          { erro: "Preencha a planilha e as seis abas da integração." },
          { status: 400 },
        );
      }
      await db
        .prepare(
          `INSERT INTO google_sheets_periodos (
             periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
             aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea,
             aba_cancelados_fch_ead, atualizado_em
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(periodo_id) DO UPDATE SET
             spreadsheet_id = excluded.spreadsheet_id,
             aba_base_face_fea = excluded.aba_base_face_fea,
             aba_base_fch_ead = excluded.aba_base_fch_ead,
             aba_docs_face_fea = excluded.aba_docs_face_fea,
             aba_docs_fch_ead = excluded.aba_docs_fch_ead,
             aba_cancelados_face_fea = excluded.aba_cancelados_face_fea,
             aba_cancelados_fch_ead = excluded.aba_cancelados_fch_ead,
             atualizado_em = CURRENT_TIMESTAMP`,
        )
        .bind(periodoId, ...campos)
        .run();
      await registrarAuditoria(periodoId, {
        acao: "CONFIGURAR",
        entidade: "GOOGLE_SHEETS",
        descricao: "Configuração da planilha e nomes das abas atualizados.",
      });
      return Response.json({ sucesso: true, spreadsheet_id: spreadsheetId });
    } catch (erro) {
      console.error("Falha ao salvar configuração do Google Sheets:", erro);
      return Response.json(
        { erro: "Não foi possível salvar a integração com Google Sheets." },
        { status: 500 },
      );
    }
  }

  const rotaMapeamentos = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets\/mapeamentos$/,
  );
  if (rotaMapeamentos && request.method === "GET") {
    const periodoId = Number(rotaMapeamentos[1]);
    const dados = await db
      .prepare(
        `SELECT curso, unidade FROM google_sheets_mapeamentos
         WHERE periodo_id = ? ORDER BY curso`,
      )
      .bind(periodoId)
      .all<{ curso: string; unidade: string }>();
    return Response.json(dados.results);
  }

  if (rotaMapeamentos && request.method === "PUT") {
    try {
      const periodoId = Number(rotaMapeamentos[1]);
      const body = await request.json<{ curso?: string; unidade?: string }>();
      const curso = normalizarTexto(body.curso);
      const cursoChave = normalizarComparacao(curso);
      const unidade = normalizarComparacao(body.unidade);
      if (!curso || !["FACE", "FEA", "FCH", "EAD"].includes(unidade)) {
        return Response.json(
          { erro: "Informe um curso e uma unidade válida." },
          { status: 400 },
        );
      }
      await db
        .prepare(
          `INSERT INTO google_sheets_mapeamentos
             (periodo_id, curso_chave, curso, unidade, atualizado_em)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(periodo_id, curso_chave) DO UPDATE SET
             curso = excluded.curso,
             unidade = excluded.unidade,
             atualizado_em = CURRENT_TIMESTAMP`,
        )
        .bind(periodoId, cursoChave, curso, unidade)
        .run();
      await registrarAuditoria(periodoId, {
        acao: "MAPEAR_UNIDADE",
        entidade: "GOOGLE_SHEETS",
        descricao: `Curso ${curso} mapeado para a unidade ${unidade}.`,
        unidade,
      });
      return Response.json({ sucesso: true, curso, unidade });
    } catch (erro) {
      console.error("Falha ao salvar mapeamento do Google Sheets:", erro);
      return Response.json(
        { erro: "Não foi possível salvar o mapeamento de curso." },
        { status: 500 },
      );
    }
  }

  return null;
}
