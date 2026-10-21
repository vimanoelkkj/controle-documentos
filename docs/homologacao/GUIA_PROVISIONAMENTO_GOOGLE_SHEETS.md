# Guia de Provisionamento Google Sheets e Service Account — Homologação

**Documento:** Instruções de Provisionamento e Isolamento (P0.4)  
**Ambiente:** Homologação Isolada (`homolog`)  
**Branch:** `feat/matriculas-sync-automatica`  
**Objetivo:** Instruções detalhadas e reproduzíveis para criar a Service Account no Google Cloud com privilégio mínimo, provisionar a planilha exclusiva de testes e garantir que o adaptador e o scheduler jamais atinjam recursos de produção.

---

## 1. Princípios de Segurança e Privilégio Mínimo

Para assegurar isolamento completo entre o ambiente de testes e a produção:

1. **Privilégio Mínimo IAM**: A Service Account **não deve** receber nenhum papel administrativo (`Owner`, `Editor` ou `Viewer`) no nível do projeto do Google Cloud. Ela precisa apenas da API do Google Sheets habilitada no projeto.
2. **Controle de Acesso por Recurso (ACL)**: A Service Account acessa planilhas **estritamente** via ACL individual do Google Drive. Ela só consegue interagir com arquivos explicitamente compartilhados com o seu e-mail (`sa-homolog-controle-docs@...`).
3. **Impossibilidade de Contaminação de Produção**:
   - Mesmo que um operador configure por engano o ID de uma planilha de produção no banco de dados ou no Worker de homologação, qualquer requisição à API do Google Sheets falhará imediatamente com **HTTP 403 (PERMISSION_DENIED)**, pois a Service Account de homologação não possui acesso às planilhas reais.
   - O banco D1 de homologação (`controle-documentos-homolog-db`) opera com ID UUID independente e contém exclusivamente o período `999`.
   - O adaptador `GoogleSheetsRealAdapter` possui travas ativas contra escritas fora dos limites (colunas J e K com fórmulas são imutáveis; escrita apenas em célula única autorizada C:I).
   - O scheduler e o adaptador respeitam as flags mestre: `SYNC_V2_ENABLED=false` e `SYNC_V2_AUTO_ENABLED=false`.

---

## 2. Passo a Passo: Criação da Service Account no Google Cloud

Você pode executar os passos abaixo pelo Console Web do Google Cloud ou pelo terminal via `gcloud` CLI.

### Opção A: Via Terminal (`gcloud` CLI)

```bash
# 1. Definir o projeto GCP de testes/homologação
gcloud config set project <ID_DO_SEU_PROJETO_GCP>

# 2. Habilitar a API Google Sheets (caso não esteja ativa)
gcloud services enable sheets.googleapis.com

# 3. Criar a Service Account exclusiva para homologação
gcloud iam service-accounts create sa-homolog-controle-docs \
  --description="Service Account exclusiva para testes de homologacao do Controle de Documentos" \
  --display-name="Controle Docs - Homologacao V2"

# 4. Obter o e-mail da Service Account criada
SA_EMAIL=$(gcloud iam service-accounts list \
  --filter="name:sa-homolog-controle-docs" \
  --format="value(email)")
echo "Service Account Email: $SA_EMAIL"

# 5. Gerar e baixar a chave privada JSON (ARQUIVO PROTEGIDO)
gcloud iam service-accounts keys create credentials-homolog.json \
  --iam-account="$SA_EMAIL"

# 6. Restringir permissões de leitura do arquivo local
chmod 600 credentials-homolog.json
```

### Opção B: Via Google Cloud Console (Interface Web)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Selecione o projeto dedicado ou de testes.
3. No menu lateral, acesse **APIs e Serviços** > **Biblioteca**. Pesquise por `Google Sheets API` e clique em **Ativar**.
4. No menu lateral, acesse **IAM e Administrador** > **Contas de Serviço**.
5. Clique em **+ Criar conta de serviço**:
   - **Nome**: `sa-homolog-controle-docs`
   - **ID da conta de serviço**: `sa-homolog-controle-docs`
   - **Descrição**: `Service Account exclusiva para testes de homologacao do Controle de Documentos`
6. Clique em **Criar e Continuar**.
7. Na etapa **Conceder acesso deste recurso ao projeto (opcional)**, **NÃO selecione nenhum papel**. Deixe em branco para manter o privilégio estritamente mínimo. Clique em **Continuar** e depois em **Concluir**.
8. Na lista de contas de serviço, clique sobre o e-mail da conta recém-criada.
9. Acesse a aba **Chaves** > **Adicionar Chave** > **Criar nova chave**.
10. Escolha o formato **JSON** e clique em **Criar**. O download do arquivo será iniciado.
11. Renomeie o arquivo baixado para `credentials-homolog.json` e armazene-o de forma segura.

> [!CAUTION]
> **NUNCA** adicione o arquivo `credentials-homolog.json` ao repositório git. O arquivo `.gitignore` do projeto já está configurado para ignorar `*credentials*.json` e `*service-account*.json`.

---

## 3. Criação e Compartilhamento da Planilha Fictícia no Google Drive

