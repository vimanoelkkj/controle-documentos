import { useEffect, useMemo, useState } from "react";
import { copiar } from "../utils";
import { criarPacoteOutlook, obterAssunto } from "../mensagens";

export type TipoEmails = "institucional" | "alternativo" | "ambos";
type TipoLote = TipoEmails | "pacote";

export const LIMITE_DESTINATARIOS_OUTLOOK = 490;

type Params = {
  emailsInstitucionais: string[];
  emailsAlternativos: string[];
  emailsAmbos: string[];
  assunto: string;
  textoEmail: string;
  setFeedback: (valor: string) => void;
};

function dividirEmLotes(lista: string[]) {
  const lotes: string[][] = [];
  for (let indice = 0; indice < lista.length; indice += LIMITE_DESTINATARIOS_OUTLOOK) {
    lotes.push(lista.slice(indice, indice + LIMITE_DESTINATARIOS_OUTLOOK));
  }
  return lotes;
}

export function useAcoesComunicacao({
  emailsInstitucionais,
  emailsAlternativos,
  emailsAmbos,
  assunto,
  textoEmail,
  setFeedback,
}: Params) {
  const listas = useMemo(
    () => ({
      institucional: emailsInstitucionais,
      alternativo: emailsAlternativos,
      ambos: emailsAmbos,
    }),
    [emailsInstitucionais, emailsAlternativos, emailsAmbos],
  );

  const lotes = useMemo(
    () => ({
      institucional: dividirEmLotes(listas.institucional),
      alternativo: dividirEmLotes(listas.alternativo),
      ambos: dividirEmLotes(listas.ambos),
    }),
    [listas],
  );

  const [loteAtual, setLoteAtual] = useState<Record<TipoLote, number>>({
    institucional: 0,
    alternativo: 0,
    ambos: 0,
    pacote: 0,
  });

  // Os arrays de e-mail podem ganhar uma nova referência a cada render.
  // Usar o conteúdo como assinatura evita zerar o lote logo após cada clique.
  const assinaturaDestinatarios = useMemo(
    () => `${emailsInstitucionais.join("\u001f")}\u001e${emailsAlternativos.join("\u001f")}`,
    [emailsInstitucionais, emailsAlternativos, emailsAmbos],
  );

  useEffect(() => {
    setLoteAtual({ institucional: 0, alternativo: 0, ambos: 0, pacote: 0 });
  }, [assinaturaDestinatarios]);

  function obterResumoLotes(tipo: TipoLote) {
    const tipoLista: TipoEmails = tipo === "pacote" ? "institucional" : tipo;
    const quantidadeLotes = lotes[tipoLista].length;
    const indiceAtual = quantidadeLotes
      ? Math.min(loteAtual[tipo], quantidadeLotes - 1)
      : 0;

    return {
      quantidadeEmails: listas[tipoLista].length,
      quantidadeLotes,
      loteAtual: quantidadeLotes ? indiceAtual + 1 : 0,
      quantidadeNoLote: quantidadeLotes ? lotes[tipoLista][indiceAtual].length : 0,
    };
  }

  async function copiarEmails(tipo: TipoEmails) {
    const lotesDoTipo = lotes[tipo];

    if (!lotesDoTipo.length) {
      setFeedback("Nenhum e-mail válido nos alunos selecionados.");
      return;
    }

    const indiceAtual = Math.min(loteAtual[tipo], lotesDoTipo.length - 1);
    const lista = lotesDoTipo[indiceAtual];

    await copiar(lista.join("; "));

    const numeroLote = indiceAtual + 1;
    const totalLotes = lotesDoTipo.length;
    const temProximo = numeroLote < totalLotes;

    setFeedback(
      `✓ Lote ${numeroLote}/${totalLotes} copiado: ${lista.length} destinatário${
        lista.length === 1 ? "" : "s"
      } para colar no CCO do Outlook.${
        temProximo ? ` Próximo clique copia o lote ${numeroLote + 1}/${totalLotes}.` : " Todos os lotes foram copiados."
      }`,
    );

    if (temProximo) {
      setLoteAtual((atual) => ({ ...atual, [tipo]: indiceAtual + 1 }));
    } else {
      setLoteAtual((atual) => ({ ...atual, [tipo]: 0 }));
    }
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
    const lotesInstitucionais = lotes.institucional;

    if (!lotesInstitucionais.length) {
      setFeedback("Nenhum e-mail institucional válido nos alunos selecionados.");
      return;
    }

    const indiceAtual = Math.min(
      loteAtual.pacote,
      lotesInstitucionais.length - 1,
    );
    const lista = lotesInstitucionais[indiceAtual];
    const pacote = criarPacoteOutlook(lista, assunto, textoEmail);

    await copiar(pacote);

    const numeroLote = indiceAtual + 1;
    const totalLotes = lotesInstitucionais.length;
    const temProximo = numeroLote < totalLotes;

    setFeedback(
      `✓ Pacote Outlook ${numeroLote}/${totalLotes} copiado: ${lista.length} destinatário${
        lista.length === 1 ? "" : "s"
      }, assunto e mensagem.${
        temProximo ? ` Próximo clique copia o lote ${numeroLote + 1}/${totalLotes}.` : " Todos os lotes foram copiados."
      }`,
    );

    if (temProximo) {
      setLoteAtual((atual) => ({
        ...atual,
        pacote: indiceAtual + 1,
      }));
    } else {
      setLoteAtual((atual) => ({ ...atual, pacote: 0 }));
    }
  }

  return {
    copiarEmails,
    copiarComunicado,
    copiarAssunto,
    copiarPacoteOutlook,
    obterResumoLotes,
  };
}
