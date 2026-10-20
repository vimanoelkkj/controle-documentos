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
  initSyncRecord,
  establishFieldBaseline,
  type FieldKey,
  type GroupKey,
  type BaselineEvidence,
} from "./sync-d1-core";
import {
  CONTROL_DOC_COLUMNS,
  type ISyncSpreadsheetAdapter,
} from "./sync-sheet-contracts";

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

async function sha256Hex(content: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(content));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function derivarGroupKey(unidade: string): GroupKey {
  return ["FACE", "FEA"].includes(String(unidade ?? "").trim().toUpperCase())
    ? "FACE_FEA"
    : "FCH_EAD";
}

export async function prepareExistingAlunosBaselines(
  db: D1Database,
  options: PrepareBaselinesOptions,
): Promise<BaselineSeederReport> {
  const {
    periodoId,
    integrationId,
    actorId,
    dryRun = false,
    externalAdapter,
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

  if (integracao.mode === "PAUSED" || integracao.mode === "QUARANTINED") {
    report.bloqueios.push({
      ra: "*",
      motivo: `Integração V2 está em modo ${integracao.mode}. Preparação de baselines bloqueada.`,
    });
    return report;
  }

  // 2. Carregar todos os alunos do período com seus documentos consolidados no D1
  const alunosD1 = await db
    .prepare(
      `SELECT a.id, a.ra, a.nome, a.unidade, a.curso, a.status,
              d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
       FROM alunos a
       LEFT JOIN documentos d ON d.aluno_id = a.id
       WHERE a.periodo_id = ?
       ORDER BY a.ra ASC, a.id ASC`,
    )
    .bind(periodoId)
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
  for (const aluno of alunosD1.results) {
    const groupKey = derivarGroupKey(aluno.unidade);
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

    if (syncRecordExistente) {
      // Verifica se todos os 7 campos já possuem baseline estabelecida
      const fieldsState = await db
        .prepare(
          `SELECT field_key, status, revision, value
           FROM sync_field_state
           WHERE record_id = ?`,
        )
        .bind(syncRecordExistente.record_id)
        .all<{
          field_key: FieldKey;
          status: string;
          revision: number;
          value: number | null;
        }>();

      const todosConfirmados =
        fieldsState.results.length === 7 &&
        fieldsState.results.every((f) => f.status !== "UNBASELINED");

      if (todosConfirmados) {
        // Idempotência estrita: não sobrescreve baselines já existentes
        report.alunosJaExistentes++;
        report.detalhes.push({
          ra: aluno.ra,
          groupKey,
          status: "JA_PREPARADO",
        });
        continue;
      }
    }

    // 5.2. Valores consolidados no D1
    const d1Values: Record<FieldKey, 0 | 1> = {
      identidade: aluno.identidade ? 1 : 0,
      cpf_documento: aluno.cpf ? 1 : 0,
      certidao: aluno.certidao ? 1 : 0,
      residencia: aluno.residencia ? 1 : 0,
      titulo: aluno.titulo ? 1 : 0,
      ensino_medio: aluno.ensino_medio ? 1 : 0,
      contrato: aluno.contrato ? 1 : 0,
    };

    // 5.3. Comparação com snapshot externo (se disponível)
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

    // 5.4. Execução da inicialização (se não for dry-run)
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

    const recordId =
      syncRecordExistente?.record_id ??
      `rec-${periodoId}-${groupKey}-${aluno.ra}`;

    // Garante sync_records criado
    if (!syncRecordExistente) {
      await initSyncRecord(db, {
        recordId,
        integrationId,
        raText: aluno.ra,
        groupKey,
        alunoId: aluno.id,
        generation: 1,
        lifecycle: "ACTIVE",
      });
    }

    // Estabelece a linha de base comprovada para cada campo
    for (const field of CONTROL_DOC_COLUMNS) {
      const temDivergencia = divergenciasAluno.some(
        (d) => d.fieldKey === field,
      );

      // Regra de segurança: se o campo estiver com divergência externa não resolvida,
      // não presume igualdade! Mantém UNBASELINED para resolução explícita F3.
      if (temDivergencia) {
        continue;
      }

      const baselineVal = d1Values[field];
      const evidencePayload = JSON.stringify({
        source: "LEGACY_MIGRATION",
        alunoId: aluno.id,
        ra: aluno.ra,
        periodoId,
        groupKey,
        fieldKey: field,
        d1Value: baselineVal,
        timestamp: new Date().toISOString(),
      });
      const evidenceHash = await sha256Hex(evidencePayload);

      const evidence: BaselineEvidence = {
        source: "LEGACY_MIGRATION",
        evidencePayload,
        evidenceHash,
      };

      const baselineCommandId = `base-${recordId}-${field}`;

      await establishFieldBaseline(db, {
        commandId: baselineCommandId,
        actorId,
        recordId,
        fieldKey: field,
        baselineValue: baselineVal,
        integrationId,
        periodoId,
        groupKey,
        generation: 1,
        epoch: integracao.epoch,
        evidence,
      });
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

  report.sucesso = true;
  return report;
}
