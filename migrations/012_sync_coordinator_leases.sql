-- =========================================================
-- COORDENACAO E LEASES DE INTEGRACAO V2 (SCHEDULER / WORKERS)
-- =========================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_coordinator_leases (
  integration_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_epoch INTEGER NOT NULL DEFAULT 1,
  lease_type TEXT NOT NULL CHECK (lease_type IN ('INBOUND', 'OUTBOUND', 'FULL_CYCLE')),
  lease_until TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_id) REFERENCES sync_integrations(integration_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_coordinator_leases_exp
ON sync_coordinator_leases (lease_until);
