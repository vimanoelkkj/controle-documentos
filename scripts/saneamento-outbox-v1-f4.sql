-- ============================================================================
-- PROCEDIMENTO ADMINISTRATIVO ATÔMICO DE ENCERRAMENTO DA OUTBOX V1 NO D1 (PRÉ-F4)
-- TEMPLATE PARAMETRIZADO / FIXTURES FICTÍCIAS (ARQUIVO VERSIONADO)
-- Banco: controle-documentos-db
-- Garantia de Atomicidade Estrita com Proteção contra Registros Concluídos Anteriormente:
--   1. Cada UPDATE condicional define um token de execução único e atualizado_em específico.
--   2. Se o registro ID 9 OU ID 25 já foi concluído antes desta execução (ou falhar no CAS),
--      ele não recebe o token nesta transação.
--   3. A inserção em logs valida que EXATAMENTE 2 registros possuem o token desta execução.
--   4. Se COUNT(*) < 2, a subconsulta retorna NULL na coluna 'acao' (NOT NULL),
--      forçando erro SQL real e ROLLBACK TOTAL no SQLite/D1.
-- NOTA DE COMPLIANCE / PRIVACIDADE:
--   Este arquivo contém dados fictícios estruturais para versionamento seguro.
--   A execução em produção utiliza o procedimento privado seguro 'scripts/private/saneamento-outbox-v1-f4.real.sql'.
-- ============================================================================

-- STMT 1: Atualização condicional da Pendência ID 9 (Fixture Fictícia)
-- Valida: ID, periodo_id, RA, operacao, status PENDENTE, 0 tentativas, timestamp e payload
UPDATE google_sheets_pendencias
SET status = 'CONCLUIDA',
    usuario_username = 'sistema:manutencao_admin:f4_saneamento:EXEC_TOKEN',
    ultimo_erro = NULL,
    atualizado_em = '2026-10-19 23:59:59'
WHERE id = 9
  AND periodo_id = 1
  AND ra = 'RA_FICTICIO_009'
  AND operacao = 'ATUALIZAR'
  AND status = 'PENDENTE'
  AND tentativas = 0
  AND atualizado_em = '2026-10-19 15:32:00'
  AND payload_json = '{"ra":"RA_FICTICIO_009","nome":"ALUNO FICTICIO 1","email":"aluno1@exemplo.local","email_outro":"outro1@exemplo.local","curso":"CIENCIA DA COMPUTACAO","unidade":"FACE","status":"ATIVO","identidade":0,"cpf":0,"certidao":0,"residencia":0,"titulo":0,"ensino_medio":1,"contrato":1}';

-- STMT 2: Atualização condicional da Pendência ID 25 (Fixture Fictícia)
-- Valida: ID, periodo_id, RA, operacao, status PENDENTE, 0 tentativas, timestamp e payload
UPDATE google_sheets_pendencias
SET status = 'CONCLUIDA',
    usuario_username = 'sistema:manutencao_admin:f4_saneamento:EXEC_TOKEN',
    ultimo_erro = NULL,
    atualizado_em = '2026-10-19 23:59:59'
WHERE id = 25
  AND periodo_id = 1
  AND ra = 'RA_FICTICIO_025'
  AND operacao = 'ATUALIZAR'
  AND status = 'PENDENTE'
  AND tentativas = 0
  AND atualizado_em = '2026-08-18 20:09:02'
  AND payload_json = '{"ra":"RA_FICTICIO_025","nome":"ALUNA FICTICIA 2","email":"aluna2@exemplo.local","email_outro":"outro2@exemplo.local","curso":"ADMINISTRACAO","unidade":"FACE","status":"ATIVO","identidade":1,"cpf":1,"certidao":1,"residencia":1,"titulo":1,"ensino_medio":1,"contrato":1}';

-- STMT 3: Auditoria Formal com Validação de Ambas as Aplicações Efetivas na Execução
-- A subconsulta verifica se AMBOS os IDs (9 e 25) foram atualizados para CONCLUIDA com o token desta execução.
-- Se um deles já estava concluído previamente ou falhou no CAS, COUNT(*) será < 2, retornando NULL.
-- Como 'logs.acao' é NOT NULL, o SQLite lança 'NOT NULL constraint failed: logs.acao',
-- abortando a transação D1 imediatamente e provocando ROLLBACK TOTAL das pendências!
INSERT INTO logs (
  periodo_id,
  acao,
  entidade,
  descricao,
  ra,
  unidade,
  usuario_id,
  usuario_nome,
  usuario_username,
  criado_em
) VALUES (
  1,
  (SELECT CASE WHEN COUNT(*) = 2 THEN 'ENCERRAMENTO_ADMINISTRATIVO' ELSE NULL END
   FROM google_sheets_pendencias
   WHERE id IN (9, 25)
     AND status = 'CONCLUIDA'
     AND usuario_username = 'sistema:manutencao_admin:f4_saneamento:EXEC_TOKEN'
     AND atualizado_em = '2026-10-19 23:59:59'
  ),
  'GOOGLE_SHEETS_OUTBOX',
  'Encerramento seguro e auditado de 2 pendencias legadas V1 (IDs 9 e 25). Estado das abas confirmado compativel com o D1. Fila de saida saneada para F4.',
  'RA_FICTICIO_009, RA_FICTICIO_025',
  'FACE',
  NULL,
  'MANUTENÇÃO TÉCNICA OFFLINE (PRÉ-F4)',
  'sistema:manutencao_admin',
  CURRENT_TIMESTAMP
);
