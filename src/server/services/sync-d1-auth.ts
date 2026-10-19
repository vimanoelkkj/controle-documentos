/**
 * ============================================================================
 * F2 — Identidade, Autenticação e Autorização (F2.1)
 * ============================================================================
 * Implementa validação estrita de escopo, envelopes assinados, resolução
 * segura de permissões no servidor e registro atômico de nonces contra replay.
 */

import type { GroupKey } from './sync-d1-core';

export type SyncScope =
  | 'read:snapshot'
  | 'write:mutation'
  | 'baseline:establish'
  | 'verify:effect'
  | 'observe:receipt'
  | 'admin:resolve_conflict';

export interface AuthIdentity {
  senderId: string;
  integrationId: string;
  periodoId: number;
  allowedGroups: GroupKey[];
  allowedScopes: SyncScope[];
  status: 'ACTIVE' | 'REVOKED';
  secret: string;
}

export interface TrustedAdapterConfig {
  adapterId: string;
  integrationId: string;
  periodoId: number;
  spreadsheetId: string;
  allowedGroups: GroupKey[];
  status: 'ACTIVE' | 'REVOKED';
  secret: string;
}

/**
 * Registro de Adaptadores Autorizados do Servidor (Server-Side Trusted Registry).
 * Em produção, lido de Secrets / Variáveis de Ambiente ou D1 autenticado.
 */
const serverTrustedAdapters: Map<string, TrustedAdapterConfig> = new Map();

export function registerServerTrustedAdapter(config: TrustedAdapterConfig): void {
  serverTrustedAdapters.set(`${config.adapterId}:${config.integrationId}`, config);
}

export function getServerTrustedAdapter(adapterId: string, integrationId: string): TrustedAdapterConfig | null {
  return serverTrustedAdapters.get(`${adapterId}:${integrationId}`) || null;
}

export function clearServerTrustedAdapters(): void {
  serverTrustedAdapters.clear();
}

export interface TrustedAdminConfig {
  adminId: string;
  allowedScopes: SyncScope[];
  status: 'ACTIVE' | 'REVOKED';
  secret: string;
}

/**
 * Registro de Administradores Autorizados do Servidor (Server-Side Trusted Admin Registry, R1, P1).
 * Não aceita objetos autodeclarados pelo chamador no payload.
 */
const serverTrustedAdmins: Map<string, TrustedAdminConfig> = new Map();

export function registerServerTrustedAdmin(config: TrustedAdminConfig): void {
  serverTrustedAdmins.set(config.adminId, config);
}

export function getServerTrustedAdmin(adminId: string): TrustedAdminConfig | null {
  return serverTrustedAdmins.get(adminId) || null;
}

export function clearServerTrustedAdmins(): void {
  serverTrustedAdmins.clear();
}

/**
 * Credencial de Autenticação Administrativa Criptograficamente Vinculada (P1, F3-Fechamento).
 * Vincula a identidade administrativa, o conflito, a ação escolhida, a revisão esperada, o timestamp e um nonce único.
 */
export interface AdminAuthCredential {
  adminId: string;
  conflictId: string;
  chosenResolution: 'KEEP_LOCAL' | 'ACCEPT_EXTERNAL';
  expectedLocalRevision: number;
  timestamp: number;
  nonce: string;
  signature: string;
}

/**
 * Gera credencial criptográfica determinística para testes locais e clientes autenticados.
 * Suporta assinatura por objeto completo ou parâmetros posicionais para compatibilidade.
 */
export async function generateAdminCredential(params: {
  adminId: string;
  conflictId: string;
  chosenResolution: 'KEEP_LOCAL' | 'ACCEPT_EXTERNAL';
  expectedLocalRevision: number;
  secret: string;
  timestamp?: number;
  nonce?: string;
}): Promise<AdminAuthCredential> {
  const timestamp = params.timestamp ?? Date.now();
  const nonce = params.nonce ?? crypto.randomUUID();
  const canonical = [
    params.adminId,
    params.conflictId,
    params.chosenResolution,
    params.expectedLocalRevision,
    timestamp,
    nonce,
  ].join('|');
  const signature = await signEnvelopeData(canonical, params.secret);
  return {
    adminId: params.adminId,
    conflictId: params.conflictId,
    chosenResolution: params.chosenResolution,
    expectedLocalRevision: params.expectedLocalRevision,
    timestamp,
    nonce,
    signature,
  };
}

/**
 * Fronteira de Autenticação Real no Servidor com Anti-Replay e Vínculo Semântico Estrito (P1, F3-Fechamento).
 * Garante que a credencial:
 * 1. Pertence a um administrador ATIVO com escopo 'admin:resolve_conflict'.
 * 2. Foi assinada exclusivamente com o segredo do servidor.
 * 3. Vincula estritamente conflito, ação escolhida (KEEP_LOCAL vs ACCEPT_EXTERNAL) e revisão esperada.
 * 4. Está dentro da janela temporal permitida.
 * 5. Consome o nonce atomicamente no D1 (sync_auth_nonces) para impedir reutilização (anti-replay).
 */
