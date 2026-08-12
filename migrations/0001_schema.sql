-- =========================================================
-- CONTROLE DE DOCUMENTOS
-- Schema inicial
-- =========================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- ALUNOS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS alunos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    ra TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,

    email TEXT,
    email_outro TEXT,

    curso TEXT NOT NULL,
    unidade TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'ATIVO'
        CHECK (status IN ('ATIVO', 'CANCELADO')),

    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------
-- DOCUMENTOS
-- Um registro de documentos para cada aluno
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS documentos (
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

    FOREIGN KEY (aluno_id)
        REFERENCES alunos(id)
        ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_alunos_nome
ON alunos(nome);

CREATE INDEX IF NOT EXISTS idx_alunos_curso
ON alunos(curso);

CREATE INDEX IF NOT EXISTS idx_alunos_unidade
ON alunos(unidade);
