# Controle de Documentos — Secretaria Acadêmica

Sistema corporativo de controle de documentação acadêmica de matrículas, com persistência transacional em banco de dados relacional distribuído (Cloudflare D1) e integração com planilhas institucionais do Google Sheets.

---

## 1. Visão Geral

- **Frontend:** SPA desenvolvida em React + TypeScript + Vite, estilizada conforme mockups institucionais com suporte a tema Claro e Escuro.
- **Backend / API:** Cloudflare Workers (TypeScript) rodando em ambiente serverless V8.
- **Banco de Dados:** Cloudflare D1 (SQLite distribuído com consistência serializável).
- **Sincronização Bidirecional V2:** Mecanismo transacional orientado a eventos (outbox, CAS, leases e reconciliação causal) entre D1 e Google Sheets.

---

## 2. Estrutura da Documentação (`docs/`)

Toda a documentação técnica, operacional e de homologação do projeto está centralizada no diretório [`docs/`](./docs/):

### 2.1 [Arquitetura (`docs/arquitetura/`)](./docs/arquitetura/)
- [**Implementação V3**](./docs/arquitetura/V3_IMPLEMENTACAO.md): Reconstrução da interface do usuário em React a partir dos mockups visuais, temas e responsividade.
- [**Cliente de API**](./docs/arquitetura/CLIENTE_API.md): Padrões e consumo centralizado do cliente `api.get`, `api.post` com tratamento unificado de erros de rede e autenticação.

### 2.2 [Sincronização V2 (`docs/sync-v2/`)](./docs/sync-v2/)
- [**Núcleo de Sincronização V2**](./docs/sync-v2/README.md): Arquitetura completa da V2 (F1 a F4 e P0.1 a P0.4), incluindo transações D1, outbox, idempotência estrita, adaptadores Google Sheets, fencing contra split-brain e reconciliação de conflitos humanos.

### 2.3 [Homologação (`docs/homologacao/`)](./docs/homologacao/)
- [**Roteiro de Homologação Isolada**](./docs/homologacao/ROTEIRO_HOMOLOGACAO_ISOLADA.md): Procedimento detalhado passo a passo cobrindo os 10 cenários de homologação integrada ponta a ponta com dados 100% fictícios.
- [**Variáveis de Ambiente e Segredos**](./docs/homologacao/SECRETS_E_VARIAVEIS.md): Relação completa de variáveis públicas (`vars`) e secrets Cloudflare (`wrangler secret put`) necessários para a homologação.

### 2.4 [Operação (`docs/operacao/`)](./docs/operacao/)
- [**Backup e Robustez do D1**](./docs/operacao/ROBUSTEZ_BACKUP.md): Diagnóstico, rotinas de backup com `backup-d1.ps1`, restauração, validação de integridade e requisitos LGPD.
- [**Escrita Segura no Google Sheets**](./docs/operacao/GOOGLE_SHEETS_ESCRITA_SEGURA.md): Regras de autoridade de dados, loteamento, concorrência e proteções contra corrupção de abas e fórmulas.

---

## 3. Desenvolvimento e Execução Local

### Pré-requisitos
- Node.js 18+ (ou 20+)
- npm
- Cloudflare Wrangler CLI

### Instalação de dependências
```bash
npm install
```

### Executar frontend em desenvolvimento
```bash
npm run dev
```

### Executar worker localmente (Miniflare / Wrangler)
```bash
npx wrangler dev
```

### Validações e Testes
```bash
# Executar a suíte de testes de sincronização V2
npm test

# Executar testes unitários do Apps Script
npm run test:apps-script

# Checagem estática de tipos (TypeScript)
npx tsc -b

# Linter
npm run lint

# Compilação de produção
npm run build
```
