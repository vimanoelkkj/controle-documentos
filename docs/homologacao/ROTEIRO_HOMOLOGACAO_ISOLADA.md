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
   ```
4. Executar a carga inicial de teste no D1 de homologação:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --file=config/homologacao/setup-homologacao.sql
   ```

### 2.2 Google Cloud & Google Sheets
1. Criar uma nova planilha Google Sheets no Google Drive com o nome `CONTROLE_DOCUMENTOS_HOMOLOG_2026_2`.
2. Criar as 4 abas estruturadas conforme `config/homologacao/template-sheets-homologacao.json`:
   - `DOCS_FACE_FEA`
   - `DOCS_FCH_EAD`
   - `BASE_FACE_FEA`
   - `BASE_FCH_EAD`
3. Inserir os cabeçalhos e as linhas iniciais com os alunos fictícios (`HOM-1001`, `HOM-1002`, `HOM-2001`, `HOM-2002`).
4. Criar uma Service Account no Google Cloud Console com nome `sa-homolog-controle-docs`.
5. Compartilhar a planilha de teste com o e-mail da Service Account com perfil **Editor**.
6. Gerar chave privada JSON da Service Account.
7. Atualizar o `spreadsheet_id` no D1 de homologação:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE sync_integrations SET spreadsheet_id = '<ID_DA_PLANILHA_GOOGLE>' WHERE integration_id = 'integ-homolog-2026-2';"
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE google_sheets_periodos SET spreadsheet_id = '<ID_DA_PLANILHA_GOOGLE>' WHERE periodo_id = 999;"
   ```

### 2.3 Secrets no Cloudflare Worker
Configurar os segredos via terminal (detalhes em [Variáveis e Segredos de Homologação](./SECRETS_E_VARIAVEIS.md)):
```bash
npx wrangler secret put SYNC_ADMIN_SECRET --config config/homologacao/wrangler.homolog.jsonc
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL --config config/homologacao/wrangler.homolog.jsonc
npx wrangler secret put GOOGLE_PRIVATE_KEY --config config/homologacao/wrangler.homolog.jsonc
```

---

## 3. Roteiro de Execução Passo a Passo (10 Cenários)

### Cenário 1: Ativação Controlada via Feature Flag e Modo de Sincronização
- **Objetivo**: Demonstrar que a V2 recusa qualquer processamento enquanto desativada por flag ou pausada, e aceita após liberação explícita.
- **Passo 1.1**: Tentar disparar lote com `SYNC_V2_ENABLED = "false"`:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/dispatch" \
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
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "periodoId": 999, "modo": "SHADOW"}'
  ```
  - **Resultado Esperado**: HTTP 200 com `"modo": "SHADOW"`, status `"ACTIVE"`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Recusa operações quando desligado por flag ou pause, autoriza em SHADOW após resume explícito.
  - **FAIL**: Permitiu execução com flag false ou assumiu BIDIRECTIONAL sem autorização.

---

### Cenário 2: Baseline Inicial dos Alunos Fictícios
- **Objetivo**: Estabelecer a linha de base segura sem sobrescrita, confrontando D1 e Sheets.
- **Passo 2.1**: Executar teste de baseline em modo `dryRun = true`:
  - Executar script de baseline seeder para período 999.
  - Verificar que nenhum registro foi alterado no D1.
- **Passo 2.2**: Executar baseline com persistência real:
  - Verificar a criação de registros em `sync_records` para os 4 alunos (`HOM-1001`, `HOM-1002`, `HOM-2001`, `HOM-2002`).
  - Verificar a criação das linhas em `sync_field_state` com `revision = 1` e `evidence_hash` não nulo.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: 4 alunos preparados com 7 campos documentais cada (28 registros em `sync_field_state`), 0 duplicações, total idempotência ao reexecutar a rotina.
  - **FAIL**: Sobrescrita indevida, criação duplicada de `sync_records` ou perda de formatação de RA.

---

### Cenário 3: Alteração Documental no Site → Propagação para o Sheets
- **Objetivo**: O operador da secretaria marca o documento "Contrato" do aluno `HOM-1001` como entregue no site. Propagar com sucesso para a planilha.
- **Passo 3.1**: Alterar o modo da integração para `BIDIRECTIONAL`:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "periodoId": 999, "modo": "BIDIRECTIONAL"}'
  ```
- **Passo 3.2**: Atualizar o documento no site via endpoint:
  ```bash
  curl -X PATCH "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/documentos/9001" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"contrato": 1, "idempotencyKey": "homolog-cenario3-contrato-001"}'
  ```
  - Verificar no D1: `documentos.contrato = 1`, inserção em `sync_commands`, `sync_events` e outbox `sync_operations` com status `PENDING`.
- **Passo 3.3**: Disparar ciclo do orquestrador:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/dispatch" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2"}'
  ```
