export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  description: string;
  items: Array<{ title: string; description: string }>;
};

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "3.0.0",
    date: "Agosto de 2026",
    title: "Redesign completo, mais leve e consistente",
    description:
      "A interface foi reconstruída para unificar a experiência, reduzir ruído visual e deixar as rotinas acadêmicas mais rápidas de operar.",
    items: [
      {
        title: "Novo design em todo o sistema",
        description:
          "Telas mais limpas, sem cards desnecessários, com tipografia, hierarquia e espaçamentos padronizados.",
      },
      {
        title: "Modais unificados",
        description:
          "Os fluxos de confirmação, integração, conflito e manutenção agora seguem a mesma linguagem flat do restante do site.",
      },
      {
        title: "Login redesenhado",
        description:
          "Tela de acesso alinhada à nova identidade visual, com temas, autofill e interações revisados.",
      },
      {
        title: "Menus e filtros consistentes",
        description:
          "Dropdowns, seletores, filtros e ações compartilham o mesmo comportamento e aparência em todas as telas.",
      },
      {
        title: "Código mais enxuto",
        description:
          "Componentes, estilos e funções sem uso ou duplicados foram removidos e helpers repetidos foram centralizados.",
      },
      {
        title: "Qualidade e estabilidade",
        description:
          "Lint zerado, suíte de testes preservada e ajustes de hooks, estados e interações para reduzir regressões.",
      },
    ],
  },
  {
    version: "2.0.1",
    date: "Agosto de 2026",
    title: "Controle mais seguro, rápido e rastreável",
    description:
      "Esta versão amplia a integração, a auditoria e as ferramentas de organização acadêmica.",
    items: [
      {
        title: "Google Planilhas com escrita segura",
        description:
          "Prévia, bloqueio de conflitos e sincronização controlada nos dois sentidos.",
      },
      {
        title: "Auditoria e caixa de saída",
        description:
          "Diagnóstico de divergências e acompanhamento das alterações aguardando envio.",
      },
      {
        title: "Cursos e unidades",
        description:
          "Correção em massa da unidade de um curso para todos os alunos do período.",
      },
      {
        title: "Períodos letivos",
        description:
          "Dados separados por período, com histórico preservado e alternância rápida.",
      },
      {
        title: "Três temas",
        description: "Experiência completa nos modos Claro, Escuro e Preto.",
      },
      {
        title: "Acesso mais protegido",
        description:
          "Gerenciamento seguro de usuários, sessões e operações administrativas.",
      },
    ],
  },
];

export const CURRENT_RELEASE = CHANGELOG[0];
export const APP_VERSION = CURRENT_RELEASE.version;
