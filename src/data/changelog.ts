export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  description: string;
  items: Array<{ title: string; description: string }>;
};

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "2.0.1",
    date: "Agosto de 2026",
    title: "Controle mais seguro, rápido e rastreável",
    description: "Esta versão amplia a integração, a auditoria e as ferramentas de organização acadêmica.",
    items: [
      { title: "Google Planilhas com escrita segura", description: "Prévia, bloqueio de conflitos e sincronização controlada nos dois sentidos." },
      { title: "Auditoria e caixa de saída", description: "Diagnóstico de divergências e acompanhamento das alterações aguardando envio." },
      { title: "Cursos e unidades", description: "Correção em massa da unidade de um curso para todos os alunos do período." },
      { title: "Períodos letivos", description: "Dados separados por período, com histórico preservado e alternância rápida." },
      { title: "Três temas", description: "Experiência completa nos modos Claro, Escuro e Preto." },
      { title: "Acesso mais protegido", description: "Gerenciamento seguro de usuários, sessões e operações administrativas." },
    ],
  },
];

export const CURRENT_RELEASE = CHANGELOG[0];
export const APP_VERSION = CURRENT_RELEASE.version;
