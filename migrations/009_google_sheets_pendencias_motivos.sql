-- Acrescenta explicacao cumulativa da origem de cada pendencia.
ALTER TABLE google_sheets_pendencias
  ADD COLUMN motivos TEXT NOT NULL DEFAULT '';
