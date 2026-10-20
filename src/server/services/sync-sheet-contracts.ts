/**
 * ============================================================================
 * F2 — Contratos e Interfaces de Adaptadores (F2.2)
 * ============================================================================
 * Define interfaces e validações para:
 *  - Leitura de snapshots das abas de controle (C:I) com layout estrutural.
 *  - Leitura das abas gerais (situação contratual) exclusivamente via coluna A e RA coluna G.
 *  - Evidência completa de proveniência para estabelecimento de baseline.
 *  - Contrato de pré-condições de escrita contra sobrescrita de edições humanas.
 *  - Verificação de efeito externo (verifyExternalEffect).
 */

import type { FieldKey, GroupKey } from './sync-d1-core';
import type { OperationTargetKey } from './sync-d1-operations';

/**
 * 7 Colunas Documentais C:I da Aba de Controle
 * C: RG / Identidade
 * D: CPF
 * E: Certidão de Nascimento / Casamento
 * F: Comprovante de Residência
 * G: Título de Eleitor
 * H: Histórico / Certificado de Ensino Médio
 * I: Contrato de Prestação de Serviços Educacionais
 */
export const CONTROL_DOC_COLUMNS: readonly FieldKey[] = [
  'identidade',
  'cpf_documento',
  'certidao',
  'residencia',
  'titulo',
  'ensino_medio',
  'contrato',
] as const;

export const FIELD_TO_CONTROL_COLUMN_INDEX: Record<FieldKey, number> = {
  identidade: 2,    // Coluna C (0-indexed: 2)
  cpf_documento: 3, // Coluna D (0-indexed: 3)
  certidao: 4,      // Coluna E (0-indexed: 4)
  residencia: 5,    // Coluna F (0-indexed: 5)
  titulo: 6,        // Coluna G (0-indexed: 6)
  ensino_medio: 7,  // Coluna H (0-indexed: 7)
  contrato: 8,      // Coluna I (0-indexed: 8)
};

export const CONTROL_COLUMN_LETTERS: Record<FieldKey, string> = {
  identidade: 'C',
  cpf_documento: 'D',
  certidao: 'E',
  residencia: 'F',
  titulo: 'G',
  ensino_medio: 'H',
  contrato: 'I',
};

/**
 * Canonical Fingerprint dos cabeçalhos das 7 colunas C:I.
 */
export const EXPECTED_CONTROL_HEADERS = [
  'IDENTIDADE',
  'CPF',
  'CERTIDÃO',
  'COMP. RESIDÊNCIA',
  'TÍTULO',
  'ENSINO MÉDIO',
  'CONTRATO',
];

/**
 * Normalização determinística dos valores de células documentais.
 * - 'ENTREGUE', 'OK', 'SIM', '1', 'TRUE' -> 1
 * - 'PENDENTE', 'NÃO', 'FALTA', '0', 'FALSE' -> 0
 * - Vazio, '-' ou texto não mapeável -> null (desconhecido / UNBASELINED)
 */
export function normalizeDocumentCellValue(rawValue: unknown): 0 | 1 | null {
  if (rawValue === null || rawValue === undefined) return null;
  const str = String(rawValue).trim().toUpperCase();
  if (['1', 'SIM', 'S', 'ENTREGUE', 'OK', 'TRUE', 'CONFIRMADO', 'ENVIADO'].includes(str)) {
    return 1;
  }
  if (['0', 'NAO', 'NÃO', 'N', 'PENDENTE', 'FALTA', 'FALSE', 'RECUSADO'].includes(str)) {
    return 0;
  }
  return null;
}

/**
 * Normalização da Situação Contratual (Coluna A das abas gerais).
 * - Apenas 'ACEITO', 'ASSINADO', 'DEFERIDO', 'CONFIRMADO' -> 1
 * - 'PENDENTE', 'NÃO ASSINADO', 'INDEFERIDO', 'RECUSADO' -> 0
 * - Qualquer outro texto ou vazio -> null
 */
export function normalizeContractCellValue(rawValue: unknown): 0 | 1 | null {
  if (rawValue === null || rawValue === undefined) return null;
  const str = String(rawValue).trim().toUpperCase();
  if (['ACEITO', 'ASSINADO', 'DEFERIDO', 'CONFIRMADO', 'OK', 'SIM', '1', 'ENTREGUE'].includes(str)) {
    return 1;
  }
  if (['PENDENTE', 'NAO ASSINADO', 'NÃO ASSINADO', 'INDEFERIDO', 'RECUSADO', '0', 'NAO ENTREGUE', 'NÃO ENTREGUE'].includes(str)) {
    return 0;
  }
  return null;
}

/**
 * Evidência de proveniência completa (Condição 4 da aprovação).
 */
