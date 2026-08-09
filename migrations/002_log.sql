CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ra TEXT,
  unidade TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_criado_em ON logs(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ra ON logs(ra);
CREATE INDEX IF NOT EXISTS idx_logs_acao ON logs(acao);