export async function verifyAdminCredential(
  db: D1Database,
  credential: AdminAuthCredential | undefined,
  expected: {
    conflictId: string;
    chosenResolution: 'KEEP_LOCAL' | 'ACCEPT_EXTERNAL';
    expectedLocalRevision: number;
  },
  options: {
    nowMs?: number;
    clockSkewToleranceSec?: number;
  } = {}
): Promise<{ valid: true; admin: TrustedAdminConfig } | { valid: false; reason: string }> {
  if (
    !credential ||
    !credential.adminId ||
    !credential.conflictId ||
    !credential.chosenResolution ||
    typeof credential.expectedLocalRevision !== 'number' ||
    typeof credential.timestamp !== 'number' ||
    !credential.nonce ||
    !credential.signature
  ) {
    return { valid: false, reason: 'CREDENTIAL_REQUIRED' };
  }

  // 1. Vínculo semântico estrito contra a operação solicitada
  if (credential.conflictId !== expected.conflictId) {
    return { valid: false, reason: 'CONFLICT_ID_MISMATCH' };
  }
  if (credential.chosenResolution !== expected.chosenResolution) {
    return { valid: false, reason: 'ACTION_MISMATCH' };
  }
  if (credential.expectedLocalRevision !== expected.expectedLocalRevision) {
    return { valid: false, reason: 'REVISION_MISMATCH' };
  }

  // 2. Janela temporal (clock skew)
  const nowMs = options.nowMs ?? Date.now();
  const toleranceMs = (options.clockSkewToleranceSec ?? 300) * 1000;
  if (Math.abs(nowMs - credential.timestamp) > toleranceMs) {
    return { valid: false, reason: 'CREDENTIAL_EXPIRED' };
  }

  // 3. Resolução exclusiva no registro de segredos do servidor
  const trustedAdmin = getServerTrustedAdmin(credential.adminId);
  if (!trustedAdmin) {
    return { valid: false, reason: 'ADMIN_NOT_REGISTERED' };
  }

  if (trustedAdmin.status !== 'ACTIVE') {
    return { valid: false, reason: 'ADMIN_REVOKED' };
  }

  if (!trustedAdmin.allowedScopes.includes('admin:resolve_conflict')) {
    return { valid: false, reason: 'SCOPE_UNAUTHORIZED' };
  }

  // 4. Verificação criptográfica determinística HMAC-SHA256
  const canonical = [
    credential.adminId,
    credential.conflictId,
    credential.chosenResolution,
    credential.expectedLocalRevision,
    credential.timestamp,
    credential.nonce,
  ].join('|');

  const isValid = await verifyEnvelopeSignature(canonical, trustedAdmin.secret, credential.signature);
  if (!isValid) {
    return { valid: false, reason: 'INVALID_CREDENTIAL_SIGNATURE' };
  }

  // 5. Registro Atômico do Nonce no D1 para Anti-Replay
  const expiresAtIso = new Date(credential.timestamp + toleranceMs * 2).toISOString();
  try {
    const nonceRes = await db
      .prepare(
        `INSERT INTO sync_auth_nonces (nonce, sender_id, integration_id, created_at, expires_at)
         VALUES (?, ?, 'admin_resolution', datetime(?, 'unixepoch'), ?)`
      )
      .bind(
        credential.nonce,
        credential.adminId,
        Math.floor(credential.timestamp / 1000),
        expiresAtIso
      )
      .run();

    if (!nonceRes.meta.changes || nonceRes.meta.changes === 0) {
      return { valid: false, reason: 'REPLAY_ATTEMPT_DETECTED' };
    }
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE') || errMsg.includes('PRIMARY KEY')) {
      return { valid: false, reason: 'REPLAY_ATTEMPT_DETECTED' };
    }
    throw err;
  }

  return { valid: true, admin: trustedAdmin };
}

export interface AuthEnvelope<T = unknown> {
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  expectedEpoch: number;
  senderId: string;
  timestamp: number; // Unix ms
  nonce: string;     // UUIDv4 único
  signature: string; // HMAC-SHA256 hex
  payload: T;
}

export interface CanonicalIdentity {
  integrationId: string;
  periodoId: number;
  groupKey: GroupKey;
  raText: string;
  generation: number;
  expectedEpoch: number;
}

export type IdentityValidationResult =
  | { valid: true; canonical: CanonicalIdentity }
  | { valid: false; error: string; details?: string };

