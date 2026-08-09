/// <reference path="../worker-configuration.d.ts" />

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type AlunoRow = {
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

type DadosAluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email?: string;
  email_outro?: string;
  documentos?: DocumentosBody;
};

type DocumentosBody = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};


type PeriodoRow = {
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

async function obterPeriodoAtual(request: Request, env: Env, url: URL) {
  const codigo = url.searchParams.get("periodo") || obterCookie(request, "periodo");

  if (codigo) {
    const periodo = await env.DB.prepare(
      `SELECT id, codigo, status, criado_em, atualizado_em FROM periodos WHERE codigo = ?`,
    )
      .bind(codigo)
      .first<PeriodoRow>();
    if (periodo) return periodo;
  }

  return env.DB.prepare(
    `SELECT id, codigo, status, criado_em, atualizado_em FROM periodos ORDER BY CASE status WHEN 'ATIVO' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
  ).first<PeriodoRow>();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // =====================================================
    // PERÍODOS LETIVOS
    // =====================================================

    if (url.pathname === "/api/periodos" && request.method === "GET") {
      try {
        const resultado = await env.DB.prepare(
          `
            SELECT
              p.id, p.codigo, p.status, p.criado_em, p.atualizado_em,
              COUNT(a.id) AS total_alunos
            FROM periodos p
            LEFT JOIN alunos a ON a.periodo_id = p.id
            GROUP BY p.id
            ORDER BY p.codigo DESC
          `,
        ).all<PeriodoRow & { total_alunos: number }>();
        return Response.json(resultado.results);
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Períodos indisponíveis. Execute a migration 003_periodos.sql no D1." },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/api/periodos" && request.method === "POST") {
      try {
        const body = await request.json<{ codigo: string }>();
        const codigo = body.codigo?.trim().toUpperCase();
        if (!/^\d{4}-(1|2)$/.test(codigo || "")) {
          return Response.json({ erro: "Período inválido. Use AAAA-1 ou AAAA-2." }, { status: 400 });
        }

        const existente = await env.DB.prepare(`SELECT id FROM periodos WHERE codigo = ?`).bind(codigo).first();
        if (existente) return Response.json({ erro: "Este período já existe." }, { status: 409 });

        const resultado = await env.DB.prepare(
          `INSERT INTO periodos (codigo, status) VALUES (?, 'ATIVO')`,
        ).bind(codigo).run();

        return Response.json({ sucesso: true, id: resultado.meta.last_row_id, codigo }, { status: 201 });
      } catch (erro) {
        console.error(erro);
        return Response.json({ erro: "Não foi possível criar o período." }, { status: 500 });
      }
    }

    const rotaPeriodo = url.pathname.match(/^\/api\/periodos\/(\d+)$/);
    if (rotaPeriodo && request.method === "PUT") {
      try {
        const id = Number(rotaPeriodo[1]);
        const body = await request.json<{ status: "ATIVO" | "ARQUIVADO" }>();
        if (!["ATIVO", "ARQUIVADO"].includes(body.status)) {
          return Response.json({ erro: "Status de período inválido." }, { status: 400 });
        }
        const periodo = await env.DB.prepare(`SELECT id, codigo FROM periodos WHERE id = ?`).bind(id).first<{id:number; codigo:string}>();
        if (!periodo) return Response.json({ erro: "Período não encontrado." }, { status: 404 });
        await env.DB.prepare(`UPDATE periodos SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.status, id).run();
        return Response.json({ sucesso: true, id, codigo: periodo.codigo, status: body.status });
      } catch (erro) {
        console.error(erro);
        return Response.json({ erro: "Não foi possível alterar o período." }, { status: 500 });
      }
    }

    const periodoAtual = url.pathname.startsWith("/api/")
      ? await obterPeriodoAtual(request, env, url)
      : null;

    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/periodos") && !periodoAtual) {
      return Response.json(
        { erro: "Nenhum período letivo disponível. Crie ou migre um período antes de continuar." },
        { status: 409 },
      );
    }

    // =====================================================
    // GET /api/log
    // =====================================================

    if (url.pathname === "/api/log" && request.method === "GET") {
      try {
        const limiteSolicitado = Number(url.searchParams.get("limit") || "200");
        const limite = Math.max(1, Math.min(500, limiteSolicitado));

        const resultado = await env.DB.prepare(
          `
            SELECT id, criado_em, acao, entidade, descricao, ra, unidade
            FROM logs
            WHERE periodo_id = ?
            ORDER BY id DESC
            LIMIT ?
          `,
        )
          .bind(periodoAtual!.id, limite)
          .all();

        return Response.json(resultado.results);
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "LOG indisponível. Execute a migration 002_log.sql no D1." },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // POST /api/log
    // =====================================================

    if (url.pathname === "/api/log" && request.method === "POST") {
      try {
        const body = await request.json<{
          acao: string;
          entidade: string;
          descricao: string;
          ra?: string;
          unidade?: string;
        }>();

        if (!body.acao?.trim() || !body.entidade?.trim() || !body.descricao?.trim()) {
          return Response.json({ erro: "Dados insuficientes para registrar o LOG." }, { status: 400 });
        }

        await env.DB.prepare(
          `
            INSERT INTO logs (acao, entidade, descricao, ra, unidade, periodo_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            body.acao.trim(),
            body.entidade.trim(),
            body.descricao.trim(),
            body.ra?.trim() || null,
            body.unidade?.trim() || null,
            periodoAtual!.id,
          )
          .run();

        return Response.json({ sucesso: true }, { status: 201 });
      } catch (erro) {
        console.error(erro);
        return Response.json({ erro: "Não foi possível registrar o LOG." }, { status: 500 });
      }
    }

    // =====================================================
    // GET /api/alunos
    // =====================================================

    if (url.pathname === "/api/alunos" && request.method === "GET") {
      const resultado = await env.DB.prepare(
        `
          SELECT
            a.ra,
            a.nome,
            a.email,
            a.email_outro,
            a.curso,
            a.unidade,
            a.status,
            d.identidade,
            d.cpf,
            d.certidao,
            d.residencia,
            d.titulo,
            d.ensino_medio,
            d.contrato
          FROM alunos a
          INNER JOIN documentos d
            ON d.aluno_id = a.id
          WHERE a.periodo_id = ?
          ORDER BY a.nome
        `,
      ).bind(periodoAtual!.id).all<AlunoRow>();

      return Response.json(resultado.results);
    }

    // =====================================================
    // POST /api/alunos
    // =====================================================

    if (url.pathname === "/api/alunos" && request.method === "POST") {
      try {
        const body = await request.json<DadosAluno>();

        const ra = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();

        if (!ra || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade são obrigatórios.",
            },
            {
              status: 400,
            },
          );
        }

        const existente = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, ra)
          .first<{ id: number }>();

        if (existente) {
          return Response.json(
            {
              erro: "Já existe um aluno com este RA.",
            },
            {
              status: 409,
            },
          );
        }

        const resultado = await env.DB.prepare(
          `
            INSERT INTO alunos (
              periodo_id,
              ra,
              nome,
              email,
              email_outro,
              curso,
              unidade
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            periodoAtual!.id,
            ra,
            nome,
            body.email?.trim() || null,
            body.email_outro?.trim() || null,
            curso,
            unidade,
          )
          .run();

        const alunoId = resultado.meta.last_row_id;

        const documentos = body.documentos;

        await env.DB.prepare(
          `
            INSERT INTO documentos (
              aluno_id,
              identidade,
              cpf,
              certidao,
              residencia,
              titulo,
              ensino_medio,
              contrato
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            alunoId,
            documentos?.identidade ? 1 : 0,
            documentos?.cpf ? 1 : 0,
            documentos?.certidao ? 1 : 0,
            documentos?.residencia ? 1 : 0,
            documentos?.titulo ? 1 : 0,
            documentos?.ensino_medio ? 1 : 0,
            documentos?.contrato ? 1 : 0,
          )
          .run();

        return Response.json(
          {
            sucesso: true,
            ra,
            id: alunoId,
          },
          {
            status: 201,
          },
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível cadastrar o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // POST /api/alunos/importar
    // Sincronização em lote: cadastra novos e atualiza existentes
    // sem tocar nos documentos já conferidos.
    // =====================================================

    if (url.pathname === "/api/alunos/importar" && request.method === "POST") {
      try {
        type AlunoImportacao = {
          ra: string;
          nome: string;
          curso: string;
          email?: string;
          email_outro?: string;
          contrato?: boolean;
        };

        type AlunoExistenteImportacao = {
          ra: string;
          nome: string;
          curso: string;
          unidade: string;
          email: string | null;
          email_outro: string | null;
          status: "ATIVO" | "CANCELADO";
        };

        const body = await request.json<{
          unidade: "FACE" | "FEA" | "FCH" | "EAD";
          alunos: AlunoImportacao[];
        }>();

        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];

        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inválida." }, { status: 400 });
        }

        if (!Array.isArray(body.alunos) || body.alunos.length === 0) {
          return Response.json(
            { erro: "Nenhum aluno foi enviado para sincronização." },
            { status: 400 },
          );
        }

        const invalidos: Array<{
          indice: number;
          ra?: string;
          nome?: string;
          motivo: string;
        }> = [];

        const validos = body.alunos
          .map((aluno, indice) => {
            const ra = aluno.ra?.trim();
            const nome = aluno.nome?.trim();
            const curso = aluno.curso?.trim();

            if (!ra || !nome || !curso) {
              invalidos.push({
                indice,
                ra,
                nome,
                motivo: "RA, nome ou curso ausente.",
              });

              return null;
            }

            return {
              ra,
              nome,
              curso,
              email: aluno.email?.trim() || null,
              email_outro: aluno.email_outro?.trim() || null,
              contrato: Boolean(aluno.contrato),
            };
          })
          .filter(
            (
              aluno,
            ): aluno is {
              ra: string;
              nome: string;
              curso: string;
              email: string | null;
              email_outro: string | null;
              contrato: boolean;
            } => aluno !== null,
          );

        const rasDoLote = new Set<string>();
        const duplicadosNoLote: string[] = [];

        const unicos = validos.filter((aluno) => {
          if (rasDoLote.has(aluno.ra)) {
            duplicadosNoLote.push(aluno.ra);
            return false;
          }

          rasDoLote.add(aluno.ra);
          return true;
        });

        if (unicos.length === 0) {
          return Response.json({
            sucesso: true,
            encontrados: body.alunos.length,
            importados: 0,
            atualizados: 0,
            sem_alteracoes: 0,
            ja_cadastrados: 0,
            duplicados_no_lote: duplicadosNoLote.length,
            invalidos: invalidos.length,
            detalhes: {
              atualizados: [],
              sem_alteracoes: [],
              duplicados_no_lote: duplicadosNoLote,
              invalidos,
            },
          });
        }

        const TAMANHO_CONSULTA = 80;
        const existentesPorRa = new Map<string, AlunoExistenteImportacao>();

        for (let i = 0; i < unicos.length; i += TAMANHO_CONSULTA) {
          const lote = unicos.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");

          const existentes = await env.DB.prepare(
            `
              SELECT
                ra,
                nome,
                curso,
                unidade,
                email,
                email_outro,
                status
              FROM alunos
              WHERE periodo_id = ? AND ra IN (${placeholders})
            `,
          )
            .bind(periodoAtual!.id, ...lote.map((aluno) => aluno.ra))
            .all<AlunoExistenteImportacao>();

          for (const existente of existentes.results) {
            existentesPorRa.set(existente.ra, existente);
          }
        }

        const normalizar = (valor: string | null | undefined) =>
          (valor ?? "").trim();

        const novos = unicos.filter((aluno) => !existentesPorRa.has(aluno.ra));

        const existentes = unicos.filter((aluno) =>
          existentesPorRa.has(aluno.ra),
        );

        const alterados = existentes.filter((aluno) => {
          const atual = existentesPorRa.get(aluno.ra)!;

          return (
            atual.status === "CANCELADO" ||
            normalizar(atual.nome) !== normalizar(aluno.nome) ||
            normalizar(atual.curso) !== normalizar(aluno.curso) ||
            normalizar(atual.unidade) !== normalizar(body.unidade) ||
            normalizar(atual.email) !== normalizar(aluno.email) ||
            normalizar(atual.email_outro) !== normalizar(aluno.email_outro)
          );
        });

        const alteradosRa = new Set(alterados.map((aluno) => aluno.ra));

        const semAlteracoes = existentes.filter(
          (aluno) => !alteradosRa.has(aluno.ra),
        );

        // Novos: cadastra aluno e cria o controle documental.
        const TAMANHO_INSERCAO = 25;

        for (let i = 0; i < novos.length; i += TAMANHO_INSERCAO) {
          const lote = novos.slice(i, i + TAMANHO_INSERCAO);
          const comandos: D1PreparedStatement[] = [];

          for (const aluno of lote) {
            comandos.push(
              env.DB.prepare(
                `
                  INSERT INTO alunos (
                    periodo_id,
                    ra,
                    nome,
                    email,
                    email_outro,
                    curso,
                    unidade
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
              ).bind(
                periodoAtual!.id,
                aluno.ra,
                aluno.nome,
                aluno.email,
                aluno.email_outro,
                aluno.curso,
                body.unidade,
              ),
            );

            comandos.push(
              env.DB.prepare(
                `
                  INSERT INTO documentos (
                    aluno_id,
                    identidade,
                    cpf,
                    certidao,
                    residencia,
                    titulo,
                    ensino_medio,
                    contrato
                  )
                  SELECT
                    id,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    ?
                  FROM alunos
                  WHERE periodo_id = ? AND ra = ?
                `,
              ).bind(aluno.contrato ? 1 : 0, periodoAtual!.id, aluno.ra),
            );
          }

          await env.DB.batch(comandos);
        }

        // Existentes alterados: atualiza SOMENTE dados cadastrais.
        // A tabela documentos não é tocada, portanto nenhuma conferência
        // já realizada é perdida ou zerada.
        const TAMANHO_ATUALIZACAO = 50;

        for (let i = 0; i < alterados.length; i += TAMANHO_ATUALIZACAO) {
          const lote = alterados.slice(i, i + TAMANHO_ATUALIZACAO);

          const comandos = lote.map((aluno) =>
            env.DB.prepare(
              `
                UPDATE alunos
                SET
                  nome = ?,
                  email = ?,
                  email_outro = ?,
                  curso = ?,
                  unidade = ?,
                  status = 'ATIVO',
                  atualizado_em = CURRENT_TIMESTAMP
                WHERE periodo_id = ? AND ra = ?
              `,
            ).bind(
              aluno.nome,
              aluno.email,
              aluno.email_outro,
              aluno.curso,
              body.unidade,
              periodoAtual!.id,
              aluno.ra,
            ),
          );

          await env.DB.batch(comandos);
        }

        return Response.json({
          sucesso: true,
          encontrados: body.alunos.length,
          importados: novos.length,
          atualizados: alterados.length,
          sem_alteracoes: semAlteracoes.length,
          ja_cadastrados: existentes.length,
          duplicados_no_lote: duplicadosNoLote.length,
          invalidos: invalidos.length,
          detalhes: {
            atualizados: alterados.map((aluno) => aluno.ra),
            sem_alteracoes: semAlteracoes.map((aluno) => aluno.ra),
            duplicados_no_lote: duplicadosNoLote,
            invalidos,
          },
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          { erro: "Não foi possível sincronizar os alunos." },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // POST /api/alunos/cancelados/previa
    // =====================================================

    if (
      url.pathname === "/api/alunos/cancelados/previa" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json<{
          unidade: "FACE" | "FEA" | "FCH" | "EAD";
          ras: string[];
        }>();

        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];

        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inválida." }, { status: 400 });
        }

        if (!Array.isArray(body.ras) || body.ras.length === 0) {
          return Response.json(
            { erro: "Nenhum RA foi enviado." },
            { status: 400 },
          );
        }

        const ras = [
          ...new Set(
            body.ras.map((ra) => String(ra ?? "").trim()).filter(Boolean),
          ),
        ];

        type AlunoCancelamento = {
          ra: string;
          nome: string;
          curso: string;
          unidade: string;
          status: "ATIVO" | "CANCELADO";
        };

        const encontradosPorRa = new Map<string, AlunoCancelamento>();
        const TAMANHO_CONSULTA = 80;

        for (let i = 0; i < ras.length; i += TAMANHO_CONSULTA) {
          const lote = ras.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");

          const resultado = await env.DB.prepare(
            `
            SELECT ra, nome, curso, unidade, status
            FROM alunos
            WHERE periodo_id = ? AND ra IN (${placeholders})
          `,
          )
            .bind(periodoAtual!.id, ...lote)
            .all<AlunoCancelamento>();

          for (const aluno of resultado.results) {
            encontradosPorRa.set(aluno.ra, aluno);
          }
        }

        const alunos = ras.map((ra) => {
          const aluno = encontradosPorRa.get(ra);

          if (!aluno) {
            return { ra, status_previa: "NAO_ENCONTRADO" as const };
          }

          if (aluno.status === "CANCELADO") {
            return { ...aluno, status_previa: "JA_CANCELADO" as const };
          }

          return {
            ...aluno,
            status_previa:
              aluno.unidade === body.unidade
                ? ("PRONTO" as const)
                : ("OUTRA_UNIDADE" as const),
          };
        });

        return Response.json({
          sucesso: true,
          recebidos: ras.length,
          prontos_para_cancelar: alunos.filter(
            (aluno) => aluno.status_previa === "PRONTO",
          ).length,
          ja_cancelados: alunos.filter(
            (aluno) => aluno.status_previa === "JA_CANCELADO",
          ).length,
          nao_encontrados: alunos.filter(
            (aluno) => aluno.status_previa === "NAO_ENCONTRADO",
          ).length,
          outra_unidade: alunos.filter(
            (aluno) => aluno.status_previa === "OUTRA_UNIDADE",
          ).length,
          alunos,
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível analisar os cancelados." },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // POST /api/alunos/cancelados
    // Marca como CANCELADO sem tocar nos documentos
    // =====================================================

    if (
      url.pathname === "/api/alunos/cancelados" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json<{
          unidade: "FACE" | "FEA" | "FCH" | "EAD";
          ras: string[];
        }>();

        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];

        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inválida." }, { status: 400 });
        }

        if (!Array.isArray(body.ras) || body.ras.length === 0) {
          return Response.json(
            { erro: "Nenhum RA foi enviado para cancelamento." },
            { status: 400 },
          );
        }

        const ras = [
          ...new Set(
            body.ras.map((ra) => String(ra ?? "").trim()).filter(Boolean),
          ),
        ];

        type StatusAluno = {
          ra: string;
          unidade: string;
          status: "ATIVO" | "CANCELADO";
        };

        const encontradosPorRa = new Map<string, StatusAluno>();
        const TAMANHO_CONSULTA = 80;

        for (let i = 0; i < ras.length; i += TAMANHO_CONSULTA) {
          const lote = ras.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");

          const resultado = await env.DB.prepare(
            `
            SELECT ra, unidade, status
            FROM alunos
            WHERE periodo_id = ? AND ra IN (${placeholders})
          `,
          )
            .bind(periodoAtual!.id, ...lote)
            .all<StatusAluno>();

          for (const aluno of resultado.results) {
            encontradosPorRa.set(aluno.ra, aluno);
          }
        }

        const paraCancelar = ras.filter((ra) => {
          const aluno = encontradosPorRa.get(ra);
          return (
            aluno &&
            aluno.unidade === body.unidade &&
            aluno.status !== "CANCELADO"
          );
        });

        const jaCancelados = ras.filter((ra) => {
          const aluno = encontradosPorRa.get(ra);
          return Boolean(
            aluno &&
            aluno.unidade === body.unidade &&
            aluno.status === "CANCELADO",
          );
        });

        const naoEncontrados = ras.filter((ra) => !encontradosPorRa.has(ra));

        const outraUnidade = ras.filter((ra) => {
          const aluno = encontradosPorRa.get(ra);
          return Boolean(aluno && aluno.unidade !== body.unidade);
        });

        const TAMANHO_ATUALIZACAO = 50;

        for (let i = 0; i < paraCancelar.length; i += TAMANHO_ATUALIZACAO) {
          const lote = paraCancelar.slice(i, i + TAMANHO_ATUALIZACAO);

          await env.DB.batch(
            lote.map((ra) =>
              env.DB.prepare(
                `
                UPDATE alunos
                SET
                  status = 'CANCELADO',
                  atualizado_em = CURRENT_TIMESTAMP
                WHERE periodo_id = ?
                  AND ra = ?
                  AND unidade = ?
              `,
              ).bind(periodoAtual!.id, ra, body.unidade),
            ),
          );
        }

        return Response.json({
          sucesso: true,
          recebidos: ras.length,
          cancelados: paraCancelar.length,
          ja_cancelados: jaCancelados.length,
          nao_encontrados: naoEncontrados.length,
          outra_unidade: outraUnidade.length,
          detalhes: {
            cancelados: paraCancelar,
            ja_cancelados: jaCancelados,
            nao_encontrados: naoEncontrados,
            outra_unidade: outraUnidade,
          },
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "Não foi possível cancelar os alunos." },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // PUT /api/alunos/:ra/status
    // Altera somente o status da matrícula.
    // Não toca em dados cadastrais nem documentos.
    // =====================================================

    const rotaStatusAluno = url.pathname.match(
      /^\/api\/alunos\/([^/]+)\/status$/,
    );

    if (rotaStatusAluno && request.method === "PUT") {
      try {
        const ra = decodeURIComponent(rotaStatusAluno[1]);

        const body = await request.json<{
          status: "ATIVO" | "CANCELADO";
        }>();

        if (!["ATIVO", "CANCELADO"].includes(body.status)) {
          return Response.json({ erro: "Status inválido." }, { status: 400 });
        }

        const aluno = await env.DB.prepare(
          `
            SELECT id, status
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, ra)
          .first<{
            id: number;
            status: "ATIVO" | "CANCELADO";
          }>();

        if (!aluno) {
          return Response.json(
            { erro: "Aluno não encontrado." },
            { status: 404 },
          );
        }

        if (aluno.status === body.status) {
          return Response.json({
            sucesso: true,
            ra,
            status: body.status,
            alterado: false,
          });
        }

        await env.DB.prepare(
          `
            UPDATE alunos
            SET
              status = ?,
              atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
          .bind(body.status, aluno.id)
          .run();

        return Response.json({
          sucesso: true,
          ra,
          status: body.status,
          alterado: true,
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          { erro: "Não foi possível alterar o status da matrícula." },
          { status: 500 },
        );
      }
    }

    // =====================================================
    // PUT /api/alunos/:ra/documentos
    // =====================================================

    if (
      url.pathname.startsWith("/api/alunos/") &&
      url.pathname.endsWith("/documentos") &&
      request.method === "PUT"
    ) {
      const partes = url.pathname.split("/");
      const ra = decodeURIComponent(partes[3]);

      const body = await request.json<DocumentosBody>();

      const aluno = await env.DB.prepare(
        `
          SELECT id
          FROM alunos
          WHERE periodo_id = ? AND ra = ?
        `,
      )
        .bind(periodoAtual!.id, ra)
        .first<{ id: number }>();

      if (!aluno) {
        return Response.json(
          {
            erro: "Aluno não encontrado.",
          },
          {
            status: 404,
          },
        );
      }

      await env.DB.prepare(
        `
          UPDATE documentos
          SET
            identidade = ?,
            cpf = ?,
            certidao = ?,
            residencia = ?,
            titulo = ?,
            ensino_medio = ?,
            contrato = ?,
            atualizado_em = CURRENT_TIMESTAMP
          WHERE aluno_id = ?
        `,
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

      return Response.json({
        sucesso: true,
        ra,
      });
    }

    // =====================================================
    // PUT /api/alunos/:ra
    // Editar dados cadastrais
    // =====================================================

    const rotaAluno = url.pathname.match(/^\/api\/alunos\/([^/]+)$/);

    if (rotaAluno && request.method === "PUT") {
      try {
        const raAtual = decodeURIComponent(rotaAluno[1]);

        const body = await request.json<DadosAluno>();

        const novoRa = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();

        if (!novoRa || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade são obrigatórios.",
            },
            {
              status: 400,
            },
          );
        }

        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, raAtual)
          .first<{ id: number }>();

        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno não encontrado.",
            },
            {
              status: 404,
            },
          );
        }

        if (novoRa !== raAtual) {
          const raEmUso = await env.DB.prepare(
            `
              SELECT id
              FROM alunos
              WHERE periodo_id = ?
              AND ra = ?
              AND id <> ?
            `,
          )
            .bind(periodoAtual!.id, novoRa, aluno.id)
            .first<{ id: number }>();

          if (raEmUso) {
            return Response.json(
              {
                erro: "Já existe outro aluno com este RA.",
              },
              {
                status: 409,
              },
            );
          }
        }

        await env.DB.prepare(
          `
            UPDATE alunos
            SET
              ra = ?,
              nome = ?,
              email = ?,
              email_outro = ?,
              curso = ?,
              unidade = ?,
              atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
          .bind(
            novoRa,
            nome,
            body.email?.trim() || null,
            body.email_outro?.trim() || null,
            curso,
            unidade,
            aluno.id,
          )
          .run();

        return Response.json({
          sucesso: true,
          ra_anterior: raAtual,
          ra: novoRa,
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível atualizar o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // DELETE /api/alunos/:ra
    // =====================================================

    if (rotaAluno && request.method === "DELETE") {
      try {
        const ra = decodeURIComponent(rotaAluno[1]);

        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE periodo_id = ? AND ra = ?
          `,
        )
          .bind(periodoAtual!.id, ra)
          .first<{ id: number }>();

        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno não encontrado.",
            },
            {
              status: 404,
            },
          );
        }

        await env.DB.prepare(
          `
            DELETE FROM alunos
            WHERE id = ?
          `,
        )
          .bind(aluno.id)
          .run();

        return Response.json({
          sucesso: true,
          ra,
        });
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro: "Não foi possível excluir o aluno.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // GET /api/comunicacoes
    // =====================================================

    if (url.pathname === "/api/comunicacoes" && request.method === "GET") {
      try {
        const limiteSolicitado = Number(url.searchParams.get("limit") || "20");
        const limite = Math.max(1, Math.min(100, limiteSolicitado));

        const resultado = await env.DB.prepare(
          `
            SELECT
              id,
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
            LIMIT ?
          `,
        )
          .bind(periodoAtual!.id, limite)
          .all<{
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
          }>();

        return Response.json(
          resultado.results.map((registro) => ({
            id: registro.id,
            criado_em: registro.criado_em,
            grupo_chave: registro.grupo_chave,
            unidade: registro.unidade,
            documentos: JSON.parse(registro.documentos_json || "[]"),
            quantidade_alunos: registro.quantidade_alunos,
            quantidade_emails: registro.quantidade_emails,
            assunto: registro.assunto,
            prazo: registro.prazo,
            tipo_destinatario: registro.tipo_destinatario,
            ras: JSON.parse(registro.ras_json || "[]"),
          })),
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro:
              "Histórico indisponível. Execute a migration 001_comunicacoes.sql no D1.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // POST /api/comunicacoes
    // Registra a cobrança depois que o usuário conclui o envio.
    // =====================================================

    if (url.pathname === "/api/comunicacoes" && request.method === "POST") {
      try {
        const body = await request.json<{
          grupo_chave: string;
          unidade: string;
          documentos: string[];
          quantidade_alunos: number;
          quantidade_emails: number;
          assunto: string;
          prazo: string;
          tipo_destinatario: string;
          ras: string[];
        }>();

        if (
          !body.grupo_chave ||
          !Array.isArray(body.documentos) ||
          !Array.isArray(body.ras) ||
          body.quantidade_alunos < 1
        ) {
          return Response.json(
            {
              erro: "Dados insuficientes para registrar a cobrança.",
            },
            {
              status: 400,
            },
          );
        }

        const resultado = await env.DB.prepare(
          `
            INSERT INTO comunicacoes (
              grupo_chave,
              unidade,
              documentos_json,
              quantidade_alunos,
              quantidade_emails,
              assunto,
              prazo,
              tipo_destinatario,
              ras_json,
              periodo_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
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
            periodoAtual!.id,
          )
          .run();

        return Response.json(
          {
            sucesso: true,
            id: resultado.meta.last_row_id,
          },
          {
            status: 201,
          },
        );
      } catch (erro) {
        console.error(erro);

        return Response.json(
          {
            erro:
              "Não foi possível registrar a cobrança. Verifique se a migration 001_comunicacoes.sql foi executada.",
          },
          {
            status: 500,
          },
        );
      }
    }

    // =====================================================
    // React / assets
    // =====================================================

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
