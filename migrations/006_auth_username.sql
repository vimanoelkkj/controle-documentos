-- Login por nome de usuário
ALTER TABLE usuarios ADD COLUMN username TEXT COLLATE NOCASE;

UPDATE usuarios
SET username = 'user' || id
WHERE username IS NULL OR TRIM(username) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
