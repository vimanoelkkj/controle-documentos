import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";

export type SheetsConfig = {
  spreadsheet_id: string;
  aba_base_face_fea: string;
  aba_base_fch_ead: string;
  aba_docs_face_fea: string;
  aba_docs_fch_ead: string;
  aba_cancelados_face_fea: string;
  aba_cancelados_fch_ead: string;
};

export type SheetsPrevia = {
  encontrados: number;
  documentos_encontrados: number;
  documentos_marcados: number;
  cancelados_encontrados: number;
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  prontos_para_cancelar: number;
  prontos_para_reativar: number;
  prontos_para_remover: number;
  ja_cancelados: number;
  alunos_sem_unidade: number;
  cursos_nao_mapeados: number;
  unidades_nao_resolvidas: number;
  detalhes_unidades: Array<{ ra: string; nome: string; curso: string }>;
  cursos_pendentes: Array<{
    curso: string;
    quantidade: number;
    alunos: Array<{ ra: string; nome: string }>;
  }>;
  detalhes: {
    novos: Array<{
      ra: string;
      nome: string;
      curso: string;
      unidade: string | null;
    }>;
    cadastros: Array<{ ra: string; nome: string; detalhe: string }>;
    documentos: Array<{ ra: string; nome: string; detalhe: string }>;
    cancelamentos: Array<{ ra: string; nome: string; unidade: string }>;
    reativacoes: Array<{ ra: string; nome: string; unidade: string }>;
    remocoes: Array<{ ra: string; nome: string; unidade: string }>;
  };
  modo: string;
};

export type SheetsStatus =
  | "carregando"
  | "configurado"
  | "nao_configurado"
  | "indisponivel";

export type AbaPrevia =
  | "novos"
  | "cadastros"
  | "documentos"
  | "cancelamentos"
  | "reativacoes"
  | "unidades"
  | "remocoes";

export type SheetsResultadoSync = {
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  cancelamentos: number;
  reativacoes: number;
  total_operacoes: number;
  remocoes: number;
};

type PeriodoAtual = {
  id: number;
  codigo: string;
};

type UseGoogleSheetsPeriodoParams = {
  periodoAtual: PeriodoAtual | null | undefined;
  recarregarPeriodos: () => Promise<void>;
};

const configVazia: SheetsConfig = {
  spreadsheet_id: "",
  aba_base_face_fea: "FACE - FEA 2026 - 2",
  aba_base_fch_ead: "FCH - EAD 2026 - 2",
  aba_docs_face_fea: "CONTROLE DE DOCUMENTOS FACE FEA",
  aba_docs_fch_ead: "CONTROLE DE DOCUMENTOS FCH EAD",
  aba_cancelados_face_fea: "CANCELADOS FACE - FEA 2026-2",
  aba_cancelados_fch_ead: "CANCELADOS FCH - EAD 2026-2",
};

