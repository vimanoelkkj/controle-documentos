import type { UsuarioSessao } from "./auth";
import type { EventoAuditoria } from "../services/auditoria";
import {
  executeMultiFieldMutation,
  type FieldKey,
  type GroupKey,
  type MutationInput,
} from "../services/sync-d1-core";

export type DocumentosBody = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

export type DocumentosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  periodoId: number;
  usuarioAtual?: UsuarioSessao | null;
  podeEditar?: boolean;
  registrarAuditoria?: (evento: EventoAuditoria) => Promise<void>;
  registrarPendencia: (ra: string) => Promise<void>;
};

interface CampoConfig {
  bodyKey: keyof DocumentosBody;
  fieldKey: FieldKey;
  docCol: "identidade" | "cpf" | "certidao" | "residencia" | "titulo" | "ensino_medio" | "contrato";
}

const CAMPOS_DOCUMENTAIS: CampoConfig[] = [
  { bodyKey: "identidade", fieldKey: "identidade", docCol: "identidade" },
  { bodyKey: "cpf", fieldKey: "cpf_documento", docCol: "cpf" },
  { bodyKey: "certidao", fieldKey: "certidao", docCol: "certidao" },
  { bodyKey: "residencia", fieldKey: "residencia", docCol: "residencia" },
  { bodyKey: "titulo", fieldKey: "titulo", docCol: "titulo" },
  { bodyKey: "ensino_medio", fieldKey: "ensino_medio", docCol: "ensino_medio" },
  { bodyKey: "contrato", fieldKey: "contrato", docCol: "contrato" },
];

