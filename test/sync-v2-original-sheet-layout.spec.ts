import { describe, expect, it } from 'vitest';
import {
  normalizeHeaderString,
  isControlColumnMatchingField,
  validateControlHeadersRow,
  normalizeDocumentCellValue,
} from '../src/server/services/sync-sheet-contracts';
import { GoogleSheetsRealAdapter } from '../src/server/services/sync-sheet-real-adapter';
import { createTabNameResolver } from '../src/server/services/sync-orchestrator';

describe('Sincronização V2 — Layout Original da Planilha CONTRATOS 2027 - 1°', () => {
  const spreadsheetId = 'sheet-contratos-2027-1-original';

  /**
   * Cabeçalhos oficiais reais da planilha CONTRATOS 2027 - 1°:
   * Col A: RA
   * Col B: Nome
   * Col C: ID
   * Col D: CPF
   * Col E: Certidão
   * Col F: Residência
   * Col G: Título
   * Col H: Ens. Médio
   * Col I: Contrato
   * Col J: Pendências (Fórmula nativa)
   * Col K: Quantidade (Fórmula nativa)
   */
  const originalControlHeaders = [
    'RA',
    'Nome',
    'ID',
    'CPF',
    'Certidão',
    'Residência',
    'Título',
    'Ens. Médio',
    'Contrato',
    'Pendências',
    'Quantidade',
  ];

  const originalGeneralHeaders = [
    'Contrato',
    'CPF',
    'Curso',
    'E-mail (outro)',
    'E-mail',
    'Nome',
    'RA',
    'Situação',
    'Docs Pendentes',
  ];

  it('1. Reconhecimento de cabeçalhos originais: normalização e matching sem exigir template artificial', () => {
    // Normalização remove acentos, pontuações e colapsa espaços
    expect(normalizeHeaderString('ID')).toBe('ID');
    expect(normalizeHeaderString('Residência')).toBe('RESIDENCIA');
    expect(normalizeHeaderString('Comp. Residência')).toBe('COMP RESIDENCIA');
    expect(normalizeHeaderString('Ens. Médio')).toBe('ENS MEDIO');
    expect(normalizeHeaderString('Ensino médio')).toBe('ENSINO MEDIO');
    expect(normalizeHeaderString('Certidão')).toBe('CERTIDAO');
    expect(normalizeHeaderString('Título')).toBe('TITULO');

    // Validação de matching por coluna C:I
    expect(isControlColumnMatchingField(0, 'ID')).toBe(true);
    expect(isControlColumnMatchingField(0, 'IDENTIDADE')).toBe(true);
    expect(isControlColumnMatchingField(1, 'CPF')).toBe(true);
    expect(isControlColumnMatchingField(2, 'Certidão')).toBe(true);
    expect(isControlColumnMatchingField(3, 'Residência')).toBe(true);
    expect(isControlColumnMatchingField(3, 'Comp. Residência')).toBe(true);
    expect(isControlColumnMatchingField(4, 'Título')).toBe(true);
    expect(isControlColumnMatchingField(5, 'Ens. Médio')).toBe(true);
    expect(isControlColumnMatchingField(5, 'Ensino médio')).toBe(true);
    expect(isControlColumnMatchingField(6, 'Contrato')).toBe(true);

    // Rejeição de cabeçalhos incompatíveis ou deslocados
    expect(isControlColumnMatchingField(0, 'TELEFONE')).toBe(false);
    expect(isControlColumnMatchingField(5, 'ID')).toBe(false);

    // Validação da linha completa de cabeçalho oficial
    const validation = validateControlHeadersRow(originalControlHeaders);
    expect(validation.valid).toBe(true);
    if (validation.valid) {
      expect(validation.fingerprint).toBe('ID::CPF::Certidão::Residência::Título::Ens. Médio::Contrato');
    }
  });

  it('2. Interpretação correta de checkboxes booleanos nativos TRUE/FALSE e strings equivalentes', () => {
    // Booleano nativo do Google Sheets
    expect(normalizeDocumentCellValue(true)).toBe(1);
    expect(normalizeDocumentCellValue(false)).toBe(0);

    // Strings de checkbox ou status
    expect(normalizeDocumentCellValue('TRUE')).toBe(1);
    expect(normalizeDocumentCellValue('true')).toBe(1);
    expect(normalizeDocumentCellValue('FALSE')).toBe(0);
    expect(normalizeDocumentCellValue('false')).toBe(0);
    expect(normalizeDocumentCellValue('OK')).toBe(1);
    expect(normalizeDocumentCellValue('PENDENTE')).toBe(0);
    expect(normalizeDocumentCellValue('SIM')).toBe(1);
    expect(normalizeDocumentCellValue('NÃO')).toBe(0);

    // Célula vazia preserva estado desconhecido por padrão (prevenindo falsos pendentes)
    expect(normalizeDocumentCellValue('')).toBe(null);
    expect(normalizeDocumentCellValue(null)).toBe(null);
    expect(normalizeDocumentCellValue(undefined)).toBe(null);

    // Célula vazia somente é interpretada como desmarcada quando o contrato declarar explicitamente
    expect(normalizeDocumentCellValue('', { treatEmptyAsUnchecked: true })).toBe(0);

    // Caracteres não mapeáveis retornam null (desconhecido / UNBASELINED)
    expect(normalizeDocumentCellValue('-')).toBe(null);
    expect(normalizeDocumentCellValue('???')).toBe(null);
  });

  it('3. Preservação estrita de RA textual com múltiplos zeros à esquerda', async () => {
    const gridFace = [
      originalControlHeaders,
      ['0090001001', 'ALUNO ALFA', true, true, true, true, true, true, false, 'Contrato', 1],
      ['000123', 'ALUNO ZEROS', false, false, false, false, false, false, false, 'Todos', 7],
    ];

    const store = new Map<string, any[][]>();
    store.set('CONTROLE DE DOCUMENTOS FACE FEA', gridFace);

    const mockFetch = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('A1:I')) {
        return new Response(JSON.stringify({ values: gridFace.map((r) => r.slice(0, 9)) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });
    const result = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });

    // RAs preservados como string textual intacta com zeros
    expect(result.rowsByRa.has('0090001001')).toBe(true);
    expect(result.rowsByRa.has('000123')).toBe(true);
    expect(result.rowsByRa.get('0090001001')?.raText).toBe('0090001001');
    expect(result.rowsByRa.get('000123')?.raText).toBe('000123');
  });

  it('4. Localização de alunos em ambas as unidades: FACE FEA e FCH EAD com layout original', async () => {
    const gridFace = [
      originalControlHeaders,
      ['0090001001', 'ALUNO ALFA', true, true, true, true, true, true, false, 'Contrato', 1],
      ['0090001002', 'ALUNO BETA', false, false, false, false, false, false, false, 'Todos', 7],
    ];

    const gridFch = [
      originalControlHeaders,
      ['0090002001', 'ALUNO GAMA', true, true, false, true, false, true, false, 'Certidão, Título, Contrato', 3],
      ['0090002002', 'ALUNO DELTA', true, true, true, true, true, true, true, 'DOCUMENTAÇÃO ENTREGUE', 0],
    ];

    const store = new Map<string, any[][]>();
    store.set('CONTROLE DE DOCUMENTOS FACE FEA', gridFace);
    store.set('CONTROLE DE DOCUMENTOS FCH EAD', gridFch);

    const mockFetch = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('FACE FEA')) {
        return new Response(JSON.stringify({ values: gridFace.map((r) => r.slice(0, 9)) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (decoded.includes('FCH EAD')) {
        return new Response(JSON.stringify({ values: gridFch.map((r) => r.slice(0, 9)) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });

    const readFace = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });
    const readFch = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FCH EAD',
      groupKey: 'FCH_EAD',
    });

    expect(readFace.rowsByRa.size).toBe(2);
    expect(readFace.rowsByRa.get('0090001001')?.fields.identidade.normalizedValue).toBe(1);
    expect(readFace.rowsByRa.get('0090001002')?.fields.identidade.normalizedValue).toBe(0);

    expect(readFch.rowsByRa.size).toBe(2);
    expect(readFch.rowsByRa.get('0090002001')?.fields.certidao.normalizedValue).toBe(0);
    expect(readFch.rowsByRa.get('0090002002')?.fields.contrato.normalizedValue).toBe(1);
  });

  it('5. Leitura das abas gerais (FACE - FEA 2027 - 1) com Coluna A Contrato e Coluna G RA', async () => {
    const gridGeral = [
      originalGeneralHeaders,
      ['Entregue', '111.111.111-11', 'ADMINISTRAÇÃO', 'outro@email.com', 'alfa@inst.edu', 'ALUNO ALFA', '0090001001', 'ATIVO', 'DOCUMENTAÇÃO ENTREGUE'],
      ['Pendente', '222.222.222-22', 'CIÊNCIAS CONTÁBEIS', '', 'beta@inst.edu', 'ALUNO BETA', '0090001002', 'ATIVO', 'TODOS OS DOCUMENTOS'],
    ];

    const mockFetch = async (url: string) => {
      return new Response(JSON.stringify({ values: gridGeral.map((r) => r.slice(0, 7)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });
    const generalRead = await adapter.readGeneralTabContracts({
      spreadsheetId,
      tabName: 'FACE - FEA 2027 - 1',
    });

    expect(generalRead.rowsByRa.size).toBe(2);
    expect(generalRead.rowsByRa.get('0090001001')?.contractNormalizedValue).toBe(1);
    expect(generalRead.rowsByRa.get('0090001002')?.contractNormalizedValue).toBe(0);
  });

  it('6. Resolução dinâmica de nomes de abas a partir da configuração ou código 2027-1', () => {
    // 1. Resolução padrão quando configurado código '2027-1'
    const resolver2027 = createTabNameResolver({ periodoCodigo: '2027-1' });
    expect(resolver2027.getControlTabName('FACE_FEA')).toBe('CONTROLE DE DOCUMENTOS FACE FEA');
    expect(resolver2027.getControlTabName('FCH_EAD')).toBe('CONTROLE DE DOCUMENTOS FCH EAD');
    expect(resolver2027.getGeneralTabName('FACE_FEA')).toBe('FACE - FEA 2027 - 1');
    expect(resolver2027.getGeneralTabName('FCH_EAD')).toBe('FCH - EAD 2027 - 1');

    // 2. Resolução explícita sobreposta por configuração cadastrada no banco
    const resolverCustom = createTabNameResolver({
      sheetsConfig: {
        aba_docs_face_fea: 'CONTROLE FACE CUSTOM',
        aba_docs_fch_ead: 'CONTROLE FCH CUSTOM',
        aba_base_face_fea: 'BASE FACE CUSTOM',
        aba_base_fch_ead: 'BASE FCH CUSTOM',
      },
      periodoCodigo: '2027-1',
    });
    expect(resolverCustom.getControlTabName('FACE_FEA')).toBe('CONTROLE FACE CUSTOM');
    expect(resolverCustom.getGeneralTabName('FACE_FEA')).toBe('BASE FACE CUSTOM');
  });

  it('7. Escrita cirúrgica de checkbox enviando booleano real TRUE/FALSE sem corromper fórmulas J/K', async () => {
    let putBodyReceived: any = null;
    let putRangeReceived = '';

    const gridFace = [
      originalControlHeaders,
      ['0090001002', 'ALUNO BETA', false, false, false, false, false, false, false, '=IF(COUNTIF(C2:I2, FALSE)=7, "TODOS OS DOCUMENTOS", "DOCS")', '=CONT.SE(C2:I2, FALSE)'],
    ];

    const mockFetch = async (url: string, init?: RequestInit) => {
      const decoded = decodeURIComponent(url);
      if (init?.method === 'PUT') {
        putRangeReceived = decoded;
        putBodyReceived = JSON.parse(String(init.body));
        // Aplica na grade simulada
        gridFace[1][2] = putBodyReceived.values[0][0];
        return new Response(JSON.stringify({ updatedCells: 1 }), { status: 200 });
      }

      // GET de leitura
      return new Response(JSON.stringify({ values: gridFace.map((r) => r.slice(0, 9)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });

    const writeRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '0090001002',
      fieldKey: 'identidade', // Coluna C
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-real-checkbox',
      },
    });

    expect(writeRes.success).toBe(true);
    expect(writeRes.status).toBe('COMMITTED');

    // Confirma que a coordenada exata foi C2
    expect(putRangeReceived).toContain('!C2');

    // Confirma que o valor enviado no JSON é o booleano real TRUE, NUNCA texto "OK"
    expect(putBodyReceived.values[0][0]).toBe(true);
    expect(putBodyReceived.values[0][0]).not.toBe('OK');
    expect(putBodyReceived.values[0][0]).not.toBe('ENTREGUE');

    // Confirma que as colunas J e K preservam suas fórmulas originais intactas
    expect(gridFace[1][9]).toBe('=IF(COUNTIF(C2:I2, FALSE)=7, "TODOS OS DOCUMENTOS", "DOCS")');
    expect(gridFace[1][10]).toBe('=CONT.SE(C2:I2, FALSE)');
  });

  it('8. Detecção estrita de RAs duplicados na planilha para prevenir ambiguidade', async () => {
    const gridComDuplicidade = [
      originalControlHeaders,
      ['0090001001', 'ALUNO ALFA ORIGINAL', true, true, true, true, true, true, true],
      ['0090001001', 'ALUNO ALFA COPIADO', false, false, false, false, false, false, false],
      ['0090001002', 'ALUNO BETA ÚNICO', false, false, false, false, false, false, false],
    ];

    const mockFetch = async () => {
      return new Response(JSON.stringify({ values: gridComDuplicidade.map((r) => r.slice(0, 9)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });
    const result = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });

    // RA duplicado é detectado e excluído do mapa para prevenir gravação em linha incorreta
    expect(result.duplicateRas).toContain('0090001001');
    expect(result.rowsByRa.has('0090001001')).toBe(false);
    // Aluno único permanece acessível normalmente
    expect(result.rowsByRa.has('0090001002')).toBe(true);
  });

  it('9. Detecção de conflito (CAS): rejeição quando valor remoto diverge da expectativa', async () => {
    const gridFace = [
      originalControlHeaders,
      ['0090001002', 'ALUNO BETA', true, false, false, false, false, false, false], // identidade já está 1 (TRUE) remotamente
    ];

    const mockFetch = async () => {
      return new Response(JSON.stringify({ values: gridFace.map((r) => r.slice(0, 9)) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch as any });

    const writeRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '0090001002',
      fieldKey: 'identidade',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0, // Esperava 0, mas na planilha um humano já marcou 1
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-conflict-test',
      },
    });

    expect(writeRes.success).toBe(false);
    expect(writeRes.status).toBe('CONFLICT_DETECTED');
    expect(String(writeRes.observedValue).toUpperCase()).toBe('TRUE');
  });

  it('10. Modo SHADOW: bloqueio absoluto de mutações no Sheets (readOnly = true)', async () => {
    const shadowAdapter = new GoogleSheetsRealAdapter({ readOnly: true });

    const writeRes = await shadowAdapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '0090001002',
      fieldKey: 'identidade',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-shadow-write',
      },
    });

    expect(writeRes.success).toBe(false);
    expect(writeRes.status).toBe('OUT_OF_BOUNDS');
    expect(writeRes.error).toContain('WRITE_BLOCKED_IN_READ_ONLY_MODE');
  });

  it('11. Proteção contra sobrescrita fora dos limites (OUT_OF_BOUNDS)', async () => {
    const adapter = new GoogleSheetsRealAdapter();

    // Tentativa de gravar campo não-documental em aba de controle
    const invalidControlWrite = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '0090001002',
      fieldKey: 'campo_inexistente' as any,
      preconditions: {
        targetKey: 'CONTROLE',
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-out-of-bounds',
      },
    });
    expect(invalidControlWrite.success).toBe(false);
    expect(invalidControlWrite.status).toBe('OUT_OF_BOUNDS');

    // Tentativa de gravar campo que não seja 'contrato' na aba geral (apenas coluna A autorizada)
    const invalidGeneralWrite = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'FACE - FEA 2027 - 1',
      groupKey: 'FACE_FEA',
      raText: '0090001002',
      fieldKey: 'identidade',
      preconditions: {
        targetKey: 'GERAL_CONTRATO',
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-out-of-bounds-geral',
      },
    });
    expect(invalidGeneralWrite.success).toBe(false);
    expect(invalidGeneralWrite.status).toBe('OUT_OF_BOUNDS');
  });
});
