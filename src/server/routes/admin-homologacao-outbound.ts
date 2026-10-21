import type { UsuarioSessao } from "./auth";
import { GoogleSheetsRealAdapter } from "../services/sync-sheet-real-adapter";

const FICTIONAL_SPREADSHEET_ID = "1dRU6_O37tOThxga93TqeTgCMnv1dw8FboD0pDVV5kcE";

export interface AdminHomologOutboundContext {
  request: Request;
  url: URL;
  db: D1Database;
  env: {
    ENVIRONMENT?: string;
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  };
  usuarioAtual: UsuarioSessao | null;
}

export async function handleAdminHomologOutboundRoute({
  request,
  url,
  db,
  env,
  usuarioAtual,
}: AdminHomologOutboundContext): Promise<Response | null> {
  const prefix = "/api/admin/homologacao/planilha-ficticia";
  if (!url.pathname.startsWith(prefix)) return null;

  // 1. Barreira estrita: Exclusivo de homologação
  if (env.ENVIRONMENT !== "homolog") {
    return Response.json(
      { erro: "Rota disponível exclusivamente no ambiente de homologação." },
      { status: 403 },
    );
  }

  // 2. Barreira estrita: Exclusivo para administradores autenticados
  if (!usuarioAtual || usuarioAtual.perfil !== "ADMIN") {
    return Response.json(
      { erro: "Acesso restrito a administradores." },
      { status: 403 },
    );
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return Response.json(
      { erro: "GOOGLE_SERVICE_ACCOUNT_JSON não configurada." },
      { status: 503 },
    );
  }

  const adapter = new GoogleSheetsRealAdapter({
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    readOnly: false,
  });

  // -------------------------------------------------------------------------
  // A. GET .../backup — Lê estado de backup completo (D1 e Planilha Fictícia)
  // -------------------------------------------------------------------------
  if (url.pathname === `${prefix}/backup` && request.method === "GET") {
    // 1. D1: alunos e documentos do período 999
    const alunosD1 = await db
      .prepare(
        `SELECT a.id, a.ra, a.nome, a.unidade, a.curso,
                d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
         FROM alunos a
         JOIN documentos d ON d.aluno_id = a.id
         WHERE a.periodo_id = 999
         ORDER BY a.id ASC`,
      )
      .all();

    const baselinesD1 = await db
      .prepare(
        `SELECT record_id, field_key, value, revision, status
         FROM sync_field_state
         WHERE record_id LIKE 'rec-999-%'
         ORDER BY record_id, field_key`,
      )
      .all();

    // 2. Planilha: ranges A1:K10 das abas
    const tabsToRead = [
      "CONTROLE DE DOCUMENTOS FACE FEA",
      "CONTROLE DE DOCUMENTOS FCH EAD",
      "BASE_FACE_FEA",
      "BASE_FCH_EAD",
    ];

    const sheetsData: Record<string, any> = {};
    for (const tab of tabsToRead) {
      try {
        const range = `'${tab}'!A1:K10`;
        const urlFetch = `https://sheets.googleapis.com/v4/spreadsheets/${FICTIONAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
        const res = await (adapter as any).fetchSheetsApi(urlFetch);
        if (res.ok) {
          const json = await res.json();
          sheetsData[tab] = json.values || [];
        } else {
          sheetsData[tab] = { erro: `HTTP ${res.status}` };
        }
      } catch (err: any) {
        sheetsData[tab] = { erro: err.message };
      }
    }

    return Response.json({
      sucesso: true,
      timestamp: new Date().toISOString(),
      spreadsheetId: FICTIONAL_SPREADSHEET_ID,
      d1: {
        alunos: alunosD1.results,
        baselines: baselinesD1.results,
      },
      planilha: sheetsData,
    });
  }

  // -------------------------------------------------------------------------
  // B. POST .../alinhar-situacao — Configura "Em curso" nas abas base fictícias
  //    e testa a permissão de EDITOR da Service Account na planilha fictícia
  // -------------------------------------------------------------------------
  if (url.pathname === `${prefix}/alinhar-situacao` && request.method === "POST") {
    // Alinha células A2:A3 das abas gerais fictícias para "Em curso"
    const tabs = ["BASE_FACE_FEA", "BASE_FCH_EAD"];
    const results: Record<string, any> = {};

    for (const tab of tabs) {
      const range = `'${tab}'!A2:A3`;
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${FICTIONAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
      const res = await (adapter as any).fetchSheetsApi(updateUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          range,
          majorDimension: "ROWS",
          values: [["Em curso"], ["Em curso"]],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return Response.json(
          {
            sucesso: false,
            erro: `Falha ao escrever na planilha fictícia (${tab}): HTTP ${res.status} ${errText}`,
            permisaoEditorConfirmada: false,
          },
          { status: 500 },
        );
      }
      results[tab] = await res.json();
    }

    return Response.json({
      sucesso: true,
      mensagem: "Abas base fictícias alinhadas para 'Em curso'. Permissão de Editor da Service Account confirmada com sucesso!",
      permisaoEditorConfirmada: true,
      detalhes: results,
    });
  }

  // -------------------------------------------------------------------------
  // C. GET .../conferir-celula — Inspeciona uma célula individual na planilha
  // -------------------------------------------------------------------------
  if (url.pathname === `${prefix}/conferir-celula` && request.method === "GET") {
    const tab = url.searchParams.get("aba");
    const cell = url.searchParams.get("celula");
    if (!tab || !cell) {
      return Response.json({ erro: "Parâmetros 'aba' e 'celula' obrigatórios." }, { status: 400 });
    }

    const range = `'${tab}'!${cell}`;
    const urlFetch = `https://sheets.googleapis.com/v4/spreadsheets/${FICTIONAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await (adapter as any).fetchSheetsApi(urlFetch);
    const json = await res.json();
    const rawVal = json?.values?.[0]?.[0] ?? null;

    return Response.json({
      sucesso: true,
      tab,
      cell,
      valor: rawVal,
      tipo: typeof rawVal,
    });
  }

  return null;
}
