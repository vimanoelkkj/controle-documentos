/**
 * ============================================================================
 * F4-A — Adaptador Real Google Sheets para Sincronização V2
 * ============================================================================
 * Implementa ISyncSpreadsheetAdapter conectando o núcleo da V2 à API REST v4
 * do Google Sheets com:
 *  - Leitura estrutural estrita:
 *      * CONTROLE: Faixa A1:I (preservando fórmulas J/K intocadas)
 *      * GERAL_CONTRATO: Faixa A1:G (Coluna A situação, Coluna G RA)
 *  - Preservação estrita de RA textual com zeros à esquerda (FORMATTED_VALUE).
 *  - Validação canônica de layout de cabeçalhos (rejeição por LAYOUT_MUTATED).
 *  - Detecção de registros ausentes e duplicidades/ambiguidades de RA.
 *  - Operações de escrita restritas a célula única autorizada (single-cell mutation).
 *  - Verificação de estado remoto prévia à escrita (Read-Before-Write CAS).
 *  - Prevenção ativa de sobrescrita de edições humanas (CONFLICT_DETECTED).
 *  - Tratamento de incerteza de rede com verificação pós-falha (Network Uncertainty).
 *  - Bloqueio estrito de escrita fora dos limites (OUT_OF_BOUNDS).
 *  - Emissão de evidência criptográfica de proveniência (HMAC SHA-256).
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import type { OperationTargetKey } from './sync-d1-operations';
import {
  CONTROL_DOC_COLUMNS,
  FIELD_TO_CONTROL_COLUMN_INDEX,
  CONTROL_COLUMN_LETTERS,
  validateControlHeadersRow,
  normalizeHeaderString,
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

export class GoogleSheetsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsAuthError';
  }
}

export class GoogleSheetsReadOnlyError extends Error {
  constructor(message = 'Operações de escrita bloqueadas: adaptador Google Sheets em modo somente leitura (SHADOW/READ_ONLY).') {
    super(message);
    this.name = 'GoogleSheetsReadOnlyError';
  }
}

export class GoogleSheetsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsNotFoundError';
  }
}

export class GoogleSheetsRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsRateLimitError';
  }
}

export class GoogleSheetsNetworkError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain = false) {
    super(message);
    this.name = 'GoogleSheetsNetworkError';
    this.uncertain = uncertain;
  }
}

export class GoogleSheetsLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsLayoutError';
  }
}

/**
 * Calcula um hash canônico determinístico para o conteúdo de uma célula e seu layout.
 * Usado para detectar mutações intermediárias entre snapshot e escrita (C4).
 */
