import type { UsuarioSessao } from "./auth";
import type { EventoAuditoria } from "../services/auditoria";
import {
  executeMultiFieldMutation,
  derivarGroupKey,
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
  docCol:
    | "identidade"
    | "cpf"
    | "certidao"
    | "residencia"
    | "titulo"
    | "ensino_medio"
    | "contrato";
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

/**
 * Calcula o hash canônico do payload da requisição HTTP inteira para idempotência estrita.
 */
async function computeHttpPayloadHash(
  ra: string,
  periodoId: number,
  body: DocumentosBody,
): Promise<string> {
  const normalized = `v2:http_docs:${periodoId}:${ra}:${body.identidade ? 1 : 0}:${body.cpf ? 1 : 0}:${body.certidao ? 1 : 0}:${body.residencia ? 1 : 0}:${body.titulo ? 1 : 0}:${body.ensino_medio ? 1 : 0}:${body.contrato ? 1 : 0}`;
  const msgUint8 = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

  // 4. Verificação explícita do modo do período (Cutover Seguro - Ponto 3)
  const integracao = await db
    .prepare(
      `SELECT integration_id, periodo_id, mode, epoch, layout_revision
       FROM sync_integrations
       WHERE periodo_id = ?`,
    )
    .bind(periodoId)
    .first<{
      integration_id: string;
      periodo_id: number;
      mode: string;
      epoch: number;
      layout_revision: number;
    }>();

  const isPeriodoExplicitamenteLegado =
    !integracao || integracao.mode === "LEGACY";

  // =========================================================================
  // CASO A: PERÍODO EXPLICITAMENTE LEGADO (V1 PERMITIDA)
  // =========================================================================
  if (isPeriodoExplicitamenteLegado) {
    // No-op seguro
    if (camposAlterados.length === 0) {
      return Response.json({ sucesso: true, ra: aluno.ra });
    }

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
        descricao: `Documentos atualizados para o aluno RA ${aluno.ra} (${alteradosStr}) (V1 LEGACY)`,
        ra: aluno.ra,
        unidade: aluno.unidade,
      });
    }

    return Response.json({ sucesso: true, ra: aluno.ra });
  }

  // =========================================================================
  // CASO B: PERÍODO CONFIGURADO PARA V2 (FAIL-CLOSED: NUNCA FAZ FALLBACK V1)
  // =========================================================================

  // 4.1. Verificação de saúde da integração do período
  if (integracao.mode === "PAUSED" || integracao.mode === "QUARANTINED") {
    return Response.json(
      {
        erro: `Sincronização V2 indisponível: o período está em modo ${integracao.mode}. Operação documental bloqueada.`,
      },
      { status: 409 },
    );
  }

  // 4.2. Busca e validação do registro do aluno na V2
  const groupEsperado = derivarGroupKey(aluno.unidade);
  if (!groupEsperado) {
    return Response.json(
      {
        erro: `Unidade '${aluno.unidade}' do aluno não corresponde a nenhum grupo V2 válido.`,
      },
      { status: 400 },
    );
  }

  const syncRecords = await db
    .prepare(
      `SELECT
         record_id,
         integration_id,
         group_key,
         generation,
         lifecycle
       FROM sync_records
       WHERE integration_id = ?
         AND (aluno_id = ? OR ra_text = ?)`,
    )
    .bind(integracao.integration_id, aluno.id, aluno.ra)
    .all<{
      record_id: string;
      integration_id: string;
      group_key: GroupKey;
      generation: number;
      lifecycle: string;
    }>();

  const syncRecord =
    syncRecords.results.find((rec) => rec.group_key === groupEsperado) ??
    syncRecords.results[0];

  if (!syncRecord) {
    return Response.json(
      {
        erro: "Aluno não possui registro de sincronização V2 no período configurado. Fallback para V1 proibido em períodos V2.",
      },
      { status: 422 },
    );
  }

  if (syncRecord.lifecycle !== "ACTIVE") {
    return Response.json(
      {
        erro: `Registro de sincronização do aluno está ${syncRecord.lifecycle} e não aceita mutações documentais.`,
      },
      { status: 422 },
    );
  }

  // 4.3. Validação de baseline nos campos documentais
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
    if (!state || state.status === "UNBASELINED") {
      return Response.json(
        {
          erro: `Campo '${campo.fieldKey}' está UNBASELINED ou inexistente. Estabeleça a linha de base antes de aplicar mutações.`,
        },
        { status: 422 },
      );
    }
  }

  // 4.4. Idempotência estrita no nível da requisição HTTP (Ponto 2)
  const clientKey =
    request.headers.get("x-idempotency-key") ||
    request.headers.get("x-command-id");
  const actorId = usuarioAtual ? `user-${usuarioAtual.id}` : "api-documentos";

  let rootCommandId: string | undefined;
  let httpPayloadHash: string | undefined;

  if (clientKey) {
    rootCommandId = `req:${clientKey}`;
    httpPayloadHash = await computeHttpPayloadHash(aluno.ra, periodoId, body);

    const existingRoot = await db
      .prepare(
        `SELECT command_id, request_hash, status
         FROM sync_commands
         WHERE actor_id = ? AND command_id = ?`,
      )
      .bind(actorId, rootCommandId)
      .first<{ command_id: string; request_hash: string; status: string }>();

    if (existingRoot) {
      // Rejeição explícita se reutilizada com payload divergente!
      if (existingRoot.request_hash !== httpPayloadHash) {
        return Response.json(
          {
            erro: "Chave de idempotência reutilizada com payload divergente.",
          },
          { status: 422 },
        );
      }
      // Replay idempotente válido: responde sucesso sem duplicar
      return Response.json({ sucesso: true, ra: aluno.ra });
    }
  }

  // No-op seguro (quando não há campos alterados e não houve conflito de idempotência)
  if (camposAlterados.length === 0) {
    return Response.json({ sucesso: true, ra: aluno.ra });
  }

  // 4.5. Montagem das mutações atômicas para os campos alterados
  const baseId = clientKey || crypto.randomUUID();

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
      integrationId: integracao.integration_id,
      periodoId,
      groupKey: syncRecord.group_key,
      generation: syncRecord.generation,
      epoch: integracao.epoch,
    };
  });

  const mutationResult = await executeMultiFieldMutation(
    db,
    mutationInputs,
    clientKey && rootCommandId && httpPayloadHash
      ? {
          rootCommand: {
            commandId: rootCommandId,
            actorId,
            recordId: syncRecord.record_id,
            requestHash: httpPayloadHash,
          },
        }
      : undefined,
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
