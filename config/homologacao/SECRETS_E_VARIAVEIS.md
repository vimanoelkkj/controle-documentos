# Variáveis de Ambiente e Segredos — Ambiente de Homologação Isolado

Este documento detalha todas as variáveis de ambiente e segredos requeridos para a execução da homologação da Sincronização V2 do **Controle de Documentos**.

---

## 1. Variáveis Públicas (`vars` no `wrangler.homolog.jsonc`)

| Variável | Valor Padrão | Descrição |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `"homolog"` | Identificador do ambiente isolado. |
| `SYNC_V2_ENABLED` | `"false"` | **Feature Flag mestre**. Inicialmente desativada. Controla a permissão de despacho e processamento V2. |
| `SYNC_V2_DISPATCH_TIMEOUT_MS` | `"25000"` | Limite de tempo em milissegundos para a execução do ciclo de despacho por lote (default 25s). |
| `SYNC_V2_BATCH_SIZE` | `"20"` | Quantidade máxima de operações da outbox processadas por ciclo de despacho. |
| `SYNC_V2_LEASE_DURATION_MS` | `"30000"` | Duração da lease atômica no D1 para prevenção de split-brain entre instâncias/workers. |
| `SYNC_V2_DEFAULT_INTEGRATION_ID` | `"integ-homolog-2026-2"` | ID da integração padrão usada para testes administrativos quando não especificado. |

---

## 2. Segredos Requeridos (`wrangler secret put`)

Os segredos **nunca** devem ser commitados no repositório. Devem ser injetados exclusivamente no Cloudflare Worker de homologação através do Wrangler:

### 2.1 `SYNC_ADMIN_SECRET`
- **Finalidade**: Chave administrativa para autenticação de chamadas M2M ou endpoints administrativos (`POST /api/sync-v2/dispatch`, `POST /api/sync-v2/pause`, `POST /api/sync-v2/resume`) enviados com o header `X-Sync-Admin-Secret`.
- **Como gerar**:
  ```bash
  openssl rand -hex 32
  ```
- **Como configurar**:
  ```bash
  npx wrangler secret put SYNC_ADMIN_SECRET --config config/homologacao/wrangler.homolog.jsonc
  ```

### 2.2 `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- **Finalidade**: Email da conta de serviço (Service Account) criada no Google Cloud IAM exclusiva para homologação.
- **Exemplo**: `sync-v2-homolog@seu-projeto-gcp-homolog.iam.gserviceaccount.com`
- **Como configurar**:
  ```bash
  npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL --config config/homologacao/wrangler.homolog.jsonc
  ```

### 2.3 `GOOGLE_PRIVATE_KEY`
- **Finalidade**: Chave privada RSA (formato PEM contendo `-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----`) associada à Service Account.
- **Como configurar**:
  ```bash
  npx wrangler secret put GOOGLE_PRIVATE_KEY --config config/homologacao/wrangler.homolog.jsonc
  ```

---

## 3. Checklist de Isolamento Obrigatório

Antes de aplicar qualquer configuração:
- [ ] O banco D1 utilizado deve ser **exclusivamente** `controle-documentos-homolog-db`. Nunca use o D1 de desenvolvimento ou de produção.
- [ ] A Service Account do Google Cloud deve ter permissão de edição **apenas** nas planilhas de teste de homologação. Nunca conceder acesso ao Drive raiz da instituição nem a planilhas reais de matrículas.
- [ ] A flag `SYNC_V2_ENABLED` deve permanecer `"false"` até o momento explícito da etapa 1 do roteiro de testes.
