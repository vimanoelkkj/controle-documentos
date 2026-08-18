# Controle de Documentos V3

A interface desta versão foi reconstruída usando os HTMLs finais do Claude como fonte visual e estrutural.

- Frontend React reconstruído sobre a estrutura/classes dos mockups.
- CSS dos mockups preservado em `src/mockups/*.css` e aplicado às páginas correspondentes.
- Backend, Cloudflare Worker, D1, migrations e regras de negócio do projeto original foram preservados.
- Temas Claro e Escuro preservados.
- Responsividade segue os breakpoints definidos nos mockups.

## Observação

O pacote final de mockups não contém uma tela `auditoria-mockup.html`. Por isso, a rota de Auditoria mantém a implementação existente até que exista um mockup correspondente. Nenhum layout "Claude" foi inventado para essa tela.

## Validação

Foi realizada validação sintática de todos os arquivos `.ts`/`.tsx` com o parser do TypeScript. O build completo não pôde ser executado neste ambiente porque as dependências npm não estavam disponíveis localmente e a instalação pelo registry não foi concluída.

No ambiente local:

```powershell
npm.cmd install
npm.cmd run build
```

Para desenvolvimento, use frontend e Worker em terminais separados conforme a configuração atual do projeto.
