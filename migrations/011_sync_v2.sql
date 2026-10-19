-- =========================================================
-- SINCRONIZACAO BIDIRECIONAL V2 (F1-A)
-- Schema D1 v2: Nucleo transacional, CAS, outbox e receipts
-- =========================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- 1. INTEGRACOES (Vinculo de Periodo e Planilha)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_integrations (
  integration_id TEXT PRIMARY KEY,
  periodo_id INTEGER NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 1,
  layout_revision INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'SHADOW'
    CHECK (mode IN ('LEGACY', 'SHADOW', 'CAPTURE', 'BIDIRECTIONAL', 'PAUSED', 'QUARANTINED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- 2. REGISTROS DE SINCRONIZACAO (Identidade e Unicidade por Grupo)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_records (
  record_id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  aluno_id INTEGER,
  ra_text TEXT NOT NULL,
  group_key TEXT NOT NULL CHECK (group_key IN ('FACE_FEA', 'FCH_EAD')),
  generation INTEGER NOT NULL DEFAULT 1,
  lifecycle TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle IN ('ACTIVE', 'INACTIVE', 'TOMBSTONE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_id) REFERENCES sync_integrations(integration_id) ON DELETE CASCADE,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE SET NULL,
  UNIQUE (integration_id, group_key, ra_text, generation)
);

-- Indice UNIQUE parcial: somente 1 registro ATIVO por RA dentro do mesmo grupo/periodo
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_records_active_ra
ON sync_records (integration_id, group_key, ra_text)
WHERE lifecycle = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_sync_records_lookup
ON sync_records (integration_id, group_key, ra_text);

-- ---------------------------------------------------------
-- 3. ESTADO DE CAMPOS DOCUMENTAIS (7 Documentos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_field_state (
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL CHECK (field_key IN (
    'identidade', 'cpf_documento', 'certidao', 'residencia', 'titulo', 'ensino_medio', 'contrato'
  )),
  value INTEGER CHECK (value IN (0, 1) OR value IS NULL),
  revision INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT,
  head_command_id TEXT,
  baseline_command_id TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED', 'PENDING', 'CONFLICT', 'UNBASELINED')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_id, field_key),
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- 4. COMANDOS E IDEMPOTENCIA
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_commands (
  command_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  proposed_value INTEGER NOT NULL CHECK (proposed_value IN (0, 1)),
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'REJECTED', 'CONFLICT', 'CONVERGED', 'BASELINE_ESTABLISHED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
  UNIQUE (actor_id, command_id)
);

-- ---------------------------------------------------------
-- 5. EVENTOS ACEITOS (CAS Vencedor)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_events (
  event_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  value_old INTEGER CHECK (value_old IN (0, 1) OR value_old IS NULL),
  value_new INTEGER NOT NULL CHECK (value_new IN (0, 1)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
  FOREIGN KEY (command_id) REFERENCES sync_commands(command_id) ON DELETE CASCADE,
  CHECK (to_revision = from_revision + 1),
  UNIQUE (record_id, field_key, to_revision)
);

-- ---------------------------------------------------------
-- 6. OUTBOX DE OPERACOES (F1-A: apenas estado PENDING)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  target_key TEXT NOT NULL CHECK (target_key IN ('CONTROLE', 'GERAL_CONTRATO')),
  target_revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'CLAIMED', 'DISPATCHED', 'VERIFYING', 'OBSERVED', 'UNCERTAIN', 'RETRY_WAIT')),
  lease_owner TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES sync_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
  UNIQUE (event_id, target_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_claim
ON sync_operations (state, next_attempt_at, lease_until);

-- ---------------------------------------------------------
-- 7. RECIBOS DE CONCLUSAO LOCAL E EXTERNA
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_receipts (
  receipt_id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  operation_id TEXT,
  target_key TEXT,
  attempt_id TEXT,
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (command_id) REFERENCES sync_commands(command_id) ON DELETE CASCADE,
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
  FOREIGN KEY (operation_id) REFERENCES sync_operations(operation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_receipts_op
ON sync_receipts (operation_id, revision);

-- ---------------------------------------------------------
-- 8. HISTORICO IMUTAVEL DE TENTATIVAS (F1-B)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_attempts (
  attempt_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_epoch INTEGER NOT NULL,
  target_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DISPATCHED', 'VERIFYING', 'OBSERVED', 'UNCERTAIN', 'FAILED', 'TIMED_OUT')),
  dispatch_payload TEXT,
  response_payload TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (operation_id) REFERENCES sync_operations(operation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_attempts_op
ON sync_attempts (operation_id, lease_epoch);

-- ---------------------------------------------------------
-- 9. REGISTRO ATOMICO DE NONCES ANTI-REPLAY (F2.1)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_auth_nonces (
  nonce TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_auth_nonces_exp
ON sync_auth_nonces (expires_at);

-- ---------------------------------------------------------
-- 10. REGISTRO DE CONFLITOS ISOLADOS POR ALVO (F3)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  target_key TEXT NOT NULL CHECK (target_key IN ('CONTROLE', 'GERAL_CONTRATO')),
  local_revision INTEGER NOT NULL,
  local_value INTEGER,
  external_value INTEGER,
  reason TEXT NOT NULL,
  evidence_payload TEXT,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  resolution_action TEXT,
  resolution_actor_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (record_id) REFERENCES sync_records(record_id) ON DELETE CASCADE,
  UNIQUE (record_id, field_key, target_key, local_revision)
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_lookup
ON sync_conflicts (record_id, field_key, target_key, resolved);




