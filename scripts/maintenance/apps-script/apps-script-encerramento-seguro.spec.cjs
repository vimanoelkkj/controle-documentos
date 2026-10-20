'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RA_ALVO_F4,
  IDS_ALVO_F4,
  PREFIXO_PENDENCIA_F4,
  CHAVE_BACKUP_F4,
  ESTADO_DOCUMENTAL_ESPERADO,
  executarEncerramentoSeguroPendencias_2910135556
} = require('./apps-script-encerramento-seguro.cjs');

// Mock Environment para testes locais
function criarAmbienteMock(config = {}) {
  const propertiesStore = new Map();
  const logs = [];
  const warnings = [];

  // Timestamp de 16/10/2026 15:00:00 GMT-03:00 (1760637600000 approx)
  const timestamp16Out = new Date('2026-10-16T15:00:00-03:00').getTime();

  // Intenções padrão de 16/10/2026
  const intencao1 = {
    id: IDS_ALVO_F4[0],
    versao: 1,
    planilha: 'sheet-mock-f4',
    criadoEm: timestamp16Out,
    estado: 'revisao',
    nomeGeral: 'FACE - FEA 2026 - 2',
    nomeControle: 'CONTROLE DE DOCUMENTOS FACE FEA',
    tipo: 'controle',
    ra: RA_ALVO_F4,
    nome: 'ALUNO MOCK TESTE',
    linhaObservada: 10,
    coluna: 3,
    largura: 7,
    lote: false,
    cruzaContrato: true,
    documentos: [true, true, true, true, true, true, true]
  };

  const intencao2 = {
    id: IDS_ALVO_F4[1],
    versao: 1,
    planilha: 'sheet-mock-f4',
    criadoEm: timestamp16Out,
    estado: 'revisao',
    nomeGeral: 'FACE - FEA 2026 - 2',
    nomeControle: 'CONTROLE DE DOCUMENTOS FACE FEA',
    tipo: 'controle',
    ra: RA_ALVO_F4,
    nome: 'ALUNO MOCK TESTE',
    linhaObservada: 10,
    coluna: 9,
    largura: 1,
    lote: false,
    cruzaContrato: true,
    documentos: [true, true, true, true, true, true, true]
  };

  if (config.incluirIntencao1 !== false) {
    propertiesStore.set(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0], JSON.stringify(config.customIntencao1 || intencao1));
  }
  if (config.incluirIntencao2 !== false) {
    propertiesStore.set(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1], JSON.stringify(config.customIntencao2 || intencao2));
  }
  if (config.backupInicial) {
    propertiesStore.set(CHAVE_BACKUP_F4, config.backupInicial);
  }

  // Estado padrão das células: [false, false, false, false, false, true, true]
  const docsControle = config.docsControle || [...ESTADO_DOCUMENTAL_ESPERADO];
  const contratoGeral = config.contratoGeral !== undefined ? config.contratoGeral : 'ENTREGUE';

  let lockAcquired = false;
  const mockLock = {
    waitLock: (timeout) => { lockAcquired = true; },
    tryLock: (timeout) => { lockAcquired = true; return true; },
    releaseLock: () => { lockAcquired = false; },
    hasLock: () => lockAcquired
  };

  const mockAbaControle = {
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => [docsControle],
      getValue: () => docsControle[6]
    })
  };

  const mockAbaGeral = {
    getRange: (row, col) => ({
      getDisplayValue: () => contratoGeral
    })
  };

  const mockSpreadsheet = {
    getSheetByName: (nome) => {
      if (nome === 'FACE - FEA 2026 - 2') return mockAbaGeral;
      if (nome === 'CONTROLE DE DOCUMENTOS FACE FEA') return mockAbaControle;
      return null;
    }
  };

  // Funções Globais Mockadas
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => mockSpreadsheet,
    flush: () => {}
  };

  global.LockService = {
    getScriptLock: () => mockLock
  };

  global.PropertiesService = {
    getDocumentProperties: () => ({
      getProperties: () => Object.fromEntries(propertiesStore),
      getProperty: (k) => propertiesStore.get(k) || null,
      setProperty: (k, v) => propertiesStore.set(k, String(v)),
      deleteProperty: (k) => {
        if (config.simularFalhaDelete && k.includes(IDS_ALVO_F4[1])) {
          // Simula falha ao excluir a segunda chave
          return;
        }
        propertiesStore.delete(k);
      }
    })
  };

  global.Utilities = {
    formatDate: (date, tz, fmt) => {
      // Formata em GMT-03:00 para yyyy-MM-dd
      const d = new Date(date);
      const iso = new Date(d.getTime() - 3 * 3600000).toISOString();
      return iso.slice(0, 10);
    }
  };

  global.obterAbasSistema_ = () => ({
    'FACE - FEA 2026 - 2': 'CONTROLE DE DOCUMENTOS FACE FEA'
  });

  global.criarIndiceContratosGeral_ = (aba, colRa = 7) => ({
    get: (ra) => (ra === RA_ALVO_F4 ? [2] : [])
  });

  global.interpretarStatusContratoGeral_ = (val) => val === 'ENTREGUE';

  let auditCount = 0;
  global.registrarEventoCentral = (ev) => {
    auditCount++;
    return { id: `audit-${auditCount}`, dataHora: new Date().toISOString() };
  };

  return {
    propertiesStore,
    logs,
    warnings,
    mockLock,
    getAuditCount: () => auditCount
  };
}

