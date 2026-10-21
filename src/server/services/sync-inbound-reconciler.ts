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
  isReservaDeVaga,
  isSituacaoContratualValida,
  type ISyncSpreadsheetAdapter,
  type GeneralTabReadResult,
} from "./sync-sheet-contracts";
import { validateCanonicalRa } from "./sync-d1-auth";
import {
  type TabNameResolver,
  createTabNameResolver,
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
  autoCreateMissingAlunos?: boolean;
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
  alunosExcluidosPorReservaDeVaga: string[];
  alunosBloqueadosPorSituacaoDesconhecida: string[];
  alunosCriadosNoD1?: number;
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
  camposExaminados?: number;
  mutacoesPlanejadas?: number;
  mutacoesPersistidas?: number;
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
    tabNameResolver: customTabNameResolver,
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
    alunosExcluidosPorReservaDeVaga: [],
    alunosBloqueadosPorSituacaoDesconhecida: [],
    alunosCriadosNoD1: 0,
    divergenciasComOutboxPendente: [],
    mutacoesAplicadas: [],
    errosLayout: [],
    camposExaminados: 0,
    mutacoesPlanejadas: 0,
    mutacoesPersistidas: 0,
  };

  // Resolver dinâmico de abas do período se não fornecido explicitamente
  let tabNameResolver = customTabNameResolver;
  if (!tabNameResolver) {
    const sheetsConfig = await db
      .prepare(
        `SELECT aba_docs_face_fea, aba_docs_fch_ead, aba_base_face_fea, aba_base_fch_ead FROM google_sheets_periodos WHERE periodo_id = ?`,
      )
      .bind(periodoId)
      .first<{
        aba_docs_face_fea?: string;
        aba_docs_fch_ead?: string;
        aba_base_face_fea?: string;
        aba_base_fch_ead?: string;
      }>();

    const periodoRow = await db
      .prepare(`SELECT codigo FROM periodos WHERE id = ?`)
      .bind(periodoId)
      .first<{ codigo?: string }>();

    tabNameResolver = createTabNameResolver({
      sheetsConfig,
      periodoCodigo: periodoRow?.codigo,
    });
  }

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

  // Garantia estrita Fail-Safe: Em modo SHADOW, dryRun é forçado incondicionalmente como true
  const effectiveDryRun = integracao.mode === "SHADOW" ? true : Boolean(dryRun);
  report.dryRun = effectiveDryRun;

  const gruposAProcessar: GroupKey[] = targetGroupKey
    ? [targetGroupKey]
    : ["FACE_FEA", "FCH_EAD"];

  // 2. Itera sobre cada grupo documental
  for (const groupKey of gruposAProcessar) {
    report.gruposProcessados.push(groupKey);
        const controlTabName = tabNameResolver.getControlTabName(groupKey);
    const generalTabName = tabNameResolver.getGeneralTabName(groupKey);

    let controlRead;
    try {
      controlRead = await adapter.readControlTab({
        spreadsheetId: integracao.spreadsheet_id,
        tabName: controlTabName,
        groupKey,
      });
    } catch (err: any) {
      report.errosLayout.push({
        groupKey,
        tabName: controlTabName,
        erro: err?.message || String(err),
      });
      report.sucesso = false;
      continue;
    }

    // Leitura da aba geral para validação da situação contratual (filtro de reserva e desconhecidos)
    let generalRead: GeneralTabReadResult | null = null;
    if (typeof adapter.readGeneralTabContracts === "function") {
      try {
        generalRead = await adapter.readGeneralTabContracts({
          spreadsheetId: integracao.spreadsheet_id,
          tabName: generalTabName,
        });
      } catch (err: any) {
        report.errosLayout.push({
          groupKey,
          tabName: generalTabName,
          erro: `Falha ao ler aba geral contratual: ${err?.message || String(err)}`,
        });
        report.sucesso = false;
        continue;
      }
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

      // 3.2.1. Cruzamento contratual obrigatório com a aba geral
      let generalRow = generalRead?.rowsByRa.get(canonicalRa);

      if (generalRead) {
        // Regra 1: Situação ausente, vazia, desconhecida ou sem correspondência
        if (!generalRow || !isSituacaoContratualValida(generalRow.contractRawValue)) {
          if (!report.alunosBloqueadosPorSituacaoDesconhecida.includes(canonicalRa)) {
            report.alunosBloqueadosPorSituacaoDesconhecida.push(canonicalRa);
          }
          continue;
        }

        // Regra 2: RESERVA DE VAGA -> Não importar nem atualizar
        // (Alunos existentes que entrem em reserva não recebem novas atualizações automáticas)
        if (isReservaDeVaga(generalRow.contractRawValue)) {
          if (!report.alunosExcluidosPorReservaDeVaga.includes(canonicalRa)) {
            report.alunosExcluidosPorReservaDeVaga.push(canonicalRa);
          }
          continue;
        }
      }

      // 3.3. Busca aluno existente no D1 para o período
      let aluno = await db
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
        if (options.autoCreateMissingAlunos) {
          const studentName = String(rowSnapshot.studentName || '').trim() || 'ALUNO IMPORTADO';
          const course = String(generalRow?.courseName || '').trim() || (groupKey === 'FACE_FEA' ? 'ADMINISTRAÇÃO' : 'PEDAGOGIA');
          const unidade = groupKey === 'FACE_FEA' ? 'FACE' : 'FCH';

          if (!effectiveDryRun) {
            await db
              .prepare(
                `INSERT INTO alunos (periodo_id, ra, nome, curso, unidade, status)
                 VALUES (?, ?, ?, ?, ?, 'ATIVO')
                 ON CONFLICT(periodo_id, ra) DO UPDATE SET
                   nome = excluded.nome,
                   atualizado_em = CURRENT_TIMESTAMP`,
              )
              .bind(periodoId, canonicalRa, studentName, course, unidade)
              .run();

            aluno = await db
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

            if (aluno) {
              const normDoc = (f: FieldKey) => rowSnapshot.fields[f]?.normalizedValue ?? 0;
              await db
                .prepare(
                  `INSERT INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(aluno_id) DO NOTHING`,
                )
                .bind(
                  aluno.id,
                  normDoc("identidade"),
                  normDoc("cpf_documento"),
                  normDoc("certidao"),
                  normDoc("residencia"),
                  normDoc("titulo"),
                  normDoc("ensino_medio"),
                  normDoc("contrato"),
                )
                .run();

              report.alunosCriadosNoD1 = (report.alunosCriadosNoD1 || 0) + 1;
            }
          } else {
            report.alunosCriadosNoD1 = (report.alunosCriadosNoD1 || 0) + 1;
            aluno = {
              id: 999999,
              ra: canonicalRa,
              nome: studentName,
              unidade,
              periodo_id: periodoId,
            };
          }
        } else {
          if (!report.alunosNaoEncontradosNoD1.includes(canonicalRa)) {
            report.alunosNaoEncontradosNoD1.push(canonicalRa);
          }
          continue;
        }
      }

      if (!aluno) {
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
        if (!effectiveDryRun) {
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

      // Carrega valores consolidados da tabela documentos do D1 para proteção contra baseline ausente
      let docRow: Record<string, number | null> | null = null;
      if (aluno.id !== 999999) {
        docRow = await db
          .prepare(
            `SELECT identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato
             FROM documentos
             WHERE aluno_id = ?`,
          )
          .bind(aluno.id)
          .first<Record<string, number | null>>();
      } else {
        // Aluno simulado em dryRun: simula valores iniciais iguais à planilha
        docRow = {
          identidade: rowSnapshot.fields["identidade"]?.normalizedValue ?? 0,
          cpf: rowSnapshot.fields["cpf_documento"]?.normalizedValue ?? 0,
          certidao: rowSnapshot.fields["certidao"]?.normalizedValue ?? 0,
          residencia: rowSnapshot.fields["residencia"]?.normalizedValue ?? 0,
          titulo: rowSnapshot.fields["titulo"]?.normalizedValue ?? 0,
          ensino_medio: rowSnapshot.fields["ensino_medio"]?.normalizedValue ?? 0,
          contrato: rowSnapshot.fields["contrato"]?.normalizedValue ?? 0,
        };
      }

      // 3.5. Avalia cada um dos 7 campos documentais
      for (const field of CONTROL_DOC_COLUMNS) {
        report.camposExaminados = (report.camposExaminados ?? 0) + 1;
        const sheetField = rowSnapshot.fields[field];
        const sheetNormalized = sheetField?.normalizedValue ?? null;

        // Células em branco / não preenchidas na planilha não alteram o banco
        if (sheetNormalized === null) {
          continue;
        }

        const docCol = FIELD_TO_DOC_COLUMN[field];
        const docVal = docRow ? (docRow[docCol] ? 1 : 0) : null;

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

        // =========================================================================
        // CENÁRIO 1: Estado já confirmado no sync_field_state (baseline estabelecida)
        // =========================================================================
        if (fieldState && fieldState.status === "CONFIRMED") {
          const d1Value = fieldState.value;
          const currentRevision = fieldState.revision;

          // Se os valores já são iguais e o estado está confirmado, no-op
          if (d1Value === sheetNormalized) {
            report.camposEmSincronia++;
            continue;
          }

        // Se há divergência entre a planilha e o D1:
        // Verifica se existe operação local ativa na outbox pendente de despacho
        const activeOp = await db
          .prepare(
            `SELECT o.operation_id, o.state, e.value_old, e.value_new
             FROM sync_operations o
             LEFT JOIN sync_events e ON e.event_id = o.event_id
             WHERE o.record_id = ? AND o.field_key = ? AND o.target_key = 'CONTROLE'
               AND o.state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'UNCERTAIN')
             LIMIT 1`,
          )
          .bind(recordId, field)
          .first<{
            operation_id: string;
            state: string;
            value_old: number | null;
            value_new: number | null;
          }>();

        if (activeOp) {
          // Se a operação for UNCERTAIN, exige reconciliação humana obrigatória (F3)
          const isUncertain = activeOp.state === "UNCERTAIN";

          // Se a operação NÃO for UNCERTAIN e a planilha ainda contiver o valor causal anterior (value_old):
          // Significa que a alteração da secretaria ainda está na fila para ser despachada.
          // Não sobrescrevemos o D1 e não abrimos conflito falso: deixamos o Outbound despachar.
          if (!isUncertain && activeOp.value_old !== null && sheetNormalized === activeOp.value_old) {
            continue;
          }

          // Se a planilha já convergiu para o novo valor proposto (value_new):
          if (!isUncertain && activeOp.value_new !== null && sheetNormalized === activeOp.value_new) {
            report.camposEmSincronia++;
            continue;
          }

          // CONFLITO REAL: Divergência não causal ou incerteza operacional em trânsito
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

          if (!effectiveDryRun) {
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
        if (effectiveDryRun) {
          report.mutacoesPlanejadas = (report.mutacoesPlanejadas ?? 0) + 1;
        } else {
          report.mutacoesPersistidas = (report.mutacoesPersistidas ?? 0) + 1;
        }
        report.mutacoesAplicadas.push({
          ra: canonicalRa,
          groupKey,
          fieldKey: field,
          valorAnterior: d1Value as 0 | 1 | null,
          novoValor: sheetNormalized,
        });

        if (!effectiveDryRun) {
          const commandId = `cmd-inbound-${crypto.randomUUID().slice(0, 8)}`;
          const eventId = `evt-inbound-${crypto.randomUUID().slice(0, 8)}`;
          const toRevision = currentRevision + 1;
          const docColumn = FIELD_TO_DOC_COLUMN[field];

          const evidenceHash = `inbound:${controlTabName}:${sheetField.cellCoordinate}:${sheetField.rawValue}:${sheetNormalized}`;

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
        continue;
      }

      // =========================================================================
      // CENÁRIO 2: Campo SEM baseline inicializada (fieldState null ou UNBASELINED)
      // =========================================================================
      // Proteção Fail-Closed: validação contra a tabela documentos existente

      // Subcenário 2.1: Valores idênticos entre a planilha e o banco de dados
      if (docVal !== null && sheetNormalized === docVal) {
        // A planilha e a tabela documentos já possuem exatamente o mesmo valor documental.
        // Trata como sincronia e estabelece o baseline atômico com revision = 0
        // SEM alterar a tabela documentos nem disparar mutações desnecessárias
        report.camposEmSincronia++;
        if (!effectiveDryRun) {
          await db
            .prepare(
              `INSERT INTO sync_field_state (
                 record_id, field_key, value, revision, status, updated_at
               ) VALUES (?, ?, ?, 0, 'CONFIRMED', CURRENT_TIMESTAMP)
               ON CONFLICT(record_id, field_key) DO UPDATE SET
                 value = excluded.value,
                 revision = 0,
                 status = 'CONFIRMED',
                 updated_at = CURRENT_TIMESTAMP
               WHERE revision = 0 AND (status = 'UNBASELINED' OR status IS NULL)`,
            )
            .bind(recordId, field, docVal)
            .run();
        }
        continue;
      }

      // Subcenário 2.2: Divergência entre planilha e banco para aluno não semeado.
      // FAIL-CLOSED: Rejeita mutação cega no D1 sem baseline confirmada prévia! Registra conflito.
      report.conflitosDetectados++;
      report.divergenciasComOutboxPendente.push({
        ra: canonicalRa,
        groupKey,
        fieldKey: field,
        valorPlanilha: sheetNormalized,
        valorLocal: docVal,
        statusOperacaoLocal: "BASELINE_AUSENTE_DIVERGENCIA",
      });

      if (!effectiveDryRun) {
        const conflictId = `conf-inbound-${crypto.randomUUID().slice(0, 8)}`;
        await db
          .prepare(
            `INSERT OR REPLACE INTO sync_conflicts (
               conflict_id, record_id, field_key, target_key,
               local_revision, local_value, external_value, reason, resolved
             ) VALUES (?, ?, ?, 'CONTROLE', 0, ?, ?, 'BASELINE_AUSENTE_DIVERGENCIA', 0)`,
          )
          .bind(
            conflictId,
            recordId,
            field,
            docVal ?? 0,
            sheetNormalized,
          )
          .run();
      }
      }
    }
  }

  return report;
}
