# Roteiro de Homologação Integrada da Sincronização V2

**Documento:** Homologação Real em Ambiente Isolado (P0.4)  
**Projeto:** Controle de Documentos — Matrículas  
**Objetivo:** Validar ponta a ponta a Sincronização V2 entre Cloudflare D1 e Google Sheets em ambiente estritamente isolado, com dados 100% fictícios, antes de qualquer ativação em produção.

---

## 1. Pré-Requisitos e Checklist de Segurança Obrigatório

Antes de iniciar qualquer execução, certifique-se de preencher e assinar este checklist:

- [ ] **Cloudflare Builds desativado:** Confirmado no painel da Cloudflare que `Disable builds` está ativado para o repositório.
- [ ] **D1 exclusivo de testes:** O banco criado é `controle-documentos-homolog-db`. **Nunca** executar apontando para `controle-documentos-db` ou `controle-documentos-dev-db`.
- [ ] **Planilha exclusiva de testes:** Planilha criada no Google Drive com dados fictícios. A Service Account não possui permissão em nenhuma planilha de produção.
- [ ] **Dados 100% fictícios:** Nenhum nome, CPF ou documento real foi inserido.
- [ ] **Feature Flag inicial:** `SYNC_V2_ENABLED = "false"` garantida no arranque.
- [ ] **Modo inicial:** Integração `sync_integrations` criada com `mode = 'PAUSED'`.

---

## 2. Procedimento de Provisionamento dos Recursos Manuais

### 2.1 Cloudflare (Executado via Wrangler CLI / Painel)
1. Criar o banco D1 de homologação:
   ```bash
   npx wrangler d1 create controle-documentos-homolog-db
   ```
2. Copiar o UUID retornado e colar no campo `database_id` do arquivo `config/homologacao/wrangler.homolog.jsonc`.
3. Executar as migrations no D1 de homologação:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/0001_schema.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/001_comunicacoes.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/002_log.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/003_periodos.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/004_google_sheets.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/004_google_sheets_mapeamentos.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/005_auth.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/005_log_usuario.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/006_auth_username.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/007_alunos_por_periodo.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/008_google_sheets_pendencias.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/009_google_sheets_pendencias_motivos.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/010_modo_apresentacao.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/011_sync_v2.sql
   npx wrangler d1 execute controle-documentos-homolog-db --file=migrations/012_sync_coordinator_leases.sql
   ```
4. Executar a carga inicial de teste no D1 de homologação:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --file=config/homologacao/setup-homologacao.sql
   ```

### 2.2 Google Cloud & Google Sheets
1. Criar uma nova planilha Google Sheets no Google Drive com o nome `CONTROLE_DOCUMENTOS_HOMOLOG_2026_2`.
2. Criar as 4 abas estruturadas conforme `config/homologacao/template-sheets-homologacao.json`:
   - `CONTROLE DE DOCUMENTOS FACE FEA` (Aba de Controle)
   - `CONTROLE DE DOCUMENTOS FCH EAD` (Aba de Controle)
   - `BASE_FACE_FEA` (Aba Geral)
   - `BASE_FCH_EAD` (Aba Geral)
3. Inserir os cabeçalhos canônicos e as linhas iniciais com os alunos fictícios (`0090001001`, `0090001002`, `0090002001`, `0090002002`).
4. Criar uma Service Account no Google Cloud Console com nome `sa-homolog-controle-docs`.
5. Compartilhar a planilha de teste com o e-mail da Service Account com perfil **Editor**.
6. Gerar e baixar a chave privada em formato JSON da Service Account (`credentials-homolog.json`).
7. Atualizar o `spreadsheet_id` no D1 de homologação:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE sync_integrations SET spreadsheet_id = '<ID_DA_PLANILHA_GOOGLE>' WHERE integration_id = 'integ-homolog-2026-2';"
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE google_sheets_periodos SET spreadsheet_id = '<ID_DA_PLANILHA_GOOGLE>' WHERE periodo_id = 999;"
   ```

### 2.3 Secrets no Cloudflare Worker
Configurar os segredos via terminal (detalhes em [Variáveis e Segredos de Homologação](./SECRETS_E_VARIAVEIS.md)):
```bash
# 1. Chave administrativa
npx wrangler secret put SYNC_V2_ADMIN_SECRET --config config/homologacao/wrangler.homolog.jsonc

