export type Documento = {
  nome: string;
  entregue: boolean;
};

export type Aluno = {
  ra: string;
  nome: string;
  unidade: string;
  curso: string;
  email?: string | null;
  email_outro?: string | null;
  status: "ATIVO" | "CANCELADO";
  documentos: Documento[];
};

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

export type HistoricoLog = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
  usuario_id?: number | null;
  usuario_nome?: string | null;
  usuario_username?: string | null;
};

export type FormAluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  email: string;
  email_outro: string;
  documentos: {
    identidade: boolean;
    cpf: boolean;
    certidao: boolean;
    residencia: boolean;
    titulo: boolean;
    ensino_medio: boolean;
    contrato: boolean;
  };
};

export type Unidade = "FACE" | "FEA" | "FCH" | "EAD";
export type FiltroStatus = "ATIVO" | "CANCELADO" | "TODOS";

export type LinhaPreviaCancelado = {
  ra: string;
  nome?: string;
  curso?: string;
  unidade?: string;
  status?: "ATIVO" | "CANCELADO";
  status_previa: "PRONTO" | "JA_CANCELADO" | "NAO_ENCONTRADO" | "OUTRA_UNIDADE";
};

export type PreviaCancelados = {
  sucesso?: boolean;
  recebidos: number;
  prontos_para_cancelar: number;
  ja_cancelados: number;
  nao_encontrados: number;
  outra_unidade: number;
  alunos: LinhaPreviaCancelado[];
  erro?: string;
};

export type ResultadoCancelados = {
  sucesso?: boolean;
  recebidos: number;
  cancelados: number;
  ja_cancelados: number;
  nao_encontrados: number;
  outra_unidade: number;
  erro?: string;
};

export type AlunoImportacao = {
  ra: string;
  nome: string;
  curso: string;
  email?: string;
  email_outro?: string;
  contrato?: boolean;
};

export type LinhaPreviaImportacao = AlunoImportacao & {
  linha: number;
  status: "valido" | "alterado" | "igual" | "duplicado" | "invalido";
  motivo?: string;
};

export type ResultadoImportacao = {
  encontrados: number | unknown[];
  importados: number | unknown[];
  atualizados?: number | unknown[];
  sem_alteracoes?: number | unknown[];
  ja_cadastrados: number | unknown[];
  duplicados_no_lote: number | unknown[];
  invalidos: number | unknown[];
  detalhes?: unknown;
  erro?: string;
};

export function normalizarBusca(valor: string | null | undefined) {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function clonarAlunos(alunos: Aluno[]): Aluno[] {
  return alunos.map((aluno) => ({
    ...aluno,
    documentos: aluno.documentos.map((documento) => ({ ...documento })),
  }));
}

export function converterAlunosApi(dados: AlunoApi[]): Aluno[] {
  return dados.map((aluno) => ({
    ra: aluno.ra,
    nome: aluno.nome,
    unidade: aluno.unidade,
    curso: aluno.curso,
    email: aluno.email,
    email_outro: aluno.email_outro,
    status: aluno.status,
    documentos: [
      { nome: "ID", entregue: aluno.identidade === 1 },
      { nome: "CPF", entregue: aluno.cpf === 1 },
      { nome: "CERTIDÃO", entregue: aluno.certidao === 1 },
      { nome: "RESIDÊNCIA", entregue: aluno.residencia === 1 },
      { nome: "TÍTULO", entregue: aluno.titulo === 1 },
      { nome: "ENSINO MÉDIO", entregue: aluno.ensino_medio === 1 },
      { nome: "CONTRATO", entregue: aluno.contrato === 1 },
    ],
  }));
}

export const DOCUMENTO_DASHBOARD_POR_CAMPO: Record<string, string> = {
  identidade: "ID",
  cpf: "CPF",
  certidao: "CERTIDÃO",
  residencia: "RESIDÊNCIA",
  titulo: "TÍTULO",
  ensino_medio: "ENSINO MÉDIO",
  contrato: "CONTRATO",
};

export type StatusResumo = "COMPLETO" | "PARCIAL" | "CRITICO";

export function statusDocumentalAluno(aluno: Aluno): StatusResumo {
  const entregues = aluno.documentos.filter(
    (documento) => documento.entregue,
  ).length;

  if (entregues === aluno.documentos.length) return "COMPLETO";

  const historico = aluno.documentos.find(
    (documento) => documento.nome === "ENSINO MÉDIO",
  )?.entregue;
  const contrato = aluno.documentos.find(
    (documento) => documento.nome === "CONTRATO",
  )?.entregue;

  if (historico && contrato) return "PARCIAL";
  return "CRITICO";
}

export const formularioVazio: FormAluno = {
  ra: "",
  nome: "",
  curso: "",
  unidade: "FCH",
  email: "",
  email_outro: "",
  documentos: {
    identidade: false,
    cpf: false,
    certidao: false,
    residencia: false,
    titulo: false,
    ensino_medio: false,
    contrato: false,
  },
};
