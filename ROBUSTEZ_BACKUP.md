# Robustez: backup e restauração do D1

## Diagnóstico do projeto

O Worker usa o binding `DB` para dois bancos D1 remotos:

- produção: `controle-documentos-db`;
- desenvolvimento: `controle-documentos-dev-db` (`--env dev`).

O repositório contém migrations para `alunos`, `documentos`, `comunicacoes`, `logs`, `periodos`, configuração/mapeamentos do Google Sheets, `usuarios` e `sessoes`. Há também um dump manual antigo, `backup-producao-antes-migrations.sql`, mas não existe rotina automatizada de backup, retenção, teste ou restauração.

### Inconsistência de esquema encontrada

O código atual lê e grava `alunos.status`, e o dump antigo já contém essa coluna. Entretanto, nenhuma migration versionada cria `alunos.status`. Portanto, reconstruir um banco apenas pelas migrations pode falhar. Antes de criar uma migration corretiva, confira o esquema real de produção e desenvolvimento com `scripts/validate-d1.ps1`; uma migration `ADD COLUMN` aplicada cegamente falharia onde a coluna já existe.

## O que o Google Sheets reconstrói

Quando todas as abas configuradas continuam disponíveis, a sincronização consegue reconstruir parcialmente:

- RA, nome e curso;
- unidade, após aplicar os mapeamentos de curso;
- e-mail institucional e outro e-mail, quando presentes nas abas;
- estado de documentos recebido/não recebido;
- cancelamento, com base nas abas de cancelados.

Isso não equivale a um backup. A sincronização depende da configuração e dos mapeamentos guardados no próprio D1 e não preserva IDs, timestamps nem histórico.

## Dados exclusivos ou não confiavelmente reconstruíveis pelo Sheets

- períodos letivos e seus estados;
- configuração das planilhas e nomes das abas;
- mapeamentos curso → unidade;
- usuários, perfis, ativação, nomes de usuário, hashes e salts de senha;
- sessões (descartáveis; após recuperação, é aceitável invalidá-las);
- logs/auditoria e autoria dos eventos;
- histórico de comunicações, assunto, prazo, destinatários e lista de RAs;
- IDs, datas de criação/atualização e alterações manuais feitas no sistema;
- e-mails ou estados documentais alterados no sistema depois da última leitura da planilha.

## Autenticação

As senhas não são armazenadas em texto: o Worker usa PBKDF2-HMAC-SHA-256 com salt aleatório e 100.000 iterações. As sessões usam tokens aleatórios; somente SHA-256 do token é persistido no D1, e o navegador recebe cookie `HttpOnly`. O dump integral contém hashes/salts, tokens de sessão derivados e dados pessoais, portanto deve ser criptografado em repouso, ter acesso restrito e nunca ser commitado.

A credencial da conta de serviço do Google fica em secret/variável do Worker, não no D1. Ela precisa de cópia segura separada; não deve ser incorporada ao dump. O arquivo `.dev.vars.dev` também é sensível e já está ignorado pelo Git.

## Procedimento de backup

No PowerShell, autenticado no Wrangler:

```powershell
.\scripts\backup-d1.ps1 -Environment production
.\scripts\backup-d1.ps1 -Environment dev
```

Cada execução cria um SQL e um arquivo `.sha256` em `backups/`, diretório ignorado pelo Git. Copie ambos para armazenamento criptografado fora do computador. Retenção sugerida: 7 diários, 4 semanais e 12 mensais, sujeita à política institucional e à LGPD.

Depois do primeiro backup, valide o esquema remoto sem alterar dados:

```powershell
.\scripts\validate-d1.ps1 -Database controle-documentos-db
.\scripts\validate-d1.ps1 -Database controle-documentos-dev-db -DevEnvironment
```

### Botão de backup no painel administrativo

O painel em **Configurações → Backup do banco** usa a API oficial do D1 e só é
exibido para administradores. Antes do deploy, configure as variáveis protegidas:

```powershell
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put D1_DATABASE_ID
```

Use um API Token dedicado, limitado à conta e ao D1 necessários, com a permissão
**D1 Edit**. A exportação administrativa não funciona apenas com **D1 Read**. O token fica no
Worker e nunca é enviado ao navegador. Ao concluir, o painel fornece um link
temporário da Cloudflare, válido por uma hora. O navegador pode abrir o SQL como
texto; nesse caso, use `Ctrl+S` para salvá-lo. Armazene-o de forma
criptografada; o site não mantém uma cópia permanente do arquivo.

## Procedimento seguro de restauração

1. Verifique que o SQL e o `.sha256` estão juntos.
2. Crie um banco D1 novo, com nome inequívoco, por exemplo `controle-documentos-restore-20260811`.
3. Faça primeiro a simulação:

```powershell
.\scripts\restore-d1.ps1 `
  -BackupFile .\backups\controle-documentos-db-AAAAMMDD-HHMMSS.sql `
  -TargetDatabase controle-documentos-restore-20260811 `
  -ConfirmTargetDatabase controle-documentos-restore-20260811
```

4. Repita acrescentando `-Execute`. O script bloqueia os nomes de produção e desenvolvimento, confirma o checksum e valida o esquema após importar.
5. Aponte um Worker de teste para o banco restaurado e confira login, períodos, totais por unidade, documentos, cancelados, comunicações e logs.
6. Somente depois da conferência, planeje uma troca controlada de binding. Preserve o banco anterior para rollback.

Nunca importe o dump diretamente no banco de produção. O caminho seguro é restauração paralela, validação e troca reversível.

## Próximos passos recomendados

1. Executar a validação somente leitura nos dois D1 remotos.
2. Gerar um backup novo de produção e guardar cópia criptografada externa.
3. Fazer um ensaio completo de restauração em banco separado.
4. Após confirmar o esquema real, criar uma baseline/migration idempotente que elimine a divergência de `alunos.status`.
5. Automatizar backups em ambiente protegido, com alerta de falha e teste periódico de restauração.
