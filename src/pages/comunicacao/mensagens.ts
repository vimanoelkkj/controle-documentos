import type { Grupo } from "./model";

export const ASSUNTO_PADRAO = "Documentação pendente - Matrícula";

export function criarTextoEmail(grupo: Grupo | undefined, prazo: string) {
  if (!grupo) return "";

  const temContrato = grupo.documentos.some(
    (documento) => documento.campo === "contrato",
  );

  return `⚠️ ATENÇÃO! NÃO RESPONDER A ESTE E-MAIL. MANDE A SUA RESPOSTA PARA O E-MAIL ABAIXO⬇️:

matriculadecalouro@fumec.br

Prezado(a), boa tarde.
Informo que em verificação ao nosso sistema a sua matrícula está pendente alguns documentos importantes. Peço que realize o envio dos mesmos o mais rápido possível via e-mail para matriculadecalouro@fumec.br ou, se preferir, pode comparecer pessoalmente na secretaria acadêmica até o dia ${prazo || "___/___"}. Informo que a não apresentação destes documentos poderá resultar no bloqueio da sua matrícula. Segue lista abaixo:

${grupo.documentos.map((documento) => `${documento.email};`).join("\n")}${
    temContrato
      ? `

Caso esteja pendente o CONTRATO DE MATRÍCULA assinado, você irá receber no seu e-mail o link para o portal de visualização e assinatura do contrato. Caso contrário, desconsidere as orientações.`
      : ""
  }`;
}

export function obterAssunto(assunto: string) {
  return assunto || ASSUNTO_PADRAO;
}

export function criarPacoteOutlook(
  emailsInstitucionais: string[],
  assunto: string,
  textoEmail: string,
) {
  return `CCO:
${emailsInstitucionais.join("; ")}

ASSUNTO:
${obterAssunto(assunto)}

MENSAGEM:
${textoEmail}`;
}
