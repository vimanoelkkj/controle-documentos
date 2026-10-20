-- ============================================================================
-- SCRIPT DE INICIALIZAÇÃO — AMBIENTE DE HOMOLOGAÇÃO ISOLADO (P0.4)
-- ============================================================================
-- Banco Alvo: controle-documentos-homolog-db (D1 isolado)
-- Uso:
--   npx wrangler d1 execute controle-documentos-homolog-db --file=config/homologacao/setup-homologacao.sql
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 1. PERÍODO FICTÍCIO DE TESTE
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO periodos (id, codigo, status)
VALUES (999, '2026-2-HOMOLOG', 'ATIVO');

-- ----------------------------------------------------------------------------
-- 2. MAPEAMENTO DE PLANILHAS (LEGADO / RETROCOMPATIBILIDADE)
-- ----------------------------------------------------------------------------
INSERT OR REPLACE INTO google_sheets_periodos (
  periodo_id,
  spreadsheet_id,
  aba_base_face_fea,
  aba_base_fch_ead,
  aba_docs_face_fea,
  aba_docs_fch_ead,
  aba_cancelados_face_fea,
  aba_cancelados_fch_ead
) VALUES (
  999,
  'SUBSTITUIR_PELO_SPREADSHEET_ID_DE_HOMOLOGACAO',
  'BASE_FACE_FEA',
  'BASE_FCH_EAD',
  'CONTROLE DE DOCUMENTOS FACE FEA',
  'CONTROLE DE DOCUMENTOS FCH EAD',
  'CANCELADOS_FACE_FEA',
  'CANCELADOS_FCH_EAD'
);

-- Mapeamento de cursos fictícios
INSERT OR REPLACE INTO google_sheets_mapeamentos (periodo_id, curso_chave, curso, unidade)
VALUES
  (999, 'ADMINISTRACAO', 'ADMINISTRAÇÃO', 'FACE'),
  (999, 'CIENCIAS_CONTABEIS', 'CIÊNCIAS CONTÁBEIS', 'FEA'),
  (999, 'PEDAGOGIA', 'PEDAGOGIA', 'FCH'),
  (999, 'LETRAS', 'LETRAS EAD', 'EAD');

-- ----------------------------------------------------------------------------
-- 3. INTEGRAÇÃO V2 (INICIALMENTE PAUSADA)
-- ----------------------------------------------------------------------------
INSERT OR REPLACE INTO sync_integrations (
  integration_id,
  periodo_id,
  spreadsheet_id,
  epoch,
  layout_revision,
  mode
) VALUES (
  'integ-homolog-2026-2',
  999,
  'SUBSTITUIR_PELO_SPREADSHEET_ID_DE_HOMOLOGACAO',
  1,
  1,
  'PAUSED'
);

-- ----------------------------------------------------------------------------
-- 4. USUÁRIO ADMINISTRADOR DE TESTE
-- ----------------------------------------------------------------------------
-- Hash e Salt fictícios para testes em ambiente fechado
INSERT OR IGNORE INTO usuarios (id, nome, email, username, senha_hash, senha_salt, perfil, ativo)
VALUES (
  999,
  'Administrador de Homologação',
  'admin.homolog@exemplo.edu.br',
  'admin_homolog',
  'hash_ficticio_para_homologacao_local_ou_m2m',
  'salt_ficticio_homolog',
  'ADMIN',
  1
);

-- ----------------------------------------------------------------------------
-- 5. ALUNOS COM DADOS 100% FICTÍCIOS (RAs Sintéticos Numéricos Canônicos)
-- ----------------------------------------------------------------------------
-- Grupo FACE_FEA
INSERT OR REPLACE INTO alunos (id, periodo_id, ra, nome, email, email_outro, curso, unidade, status)
VALUES
  (9001, 999, '0090001001', 'ALUNO TESTE ALFA', 'alfa.teste@exemplo.edu.br', NULL, 'ADMINISTRAÇÃO', 'FACE FEA', 'ATIVO'),
  (9002, 999, '0090001002', 'ALUNO TESTE BETA', 'beta.teste@exemplo.edu.br', NULL, 'CIÊNCIAS CONTÁBEIS', 'FACE FEA', 'ATIVO');

-- Grupo FCH_EAD
INSERT OR REPLACE INTO alunos (id, periodo_id, ra, nome, email, email_outro, curso, unidade, status)
VALUES
  (9003, 999, '0090002001', 'ALUNO TESTE GAMA', 'gama.teste@exemplo.edu.br', NULL, 'PEDAGOGIA', 'FCH EAD', 'ATIVO'),
  (9004, 999, '0090002002', 'ALUNO TESTE DELTA', 'delta.teste@exemplo.edu.br', NULL, 'LETRAS EAD', 'FCH EAD', 'ATIVO');

-- ----------------------------------------------------------------------------
-- 6. DOCUMENTOS INICIAIS (TABELA DOCUMENTOS)
-- ----------------------------------------------------------------------------
-- ALFA: Todos entregues (1) exceto contrato (0)
INSERT OR REPLACE INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
VALUES (9001, 1, 1, 1, 1, 1, 1, 0);

-- BETA: Todos pendentes (0)
INSERT OR REPLACE INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
VALUES (9002, 0, 0, 0, 0, 0, 0, 0);

-- GAMA: Parcialmente entregue
INSERT OR REPLACE INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
VALUES (9003, 1, 1, 0, 1, 0, 1, 0);

-- DELTA: Todos entregues (1) - Completo
INSERT OR REPLACE INTO documentos (aluno_id, identidade, cpf, certidao, residencia, titulo, ensino_medio, contrato)
VALUES (9004, 1, 1, 1, 1, 1, 1, 1);

