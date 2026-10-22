import type { UsuarioSessao } from "./auth";
import { emModoApresentacao } from "../middleware/autorizacao";

type EventoAuditoriaPeriodo = {
  acao: string;
  entidade: string;
  descricao: string;
};

type PeriodosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  usuarioAtual?: UsuarioSessao | null;
  registrarAuditoria: (
    periodoId: number,
    evento: EventoAuditoriaPeriodo,
  ) => Promise<void>;
};

type PeriodoComTotal = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  criado_em: string;
  atualizado_em: string;
  total_alunos: number;
};

function exigirAdminAtivo(usuarioAtual?: UsuarioSessao | null): Response | null {
  if (!usuarioAtual) {
    return Response.json(
      { erro: "Sessão expirada ou não autenticada.", codigo: "NAO_AUTENTICADO" },
      { status: 401 },
    );
  }
  if (emModoApresentacao(usuarioAtual)) {
    return Response.json(
      {
        erro: "Ação indisponível no modo apresentação.",
        codigo: "MODO_APRESENTACAO_BLOQUEADO",
      },
      { status: 403 },
    );
  }
  const isAdmin =
    usuarioAtual.perfil === "ADMIN" || (usuarioAtual as any).role === "ADMIN";
  if (!isAdmin) {
    return Response.json(
      {
        erro: "Apenas administradores podem gerenciar períodos letivos.",
        codigo: "PRIVILEGIO_INSUFICIENTE",
      },
      { status: 403 },
    );
  }
  return null;
}

export async function handlePeriodosRoute({
  request,
  url,
  db,
  usuarioAtual,
  registrarAuditoria,
}: PeriodosRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/periodos" && request.method === "GET") {
    try {
      const resultado = await db
        .prepare(
          `
          SELECT
            p.id, p.codigo, p.status, p.criado_em, p.atualizado_em,
            COUNT(a.id) AS total_alunos
          FROM periodos p
          LEFT JOIN alunos a ON a.periodo_id = p.id
          GROUP BY p.id
          ORDER BY p.codigo DESC
        `,
        )
        .all<PeriodoComTotal>();
      return Response.json(resultado.results);
    } catch (erro) {
      console.error(erro);
      return Response.json(
        {
          erro: "Períodos indisponíveis. Execute a migration 003_periodos.sql no D1.",
        },
        { status: 500 },
      );
    }
  }

  if (url.pathname === "/api/periodos" && request.method === "POST") {
    const bloqueio = exigirAdminAtivo(usuarioAtual);
    if (bloqueio) return bloqueio;

    let body: { codigo?: string };
    try {
      body = await request.json<{ codigo?: string }>();
    } catch {
      return Response.json(
        { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
        { status: 400 },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
        { status: 400 },
      );
    }

    try {
      const codigo =
        typeof body.codigo === "string" ? body.codigo.trim().toUpperCase() : "";
      if (!/^\d{4}-(1|2)$/.test(codigo || "")) {
        return Response.json(
          { erro: "Período inválido. Use AAAA-1 ou AAAA-2." },
          { status: 400 },
        );
      }

      const existente = await db
        .prepare(`SELECT id FROM periodos WHERE codigo = ?`)
        .bind(codigo)
        .first();
      if (existente) {
        return Response.json(
          { erro: "Este período já existe." },
          { status: 409 },
        );
      }

      const resultado = await db
        .prepare(`INSERT INTO periodos (codigo, status) VALUES (?, 'ATIVO')`)
        .bind(codigo)
        .run();
      const periodoId = Number(resultado.meta.last_row_id);

      // Herda os mapeamentos de curso do período imediatamente anterior.
      // A cópia fica vinculada ao novo período, preservando o histórico anterior.
      const periodoAnterior = await db
        .prepare(
          `SELECT id, codigo
           FROM periodos
           WHERE codigo < ?
           ORDER BY codigo DESC
           LIMIT 1`,
        )
        .bind(codigo)
        .first<{ id: number; codigo: string }>();

      if (periodoAnterior) {
        await db
          .prepare(
            `INSERT INTO google_sheets_mapeamentos
               (periodo_id, curso_chave, curso, unidade, atualizado_em)
             SELECT ?, curso_chave, curso, unidade, CURRENT_TIMESTAMP
             FROM google_sheets_mapeamentos
             WHERE periodo_id = ?
             ON CONFLICT(periodo_id, curso_chave) DO NOTHING`,
          )
          .bind(periodoId, periodoAnterior.id)
          .run();
      }

      await registrarAuditoria(periodoId, {
        acao: "CRIAR",
        entidade: "PERIODO",
        descricao: `Período letivo ${codigo} criado.`,
      });

      return Response.json(
        { sucesso: true, id: resultado.meta.last_row_id, codigo },
        { status: 201 },
      );
    } catch (erro) {
      console.error(erro);
      return Response.json(
        { erro: "Não foi possível criar o período." },
        { status: 500 },
      );
    }
  }

  const rotaPeriodo = url.pathname.match(/^\/api\/periodos\/(\d+)$/);
  if (!rotaPeriodo || request.method !== "PUT") return null;

  const bloqueio = exigirAdminAtivo(usuarioAtual);
  if (bloqueio) return bloqueio;

  const id = Number(rotaPeriodo[1]);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json(
      { erro: "ID de período inválido.", codigo: "PERIODO_INVALIDO" },
      { status: 400 },
    );
  }

  let body: { status?: "ATIVO" | "ARQUIVADO" };
  try {
    body = await request.json<{ status?: "ATIVO" | "ARQUIVADO" }>();
  } catch {
    return Response.json(
      { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { erro: "Corpo JSON inválido.", codigo: "JSON_INVALIDO" },
      { status: 400 },
    );
  }

  try {
    if (!body.status || !["ATIVO", "ARQUIVADO"].includes(body.status)) {
      return Response.json(
        { erro: "Status de período inválido." },
        { status: 400 },
      );
    }

    const periodo = await db
      .prepare(`SELECT id, codigo FROM periodos WHERE id = ?`)
      .bind(id)
      .first<{ id: number; codigo: string }>();
    if (!periodo) {
      return Response.json(
        { erro: "Período não encontrado." },
        { status: 404 },
      );
    }

    await db
      .prepare(
        `UPDATE periodos SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status, id)
      .run();
    await registrarAuditoria(id, {
      acao: body.status === "ARQUIVADO" ? "ARQUIVAR" : "REATIVAR",
      entidade: "PERIODO",
      descricao: `Período ${periodo.codigo} alterado para ${body.status}.`,
    });

    return Response.json({
      sucesso: true,
      id,
      codigo: periodo.codigo,
      status: body.status,
    });
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível alterar o período." },
      { status: 500 },
    );
  }
}
