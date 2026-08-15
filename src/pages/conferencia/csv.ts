export function normalizarCabecalho(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-_()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function interpretarContrato(valor: string): boolean | undefined {
  const texto = normalizarCabecalho(valor);

  if (!texto) return undefined;

  if (
    ["1", "sim", "s", "true", "verdadeiro", "entregue", "ok", "x"].includes(
      texto,
    )
  ) {
    return true;
  }

  if (
    ["0", "nao", "n", "false", "falso", "pendente", "nao entregue"].includes(
      texto,
    )
  ) {
    return false;
  }

  return undefined;
}

export function detectarSeparador(linha: string) {
  const candidatos = ["\t", ";", ","];
  let melhor = "\t";
  let maiorQuantidade = -1;

  for (const separador of candidatos) {
    const quantidade = linha.split(separador).length;

    if (quantidade > maiorQuantidade) {
      maiorQuantidade = quantidade;
      melhor = separador;
    }
  }

  return melhor;
}

export function separarLinhaCsv(linha: string, separador: string) {
  const colunas: string[] = [];
  let atual = "";
  let dentroAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const caractere = linha[i];

    if (caractere === '"') {
      if (dentroAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        dentroAspas = !dentroAspas;
      }
      continue;
    }

    if (caractere === separador && !dentroAspas) {
      colunas.push(atual.trim());
      atual = "";
      continue;
    }

    atual += caractere;
  }

  colunas.push(atual.trim());
  return colunas;
}

export function obterIndiceCabecalho(
  cabecalhos: string[],
  possibilidades: string[],
) {
  return cabecalhos.findIndex((cabecalho) =>
    possibilidades.includes(cabecalho),
  );
}
