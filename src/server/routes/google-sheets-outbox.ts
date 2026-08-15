import type { SheetsConfig } from "./google-sheets-config";

import type { UsuarioSessao } from "./auth";
import { emModoApresentacao } from "../middleware/autorizacao";

type Aluno = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

export type GoogleSheetRange = {
  aba: string;
  linhas: unknown[][];
};

type Escrita = { range: string; values: unknown[][] };
type Pendencia = {
  id: number;
  ra: string;
  operacao: "ATUALIZAR" | "REMOVER";
  payload_json: string | null;
  status: string;
  atualizado_em: string;
};

type Dependencias = {
  request: Request;
  url: URL;
  db: D1Database;
  usuarioAtual: UsuarioSessao | null;
  normalizarTexto: (valor: unknown) => string;
  normalizarComparacao: (valor: unknown) => string;
  lerRanges: (config: SheetsConfig) => Promise<GoogleSheetRange[]>;
  escreverValores: (config: SheetsConfig, escritas: Escrita[]) => Promise<void>;
  registrarAuditoria: (
    periodoId: number,
    evento: {
      acao: string;
      entidade: string;
      descricao: string;
    },
  ) => Promise<void>;
};

function indiceRa(
  range: GoogleSheetRange,
  tipo: "BASE" | "DOCS" | "CANCELADOS",
  normalizar: (valor: unknown) => string,
) {
  const encontrados = (range.linhas[0] ?? [])
    .map((valor, indice) => ({
      valor: normalizar(valor).replace(/[^A-Z0-9]/g, ""),
      indice,
    }))
    .filter((item) => item.valor === "RA");
  if (encontrados.length !== 1)
    throw new Error(
      `A aba ${range.aba} precisa ter exatamente uma coluna com o cabeçalho RA.`,
    );
  const indice = encontrados[0].indice;
  if (tipo === "BASE" && indice !== 5)
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser a coluna F.`);
  if (tipo === "DOCS" && indice !== 0)
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser a coluna A.`);
  if (tipo === "CANCELADOS" && indice !== 0 && indice !== 5)
    throw new Error(`A coluna RA da aba ${range.aba} precisa ser A ou F.`);
  return indice;
}

function linhasPorRa(
  range: GoogleSheetRange,
  indice: number,
  normalizar: (valor: unknown) => string,
) {
  const mapa = new Map<string, number[]>();
  range.linhas.slice(1).forEach((linha, offset) => {
    const ra = normalizar(linha[indice]);
    if (!ra) return;
    const existentes = mapa.get(ra) ?? [];
    existentes.push(offset + 2);
    mapa.set(ra, existentes);
  });
  return mapa;
}

const linhaBase = (aluno: Aluno) => [
  aluno.contrato ? "ENTREGUE" : "",
  aluno.curso,
  aluno.email_outro ?? "",
  aluno.email ?? "",
  aluno.nome,
  aluno.ra,
];
const linhaDocumentos = (aluno: Aluno) => [
  aluno.ra,
  aluno.nome,
  Boolean(aluno.identidade),
  Boolean(aluno.cpf),
  Boolean(aluno.certidao),
  Boolean(aluno.residencia),
  Boolean(aluno.titulo),
  Boolean(aluno.ensino_medio),
  Boolean(aluno.contrato),
];
function linhaCancelado(aluno: Aluno, indice: number) {
  if (indice === 5) return linhaBase(aluno);
  const linha = Array(Math.max(indice + 1, 1)).fill("");
  linha[indice] = aluno.ra;
  return linha;
}
const abaA1 = (aba: string) => `'${aba.replace(/'/g, "''")}'`;
function colunaA1(indice: number) {
  let numero = indice + 1;
  let coluna = "";
  while (numero > 0) {
    numero -= 1;
    coluna = String.fromCharCode(65 + (numero % 26)) + coluna;
    numero = Math.floor(numero / 26);
  }
  return coluna;
}
const escritaLinha = (
  aba: string,
  linha: number,
  valores: unknown[],
): Escrita => ({
  range: `${abaA1(aba)}!A${linha}:${colunaA1(valores.length - 1)}${linha}`,
  values: [valores],
});
const limparLinha = (range: GoogleSheetRange, linha: number) =>
  escritaLinha(
    range.aba,
    linha,
    Array(Math.max(range.linhas[0]?.length ?? 0, 11)).fill(""),
  );

