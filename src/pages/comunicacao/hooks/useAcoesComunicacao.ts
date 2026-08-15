import { copiar } from "../utils";
import { criarPacoteOutlook, obterAssunto } from "../mensagens";

type TipoEmails = "institucional" | "alternativo" | "ambos";

type Params = {
  emailsInstitucionais: string[];
  emailsAlternativos: string[];
  assunto: string;
  textoEmail: string;
  setFeedback: (valor: string) => void;
};

export function useAcoesComunicacao({
  emailsInstitucionais,
  emailsAlternativos,
  assunto,
  textoEmail,
  setFeedback,
}: Params) {
  async function copiarEmails(tipo: TipoEmails) {
    let lista: string[] = [];

    if (tipo === "institucional") lista = emailsInstitucionais;
    if (tipo === "alternativo") lista = emailsAlternativos;
    if (tipo === "ambos") {
      lista = [...new Set([...emailsInstitucionais, ...emailsAlternativos])];
    }

    if (!lista.length) {
      setFeedback("Nenhum e-mail válido nos alunos selecionados.");
      return;
    }

    await copiar(lista.join("; "));
    setFeedback(
      `✓ ${lista.length} e-mail${lista.length === 1 ? "" : "s"} copiado${
        lista.length === 1 ? "" : "s"
      } para colar no CCO do Outlook.`,
    );
  }

  async function copiarComunicado() {
    await copiar(textoEmail);
    setFeedback("✓ Texto do comunicado copiado.");
  }

  async function copiarAssunto() {
    await copiar(obterAssunto(assunto));
    setFeedback("✓ Assunto copiado.");
  }

  async function copiarPacoteOutlook() {
    if (!emailsInstitucionais.length) {
      setFeedback("Nenhum e-mail institucional válido nos alunos selecionados.");
      return;
    }

    const pacote = criarPacoteOutlook(
      emailsInstitucionais,
      assunto,
      textoEmail,
    );

    await copiar(pacote);
    setFeedback(
      `✓ Pacote Outlook copiado: ${emailsInstitucionais.length} destinatário${
        emailsInstitucionais.length === 1 ? "" : "s"
      }, assunto e mensagem.`,
    );
  }

  return {
    copiarEmails,
    copiarComunicado,
    copiarAssunto,
    copiarPacoteOutlook,
  };
}