export function computeCellSnapshotHash(
  cellCoordinate: string,
  rawValue: string,
  fingerprint: string
): string {
  let h = 0x811c9dc5;
  const str = cellCoordinate + ':' + rawValue + ':' + fingerprint;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface GoogleSheetsRealAdapterOptions {
  adapterId?: string;
  tokenProvider?: () => Promise<string>;
  serviceAccountJson?: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  adapterSecret?: string;
  readOnly?: boolean;
}

export class GoogleSheetsRealAdapter implements ISyncSpreadsheetAdapter {
  readonly adapterId: string;
  readonly readOnly: boolean;
  private readonly tokenProvider?: () => Promise<string>;
  private readonly serviceAccountJson?: string;
  private readonly fetchFn: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly adapterSecret: string;

  constructor(options: GoogleSheetsRealAdapterOptions = {}) {
    this.adapterId = options.adapterId || 'google-sheets-real-adapter-v2';
    this.readOnly = options.readOnly ?? false;
    this.tokenProvider = options.tokenProvider;
    this.serviceAccountJson = options.serviceAccountJson;
    this.fetchFn = options.fetchFn || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : globalThis.fetch);
    this.requestTimeoutMs = options.requestTimeoutMs || 15000;
    this.adapterSecret = options.adapterSecret || 'default-adapter-secret-v2';
  }

  // ==========================================================================
  // AUTENTICAÇÃO E TRANSPORTE HTTP
  // ==========================================================================

  private async getAccessToken(): Promise<string> {
    if (this.tokenProvider) {
      return this.tokenProvider();
    }
    if (this.serviceAccountJson) {
      return this.generateServiceAccountToken(this.serviceAccountJson);
    }
    // Em ambiente de teste mockado, pode usar token dummy
    return 'mock-google-access-token';
  }

  private async generateServiceAccountToken(serviceAccountJson: string): Promise<string> {
    type GoogleServiceAccount = {
      client_email: string;
      private_key: string;
      token_uri?: string;
    };
    const conta = JSON.parse(serviceAccountJson) as GoogleServiceAccount;
    const agora = Math.floor(Date.now() / 1000);

    const base64Url = (valor: ArrayBuffer | string) => {
      const bytes = typeof valor === 'string' ? new TextEncoder().encode(valor) : new Uint8Array(valor);
      let binario = '';
      for (const byte of bytes) binario += String.fromCharCode(byte);
      return btoa(binario).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    };

    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64Url(
      JSON.stringify({
        iss: conta.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: conta.token_uri || 'https://oauth2.googleapis.com/token',
        iat: agora,
        exp: agora + 3600,
      })
    );

    const pemParaArrayBuffer = (pem: string) => {
      const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
      const binario = atob(base64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      return bytes.buffer;
    };

    const chave = await crypto.subtle.importKey(
      'pkcs8',
      pemParaArrayBuffer(conta.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const assinatura = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      chave,
      new TextEncoder().encode(`${header}.${payload}`)
    );

    const jwt = `${header}.${payload}.${base64Url(assinatura)}`;
    const resposta = await this.fetchFn(conta.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!resposta.ok) {
      throw new GoogleSheetsAuthError(`Falha na autenticação Google Service Account (${resposta.status})`);
    }

    const dados = (await resposta.json()) as { access_token: string };
    return dados.access_token;
  }

  private async fetchSheetsApi(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const res = await this.fetchFn(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => '');
        throw new GoogleSheetsAuthError(`Google Sheets Auth Error (${res.status}): ${text.slice(0, 200)}`);
      }
      if (res.status === 404) {
        const text = await res.text().catch(() => '');
        throw new GoogleSheetsNotFoundError(`Google Sheets Resource Not Found (404): ${text.slice(0, 200)}`);
      }
            if (res.status >= 500) {
        const text = await res.text().catch(() => '');
        throw new GoogleSheetsNetworkError('Google Sheets Server Error (' + res.status + '): ' + text.slice(0, 200), true);
      }
      if (res.status === 429) {
        const text = await res.text().catch(() => '');
        throw new GoogleSheetsRateLimitError(`Google Sheets API Rate Limit Exceeded (429): ${text.slice(0, 200)}`);
      }

      return res;
    } catch (err: any) {
      if (err instanceof GoogleSheetsAuthError || err instanceof GoogleSheetsNotFoundError || err instanceof GoogleSheetsRateLimitError) {
        throw err;
      }
      throw new GoogleSheetsNetworkError(`Falha de rede/timeout na comunicação com Google Sheets: ${err?.message || err}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // VALIDAÇÕES DE CABEÇALHO
  // ==========================================================================

  private validateControlHeaders(headers: string[]): { valid: true; fingerprint: string } | { valid: false; error: string } {
    return validateControlHeadersRow(headers);
  }

  private validateGeneralHeaders(headers: string[]): { valid: true; fingerprint: string } | { valid: false; error: string } {
    if (headers.length < 7) {
      return { valid: false, error: 'Aba geral possui menos de 7 colunas (esperado A e G)' };
    }
    const colAHeader = normalizeHeaderString(headers[0] || '');
    const colGHeader = normalizeHeaderString(headers[6] || '');
    if (!colAHeader.includes('SITUAC') && !colAHeader.includes('CONTRAT')) {
      return { valid: false, error: `STRUCTURAL_LAYOUT_MUTATED: Coluna A da aba geral '${headers[0]}' não é situação contratual` };
    }
    if (!colGHeader.includes('RA') && !colGHeader.includes('REGISTRO') && !colGHeader.includes('MATRICULA')) {
      return { valid: false, error: `STRUCTURAL_LAYOUT_MUTATED: Coluna G da aba geral '${headers[6]}' não é RA` };
    }
    return { valid: true, fingerprint: `${String(headers[0] || '').trim()}::${String(headers[6] || '').trim()}` };
  }

  // ==========================================================================
  // LEITURA DE SNAPSHOTS
  // ==========================================================================

  /**
   * Lê a aba de controle especificada no range A1:I.
   * Não lê e não toca nas colunas J e K (fórmulas e contadores).
   * Preserva estritamente zeros à esquerda do RA usando FORMATTED_VALUE.
   */
  async readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult> {
    const rangeParam = `'${params.tabName.replace(/'/g, "''")}'!A1:I`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      params.spreadsheetId
    )}/values/${encodeURIComponent(rangeParam)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;

    const res = await this.fetchSheetsApi(url);
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Google Sheets HTTP ${res.status}: ${detalhe.slice(0, 240)}`);
    }

    const data = (await res.json()) as { values?: unknown[][] };
    const rawRows = data.values || [];

    if (rawRows.length < 1) {
      throw new GoogleSheetsLayoutError(`Aba '${params.tabName}' está vazia ou sem cabeçalho`);
    }

    // Validação da linha 1 (cabeçalhos)
    const headerRow = (rawRows[0] || []).map(c => String(c ?? ''));
    const headerCheck = this.validateControlHeaders(headerRow);
    if (!headerCheck.valid) {
      throw new GoogleSheetsLayoutError(headerCheck.error);
    }

    const rowsByRa = new Map<string, ControlRowSnapshot>();
    const duplicateRas = new Set<string>();

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] || [];
      const rowIndex = i + 1; // 1-indexed

      const rawRa = String(row[0] ?? '').trim();
      if (!rawRa) continue;

      const raRes = validateCanonicalRa(rawRa);
      if (!raRes.valid) continue;

      const raText = raRes.raText;
      if (rowsByRa.has(raText)) {
        duplicateRas.add(raText);
        continue;
      }

      const studentName = String(row[1] ?? '').trim();
      const fields: ControlRowSnapshot['fields'] = {} as any;

      for (const fieldKey of CONTROL_DOC_COLUMNS) {
        const colIdx = FIELD_TO_CONTROL_COLUMN_INDEX[fieldKey];
        const colLetter = CONTROL_COLUMN_LETTERS[fieldKey];
        const rawValue = String(row[colIdx] ?? '').trim();
        const normalizedValue = normalizeDocumentCellValue(rawValue);
        fields[fieldKey] = {
          rawValue,
          normalizedValue,
          cellCoordinate: `${colLetter}${rowIndex}`,
        };
      }

      rowsByRa.set(raText, {
        rowIndex,
        raText,
        studentName,
        fields,
      });
    }

    // Se houve duplicidades, remove do mapa para marcar ambiguidade segura
    for (const dupRa of duplicateRas) {
      rowsByRa.delete(dupRa);
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      groupKey: params.groupKey,
      headerFingerprint: headerCheck.fingerprint,
      readAt: new Date().toISOString(),
      rowsByRa,
      duplicateRas: Array.from(duplicateRas),
    };
  }

  /**
   * Lê exclusivamente a Situação Contratual (Coluna A) usando RA (Coluna G).
   * Range A1:G usando FORMATTED_VALUE.
   */
  async readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult> {
    const rangeParam = `'${params.tabName.replace(/'/g, "''")}'!A1:G`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      params.spreadsheetId
    )}/values/${encodeURIComponent(rangeParam)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;

    const res = await this.fetchSheetsApi(url);
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Google Sheets HTTP ${res.status}: ${detalhe.slice(0, 240)}`);
    }

    const data = (await res.json()) as { values?: unknown[][] };
    const rawRows = data.values || [];

    if (rawRows.length < 1) {
      throw new GoogleSheetsLayoutError(`Aba geral '${params.tabName}' está vazia ou sem cabeçalho`);
    }

    const headerRow = (rawRows[0] || []).map(c => String(c ?? ''));
    const headerCheck = this.validateGeneralHeaders(headerRow);
    if (!headerCheck.valid) {
      throw new GoogleSheetsLayoutError(headerCheck.error);
    }

    const rowsByRa = new Map<string, GeneralContractRowSnapshot>();
    const duplicateRas = new Set<string>();

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] || [];
      const rowIndex = i + 1;

      const rawRa = String(row[6] ?? '').trim();
      if (!rawRa) continue;

      const raRes = validateCanonicalRa(rawRa);
      if (!raRes.valid) continue;

      const raText = raRes.raText;
      if (rowsByRa.has(raText)) {
        duplicateRas.add(raText);
        continue;
      }

      const contractRawValue = String(row[0] ?? '').trim();
      const contractNormalizedValue = normalizeContractCellValue(contractRawValue);

      rowsByRa.set(raText, {
        rowIndex,
        raText,
        contractRawValue,
        contractNormalizedValue,
        cellCoordinate: `A${rowIndex}`,
      });
    }

    for (const dupRa of duplicateRas) {
      rowsByRa.delete(dupRa);
    }

    return {
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      headerFingerprint: headerCheck.fingerprint,
      readAt: new Date().toISOString(),
      rowsByRa,
    };
  }

  // ==========================================================================
  // ESCRITA CIRÚRGICA COM CAS E VERIFICAÇÃO PRÉVIA
  // ==========================================================================

  /**
   * Escreve exclusivamente na célula autorizada de uma linha identificada por RA.
   * Não sobrescreve linhas inteiras.
   * Executa Read-Before-Write CAS para prevenir conflito com edições humanas.
   */
  async writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    preconditions: WritePreconditions;
  }): Promise<WriteResult> {
    // 0. Bloqueio estrito de modo somente leitura (SHADOW/READ_ONLY)
    if (this.readOnly) {
      return {
        success: false,
        status: 'OUT_OF_BOUNDS',
        error: 'WRITE_BLOCKED_IN_READ_ONLY_MODE: Adaptador configurado em modo somente leitura. Escrita no Google Sheets estritamente bloqueada.',
      };
    }

    const isControl = params.preconditions.targetKey === 'CONTROLE';

    // 1. Verificação de limites de coluna (Bounds Check)
    if (isControl) {
      if (!CONTROL_DOC_COLUMNS.includes(params.fieldKey)) {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: `Campo '${params.fieldKey}' não pertence às 7 colunas documentais C:I da aba de controle`,
        };
      }
    } else {
      if (params.fieldKey !== 'contrato') {
        return {
          success: false,
          status: 'OUT_OF_BOUNDS',
          error: `Aba geral permite exclusivamente escrita na coluna A referente ao campo 'contrato'`,
        };
      }
    }

    // 2. Leitura do estado remoto atual imediatamente antes da mutação (Read-Before-Write CAS)
    let cellCoordinate: string;
    let currentRaw: string;
    let currentNormalized: 0 | 1 | null;

    if (isControl) {
      let controlRead: ControlTabReadResult;
      try {
        controlRead = await this.readControlTab({
          spreadsheetId: params.spreadsheetId,
          tabName: params.tabName,
          groupKey: params.groupKey,
        });
      } catch (err: any) {
        if (err instanceof GoogleSheetsLayoutError) {
          return { success: false, status: 'LAYOUT_MUTATED', error: err.message };
        }
        throw err;
      }

      const row = controlRead.rowsByRa.get(params.raText);
      if (!row) {
        return {
          success: false,
          status: 'STUDENT_NOT_FOUND',
          error: `Aluno RA '${params.raText}' não encontrado ou ambíguo na aba '${params.tabName}'`,
        };
      }

      const fieldData = row.fields[params.fieldKey];
      cellCoordinate = fieldData.cellCoordinate;
      currentRaw = fieldData.rawValue;
      currentNormalized = fieldData.normalizedValue;
    } else {
      let generalRead: GeneralTabReadResult;
      try {
        generalRead = await this.readGeneralTabContracts({
          spreadsheetId: params.spreadsheetId,
          tabName: params.tabName,
        });
      } catch (err: any) {
        if (err instanceof GoogleSheetsLayoutError) {
          return { success: false, status: 'LAYOUT_MUTATED', error: err.message };
        }
        throw err;
      }

      const row = generalRead.rowsByRa.get(params.raText);
      if (!row) {
        return {
          success: false,
          status: 'STUDENT_NOT_FOUND',
          error: `Aluno RA '${params.raText}' não encontrado ou ambíguo na aba geral '${params.tabName}'`,
        };
      }

      cellCoordinate = row.cellCoordinate;
      currentRaw = row.contractRawValue;
      currentNormalized = row.contractNormalizedValue;
    }

    // 3. Verificação de CAS contra edições humanas (Optimistic Read-Before-Write Check)
    // NOTA ARQUITETURAL: A API REST v4 do Google Sheets não fornece primitivas nativas
    // de transação ACID ou Compare-And-Swap (CAS) atômico condicional a nível de célula individual.
    // O mecanismo executa verificação prévia otimista para prevenir sobrescrita de modificações
    // humanas anteriores à requisição, mas existe janela de concorrência inerente à chamada HTTP.
    if (params.preconditions.expectedCurrentValue !== undefined) {
      if (currentNormalized !== params.preconditions.expectedCurrentValue) {
        return {
          success: false,
          status: 'CONFLICT_DETECTED',
          cellCoordinate,
          observedValue: currentRaw,
          error: `Valor remoto atual (${currentNormalized ?? 'null'}) difere do esperado (${params.preconditions.expectedCurrentValue})`,
        };
      }
    }

    // 4. Verificação de versão/snapshot hash intermediário (C4)
    if (params.preconditions.expectedSnapshotHash) {
      const observedHash = computeCellSnapshotHash(
        cellCoordinate,
        currentRaw,
        isControl ? 'CONTROLE' : 'GERAL'
      );
      if (
        params.preconditions.expectedSnapshotHash !== observedHash &&
        params.preconditions.expectedSnapshotHash !== currentRaw
      ) {
        return {
          success: false,
          status: 'CONFLICT_DETECTED',
          cellCoordinate,
          observedValue: currentRaw,
          error: `Mutação intermediária detectada entre snapshot e escrita (hash esperado ${params.preconditions.expectedSnapshotHash} !== ${observedHash})`,
        };
      }
    }

    // 4. Idempotência: se a célula já se encontra no valor desejado (targetValue), confirma sucesso sem emitir PUT
    if (currentNormalized === params.preconditions.targetValue) {
      return {
        success: true,
        status: 'COMMITTED',
        cellCoordinate,
        observedValue: currentRaw,
      };
    }

    // 5. Execução da mutação estritamente na célula única autorizada
    // Para abas de controle com checkboxes nativos, escreve booleano real true/false
    const targetValueToWrite = isControl
      ? (params.preconditions.targetValue === 1 ? true : false)
      : (params.preconditions.targetValue === 1 ? 'Entregue' : 'Não Entregue');

    const updateRange = `'${params.tabName.replace(/'/g, "''")}'!${cellCoordinate}`;
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      params.spreadsheetId
    )}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`;

    try {
      const updateRes = await this.fetchSheetsApi(updateUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range: updateRange,
          majorDimension: 'ROWS',
          values: [[targetValueToWrite]],
        }),
      });

      if (!updateRes.ok) {
        const errorText = await updateRes.text().catch(() => '');
        throw new Error(`Falha no update HTTP ${updateRes.status}: ${errorText.slice(0, 200)}`);
      }

      return {
        success: true,
        status: 'COMMITTED',
        cellCoordinate,
        observedValue: targetValueToWrite,
      };
    } catch (err: any) {
      // 5. Tratamento de incerteza de rede: verificação pós-erro
      try {
        const verifyRes = await this.verifyExternalEffect({
          spreadsheetId: params.spreadsheetId,
          tabName: params.tabName,
          groupKey: params.groupKey,
          raText: params.raText,
          fieldKey: params.fieldKey,
          targetKey: params.preconditions.targetKey,
          expectedTargetValue: params.preconditions.targetValue,
        });

        if (verifyRes.effectObserved) {
          return {
            success: true,
            status: 'COMMITTED',
            cellCoordinate,
            observedValue: verifyRes.currentRawValue || targetValueToWrite,
          };
        }
      } catch {
        // Se a própria verificação falhar, o estado é comprovadamente incerto
      }

      throw new GoogleSheetsNetworkError(
        `Erro de rede durante escrita da célula ${cellCoordinate}. Estado da planilha externo permanece incerto: ${err?.message || err}`,
        true
      );
    }
  }

  // ==========================================================================
  // VERIFICAÇÃO DE EFEITO EXTERNO E PROVENIÊNCIA
  // ==========================================================================

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
    const isControl = params.targetKey === 'CONTROLE';

    if (isControl) {
      const readRes = await this.readControlTab({
        spreadsheetId: params.spreadsheetId,
        tabName: params.tabName,
        groupKey: params.groupKey,
      });

      const row = readRes.rowsByRa.get(params.raText);
      if (!row) {
        // C3: Aluno ausente ou ambíguo NÃO comprova conclusivamente ausência de efeito na planilha
        return {
          effectObserved: false,
          isAbsentConfirmed: false,
          currentRawValue: null,
          currentNormalizedValue: null,
          inspectedAt: nowIso,
        };
      }

      const fieldData = row.fields[params.fieldKey];
      const effectObserved = fieldData.normalizedValue === params.expectedTargetValue;
      // C3: A confirmação de ausência (isAbsentConfirmed) só é verdadeira quando a célula
      // possui um valor normalizado conclusivo (0 ou 1) que é comprovadamente OPOSTO ao esperado.
      const isAbsentConfirmed =
        fieldData.normalizedValue !== null && fieldData.normalizedValue !== params.expectedTargetValue;

      return {
        effectObserved,
        isAbsentConfirmed,
        currentRawValue: fieldData.rawValue,
        currentNormalizedValue: fieldData.normalizedValue,
        cellCoordinate: fieldData.cellCoordinate,
        inspectedAt: nowIso,
      };
    } else {
      const readRes = await this.readGeneralTabContracts({
        spreadsheetId: params.spreadsheetId,
        tabName: params.tabName,
      });

      const row = readRes.rowsByRa.get(params.raText);
      if (!row) {
        // C3: Aluno ausente ou ambíguo NÃO comprova conclusivamente ausência de efeito na planilha
        return {
          effectObserved: false,
          isAbsentConfirmed: false,
          currentRawValue: null,
          currentNormalizedValue: null,
          inspectedAt: nowIso,
        };
      }

      const effectObserved = row.contractNormalizedValue === params.expectedTargetValue;
      const isAbsentConfirmed =
        row.contractNormalizedValue !== null && row.contractNormalizedValue !== params.expectedTargetValue;

      return {
        effectObserved,
        isAbsentConfirmed,
        currentRawValue: row.contractRawValue,
        currentNormalizedValue: row.contractNormalizedValue,
        cellCoordinate: row.cellCoordinate,
        inspectedAt: nowIso,
      };
    }
  }

  async generateProvenanceEvidence(params: {
    integrationId: string;
    periodoId: number;
    groupKey: GroupKey;
    spreadsheetId: string;
    tabName: string;
    raText: string;
    fieldKey: FieldKey;
    cellCoordinate: string;
    rawValue: string;
    normalizedValue: 0 | 1 | null;
    headerFingerprint: string;
    readTimestamp?: string;
  }): Promise<ProvenanceEvidence> {
    if (!this.adapterSecret || this.adapterSecret.length < 8) {
      throw new GoogleSheetsAuthError('AdapterSecret não configurado ou muito curto para assinatura criptográfica de proveniência');
    }
    const timestamp = params.readTimestamp || new Date().toISOString();
    const evidenceId = `evid_${crypto.randomUUID()}`;

    const canonicalData = [
      evidenceId,
      this.adapterId,
      params.spreadsheetId,
      params.tabName,
      params.integrationId,
      params.periodoId,
      params.groupKey,
      params.raText,
      params.fieldKey,
      params.cellCoordinate,
      params.rawValue,
      params.normalizedValue === null ? 'null' : String(params.normalizedValue),
      params.headerFingerprint,
      timestamp,
    ].join('|');

    // SHA-256 do conteúdo
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalData));
    const contentHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Assinatura HMAC SHA-256 do adaptador
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.adapterSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(contentHash));
    const adapterSignature = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      evidenceId,
      sourceAdapterId: this.adapterId,
      spreadsheetId: params.spreadsheetId,
      tabName: params.tabName,
      integrationId: params.integrationId,
      periodoId: params.periodoId,
      groupKey: params.groupKey,
      raText: params.raText,
      fieldKey: params.fieldKey,
      cellCoordinate: params.cellCoordinate,
      rawValue: params.rawValue,
      normalizedValue: params.normalizedValue,
      readTimestamp: timestamp,
      headerFingerprint: params.headerFingerprint,
      contentHash,
      adapterSignature,
    };
  }
}
