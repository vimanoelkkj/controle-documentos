-- =========================================================
-- ALUNOS POR PERIODO
-- Remove a unicidade global de RA e adota (periodo_id, ra).
-- Reconstroi alunos e documentos preservando IDs e dados.
-- =========================================================

PRAGMA defer_foreign_keys = TRUE;

ALTER TABLE documentos RENAME TO documentos_legacy;
ALTER TABLE alunos RENAME TO alunos_legacy;

CREATE TABLE alunos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo_id INTEGER NOT NULL,
  ra TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT,
  email_outro TEXT,
  curso TEXT NOT NULL,
  unidade TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ATIVO'
    CHECK (status IN ('ATIVO', 'CANCELADO')),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE,
  UNIQUE (periodo_id, ra)
);

INSERT INTO alunos (
  id, periodo_id, ra, nome, email, email_outro, curso, unidade,
  status, criado_em, atualizado_em
)
SELECT
  id, periodo_id, ra, nome, email, email_outro, curso, unidade,
  status, criado_em, atualizado_em
FROM alunos_legacy;

CREATE TABLE documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aluno_id INTEGER NOT NULL UNIQUE,
  identidade INTEGER NOT NULL DEFAULT 0 CHECK (identidade IN (0, 1)),
  cpf INTEGER NOT NULL DEFAULT 0 CHECK (cpf IN (0, 1)),
  certidao INTEGER NOT NULL DEFAULT 0 CHECK (certidao IN (0, 1)),
  residencia INTEGER NOT NULL DEFAULT 0 CHECK (residencia IN (0, 1)),
  titulo INTEGER NOT NULL DEFAULT 0 CHECK (titulo IN (0, 1)),
  ensino_medio INTEGER NOT NULL DEFAULT 0 CHECK (ensino_medio IN (0, 1)),
  contrato INTEGER NOT NULL DEFAULT 0 CHECK (contrato IN (0, 1)),
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
);

INSERT INTO documentos (
  id, aluno_id, identidade, cpf, certidao, residencia, titulo,
  ensino_medio, contrato, atualizado_em
)
SELECT
  id, aluno_id, identidade, cpf, certidao, residencia, titulo,
  ensino_medio, contrato, atualizado_em
FROM documentos_legacy;

DROP TABLE documentos_legacy;
DROP TABLE alunos_legacy;

CREATE INDEX idx_alunos_nome ON alunos(nome);
CREATE INDEX idx_alunos_curso ON alunos(curso);
CREATE INDEX idx_alunos_unidade ON alunos(unidade);
CREATE INDEX idx_alunos_periodo ON alunos(periodo_id);
