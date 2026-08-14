import { api } from "../../lib/api";

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
