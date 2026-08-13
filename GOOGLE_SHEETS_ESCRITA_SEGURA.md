# Escrita segura Sistema → Google Sheets

## Autoridade dos dados

No fluxo de saída, o sistema é a autoridade para os registros que estão na caixa de saída:

- cadastro: nome, RA, curso, unidade e e-mails;
- documentos: identidade, CPF, certidão, residência, título, ensino médio e contrato;
- situação da matrícula: ativo ou cancelado;
- exclusão: uma pendência `REMOVER` limpa o registro correspondente nas abas integradas.

A planilha continua sendo uma fonte de entrada no fluxo Planilha → Sistema. Se houver um RA duplicado, em uma aba de grupo diferente do esperado ou com estrutura incompatível, a saída não tenta decidir automaticamente: a pendência recebe o estado `CONFLITO`.

## Proteções implementadas

1. Somente administradores podem iniciar o envio.
2. O administrador precisa digitar `SINCRONIZAR` na confirmação.
3. Períodos arquivados são bloqueados.
4. A planilha e as seis abas são relidas imediatamente antes da escrita.
5. A coluna de RA é validada antes da preparação do lote.
6. RAs duplicados e registros em abas inesperadas são bloqueados.
7. Cada pendência é preparada isoladamente; uma pendência com conflito não deixa alterações parciais no lote.
8. As pendências são reivindicadas com um identificador de execução para impedir dois envios concorrentes.
9. As alterações válidas são enviadas por uma única chamada `spreadsheets.values.batchUpdate` com entrada `RAW`.
10. Remoções limpam somente os valores de A:K, preservando formatação e validação de dados.
11. Falhas retornam as pendências para `ERRO`, com mensagem e contador de tentativas.
12. Sucessos mudam para `CONCLUIDA` e geram evento de auditoria.
13. Cada execução processa no máximo 200 pendências para manter a requisição limitada.
14. Itens presos em `ENVIANDO` por mais de quinze minutos voltam para `ERRO` e podem ser reenviados.

## Configuração necessária

O Worker usa a credencial já armazenada em `GOOGLE_SERVICE_ACCOUNT_JSON`, agora com o escopo:

```text
https://www.googleapis.com/auth/spreadsheets
```

A planilha deve estar compartilhada com o e-mail da conta de serviço com permissão de edição. A chave privada continua somente no secret do Worker e nunca é enviada ao navegador.

## Ativação recomendada

1. Fazer backup do D1.
2. Compartilhar uma cópia de teste da planilha com a conta de serviço como editora.
3. Configurar essa cópia em um período/banco de desenvolvimento.
4. Criar alterações controladas: cadastro, documentos, cancelamento, reativação e remoção.
5. Conferir a prévia na Auditoria.
6. Enviar e validar as seis abas.
7. Repetir o diagnóstico Planilha ↔ Sistema e confirmar zero divergências inesperadas.
8. Somente depois habilitar a planilha de produção.

## Limitação operacional

O teste automatizado local não chama a API real do Google. A primeira validação integrada deve ser feita exclusivamente em uma cópia da planilha e no ambiente de desenvolvimento.
