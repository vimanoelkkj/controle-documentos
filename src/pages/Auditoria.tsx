import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/auth";
import { usePeriodo } from "../contexts/periodo";
import { ModalEnviarCaixaSaida } from "./auditoria/components/ModalEnviarCaixaSaida";
import { CaixaSaidaSheets } from "./auditoria/components/CaixaSaidaSheets";
import { DiagnosticoConsistencia } from "./auditoria/components/DiagnosticoConsistencia";
import "./Auditoria.css";

type DiagnosticoSheets = {
  encontrados: number;
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  prontos_para_cancelar: number;
  prontos_para_reativar: number;
  prontos_para_remover: number;
  alunos_sem_unidade: number;
  cursos_nao_mapeados: number;
  unidades_nao_resolvidas: number;
};

type PendenciaSheets = {
  id: number;
  ra: string;
  operacao: "ATUALIZAR" | "REMOVER";
  status: "PENDENTE" | "ENVIANDO" | "CONFLITO" | "ERRO";
  tentativas: number;
  ultimo_erro: string | null;
  motivos: string[];
  usuario_nome: string | null;
  usuario_username: string | null;
  atualizado_em: string;
  aluno: {
    nome: string;
    curso: string;
    unidade: string;
    status: string;
    documentos: Record<string, boolean>;
  } | null;
};

type CaixaSaidaSheets = {
  modo: "PREVIA_SOMENTE_LEITURA";
  total: number;
  atualizar: number;
  remover: number;
  conflitos: number;
  erros: number;
  pendencias: PendenciaSheets[];
};