# 2. JSON de credenciais da Service Account (cole o conteúdo do credentials-homolog.json)
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config config/homologacao/wrangler.homolog.jsonc
```

---

## 3. Roteiro de Execução Passo a Passo (10 Cenários)

### Cenário 1: Ativação Controlada via Feature Flag e Modo de Sincronização
- **Objetivo**: Demonstrar que a V2 recusa qualquer processamento enquanto desativada por flag ou pausada, e aceita após liberação explícita.
- **Passo 1.1**: Tentar disparar lote com `SYNC_V2_ENABLED = "false"`:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/dispatch" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2"}'
  ```
  - **Resultado Esperado**: HTTP 503 com código `FEATURE_DISABLED`.
- **Passo 1.2**: No Cloudflare Worker, definir a variável de ambiente `SYNC_V2_ENABLED = "true"` e reiniciar/reimplantar.
- **Passo 1.3**: Tentar disparar com integração ainda em modo `PAUSED`:
  - **Resultado Esperado**: HTTP 409 com código `INTEGRATION_PAUSED`.
- **Passo 1.4**: Alterar o modo da integração para `SHADOW`:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "modo": "SHADOW"}'
  ```
  - **Resultado Esperado**: HTTP 200 com `"modo": "SHADOW"`, status `"ACTIVE"`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Recusa operações quando desligado por flag ou pause, autoriza em SHADOW após resume explícito.
  - **FAIL**: Permitiu execução com flag false ou assumiu BIDIRECTIONAL sem autorização.

---

### Cenário 2: Baseline Inicial dos Alunos Fictícios
- **Objetivo**: Estabelecer a linha de base segura sem sobrescrita, confrontando D1 e Sheets.
- **Passo 2.1**: Executar teste de baseline em modo `dryRun = true`:
  - Executar rotina de baseline seeder para período 999.
  - Verificar que nenhum registro foi alterado no D1.
- **Passo 2.2**: Executar baseline com persistência real:
  - Verificar a criação de registros em `sync_records` para os 4 alunos (`0090001001`, `0090001002`, `0090002001`, `0090002002`).
  - Verificar a criação das linhas em `sync_field_state` com `revision = 1` e `evidence_hash` não nulo.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: 4 alunos preparados com 7 campos documentais cada (28 registros em `sync_field_state`), 0 duplicações, total idempotência ao reexecutar a rotina.
  - **FAIL**: Sobrescrita indevida, criação duplicada de `sync_records` ou perda de formatação de RA.

---

### Cenário 3: Alteração Documental no Site → Propagação para o Sheets
- **Objetivo**: O operador da secretaria marca o documento "Contrato" do aluno `0090001001` (Alfa) como entregue no site. Propagar com sucesso para a planilha.
- **Passo 3.1**: Alterar o modo da integração para `BIDIRECTIONAL`:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "modo": "BIDIRECTIONAL"}'
  ```
- **Passo 3.2**: Atualizar o documento no site via endpoint real da conferência (`PUT /api/alunos/:ra/documentos`):
  ```bash
  curl -X PUT "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/alunos/0090001001/documentos" \
    -H "Content-Type: application/json" \
    -H "X-Idempotency-Key: homolog-cenario3-contrato-001" \
    -H "Cookie: auth_session=<COOKIE_CONFERENTE>" \
    -d '{
      "identidade": true,
      "cpf": true,
      "certidao": true,
      "residencia": true,
      "titulo": true,
      "ensino_medio": true,
      "contrato": true
    }'
  ```
  - Verificar no D1: `documentos.contrato = 1`, inserção em `sync_commands`, `sync_events` e outbox `sync_operations` com status `PENDING`.
