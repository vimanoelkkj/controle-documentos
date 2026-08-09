-- =========================================================
-- PERÍODOS LETIVOS
-- Cria o escopo por período e associa o estado atual a 2026-2.
-- =========================================================

CREATE TABLE IF NOT EXISTS periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'ARQUIVADO')),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO periodos (codigo, status) VALUES ('2026-2', 'ATIVO');

ALTER TABLE alunos ADD COLUMN periodo_id INTEGER;
UPDATE alunos
SET periodo_id = (SELECT id FROM periodos WHERE codigo = '2026-2')
WHERE periodo_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_alunos_periodo ON alunos(periodo_id);

ALTER TABLE logs ADD COLUMN periodo_id INTEGER;
UPDATE logs
SET periodo_id = (SELECT id FROM periodos WHERE codigo = '2026-2')
WHERE periodo_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_logs_periodo ON logs(periodo_id);

ALTER TABLE comunicacoes ADD COLUMN periodo_id INTEGER;
UPDATE comunicacoes
SET periodo_id = (SELECT id FROM periodos WHERE codigo = '2026-2')
WHERE periodo_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_comunicacoes_periodo ON comunicacoes(periodo_id);
