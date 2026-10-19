/**
 * ============================================================================
 * F2 — Adaptador Simulado em Memória Determinístico (F2.3)
 * ============================================================================
 * Implementa ISyncSpreadsheetAdapter com fixtures determinísticas em memória,
 * garantindo:
 *  - Validação de cabeçalho C:I e rejeição por LAYOUT_MUTATED.
 *  - Preservação estrita de RA textual com zeros à esquerda.
 *  - Leitura da aba geral exclusivamente pela coluna A via RA coluna G.
 *  - Bloqueio estrito de escrita fora dos limites (OUT_OF_BOUNDS).
 *  - Proibição de sobrescrita de edições humanas (CONFLICT_DETECTED).
 *  - Verificação de efeito externo precisa (verifyExternalEffect).
 *  - Geração de evidência criptográfica com proveniência completa.
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import type { OperationTargetKey } from './sync-d1-operations';
import {
  CONTROL_DOC_COLUMNS,
  FIELD_TO_CONTROL_COLUMN_INDEX,
  CONTROL_COLUMN_LETTERS,
  EXPECTED_CONTROL_HEADERS,
  normalizeDocumentCellValue,
  normalizeContractCellValue,
  type ISyncSpreadsheetAdapter,
  type ControlTabReadResult,
  type ControlRowSnapshot,
  type GeneralTabReadResult,
  type GeneralContractRowSnapshot,
  type WritePreconditions,
  type WriteResult,
  type ExternalEffectCheckResult,
  type ProvenanceEvidence,
} from './sync-sheet-contracts';
import { validateCanonicalRa } from './sync-d1-auth';

export interface FakeTabCellGrid {
  headers: string[];
  tabType: 'CONTROL' | 'GENERAL';
  groupKey?: GroupKey;
  // Matriz de dados: rows[linhaIdx][colunaIdx]
  rows: string[][];
  // Mapa de RA -> lista de índices de linha (para detecção de duplicados/ambiguidade)
  raToRowIndices: Map<string, number[]>;
  // Versionamento sequencial por célula para controle de concorrência determinístico
  cellVersions: Map<string, number>;
}

export interface FakeSpreadsheetState {
  spreadsheetId: string;
  tabs: Map<string, FakeTabCellGrid>;
}

/**
 * ============================================================================
 * NOTA ARQUITETURAL SOBRE A ATOMICIDADE NA GOOGLE SHEETS API (C4):
 * A API pública do Google Sheets (REST v4) opera sob chamadas HTTP (batchUpdate,
 * get, append). Não há mecanismo nativo de transação ACID com isolamento serializável
 * ou optimistic locking baseado em versão de linha. Mutação concorrente externa
 * (humana ou por script) durante o intervalo entre a leitura do snapshot e a escrita
 * do range é uma limitação física da API remota.
 * Para mitigar esse risco no adaptador de produção, é obrigatória a revalidação
 * atômica do snapshot imediatamente antes do payload e a confirmação do efeito após
 * a resposta, registrando conflito em caso de divergência.
 * ============================================================================
 */