- **Passo 3.3**: Disparar ciclo do orquestrador:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/dispatch" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2"}'
  ```
- **Passo 3.4**: Verificar na planilha Google Sheets:
  - Aba `CONTROLE DE DOCUMENTOS FACE FEA`, linha do RA `0090001001`, Coluna I (`CONTRATO`) deve estar com valor `"TRUE"` (ou interpretado como `VERDADEIRO`).
  - Colunas J e K recalculam automaticamente via fórmulas protegidas (`TOTAL = 7`, `STATUS = COMPLETO`).
  - Verificar no D1: `sync_operations.state = 'CONFIRMED'`, `sync_receipts` registrado com HTTP 200.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Planilha atualizada na célula correta; fórmulas em J e K intactas; operação D1 confirmada com recibo.
  - **FAIL**: Célula errada modificada, fórmula sobrescrita ou status do D1 em desacordo.

---

### Cenário 4: Alteração Concorrente no Sheets → Detecção Causal de Conflito (F3) e Fluxo Inverso
- **Objetivo**: Proteger contra sobrescrita cega quando ocorrem edições concorrentes entre site e planilha, e validar a ingestão do fluxo inverso (Sheets → D1).
- **Passo 4.1 (Concorrência F3)**: Na planilha Google Sheets, aba `CONTROLE DE DOCUMENTOS FACE FEA`, alterar manualmente a célula do Contrato do aluno `0090001002` (Beta, Coluna I) para `"VERDADEIRO"`.
- **Passo 4.2**: No site D1, tentar submeter alteração divergente com outbox pendente (ex: contrato como `false`):
  ```bash
  curl -X PUT "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/alunos/0090001002/documentos" \
    -H "Content-Type: application/json" \
    -H "X-Idempotency-Key: homolog-cenario4-contrato-001" \
    -H "Cookie: auth_session=<COOKIE_CONFERENTE>" \
    -d '{
      "identidade": false,
      "cpf": false,
      "certidao": false,
      "residencia": false,
      "titulo": false,
      "ensino_medio": false,
      "contrato": false
    }'
  ```
- **Passo 4.3**: Executar ingestão inbound:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/inbound" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2"}'
  ```
  - O reconciliador inbound detecta que há divergência e existe operação pendente na outbox local.
  - Conflito F3 formalmente registrado em `sync_conflicts` com motivo `DIVERGENCIA_COM_OPERACAO_PENDENTE`.
  - A alteração local NÃO é sobrescrita cegamente.
- **Passo 4.4 (Ingestão Inbound sem Concorrência)**: Na planilha, marcar o RG de `0090001002` como `"VERDADEIRO"` sem operação pendente no site. Disparar `POST /api/periodos/999/sync-v2/inbound`:
  - Verificar no D1: `documentos.identidade = 1`, `sync_field_state.value = 1` com status `CONFIRMED`.
  - **Ausência estrita de eco**: Nenhuma operação pendente de envio gerada na outbox para a planilha.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Nenhuma escrita destrutiva ocorreu; conflito registrado formalmente em `sync_conflicts`; alteração unilateral da planilha capturada com ausência de eco.
  - **FAIL**: Sobrescrita silenciosa da alteração humana ou geração de loop infinito de eco.

---

### Cenário 5: Pausa Operacional Imediata via Endpoint Administrativo
- **Objetivo**: Interromper imediatamente o processamento de lotes em caso de anomalia.
- **Passo 5.1**: Executar pausa:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/pause" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "motivo": "Homologação de emergência"}'
  ```
- **Passo 5.2**: Verificar resposta: HTTP 200, `"modo_anterior": "BIDIRECTIONAL"`, `"modo_novo": "PAUSED"`.
- **Passo 5.3**: Tentar disparar lote imediatamente (`POST /dispatch`):
  - Resposta obrigatória: HTTP 409 `INTEGRATION_PAUSED`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Despacho bloqueado em 100% das tentativas; log de auditoria `SYNC_V2_PARADA_OPERACIONAL` registrado com `modo_anterior`.
  - **FAIL**: Qualquer lote continuou sendo despachado.

---

### Cenário 6: Retomada Operacional Preservando Modo Anterior
- **Objetivo**: Retomar as operações após a pausa sem assumir BIDIRECTIONAL cegamente.
- **Passo 6.1**: Chamar `/resume` sem informar modo no payload:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2"}'
  ```
  - Verificar resposta: HTTP 200, resgatando automaticamente `"modo": "BIDIRECTIONAL"` a partir do log da pausa anterior.