// ----------------------------------------------------------------------------
// SUÍTE DE TESTES OBJETIVOS (1 a 4)
// ----------------------------------------------------------------------------

test('1. Encerramento Normal: Valida ambas, cria backup íntegro, registra auditoria e exclui chaves ativas', () => {
  const env = criarAmbienteMock();
  
  const res = executarEncerramentoSeguroPendencias_2910135556();

  assert.equal(res.sucesso, true);
  assert.equal(res.acao, 'ENCERRAMENTO_CONCLUIDO');
  assert.equal(res.chavesRemovidas.length, 2);
  assert.equal(res.restantes.length, 0);

  // Ambas as chaves ativas foram removidas
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), false);
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), false);

  // Backup íntegro foi criado e contém ambas as intenções
  assert.equal(env.propertiesStore.has(CHAVE_BACKUP_F4), true);
  const backup = JSON.parse(env.propertiesStore.get(CHAVE_BACKUP_F4));
  assert.equal(backup.ra, RA_ALVO_F4);
  assert.equal(backup.intencoes.length, 2);

  // Auditoria foi chamada 1 vez
  assert.equal(env.getAuditCount(), 1);

  // Lock foi devidamente liberado
  assert.equal(env.mockLock.hasLock(), false);
});

test('2. Falha após remover a primeira chave e Retomada Segura: Exclui a restante sem duplicar auditoria', () => {
  // Simula falha na exclusão da 2ª chave
  const env = criarAmbienteMock({ simularFalhaDelete: true });

  // 1ª Execução: Exclui a chave 1 mas a chave 2 falha
  const res1 = executarEncerramentoSeguroPendencias_2910135556();
  assert.equal(res1.sucesso, false);
  assert.equal(res1.acao, 'ENCERRAMENTO_PARCIAL_RETOMAVEL');
  assert.deepEqual(res1.chavesRemovidas, [IDS_ALVO_F4[0]]);
  assert.deepEqual(res1.restantes, [IDS_ALVO_F4[1]]);

  // Chave 1 excluída, Chave 2 ainda presente, Backup criado
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), false);
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), true);
  assert.equal(env.propertiesStore.has(CHAVE_BACKUP_F4), true);
  assert.equal(env.getAuditCount(), 1);

  // Corrige a falha no armazenamento para permitir a retomada
  const originalDelete = env.propertiesStore.delete.bind(env.propertiesStore);
  global.PropertiesService.getDocumentProperties = () => ({
    getProperties: () => Object.fromEntries(env.propertiesStore),
    getProperty: (k) => env.propertiesStore.get(k) || null,
    setProperty: (k, v) => env.propertiesStore.set(k, String(v)),
    deleteProperty: (k) => originalDelete(k)
  });

  // 2ª Execução (Retomada): Deve validar o backup prévio e remover exclusivamente a chave restante
  const res2 = executarEncerramentoSeguroPendencias_2910135556();
  assert.equal(res2.sucesso, true);
  assert.equal(res2.acao, 'ENCERRAMENTO_CONCLUIDO');
  assert.deepEqual(res2.chavesRemovidas, [IDS_ALVO_F4[1]]);
  assert.equal(res2.restantes.length, 0);

  // Ambas as chaves removidas
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), false);
  assert.equal(env.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), false);

  // Não gerou auditoria duplicada
  assert.equal(env.getAuditCount(), 1);
});

