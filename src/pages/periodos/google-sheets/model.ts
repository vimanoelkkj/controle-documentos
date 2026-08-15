export type SheetsConfig = {
  spreadsheet_id: string;
  aba_base_face_fea: string;
  aba_base_fch_ead: string;
  aba_docs_face_fea: string;
  aba_docs_fch_ead: string;
  aba_cancelados_face_fea: string;
  aba_cancelados_fch_ead: string;
};

export type SheetsPrevia = {
  encontrados: number;
  documentos_encontrados: number;
  documentos_marcados: number;
  cancelados_encontrados: number;
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  prontos_para_cancelar: number;
  prontos_para_reativar: number;
  prontos_para_remover: number;
  ja_cancelados: number;
  alunos_sem_unidade: number;
  cursos_nao_mapeados: number;
  unidades_nao_resolvidas: number;
  detalhes_unidades: Array<{ ra: string; nome: string; curso: string }>;
  cursos_pendentes: Array<{
    curso: string;
    quantidade: number;
    alunos: Array<{ ra: string; nome: string }>;
  }>;
  detalhes: {
    novos: Array<{
      ra: string;
      nome: string;
      curso: string;
      unidade: string | null;
    }>;
    cadastros: Array<{ ra: string; nome: string; detalhe: string }>;
    documentos: Array<{ ra: string; nome: string; detalhe: string }>;
    cancelamentos: Array<{ ra: string; nome: string; unidade: string }>;
    reativacoes: Array<{ ra: string; nome: string; unidade: string }>;
    remocoes: Array<{ ra: string; nome: string; unidade: string }>;
  };
  modo: string;
};

export type SheetsStatus =
  | "carregando"
  | "configurado"
  | "nao_configurado"
  | "indisponivel";

export type AbaPrevia =
  | "novos"
  | "cadastros"
  | "documentos"
  | "cancelamentos"
  | "reativacoes"
  | "unidades"
  | "remocoes";

export type SheetsResultadoSync = {
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  cancelamentos: number;
  reativacoes: number;
  total_operacoes: number;
  remocoes: number;
};

export const configVazia: SheetsConfig = {
  spreadsheet_id: "",
  aba_base_face_fea: "FACE - FEA 2026 - 2",
  aba_base_fch_ead: "FCH - EAD 2026 - 2",
  aba_docs_face_fea: "CONTROLE DE DOCUMENTOS FACE FEA",
  aba_docs_fch_ead: "CONTROLE DE DOCUMENTOS FCH EAD",
  aba_cancelados_face_fea: "CANCELADOS FACE - FEA 2026-2",
  aba_cancelados_fch_ead: "CANCELADOS FCH - EAD 2026-2",
};
