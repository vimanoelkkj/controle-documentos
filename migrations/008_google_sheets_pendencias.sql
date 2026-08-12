-- =========================================================
-- CAIXA DE SAIDA: SISTEMA -> GOOGLE SHEETS
-- Mantem somente o estado desejado mais recente por periodo/RA.
-- Nenhum gatilho escreve na planilha; esta tabela e apenas rastreabilidade.
-- =========================================================

CREATE TABLE google_sheets_pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo_id INTEGER NOT NULL,
  ra TEXT NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('ATUALIZAR', 'REMOVER')),
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'ENVIANDO', 'CONCLUIDA', 'CONFLITO', 'ERRO')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  usuario_id INTEGER,
  usuario_nome TEXT,
  usuario_username TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (periodo_id, ra)
);

CREATE INDEX idx_google_sheets_pendencias_status
  ON google_sheets_pendencias(periodo_id, status, atualizado_em);