export async function handleDocumentosRoute({
  request,
  url,
  db,
  periodoId,
  usuarioAtual,
  podeEditar = true,
  registrarAuditoria,
  registrarPendencia,
}: DocumentosRouteContext): Promise<Response | null> {
  const rotaDocumentos = url.pathname.match(
    /^\/api\/alunos\/([^/]+)\/documentos$/,
  );
  if (!rotaDocumentos || request.method !== "PUT") return null;

  if (podeEditar === false) {
    return Response.json(
      { erro: "Seu perfil é somente visualização." },
      { status: 403 },
    );
  }

  const ra = decodeURIComponent(rotaDocumentos[1]);

  let body: DocumentosBody;
  try {
    body = await request.json<DocumentosBody>();
  } catch {
    return Response.json(
      { erro: "Corpo da requisição inválido (JSON esperado)." },
      { status: 400 },
    );
  }

  // 1. Busca do aluno preservando RA textual (zeros à esquerda) e período
  const aluno = await db
    .prepare(
      `SELECT id, ra, nome, unidade, periodo_id
       FROM alunos
       WHERE periodo_id = ? AND ra = ?`,
    )
    .bind(periodoId, ra)
    .first<{
      id: number;
      ra: string;
      nome: string;
      unidade: string;
      periodo_id: number;
    }>();

  if (!aluno) {
    return Response.json({ erro: "Aluno não encontrado." }, { status: 404 });
  }

  // 2. Busca do estado atual em documentos para diffing estrito
  let docAtual = await db
    .prepare(
      `SELECT identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
       FROM documentos
       WHERE aluno_id = ?`,
    )
    .bind(aluno.id)
    .first<{
      identidade: number;
      cpf: number;
      certidao: number;
      residencia: number;
      titulo: number;
      ensino_medio: number;
      contrato: number;
    }>();

  if (!docAtual) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO documentos (
          aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
        ) VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
      )
      .bind(aluno.id)
      .run();

    docAtual = {
      identidade: 0,
      cpf: 0,
      certidao: 0,
      residencia: 0,
      titulo: 0,
      ensino_medio: 0,
      contrato: 0,
    };
  }

  // 3. Diffing estrito: apenas campos com diferença real de valor
  const camposAlterados = CAMPOS_DOCUMENTAIS.filter((campo) => {
    const valorAtual = docAtual![campo.docCol] ? 1 : 0;
    const valorProposto = body[campo.bodyKey] ? 1 : 0;
    return valorAtual !== valorProposto;
  });

  // No-op seguro: se nenhum documento mudou, responde com sucesso imediatamente
  if (camposAlterados.length === 0) {
    return Response.json({ sucesso: true, ra: aluno.ra });
  }

  // 4. Verificação de Cutover V2: existe integração V2 ativa para este aluno/período?
  const groupEsperado: GroupKey = ["FACE", "FEA"].includes(aluno.unidade)
    ? "FACE_FEA"
    : "FCH_EAD";

  const syncRecords = await db
    .prepare(
      `SELECT
         r.record_id,
         r.integration_id,
         r.group_key,
         r.generation,
         r.lifecycle,
         i.periodo_id,
         i.epoch,
         i.mode
       FROM sync_records r
       JOIN sync_integrations i ON i.integration_id = r.integration_id
       WHERE (r.aluno_id = ? OR (r.ra_text = ? AND i.periodo_id = ?))
         AND r.lifecycle = 'ACTIVE'`,
    )
    .bind(aluno.id, aluno.ra, periodoId)
    .all<{
      record_id: string;
      integration_id: string;
      group_key: GroupKey;
      generation: number;
      lifecycle: string;
      periodo_id: number;
      epoch: number;
      mode: string;
    }>();

  const syncRecord =
    syncRecords.results.find((rec) => rec.group_key === groupEsperado) ??
    syncRecords.results[0];

  const v2Ativa =
    Boolean(syncRecord) &&
    syncRecord.mode !== "LEGACY" &&
    syncRecord.mode !== "PAUSED" &&
    syncRecord.mode !== "QUARANTINED";

  if (v2Ativa) {
    // =========================================================================
    // FLUXO SINCRONIZAÇÃO V2: Mutação Atômica via Núcleo D1 + Outbox V2
    // =========================================================================
    const fieldStates = await db
      .prepare(
        `SELECT field_key, revision, value, status
         FROM sync_field_state
         WHERE record_id = ?`,
      )
      .bind(syncRecord.record_id)
      .all<{
        field_key: FieldKey;
        revision: number;
        value: number | null;
        status: string;
      }>();

    for (const campo of camposAlterados) {
      const state = fieldStates.results.find(
        (s) => s.field_key === campo.fieldKey,
      );
      if (state && state.status === "UNBASELINED") {
        return Response.json(
          {
            erro: `Campo '${campo.fieldKey}' está UNBASELINED. Não é permitido mutação sobre dado desconhecido.`,
          },
          { status: 422 },
        );
      }
    }

    const clientKey =
      request.headers.get("x-idempotency-key") ||
      request.headers.get("x-command-id");
    const baseId = clientKey || crypto.randomUUID();
    const actorId = usuarioAtual ? `user-${usuarioAtual.id}` : "api-documentos";

    const mutationInputs: MutationInput[] = camposAlterados.map((campo) => {
      const state = fieldStates.results.find(
        (s) => s.field_key === campo.fieldKey,
      );
      return {
        commandId: `${baseId}-${campo.fieldKey}`,
        actorId,
        recordId: syncRecord.record_id,
        fieldKey: campo.fieldKey,
        fromRevision: state?.revision ?? 0,
        proposedValue: body[campo.bodyKey] ? 1 : 0,
        integrationId: syncRecord.integration_id,
        periodoId,
        groupKey: syncRecord.group_key,
        generation: syncRecord.generation,
        epoch: syncRecord.epoch,
      };
    });

    const mutationResult = await executeMultiFieldMutation(
      db,
      mutationInputs,
    );

    if (!mutationResult.ok) {
      if (
        mutationResult.status === "CAS_CONFLICT" ||
        mutationResult.status === "REVISION_CONFLICT"
      ) {
        return Response.json(
          {
            erro: "Conflito de concorrência: o registro foi alterado por outro usuário ou processo. Atualize e tente novamente.",
          },
          { status: 409 },
        );
      }

      if (mutationResult.status === "INTEGRITY_ERROR") {
        return Response.json({ erro: mutationResult.error }, { status: 422 });
      }

      return Response.json({ erro: mutationResult.error }, { status: 500 });
    }

    if (registrarAuditoria) {
      const alteradosStr = camposAlterados.map((c) => c.bodyKey).join(", ");
      await registrarAuditoria({
        acao: "ATUALIZAR",
        entidade: "DOCUMENTOS",
        descricao: `Documentos atualizados para o aluno RA ${aluno.ra} (${alteradosStr})`,
        ra: aluno.ra,
        unidade: aluno.unidade,
      });
    }

    // Com V2 ativa, a gravação legada na outbox V1 (google_sheets_pendencias) é estritamente suprimida!
    return Response.json({ sucesso: true, ra: aluno.ra });
  }

  // =========================================================================
  // FALLBACK V1 (Períodos sem V2 configurada ou em modo LEGACY)
  // =========================================================================
  await db
    .prepare(
      `UPDATE documentos
       SET identidade = ?,
           cpf = ?,
           certidao = ?,
           residencia = ?,
           titulo = ?,
           ensino_medio = ?,
           contrato = ?,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE aluno_id = ?`,
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

  await registrarPendencia(aluno.ra);

  if (registrarAuditoria) {
    const alteradosStr = camposAlterados.map((c) => c.bodyKey).join(", ");
    await registrarAuditoria({
      acao: "ATUALIZAR",
      entidade: "DOCUMENTOS",
      descricao: `Documentos atualizados para o aluno RA ${aluno.ra} (${alteradosStr}) (V1)`,
      ra: aluno.ra,
      unidade: aluno.unidade,
    });
  }

  return Response.json({ sucesso: true, ra: aluno.ra });
}
