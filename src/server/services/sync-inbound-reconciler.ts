/**
 * ============================================================================
 * Sincronização Inbound V2 (Google Sheets → Cloudflare D1)
 * ============================================================================
 * Captura alterações documentais feitas diretamente nas planilhas Google Sheets
 * sem eco, com garantias transacionais e reconciliação causal F3:
 *  - Leitura incremental dos snapshots das abas de controle (C:I).
 *  - Verificação de unicidade e validação canônica de RA.
 *  - Detecção de conflitos contra operações ativas na outbox local.
 *  - Atualização atômica de `sync_field_state` e da tabela `documentos` (UI).
 *  - Ausência estrita de eco para o Sheets (prevenção de loops).
 *  - Rastreabilidade de proveniência com evidência estruturada.
 *  - Idempotência total e suporte a modo dry-run.
 */

import {
  initSyncRecord,
  type FieldKey,
  type GroupKey,
} from "./sync-d1-core";
import {
  CONTROL_DOC_COLUMNS,
  type ISyncSpreadsheetAdapter,
} from "./sync-sheet-contracts";
import { validateCanonicalRa } from "./sync-d1-auth";
import {
  type TabNameResolver,
  defaultTabNameResolver,
} from "./sync-orchestrator";

export interface InboundSyncOptions {
  periodoId: number;
  integrationId: string;
  actorId: string;
  dryRun?: boolean;
  adapter: ISyncSpreadsheetAdapter;
  tabNameResolver?: TabNameResolver;
  db: D1Database;
  targetGroupKey?: GroupKey; // Se omitido, processa ambos ('FACE_FEA' e 'FCH_EAD')
}

export interface InboundSyncReport {
  sucesso: boolean;
  periodoId: number;
  integrationId: string;
  dryRun: boolean;
  gruposProcessados: GroupKey[];
  totalAlunosLidosNaPlanilha: number;
  camposAtualizadosNoD1: number;
  camposEmSincronia: number;
  conflitosDetectados: number;
  alunosNaoEncontradosNoD1: string[];
  alunosDuplicadosNaPlanilha: string[];
  divergenciasComOutboxPendente: Array<{
    ra: string;
    groupKey: GroupKey;
    fieldKey: FieldKey;
    valorPlanilha: 0 | 1;
    valorLocal: 0 | 1 | null;
    statusOperacaoLocal: string;
  }>;
  mutacoesAplicadas: Array<{
    ra: string;
    groupKey: GroupKey;
    fieldKey: FieldKey;
    valorAnterior: 0 | 1 | null;
    novoValor: 0 | 1;
  }>;
  errosLayout: Array<{
    groupKey: GroupKey;
    tabName: string;
    erro: string;
  }>;
}

const FIELD_TO_DOC_COLUMN: Record<FieldKey, string> = {
  identidade: "identidade",
  cpf_documento: "cpf",
  certidao: "certidao",
  residencia: "residencia",
  titulo: "titulo",
  ensino_medio: "ensino_medio",
  contrato: "contrato",
};

