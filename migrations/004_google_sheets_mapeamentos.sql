CREATE TABLE IF NOT EXISTS google_sheets_mapeamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo_id INTEGER NOT NULL,
  curso_chave TEXT NOT NULL,
  curso TEXT NOT NULL,
  unidade TEXT NOT NULL CHECK (unidade IN ('FACE', 'FEA', 'FCH', 'EAD')),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE,
  UNIQUE (periodo_id, curso_chave)
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_mapeamentos_periodo
  ON google_sheets_mapeamentos(periodo_id);
