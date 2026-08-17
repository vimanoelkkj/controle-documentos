import { normalizarCampo } from "../../lib/texto";
import {
  detectarSeparador,
  interpretarContrato,
  normalizarCabecalho,
  obterIndiceCabecalho,
  separarLinhaCsv,
} from "./csv";
import type { Aluno, LinhaPreviaImportacao, Unidade } from "./model";

export function extrairRasCancelados(texto: string) {
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linha) => linha.trim());
  if (linhas.length < 2) {
    throw new Error("Cole o cabeçalho da planilha e pelo menos uma linha de aluno.");
  }

  const separador = detectarSeparador(linhas[0]);
  const cabecalhos = separarLinhaCsv(linhas[0], separador).map(normalizarCabecalho);
  const indiceRa = obterIndiceCabecalho(cabecalhos, ["ra", "registro academico", "registro do aluno"]);
  if (indiceRa === -1) throw new Error("Não encontrei a coluna RA na lista de cancelados.");

  return [...new Set(linhas.slice(1).map(
    (linha) => separarLinhaCsv(linha, separador)[indiceRa]?.trim() ?? "",
  ).filter(Boolean))];
}

export function analisarTextoImportacao(
  texto: string,
  alunosSalvos: Aluno[],
  unidadeImportacao: Unidade,
): LinhaPreviaImportacao[] {
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linha) => linha.trim());
  if (linhas.length < 2) {
    throw new Error("Cole o cabeçalho da planilha e pelo menos uma linha de aluno.");
  }

  const separador = detectarSeparador(linhas[0]);
  const cabecalhos = separarLinhaCsv(linhas[0], separador).map(normalizarCabecalho);
  const indiceRa = obterIndiceCabecalho(cabecalhos, ["ra", "registro academico", "registro do aluno"]);
  const indiceNome = obterIndiceCabecalho(cabecalhos, ["nome", "nome aluno", "aluno"]);
  const indiceCurso = obterIndiceCabecalho(cabecalhos, ["curso", "curso aluno"]);
  const indiceEmail = obterIndiceCabecalho(cabecalhos, ["email", "e mail", "email institucional", "e mail institucional"]);
  const indiceEmailOutro = obterIndiceCabecalho(cabecalhos, ["email outro", "e mail outro", "email alternativo", "e mail alternativo", "e mail (outro)", "email (outro)"]);
  const indiceContrato = obterIndiceCabecalho(cabecalhos, ["contrato"]);
  if (indiceRa === -1 || indiceNome === -1 || indiceCurso === -1) {
    throw new Error("Não encontrei as colunas obrigatórias RA, Nome e Curso.");
  }

  const ocorrenciasRa = new Map<string, number>();
  const alunos = linhas.slice(1).map((linha, indice) => {
    const colunas = separarLinhaCsv(linha, separador);
    const ra = colunas[indiceRa]?.trim() ?? "";
    const nome = colunas[indiceNome]?.trim() ?? "";
    const curso = colunas[indiceCurso]?.trim() ?? "";
    const email = indiceEmail >= 0 ? colunas[indiceEmail]?.trim() || undefined : undefined;
    const email_outro = indiceEmailOutro >= 0 ? colunas[indiceEmailOutro]?.trim() || undefined : undefined;
    const contrato = indiceContrato >= 0 ? interpretarContrato(colunas[indiceContrato] ?? "") : undefined;
    if (ra) ocorrenciasRa.set(ra, (ocorrenciasRa.get(ra) ?? 0) + 1);
    return { linha: indice + 2, ra, nome, curso, email, email_outro, contrato, status: "valido" as const };
  });

  return alunos.map((aluno) => {
    const camposFaltando: string[] = [];
    if (!aluno.ra) camposFaltando.push("RA");
    if (!aluno.nome) camposFaltando.push("Nome");
    if (!aluno.curso) camposFaltando.push("Curso");
    if (camposFaltando.length > 0) {
      return { ...aluno, status: "invalido" as const, motivo: `Campo(s) obrigatório(s): ${camposFaltando.join(", ")}` };
    }
    if ((ocorrenciasRa.get(aluno.ra) ?? 0) > 1) {
      return { ...aluno, status: "duplicado" as const, motivo: "RA repetido neste lote." };
    }

    const alunoSalvo = alunosSalvos.find((cadastrado) => cadastrado.ra === aluno.ra);
    if (!alunoSalvo) return aluno;
    const alteracoes: string[] = [];
    if (alunoSalvo.status === "CANCELADO") alteracoes.push("Status: CANCELADO → ATIVO");
    if (normalizarCampo(alunoSalvo.nome) !== normalizarCampo(aluno.nome)) alteracoes.push(`Nome: ${alunoSalvo.nome} → ${aluno.nome}`);
    if (normalizarCampo(alunoSalvo.curso) !== normalizarCampo(aluno.curso)) alteracoes.push(`Curso: ${alunoSalvo.curso} → ${aluno.curso}`);
    if (normalizarCampo(alunoSalvo.unidade) !== normalizarCampo(unidadeImportacao)) alteracoes.push(`Unidade: ${alunoSalvo.unidade} → ${unidadeImportacao}`);
    if (normalizarCampo(alunoSalvo.email) !== normalizarCampo(aluno.email)) alteracoes.push(`E-mail: ${alunoSalvo.email || "—"} → ${aluno.email || "—"}`);
    if (normalizarCampo(alunoSalvo.email_outro) !== normalizarCampo(aluno.email_outro)) alteracoes.push(`E-mail alternativo: ${alunoSalvo.email_outro || "—"} → ${aluno.email_outro || "—"}`);
    if (alteracoes.length > 0) return { ...aluno, status: "alterado" as const, motivo: alteracoes.join(" | ") };
    return { ...aluno, status: "igual" as const, motivo: "Cadastro já está atualizado." };
  });
}
