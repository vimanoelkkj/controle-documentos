-- Histórico da Central de Comunicação
-- Execute UMA VEZ no D1 remoto.

CREATE TABLE IF NOT EXISTS comunicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  grupo_chave TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'TODAS',
  documentos_json TEXT NOT NULL,
  quantidade_alunos INTEGER NOT NULL,
  quantidade_emails INTEGER NOT NULL,
  assunto TEXT NOT NULL DEFAULT '',
  prazo TEXT NOT NULL DEFAULT '',
  tipo_destinatario TEXT NOT NULL DEFAULT 'institucional',
  ras_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comunicacoes_criado_em
  ON comunicacoes (criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_comunicacoes_grupo_chave
  ON comunicacoes (grupo_chave);
