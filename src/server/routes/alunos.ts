import { initSyncRecord, type GroupKey } from "../services/sync-d1-core";

type DocumentosAluno = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

type DadosAluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email?: string;
  email_outro?: string;
  documentos?: DocumentosAluno;
};

type AlunoListado = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  status: "ATIVO" | "CANCELADO";
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
};

type TipoPendencia = "ATUALIZAR" | "REMOVER";

type AlunosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  modoApresentacao: boolean;
  registrarPendencia: (
    ra: string,
    tipo: TipoPendencia,
    motivo: string,
  ) => Promise<void>;
};

function validarDadosAluno(body: DadosAluno) {
  const dados = {
    ra: body.ra?.trim(),
    nome: body.nome?.trim(),
    curso: body.curso?.trim(),
    unidade: body.unidade?.trim(),
    email: body.email?.trim() || null,
    emailOutro: body.email_outro?.trim() || null,
  };

  if (!dados.ra || !dados.nome || !dados.curso || !dados.unidade) {
    return null;
  }

  return dados;
}

function erroDadosObrigatorios() {
  return Response.json(
    { erro: "RA, nome, curso e unidade são obrigatórios." },
    { status: 400 },
  );
}

async function listarAlunos(
  db: D1Database,
  periodoId: number,
  modoApresentacao: boolean,
) {
  const resultado = await db
    .prepare(
      `SELECT a.ra,
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
       INNER JOIN documentos d ON d.aluno_id = a.id
       WHERE a.periodo_id = ?
       ORDER BY a.nome`,
    )
    .bind(periodoId)
    .all<AlunoListado>();

  if (!modoApresentacao) return Response.json(resultado.results);

  return Response.json(
    resultado.results.map((aluno, indice) => ({
      ...aluno,
      ra: `APRESENTACAO-${String(indice + 1).padStart(4, "0")}`,
      nome: `Aluno ${String(indice + 1).padStart(4, "0")}`,
      email: "",
      email_outro: "",
    })),
  );
}