export async function reconcileInboundFromSpreadsheet(
  options: InboundSyncOptions,
): Promise<InboundSyncReport> {
  const {
    periodoId,
    integrationId,
    actorId,
    dryRun = false,
    adapter,
    tabNameResolver = defaultTabNameResolver,
    db,
    targetGroupKey,
  } = options;

  const report: InboundSyncReport = {
    sucesso: true,
    periodoId,
    integrationId,
    dryRun,
    gruposProcessados: [],
    totalAlunosLidosNaPlanilha: 0,
    camposAtualizadosNoD1: 0,
    camposEmSincronia: 0,
    conflitosDetectados: 0,
    alunosNaoEncontradosNoD1: [],
    alunosDuplicadosNaPlanilha: [],
    divergenciasComOutboxPendente: [],
    mutacoesAplicadas: [],
    errosLayout: [],
  };

  // 1. Validação da integração
  const integracao = await db
    .prepare(
      `SELECT integration_id, periodo_id, spreadsheet_id, mode
       FROM sync_integrations
       WHERE integration_id = ? AND periodo_id = ?`,
    )
    .bind(integrationId, periodoId)
    .first<{
      integration_id: string;
      periodo_id: number;
      spreadsheet_id: string;
      mode: string;
    }>();

  if (!integracao) {
    throw new Error(
      `INTEGRACAO_NAO_ENCONTRADA: Integração '${integrationId}' não vinculada ao período ${periodoId}`,
    );
  }

  if (integracao.mode === "PAUSED") {
    throw new Error(
      `INTEGRATION_PAUSED: Integração '${integrationId}' está em pausa operacional.`,
    );
  }
  if (integracao.mode === "QUARANTINED") {
    throw new Error(
      `INTEGRATION_QUARANTINED: Integração '${integrationId}' está em quarentena.`,
    );
  }

  const gruposAProcessar: GroupKey[] = targetGroupKey
    ? [targetGroupKey]
    : ["FACE_FEA", "FCH_EAD"];

  // 2. Itera sobre cada grupo documental
  for (const groupKey of gruposAProcessar) {
    report.gruposProcessados.push(groupKey);
    const tabName = tabNameResolver.getControlTabName(groupKey);

    let controlRead;
    try {
      controlRead = await adapter.readControlTab({
        spreadsheetId: integracao.spreadsheet_id,
        tabName,
        groupKey,
      });
    } catch (err: any) {
      report.errosLayout.push({
        groupKey,
        tabName,
        erro: err?.message || String(err),
      });
      report.sucesso = false;
      continue;
    }

    // Registra RAs duplicados na planilha para bloqueio estrito
    if (controlRead.duplicateRas && controlRead.duplicateRas.length > 0) {
      for (const dupRa of controlRead.duplicateRas) {
        if (!report.alunosDuplicadosNaPlanilha.includes(dupRa)) {
          report.alunosDuplicadosNaPlanilha.push(dupRa);
        }
      }
    }

    report.totalAlunosLidosNaPlanilha += controlRead.rowsByRa.size;

    // 3. Processa cada linha de aluno da planilha
    for (const [raRaw, rowSnapshot] of controlRead.rowsByRa.entries()) {
      // 3.1. Ignora RAs duplicados na planilha para evitar corrupção por ambiguidade
      if (report.alunosDuplicadosNaPlanilha.includes(raRaw)) {
        continue;
      }

      // 3.2. Validação canônica do RA
      const raCheck = validateCanonicalRa(raRaw);
      if (!raCheck.valid) {
        continue;
      }
      const canonicalRa = raCheck.raText;

      // 3.3. Busca aluno existente no D1 para o período
      const aluno = await db
        .prepare(
          `SELECT id, ra, nome, unidade, periodo_id
           FROM alunos
           WHERE periodo_id = ? AND ra = ?`,
        )
        .bind(periodoId, canonicalRa)
        .first<{
          id: number;
          ra: string;
          nome: string;
          unidade: string;
          periodo_id: number;
        }>();

      if (!aluno) {
        if (!report.alunosNaoEncontradosNoD1.includes(canonicalRa)) {
          report.alunosNaoEncontradosNoD1.push(canonicalRa);
        }
        continue;
      }

      // 3.4. Garante existência de sync_records para o aluno
      let syncRecord = await db
        .prepare(
          `SELECT record_id, generation, lifecycle
           FROM sync_records
           WHERE integration_id = ? AND group_key = ? AND ra_text = ? AND lifecycle = 'ACTIVE'`,
        )
        .bind(integrationId, groupKey, canonicalRa)
        .first<{
          record_id: string;
          generation: number;
          lifecycle: string;
        }>();

      if (!syncRecord) {
        const recordId = `rec-${periodoId}-${groupKey}-${canonicalRa}`;
        if (!dryRun) {
          await initSyncRecord(db, {
            recordId,
            integrationId,
            raText: canonicalRa,
            groupKey,
            alunoId: aluno.id,
            generation: 1,
            lifecycle: "ACTIVE",
          });
        }
        syncRecord = {
          record_id: recordId,
          generation: 1,
          lifecycle: "ACTIVE",
        };
      }

      const recordId = syncRecord.record_id;

      // 3.5. Avalia cada um dos 7 campos documentais
      for (const field of CONTROL_DOC_COLUMNS) {
        const sheetField = rowSnapshot.fields[field];
        const sheetNormalized = sheetField?.normalizedValue ?? null;

        // Células em branco / não preenchidas na planilha não alteram o banco
        if (sheetNormalized === null) {
          continue;
        }

        // Lê estado atual no D1
        const fieldState = await db
          .prepare(
            `SELECT value, revision, status
             FROM sync_field_state
             WHERE record_id = ? AND field_key = ?`,
          )
          .bind(recordId, field)
          .first<{
            value: number | null;
            revision: number;
            status: string;
          }>();

        const d1Value = fieldState?.value ?? null;
        const currentRevision = fieldState?.revision ?? 0;

        // Se os valores já são iguais e o estado está confirmado, no-op
        if (d1Value === sheetNormalized && fieldState?.status === "CONFIRMED") {
          report.camposEmSincronia++;
          continue;
        }

        // Se há divergência entre a planilha e o D1:
        // Verifica se existe operação local ativa na outbox pendente de despacho
        const activeOp = await db
          .prepare(
            `SELECT operation_id, state
             FROM sync_operations
             WHERE record_id = ? AND field_key = ? AND state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')
             LIMIT 1`,
          )
          .bind(recordId, field)
          .first<{
            operation_id: string;
            state: string;
          }>();

        if (activeOp) {
          // CONFLITO: A secretaria submeteu alteração local ainda em trânsito
          // NÃO sobrescrever! Registra formalmente na tabela de conflitos F3.
          report.conflitosDetectados++;
          report.divergenciasComOutboxPendente.push({
            ra: canonicalRa,
            groupKey,
            fieldKey: field,
            valorPlanilha: sheetNormalized,
            valorLocal: d1Value as 0 | 1 | null,
            statusOperacaoLocal: activeOp.state,
          });

          if (!dryRun) {
            const conflictId = `conf-inbound-${crypto.randomUUID().slice(0, 8)}`;
            await db
              .prepare(
                `INSERT OR REPLACE INTO sync_conflicts (
                   conflict_id, record_id, field_key, target_key,
                   local_revision, local_value, external_value, reason, resolved
                 ) VALUES (?, ?, ?, 'CONTROLE', ?, ?, ?, 'DIVERGENCIA_COM_OPERACAO_PENDENTE', 0)`,
              )
              .bind(
                conflictId,
                recordId,
                field,
                currentRevision,
                d1Value ?? 0,
                sheetNormalized,
              )
              .run();
          }
          continue;
        }

        // Sem operação local pendente: Ingestão limpa (EXTERNAL_AHEAD)
        report.camposAtualizadosNoD1++;
        report.mutacoesAplicadas.push({
          ra: canonicalRa,
          groupKey,
          fieldKey: field,
          valorAnterior: d1Value as 0 | 1 | null,
          novoValor: sheetNormalized,
        });

        if (!dryRun) {
          const commandId = `cmd-inbound-${crypto.randomUUID().slice(0, 8)}`;
          const eventId = `evt-inbound-${crypto.randomUUID().slice(0, 8)}`;
          const toRevision = currentRevision + 1;
          const docColumn = FIELD_TO_DOC_COLUMN[field];

          const evidenceHash = `inbound:${tabName}:${sheetField.cellCoordinate}:${sheetField.rawValue}:${sheetNormalized}`;

          // Transação Atômica D1 via batch
          await db.batch([
            // 1. Registra comando administrativo de aceitação inbound
            db
              .prepare(
                `INSERT INTO sync_commands (
                   command_id, actor_id, record_id, field_key,
                   from_revision, proposed_value, request_hash, status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`,
              )
              .bind(
                commandId,
                actorId,
                recordId,
                field,
                currentRevision,
                sheetNormalized,
                evidenceHash,
              ),

            // 2. Registra evento causal
            db
              .prepare(
                `INSERT INTO sync_events (
                   event_id, record_id, field_key, command_id,
                   from_revision, to_revision, value_old, value_new, actor_id
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                eventId,
                recordId,
                field,
                commandId,
                currentRevision,
                toRevision,
                d1Value,
                sheetNormalized,
                actorId,
              ),

            // 3. Atualiza estado em sync_field_state
            db
              .prepare(
                `INSERT INTO sync_field_state (
                   record_id, field_key, value, revision, last_event_id, head_command_id, status, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', CURRENT_TIMESTAMP)
                 ON CONFLICT(record_id, field_key) DO UPDATE SET
                   value = excluded.value,
                   revision = ?,
                   last_event_id = excluded.last_event_id,
                   head_command_id = excluded.head_command_id,
                   status = 'CONFIRMED',
                   updated_at = CURRENT_TIMESTAMP`,
              )
              .bind(
                recordId,
                field,
                sheetNormalized,
                toRevision,
                eventId,
                commandId,
                toRevision,
              ),

            // 4. Atualiza a tabela documentos (visualização do site)
            db
              .prepare(
                `UPDATE documentos
                 SET ${docColumn} = ?, atualizado_em = CURRENT_TIMESTAMP
                 WHERE aluno_id = ?`,
              )
              .bind(sheetNormalized, aluno.id),
          ]);

          // NOTA CRÍTICA DE AUSÊNCIA DE ECO:
          // Não inserimos nenhuma linha em `sync_operations` para o destino CONTROLE.
          // Isso garante que a alteração vinda da planilha NÃO será enviada de volta à planilha!
        }
      }
    }
  }

  return report;
}
