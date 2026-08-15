import { DOCUMENTOS, type AlunoApi, type Grupo } from "./model";

export function normalizarEmail(valor: string | null | undefined) {
  const email = (valor || "").trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function formatarPrazo(valor: string) {
  const numeros = valor.replace(/\D/g, "").slice(0, 4);

  if (numeros.length <= 2) return numeros;

  return `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
}

export function criarGrupos(alunos: AlunoApi[]): Grupo[] {
  const mapa = new Map<string, Grupo>();

  alunos
    .filter((aluno) => aluno.status === "ATIVO")
    .forEach((aluno) => {
      const pendentes = DOCUMENTOS.filter(
        (documento) => aluno[documento.campo] !== 1,
      );

      if (pendentes.length === 0) return;

      const chave = DOCUMENTOS.map((documento) =>
        aluno[documento.campo] === 1 ? "0" : "1",
      ).join("");

      const existente = mapa.get(chave);

      if (existente) {
        existente.alunos.push(aluno);
      } else {
        mapa.set(chave, {
          chave,
          documentos: pendentes,
          alunos: [aluno],
        });
      }
    });

  return [...mapa.values()]
    .map((grupo) => ({
      ...grupo,
      alunos: [...grupo.alunos].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    }))
    .sort(
      (a, b) =>
        b.alunos.length - a.alunos.length ||
        a.documentos.length - b.documentos.length,
    );
}

export async function copiar(texto: string) {
  await navigator.clipboard.writeText(texto);
}
