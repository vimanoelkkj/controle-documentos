# Sincronização Bidirecional V2 (Cloudflare D1 ↔ Google Sheets)

Este documento descreve a arquitetura técnica, as garantias e o funcionamento do subsistema de Sincronização V2 do **Controle de Documentos**, projetado para garantir consistência causal estrita durante o período de matrículas.

---

## 1. Visão Geral da Arquitetura

A sincronização V2 substitui o mecanismo legado (V1) por uma arquitetura orientada a eventos e outbox transacional no Cloudflare D1, com despacho desacoplado para a API do Google Sheets.

```
+-----------------------------------------------------------------------------------+
| INTERFACE DO USUÁRIO (React / Vite)                                               |
+-----------------------------------------------------------------------------------+
       │  (PUT /api/alunos/:ra/documentos com X-Idempotency-Key)
       ▼
+-----------------------------------------------------------------------------------+
| ENDPOINTS TRANSACIONAIS (src/server/routes/documentos.ts)                         |
|   1. Validação de Idempotência (sync_commands - 422 em divergência de payload)     |
|   2. Transação Atômica Única no D1:                                               |
|      - Atualiza tabela `documentos` (estado consolidado da UI)                    |
|      - Atualiza `sync_field_state` (revisão e histórico documental)               |
|      - Insere evento em `sync_events`                                             |
|      - Insere operação pendente na outbox `sync_operations`                       |
+-----------------------------------------------------------------------------------+
       │                                                      ▲
       ▼ (Outbox no D1)                                       │ (Fluxo Inverso)
+----------------------------------------------------+        │
| ORQUESTRADOR DE SINCRONIZAÇÃO (SyncV2Orchestrator) |        │
|   - Reivindicação atômica de operações             |        │
|   - Fencing contra split-brain e timeouts          |        │
|   - Verificação CAS contra edições externas        |        │
+----------------------------------------------------+        │
       │                                                      │
       ▼ (HTTPS / OAuth2 Service Account)                     │
+-----------------------------------------------------------------------------------+
| GOOGLE SHEETS API (v4)                                                            |
|   - Outbound: Escrita determinística em células C:I                               |
|   - Inbound: Leitura incremental / Reconciliação (sync-inbound-reconciler)        |
|   - Fórmulas J e K totalmente preservadas                                         |
+-----------------------------------------------------------------------------------+
```

---

## 2. Camadas do Núcleo V2

### 2.1 Núcleo Transacional e Outbox (F1-A / F1-B)
- **Tabelas D1:** `sync_integrations`, `sync_records`, `sync_field_state`, `sync_commands`, `sync_events`, `sync_operations`, `sync_receipts`, `sync_attempts`, `sync_conflicts`.
- **Atomicidade Total:** Nenhuma alteração documental é visível na interface sem que a respectiva operação esteja gravada na outbox, e vice-versa.
- **Idempotência Estrita:** Replays com a mesma chave e payload retornam resposta em cache (200); requisições com a mesma chave e payload diferente são sumariamente rejeitadas com **HTTP 422** (`Chave de idempotência reutilizada com payload divergente`).

### 2.2 Ingestão Inbound e Fluxo Inverso (Sheets → D1)
- **Serviço:** `src/server/services/sync-inbound-reconciler.ts`.
- **Endpoint Administrativo:** `POST /api/periodos/:id/sync-v2/inbound`.
- **Ausência de Eco:** Ingestões externas atualizam `documentos` e `sync_field_state` sem gerar novas operações pendentes na outbox para a planilha.
- **Detecção de Concorrência F3:** Se houver operação local em trânsito (`PENDING`, `CLAIMED`, `RETRY_WAIT`, `UNCERTAIN`), o campo é preservado e um conflito formal é aberto em `sync_conflicts`.

### 2.2 Contratos e Adaptador Sheets (F2)
- **Range Documental:** Colunas C até I da aba de controle (`identidade`, `cpf_documento`, `certidao`, `residencia`, `titulo`, `ensino_medio`, `contrato`).
- **Fórmulas Preservadas:** As colunas J e K contêm fórmulas (`=CONT.SE(...)`, `=SE(...)`) e nunca são lidas nem sobrescritas pelo adaptador.
- **Normalização Canônica:** Valores aceitos na planilha são convertidos deterministicamente para `0`, `1` ou `null`.

### 2.3 Reconciliação Causal e Fencing (F3 / F4)
- **Detecção de Conflitos (F3):** Antes de qualquer escrita na planilha, o adaptador valida o valor atual observado com a pré-condição registrada. Divergências causadas por edições manuais geram `CONFLICT_DETECTED` e bloqueiam o campo até resolução explícita.
- **Fencing de Leases (F4):** Múltiplos workers disputando lotes utilizam CAS e `lease_epoch` no D1. Workers que perdem sua lease durante a chamada HTTP são terminantemente rejeitados com `FENCING_REJECTED`, impedindo escritas zumbis.

### 2.4 Baseline Seeder (P0.2)
- Rotina idempotente para inicialização de alunos existentes em períodos letivos.
- Compara D1 com snapshots do Sheets sem presunção de igualdade, gerando evidências completas e relatório de divergências.

### 2.5 Controle Administrativo e Homologação (P0.3 / P0.4)
- **Feature Flag Mestre:** `SYNC_V2_ENABLED = "false"` por padrão.
- **Autorização:** Exige papel `ADMIN` do usuário da sessão ou `X-Sync-Admin-Secret`.
- **Modos de Operação:** `SHADOW`, `CAPTURE`, `BIDIRECTIONAL`, `PAUSED`, `QUARANTINED`.
- **Retomada Segura:** O endpoint `/resume` preserva o modo anterior a partir dos logs de auditoria e nunca assume `BIDIRECTIONAL` sem seleção explícita.

### 2.6 Scheduler Automático e Coordenação Persistente (P0.5)
- **Serviço Coordenador:** `src/server/services/sync-coordinator.ts`.
- **Coordenação no D1:** Tabela `sync_coordinator_leases` com `lease_epoch` monotônico anti-split brain entre instâncias/workers.
- **Ordem de Execução Estrita:** Inbound (Captura Causal) antes de Outbound (Despacho com CAS).
- **Contratos por Modo:**
  - `BIDIRECTIONAL`: Inbound ativo e Outbound ativo.
  - `CAPTURE`: Inbound ativo e Outbound desativado.
  - `SHADOW`: Inbound em simulação (`dryRun=true`) e Outbound simulado.
  - `PAUSED` / `QUARANTINED` / `LEGACY`: Execução ignorada pelo scheduler (`SKIPPED_NOT_ELIGIBLE`).
- **Feature Flags Seguras:** Exige `SYNC_V2_ENABLED = "true"` E `SYNC_V2_AUTO_ENABLED = "true"`.
- **Cron Trigger:** `*/5 * * * *` (5 minutos) configurado exclusivamente no ambiente de homologação isolado (`config/homologacao/wrangler.homolog.jsonc`).

---

## 3. Documentação Relacionada

- [Roteiro de Homologação Integrada (11 Cenários)](../homologacao/ROTEIRO_HOMOLOGACAO_ISOLADA.md)
- [Variáveis de Ambiente e Segredos de Homologação](../homologacao/SECRETS_E_VARIAVEIS.md)
- [Procedimentos de Backup e Robustez do D1](../operacao/ROBUSTEZ_BACKUP.md)
- [Regras de Escrita Segura no Google Sheets](../operacao/GOOGLE_SHEETS_ESCRITA_SEGURA.md)