- **Passo 6.2**: Pausar novamente a partir do modo `SHADOW` e tentar `/resume` sem payload:
  - Verificar que o modo restaurado é estritamente `SHADOW`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Modo anterior restaurado com fidelidade a partir do log; nunca força BIDIRECTIONAL arbitrariamente.
  - **FAIL**: Ativação indiscriminada de BIDIRECTIONAL ou falha ao ler histórico de auditoria.

---

### Cenário 7: Simulação de Falha Transitória e Retenção Causal / DLQ
- **Objetivo**: Demonstrar que falhas de rede com a API do Google Sheets não perdem dados nem entram em loop cego.
- **Passo 7.1**: Simular falha temporária (desativando provisoriamente o compartilhamento da planilha com a Service Account no Google Drive).
- **Passo 7.2**: Submeter alteração documental no D1 para o aluno `0090002001` (Gama) e disparar despacho:
  - O worker tenta comunicar com o Google Sheets e recebe HTTP 403 / erro de rede.
  - A operação transiciona para `RETRY_WAIT` com `next_attempt_at` calculado via backoff exponencial.
  - Registro de tentativa registrado em `sync_attempts`.
- **Passo 7.3**: Restaurar a permissão da Service Account na planilha.
- **Passo 7.4**: Disparar novo despacho após a expiração do backoff:
  - A operação é reprocessada com sucesso e transiciona para `CONFIRMED`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Nenhuma operação descartada; backoff respeitado; recuperação autônoma após correção do canal.
  - **FAIL**: Operação descartada ou retry contínuo sem backoff gerando estouro de cota.

---

### Cenário 8: Rejeição Estrita de Payload Divergente com Idempotency Key Repetida (422)
- **Objetivo**: Proteger contra replay com mutação indevida de dados.
- **Passo 8.1**: Enviar mutação com uma chave de idempotência:
  ```bash
  curl -X PUT "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/alunos/0090001002/documentos" \
    -H "Content-Type: application/json" \
    -H "X-Idempotency-Key: idemp-homolog-teste-888" \
    -H "Cookie: auth_session=<COOKIE_CONFERENTE>" \
    -d '{
      "identidade": true,
      "cpf": true,
      "certidao": false,
      "residencia": true,
      "titulo": true,
      "ensino_medio": true,
      "contrato": false
    }'
  ```
  - Resposta: HTTP 200 com a mutação aplicada.
- **Passo 8.2**: Reenviar a MESMA chave `idemp-homolog-teste-888`, porém com PAYLOAD DIFERENTE:
  ```bash
  curl -X PUT "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/alunos/0090001002/documentos" \
    -H "Content-Type: application/json" \
    -H "X-Idempotency-Key: idemp-homolog-teste-888" \
    -H "Cookie: auth_session=<COOKIE_CONFERENTE>" \
    -d '{
      "identidade": false,
      "cpf": false,
      "certidao": false,
      "residencia": false,
      "titulo": false,
      "ensino_medio": false,
      "contrato": false
    }'
  ```
  - Resposta obrigatória: HTTP 422 com código de erro `Chave de idempotência reutilizada com payload divergente.`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: HTTP 422 imediato; nenhuma alteração gravada no banco; chave de idempotência respeitada.
  - **FAIL**: Aceitação da alteração divergente ou sobrescrita do evento original.

---

### Cenário 9: Conferência Completa de Aluno com Pendências
- **Objetivo**: Validar a transição de um aluno que possui pendências documentais até a entrega completa de todos os 7 documentos.
- **Passo 9.1**: O aluno `0090001002` (Beta) possui documentos pendentes. Submeter a entrega de 6 documentos (deixando apenas o contrato pendente).
  - Verificar recalculo das fórmulas nas colunas J e K da planilha (`TOTAL = 6`, `STATUS = PENDENTE`).
