import { api } from "../../lib/api";
import type { FormAluno } from "./model";

type RespostaCadastroAluno = {
  sucesso?: boolean;
  ra?: string;
  id?: number;
};

type RespostaEdicaoAluno = {
  sucesso?: boolean;
  ra?: string;
};

type RespostaStatusAluno = {
  sucesso?: boolean;
  status?: "ATIVO" | "CANCELADO";
};

type RespostaExclusaoAluno = {
  sucesso?: boolean;
};

type DocumentosAlunoPayload = {
  identidade: boolean;
  cpf: boolean;
  certidao: boolean;
  residencia: boolean;
  titulo: boolean;
  ensino_medio: boolean;
  contrato: boolean;
};

export async function registrarLogAluno(
  acao: string,
  descricao: string,
  ra?: string,
  unidade?: string,
) {
  try {
    await api.post("/api/log", {
      acao,
      entidade: "ALUNO",
      descricao,
      ra,
      unidade,
    });
  } catch (erro) {
    console.error("Não foi possível registrar o LOG.", erro);
  }
}

export function cadastrarAluno(dados: FormAluno) {
  return api.post<RespostaCadastroAluno>("/api/alunos", dados);
}

export function editarAluno(raAtual: string, dados: FormAluno) {
  return api.put<RespostaEdicaoAluno>(
    `/api/alunos/${encodeURIComponent(raAtual)}`,
    dados,
  );
}

export function alterarStatusAluno(
  ra: string,
  status: "ATIVO" | "CANCELADO",
) {
  return api.put<RespostaStatusAluno>(
    `/api/alunos/${encodeURIComponent(ra)}/status`,
    { status },
  );
}

export function excluirAluno(ra: string) {
  return api.delete<RespostaExclusaoAluno>(
    `/api/alunos/${encodeURIComponent(ra)}`,
  );
}

export function salvarDocumentosAluno(
  ra: string,
  documentos: DocumentosAlunoPayload,
) {
  return api.put(
    `/api/alunos/${encodeURIComponent(ra)}/documentos`,
    documentos,
  );
}