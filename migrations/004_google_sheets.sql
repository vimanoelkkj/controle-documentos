-- =========================================================
-- GOOGLE SHEETS POR PERÍODO
-- Guarda somente configuração. Credenciais ficam em secret do Worker.
-- =========================================================

CREATE TABLE IF NOT EXISTS google_sheets_periodos (
  periodo_id INTEGER PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  aba_base_face_fea TEXT NOT NULL,
  aba_base_fch_ead TEXT NOT NULL,
  aba_docs_face_fea TEXT NOT NULL,
  aba_docs_fch_ead TEXT NOT NULL,
  aba_cancelados_face_fea TEXT NOT NULL,
  aba_cancelados_fch_ead TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE
);
