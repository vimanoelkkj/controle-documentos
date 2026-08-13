-- Modo de apresentação para acesso sem exposição de dados pessoais.

ALTER TABLE usuarios
ADD COLUMN modo_apresentacao INTEGER NOT NULL DEFAULT 0
CHECK (modo_apresentacao IN (0, 1));