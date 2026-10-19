/**
 * SCRIPT ADMINISTRATIVO CORRIGIDO DE ENCERRAMENTO SEGURO (PRÉ-F4)
 * RA: 2910135556
 * IDs:
 *  - bee4974a-be0c-4c84-9f88-0bead2aac14f
 *  - c47aba4e-d770-4b9a-b9b0-6f4ab372a81f
 */

const RA_ALVO_F4 = "2910135556";
const IDS_ALVO_F4 = [
  "bee4974a-be0c-4c84-9f88-0bead2aac14f",
  "c47aba4e-d770-4b9a-b9b0-6f4ab372a81f"
];
const PREFIXO_PENDENCIA_F4 = "PENDENCIA_EDICAO_V1_";
const CHAVE_BACKUP_F4 = "BACKUP_HISTORICO_PENDENCIAS_2910135556";
const ESTADO_DOCUMENTAL_ESPERADO = [false, false, false, false, false, true, true];

/**
 * Procedimento principal de encerramento seguro sob Lock do sistema.
 */
function executarEncerramentoSeguroPendencias_2910135556() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Concorrência: Adquire o bloqueio nativo reentrante do sistema
  const lock = (typeof obterBloqueioSistema_ === "function")
    ? obterBloqueioSistema_("encerramentoAdministrativoF4")
    : LockService.getScriptLock();

  if (typeof lock.waitLock === "function") {
    lock.waitLock(30000);
  } else if (typeof lock.tryLock === "function") {
    if (!lock.tryLock(30000)) {
      throw new Error("ABORTADO: Bloqueio do sistema ocupado. Tente novamente em instantes.");
    }
  }

  try {
    const propriedades = PropertiesService.getDocumentProperties();
    const todosValores = propriedades.getProperties();

    // 2. Verificação de Chaves Presentes vs Excluídas
    const chavesPresentes = IDS_ALVO_F4.filter(id => Boolean(todosValores[PREFIXO_PENDENCIA_F4 + id]));
    const backupTextoExistente = todosValores[CHAVE_BACKUP_F4];

    // Caso A: Ambas já foram removidas previamente
    if (chavesPresentes.length === 0) {
      if (!backupTextoExistente) {
        throw new Error("ABORTADO: As intenções não existem em DocumentProperties e nenhum backup foi encontrado.");
      }
      return {
        sucesso: true,
        acao: "JA_ENCERRADO",
        mensagem: "Todas as intenções já haviam sido encerradas e o backup permanece preservado.",
        chavesRemovidas: [],
        backupChave: CHAVE_BACKUP_F4
      };
    }

    // 3. Validação do Estado Atual das Células nas Abas (SEM ALTERAR NADA)
    // Localiza abas através de pareamento do sistema ou convenção da planilha
    const pares = (typeof obterAbasSistema_ === "function") ? obterAbasSistema_(ss) : {};
    let nomeGeral = "FACE - FEA 2026 - 2";
    let nomeControle = "CONTROLE DE DOCUMENTOS FACE FEA";

    // Se as abas existirem no mapeamento, valida
    const abaGeral = ss.getSheetByName(nomeGeral);
    const abaControle = ss.getSheetByName(nomeControle);
    if (!abaGeral || !abaControle) {
      throw new Error(`ABORTADO: Abas necessárias não encontradas ('${nomeGeral}' ou '${nomeControle}').`);
    }

    const linhasGeral = (typeof criarIndiceContratosGeral_ === "function"
      ? criarIndiceContratosGeral_(abaGeral).get(RA_ALVO_F4)
      : []) || [];
    const linhasControle = (typeof criarIndiceContratosGeral_ === "function"
      ? criarIndiceContratosGeral_(abaControle, 1).get(RA_ALVO_F4)
      : []) || [];

    if (linhasGeral.length !== 1 || linhasControle.length !== 1) {
      throw new Error(`ABORTADO: RA não é único nas abas (Geral: ${linhasGeral.length}, Controle: ${linhasControle.length}).`);
    }

    const linhaG = linhasGeral[0];
    const linhaC = linhasControle[0];

    // Conferência exata dos 7 documentos nas colunas C:I do Controle
    const docsAtuais = abaControle.getRange(linhaC, 3, 1, 7).getValues()[0].map(v => v === true);
    const docsBatem = docsAtuais.every((v, i) => v === ESTADO_DOCUMENTAL_ESPERADO[i]);
    if (!docsBatem) {
      throw new Error("ABORTADO: Estado documental no Controle diverge de [false, false, false, false, false, true, true].");
    }

    // Conferência exata do Contrato na Geral (coluna A)
    const contratoGeral = (typeof interpretarStatusContratoGeral_ === "function")
      ? interpretarStatusContratoGeral_(abaGeral.getRange(linhaG, 1).getDisplayValue())
      : abaGeral.getRange(linhaG, 1).getDisplayValue().trim().toUpperCase() === "SIM";

    if (contratoGeral !== true) {
      throw new Error("ABORTADO: Contrato na aba Geral não está como ENTREGUE.");
    }

    // 4. Validação Rigorosa das Intenções Presentes e Preparação/Validação de Backup
    let dadosBackup;
    if (backupTextoExistente) {
      // Retomada: se já há backup gravado, valida sua integridade
      try {
        dadosBackup = JSON.parse(backupTextoExistente);
        if (dadosBackup.ra !== RA_ALVO_F4 || !Array.isArray(dadosBackup.intencoes)) {
          throw new Error("Backup corrompido");
        }
      } catch (e) {
        throw new Error("ABORTADO: Backup existente inválido ou corrompido. Exclusão bloqueada.");
      }
    } else {
      // Primeira execução completa: exige que AMBAS as intenções estejam presentes para backup
      if (chavesPresentes.length !== 2) {
        throw new Error(`ABORTADO: Inconsistência. Encontrada(s) apenas ${chavesPresentes.length} chave(s) sem backup prévio.`);
      }

      const intencoesParaBackup = [];
      for (const id of IDS_ALVO_F4) {
        const chave = PREFIXO_PENDENCIA_F4 + id;
        const texto = todosValores[chave];
        const reg = JSON.parse(texto);

        // Validação rigorosa dos campos exigidos
        if (reg.id !== id) throw new Error(`ABORTADO: ID divergente no registro ${id}.`);
        if (reg.ra !== RA_ALVO_F4) throw new Error(`ABORTADO: RA incompatível no registro ${id}.`);
        if (reg.estado !== "revisao") throw new Error(`ABORTADO: Estado divergente no registro ${id}.`);
        if (reg.tipo !== "controle") throw new Error(`ABORTADO: Origem divergente no registro ${id} (esperado: controle).`);

        // Validação do timestamp original de 16/10/2026
        const dataOriginal = Utilities.formatDate(new Date(reg.criadoEm), "GMT-03:00", "yyyy-MM-dd");
        if (dataOriginal !== "2026-10-16") {
          throw new Error(`ABORTADO: Timestamp da intenção ${id} (${dataOriginal}) não é de 16/10/2026.`);
        }

        // Validação de exatamente 7 documentos, todos true
        if (!Array.isArray(reg.documentos) || reg.documentos.length !== 7 || !reg.documentos.every(v => v === true)) {
          throw new Error(`ABORTADO: Documentos da intenção ${id} divergem de 7 valores true.`);
        }

        intencoesParaBackup.push({
          id: reg.id,
          chave: chave,
          criadoEm: reg.criadoEm,
          dataOriginal: dataOriginal,
          tipo: reg.tipo,
          documentos: reg.documentos,
          rawJson: texto
        });
      }

      dadosBackup = {
        versao: 1,
        criadoEm: new Date().toISOString(),
        ra: RA_ALVO_F4,
        estadoDocumentalConfirmado: docsAtuais,
        contratoGeralConfirmado: contratoGeral,
        intencoes: intencoesParaBackup
      };

      // Persiste o backup ANTES de qualquer exclusão
      propriedades.setProperty(CHAVE_BACKUP_F4, JSON.stringify(dadosBackup));
    }

    // 5. Registro formal na Central de Auditoria (Apenas se ainda não auditado)
    let auditoriaId = "AUDITORIA_PREVIA_OU_RETOMADA";
    if (!backupTextoExistente && typeof registrarEventoCentral === "function") {
      const eventoAuditoria = registrarEventoCentral({
        categoria: "SINCRONIZACAO",
        acao: "PENDENCIAS_ANTIGAS_ENCERRADAS",
        titulo: "Encerramento seguro de intenções divergentes",
        ra: RA_ALVO_F4,
        controle: nomeControle,
        detalhes: `Encerramento administrativo de 2 intenções antigas de 16/10/2026 (${IDS_ALVO_F4.join(", ")}). ` +
          `Estado atual confirmado pelo operador preservado. Eventos antigos não reaplicados.`,
        metadados: {
          motivo: "Intenções antigas superadas pelo estado manual da planilha",
          idsEncerrados: IDS_ALVO_F4,
          backupPropriedade: CHAVE_BACKUP_F4,
          resolvidoEm: new Date().toISOString()
        }
      });

      if (!eventoAuditoria || typeof eventoAuditoria.id !== "string") {
        throw new Error("ABORTADO: Falha ao registrar na Central de Auditoria. As pendências foram preservadas.");
      }
      auditoriaId = eventoAuditoria.id;
    }

    // 6. Exclusão segura e não-atômica das chaves pendentes com verificação por chave
    SpreadsheetApp.flush();
    const chavesRemovidasNestaExecucao = [];

    for (const id of chavesPresentes) {
      const chave = PREFIXO_PENDENCIA_F4 + id;
      propriedades.deleteProperty(chave);
      // Confere se a chave foi de fato excluída
      if (!propriedades.getProperty(chave)) {
        chavesRemovidasNestaExecucao.push(id);
      } else {
        console.warn(JSON.stringify({
          evento: "FALHA_REMOCAO_CHAVE_INDIVIDUAL",
          id: id,
          backupPreservado: true
        }));
      }
    }

    // 7. Verificação Final Pós-Exclusão
    const valoresFinais = propriedades.getProperties();
    const restantesAindaPresentes = IDS_ALVO_F4.filter(id => Boolean(valoresFinais[PREFIXO_PENDENCIA_F4 + id]));
    const backupAindaIntegro = Boolean(valoresFinais[CHAVE_BACKUP_F4]);

    if (!backupAindaIntegro) {
      throw new Error("ERRO CRÍTICO: O backup foi perdido durante o encerramento!");
    }

    // Emissão de log estritamente técnico (sem PII, sem nomes, sem e-mails)
    console.log(JSON.stringify({
      evento: "ENCERRAMENTO_ADMINISTRATIVO_EXECUCAO",
      chavesRemovidas: chavesRemovidasNestaExecucao,
      restantes: restantesAindaPresentes.length,
      auditoriaId: auditoriaId,
      backupOk: backupAindaIntegro
    }));

    return {
      sucesso: restantesAindaPresentes.length === 0,
      acao: restantesAindaPresentes.length === 0 ? "ENCERRAMENTO_CONCLUIDO" : "ENCERRAMENTO_PARCIAL_RETOMAVEL",
      chavesRemovidas: chavesRemovidasNestaExecucao,
      restantes: restantesAindaPresentes,
      auditoriaId: auditoriaId,
      backupChave: CHAVE_BACKUP_F4
    };

  } finally {
    lock.releaseLock();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RA_ALVO_F4,
    IDS_ALVO_F4,
    PREFIXO_PENDENCIA_F4,
    CHAVE_BACKUP_F4,
    ESTADO_DOCUMENTAL_ESPERADO,
    executarEncerramentoSeguroPendencias_2910135556
  };
}
