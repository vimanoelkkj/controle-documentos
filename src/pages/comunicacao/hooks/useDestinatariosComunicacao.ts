import { useMemo } from "react";
import type { Grupo, HistoricoComunicacao } from "../model";
import { normalizarEmail } from "../utils";

type Params = {
  grupo: Grupo | undefined;
  buscaAluno: string;
  selecionados: Set<string>;
  historico: HistoricoComunicacao[];
};

export function useDestinatariosComunicacao({
  grupo,
  buscaAluno,
  selecionados,
  historico,
}: Params) {
  const alunosVisiveis = useMemo(() => {
    if (!grupo) return [];

    const termo = buscaAluno.trim().toLocaleLowerCase("pt-BR");

    return grupo.alunos.filter(
      (aluno) =>
        !termo ||
        `${aluno.nome} ${aluno.ra} ${aluno.curso} ${aluno.email || ""} ${
          aluno.email_outro || ""
        }`
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
    );
  }, [grupo, buscaAluno]);

  const alunosSelecionados =
    grupo?.alunos.filter((aluno) => selecionados.has(aluno.ra)) || [];

  const emailsInstitucionais = [
    ...new Set(
      alunosSelecionados
        .map((aluno) => normalizarEmail(aluno.email))
        .filter(Boolean),
    ),
  ];

  const emailsAlternativos = [
    ...new Set(
      alunosSelecionados
        .map((aluno) => normalizarEmail(aluno.email_outro))
        .filter(Boolean),
    ),
  ];

  const selecionadosComInstitucional = alunosSelecionados.filter((aluno) =>
    normalizarEmail(aluno.email),
  ).length;

  const selecionadosSemInstitucional =
    alunosSelecionados.length - selecionadosComInstitucional;

  const emailsInstitucionaisBrutos = alunosSelecionados
    .map((aluno) => (aluno.email || "").trim())
    .filter(Boolean);

  const emailsInstitucionaisInvalidos = emailsInstitucionaisBrutos.filter(
    (email) => !normalizarEmail(email),
  );

  const emailsInstitucionaisDuplicados =
    emailsInstitucionaisBrutos.length -
    new Set(emailsInstitucionaisBrutos.map((email) => email.toLowerCase()))
      .size;

  const validacaoOk =
    alunosSelecionados.length > 0 &&
    selecionadosSemInstitucional === 0 &&
    emailsInstitucionaisInvalidos.length === 0;

  const cobrancasDaCombinacao = useMemo(
    () => historico.filter((registro) => registro.grupo_chave === grupo?.chave),
    [historico, grupo?.chave],
  );

  const cobrancasPorRa = useMemo(() => {
    const mapa = new Map<
      string,
      {
        quantidade: number;
        ultima: string;
      }
    >();

    cobrancasDaCombinacao.forEach((registro) => {
      (registro.ras || []).forEach((ra) => {
        const atual = mapa.get(ra);

        if (!atual) {
          mapa.set(ra, {
            quantidade: 1,
            ultima: registro.criado_em,
          });

          return;
        }

        atual.quantidade += 1;

        if (new Date(registro.criado_em) > new Date(atual.ultima)) {
          atual.ultima = registro.criado_em;
        }
      });
    });

    return mapa;
  }, [cobrancasDaCombinacao]);

  const alunosJaCobrados =
    grupo?.alunos.filter((aluno) => cobrancasPorRa.has(aluno.ra)) || [];

  const alunosNaoCobrados =
    grupo?.alunos.filter((aluno) => !cobrancasPorRa.has(aluno.ra)) || [];

  const ultimaCobrancaGrupo = cobrancasDaCombinacao[0]?.criado_em || "";

  const temContrato =
    grupo?.documentos.some((documento) => documento.campo === "contrato") ??
    false;

  return {
    alunosVisiveis,
    alunosSelecionados,
    emailsInstitucionais,
    emailsAlternativos,
    selecionadosComInstitucional,
    selecionadosSemInstitucional,
    emailsInstitucionaisInvalidos,
    emailsInstitucionaisDuplicados,
    validacaoOk,
    cobrancasPorRa,
    alunosJaCobrados,
    alunosNaoCobrados,
    ultimaCobrancaGrupo,
    temContrato,
  };
}