1. Abra o [Google Drive](https://drive.google.com/) com a sua conta.
2. Crie uma nova planilha em branco:
   - Clique em **+ Novo** > **Planilhas Google** > **Planilha em branco**.
   - Defina o título da planilha como: `CONTROLE_DOCUMENTOS_HOMOLOG_2026_2`.
3. Copie o **Spreadsheet ID** da URL do navegador:
   - Formato da URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
   - Exemplo de ID: `1a2b3c4d5e6f7g8h9i0jKLMNOPQRSTUVWXYZ`
4. Compartilhe a planilha com a Service Account:
   - Clique no botão **Compartilhar** (canto superior direito).
   - No campo de e-mail, cole o e-mail da Service Account gerada (ex: `sa-homolog-controle-docs@<SEU_PROJETO>.iam.gserviceaccount.com`).
   - Papel: **Editor**.
   - Desmarque a opção "Notificar pessoas" e clique em **Compartilhar**.

---

## 4. Script Idempotente de Provisionamento

O script `scripts/homologacao/provisionar-sheets-homologacao.mjs` automatiza a preparação completa da planilha, aplicando:
- As 4 abas estruturais com seus cabeçalhos canônicos.
- Os 4 alunos fictícios alinhados ao D1 de homologação (`setup-homologacao.sql`).
- Regras de validação de dados para **Checkboxes nativos** nas colunas C:I (linhas 2 e 3).
- Formatação de texto (`@`) nas colunas de RA para preservação de zeros à esquerda.
- Fórmulas intocadas nas colunas J (`TOTAL ENTREGUES`) e K (`STATUS DOCUMENTAL`).

### 4.1 Validação em Modo Simulado (`--dry-run`)
Valida o template e monta todo o plano de requisições estruturais sem realizar chamadas externas:
```bash
node scripts/homologacao/provisionar-sheets-homologacao.mjs --dry-run
```

### 4.2 Teste de Isolamento e Privilégio Mínimo (`--test-isolation`)
Valida que a Service Account é rejeitada com HTTP 403/404 caso tente acessar qualquer recurso não autorizado:
```bash
node scripts/homologacao/provisionar-sheets-homologacao.mjs \
  --credentials=credentials-homolog.json \
  --test-isolation
```

### 4.3 Execução do Provisionamento Idempotente
Cria as abas, formatações, validações de checkboxes e insere os dados iniciais:
```bash
node scripts/homologacao/provisionar-sheets-homologacao.mjs \
  --spreadsheet-id=<SPREADSHEET_ID> \
  --credentials=credentials-homolog.json
```

### 4.4 Verificação de Conformidade (`--verify-only`)
Lê a planilha remota e atesta a conformidade de cabeçalhos, RAs e registros:
```bash
node scripts/homologacao/provisionar-sheets-homologacao.mjs \
  --spreadsheet-id=<SPREADSHEET_ID> \
  --credentials=credentials-homolog.json \
  --verify-only
```

---

## 5. Mapeamento dos Dados Fictícios (Planilha vs D1)

| Aluno | RA | Grupo | Situação Contratual (Base) | Documentos Entregues (C:I) | Fórmulas J/K |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ALUNO TESTE ALFA** | `0090001001` | `FACE_FEA` | `PENDENTE` | 6 entregues (Identidade, CPF, Certidão, Residência, Título, Ensino Médio), Contrato pendente | `J=6`, `K="PENDENTE"` |
| **ALUNO TESTE BETA** | `0090001002` | `FACE_FEA` | `PENDENTE` | 0 entregues (Todos pendentes) | `J=0`, `K="PENDENTE"` |
| **ALUNO TESTE GAMA** | `0090002001` | `FCH_EAD` | `PENDENTE` | 4 entregues (Identidade, CPF, Residência, Ensino Médio), 3 pendentes | `J=4`, `K="PENDENTE"` |
| **ALUNO TESTE DELTA** | `0090002002` | `FCH_EAD` | `ACEITO` | 7 entregues (Todos completos) | `J=7`, `K="COMPLETO"` |

---

## 6. Configuração no D1 de Homologação e no Worker (Próxima Rodada)

Após a criação da planilha e da Service Account pelo operador:

1. **Atualizar o ID da planilha no D1 de homologação**:
   ```bash
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE sync_integrations SET spreadsheet_id = '<SPREADSHEET_ID>' WHERE integration_id = 'integ-homolog-2026-2';"
   npx wrangler d1 execute controle-documentos-homolog-db --command="UPDATE google_sheets_periodos SET spreadsheet_id = '<SPREADSHEET_ID>' WHERE periodo_id = 999;"
   ```

2. **Injetar o segredo da Service Account no Worker de homologação**:
   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config config/homologacao/wrangler.homolog.jsonc
   ```

3. **Injetar o segredo administrativo da V2**:
   ```bash
   npx wrangler secret put SYNC_V2_ADMIN_SECRET --config config/homologacao/wrangler.homolog.jsonc
   ```

4. **Status das flags**:
   - `SYNC_V2_ENABLED` e `SYNC_V2_AUTO_ENABLED` permanecem `"false"`.
   - A ativação será realizada exclusivamente conforme os 10 cenários do [Roteiro de Homologação Integrada](./ROTEIRO_HOMOLOGACAO_ISOLADA.md).

