var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
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
        `
      ).all();
      return Response.json(resultado.results);
    }
    if (url.pathname === "/api/alunos" && request.method === "POST") {
      try {
        const body = await request.json();
        const ra = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();
        if (!ra || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade s\xE3o obrigat\xF3rios."
            },
            {
              status: 400
            }
          );
        }
        const existente = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE ra = ?
          `
        ).bind(ra).first();
        if (existente) {
          return Response.json(
            {
              erro: "J\xE1 existe um aluno com este RA."
            },
            {
              status: 409
            }
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
          `
        ).bind(
          ra,
          nome,
          body.email?.trim() || null,
          body.email_outro?.trim() || null,
          curso,
          unidade
        ).run();
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
          `
        ).bind(alunoId).run();
        return Response.json(
          {
            sucesso: true,
            ra,
            id: alunoId
          },
          {
            status: 201
          }
        );
      } catch (erro) {
        console.error(erro);
        return Response.json(
          {
            erro: "N\xE3o foi poss\xEDvel cadastrar o aluno."
          },
          {
            status: 500
          }
        );
      }
    }
    if (url.pathname === "/api/alunos/importar" && request.method === "POST") {
      try {
        const body = await request.json();
        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];
        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inv\xE1lida." }, { status: 400 });
        }
        if (!Array.isArray(body.alunos) || body.alunos.length === 0) {
          return Response.json(
            { erro: "Nenhum aluno foi enviado para sincroniza\xE7\xE3o." },
            { status: 400 }
          );
        }
        const invalidos = [];
        const validos = body.alunos.map((aluno, indice) => {
          const ra = aluno.ra?.trim();
          const nome = aluno.nome?.trim();
          const curso = aluno.curso?.trim();
          if (!ra || !nome || !curso) {
            invalidos.push({
              indice,
              ra,
              nome,
              motivo: "RA, nome ou curso ausente."
            });
            return null;
          }
          return {
            ra,
            nome,
            curso,
            email: aluno.email?.trim() || null,
            email_outro: aluno.email_outro?.trim() || null,
            contrato: Boolean(aluno.contrato)
          };
        }).filter(
          (aluno) => aluno !== null
        );
        const rasDoLote = /* @__PURE__ */ new Set();
        const duplicadosNoLote = [];
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
              invalidos
            }
          });
        }
        const TAMANHO_CONSULTA = 80;
        const existentesPorRa = /* @__PURE__ */ new Map();
        for (let i = 0; i < unicos.length; i += TAMANHO_CONSULTA) {
          const lote = unicos.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");
          const existentes2 = await env.DB.prepare(
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
            `
          ).bind(...lote.map((aluno) => aluno.ra)).all();
          for (const existente of existentes2.results) {
            existentesPorRa.set(existente.ra, existente);
          }
        }
        const normalizar = /* @__PURE__ */ __name((valor) => (valor ?? "").trim(), "normalizar");
        const novos = unicos.filter((aluno) => !existentesPorRa.has(aluno.ra));
        const existentes = unicos.filter(
          (aluno) => existentesPorRa.has(aluno.ra)
        );
        const alterados = existentes.filter((aluno) => {
          const atual = existentesPorRa.get(aluno.ra);
          return atual.status === "CANCELADO" || normalizar(atual.nome) !== normalizar(aluno.nome) || normalizar(atual.curso) !== normalizar(aluno.curso) || normalizar(atual.unidade) !== normalizar(body.unidade) || normalizar(atual.email) !== normalizar(aluno.email) || normalizar(atual.email_outro) !== normalizar(aluno.email_outro);
        });
        const alteradosRa = new Set(alterados.map((aluno) => aluno.ra));
        const semAlteracoes = existentes.filter(
          (aluno) => !alteradosRa.has(aluno.ra)
        );
        const TAMANHO_INSERCAO = 25;
        for (let i = 0; i < novos.length; i += TAMANHO_INSERCAO) {
          const lote = novos.slice(i, i + TAMANHO_INSERCAO);
          const comandos = [];
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
                `
              ).bind(
                aluno.ra,
                aluno.nome,
                aluno.email,
                aluno.email_outro,
                aluno.curso,
                body.unidade
              )
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
                `
              ).bind(aluno.contrato ? 1 : 0, aluno.ra)
            );
          }
          await env.DB.batch(comandos);
        }
        const TAMANHO_ATUALIZACAO = 50;
        for (let i = 0; i < alterados.length; i += TAMANHO_ATUALIZACAO) {
          const lote = alterados.slice(i, i + TAMANHO_ATUALIZACAO);
          const comandos = lote.map(
            (aluno) => env.DB.prepare(
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
              `
            ).bind(
              aluno.nome,
              aluno.email,
              aluno.email_outro,
              aluno.curso,
              body.unidade,
              aluno.ra
            )
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
            invalidos
          }
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "N\xE3o foi poss\xEDvel sincronizar os alunos." },
          { status: 500 }
        );
      }
    }
    if (url.pathname === "/api/alunos/cancelados/previa" && request.method === "POST") {
      try {
        const body = await request.json();
        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];
        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inv\xE1lida." }, { status: 400 });
        }
        if (!Array.isArray(body.ras) || body.ras.length === 0) {
          return Response.json(
            { erro: "Nenhum RA foi enviado." },
            { status: 400 }
          );
        }
        const ras = [
          ...new Set(
            body.ras.map((ra) => String(ra ?? "").trim()).filter(Boolean)
          )
        ];
        const encontradosPorRa = /* @__PURE__ */ new Map();
        const TAMANHO_CONSULTA = 80;
        for (let i = 0; i < ras.length; i += TAMANHO_CONSULTA) {
          const lote = ras.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");
          const resultado = await env.DB.prepare(
            `
            SELECT ra, nome, curso, unidade, status
            FROM alunos
            WHERE ra IN (${placeholders})
          `
          ).bind(...lote).all();
          for (const aluno of resultado.results) {
            encontradosPorRa.set(aluno.ra, aluno);
          }
        }
        const alunos = ras.map((ra) => {
          const aluno = encontradosPorRa.get(ra);
          if (!aluno) {
            return { ra, status_previa: "NAO_ENCONTRADO" };
          }
          if (aluno.status === "CANCELADO") {
            return { ...aluno, status_previa: "JA_CANCELADO" };
          }
          return {
            ...aluno,
            status_previa: aluno.unidade === body.unidade ? "PRONTO" : "OUTRA_UNIDADE"
          };
        });
        return Response.json({
          sucesso: true,
          recebidos: ras.length,
          prontos_para_cancelar: alunos.filter(
            (aluno) => aluno.status_previa === "PRONTO"
          ).length,
          ja_cancelados: alunos.filter(
            (aluno) => aluno.status_previa === "JA_CANCELADO"
          ).length,
          nao_encontrados: alunos.filter(
            (aluno) => aluno.status_previa === "NAO_ENCONTRADO"
          ).length,
          outra_unidade: alunos.filter(
            (aluno) => aluno.status_previa === "OUTRA_UNIDADE"
          ).length,
          alunos
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "N\xE3o foi poss\xEDvel analisar os cancelados." },
          { status: 500 }
        );
      }
    }
    if (url.pathname === "/api/alunos/cancelados" && request.method === "POST") {
      try {
        const body = await request.json();
        const unidadesValidas = ["FACE", "FEA", "FCH", "EAD"];
        if (!unidadesValidas.includes(body.unidade)) {
          return Response.json({ erro: "Unidade inv\xE1lida." }, { status: 400 });
        }
        if (!Array.isArray(body.ras) || body.ras.length === 0) {
          return Response.json(
            { erro: "Nenhum RA foi enviado para cancelamento." },
            { status: 400 }
          );
        }
        const ras = [
          ...new Set(
            body.ras.map((ra) => String(ra ?? "").trim()).filter(Boolean)
          )
        ];
        const encontradosPorRa = /* @__PURE__ */ new Map();
        const TAMANHO_CONSULTA = 80;
        for (let i = 0; i < ras.length; i += TAMANHO_CONSULTA) {
          const lote = ras.slice(i, i + TAMANHO_CONSULTA);
          const placeholders = lote.map(() => "?").join(",");
          const resultado = await env.DB.prepare(
            `
            SELECT ra, unidade, status
            FROM alunos
            WHERE ra IN (${placeholders})
          `
          ).bind(...lote).all();
          for (const aluno of resultado.results) {
            encontradosPorRa.set(aluno.ra, aluno);
          }
        }
        const paraCancelar = ras.filter((ra) => {
          const aluno = encontradosPorRa.get(ra);
          return aluno && aluno.unidade === body.unidade && aluno.status !== "CANCELADO";
        });
        const jaCancelados = ras.filter((ra) => {
          const aluno = encontradosPorRa.get(ra);
          return Boolean(
            aluno && aluno.unidade === body.unidade && aluno.status === "CANCELADO"
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
            lote.map(
              (ra) => env.DB.prepare(
                `
                UPDATE alunos
                SET
                  status = 'CANCELADO',
                  atualizado_em = CURRENT_TIMESTAMP
                WHERE ra = ?
                  AND unidade = ?
              `
              ).bind(ra, body.unidade)
            )
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
            outra_unidade: outraUnidade
          }
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "N\xE3o foi poss\xEDvel cancelar os alunos." },
          { status: 500 }
        );
      }
    }
    const rotaStatusAluno = url.pathname.match(
      /^\/api\/alunos\/([^/]+)\/status$/
    );
    if (rotaStatusAluno && request.method === "PUT") {
      try {
        const ra = decodeURIComponent(rotaStatusAluno[1]);
        const body = await request.json();
        if (!["ATIVO", "CANCELADO"].includes(body.status)) {
          return Response.json({ erro: "Status inv\xE1lido." }, { status: 400 });
        }
        const aluno = await env.DB.prepare(
          `
            SELECT id, status
            FROM alunos
            WHERE ra = ?
          `
        ).bind(ra).first();
        if (!aluno) {
          return Response.json(
            { erro: "Aluno n\xE3o encontrado." },
            { status: 404 }
          );
        }
        if (aluno.status === body.status) {
          return Response.json({
            sucesso: true,
            ra,
            status: body.status,
            alterado: false
          });
        }
        await env.DB.prepare(
          `
            UPDATE alunos
            SET
              status = ?,
              atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        ).bind(body.status, aluno.id).run();
        return Response.json({
          sucesso: true,
          ra,
          status: body.status,
          alterado: true
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          { erro: "N\xE3o foi poss\xEDvel alterar o status da matr\xEDcula." },
          { status: 500 }
        );
      }
    }
    if (url.pathname.startsWith("/api/alunos/") && url.pathname.endsWith("/documentos") && request.method === "PUT") {
      const partes = url.pathname.split("/");
      const ra = decodeURIComponent(partes[3]);
      const body = await request.json();
      const aluno = await env.DB.prepare(
        `
          SELECT id
          FROM alunos
          WHERE ra = ?
        `
      ).bind(ra).first();
      if (!aluno) {
        return Response.json(
          {
            erro: "Aluno n\xE3o encontrado."
          },
          {
            status: 404
          }
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
        `
      ).bind(
        body.identidade ? 1 : 0,
        body.cpf ? 1 : 0,
        body.certidao ? 1 : 0,
        body.residencia ? 1 : 0,
        body.titulo ? 1 : 0,
        body.ensino_medio ? 1 : 0,
        body.contrato ? 1 : 0,
        aluno.id
      ).run();
      return Response.json({
        sucesso: true,
        ra
      });
    }
    const rotaAluno = url.pathname.match(/^\/api\/alunos\/([^/]+)$/);
    if (rotaAluno && request.method === "PUT") {
      try {
        const raAtual = decodeURIComponent(rotaAluno[1]);
        const body = await request.json();
        const novoRa = body.ra?.trim();
        const nome = body.nome?.trim();
        const curso = body.curso?.trim();
        const unidade = body.unidade?.trim();
        if (!novoRa || !nome || !curso || !unidade) {
          return Response.json(
            {
              erro: "RA, nome, curso e unidade s\xE3o obrigat\xF3rios."
            },
            {
              status: 400
            }
          );
        }
        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE ra = ?
          `
        ).bind(raAtual).first();
        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno n\xE3o encontrado."
            },
            {
              status: 404
            }
          );
        }
        if (novoRa !== raAtual) {
          const raEmUso = await env.DB.prepare(
            `
              SELECT id
              FROM alunos
              WHERE ra = ?
              AND id <> ?
            `
          ).bind(novoRa, aluno.id).first();
          if (raEmUso) {
            return Response.json(
              {
                erro: "J\xE1 existe outro aluno com este RA."
              },
              {
                status: 409
              }
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
          `
        ).bind(
          novoRa,
          nome,
          body.email?.trim() || null,
          body.email_outro?.trim() || null,
          curso,
          unidade,
          aluno.id
        ).run();
        return Response.json({
          sucesso: true,
          ra_anterior: raAtual,
          ra: novoRa
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          {
            erro: "N\xE3o foi poss\xEDvel atualizar o aluno."
          },
          {
            status: 500
          }
        );
      }
    }
    if (rotaAluno && request.method === "DELETE") {
      try {
        const ra = decodeURIComponent(rotaAluno[1]);
        const aluno = await env.DB.prepare(
          `
            SELECT id
            FROM alunos
            WHERE ra = ?
          `
        ).bind(ra).first();
        if (!aluno) {
          return Response.json(
            {
              erro: "Aluno n\xE3o encontrado."
            },
            {
              status: 404
            }
          );
        }
        await env.DB.prepare(
          `
            DELETE FROM alunos
            WHERE id = ?
          `
        ).bind(aluno.id).run();
        return Response.json({
          sucesso: true,
          ra
        });
      } catch (erro) {
        console.error(erro);
        return Response.json(
          {
            erro: "N\xE3o foi poss\xEDvel excluir o aluno."
          },
          {
            status: 500
          }
        );
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-EDpc3I/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = worker_default;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-EDpc3I/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