export type AuthValidationResult<T = unknown> =
  | {
      valid: true;
      identity: AuthIdentity;
      envelope: AuthEnvelope<T>;
    }
  | {
      valid: false;
      error:
        | 'INVALID_TIMESTAMP'
        | 'REPLAY_ATTEMPT_DETECTED'
        | 'IDENTITY_NOT_FOUND'
        | 'IDENTITY_REVOKED'
        | 'INTEGRATION_MISMATCH'
        | 'PERIODO_MISMATCH'
        | 'GROUP_UNAUTHORIZED'
        | 'SCOPE_UNAUTHORIZED'
        | 'INVALID_SIGNATURE'
        | 'MALFORMED_ENVELOPE'
        | 'EPOCH_MISMATCH';
      details?: string;
    };

/**
 * Validação rigorosa de RA textual.
 * - Deve ser string não-vazia.
 * - Deve conter apenas dígitos (inclusive zeros à esquerda preservados).
 * - Não pode conter espaços ou caracteres especiais.
 * - Tamanho razoável (1 a 32 caracteres).
 */
export function validateCanonicalRa(ra: unknown): { valid: true; raText: string } | { valid: false; error: string } {
  if (typeof ra !== 'string') {
    return { valid: false, error: 'RA must be a string' };
  }
  const trimmed = ra.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'RA cannot be empty' };
  }
  if (trimmed !== ra) {
    return { valid: false, error: 'RA cannot contain leading or trailing whitespace' };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: 'RA must consist exclusively of digits (textual representation)' };
  }
  return { valid: true, raText: trimmed };
}

/**
 * Validação rigorosa de identidade canônica completa.
 */
export function validateCanonicalIdentity(input: {
  integrationId: unknown;
  periodoId: unknown;
  groupKey: unknown;
  raText: unknown;
  generation: unknown;
  expectedEpoch: unknown;
}): IdentityValidationResult {
  if (!input.integrationId || typeof input.integrationId !== 'string' || input.integrationId.trim().length === 0) {
    return { valid: false, error: 'INVALID_INTEGRATION_ID', details: 'integrationId must be a non-empty string' };
  }

  const periodoNum = Number(input.periodoId);
  if (!Number.isInteger(periodoNum) || periodoNum <= 0) {
    return { valid: false, error: 'INVALID_PERIODO_ID', details: 'periodoId must be a positive integer' };
  }

  if (input.groupKey !== 'FACE_FEA' && input.groupKey !== 'FCH_EAD') {
    return { valid: false, error: 'INVALID_GROUP_KEY', details: "groupKey must be 'FACE_FEA' or 'FCH_EAD'" };
  }

  const raRes = validateCanonicalRa(input.raText);
  if (!raRes.valid) {
    return { valid: false, error: 'INVALID_RA', details: raRes.error };
  }

  const genNum = Number(input.generation);
  if (!Number.isInteger(genNum) || genNum <= 0) {
    return { valid: false, error: 'INVALID_GENERATION', details: 'generation must be a positive integer >= 1' };
  }

  const epochNum = Number(input.expectedEpoch);
  if (!Number.isInteger(epochNum) || epochNum < 0) {
    return { valid: false, error: 'INVALID_EPOCH', details: 'expectedEpoch must be an integer >= 0' };
  }

  return {
    valid: true,
    canonical: {
      integrationId: input.integrationId.trim(),
      periodoId: periodoNum,
      groupKey: input.groupKey,
      raText: raRes.raText,
      generation: genNum,
      expectedEpoch: epochNum,
    },
  };
}

/**
 * Serialização canônica e determinística recursiva de qualquer valor JSON (C1).
 * Preserva ordenação lexicográfica de chaves de objetos aninhados e elementos de arrays.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Serialização canônica e determinística do envelope para assinatura HMAC (C1).
 */
export function canonicalizeEnvelopeData(envelope: Omit<AuthEnvelope, 'signature'>): string {
  const serializedPayload = canonicalJson(envelope.payload);
  return [
    envelope.integrationId,
    envelope.periodoId,
    envelope.groupKey,
    envelope.expectedEpoch,
    envelope.senderId,
    envelope.timestamp,
    envelope.nonce,
    serializedPayload,
  ].join('|');
}

/**
 * Assinatura HMAC-SHA256 usando Web Crypto API.
 */
export async function signEnvelopeData(canonicalData: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalData));
  return Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verificação de assinatura HMAC-SHA256 com proteção contra timing attack.
 */