export function useGoogleSheetsPeriodo({
  periodoAtual,
  recarregarPeriodos,
}: UseGoogleSheetsPeriodoParams) {
  const [sheetsConfig, setSheetsConfig] = useState<SheetsConfig>(configVazia);
  const [sheetsStatus, setSheetsStatus] = useState<SheetsStatus>("carregando");
  const [sheetsTitulo, setSheetsTitulo] = useState("");
  const [sheetsCarregando, setSheetsCarregando] = useState(false);
  const [sheetsErro, setSheetsErro] = useState("");
  const [sheetsPrevia, setSheetsPrevia] = useState<SheetsPrevia | null>(null);
  const [abaPrevia, setAbaPrevia] = useState<AbaPrevia | null>(null);
  const listaPreviaRef = useRef<HTMLDivElement | null>(null);

  const [mapeamentos, setMapeamentos] = useState<Record<string, string>>({});
  const [salvandoMapeamentos, setSalvandoMapeamentos] = useState(false);
  const [mapeamentosSalvos, setMapeamentosSalvos] = useState<
    Record<string, string>
  >({});

  const [modalSincronizar, setModalSincronizar] = useState(false);
  const [sincronizandoSheets, setSincronizandoSheets] = useState(false);
  const [resultadoSync, setResultadoSync] =
    useState<SheetsResultadoSync | null>(null);
  const [modalSucessoSync, setModalSucessoSync] = useState(false);
  const [mostrarAlteracoesSync, setMostrarAlteracoesSync] = useState(false);

  const sheetsSalvo = sheetsStatus === "configurado";

  useEffect(() => {
    if (!abaPrevia || abaPrevia === "unidades") return;
    listaPreviaRef.current?.scrollTo({ top: 0 });
  }, [abaPrevia]);

  useEffect(() => {
    if (!periodoAtual) return;
    const periodo = periodoAtual;
    let ativo = true;

    setSheetsPrevia(null);
    setAbaPrevia(null);
    setMapeamentos({});
    setMapeamentosSalvos({});
    setSheetsErro("");
    setSheetsTitulo("");
    setSheetsStatus("carregando");
    setModalSincronizar(false);
    setModalSucessoSync(false);

    async function carregarConfiguracao() {
      let ultimoErro: unknown = null;

      for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
        try {
          const config = await api.get<SheetsConfig | null>(
            `/api/periodos/${periodo.id}/google-sheets`,
          );

          if (!ativo) return;

          setSheetsConfig(
            config ?? {
              ...configVazia,
              aba_base_face_fea: `FACE - FEA ${periodo.codigo.replace("-", " - ")}`,
              aba_base_fch_ead: `FCH - EAD ${periodo.codigo.replace("-", " - ")}`,
              aba_cancelados_face_fea: `CANCELADOS FACE - FEA ${periodo.codigo}`,
              aba_cancelados_fch_ead: `CANCELADOS FCH - EAD ${periodo.codigo}`,
            },
          );

          setSheetsStatus(config ? "configurado" : "nao_configurado");

          if (config) {
            try {
              const dadosStatus = await api.get<{ titulo?: string | null }>(
                `/api/periodos/${periodo.id}/google-sheets/status`,
              );

              if (ativo) {
                setSheetsTitulo(dadosStatus.titulo?.trim() || "");
              }
            } catch {
              // O tÃ­tulo Ã© complementar; falha aqui nÃ£o invalida a configuraÃ§Ã£o.
            }
          }

          return;
        } catch (erro) {
          ultimoErro = erro;

          if (tentativa < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }

      if (!ativo) return;

      setSheetsStatus("indisponivel");
      setSheetsErro(
        ultimoErro instanceof Error
          ? `${ultimoErro.message} Tente novamente em alguns instantes.`
          : "Google Sheets temporariamente indisponÃ­vel. Tente novamente em alguns instantes.",
      );
    }

    void carregarConfiguracao();

    return () => {
      ativo = false;
    };
  }, [periodoAtual]);

  async function salvarSheets() {
    if (!periodoAtual) return;

    try {
      setSheetsCarregando(true);
      setSheetsErro("");
      setSheetsPrevia(null);

      const dados = await api.put<{ spreadsheet_id?: string }>(
        `/api/periodos/${periodoAtual.id}/google-sheets`,
        sheetsConfig,
      );

      setSheetsConfig((atual) => ({
        ...atual,
        spreadsheet_id: dados.spreadsheet_id || atual.spreadsheet_id,
      }));

      setSheetsStatus("configurado");

      try {
        const dadosStatus = await api.get<{ titulo?: string | null }>(
          `/api/periodos/${periodoAtual.id}/google-sheets/status`,
        );

        setSheetsTitulo(dadosStatus.titulo?.trim() || "");
      } catch {
        setSheetsTitulo("");
      }
    } catch (erro) {
      setSheetsErro(
        erro instanceof Error ? erro.message : "Erro ao salvar integraÃ§Ã£o.",
      );
    } finally {
      setSheetsCarregando(false);
    }
  }

  async function gerarPreviaSheets() {
    if (!periodoAtual) return;

    try {
      setSheetsCarregando(true);
      setSheetsErro("");
      setSheetsPrevia(null);

      const dados = await api.post<SheetsPrevia>(
        `/api/periodos/${periodoAtual.id}/google-sheets/previa`,
      );

      setSheetsPrevia(dados);
    } catch (erro) {
      setSheetsErro(
        erro instanceof Error ? erro.message : "Erro ao ler Google Sheets.",
      );
    } finally {
      setSheetsCarregando(false);
    }
  }

  const mapeamentosAlterados = useMemo(
    () =>
      Object.entries(mapeamentos).filter(
        ([curso, unidade]) =>
          Boolean(unidade) && unidade !== (mapeamentosSalvos[curso] || ""),
      ),
    [mapeamentos, mapeamentosSalvos],
  );

  async function salvarMapeamentos() {
    if (!periodoAtual || !mapeamentosAlterados.length) return;

    try {
      setSalvandoMapeamentos(true);
      setSheetsErro("");

      for (const [curso, unidade] of mapeamentosAlterados) {
        await api.put<{ sucesso: boolean }>(
          `/api/periodos/${periodoAtual.id}/google-sheets/mapeamentos`,
          { curso, unidade },
        );
      }

      setMapeamentosSalvos((atual) => ({
        ...atual,
        ...Object.fromEntries(mapeamentosAlterados),
      }));

      await gerarPreviaSheets();
      setAbaPrevia("unidades");
    } catch (erro) {
      setSheetsErro(
        erro instanceof Error ? erro.message : "Erro ao salvar os mapeamentos.",
      );
    } finally {
      setSalvandoMapeamentos(false);
    }
  }

  async function sincronizarSheets() {
    if (
      !periodoAtual ||
      !sheetsPrevia ||
      sheetsPrevia.unidades_nao_resolvidas > 0
    ) {
      return;
    }

    try {
      setSincronizandoSheets(true);
      setSheetsErro("");

      const dados = await api.post<SheetsResultadoSync>(
        `/api/periodos/${periodoAtual.id}/google-sheets/sincronizar`,
      );

      setModalSincronizar(false);

      await gerarPreviaSheets();
      await recarregarPeriodos();

      setResultadoSync(dados);
      setModalSucessoSync(true);
    } catch (erro) {
      setSheetsErro(
        erro instanceof Error
          ? erro.message
          : "Erro ao sincronizar Google Sheets.",
      );

      setModalSincronizar(false);
    } finally {
      setSincronizandoSheets(false);
    }
  }

  const novosJaCancelados = sheetsPrevia
    ? sheetsPrevia.detalhes.novos.filter((novo) =>
        sheetsPrevia.detalhes.cancelamentos.some(
          (cancelado) => cancelado.ra === novo.ra,
        ),
      ).length
    : 0;

  const totalOperacoesPrevia = sheetsPrevia
    ? sheetsPrevia.novos +
      sheetsPrevia.alteracoes_cadastrais +
      sheetsPrevia.documentos_alterados +
      sheetsPrevia.prontos_para_cancelar +
      sheetsPrevia.prontos_para_reativar +
      sheetsPrevia.prontos_para_remover +
      novosJaCancelados
    : 0;

  return {
    sheetsConfig,
    setSheetsConfig,
    sheetsStatus,
    sheetsTitulo,
    sheetsSalvo,
    sheetsCarregando,
    sheetsErro,
    sheetsPrevia,
    setSheetsPrevia,

    abaPrevia,
    setAbaPrevia,
    listaPreviaRef,

    mapeamentos,
    setMapeamentos,
    salvandoMapeamentos,
    mapeamentosSalvos,
    mapeamentosAlterados,

    modalSincronizar,
    setModalSincronizar,
    sincronizandoSheets,
    resultadoSync,
    setResultadoSync,
    modalSucessoSync,
    setModalSucessoSync,
    mostrarAlteracoesSync,
    setMostrarAlteracoesSync,

    salvarSheets,
    gerarPreviaSheets,
    salvarMapeamentos,
    sincronizarSheets,

    novosJaCancelados,
    totalOperacoesPrevia,
  };
}
