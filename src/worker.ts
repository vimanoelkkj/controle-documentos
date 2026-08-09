/// <reference path="../worker-configuration.d.ts" />

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
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




type SheetsConfig = {
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

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function base64Url(valor: ArrayBuffer | string) {
  const bytes = typeof valor === "string" ? new TextEncoder().encode(valor) : new Uint8Array(valor);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemParaArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

async function obterTokenGoogle(env: Env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurado no Worker.");
  }
  const conta = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as GoogleServiceAccount;
  const agora = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: conta.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: conta.token_uri || "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  }));
  const chave = await crypto.subtle.importKey(
    "pkcs8",
    pemParaArrayBuffer(conta.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chave,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64Url(assinatura)}`;
  const resposta = await fetch(conta.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resposta.ok) throw new Error(`Falha na autenticação Google (${resposta.status}).`);
  const dados = await resposta.json<{ access_token: string }>();
  return dados.access_token;
}

function extrairSpreadsheetId(valor: string) {
  const limpo = valor.trim();
  const match = limpo.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || limpo;
}

function normalizarTexto(valor: unknown) {
  return String(valor ?? "").trim();
}

function normalizarComparacao(valor: unknown) {
  return normalizarTexto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function valorBooleano(valor: unknown) {
  if (typeof valor === "boolean") return valor;
  return ["TRUE", "VERDADEIRO", "1", "SIM", "X"].includes(normalizarComparacao(valor));
}

async function lerRangesGoogle(env: Env, config: SheetsConfig) {
  const token = await obterTokenGoogle(env);
  const abas = [
    config.aba_base_face_fea,
    config.aba_base_fch_ead,
    config.aba_docs_face_fea,
    config.aba_docs_fch_ead,
    config.aba_cancelados_face_fea,
    config.aba_cancelados_fch_ead,
  ];
  const params = new URLSearchParams();
  for (const aba of abas) params.append("ranges", `'${aba.replace(/'/g, "''")}'!A:K`);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheet_id)}/values:batchGet?${params}`;
  const resposta = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(`Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`);
  }
  const dados = await resposta.json<{ valueRanges?: Array<{ values?: unknown[][] }> }>();
  return abas.map((aba, indice) => ({ aba, linhas: dados.valueRanges?.[indice]?.values ?? [] }));
}

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


    const rotaSheetsConfig = url.pathname.match(/^\/api\/periodos\/(\d+)\/google-sheets$/);
    if (rotaSheetsConfig && request.method === "GET") {
      const periodoId = Number(rotaSheetsConfig[1]);
      const config = await env.DB.prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`).bind(periodoId).first<SheetsConfig>();
      return Response.json(config ?? null);
    }

    if (rotaSheetsConfig && request.method === "PUT") {
      try {
        const periodoId = Number(rotaSheetsConfig[1]);
        const body = await request.json<Omit<SheetsConfig, "periodo_id"> & { spreadsheet_id: string }>();
        const spreadsheetId = extrairSpreadsheetId(body.spreadsheet_id || "");
        const campos = [spreadsheetId, body.aba_base_face_fea, body.aba_base_fch_ead, body.aba_docs_face_fea, body.aba_docs_fch_ead, body.aba_cancelados_face_fea, body.aba_cancelados_fch_ead].map(normalizarTexto);
        if (campos.some((campo) => !campo)) return Response.json({ erro: "Preencha a planilha e as seis abas da integração." }, { status: 400 });
        await env.DB.prepare(`
          INSERT INTO google_sheets_periodos (
            periodo_id, spreadsheet_id, aba_base_face_fea, aba_base_fch_ead,
            aba_docs_face_fea, aba_docs_fch_ead, aba_cancelados_face_fea, aba_cancelados_fch_ead, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(periodo_id) DO UPDATE SET
            spreadsheet_id = excluded.spreadsheet_id,
            aba_base_face_fea = excluded.aba_base_face_fea,
            aba_base_fch_ead = excluded.aba_base_fch_ead,
            aba_docs_face_fea = excluded.aba_docs_face_fea,
            aba_docs_fch_ead = excluded.aba_docs_fch_ead,
            aba_cancelados_face_fea = excluded.aba_cancelados_face_fea,
            aba_cancelados_fch_ead = excluded.aba_cancelados_fch_ead,
            atualizado_em = CURRENT_TIMESTAMP
        `).bind(periodoId, ...campos).run();
        return Response.json({ sucesso: true, spreadsheet_id: spreadsheetId });
      } catch (erro) {
        console.error(erro);
        return Response.json({ erro: "Não foi possível salvar a integração com Google Sheets." }, { status: 500 });
      }
    }

    const rotaSheetsPrevia = url.pathname.match(/^\/api\/periodos\/(\d+)\/google-sheets\/previa$/);
    if (rotaSheetsPrevia && request.method === "POST") {
      try {
        const periodoId = Number(rotaSheetsPrevia[1]);
        const config = await env.DB.prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`).bind(periodoId).first<SheetsConfig>();
        if (!config) return Response.json({ erro: "Configure a planilha deste período primeiro." }, { status: 409 });
        const ranges = await lerRangesGoogle(env, config);
        const [baseFaceFea, baseFchEad, docsFaceFea, docsFchEad, cancelFaceFea, cancelFchEad] = ranges;

        type Origem = "FACE_FEA" | "FCH_EAD";
        type LinhaBase = { ra: string; nome: string; curso: string; email_outro: string; email: string; contrato: boolean; origem: Origem };
        const lerBase = (linhas: unknown[][], origem: Origem): LinhaBase[] => linhas.slice(1).map((l) => ({
          contrato: normalizarComparacao(l[0]) === "ENTREGUE",
          curso: normalizarTexto(l[1]), email_outro: normalizarTexto(l[2]), email: normalizarTexto(l[3]),
          nome: normalizarTexto(l[4]), ra: normalizarTexto(l[5]), origem,
        })).filter((a) => a.ra && a.nome && a.curso);
        const bases = [...lerBase(baseFaceFea.linhas, "FACE_FEA"), ...lerBase(baseFchEad.linhas, "FCH_EAD")];

        const lerDocs = (linhas: unknown[][]) => new Map(linhas.slice(1).map((l) => [normalizarTexto(l[0]), {
          identidade: valorBooleano(l[2]), cpf: valorBooleano(l[3]), certidao: valorBooleano(l[4]), residencia: valorBooleano(l[5]),
          titulo: valorBooleano(l[6]), ensino_medio: valorBooleano(l[7]), contrato: valorBooleano(l[8]),
        }]).filter(([ra]) => Boolean(ra)) as Array<[string, DocumentosBody]>);
        const docs = new Map([...lerDocs(docsFaceFea.linhas), ...lerDocs(docsFchEad.linhas)]);

        const lerCancelados = (linhas: unknown[][]) => new Set(linhas.slice(1).map((l) => normalizarTexto(l[5] ?? l[0])).filter(Boolean));
        const cancelados = new Set([...lerCancelados(cancelFaceFea.linhas), ...lerCancelados(cancelFchEad.linhas)]);

        const atuais = await env.DB.prepare(`
          SELECT a.ra, a.nome, a.curso, a.unidade, a.email, a.email_outro, a.status,
                 d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
          FROM alunos a LEFT JOIN documentos d ON d.aluno_id = a.id WHERE a.periodo_id = ?
        `).bind(periodoId).all<AlunoRow>();
        const porRa = new Map(atuais.results.map((a) => [a.ra, a]));
        const cursoUnidades = new Map<string, Set<string>>();
        for (const a of atuais.results) {
          const curso = normalizarComparacao(a.curso);
          if (!cursoUnidades.has(curso)) cursoUnidades.set(curso, new Set());
          cursoUnidades.get(curso)!.add(a.unidade);
        }
        const resolverUnidade = (a: LinhaBase) => {
          const existente = porRa.get(a.ra); if (existente) return existente.unidade;
          if (a.origem === "FCH_EAD" && /EAD|E\.A\.D/i.test(a.curso)) return "EAD";
          if (a.origem === "FCH_EAD") return "FCH";
          const conhecidas = [...(cursoUnidades.get(normalizarComparacao(a.curso)) ?? [])].filter((u) => u === "FACE" || u === "FEA");
          return conhecidas.length === 1 ? conhecidas[0] : null;
        };

        let novos = 0, cadastrais = 0, documentosAlterados = 0, cancelar = 0, jaCancelados = 0;
        const semUnidade: Array<{ ra: string; nome: string; curso: string }> = [];
        const amostra: Array<{ ra: string; nome: string; tipo: string; detalhe: string }> = [];
        for (const aluno of bases) {
          const atual = porRa.get(aluno.ra);
          const unidade = resolverUnidade(aluno);
          if (!unidade) semUnidade.push({ ra: aluno.ra, nome: aluno.nome, curso: aluno.curso });
          if (!atual) { novos += 1; if (amostra.length < 20) amostra.push({ ra: aluno.ra, nome: aluno.nome, tipo: "NOVO", detalhe: unidade || "Unidade não resolvida" }); }
          else if ([atual.nome, atual.curso, atual.email ?? "", atual.email_outro ?? ""].map(normalizarComparacao).join("|") !== [aluno.nome, aluno.curso, aluno.email, aluno.email_outro].map(normalizarComparacao).join("|")) {
            cadastrais += 1; if (amostra.length < 20) amostra.push({ ra: aluno.ra, nome: aluno.nome, tipo: "CADASTRO", detalhe: "Dados cadastrais diferentes" });
          }
          const doc = docs.get(aluno.ra);
          if (atual && doc && ([atual.identidade, atual.cpf, atual.certidao, atual.residencia, atual.titulo, atual.ensino_medio, atual.contrato].map(Boolean).join("|") !== [doc.identidade, doc.cpf, doc.certidao, doc.residencia, doc.titulo, doc.ensino_medio, doc.contrato].join("|"))) {
            documentosAlterados += 1; if (amostra.length < 20) amostra.push({ ra: aluno.ra, nome: aluno.nome, tipo: "DOCUMENTOS", detalhe: "Checkboxes diferentes" });
          }
        }
        for (const ra of cancelados) {
          const atual = porRa.get(ra); if (!atual) continue;
          if (atual.status === "CANCELADO") jaCancelados += 1; else cancelar += 1;
        }
        return Response.json({
          sucesso: true,
          planilha: { spreadsheet_id: config.spreadsheet_id, abas_lidas: ranges.map((r) => r.aba) },
          encontrados: bases.length,
          documentos_encontrados: docs.size,
          cancelados_encontrados: cancelados.size,
          novos, alteracoes_cadastrais: cadastrais, documentos_alterados: documentosAlterados,
          prontos_para_cancelar: cancelar, ja_cancelados: jaCancelados,
          unidades_nao_resolvidas: semUnidade.length,
          detalhes_unidades: semUnidade.slice(0, 50),
          amostra,
          modo: "PREVIA_SOMENTE_LEITURA",
        });
      } catch (erro) {
        console.error(erro);
        return Response.json({ erro: erro instanceof Error ? erro.message : "Não foi possível ler o Google Sheets." }, { status: 500 });
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