export interface ProvenanceEvidence {
  evidenceId: string;
  sourceAdapterId: string;
  spreadsheetId: string;
  tabName: string;
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  raText: string;
  fieldKey: FieldKey;
  cellCoordinate: string; // Ex: 'C15' ou 'A23'
  rawValue: string;
  normalizedValue: 0 | 1 | null;
  readTimestamp: string;  // ISO UTC
  headerFingerprint: string;
  contentHash: string;   // SHA-256 canônico dos metadados observados
  adapterSignature?: string; // Assinatura HMAC criptográfica emitida pelo adaptador autorizado
}

/**
 * Snapshot de uma linha de controle (Aba FACE_FEA ou FCH_EAD).
 */
export interface ControlRowSnapshot {
  rowIndex: number;
  raText: string;
  studentName?: string;
  fields: Record<FieldKey, {
    rawValue: string;
    normalizedValue: 0 | 1 | null;
    cellCoordinate: string;
  }>;
}

export interface ControlTabReadResult {
  spreadsheetId: string;
  tabName: string;
  groupKey: GroupKey;
  headerFingerprint: string;
  readAt: string;
  rowsByRa: Map<string, ControlRowSnapshot>;
  duplicateRas?: string[];
}

/**
 * Snapshot de leitura da Aba Geral (Situação Contratual, Col A via RA Col G).
 */
export interface GeneralContractRowSnapshot {
  rowIndex: number;
  raText: string;
  contractRawValue: string;
  contractNormalizedValue: 0 | 1 | null;
  cellCoordinate: string; // Ex: 'A45'
}

export interface GeneralTabReadResult {
  spreadsheetId: string;
  tabName: string;
  headerFingerprint: string;
  readAt: string;
  rowsByRa: Map<string, GeneralContractRowSnapshot>;
}

/**
 * Precondições de Escrita Segura (C4).
 * Distingue estritamente valor observado de versão/snapshot comprovado.
 * Sobrescrita arbitrária (allowHumanOverwrite) foi terminantemente removida.
 */
export interface WritePreconditions {
  targetKey: OperationTargetKey;
  expectedCurrentValue: 0 | 1 | null; // Valor que a planilha deve conter antes de escrever
  targetValue: 0 | 1;
  targetRevision: number;
  operationId: string;
  expectedSnapshotHash?: string;      // Hash do snapshot de leitura para detectar mutações intermediárias
}

export interface WriteResult {
  success: boolean;
  status:
    | 'COMMITTED'
    | 'CONFLICT_DETECTED'
    | 'OUT_OF_BOUNDS'
    | 'LAYOUT_MUTATED'
    | 'STUDENT_NOT_FOUND'
    | 'AMBIGUOUS_IDENTITY';
  cellCoordinate?: string;
  observedValue?: string;
  error?: string;
}

/**
 * Resultado da Verificação de Efeito Externo.
 */
export interface ExternalEffectCheckResult {
  effectObserved: boolean;
  isAbsentConfirmed: boolean;
  currentRawValue: string | null;
  currentNormalizedValue: 0 | 1 | null;
  inspectedAt: string;
  cellCoordinate?: string;
}

/**
 * Contrato de Adaptador de Planilha (Interface Formal).
 */
export interface ISyncSpreadsheetAdapter {
  readonly adapterId: string;

  /**
   * Lê a aba de controle especificada, validando rigorosamente o layout C:I.
   */
  readControlTab(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
  }): Promise<ControlTabReadResult>;

  /**
   * Lê exclusivamente a Situação Contratual (Coluna A) usando RA (Coluna G).
   */
  readGeneralTabContracts(params: {
    spreadsheetId: string;
    tabName: string;
  }): Promise<GeneralTabReadResult>;

  /**
   * Escreve exclusivamente nas colunas documentais autorizadas C:I (Aba de Controle)
   * ou Coluna A (Aba Geral para targetKey === 'GERAL_CONTRATO').
   * Bloqueia terminantemente qualquer escrita em outras colunas ou posições arbitrárias.
   */
  writeDocumentField(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    preconditions: WritePreconditions;
  }): Promise<WriteResult>;

  /**
   * Verifica se o efeito de uma operação já se encontra materializado na planilha externa.
   */
  verifyExternalEffect(params: {
    spreadsheetId: string;
    tabName: string;
    groupKey: GroupKey;
    raText: string;
    fieldKey: FieldKey;
    targetKey: OperationTargetKey;
    expectedTargetValue: 0 | 1;
  }): Promise<ExternalEffectCheckResult>;

  /**
   * Gera uma evidência formal de proveniência para uma leitura observada.
   */
  generateProvenanceEvidence(params: {
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
  }): Promise<ProvenanceEvidence>;
}

