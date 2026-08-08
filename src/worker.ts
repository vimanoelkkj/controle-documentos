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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
          ORDER BY a.nome
        `,
      ).all<AlunoRow>();

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
            WHERE ra = ?
          `,
        )
          .bind(ra)
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
              ra,
              nome,
              email,
              email_outro,
              curso,
              unidade
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            ra,
            nome,
            body.email?.trim() || null,
            body.email_outro?.trim() || null,
            curso,
            unidade,
          )
          .run();

        const alunoId = resultado.meta.last_row_id;

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
            VALUES (?, 0, 0, 0, 0, 0, 0, 0)
          `,
        )
          .bind(alunoId)
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
              WHERE ra IN (${placeholders})
            `,
          )
            .bind(...lote.map((aluno) => aluno.ra))
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
                    ra,
                    nome,
                    email,
                    email_outro,
                    curso,
                    unidade
                  )
                  VALUES (?, ?, ?, ?, ?, ?)
                `,
              ).bind(
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
                  WHERE ra = ?
                `,
              ).bind(aluno.contrato ? 1 : 0, aluno.ra),
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
                WHERE ra = ?
              `,
            ).bind(
              aluno.nome,
              aluno.email,
              aluno.email_outro,
              aluno.curso,
              body.unidade,
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
            WHERE ra IN (${placeholders})
          `,
          )
            .bind(...lote)
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
            WHERE ra IN (${placeholders})
          `,
          )
            .bind(...lote)
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
                WHERE ra = ?
                  AND unidade = ?
              `,
              ).bind(ra, body.unidade),
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
            WHERE ra = ?
          `,
        )
          .bind(ra)
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
          WHERE ra = ?
        `,
      )
        .bind(ra)
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
            WHERE ra = ?
          `,
        )
          .bind(raAtual)
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
              WHERE ra = ?
              AND id <> ?
            `,
          )
            .bind(novoRa, aluno.id)
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
            WHERE ra = ?
          `,
        )
          .bind(ra)
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
    // React / assets
    // =====================================================

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