function Auditoria() {
  const { admin } = useAuth();
  const { periodoAtual } = usePeriodo();
  const [diagnostico, setDiagnostico] = useState<DiagnosticoSheets | null>(
    null,
  );
  const [verificando, setVerificando] = useState(false);
  const [erroDiagnostico, setErroDiagnostico] = useState("");
  const [caixaSaida, setCaixaSaida] = useState<CaixaSaidaSheets | null>(null);
  const [carregandoCaixa, setCarregandoCaixa] = useState(false);
  const [erroCaixa, setErroCaixa] = useState("");
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [confirmacaoEnvio, setConfirmacaoEnvio] = useState("");
  const [enviandoCaixa, setEnviandoCaixa] = useState(false);
  const [resultadoEnvio, setResultadoEnvio] = useState("");

  const carregarCaixaSaida = useCallback(async () => {
    if (!periodoAtual) return;
    try {
      setCarregandoCaixa(true);
      setErroCaixa("");
      const resposta = await fetch(
        `/api/periodos/${periodoAtual.id}/google-sheets/pendencias`,
        { cache: "no-store" },
      );
      const dados = (await resposta.json()) as CaixaSaidaSheets & {
        erro?: string;
      };
      if (!resposta.ok)
        throw new Error(dados.erro || "Falha ao carregar a caixa de saída.");
      setCaixaSaida(dados);
    } catch (falha) {
      setErroCaixa(
        falha instanceof Error
          ? falha.message
          : "Falha ao carregar a caixa de saída.",
      );
    } finally {
      setCarregandoCaixa(false);
    }
  }, [periodoAtual]);

  useEffect(() => {
    setDiagnostico(null);
    setErroDiagnostico("");
    void carregarCaixaSaida();
  }, [carregarCaixaSaida]);

  useEffect(() => {
    if (!confirmandoEnvio) return;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [confirmandoEnvio]);

  async function verificarConsistencia() {
    if (!periodoAtual) return;
    try {
      setVerificando(true);
      setErroDiagnostico("");
      const resposta = await fetch(
        `/api/periodos/${periodoAtual.id}/google-sheets/previa`,
        { method: "POST" },
      );
      const dados = (await resposta.json()) as DiagnosticoSheets & {
        erro?: string;
      };
      if (!resposta.ok)
        throw new Error(dados.erro || "Não foi possível comparar as bases.");
      setDiagnostico(dados);
    } catch (falha) {
      setErroDiagnostico(
        falha instanceof Error ? falha.message : "Falha ao comparar as bases.",
      );
    } finally {
      setVerificando(false);
    }
  }

  async function enviarCaixaSaida() {
    if (!periodoAtual) return;
    try {
      setEnviandoCaixa(true);
      setErroCaixa("");
      setResultadoEnvio("");
      const resposta = await fetch(
        `/api/periodos/${periodoAtual.id}/google-sheets/pendencias`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmacao: confirmacaoEnvio }),
        },
      );
      const dados = (await resposta.json()) as {
        erro?: string;
        enviados?: number;
        conflitos?: number;
      };
      if (!resposta.ok)
        throw new Error(dados.erro || "Falha ao escrever na planilha.");
      setResultadoEnvio(
        `✓ ${dados.enviados ?? 0} pendência(s) enviada(s); ${dados.conflitos ?? 0} conflito(s) bloqueado(s).`,
      );
      setConfirmandoEnvio(false);
      setConfirmacaoEnvio("");
      await carregarCaixaSaida();
    } catch (falha) {
      setErroCaixa(
        falha instanceof Error
          ? falha.message
          : "Falha ao escrever na planilha.",
      );
      setConfirmandoEnvio(false);
      setConfirmacaoEnvio("");
    } finally {
      setEnviandoCaixa(false);
    }
  }

  const totalDivergencias = diagnostico
    ? diagnostico.novos +
      diagnostico.alteracoes_cadastrais +
      diagnostico.documentos_alterados +
      diagnostico.prontos_para_cancelar +
      diagnostico.prontos_para_reativar +
      diagnostico.prontos_para_remover
    : 0;
  const bloqueado = Boolean(diagnostico?.unidades_nao_resolvidas);
  const cursosNaoMapeados = diagnostico
    ? (diagnostico.cursos_nao_mapeados ?? 0)
    : 0;
  const alunosSemUnidade = diagnostico
    ? (diagnostico.alunos_sem_unidade ?? diagnostico.unidades_nao_resolvidas)
    : 0;

  return (
    <section className="audit-page">
      <div className="audit-overview">
        <CaixaSaidaSheets
          admin={admin}
          periodoDisponivel={Boolean(periodoAtual)}
          caixaSaida={caixaSaida}
          carregandoCaixa={carregandoCaixa}
          enviandoCaixa={enviandoCaixa}
          erroCaixa={erroCaixa}
          resultadoEnvio={resultadoEnvio}
          aoAtualizar={carregarCaixaSaida}
          aoAbrirEnvio={() => {
            setConfirmandoEnvio(true);
            setConfirmacaoEnvio("");
            setErroCaixa("");
          }}
          sidebarExtra={
            <DiagnosticoConsistencia
              diagnostico={diagnostico}
              periodoCodigo={periodoAtual?.codigo}
              verificando={verificando}
              erroDiagnostico={erroDiagnostico}
              bloqueado={bloqueado}
              totalDivergencias={totalDivergencias}
              cursosNaoMapeados={cursosNaoMapeados}
              alunosSemUnidade={alunosSemUnidade}
              aoVerificar={verificarConsistencia}
              periodoDisponivel={Boolean(periodoAtual)}
            />
          }
        />
      </div>

      {confirmandoEnvio && caixaSaida && (
        <ModalEnviarCaixaSaida
          caixaSaida={caixaSaida}
          periodoCodigo={periodoAtual?.codigo}
          confirmacaoEnvio={confirmacaoEnvio}
          setConfirmacaoEnvio={setConfirmacaoEnvio}
          enviandoCaixa={enviandoCaixa}
          aoFechar={() => setConfirmandoEnvio(false)}
          aoEnviar={enviarCaixaSaida}
        />
      )}

    </section>
  );
}

export default Auditoria;
