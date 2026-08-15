export type AlunoApi = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

export type DocumentoDef = {
  campo: keyof Pick<
    AlunoApi,
    | "identidade"
    | "cpf"
    | "certidao"
    | "residencia"
    | "titulo"
    | "ensino_medio"
    | "contrato"
  >;
  curto: string;
  email: string;
  prioritario?: boolean;
};

export type Grupo = {
  chave: string;
  documentos: DocumentoDef[];
  alunos: AlunoApi[];
};

export type HistoricoComunicacao = {
  id: number;
  criado_em: string;
  grupo_chave: string;
  unidade: string;
  documentos: string[];
  quantidade_alunos: number;
  quantidade_emails: number;
  assunto: string;
  prazo: string;
  tipo_destinatario: string;
  ras: string[];
};

export const DOCUMENTOS: DocumentoDef[] = [
  {
    campo: "identidade",
    curto: "Identidade",
    email: "IDENTIDADE",
  },
  {
    campo: "cpf",
    curto: "CPF",
    email: "CPF",
  },
  {
    campo: "certidao",
    curto: "Certidão de Registro Civil",
    email: "CERTIDÃO DE REGISTRO CIVIL (NASCIMENTO OU CASAMENTO)",
  },
  {
    campo: "residencia",
    curto: "Comprovante de Residência",
    email: "COMPROVANTE DE RESIDÊNCIA",
  },
  {
    campo: "titulo",
    curto: "Título de Eleitor",
    email: "TÍTULO DE ELEITOR",
  },
  {
    campo: "ensino_medio",
    curto: "Histórico do Ensino Médio",
    email: "HISTÓRICO ESCOLAR DO ENSINO MÉDIO (DOCUMENTO PRIORITÁRIO)",
    prioritario: true,
  },
  {
    campo: "contrato",
    curto: "Contrato",
    email: "CONTRATO DE MATRÍCULA (DOCUMENTO PRIORITÁRIO)",
    prioritario: true,
  },
];