test('3. Segunda Execução após encerramento completo: Idempotente, não faz alterações nem gera erros', () => {
  const env = criarAmbienteMock();

  // Executa encerramento completo
  executarEncerramentoSeguroPendencias_2910135556();
  assert.equal(env.getAuditCount(), 1);

  // Nova execução subsequente
  const resReplay = executarEncerramentoSeguroPendencias_2910135556();
  assert.equal(resReplay.sucesso, true);
  assert.equal(resReplay.acao, 'JA_ENCERRADO');
  assert.equal(resReplay.chavesRemovidas.length, 0);

  // Backup preservado e sem novas auditorias
  assert.equal(env.propertiesStore.has(CHAVE_BACKUP_F4), true);
  assert.equal(env.getAuditCount(), 1);
});

test('4. Intenção alterada ou estado documental divergente: Aborta sem excluir nenhuma propriedade', () => {
  // Cenário 4.1: Estado documental no Controle diverge (ex: identidade está true ao invés de false)
  const envDocsDivergentes = criarAmbienteMock({
    docsControle: [true, false, false, false, false, true, true]
  });

  assert.throws(
    () => executarEncerramentoSeguroPendencias_2910135556(),
    /Estado documental no Controle diverge/
  );
  // Nenhuma chave removida e nenhum backup criado
  assert.equal(envDocsDivergentes.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), true);
  assert.equal(envDocsDivergentes.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), true);
  assert.equal(envDocsDivergentes.propertiesStore.has(CHAVE_BACKUP_F4), false);
  assert.equal(envDocsDivergentes.getAuditCount(), 0);

  // Cenário 4.2: Contrato na Geral diverge (ex: NÃO ENTREGUE)
  const envGeralDivergente = criarAmbienteMock({
    contratoGeral: 'NÃO ENTREGUE'
  });

  assert.throws(
    () => executarEncerramentoSeguroPendencias_2910135556(),
    /Contrato na aba Geral não está como ENTREGUE/
  );
  assert.equal(envGeralDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), true);
  assert.equal(envGeralDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), true);
  assert.equal(envGeralDivergente.propertiesStore.has(CHAVE_BACKUP_F4), false);

  // Cenário 4.3: Intenção com timestamp diferente de 16/10/2026
  const envDataDivergente = criarAmbienteMock({
    customIntencao1: {
      id: IDS_ALVO_F4[0],
      ra: RA_ALVO_F4,
      estado: 'revisao',
      tipo: 'controle',
      criadoEm: new Date('2026-10-18T10:00:00-03:00').getTime(), // 18/10
      documentos: [true, true, true, true, true, true, true]
    }
  });

  assert.throws(
    () => executarEncerramentoSeguroPendencias_2910135556(),
    /não é de 16\/10\/2026/
  );
  assert.equal(envDataDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), true);
  assert.equal(envDataDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), true);

  // Cenário 4.4: Intenção com documentos divergentes de 7 true
  const envDocsIntencaoDivergente = criarAmbienteMock({
    customIntencao1: {
      id: IDS_ALVO_F4[0],
      ra: RA_ALVO_F4,
      estado: 'revisao',
      tipo: 'controle',
      criadoEm: new Date('2026-10-16T15:00:00-03:00').getTime(),
      documentos: [false, false, false, false, false, true, true] // divergente do inspecionado
    }
  });

  assert.throws(
    () => executarEncerramentoSeguroPendencias_2910135556(),
    /divergem de 7 valores true/
  );
  assert.equal(envDocsIntencaoDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[0]), true);
  assert.equal(envDocsIntencaoDivergente.propertiesStore.has(PREFIXO_PENDENCIA_F4 + IDS_ALVO_F4[1]), true);
});
