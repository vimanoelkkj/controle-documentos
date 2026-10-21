/**
 * ============================================================================
 * Preparador de Linha de Base (Baseline Seeder) — Sincronização V2 (P0.2)
 * ============================================================================
 * Implementa rotina idempotente e segura para preparar alunos existentes
 * para o núcleo V2:
 *  - Identificação de período, grupo (FACE_FEA / FCH_EAD), RA textual e integração.
 *  - Leitura do estado documental consolidado no D1.
 *  - Comparação opcional com snapshots externos do Google Sheets sem presunção de igualdade.
 *  - Criação de sync_records e inicialização de sync_field_state com contratos V2.
 *  - Não sobrescreve baselines existentes (idempotência estrita).
 *  - Relatório detalhado de alunos preparados, divergências, duplicidades e bloqueios.
 *  - Suporte a execução em modo dry-run.
 *  - Retomabilidade segura após falhas parciais.
 */

import {
  derivarGroupKey,
  type FieldKey,
  type GroupKey,
} from "./sync-d1-core";
import {
  CONTROL_DOC_COLUMNS,
  type ISyncSpreadsheetAdapter,
} from "./sync-sheet-contracts";

export { derivarGroupKey } from "./sync-d1-core";

export interface PrepareBaselinesOptions {
  periodoId: number;
  integrationId: string;
  actorId: string;
  dryRun?: boolean;
  externalAdapter?: ISyncSpreadsheetAdapter;
  spreadsheetId?: string;
  tabNames?: {
    faceFea?: string;
    fchEad?: string;
  };
  targetRas?: string[];
  prependStatements?: D1PreparedStatement[];
  appendStatements?: D1PreparedStatement[];
}

export interface BaselineSeederReport {
  sucesso: boolean;
  periodoId: number;
  integrationId: string;
  dryRun: boolean;
  totalAlunosD1: number;
  alunosPreparados: number;
  alunosJaExistentes: number;
  duplicidades: Array<{
    ra: string;
    groupKey: GroupKey;
    alunoIds: number[];
  }>;
  divergencias: Array<{
    ra: string;
    groupKey: GroupKey;
    fieldKey: FieldKey;
    d1Value: 0 | 1;
    sheetValue: 0 | 1 | null;
  }>;
  bloqueios: Array<{
    ra: string;
    motivo: string;
  }>;
  detalhes: Array<{
    ra: string;
    groupKey: GroupKey;
    status:
      | "PREPARADO"
      | "JA_PREPARADO"
      | "DIVERGENCIA"
      | "BLOQUEADO"
      | "DUPLICADO";
    motivo?: string;
  }>;
}