- **Passo 9.2**: Submeter o 7º documento (contrato = 1):
  - Disparar despacho:
    ```bash
    curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/dispatch" \
      -H "Content-Type: application/json" \
      -H "X-Sync-Admin-Secret: <SECRET>" \
      -d '{"integrationId": "integ-homolog-2026-2"}'
    ```
  - Verificar na planilha: `TOTAL = 7`, `STATUS = COMPLETO`.
  - Verificar que as células C:I foram atualizadas e J:K mantiveram suas fórmulas intactas.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Transição correta refletida no D1 e Sheets; nenhuma quebra de fórmulas; histórico documental auditável.
  - **FAIL**: Contagem incorreta ou perda de dados em colunas adjacentes.

---

### Cenário 10: Auditoria Completa, Integridade de Metadados e Métricas
- **Objetivo**: Conferir a rastreabilidade total de todas as ações executadas durante a homologação.
- **Passo 10.1**: Consultar tabela `logs` de auditoria:
  ```sql
  SELECT periodo_id, acao, entidade, usuario_id, criado_em FROM logs WHERE periodo_id = 999 ORDER BY id DESC;
  ```
  - Confirmar presença de eventos: `DOCUMENTOS_ATUALIZADOS`, `SYNC_V2_PARADA_OPERACIONAL`, `SYNC_V2_RETOMADA_OPERACIONAL`.
- **Passo 10.2**: Consultar integridade de `sync_events` e `sync_operations`:
  - Verificar se todo `command_id` possui `event_id` correspondente.
  - Verificar se nenhuma operação confirmada possui `receipt_id` órfão.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Cadeia de custódia completa sem lacunas; logs íntegros e rastreáveis até os respectivos atores.
  - **FAIL**: Operações sem log, receipts órfãos ou falta de carimbo temporal.

---

### Cenário 11: Sincronização Automática com Scheduler e Cron de 5 Minutos
- **Objetivo**: Validar a execução periódica desassistida do ciclo coordenado (Inbound + Outbound) garantindo lease e fencing no D1.
- **Passo 11.1**: Ativar as flags no Worker de homologação: `SYNC_V2_ENABLED = "true"` e `SYNC_V2_AUTO_ENABLED = "true"`.
- **Passo 11.2**: Acionar manualmente o ciclo coordenado via endpoint administrativo:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/periodos/999/sync-v2/schedule-run" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>"
  ```
  - Verificar resposta: HTTP 200 com `"sucesso": true` e relatório detalhado de integrações executadas.
- **Passo 11.3**: Aguardar disparo automático do Cron Trigger (a cada 5 minutos em homologação):
  - Verificar no Cloudflare Logs o acionamento do handler `scheduled`.
  - Consultar `sync_coordinator_leases` e `logs` de auditoria com o evento `SYNC_V2_SCHEDULED_CYCLE`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Ciclo executado na ordem estrita Inbound -> Outbound; lease coordenador adquirido e liberado com incremento de `lease_epoch`; nenhum dado pessoal ou credencial exposto nos logs.
  - **FAIL**: Concorrência não coordenada, execução com flag desativada ou quebra de fórmulas J/K.

---

## 4. Procedimento de Rollback e Limpeza do Ambiente

Após o encerramento dos testes de homologação:

1. **Pausar imediatamente as integrações**:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE sync_integrations SET mode = 'PAUSED' WHERE periodo_id = 999;"
   ```
2. **Desativar a feature flag**:
   - Redefinir `SYNC_V2_ENABLED = "false"` no Worker de homologação.
3. **Limpeza do Banco D1 de Homologação**:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --command="DELETE FROM sync_operations WHERE periodo_id = 999; DELETE FROM sync_events WHERE periodo_id = 999; DELETE FROM sync_records WHERE integration_id = 'integ-homolog-2026-2'; DELETE FROM alunos WHERE periodo_id = 999; DELETE FROM periodos WHERE id = 999;"
   ```
4. **Remoção de Permissões da Service Account**:
   - Revogar o acesso de edição da Service Account na planilha de teste no Google Drive.
5. **Destruição do Ambiente (Opcional, se o ciclo for finalizado)**:
   ```bash
   npx wrangler d1 delete controle-documentos-homolog-db
   ```

