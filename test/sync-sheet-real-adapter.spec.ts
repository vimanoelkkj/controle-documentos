import { describe, expect, it } from 'vitest';
import {
  GoogleSheetsRealAdapter,
  GoogleSheetsAuthError,
  GoogleSheetsNotFoundError,
  GoogleSheetsRateLimitError,
  GoogleSheetsNetworkError,
  GoogleSheetsLayoutError,
} from '../src/server/services/sync-sheet-real-adapter';
import { EXPECTED_CONTROL_HEADERS } from '../src/server/services/sync-sheet-contracts';

/**
 * Cria um mock de fetch que simula com precisão as respostas da API v4 do Google Sheets.
 */
function createMockFetch(initialSheets: Record<string, unknown[][]> = {}) {
  const store = new Map<string, unknown[][]>();
  for (const [key, val] of Object.entries(initialSheets)) {
    store.set(key, JSON.parse(JSON.stringify(val)));
  }

  const calls: Array<{ url: string; method: string; body?: any }> = [];
  let simulateNetworkErrorOnPut = false;
  let simulateDropBeforePut = false;
  let simulateTimeout = false;
  let simulateHttpErrorStatus: number | null = null;
  let customResponseText: string | null = null;

  const mockFetch: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (simulateTimeout) {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    }

    if (simulateHttpErrorStatus) {
      return new Response(customResponseText || 'Simulated HTTP Error', {
        status: simulateHttpErrorStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rota GET de valores: .../values/<range>?...
    if (method === 'GET' && url.includes('/values/')) {
      const match = url.match(/\/values\/([^?]+)/);
      const encodedRange = match ? match[1] : '';
      const range = decodeURIComponent(encodedRange);

      // Extrai o nome da aba e do range: ex: 'CONTROLE DE DOCUMENTOS FACE FEA'!A1:I
      const tabMatch = range.match(/'?([^'!]+)'?!/);
      const tabName = tabMatch ? tabMatch[1] : '';

      const grid = store.get(tabName) || [];
      return new Response(
        JSON.stringify({
          range,
          majorDimension: 'ROWS',
          values: grid,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rota PUT de valores: .../values/<range>?valueInputOption=USER_ENTERED
    if (method === 'PUT' && url.includes('/values/')) {
      if (simulateDropBeforePut) {
        throw new Error('Connection drop before payload reached remote sheet');
      }

      const match = url.match(/\/values\/([^?]+)/);
      const encodedRange = match ? match[1] : '';
      const range = decodeURIComponent(encodedRange);

      const tabMatch = range.match(/'?([^'!]+)'?!([A-Z]+)(\d+)/);
      if (tabMatch) {
        const tabName = tabMatch[1];
        const colLetter = tabMatch[2];
        const rowNumber = Number(tabMatch[3]);

        const grid = store.get(tabName) || [];
        const colIndex = colLetter.charCodeAt(0) - 65; // A=0, B=1, C=2, etc.
        const rowIndex = rowNumber - 1; // 0-indexed

        while (grid.length <= rowIndex) grid.push([]);
        while (grid[rowIndex].length <= colIndex) grid[rowIndex].push('');

        const writeValue = body?.values?.[0]?.[0];
        grid[rowIndex][colIndex] = writeValue;
        store.set(tabName, grid);
      }

      if (simulateNetworkErrorOnPut) {
        throw new Error('Network connection reset by peer');
      }

      return new Response(
        JSON.stringify({
          updatedRange: range,
          updatedRows: 1,
          updatedColumns: 1,
          updatedCells: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({}), { status: 200 });
  };

  return {
    mockFetch,
    store,
    calls,
    setSimulateNetworkErrorOnPut: (val: boolean) => {
      simulateNetworkErrorOnPut = val;
    },
    setSimulateDropBeforePut: (val: boolean) => {
      simulateDropBeforePut = val;
    },
    setSimulateTimeout: (val: boolean) => {
      simulateTimeout = val;
    },
    setSimulateHttpErrorStatus: (status: number | null, text: string | null = null) => {
      simulateHttpErrorStatus = status;
      customResponseText = text;
    },
  };
}

describe('F4-A: Adaptador Real Google Sheets (GoogleSheetsRealAdapter)', () => {
  const spreadsheetId = 'sheet-id-contratos-2027-1';

  // Grade padrão para aba de controle FACE FEA
  const mockControleFaceFea: unknown[][] = [
    ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS],
    ['000123', 'Aluno Com Zeros', 'TRUE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE', 'TRUE'],
    ['000456', 'Aluno Completo', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE'],
    ['000789', 'Aluno Pendente', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE'],
  ];

  // Grade padrão para aba de controle FCH EAD
  const mockControleFchEad: unknown[][] = [
    ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS],
    ['000999', 'Aluno FCH', 'SIM', 'SIM', 'NÃO', 'SIM', '1', '0', 'TRUE'],
  ];

  // Grade padrão para aba geral de contratos
  const mockGeralContrato: unknown[][] = [
    ['SITUAÇÃO CONTRATUAL', 'CPF', 'CURSO', 'EMAIL', 'TEL', 'NOME', 'RA'],
    ['Entregue', '111', 'ADM', 'e@e.com', '123', 'Aluno Com Zeros', '000123'],
    ['Não Entregue', '222', 'DIR', 'd@d.com', '456', 'Aluno Completo', '000456'],
  ];

  it('F4-A.1 — Leitura consistente de snapshot da aba de controle preservando RA com zeros à esquerda', async () => {
    const { mockFetch, calls } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({
      adapterId: 'real-adapter-test-01',
      fetchFn: mockFetch,
    });

    const snapshot = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });

    expect(snapshot.spreadsheetId).toBe(spreadsheetId);
    expect(snapshot.groupKey).toBe('FACE_FEA');
    expect(snapshot.rowsByRa.size).toBe(3);

    const alunoZeros = snapshot.rowsByRa.get('000123');
    expect(alunoZeros).toBeDefined();
    expect(alunoZeros?.raText).toBe('000123');
    expect(alunoZeros?.studentName).toBe('Aluno Com Zeros');
    expect(alunoZeros?.rowIndex).toBe(2);

    // Mapeamento exato dos 7 documentos
    expect(alunoZeros?.fields.identidade.normalizedValue).toBe(1);
    expect(alunoZeros?.fields.cpf_documento.normalizedValue).toBe(1);
    expect(alunoZeros?.fields.certidao.normalizedValue).toBe(0);
    expect(alunoZeros?.fields.residencia.normalizedValue).toBe(0);
    expect(alunoZeros?.fields.titulo.normalizedValue).toBe(1);
    expect(alunoZeros?.fields.ensino_medio.normalizedValue).toBe(0);
    expect(alunoZeros?.fields.contrato.normalizedValue).toBe(1);

    // Coordenadas exatas das células
    expect(alunoZeros?.fields.identidade.cellCoordinate).toBe('C2');
    expect(alunoZeros?.fields.contrato.cellCoordinate).toBe('I2');

    // Validação de isolamento: range solicitado deve ser estritamente A1:I (sem colunas J/K)
    expect(calls.length).toBe(1);
    const requestedUrl = decodeURIComponent(calls[0].url);
    expect(requestedUrl).toContain('!A1:I');
    expect(requestedUrl).not.toContain('!A1:K');
  });

  it('F4-A.2 — Leitura de FCH EAD com valores booleanos e textuais variados', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FCH EAD': mockControleFchEad,
    });

    const adapter = new GoogleSheetsRealAdapter({
      fetchFn: mockFetch,
    });

    const snapshot = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FCH EAD',
      groupKey: 'FCH_EAD',
    });

    const alunoFch = snapshot.rowsByRa.get('000999');
    expect(alunoFch).toBeDefined();
    expect(alunoFch?.fields.identidade.normalizedValue).toBe(1); // 'SIM'
    expect(alunoFch?.fields.certidao.normalizedValue).toBe(0);   // 'NÃO'
    expect(alunoFch?.fields.titulo.normalizedValue).toBe(1);     // '1'
    expect(alunoFch?.fields.ensino_medio.normalizedValue).toBe(0);// '0'
  });

  it('F4-A.3 — Leitura de aba geral exclusivamente pela coluna A via RA da coluna G', async () => {
    const { mockFetch, calls } = createMockFetch({
      'FACE - FEA 2026 - 2': mockGeralContrato,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    const generalSnapshot = await adapter.readGeneralTabContracts({
      spreadsheetId,
      tabName: 'FACE - FEA 2026 - 2',
    });

    expect(generalSnapshot.rowsByRa.size).toBe(2);
    const aluno = generalSnapshot.rowsByRa.get('000123');
    expect(aluno).toBeDefined();
    expect(aluno?.contractNormalizedValue).toBe(1);
    expect(aluno?.cellCoordinate).toBe('A2');

    const aluno2 = generalSnapshot.rowsByRa.get('000456');
    expect(aluno2?.contractNormalizedValue).toBe(0);
    expect(aluno2?.cellCoordinate).toBe('A3');

    // Validação do range solicitado
    const requestedUrl = decodeURIComponent(calls[0].url);
    expect(requestedUrl).toContain('!A1:G');
  });

  it('F4-A.4 — Rejeição de layout adulterado (LAYOUT_MUTATED) na aba de controle', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE_ADULTERADO': [
        ['RA', 'Nome', 'RG', 'CPF', 'COLUNA_INVALIDA_AQUI', 'CERTIDAO', 'RESIDENCIA', 'TITULO', 'ENSINO MEDIO'],
        ['000111', 'Aluno Teste', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE'],
      ],
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE_ADULTERADO',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsLayoutError);
  });

  it('F4-A.5 — Tratamento de RA duplicado: marcação de ambiguidade impede escrita', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': [
        ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS],
        ['000123', 'Aluno Duplicado 1', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE'],
        ['000123', 'Aluno Duplicado 2', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE'],
      ],
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    const snapshot = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });

    // RA duplicado foi purgado do mapa para impedir acesso ambíguo
    expect(snapshot.rowsByRa.has('000123')).toBe(false);

    // Tentativa de escrita em RA ambíguo é rejeitada com AMBIGUOUS_IDENTITY / STUDENT_NOT_FOUND
    const writeRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-ambiguous-01',
      },
    });

    expect(writeRes.success).toBe(false);
    expect(writeRes.status).toBe('STUDENT_NOT_FOUND');
  });

  it('F4-A.6 — Proibição de atualização em ranges não autorizados (OUT_OF_BOUNDS)', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
      'FACE - FEA 2026 - 2': mockGeralContrato,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // Tentativa de escrever campo não documental na aba geral
    const outBoundsGeneral = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'FACE - FEA 2026 - 2',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'identidade', // Inválido para aba geral!
      preconditions: {
        targetKey: 'GERAL_CONTRATO',
        expectedCurrentValue: 1,
        targetValue: 0,
        targetRevision: 1,
        operationId: 'op-out-01',
      },
    });

    expect(outBoundsGeneral.success).toBe(false);
    expect(outBoundsGeneral.status).toBe('OUT_OF_BOUNDS');
  });

  it('F4-A.7 — Escrita cirúrgica em célula única com verificação prévia (Read-Before-Write CAS)', async () => {
    const { mockFetch, store, calls } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // RA 000123 tem ensino_medio = FALSE (0) na linha 2 (coordenada H2)
    const writeRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-cas-01',
      },
    });

    expect(writeRes.success).toBe(true);
    expect(writeRes.status).toBe('COMMITTED');
    expect(writeRes.cellCoordinate).toBe('H2');

    // Confirma que apenas a célula H2 foi modificada na planilha
    const tabData = store.get('CONTROLE DE DOCUMENTOS FACE FEA')!;
    expect(tabData[1][7]).toBe('TRUE'); // Coluna H linha 2
    expect(tabData[1][0]).toBe('000123'); // RA preservado intacto
    expect(tabData[1][1]).toBe('Aluno Com Zeros'); // Nome preservado intacto
    expect(tabData[1][2]).toBe('TRUE'); // Coluna C intacta
    expect(tabData[1][8]).toBe('TRUE'); // Coluna I intacta

    // Confirma que a chamada PUT foi feita estritamente no range 'H2'
    const putCalls = calls.filter(c => c.method === 'PUT');
    expect(putCalls.length).toBe(1);
    expect(decodeURIComponent(putCalls[0].url)).toContain('!H2');
  });

  it('F4-A.8 — Detecção de conflito (CONFLICT_DETECTED) quando valor remoto diverge do esperado', async () => {
    const { mockFetch, store } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // RA 000123 já possui identidade = TRUE (1)
    // Se a precondição esperava que estivesse FALSE (0), deve acusar CONFLICT_DETECTED
    const writeConflict = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'identidade',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0, // Esperava 0, mas na planilha está 1!
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-conflict-01',
      },
    });

    expect(writeConflict.success).toBe(false);
    expect(writeConflict.status).toBe('CONFLICT_DETECTED');
    expect(writeConflict.cellCoordinate).toBe('C2');
    expect(writeConflict.observedValue).toBe('TRUE');

    // Nenhuma mutação foi feita
    const tabData = store.get('CONTROLE DE DOCUMENTOS FACE FEA')!;
    expect(tabData[1][2]).toBe('TRUE');
  });

  it('F4-A.9 — Idempotência: escrita com estado já atingido confirma COMMITTED sem gerar erro', async () => {
    const { mockFetch, calls } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // RA 000123 já tem identidade = TRUE (1). Deseja escrever 1.
    const idempotentRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'identidade',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 1,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-idempotent-01',
      },
    });

    expect(idempotentRes.success).toBe(true);
    expect(idempotentRes.status).toBe('COMMITTED');

    // Nenhuma chamada PUT precisou ser enviada (estado já atingido)
    const putCalls = calls.filter(c => c.method === 'PUT');
    expect(putCalls.length).toBe(0);
  });

  it('F4-A.10 — Tratamento de erros HTTP: 401, 404, 429 e timeout', async () => {
    const { mockFetch, setSimulateHttpErrorStatus, setSimulateTimeout } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // 1. Simula 401
    setSimulateHttpErrorStatus(401, 'Unauthorized');
    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsAuthError);

    // 2. Simula 404
    setSimulateHttpErrorStatus(404, 'Spreadsheet Not Found');
    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsNotFoundError);

    // 3. Simula 429
    setSimulateHttpErrorStatus(429, 'Rate Limit Exceeded');
    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsRateLimitError);

    // 4. Simula Timeout
    setSimulateHttpErrorStatus(null);
    setSimulateTimeout(true);
    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsNetworkError);
  });

  it('F4-A.11 — Incerteza de rede na escrita: releitura verifica se a mutação foi aplicada', async () => {
    const { mockFetch, setSimulateNetworkErrorOnPut } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // Simula que durante o PUT ocorreu falha de conexão de rede,
    // mas a planilha remota chegou a receber a gravação antes da quebra da conexão
    setSimulateNetworkErrorOnPut(true);

    // O adaptador deve detectar o erro de rede, realizar uma releitura de conferência,
    // verificar que o valor desejado (TRUE) está presente e resolver com sucesso seguro
    const writeRes = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-uncertain-recovered',
      },
    });

    expect(writeRes.success).toBe(true);
    expect(writeRes.status).toBe('COMMITTED');
    expect(writeRes.cellCoordinate).toBe('H2');
  });

  it('F4-A.12 — Geração de evidência criptográfica de proveniência com HMAC SHA-256', async () => {
    const adapter = new GoogleSheetsRealAdapter({
      adapterId: 'real-adapter-evidence-01',
      adapterSecret: 'chave-teste-hmac-f4a',
    });

    const evidence = await adapter.generateProvenanceEvidence({
      integrationId: 'int-2027-1',
      periodoId: 20271,
      groupKey: 'FACE_FEA',
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      raText: '000123',
      fieldKey: 'identidade',
      cellCoordinate: 'C2',
      rawValue: 'TRUE',
      normalizedValue: 1,
      headerFingerprint: EXPECTED_CONTROL_HEADERS.join('::'),
    });

    expect(evidence.sourceAdapterId).toBe('real-adapter-evidence-01');
    expect(evidence.raText).toBe('000123');
    expect(evidence.cellCoordinate).toBe('C2');
    expect(evidence.normalizedValue).toBe(1);
    expect(evidence.contentHash).toBeDefined();
    expect(evidence.contentHash.length).toBe(64); // SHA-256 hex string
    expect(evidence.adapterSignature).toBeDefined();
    expect(evidence.adapterSignature?.length).toBe(64); // HMAC SHA-256 hex string
  });

  it('F4-A.13 — Incerteza de rede não recuperada: falha antes da mutação lança GoogleSheetsNetworkError', async () => {
    const { mockFetch, setSimulateDropBeforePut } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // Simula que a falha de conexão ocorreu antes do payload ser aplicado na planilha
    setSimulateDropBeforePut(true);

    await expect(
      adapter.writeDocumentField({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
        raText: '000123',
        fieldKey: 'ensino_medio',
        preconditions: {
          targetKey: 'CONTROLE',
          expectedCurrentValue: 0,
          targetValue: 1,
          targetRevision: 1,
          operationId: 'op-uncertain-unrecovered',
        },
      })
    ).rejects.toThrow(GoogleSheetsNetworkError);
  });
  it('F4-A.14 — Preservação estrita das colunas J e K (fórmulas e contadores)', async () => {
    // Grade contendo colunas J e K com fórmulas
    const gradeComFormulas: unknown[][] = [
      ['RA', 'Nome', ...EXPECTED_CONTROL_HEADERS, 'TOTAL_DOCS', 'STATUS_FINAL'],
      ['000123', 'Aluno Com Zeros', 'TRUE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE', 'TRUE', '=CONT.SE(C2:I2, TRUE)', '=SE(J2=7, "OK", "PENDENTE")'],
    ];

    const { mockFetch, store, calls } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': gradeComFormulas,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // 1. Leitura: Range solicitado deve ser estritamente A1:I
    const snapshot = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
    });

    expect(snapshot.rowsByRa.has('000123')).toBe(true);
    const getCalls = calls.filter(c => c.method === 'GET');
    const requestedRange = decodeURIComponent(getCalls[0].url);
    expect(requestedRange).toContain('!A1:I');
    expect(requestedRange).not.toContain('!A1:K');

    // 2. Escrita: mutação restrita a célula autorizada H2 não toca nas colunas J e K
    await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-preserve-jk',
      },
    });

    const gradeAposEscrita = store.get('CONTROLE DE DOCUMENTOS FACE FEA')!;
    // Coluna H foi atualizada para TRUE
    expect(gradeAposEscrita[1][7]).toBe('TRUE');
    // Colunas J (índice 9) e K (índice 10) preservadas com fórmulas originais intactas
    expect(gradeAposEscrita[1][9]).toBe('=CONT.SE(C2:I2, TRUE)');
    expect(gradeAposEscrita[1][10]).toBe('=SE(J2=7, "OK", "PENDENTE")');
  });

  it('F4-A.15 — Detecção de conflito intermediário por divergência de expectedSnapshotHash (C4)', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // O chamador envia um hash de snapshot desatualizado
    const res = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-snap-hash-conflict',
        expectedSnapshotHash: 'hash-obsoleto-de-snapshot-divergente',
      },
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('CONFLICT_DETECTED');
    expect(res.error).toContain('Mutação intermediária detectada');
  });

  it('F4-A.16 — Regra C3: Aluno ausente ou ambíguo NÃO confirma ausência (isAbsentConfirmed = false)', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // Consulta aluno inexistente
    const checkInexistente = await adapter.verifyExternalEffect({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '999999',
      fieldKey: 'identidade',
      targetKey: 'CONTROLE',
      expectedTargetValue: 1,
    });

    expect(checkInexistente.effectObserved).toBe(false);
    // CRUCIAL C3: Não pode confirmar ausência de efeito para aluno ausente ou ambíguo
    expect(checkInexistente.isAbsentConfirmed).toBe(false);
  });

  it('F4-A.17 — Regra C3: Confirmação conclusiva de ausência (isAbsentConfirmed = true) apenas com valor oposto', async () => {
    const { mockFetch } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // RA 000123 tem ensino_medio = FALSE (0)
    // Se esperamos 1, a observação conclusiva de 0 confirma ausência do efeito esperado
    const checkOposto = await adapter.verifyExternalEffect({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      targetKey: 'CONTROLE',
      expectedTargetValue: 1,
    });

    expect(checkOposto.effectObserved).toBe(false);
    expect(checkOposto.isAbsentConfirmed).toBe(true);
    expect(checkOposto.currentNormalizedValue).toBe(0);
  });

  it('F4-A.18 — Tratamento de erro 500 do Google Sheets como incerteza transitória de rede', async () => {
    const { mockFetch, setSimulateHttpErrorStatus } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });
    setSimulateHttpErrorStatus(500, 'Internal Server Error do Google Sheets');

    await expect(
      adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      })
    ).rejects.toThrow(GoogleSheetsNetworkError);
  });

  it('F4-A.19 — Rejeição de emissão de proveniência com AdapterSecret ausente ou curto', async () => {
    const adapterSemSegredo = new GoogleSheetsRealAdapter({
      adapterId: 'real-adapter-inseguro',
      adapterSecret: '123', // Segredo muito curto (< 8 caracteres)
    });

    await expect(
      adapterSemSegredo.generateProvenanceEvidence({
        integrationId: 'int-2027-1',
        periodoId: 20271,
        groupKey: 'FACE_FEA',
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        raText: '000123',
        fieldKey: 'identidade',
        cellCoordinate: 'C2',
        rawValue: 'TRUE',
        normalizedValue: 1,
        headerFingerprint: EXPECTED_CONTROL_HEADERS.join('::'),
      })
    ).rejects.toThrow(GoogleSheetsAuthError);
  });

  it('F4-A.20 — Janela de CAS otimista: previne sobrescrita quando estado prévio diverge', async () => {
    const { mockFetch, store } = createMockFetch({
      'CONTROLE DE DOCUMENTOS FACE FEA': mockControleFaceFea,
    });

    const adapter = new GoogleSheetsRealAdapter({ fetchFn: mockFetch });

    // Modificação humana concorrente foi feita antes da execução do lote (célula H2 passou para TRUE)
    const grid = store.get('CONTROLE DE DOCUMENTOS FACE FEA')!;
    grid[1][7] = 'TRUE';

    // Tentativa do sistema de escrever com base em snapshot antigo onde esperava 0
    const res = await adapter.writeDocumentField({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
      groupKey: 'FACE_FEA',
      raText: '000123',
      fieldKey: 'ensino_medio',
      preconditions: {
        targetKey: 'CONTROLE',
        expectedCurrentValue: 0,
        targetValue: 1,
        targetRevision: 1,
        operationId: 'op-cas-window-conflict',
      },
    });

    // O adaptador identifica a divergência pré-escrita e bloqueia a mutação sem alterar a célula
    expect(res.success).toBe(false);
    expect(res.status).toBe('CONFLICT_DETECTED');
    expect(grid[1][7]).toBe('TRUE'); // Mantém o valor editado pelo humano intacto
  });

  it('F4-A.21 — Preserva o contexto de globalThis.fetch quando fetchFn não é injetado (previne Illegal invocation)', async () => {
    const originalFetch = globalThis.fetch;
    let receptorCorreto = false;

    // Simula runtime V8/workerd que exige estritamente receiver globalThis
    const strictReceiverFetch = function (this: unknown, _input: any, _init: any) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
      }
      receptorCorreto = true;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            range: "'CONTROLE DE DOCUMENTOS FACE FEA'!A1:I2",
            values: mockControleFaceFea,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    };

    try {
      globalThis.fetch = strictReceiverFetch as unknown as typeof fetch;

      const adapter = new GoogleSheetsRealAdapter({
        tokenProvider: async () => 'mock-token',
        // fetchFn omitido intencionalmente para acionar fallback a globalThis.fetch
      });

      const snapshot = await adapter.readControlTab({
        spreadsheetId,
        tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
        groupKey: 'FACE_FEA',
      });

      expect(snapshot.rowsByRa.size).toBe(3);
      expect(snapshot.rowsByRa.has('000123')).toBe(true);
      expect(receptorCorreto).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('F4-A.22 — Preserva o comportamento exato de fetchFn customizado injetado em testes', async () => {
    let mockInvocado = false;
    const customMock: typeof fetch = async () => {
      mockInvocado = true;
      return new Response(
        JSON.stringify({
          range: "'CONTROLE DE DOCUMENTOS FCH EAD'!A1:I4",
          values: mockControleFaceFea,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapter = new GoogleSheetsRealAdapter({
      tokenProvider: async () => 'mock-token',
      fetchFn: customMock,
    });

    const snapshot = await adapter.readControlTab({
      spreadsheetId,
      tabName: 'CONTROLE DE DOCUMENTOS FCH EAD',
      groupKey: 'FCH_EAD',
    });

    expect(snapshot.rowsByRa.size).toBe(3);
    expect(mockInvocado).toBe(true);
  });
});