export async function prepareExistingAlunosBaselines(
  db: D1Database,
  options: PrepareBaselinesOptions,
): Promise<BaselineSeederReport> {
  const {
    periodoId,
    integrationId,
    actorId: _actorId,
    dryRun = false,
    externalAdapter,
    targetRas,
  } = options;

  const report: BaselineSeederReport = {
    sucesso: false,
    periodoId,
    integrationId,
    dryRun,
    totalAlunosD1: 0,
    alunosPreparados: 0,
    alunosJaExistentes: 0,
    duplicidades: [],
    divergencias: [],
    bloqueios: [],
    detalhes: [],
  };

  // 1. Validar a integração no período
  const integracao = await db
    .prepare(
      `SELECT integration_id, periodo_id, spreadsheet_id, epoch, layout_revision, mode
       FROM sync_integrations
       WHERE integration_id = ? AND periodo_id = ?`,
    )
    .bind(integrationId, periodoId)
    .first<{
      integration_id: string;
      periodo_id: number;
      spreadsheet_id: string;
      epoch: number;
      layout_revision: number;
      mode: string;
    }>();

  if (!integracao) {
    report.bloqueios.push({
      ra: "*",
      motivo: `Integração V2 '${integrationId}' não encontrada para o período ${periodoId}.`,
    });
    return report;
  }

  if (integracao.mode === "QUARANTINED") {
    report.bloqueios.push({
      ra: "*",
      motivo: `Integração V2 está em modo QUARANTINED. Preparação de baselines bloqueada.`,
    });
    return report;
  }

  // 2. Carregar alunos do período com seus documentos consolidados no D1 (com filtro opcional por targetRas)
  let queryAlunos = `SELECT a.id, a.ra, a.nome, a.unidade, a.curso, a.status,
                            d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
                     FROM alunos a
                     LEFT JOIN documentos d ON d.aluno_id = a.id
                     WHERE a.periodo_id = ?`;
  const paramsQuery: (string | number)[] = [periodoId];

  if (targetRas && targetRas.length > 0) {
    const placeholders = targetRas.map(() => "?").join(", ");
    queryAlunos += ` AND a.ra IN (${placeholders})`;
    paramsQuery.push(...targetRas);
  }
  queryAlunos += ` ORDER BY a.ra ASC, a.id ASC`;

  const alunosD1 = await db
    .prepare(queryAlunos)
    .bind(...paramsQuery)
    .all<{
      id: number;
      ra: string;
      nome: string;
      unidade: string;
      curso: string;
      status: string;
      identidade: number | null;
      cpf: number | null;
      certidao: number | null;
      residencia: number | null;
      titulo: number | null;
      ensino_medio: number | null;
      contrato: number | null;
    }>();

  report.totalAlunosD1 = alunosD1.results.length;

  if (alunosD1.results.length === 0) {
    report.sucesso = true;
    return report;
  }

  // 3. Detecção de duplicidades cadastrais (mesmo RA no mesmo grupo/período)
  const mapaPorChave = new Map<string, typeof alunosD1.results>();
  for (const aluno of alunosD1.results) {
    const groupKey = derivarGroupKey(aluno.unidade);
    if (!groupKey) {
      report.bloqueios.push({
        ra: aluno.ra,
        motivo: `Unidade inválida ou desconhecida: '${aluno.unidade}'. Impossível derivar groupKey para o aluno ${aluno.ra}.`,
      });
      report.detalhes.push({
        ra: aluno.ra,
        groupKey: "FACE_FEA",
        status: "BLOQUEADO",
        motivo: `Unidade inválida: '${aluno.unidade}'`,
      });
      continue;
    }
    const chave = `${groupKey}:${aluno.ra}`;
    const lista = mapaPorChave.get(chave) ?? [];
    lista.push(aluno);
    mapaPorChave.set(chave, lista);
  }

  const rasDuplicados = new Set<string>();
  for (const [chave, lista] of mapaPorChave.entries()) {
    if (lista.length > 1) {
      const [groupKeyStr, ra] = chave.split(":");
      const groupKey = groupKeyStr as GroupKey;
      rasDuplicados.add(chave);
      report.duplicidades.push({
        ra,
        groupKey,
        alunoIds: lista.map((a) => a.id),
      });
      report.bloqueios.push({
        ra,
        motivo: `Duplicidade cadastral no D1: ${lista.length} alunos com mesmo RA para o grupo ${groupKey}.`,
      });
      report.detalhes.push({
        ra,
        groupKey,
        status: "DUPLICADO",
        motivo: "Duplicidade cadastral no D1",
      });
    }
  }

  // 4. Leitura opcional de snapshots externos do Google Sheets para comparação
  const externalSnapshotsPorGrupo: Partial<
    Record<GroupKey, Map<string, any>>
  > = {};

  if (externalAdapter) {
    const spreadsheetId = options.spreadsheetId || integracao.spreadsheet_id;

    for (const groupKey of ["FACE_FEA", "FCH_EAD"] as GroupKey[]) {
      const tabName =
        groupKey === "FACE_FEA"
          ? options.tabNames?.faceFea || "FACE_FEA"
          : options.tabNames?.fchEad || "FCH_EAD";

      try {
        const readResult = await externalAdapter.readControlTab({
          spreadsheetId,
          tabName,
          groupKey,
        });
        externalSnapshotsPorGrupo[groupKey] = readResult.rowsByRa;
        if (readResult.duplicateRas && readResult.duplicateRas.length > 0) {
          for (const dupRa of readResult.duplicateRas) {
            const dupKey = `${groupKey}:${dupRa}`;
            rasDuplicados.add(dupKey);
            report.duplicidades.push({
              ra: dupRa,
              groupKey,
              alunoIds: alunosD1.results
                .filter((a) => a.ra === dupRa && derivarGroupKey(a.unidade) === groupKey)
                .map((a) => a.id),
            });
            report.bloqueios.push({
              ra: dupRa,
              motivo: `Duplicidade cadastral no Google Sheets (aba ${groupKey}): RA com múltiplas linhas na planilha.`,
            });
            report.detalhes.push({
              ra: dupRa,
              groupKey,
              status: "DUPLICADO",
              motivo: "Duplicidade na planilha externa Google Sheets",
            });
          }
        }
      } catch (err: any) {
        console.warn(
          `Não foi possível ler snapshot da aba ${tabName} (${groupKey}):`,
          err?.message ?? err,
        );
      }
    }
  }

  // 5. Preparação individual idempotente para cada aluno não duplicado
  const allBatchStmts: D1PreparedStatement[] = [];
  if (options.prependStatements && options.prependStatements.length > 0) {
    allBatchStmts.push(...options.prependStatements);
  }

  for (const aluno of alunosD1.results) {
    const groupKey = derivarGroupKey(aluno.unidade);
    if (!groupKey) {
      continue; // Já bloqueado e registrado na etapa 3
    }
    const chave = `${groupKey}:${aluno.ra}`;

    if (rasDuplicados.has(chave)) {
      continue;
    }

    // 5.1. Verifica se já existe sync_records ativo
    const syncRecordExistente = await db
      .prepare(
        `SELECT record_id, aluno_id, lifecycle, generation
         FROM sync_records
         WHERE integration_id = ? AND group_key = ? AND ra_text = ? AND lifecycle = 'ACTIVE'`,
      )
      .bind(integrationId, groupKey, aluno.ra)
      .first<{
        record_id: string;
        aluno_id: number | null;
        lifecycle: string;
        generation: number;
      }>();

    const recordId =
      syncRecordExistente?.record_id ??
      `rec-${periodoId}-${groupKey}-${aluno.ra}`;

    // 5.2. Carrega estado atual dos campos para validação de idempotência
    const existingFieldStates = syncRecordExistente
      ? await db
          .prepare(
            `SELECT field_key, status, revision, value
             FROM sync_field_state
             WHERE record_id = ?`,
          )
          .bind(recordId)
          .all<{
            field_key: FieldKey;
            status: string;
            revision: number;
            value: number | null;
          }>()
      : { results: [] };

    const existingFieldMap = new Map(
      existingFieldStates.results.map((f) => [f.field_key, f]),
    );

    // Proteção de conflitos e operações pendentes em trânsito
    const activeConflicts = syncRecordExistente
      ? await db
          .prepare(
            `SELECT field_key FROM sync_conflicts WHERE record_id = ? AND resolved = 0`,
          )
          .bind(recordId)
          .all<{ field_key: FieldKey }>()
      : { results: [] };
    const conflictFieldKeys = new Set(
      activeConflicts.results.map((c) => c.field_key),
    );

    const pendingOps = syncRecordExistente
      ? await db
          .prepare(
            `SELECT field_key FROM sync_operations
             WHERE record_id = ? AND state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')`,
          )
          .bind(recordId)
          .all<{ field_key: FieldKey }>()
      : { results: [] };
    const pendingOpFieldKeys = new Set(
      pendingOps.results.map((o) => o.field_key),
    );

    // Idempotência estrita: se todos os 7 campos já estiverem CONFIRMED ou protegidos
    const todosJaPreparados =
      syncRecordExistente !== null &&
      CONTROL_DOC_COLUMNS.every((f) => {
        const st = existingFieldMap.get(f);
        return (
          st &&
          (st.status === "CONFIRMED" ||
            st.revision > 0 ||
            conflictFieldKeys.has(f) ||
            pendingOpFieldKeys.has(f))
        );
      });

    if (todosJaPreparados) {
      report.alunosJaExistentes++;
      report.detalhes.push({
        ra: aluno.ra,
        groupKey,
        status: "JA_PREPARADO",
      });
      continue;
    }

    // 5.3. Valores consolidados no D1 (a partir da tabela documentos)
    const d1Values: Record<FieldKey, 0 | 1> = {
      identidade: aluno.identidade ? 1 : 0,
      cpf_documento: aluno.cpf ? 1 : 0,
      certidao: aluno.certidao ? 1 : 0,
      residencia: aluno.residencia ? 1 : 0,
      titulo: aluno.titulo ? 1 : 0,
      ensino_medio: aluno.ensino_medio ? 1 : 0,
      contrato: aluno.contrato ? 1 : 0,
    };

    // 5.4. Comparação com snapshot externo (se disponível)
    const mapRows = externalSnapshotsPorGrupo[groupKey];
    const externalRow = mapRows?.get(aluno.ra);
    const divergenciasAluno: Array<{
      fieldKey: FieldKey;
      d1Value: 0 | 1;
      sheetValue: 0 | 1 | null;
    }> = [];

    if (externalRow) {
      for (const field of CONTROL_DOC_COLUMNS) {
        const sheetField = externalRow.fields[field];
        const sheetVal = sheetField?.normalizedValue ?? null;
        const d1Val = d1Values[field];

        if (sheetVal !== null && sheetVal !== d1Val) {
          divergenciasAluno.push({
            fieldKey: field,
            d1Value: d1Val,
            sheetValue: sheetVal,
          });
          report.divergencias.push({
            ra: aluno.ra,
            groupKey,
            fieldKey: field,
            d1Value: d1Val,
            sheetValue: sheetVal,
          });
        }
      }
    }

    if (divergenciasAluno.length > 0) {
      report.detalhes.push({
        ra: aluno.ra,
        groupKey,
        status: "DIVERGENCIA",
        motivo: `${divergenciasAluno.length} divergência(s) entre D1 e Planilha.`,
      });
    }

    // 5.5. Execução da inicialização (se não for dry-run)
    if (dryRun) {
      report.alunosPreparados++;
      if (divergenciasAluno.length === 0) {
        report.detalhes.push({
          ra: aluno.ra,
          groupKey,
          status: "PREPARADO",
          motivo: "dry-run",
        });
      }
      continue;
    }

    const batchStmts: D1PreparedStatement[] = [];

    // Garante criação do registro de sincronização sem alterar documentos negociais
    if (!syncRecordExistente) {
      batchStmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO sync_records (
               record_id, integration_id, aluno_id, ra_text, group_key, generation, lifecycle
             ) VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE')`,
          )
          .bind(recordId, integrationId, aluno.id, aluno.ra, groupKey),
      );
    }

    // Inicializa campos que ainda não estão estabelecidos
    for (const field of CONTROL_DOC_COLUMNS) {
      const existingField = existingFieldMap.get(field);

      // Preservação estrita: não sobrescreve estados já confirmados, revisões superiores,
      // conflitos abertos nem operações pendentes
      if (
        existingField &&
        (existingField.status === "CONFIRMED" ||
          existingField.revision > 0 ||
          conflictFieldKeys.has(field) ||
          pendingOpFieldKeys.has(field))
      ) {
        continue;
      }

      const temDivergencia = divergenciasAluno.some(
        (d) => d.fieldKey === field,
      );

      // Regra de segurança: se o campo estiver com divergência externa não resolvida,
      // mantém UNBASELINED com value = NULL para resolução explícita
      if (temDivergencia) {
        batchStmts.push(
          db
            .prepare(
              `INSERT INTO sync_field_state (
                 record_id, field_key, value, revision, status, updated_at
               ) VALUES (?, ?, NULL, 0, 'UNBASELINED', CURRENT_TIMESTAMP)
               ON CONFLICT(record_id, field_key) DO UPDATE SET
                 value = NULL,
                 revision = 0,
                 status = 'UNBASELINED',
                 updated_at = CURRENT_TIMESTAMP
               WHERE revision = 0 AND (status = 'UNBASELINED' OR status IS NULL)`,
            )
            .bind(recordId, field),
        );
        continue;
      }

      const baselineVal = d1Values[field];
      // Inicializa sync_field_state com revision = 0 e status = CONFIRMED
      // SEM ALTERAR A TABELA DOCUMENTOS NEM SEU TIMESTAMP (atualizado_em)
      // Proteção atômica anti-TOCTOU no D1: condiciona inserção e atualização à ausência de
      // conflitos não resolvidos e operações outbound ativas no exato instante do commit.
      batchStmts.push(
        db
          .prepare(
            `INSERT INTO sync_field_state (
               record_id, field_key, value, revision, status, updated_at
             )
             SELECT ?, ?, ?, 0, 'CONFIRMED', CURRENT_TIMESTAMP
             WHERE NOT EXISTS (
               SELECT 1 FROM sync_conflicts
               WHERE record_id = ? AND field_key = ? AND resolved = 0
             )
             AND NOT EXISTS (
               SELECT 1 FROM sync_operations
               WHERE record_id = ? AND field_key = ?
                 AND state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')
             )
             ON CONFLICT(record_id, field_key) DO UPDATE SET
               value = excluded.value,
               revision = 0,
               status = 'CONFIRMED',
               updated_at = CURRENT_TIMESTAMP
             WHERE revision = 0
               AND (status = 'UNBASELINED' OR status IS NULL)
               AND NOT EXISTS (
                 SELECT 1 FROM sync_conflicts
                 WHERE record_id = excluded.record_id AND field_key = excluded.field_key AND resolved = 0
               )
               AND NOT EXISTS (
                 SELECT 1 FROM sync_operations
                 WHERE record_id = excluded.record_id AND field_key = excluded.field_key
                   AND state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')
               )`,
          )
          .bind(
            recordId,
            field,
            baselineVal,
            recordId,
            field,
            recordId,
            field,
          ),
      );
    }

    if (batchStmts.length > 0) {
      allBatchStmts.push(...batchStmts);
    }

    report.alunosPreparados++;
    if (divergenciasAluno.length === 0) {
      report.detalhes.push({
        ra: aluno.ra,
        groupKey,
        status: "PREPARADO",
      });
    }
  }

  if (options.appendStatements && options.appendStatements.length > 0) {
    allBatchStmts.push(...options.appendStatements);
  }

  if (!dryRun && allBatchStmts.length > 0) {
    await db.batch(allBatchStmts);
  }

  report.sucesso = true;
  return report;
}