async function cadastrarAluno(
  request: Request,
  db: D1Database,
  periodoId: number,
  registrarPendencia: AlunosRouteContext["registrarPendencia"],
) {
  try {
    const body = await request.json<DadosAluno>();
    const dados = validarDadosAluno(body);
    if (!dados) return erroDadosObrigatorios();

    const existente = await db
      .prepare("SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?")
      .bind(periodoId, dados.ra)
      .first<{ id: number }>();

    if (existente) {
      return Response.json(
        { erro: "Já existe um aluno com este RA." },
        { status: 409 },
      );
    }

    const resultado = await db
      .prepare(
        `INSERT INTO alunos (
           periodo_id, ra, nome, email, email_outro, curso, unidade
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        periodoId,
        dados.ra,
        dados.nome,
        dados.email,
        dados.emailOutro,
        dados.curso,
        dados.unidade,
      )
      .run();

    const documentos = body.documentos;
    await db
      .prepare(
        `INSERT INTO documentos (
           aluno_id, identidade, cpf, certidao, residencia,
           titulo, ensino_medio, contrato
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        resultado.meta.last_row_id,
        documentos?.identidade ? 1 : 0,
        documentos?.cpf ? 1 : 0,
        documentos?.certidao ? 1 : 0,
        documentos?.residencia ? 1 : 0,
        documentos?.titulo ? 1 : 0,
        documentos?.ensino_medio ? 1 : 0,
        documentos?.contrato ? 1 : 0,
      )
      .run();

    const integracao = await db
      .prepare(
        `SELECT integration_id, mode, epoch
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{ integration_id: string; mode: string; epoch: number }>();

    const v2Ativa = Boolean(integracao) && integracao!.mode !== "LEGACY";

    if (v2Ativa) {
      const groupKey: GroupKey = ["FACE", "FEA"].includes(dados.unidade)
        ? "FACE_FEA"
        : "FCH_EAD";
      const recordId = `rec-${periodoId}-${groupKey}-${dados.ra}`;

      await initSyncRecord(db, {
        recordId,
        integrationId: integracao!.integration_id,
        raText: dados.ra,
        groupKey,
        alunoId: resultado.meta.last_row_id,
        generation: 1,
        lifecycle: "ACTIVE",
        initialValues: {
          identidade: documentos?.identidade ? 1 : 0,
          cpf_documento: documentos?.cpf ? 1 : 0,
          certidao: documentos?.certidao ? 1 : 0,
          residencia: documentos?.residencia ? 1 : 0,
          titulo: documentos?.titulo ? 1 : 0,
          ensino_medio: documentos?.ensino_medio ? 1 : 0,
          contrato: documentos?.contrato ? 1 : 0,
        },
      });
    } else {
      await registrarPendencia(dados.ra, "ATUALIZAR", "NOVO ALUNO");
    }

    return Response.json(
      { sucesso: true, ra: dados.ra, id: resultado.meta.last_row_id },
      { status: 201 },
    );
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível cadastrar o aluno." },
      { status: 500 },
    );
  }
}

async function editarAluno(
  request: Request,
  db: D1Database,
  periodoId: number,
  raAtual: string,
  registrarPendencia: AlunosRouteContext["registrarPendencia"],
) {
  try {
    const body = await request.json<DadosAluno>();
    const dados = validarDadosAluno(body);
    if (!dados) return erroDadosObrigatorios();

    const aluno = await db
      .prepare("SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?")
      .bind(periodoId, raAtual)
      .first<{ id: number }>();

    if (!aluno) {
      return Response.json({ erro: "Aluno não encontrado." }, { status: 404 });
    }

    if (dados.ra !== raAtual) {
      const raEmUso = await db
        .prepare(
          `SELECT id FROM alunos
           WHERE periodo_id = ? AND ra = ? AND id <> ?`,
        )
        .bind(periodoId, dados.ra, aluno.id)
        .first<{ id: number }>();

      if (raEmUso) {
        return Response.json(
          { erro: "Já existe outro aluno com este RA." },
          { status: 409 },
        );
      }
    }

    await db
      .prepare(
        `UPDATE alunos
         SET ra = ?, nome = ?, email = ?, email_outro = ?, curso = ?,
             unidade = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        dados.ra,
        dados.nome,
        dados.email,
        dados.emailOutro,
        dados.curso,
        dados.unidade,
        aluno.id,
      )
      .run();

    const integracao = await db
      .prepare(
        `SELECT integration_id, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    const v2Ativa = Boolean(integracao) && integracao!.mode !== "LEGACY";

    if (v2Ativa) {
      if (dados.ra !== raAtual) {
        await db
          .prepare(
            `UPDATE sync_records
             SET lifecycle = 'TOMBSTONE', updated_at = CURRENT_TIMESTAMP
             WHERE integration_id = ? AND ra_text = ?`,
          )
          .bind(integracao!.integration_id, raAtual)
          .run();

        const groupKey: GroupKey = ["FACE", "FEA"].includes(dados.unidade)
          ? "FACE_FEA"
          : "FCH_EAD";
        const recordId = `rec-${periodoId}-${groupKey}-${dados.ra}`;

        const docRow = await db
          .prepare(`SELECT * FROM documentos WHERE aluno_id = ?`)
          .bind(aluno.id)
          .first<any>();

        await initSyncRecord(db, {
          recordId,
          integrationId: integracao!.integration_id,
          raText: dados.ra,
          groupKey,
          alunoId: aluno.id,
          generation: 1,
          lifecycle: "ACTIVE",
          initialValues: {
            identidade: docRow?.identidade ? 1 : 0,
            cpf_documento: docRow?.cpf ? 1 : 0,
            certidao: docRow?.certidao ? 1 : 0,
            residencia: docRow?.residencia ? 1 : 0,
            titulo: docRow?.titulo ? 1 : 0,
            ensino_medio: docRow?.ensino_medio ? 1 : 0,
            contrato: docRow?.contrato ? 1 : 0,
          },
        });
      }
    } else {
      if (dados.ra !== raAtual) {
        await registrarPendencia(raAtual, "REMOVER", "TROCA DE RA");
      }
      await registrarPendencia(dados.ra, "ATUALIZAR", "CADASTRO");
    }

    return Response.json({
      sucesso: true,
      ra_anterior: raAtual,
      ra: dados.ra,
    });
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível atualizar o aluno." },
      { status: 500 },
    );
  }
}

async function excluirAluno(
  db: D1Database,
  periodoId: number,
  ra: string,
  registrarPendencia: AlunosRouteContext["registrarPendencia"],
) {
  try {
    const aluno = await db
      .prepare("SELECT id FROM alunos WHERE periodo_id = ? AND ra = ?")
      .bind(periodoId, ra)
      .first<{ id: number }>();

    if (!aluno) {
      return Response.json({ erro: "Aluno não encontrado." }, { status: 404 });
    }

    const integracao = await db
      .prepare(
        `SELECT integration_id, mode
         FROM sync_integrations
         WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{ integration_id: string; mode: string }>();

    const v2Ativa = Boolean(integracao) && integracao!.mode !== "LEGACY";

    if (v2Ativa) {
      await db
        .prepare(
          `UPDATE sync_records
           SET lifecycle = 'TOMBSTONE', updated_at = CURRENT_TIMESTAMP
           WHERE integration_id = ? AND ra_text = ?`,
        )
        .bind(integracao!.integration_id, ra)
        .run();
    } else {
      await registrarPendencia(ra, "REMOVER", "EXCLUSÃO");
    }

    await db.prepare("DELETE FROM alunos WHERE id = ?").bind(aluno.id).run();
    return Response.json({ sucesso: true, ra });
  } catch (erro) {
    console.error(erro);
    return Response.json(
      { erro: "Não foi possível excluir o aluno." },
      { status: 500 },
    );
  }
}

export async function handleAlunosRoute({
  request,
  url,
  db,
  periodoId,
  modoApresentacao,
  registrarPendencia,
}: AlunosRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/alunos") {
    if (request.method === "GET") {
      return listarAlunos(db, periodoId, modoApresentacao);
    }
    if (request.method === "POST") {
      return cadastrarAluno(request, db, periodoId, registrarPendencia);
    }
  }

  const rotaAluno = url.pathname.match(/^\/api\/alunos\/([^/]+)$/);
  if (rotaAluno && request.method === "PUT") {
    return editarAluno(
      request,
      db,
      periodoId,
      decodeURIComponent(rotaAluno[1]),
      registrarPendencia,
    );
  }
  if (rotaAluno && request.method === "DELETE") {
    return excluirAluno(
      db,
      periodoId,
      decodeURIComponent(rotaAluno[1]),
      registrarPendencia,
    );
  }

  return null;
}
