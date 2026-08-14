import { useMemo } from "react";
import {
  DOCUMENTO_DASHBOARD_POR_CAMPO,
  normalizarBusca,
  statusDocumentalAluno,
  type Aluno,
  type FiltroStatus,
  type Unidade,
} from "../model";

type FiltroDocumental = "COMPLETO" | "PARCIAL" | "CRITICO" | "";

type UseFiltrosConferenciaParams = {
  alunosSalvos: Aluno[];
  alunosEmEdicao: Aluno[];
  raSelecionado: string;
  busca: string;
  filtroStatus: FiltroStatus;
  unidadeSelecionada: Unidade | "";
  filtroDocumentalDashboard: FiltroDocumental;
  pendenciasDashboard: string[];
};

export function useFiltrosConferencia({
  alunosSalvos,
  alunosEmEdicao,
  raSelecionado,
  busca,
  filtroStatus,
  unidadeSelecionada,
  filtroDocumentalDashboard,
  pendenciasDashboard,
}: UseFiltrosConferenciaParams) {
  return useMemo(() => {
    const termo = normalizarBusca(busca);

    const correspondeFiltroStatus = (aluno: Aluno) =>
      filtroStatus === "TODOS" || aluno.status === filtroStatus;

    const alunosNoStatus = alunosEmEdicao.filter(correspondeFiltroStatus);

    const quantidadesPorUnidade = {
      FACE: alunosNoStatus.filter((aluno) => aluno.unidade === "FACE").length,
      FEA: alunosNoStatus.filter((aluno) => aluno.unidade === "FEA").length,
      FCH: alunosNoStatus.filter((aluno) => aluno.unidade === "FCH").length,
      EAD: alunosNoStatus.filter((aluno) => aluno.unidade === "EAD").length,
    };

    const temFiltroDashboard = Boolean(
      filtroDocumentalDashboard || pendenciasDashboard.length > 0,
    );

    const alunoCorrespondeFiltroDashboard = (aluno: Aluno) => {
      if (
        filtroDocumentalDashboard &&
        statusDocumentalAluno(aluno) !== filtroDocumentalDashboard
      ) {
        return false;
      }

      if (pendenciasDashboard.length > 0) {
        const pendenciasSelecionadas = new Set(
          pendenciasDashboard.map(
            (campo) => DOCUMENTO_DASHBOARD_POR_CAMPO[campo],
          ),
        );

        const pendenciasDoAluno = aluno.documentos
          .filter((documento) => !documento.entregue)
          .map((documento) => documento.nome);

        const correspondeExatamente =
          pendenciasDoAluno.length === pendenciasSelecionadas.size &&
          pendenciasDoAluno.every((nome) =>
            pendenciasSelecionadas.has(nome),
          );

        if (!correspondeExatamente) return false;
      }

      return true;
    };

    const alunosFiltrados = alunosSalvos
      .filter((aluno) => {
        const pertenceUnidade = unidadeSelecionada
          ? aluno.unidade === unidadeSelecionada
          : true;

        const pertenceStatus = correspondeFiltroStatus(aluno);
        const pertenceDashboard = alunoCorrespondeFiltroDashboard(aluno);

        const textoBuscaAluno = normalizarBusca(
          [aluno.nome, aluno.ra, aluno.curso, aluno.email, aluno.email_outro]
            .filter(Boolean)
            .join(" "),
        );

        const correspondeBusca =
          !termo || textoBuscaAluno.includes(termo);

        return (
          pertenceUnidade &&
          pertenceStatus &&
          pertenceDashboard &&
          correspondeBusca
        );
      })
      .sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR", {
          sensitivity: "base",
        }),
      );

    const temAlunoSelecionadoNoFiltro = alunosSalvos.some(
      (aluno) =>
        aluno.ra === raSelecionado &&
        (unidadeSelecionada
          ? aluno.unidade === unidadeSelecionada
          : true) &&
        correspondeFiltroStatus(aluno) &&
        alunoCorrespondeFiltroDashboard(aluno),
    );

    const descricaoFiltroDashboard = filtroDocumentalDashboard
      ? filtroDocumentalDashboard === "COMPLETO"
        ? "Documentação completa"
        : filtroDocumentalDashboard === "PARCIAL"
          ? "Parcialmente completa"
          : "Documentação crítica"
      : pendenciasDashboard.length > 0
        ? `${pendenciasDashboard
            .map((campo) => DOCUMENTO_DASHBOARD_POR_CAMPO[campo])
            .join(" + ")} pendente(s)`
        : "";

    return {
      alunosNoStatus,
      quantidadesPorUnidade,
      temFiltroDashboard,
      alunosFiltrados,
      temAlunoSelecionadoNoFiltro,
      descricaoFiltroDashboard,
    };
  }, [
    alunosSalvos,
    alunosEmEdicao,
    raSelecionado,
    busca,
    filtroStatus,
    unidadeSelecionada,
    filtroDocumentalDashboard,
    pendenciasDashboard,
  ]);
}