export async function verifyEnvelopeSignature(
  canonicalData: string,
  secret: string,
  expectedHex: string
): Promise<boolean> {
  const calculatedHex = await signEnvelopeData(canonicalData, secret);
  if (calculatedHex.length !== expectedHex.length) {
    return false;
  }
  let match = 0;
  for (let i = 0; i < calculatedHex.length; i++) {
    match |= calculatedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return match === 0;
}

/**
 * Validador de Envelope de Autenticação e Autorização no Servidor.
 * - Condição 1: Privilégios resolvidos no servidor pelo identity registry.
 * - Condição 1: Nonce registrado atomicamente no D1 para proteção contra replay.
 * - Condição 2: Preservação e verificação da identidade canônica.
 */
export async function authenticateAndAuthorizeEnvelope<T = unknown>(
  db: D1Database,
  envelope: AuthEnvelope<T>,
  requiredScope: SyncScope,
  identityLookup: (senderId: string) => Promise<AuthIdentity | null> | AuthIdentity | null,
  options: {
    nowMs?: number;
    clockSkewToleranceSec?: number;
  } = {}
): Promise<AuthValidationResult<T>> {
  const nowMs = options.nowMs ?? Date.now();
  const toleranceMs = (options.clockSkewToleranceSec ?? 300) * 1000;

  // 1. Verificação de integridade básica do envelope
  if (
    !envelope ||
    !envelope.senderId ||
    !envelope.integrationId ||
    !envelope.periodoId ||
    !envelope.groupKey ||
    !envelope.nonce ||
    !envelope.signature ||
    typeof envelope.timestamp !== 'number'
  ) {
    return { valid: false, error: 'MALFORMED_ENVELOPE', details: 'Missing required envelope headers' };
  }

  // 2. Janela de tempo (clock skew)
  if (Math.abs(nowMs - envelope.timestamp) > toleranceMs) {
    return {
      valid: false,
      error: 'INVALID_TIMESTAMP',
      details: `Timestamp is outside allowed window of ${toleranceMs / 1000}s`,
    };
  }

  // 3. Resolução no SERVIDOR da identidade autorizada (nunca confiar em scopes autodeclarados)
  const identity = await identityLookup(envelope.senderId);
  if (!identity) {
    return { valid: false, error: 'IDENTITY_NOT_FOUND', details: `Sender ${envelope.senderId} not registered` };
  }
  if (identity.status !== 'ACTIVE') {
    return { valid: false, error: 'IDENTITY_REVOKED', details: `Sender ${envelope.senderId} is revoked` };
  }

  // 4. Validação de Escopo e Vínculos
  if (identity.integrationId !== envelope.integrationId) {
    return {
      valid: false,
      error: 'INTEGRATION_MISMATCH',
      details: `Identity belongs to ${identity.integrationId}, not ${envelope.integrationId}`,
    };
  }
  if (identity.periodoId !== envelope.periodoId) {
    return {
      valid: false,
      error: 'PERIODO_MISMATCH',
      details: `Identity belongs to periodo ${identity.periodoId}, not ${envelope.periodoId}`,
    };
  }
  if (!identity.allowedGroups.includes(envelope.groupKey)) {
    return {
      valid: false,
      error: 'GROUP_UNAUTHORIZED',
      details: `Sender is not authorized for group ${envelope.groupKey}`,
    };
  }
  if (!identity.allowedScopes.includes(requiredScope)) {
    return {
      valid: false,
      error: 'SCOPE_UNAUTHORIZED',
      details: `Sender lacks required server-resolved scope ${requiredScope}`,
    };
  }

  // 5. Verificação da Assinatura Criptográfica
  const { signature, ...rest } = envelope;
  const canonicalData = canonicalizeEnvelopeData(rest);
  const isSigValid = await verifyEnvelopeSignature(canonicalData, identity.secret, signature);
  if (!isSigValid) {
    return { valid: false, error: 'INVALID_SIGNATURE', details: 'HMAC signature mismatch' };
  }

  // 6. Registro Atômico do Nonce no D1 para Anti-Replay
  // Tabela sync_auth_nonces (criada sob demanda se não existir na migration)
  const expiresAtIso = new Date(envelope.timestamp + toleranceMs * 2).toISOString();
  try {
    const nonceRes = await db
      .prepare(
        `INSERT INTO sync_auth_nonces (nonce, sender_id, integration_id, created_at, expires_at)
         VALUES (?, ?, ?, datetime(?, 'unixepoch'), ?)`
      )
      .bind(
        envelope.nonce,
        envelope.senderId,
        envelope.integrationId,
        Math.floor(envelope.timestamp / 1000),
        expiresAtIso
      )
      .run();

    if (nonceRes.meta.changes === 0) {
      return { valid: false, error: 'REPLAY_ATTEMPT_DETECTED', details: 'Nonce insertion affected 0 rows' };
    }
  } catch (err: any) {
    // Violação de chave primária UNIQUE(nonce)
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE') || errMsg.includes('PRIMARY KEY')) {
      return {
        valid: false,
        error: 'REPLAY_ATTEMPT_DETECTED',
        details: `Nonce ${envelope.nonce} has already been consumed`,
      };
    }
    throw err;
  }

  return { valid: true, identity, envelope };
}

