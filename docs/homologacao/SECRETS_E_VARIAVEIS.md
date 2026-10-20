# Variáveis de Ambiente e Segredos — Ambiente de Homologação Isolado

Este documento detalha todas as variáveis de ambiente e segredos requeridos para a execução da homologação da Sincronização V2 do **Controle de Documentos**.

---

## 1. Variáveis Públicas (`vars` no `wrangler.homolog.jsonc`)

| Variável | Valor Padrão | Descrição |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `"homolog"` | Identificador do ambiente isolado. |
| `SYNC_V2_ENABLED` | `"false"` | **Feature Flag mestre**. Inicialmente desativada. Controla a permissão de despacho e processamento V2. |
| `SYNC_V2_AUTO_ENABLED` | `"false"` | **Feature Flag de Scheduler**. Desativada por padrão. Controla a execução automática periódica via Cron Trigger. |
| `SYNC_V2_DISPATCH_TIMEOUT_MS` | `"25000"` | Limite de tempo em milissegundos para a execução do ciclo de despacho por lote (default 25s). |
| `SYNC_V2_BATCH_SIZE` | `"20"` | Quantidade máxima de operações da outbox processadas por ciclo de despacho. |
| `SYNC_V2_LEASE_DURATION_MS` | `"30000"` | Duração da lease atômica no D1 para prevenção de split-brain entre instâncias/workers. |
| `SYNC_V2_DEFAULT_INTEGRATION_ID` | `"integ-homolog-2026-2"` | ID da integração padrão usada para testes administrativos quando não especificado. |

---

## 2. Segredos Requeridos (`wrangler secret put`)

Os segredos **nunca** devem ser commitados no repositório. Devem ser injetados exclusivamente no Cloudflare Worker de homologação através do Wrangler:

### 2.1 `SYNC_V2_ADMIN_SECRET`
- **Finalidade**: Chave administrativa para autenticação de chamadas M2M ou endpoints administrativos (`POST /api/periodos/:id/sync-v2/dispatch`, `pause`, `resume`) enviados com o header `X-Sync-Admin-Secret`. (O backend também aceita `SYNC_ADMIN_SECRET` como fallback de compatibilidade).
- **Como gerar**:
  ```bash
  openssl rand -hex 32
  ```
- **Como configurar**:
  ```bash
  npx wrangler secret put SYNC_V2_ADMIN_SECRET --config config/homologacao/wrangler.homolog.jsonc
  ```

### 2.2 `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Finalidade**: JSON completo da chave privada da Conta de Serviço (Service Account) criada no Google Cloud IAM exclusiva para homologação. O Worker extrai diretamente `client_email` e `private_key` do objeto JSON.
- **Formato esperado**: Arquivo `.json` baixado diretamente do Google Cloud Console (contendo `"type": "service_account"`, `"client_email"`, `"private_key"`, etc.).
- **Como configurar**:
  - Opção A (via pipe no terminal):
    ```bash
    cat credentials-homolog.json | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config config/homologacao/wrangler.homolog.jsonc
    ```
  - Opção B (interativo):
    ```bash
    npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config config/homologacao/wrangler.homolog.jsonc
    ```
    (cole o conteúdo JSON minificado de uma única linha ou em bloco).

---

## 3. Checklist de Isolamento Obrigatório

Antes de aplicar qualquer configuração:
- [ ] O banco D1 utilizado deve ser **exclusivamente** `controle-documentos-homolog-db`. Nunca use o D1 de desenvolvimento ou de produção.
- [ ] A Service Account do Google Cloud deve ter permissão de edição **apenas** nas planilhas de teste de homologação. Nunca conceder acesso ao Drive raiz da instituição nem a planilhas reais de matrículas.
- [ ] A flag `SYNC_V2_ENABLED` deve permanecer `"false"` até o momento explícito da etapa 1 do roteiro de testes.

Consulte o [Roteiro de Homologação Integrada (10 Cenários)](./ROTEIRO_HOMOLOGACAO_ISOLADA.md) para o procedimento de execução.

