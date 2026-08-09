-- Histórico: registra o usuário responsável por cada evento.
-- Eventos antigos permanecem com estes campos NULL.

ALTER TABLE logs ADD COLUMN usuario_id INTEGER;
ALTER TABLE logs ADD COLUMN usuario_nome TEXT;
ALTER TABLE logs ADD COLUMN usuario_username TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_usuario_id
ON logs (usuario_id);