export class FakeSpreadsheetAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId: string;
  private spreadsheets: Map<string, FakeSpreadsheetState> = new Map();

  constructor(adapterId = 'fake-sheet-adapter-01') {
    this.adapterId = adapterId;
  }

  /**
   * Helper para carregar ou resetar uma planilha fictícia de teste.
   */
  loadSpreadsheet(state: FakeSpreadsheetState): void {
    this.spreadsheets.set(state.spreadsheetId, state);
  }

  /**
   * Helper para carregar uma aba de controle padrão com cabeçalhos canônicos C:I.
   */
  loadControlTab(
    spreadsheetId: string,
    tabName: string,
    rows: Array<{
      raText: string;
      studentName?: string;
      fields: Partial<Record<FieldKey, string>>;
    }>,
    customHeaders?: string[],
    groupKey: GroupKey = 'FACE_FEA'
  ): void {
    let sheet = this.spreadsheets.get(spreadsheetId);
    if (!sheet) {
      sheet = { spreadsheetId, tabs: new Map() };
      this.spreadsheets.set(spreadsheetId, sheet);
    }

    const headers =
      customHeaders || [
        'NUM',
        'ALUNO_RA',
        'IDENTIDADE',
        'CPF',
        'CERTIDÃO',
        'COMP. RESIDÊNCIA',
        'TÍTULO',
        'ENSINO MÉDIO',
        'CONTRATO',
      ];

    const gridRows: string[][] = [];
    const raMap = new Map<string, number[]>();
    const cellVersions = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      // Valida RA canônico textual
      const raRes = validateCanonicalRa(item.raText);
      if (!raRes.valid) {
        throw new Error(`Cannot load control tab with invalid RA: ${item.raText}`);
      }

      const rowCols = new Array(headers.length).fill('');
      rowCols[0] = String(i + 1);
      rowCols[1] = item.studentName ? `${item.studentName} - ${raRes.raText}` : raRes.raText;

      for (const field of CONTROL_DOC_COLUMNS) {
        const colIdx = FIELD_TO_CONTROL_COLUMN_INDEX[field];
        rowCols[colIdx] = item.fields[field] ?? '';
        cellVersions.set(`${CONTROL_COLUMN_LETTERS[field]}${i + 2}`, 1);
      }

      gridRows.push(rowCols);
      const existing = raMap.get(raRes.raText) || [];
      existing.push(i);
      raMap.set(raRes.raText, existing);
    }

    sheet.tabs.set(tabName, {
      headers,
      tabType: 'CONTROL',
      groupKey,
      rows: gridRows,
      raToRowIndices: raMap,
      cellVersions,
    });
  }

  /**
   * Helper para carregar uma aba geral de contratos padrão.
   * Col A (idx 0): Situação Contratual
   * Col G (idx 6): RA do aluno
   */
  loadGeneralTab(
    spreadsheetId: string,
    tabName: string,
    rows: Array<{
      raText: string;
      contractStatus: string;
      extraCols?: Record<number, string>;
    }>,
    customHeaders?: string[]
  ): void {
    let sheet = this.spreadsheets.get(spreadsheetId);
    if (!sheet) {
      sheet = { spreadsheetId, tabs: new Map() };
      this.spreadsheets.set(spreadsheetId, sheet);
    }

    const headers =
      customHeaders || [
        'SITUAÇÃO CONTRATUAL', // Col A
        'CURSO',              // Col B
        'NOME',               // Col C
        'EMAIL',              // Col D
        'TELEFONE',           // Col E
        'POLO',               // Col F
        'RA',                 // Col G
      ];

    const gridRows: string[][] = [];
    const raMap = new Map<string, number[]>();
    const cellVersions = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      const raRes = validateCanonicalRa(item.raText);
      if (!raRes.valid) {
        throw new Error(`Cannot load general tab with invalid RA: ${item.raText}`);
      }

      const rowCols = new Array(headers.length).fill('');
      rowCols[0] = item.contractStatus;
      rowCols[6] = raRes.raText;
      cellVersions.set(`A${i + 2}`, 1);

      if (item.extraCols) {
        for (const [colIdxStr, val] of Object.entries(item.extraCols)) {
          const colIdx = Number(colIdxStr);
          while (rowCols.length <= colIdx) rowCols.push('');
          rowCols[colIdx] = val;
        }
      }

      gridRows.push(rowCols);
      const existing = raMap.get(raRes.raText) || [];
      existing.push(i);
      raMap.set(raRes.raText, existing);
    }

    sheet.tabs.set(tabName, {
      headers,
      tabType: 'GENERAL',
      rows: gridRows,
      raToRowIndices: raMap,
      cellVersions,
    });
  }

  /**
   * Valida layout de cabeçalho da aba de controle C:I
   */
  private validateControlHeader(headers: string[]): { valid: true; fingerprint: string } | { valid: false; error: string } {
    if (headers.length < 9) {
      return { valid: false, error: 'Control tab has less than 9 columns' };
    }
    const headerCtoI = headers.slice(2, 9);
    for (let idx = 0; idx < EXPECTED_CONTROL_HEADERS.length; idx++) {
      const actual = (headerCtoI[idx] || '').trim().toUpperCase();
      const expected = EXPECTED_CONTROL_HEADERS[idx];
      if (actual !== expected) {
        return {
          valid: false,
          error: `STRUCTURAL_LAYOUT_MUTATED: Column ${String.fromCharCode(67 + idx)} header expected '${expected}', found '${actual}'`,
        };
      }
    }
    return { valid: true, fingerprint: headerCtoI.join('::') };
  }

  /**
   * Valida layout de cabeçalho da aba geral (Col A e Col G)
   */
  private validateGeneralHeader(headers: string[]): { valid: true; fingerprint: string } | { valid: false; error: string } {
    if (headers.length < 7) {
      return { valid: false, error: 'General tab has less than 7 columns' };
    }
    const colAHeader = (headers[0] || '').trim().toUpperCase();
    const colGHeader = (headers[6] || '').trim().toUpperCase();
    if (!colAHeader.includes('SITUAÇÃO') && !colAHeader.includes('CONTRAT')) {
      return { valid: false, error: `STRUCTURAL_LAYOUT_MUTATED: General tab column A header '${colAHeader}' is invalid` };
    }
    if (!colGHeader.includes('RA')) {
      return { valid: false, error: `STRUCTURAL_LAYOUT_MUTATED: General tab column G header '${colGHeader}' is not RA` };
    }
    return { valid: true, fingerprint: `${colAHeader}::${colGHeader}` };
  }

  /**
   * Lê aba de controle C:I
   */
  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const sheet = this.spreadsheets.get(params.spreadsheetId);
    if (!sheet) {
      throw new Error(`Spreadsheet ${params.spreadsheetId} not found in fake adapter`);
    }
    const tab = sheet.tabs.get(params.tabName);
    if (!tab) {
      throw new Error(`Tab ${params.tabName} not found in spreadsheet ${params.spreadsheetId}`);
    }

    if (tab.tabType !== 'CONTROL') {
      throw new Error(`STRUCTURAL_LAYOUT_MUTATED: Tab '${params.tabName}' is not a CONTROL tab`);
    }

    const headerCheck = this.validateControlHeader(tab.headers);
    if (!headerCheck.valid) {
      throw new Error(headerCheck.error);
    }

    const readAt = new Date().toISOString();
    const rowsByRa = new Map<string, ControlRowSnapshot>();

    for (let rowIdx = 0; rowIdx < tab.rows.length; rowIdx++) {
      const row = tab.rows[rowIdx];
      const cellB = (row[1] || '').trim();
      const match = cellB.match(/(\d+)$/);
      if (!match) continue;

      const raText = match[1];
      const raRes = validateCanonicalRa(raText);
      if (!raRes.valid) continue;

      // C3: Rejeita RAs duplicados/ambíguos na aba
      const indices = tab.raToRowIndices.get(raRes.raText);
      if (indices && indices.length > 1) {
        throw new Error(`AMBIGUOUS_IDENTITY: Duplicate RA '${raRes.raText}' found at multiple rows in tab '${params.tabName}'`);
      }

      const fields: Partial<ControlRowSnapshot['fields']> = {};

      for (const field of CONTROL_DOC_COLUMNS) {
        const colIdx = FIELD_TO_CONTROL_COLUMN_INDEX[field];
        const rawValue = (row[colIdx] || '').trim();
        const normalizedValue = normalizeDocumentCellValue(rawValue);
        const cellCoordinate = `${CONTROL_COLUMN_LETTERS[field]}${rowIdx + 2}`;

        fields[field] = {
          rawValue,
          normalizedValue,
          cellCoordinate,
        };
      }

      rowsByRa.set(raText, {
        rowIndex: rowIdx + 2,
        raText,
        studentName: cellB,
        fields: fields as ControlRowSnapshot['fields'],
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: headerCheck.fingerprint,
      readAt,
      rowsByRa,
    };
  }

  /**
   * Lê aba geral de contrato exclusivamente coluna A via RA coluna G
   */
  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const sheet = this.spreadsheets.get(params.spreadsheetId);
    if (!sheet) {
      throw new Error(`Spreadsheet ${params.spreadsheetId} not found in fake adapter`);
    }
    const tab = sheet.tabs.get(params.tabName);
    if (!tab) {
      throw new Error(`Tab ${params.tabName} not found in spreadsheet ${params.spreadsheetId}`);
    }

    if (tab.tabType !== 'GENERAL') {
      throw new Error(`STRUCTURAL_LAYOUT_MUTATED: Tab '${params.tabName}' is not a GENERAL tab`);
    }

    const headerCheck = this.validateGeneralHeader(tab.headers);
    if (!headerCheck.valid) {
      throw new Error(headerCheck.error);
    }

    const readAt = new Date().toISOString();
    const rowsByRa = new Map<string, GeneralContractRowSnapshot>();

    for (let rowIdx = 0; rowIdx < tab.rows.length; rowIdx++) {
      const row = tab.rows[rowIdx];
      const raCell = (row[6] || '').trim();
      const raRes = validateCanonicalRa(raCell);
      if (!raRes.valid) continue;

      // C3: Rejeita RAs duplicados/ambíguos na aba
      const indices = tab.raToRowIndices.get(raRes.raText);
      if (indices && indices.length > 1) {
        throw new Error(`AMBIGUOUS_IDENTITY: Duplicate RA '${raRes.raText}' found at multiple rows in general tab '${params.tabName}'`);
      }

      const contractRaw = (row[0] || '').trim();
      const contractNorm = normalizeContractCellValue(contractRaw);

      rowsByRa.set(raRes.raText, {
        rowIndex: rowIdx + 2,
        raText: raRes.raText,
        contractRawValue: contractRaw,
        contractNormalizedValue: contractNorm,
        cellCoordinate: `A${rowIdx + 2}`,
      });
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: headerCheck.fingerprint,
      readAt,
      rowsByRa,
    };
  }

  /**
   * Escrita com precondições, validação de aba, layout e proteção contra sobrescrita (C2, C3, C4).
   */
  async writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    preconditions: WritePreconditions;
  }): Promise<WriteResult> {
    const sheet = this.spreadsheets.get(params.spreadsheetId);
    if (!sheet) {
      return { success: false, status: 'LAYOUT_MUTATED', error: `Spreadsheet '${params.spreadsheetId}' not found` };
    }
    const tab = sheet.tabs.get(params.tabName);
    if (!tab) {
      return { success: false, status: 'LAYOUT_MUTATED', error: `Tab '${params.tabName}' not found` };
    }

    // C2: Validação estrita de tipo de aba, correspondência de layout e targetKey
    if (params.preconditions.targetKey === 'GERAL_CONTRATO') {
      if (tab.tabType !== 'GENERAL') {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: `targetKey 'GERAL_CONTRATO' cannot write to tab of type '${tab.tabType}'`,
        };
      }
      if (params.fieldKey !== 'contrato') {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: "targetKey 'GERAL_CONTRATO' is strictly allowed only for field 'contrato'",
        };
      }
      const generalCheck = this.validateGeneralHeader(tab.headers);
      if (!generalCheck.valid) {
        return { success: false, status: 'LAYOUT_MUTATED', error: generalCheck.error };
      }
    } else if (params.preconditions.targetKey === 'CONTROLE') {
      if (tab.tabType !== 'CONTROL') {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: `targetKey 'CONTROLE' cannot write to tab of type '${tab.tabType}'`,
        };
      }
      if (tab.groupKey && tab.groupKey !== params.groupKey) {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: `Group mismatch: target tab is for group '${tab.groupKey}', but write requested for '${params.groupKey}'`,
        };
      }
      const controlCheck = this.validateControlHeader(tab.headers);
      if (!controlCheck.valid) {
        return { success: false, status: 'LAYOUT_MUTATED', error: controlCheck.error };
      }
    } else {
      return {
        success: false,
        status: 'OUT_OF_BOUNDS',
        error: `Unknown targetKey '${params.preconditions.targetKey}'`,
      };
    }

    // C3: Identidade inequívoca do RA e rejeição de duplicados/ambiguidade
    const raRes = validateCanonicalRa(params.raText);
    if (!raRes.valid) {
      return { success: false, status: 'STUDENT_NOT_FOUND', error: raRes.error };
    }

    const rowIndices = tab.raToRowIndices.get(raRes.raText);
    if (!rowIndices || rowIndices.length === 0) {
      return { success: false, status: 'STUDENT_NOT_FOUND', error: `RA ${params.raText} not found in tab` };
    }
    if (rowIndices.length > 1) {
      return {
        success: false,
        status: 'AMBIGUOUS_IDENTITY',
        error: `AMBIGUOUS_IDENTITY: RA ${params.raText} found at multiple rows (${rowIndices.join(', ')}). Aborting write to prevent corruption.`,
      };
    }

    const rowIdx = rowIndices[0];
    const row = tab.rows[rowIdx];
    let colIdx: number;
    let colLetter: string;

    if (params.preconditions.targetKey === 'GERAL_CONTRATO') {
      // Aba Geral: estritamente coluna A (idx 0). Proibido alterar qualquer outra coluna!
      colIdx = 0;
      colLetter = 'A';
    } else {
      // Aba de Controle: exclusivamente colunas C:I (idx 2 a 8). Proibido alterar A, B, J, K ou fórmulas!
      colIdx = FIELD_TO_CONTROL_COLUMN_INDEX[params.fieldKey];
      colLetter = CONTROL_COLUMN_LETTERS[params.fieldKey];
    }

    const cellCoordinate = `${colLetter}${rowIdx + 2}`;
    const currentRaw = (row[colIdx] || '').trim();
    const currentNorm =
      params.preconditions.targetKey === 'GERAL_CONTRATO'
        ? normalizeContractCellValue(currentRaw)
        : normalizeDocumentCellValue(currentRaw);

    // C4: Distinção entre valor observado e precondição de versão/snapshot
    if (params.preconditions.expectedCurrentValue !== undefined) {
      if (currentNorm !== params.preconditions.expectedCurrentValue) {
        return {
          success: false,
          status: 'CONFLICT_DETECTED',
          cellCoordinate,
          observedValue: currentRaw,
          error: `Human or external modification detected. Expected normalized value ${params.preconditions.expectedCurrentValue}, observed ${currentNorm} ('${currentRaw}')`,
        };
      }
    }

    // C4: Detecção de mutação entre snapshot e escrita mesmo se normalizado for igual
    if (params.preconditions.expectedSnapshotHash) {
      const currentCellVersion = tab.cellVersions.get(cellCoordinate) || 1;
      const expectedVersion = Number(params.preconditions.expectedSnapshotHash);
      if (!isNaN(expectedVersion) && currentCellVersion !== expectedVersion) {
        return {
          success: false,
          status: 'CONFLICT_DETECTED',
          cellCoordinate,
          observedValue: currentRaw,
          error: `Concurrent modification detected between snapshot and write (cell version ${currentCellVersion} !== expected ${expectedVersion})`,
        };
      }
    }

    // Efetua a mutação estritamente na célula autorizada
    const newRawValue = params.preconditions.targetValue === 1 ? 'ENTREGUE' : 'PENDENTE';
    row[colIdx] = newRawValue;

    // Incrementa versão sequencial da célula
    const nextVer = (tab.cellVersions.get(cellCoordinate) || 1) + 1;
    tab.cellVersions.set(cellCoordinate, nextVer);

    return {
      success: true,
      status: 'COMMITTED',
      cellCoordinate,
      observedValue: newRawValue,
    };
  }

  /**
   * Verificação de Efeito Externo (C3).
   * A confirmação de ausência (isAbsentConfirmed) deve depender de observação conclusiva
   * e identidade verificada. Valores desconhecidos, RA inexistente ou identidade ambígua
   * NÃO devem produzir isAbsentConfirmed = true.
   */
  async verifyExternalEffect(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    targetKey: OperationTargetKey;
    expectedTargetValue: 0 | 1;
  }): Promise<ExternalEffectCheckResult> {
    const nowIso = new Date().toISOString();
    const sheet = this.spreadsheets.get(params.spreadsheetId);
    if (!sheet) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: nowIso,
      };
    }
    const tab = sheet.tabs.get(params.tabName);
    if (!tab) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: nowIso,
      };
    }

    const raRes = validateCanonicalRa(params.raText);
    if (!raRes.valid) {
      // RA inválido não é comprovação conclusiva de ausência
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: nowIso,
      };
    }

    const rowIndices = tab.raToRowIndices.get(raRes.raText);
    // C3: Aluno ausente ou ambíguo não comprova conclusivamente ausência de efeito na planilha
    if (!rowIndices || rowIndices.length === 0 || rowIndices.length > 1) {
      return {
        effectObserved: false,
        isAbsentConfirmed: false,
        currentRawValue: null,
        currentNormalizedValue: null,
        inspectedAt: nowIso,
      };
    }

    const rowIdx = rowIndices[0];
    const row = tab.rows[rowIdx];
    const colIdx =
      params.targetKey === 'GERAL_CONTRATO' ? 0 : FIELD_TO_CONTROL_COLUMN_INDEX[params.fieldKey];
    const colLetter =
      params.targetKey === 'GERAL_CONTRATO' ? 'A' : CONTROL_COLUMN_LETTERS[params.fieldKey];
    const cellCoordinate = `${colLetter}${rowIdx + 2}`;

    const raw = (row[colIdx] || '').trim();
    const norm =
      params.targetKey === 'GERAL_CONTRATO'
        ? normalizeContractCellValue(raw)
        : normalizeDocumentCellValue(raw);

    const effectObserved = norm === params.expectedTargetValue;

    // C3: A confirmação de ausência (isAbsentConfirmed) só é verdadeira quando a célula
    // possui um valor normalizado conclusivo (0 ou 1) que é comprovadamente OPOSTO ao esperado.
    // Valores nulos/desconhecidos (ex: texto livre, célula em branco) geram isAbsentConfirmed = false!
    const isAbsentConfirmed = norm !== null && norm !== params.expectedTargetValue;

    return {
      effectObserved,
      isAbsentConfirmed,
      currentRawValue: raw,
      currentNormalizedValue: norm,
      inspectedAt: nowIso,
      cellCoordinate,
    };
  }

  /**
   * Gera evidência criptográfica de proveniência a partir de observação real no grid (C5).
   * Não aceita valores fabricados: localiza a célula real na planilha e valida vinculação estrita
   * com integração, planilha, aba, grupo, RA, campo e valor efetivamente observado.
   */
  async generateProvenanceEvidence(params: {
    integrationId: string;
    periodoId: number;
    groupKey: GroupKey;
    spreadsheetId: string;
    tabName: string;
    raText: string;
    fieldKey: FieldKey;
    cellCoordinate?: string;
    rawValue?: string;
    normalizedValue?: 0 | 1 | null;
    headerFingerprint?: string;
    readTimestamp?: string;
    adapterSecret?: string;
  }): Promise<ProvenanceEvidence> {
    const timestamp = params.readTimestamp || new Date().toISOString();
    const evidenceId = `evid_${crypto.randomUUID()}`;

    // 1. Validação estrita: a planilha e a aba DEVEM existir no adaptador
    const sheet = this.spreadsheets.get(params.spreadsheetId);
    if (!sheet) {
      throw new Error(`Cannot generate provenance evidence: Spreadsheet '${params.spreadsheetId}' not found in adapter`);
    }
    const tab = sheet.tabs.get(params.tabName);
    if (!tab) {
      throw new Error(`Cannot generate provenance evidence: Tab '${params.tabName}' not found in adapter`);
    }

    // 2. Validação da identidade do aluno e unicidade
    const raRes = validateCanonicalRa(params.raText);
    if (!raRes.valid) {
      throw new Error(`Cannot generate provenance evidence: Invalid RA '${params.raText}'`);
    }
    const rowIndices = tab.raToRowIndices.get(raRes.raText);
    if (!rowIndices || rowIndices.length === 0) {
      throw new Error(`Cannot generate provenance evidence: RA '${params.raText}' does not exist in tab '${params.tabName}'`);
    }
    if (rowIndices.length > 1) {
      throw new Error(`Cannot generate provenance evidence: Ambiguous RA '${params.raText}' found in multiple rows`);
    }

    const rowIdx = rowIndices[0];
    const row = tab.rows[rowIdx];

    // 3. Determina coluna autorizada e extrai o valor real observado da célula
    let colIdx: number;
    let colLetter: string;
    let actualHeaderFingerprint: string;

    if (tab.tabType === 'CONTROL') {
      const headerCheck = this.validateControlHeader(tab.headers);
      if (!headerCheck.valid) {
        throw new Error(`Cannot generate provenance evidence: ${headerCheck.error}`);
      }
      actualHeaderFingerprint = headerCheck.fingerprint;
      colIdx = FIELD_TO_CONTROL_COLUMN_INDEX[params.fieldKey];
      colLetter = CONTROL_COLUMN_LETTERS[params.fieldKey];
    } else {
      if (params.fieldKey !== 'contrato') {
        throw new Error(`Cannot generate provenance evidence: General tab only supports 'contrato' field`);
      }
      const headerCheck = this.validateGeneralHeader(tab.headers);
      if (!headerCheck.valid) {
        throw new Error(`Cannot generate provenance evidence: ${headerCheck.error}`);
      }
      actualHeaderFingerprint = headerCheck.fingerprint;
      colIdx = 0;
      colLetter = 'A';
    }

    const actualCellCoordinate = `${colLetter}${rowIdx + 2}`;
    const actualRawValue = (row[colIdx] || '').trim();
    const actualNormalizedValue =
      tab.tabType === 'CONTROL'
        ? normalizeDocumentCellValue(actualRawValue)
        : normalizeContractCellValue(actualRawValue);

    // Se o chamador forneceu valores declarados, eles DEVEM bater rigorosamente com o observado
    if (params.rawValue !== undefined && params.rawValue !== actualRawValue) {
      throw new Error(`Provenance rejected: declared rawValue '${params.rawValue}' does not match observed '${actualRawValue}'`);
    }
    if (params.normalizedValue !== undefined && params.normalizedValue !== actualNormalizedValue) {
      throw new Error(`Provenance rejected: declared normalizedValue '${params.normalizedValue}' does not match observed '${actualNormalizedValue}'`);
    }

    // 4. Hash canônico dos metadados completos da leitura observada
    const canonicalString = [
      evidenceId,
      this.adapterId,
      params.integrationId,
      params.periodoId,
      params.groupKey,
      params.spreadsheetId,
      params.tabName,
      params.raText,
      params.fieldKey,
      actualCellCoordinate,
      actualRawValue,
      actualNormalizedValue ?? 'NULL',
      actualHeaderFingerprint,
      timestamp,
    ].join('|');

    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(canonicalString));
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // 5. Assinatura criptográfica HMAC do adaptador (se fornecida a chave do adaptador)
    let adapterSignature: string | undefined;
    if (params.adapterSecret) {
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(params.adapterSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(contentHash));
      adapterSignature = Array.from(new Uint8Array(sigBytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    return {
      evidenceId,
      sourceAdapterId: this.adapterId,
      integrationId: params.integrationId,
      periodoId: params.periodoId,
      groupKey: params.groupKey,
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      raText: params.raText,
      fieldKey: params.fieldKey,
      cellCoordinate: actualCellCoordinate,
      rawValue: actualRawValue,
      normalizedValue: actualNormalizedValue,
      readTimestamp: timestamp,
      headerFingerprint: actualHeaderFingerprint,
      contentHash,
      adapterSignature,
    };
  }
}