export async function handleGoogleSheetsOutboxRoute({
  request,
  url,
  db,
  usuarioAtual,
  normalizarTexto,
  normalizarComparacao,
  lerRanges,
  escreverValores,
  registrarAuditoria,
}: Dependencias): Promise<Response | null> {
  const rota = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets\/pendencias$/,
  );
  if (!rota) return null;
  const periodoId = Number(rota[1]);

  if (request.method === "GET") {
    try {
      const resultado = await db
        .prepare(
          `
        SELECT id, ra, operacao, payload_json, status, tentativas, motivos,
               ultimo_erro, usuario_nome, usuario_username, criado_em, atualizado_em
        FROM google_sheets_pendencias
        WHERE periodo_id = ? AND status <> 'CONCLUIDA'
        ORDER BY atualizado_em DESC, id DESC
      `,
        )
        .bind(periodoId)
        .all<{
          id: number;
          ra: string;
          operacao: "ATUALIZAR" | "REMOVER";
          payload_json: string | null;
          status: "PENDENTE" | "ENVIANDO" | "CONFLITO" | "ERRO";
          tentativas: number;
          motivos: string;
          ultimo_erro: string | null;
          usuario_nome: string | null;
          usuario_username: string | null;
          criado_em: string;
          atualizado_em: string;
        }>();
      const pendencias = resultado.results.map((item) => {
        let payload: Aluno | null = null;
        try {
          payload = item.payload_json
            ? (JSON.parse(item.payload_json) as Aluno)
            : null;
        } catch {
          payload = null;
        }
        return {
          ...item,
          payload_json: undefined,
          motivos: item.motivos.split("|").filter(Boolean),
          aluno: payload
            ? {
                nome: payload.nome,
                curso: payload.curso,
                unidade: payload.unidade,
                status: payload.status,
                documentos: {
                  identidade: Boolean(payload.identidade),
                  cpf: Boolean(payload.cpf),
                  certidao: Boolean(payload.certidao),
                  residencia: Boolean(payload.residencia),
                  titulo: Boolean(payload.titulo),
                  ensino_medio: Boolean(payload.ensino_medio),
                  contrato: Boolean(payload.contrato),
                },
              }
            : null,
        };
      });
      return Response.json({
        modo: "PREVIA_SOMENTE_LEITURA",
        total: pendencias.length,
        atualizar: pendencias.filter((item) => item.operacao === "ATUALIZAR")
          .length,
        remover: pendencias.filter((item) => item.operacao === "REMOVER")
          .length,
        conflitos: pendencias.filter((item) => item.status === "CONFLITO")
          .length,
        erros: pendencias.filter((item) => item.status === "ERRO").length,
        pendencias,
      });
    } catch (erro) {
      console.error("Falha ao listar pendencias do Google Sheets:", erro);
      return Response.json(
        {
          erro: "A caixa de saída ainda não está disponível. Aplique a migration 008.",
        },
        { status: 500 },
      );
    }
  }

  if (request.method !== "POST") return null;
  if (
    !usuarioAtual ||
    usuarioAtual.perfil !== "ADMIN" ||
    emModoApresentacao(usuarioAtual)
  ) {
    return Response.json(
      { erro: "Apenas administradores podem enviar alterações à planilha." },
      { status: 403 },
    );
  }
  const body = await request.json<{ confirmacao?: string }>();
  if (normalizarComparacao(body.confirmacao) !== "SINCRONIZAR") {
    return Response.json(
      { erro: 'Digite "SINCRONIZAR" para confirmar o envio.' },
      { status: 400 },
    );
  }
  const periodo = await db
    .prepare("SELECT id, codigo, status FROM periodos WHERE id = ?")
    .bind(periodoId)
    .first<{ id: number; codigo: string; status: string }>();
  if (!periodo)
    return Response.json({ erro: "Período não encontrado." }, { status: 404 });
  if (periodo.status !== "ATIVO")
    return Response.json(
      { erro: "A escrita está bloqueada para períodos arquivados." },
      { status: 409 },
    );
  const config = await db
    .prepare("SELECT * FROM google_sheets_periodos WHERE periodo_id = ?")
    .bind(periodoId)
    .first<SheetsConfig>();
  if (!config)
    return Response.json(
      { erro: "Configure a planilha deste período primeiro." },
      { status: 409 },
    );

  await db
    .prepare(
      `UPDATE google_sheets_pendencias SET status = 'ERRO',
      ultimo_erro = 'Execução anterior interrompida; pronta para nova tentativa.',
      atualizado_em = CURRENT_TIMESTAMP WHERE periodo_id = ? AND status = 'ENVIANDO'
      AND atualizado_em < datetime('now', '-15 minutes')`,
    )
    .bind(periodoId)
    .run();
  const resultado = await db
    .prepare(
      `SELECT id, ra, operacao, payload_json, status, atualizado_em
      FROM google_sheets_pendencias WHERE periodo_id = ?
      AND status IN ('PENDENTE', 'ERRO', 'CONFLITO') ORDER BY id LIMIT 200`,
    )
    .bind(periodoId)
    .all<Pendencia>();
  if (!resultado.results.length)
    return Response.json({ sucesso: true, enviados: 0, conflitos: 0 });

  try {
    const ranges = await lerRanges(config);
    const bases = ranges.slice(0, 2),
      documentos = ranges.slice(2, 4),
      cancelados = ranges.slice(4, 6);
    const indices = new Map<string, number>();
    bases.forEach((r) =>
      indices.set(r.aba, indiceRa(r, "BASE", normalizarComparacao)),
    );
    documentos.forEach((r) =>
      indices.set(r.aba, indiceRa(r, "DOCS", normalizarComparacao)),
    );
    cancelados.forEach((r) =>
      indices.set(r.aba, indiceRa(r, "CANCELADOS", normalizarComparacao)),
    );
    const mapas = new Map(
      ranges.map((r) => [
        r.aba,
        linhasPorRa(r, indices.get(r.aba)!, normalizarTexto),
      ]),
    );
    const proximas = new Map(
      ranges.map((r) => [r.aba, Math.max(r.linhas.length + 1, 2)]),
    );
    const escritas: Escrita[] = [],
      elegiveis: number[] = [];
    const conflitos: Array<{ id: number; ra: string; erro: string }> = [];
    const ocorrencias = (grupo: GoogleSheetRange[], ra: string) =>
      grupo.flatMap((r) =>
        (mapas.get(r.aba)?.get(ra) ?? []).map((linha) => ({ range: r, linha })),
      );
    const novaLinha = (r: GoogleSheetRange) => {
      const linha = proximas.get(r.aba)!;
      proximas.set(r.aba, linha + 1);
      return linha;
    };

    for (const pendencia of resultado.results) {
      try {
        const atuais: Escrita[] = [];
        const emBases = ocorrencias(bases, pendencia.ra),
          emDocs = ocorrencias(documentos, pendencia.ra),
          emCancelados = ocorrencias(cancelados, pendencia.ra);
        if (emBases.length > 1 || emDocs.length > 1 || emCancelados.length > 1)
          throw new Error("RA duplicado em uma ou mais abas da planilha.");
        if (pendencia.operacao === "REMOVER") {
          [...emBases, ...emDocs, ...emCancelados].forEach(({ range, linha }) =>
            atuais.push(limparLinha(range, linha)),
          );
          escritas.push(...atuais);
          elegiveis.push(pendencia.id);
          continue;
        }
        const aluno = pendencia.payload_json
          ? (JSON.parse(pendencia.payload_json) as Aluno)
          : null;
        if (!aluno)
          throw new Error("Payload da pendência está ausente ou inválido.");
        const grupo =
          aluno.unidade === "FACE" || aluno.unidade === "FEA"
            ? 0
            : aluno.unidade === "FCH" || aluno.unidade === "EAD"
              ? 1
              : -1;
        if (grupo < 0)
          throw new Error(
            `Unidade ${aluno.unidade || "vazia"} não reconhecida.`,
          );
        const base = bases[grupo],
          docs = documentos[grupo],
          cancel = cancelados[grupo];
        if (emBases[0] && emBases[0].range.aba !== base.aba)
          throw new Error(
            `RA encontrado na aba inesperada ${emBases[0].range.aba}.`,
          );
        if (emDocs[0] && emDocs[0].range.aba !== docs.aba)
          throw new Error(
            `Documentos encontrados na aba inesperada ${emDocs[0].range.aba}.`,
          );
        atuais.push(
          escritaLinha(
            base.aba,
            emBases[0]?.linha ?? novaLinha(base),
            linhaBase(aluno),
          ),
        );
        atuais.push(
          escritaLinha(
            docs.aba,
            emDocs[0]?.linha ?? novaLinha(docs),
            linhaDocumentos(aluno),
          ),
        );
        if (aluno.status === "CANCELADO") {
          if (emCancelados[0] && emCancelados[0].range.aba !== cancel.aba)
            throw new Error(
              `Cancelamento encontrado na aba inesperada ${emCancelados[0].range.aba}.`,
            );
          atuais.push(
            escritaLinha(
              cancel.aba,
              emCancelados[0]?.linha ?? novaLinha(cancel),
              linhaCancelado(aluno, indices.get(cancel.aba)!),
            ),
          );
        } else
          emCancelados.forEach(({ range, linha }) =>
            atuais.push(limparLinha(range, linha)),
          );
        escritas.push(...atuais);
        elegiveis.push(pendencia.id);
      } catch (erro) {
        conflitos.push({
          id: pendencia.id,
          ra: pendencia.ra,
          erro:
            erro instanceof Error ? erro.message : "Conflito não identificado.",
        });
      }
    }
    if (conflitos.length)
      await db.batch(
        conflitos.map((item) =>
          db
            .prepare(
              "UPDATE google_sheets_pendencias SET status = 'CONFLITO', ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(item.erro, item.id),
        ),
      );
    const execucaoId = crypto.randomUUID();
    if (elegiveis.length)
      await db.batch(
        elegiveis.map((id) =>
          db
            .prepare(
              `UPDATE google_sheets_pendencias
      SET status = 'ENVIANDO', tentativas = tentativas + 1, ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('PENDENTE', 'ERRO', 'CONFLITO')`,
            )
            .bind(execucaoId, id),
        ),
      );
    const reivindicadas = elegiveis.length
      ? await db
          .prepare(
            `SELECT id FROM google_sheets_pendencias
      WHERE periodo_id = ? AND status = 'ENVIANDO' AND ultimo_erro = ?`,
          )
          .bind(periodoId, execucaoId)
          .all<{ id: number }>()
      : { results: [] };
    if (reivindicadas.results.length !== elegiveis.length)
      throw new Error(
        "Outra sincronização assumiu parte das pendências. Atualize a prévia.",
      );
    try {
      await escreverValores(config, escritas);
      if (elegiveis.length)
        await db.batch(
          elegiveis.map((id) =>
            db
              .prepare(
                `UPDATE google_sheets_pendencias
        SET status = 'CONCLUIDA', ultimo_erro = NULL, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND ultimo_erro = ?`,
              )
              .bind(id, execucaoId),
          ),
        );
    } catch (erro) {
      const mensagem =
        erro instanceof Error
          ? erro.message
          : "Falha ao escrever no Google Sheets.";
      if (elegiveis.length)
        await db.batch(
          elegiveis.map((id) =>
            db
              .prepare(
                `UPDATE google_sheets_pendencias
        SET status = 'ERRO', ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND ultimo_erro = ?`,
              )
              .bind(mensagem, id, execucaoId),
          ),
        );
      throw erro;
    }
    await registrarAuditoria(periodoId, {
      acao: "SINCRONIZAR",
      entidade: "GOOGLE_SHEETS",
      descricao: `${elegiveis.length} pendência(s) enviada(s) à planilha; ${conflitos.length} conflito(s) bloqueado(s).`,
    });
    return Response.json({
      sucesso: true,
      enviados: elegiveis.length,
      conflitos: conflitos.length,
      detalhes_conflitos: conflitos,
    });
  } catch (erro) {
    console.error("Falha na escrita segura do Google Sheets:", erro);
    return Response.json(
      {
        erro:
          erro instanceof Error
            ? erro.message
            : "Não foi possível escrever no Google Sheets.",
      },
      { status: 500 },
    );
  }
}