- **Passo 3.4**: Verificar na planilha Google Sheets:
  - Aba `DOCS_FACE_FEA`, linha do RA `HOM-1001`, Coluna I (`CONTRATO`) deve estar com valor `"OK"`.
  - Colunas J e K devem ter recalculado as fórmulas automaticamente sem corrupção.
  - Verificar no D1: `sync_operations.status = 'CONFIRMED'`, `sync_receipts` registrado com HTTP 200.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Planilha atualizada na célula correta; fórmulas em J e K intactas; operação D1 confirmada com recibo.
  - **FAIL**: Célula errada modificada, fórmula sobrescrita ou status do D1 em desacordo.

---

### Cenário 4: Alteração Concorrente no Sheets → Detecção Causal de Conflito (F3)
- **Objetivo**: Um humano altera uma célula no Google Sheets diretamente enquanto há uma operação concorrente pendente, disparando detecção de conflito F3.
- **Passo 4.1**: Na planilha Google Sheets, aba `DOCS_FACE_FEA`, alterar manualmente a célula da Identidade do aluno `HOM-1002` (Coluna C) de `"PENDENTE"` para `"OK"`.
- **Passo 4.2**: No site D1, tentar atualizar o mesmo campo sem conhecer a edição externa:
  ```bash
  curl -X PATCH "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/documentos/9002" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"identidade": 1, "idempotencyKey": "homolog-cenario4-identidade-001"}'
  ```
- **Passo 4.3**: Disparar o orquestrador V2:
  - O orquestrador detecta que o snapshot lido na planilha difere da pré-condição causal (`expectedCurrentValue = 0`, mas a planilha possui `1`).
  - A operação transiciona para `CONFLICT_DETECTED` ou `RETRY_WAIT` com bloqueio causal.
  - Um registro é inserido em `sync_conflicts`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: Nenhuma escrita destrutiva ocorreu; o conflito foi formalmente registrado em `sync_conflicts`; nenhuma operação subsequente cega foi permitida para aquele campo.
  - **FAIL**: Sobrescrita silenciosa da alteração humana na planilha.

---

### Cenário 5: Pausa Operacional Imediata via Endpoint Administrativo
- **Objetivo**: Interromper imediatamente o processamento de lotes em caso de anomalia.
- **Passo 5.1**: Executar pausa:
  ```bash
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/pause" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "periodoId": 999, "motivo": "Homologação de emergência"}'
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
  curl -X POST "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/sync-v2/resume" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"integrationId": "integ-homolog-2026-2", "periodoId": 999}'
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
- **Passo 7.2**: Submeter alteração documental no D1 para o aluno `HOM-2001` e disparar despacho:
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

### Cenário 8: Rejeição Estrita de Payload Divergente com Idempotency Key Repetida (409)
- **Objetivo**: Proteger contra replay com mutação indevida de dados.
- **Passo 8.1**: Enviar mutação com uma chave de idempotência:
  ```bash
  curl -X PATCH "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/documentos/9003" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"titulo": 1, "idempotencyKey": "idemp-homolog-teste-888"}'
  ```
  - Resposta: HTTP 200 com a mutação aplicada.
- **Passo 8.2**: Reenviar a MESMA chave `idemp-homolog-teste-888`, porém com PAYLOAD DIFERENTE:
  ```bash
  curl -X PATCH "https://controle-documentos-homolog.<seu-subdominio>.workers.dev/api/documentos/9003" \
    -H "Content-Type: application/json" \
    -H "X-Sync-Admin-Secret: <SECRET>" \
    -d '{"titulo": 0, "residencia": 0, "idempotencyKey": "idemp-homolog-teste-888"}'
  ```
  - Resposta obrigatória: HTTP 409 com código `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **Critério de Aceite (Pass/Fail)**:
  - **PASS**: HTTP 409 imediato; nenhuma alteração gravada no banco; chave de idempotência respeitada.
  - **FAIL**: Aceitação da alteração divergente ou sobrescrita do evento original.

---

### Cenário 9: Conferência Completa de Aluno com Pendências
- **Objetivo**: Validar a transição de um aluno que possui pendências documentais até a entrega completa de todos os 7 documentos.
- **Passo 9.1**: O aluno `HOM-1002` (Beta) possui 7 documentos pendentes. Submeter a entrega de 6 documentos (deixando apenas o contrato pendente).
  - Verificar recalculo das fórmulas nas colunas J e K da planilha (`TOTAL = 6`, `STATUS = PENDENTE`).
- **Passo 9.2**: Submeter o 7º documento (contrato = 1):
  - Disparar despacho.
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

