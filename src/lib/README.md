# Cliente compartilhado de API

Use `api.get`, `api.post`, `api.put` e `api.delete` nas páginas em vez de
repetir chamadas diretas a `fetch`.

O cliente centraliza:

- leitura segura de JSON e respostas vazias;
- mensagens de erro retornadas pelo backend;
- erros de rede por meio de `ApiError`;
- metadados `status`, `code` e `temporary`;
- envio de cookies com `credentials: "same-origin"`;
- encerramento global do estado autenticado ao receber HTTP 401.

Migração inicial: `src/pages/Log.tsx`.

As demais páginas devem ser migradas gradualmente, validando uma tela por vez
no ambiente DEV.
