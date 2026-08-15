import { useCallback, useEffect, useMemo, useState } from "react";
import AppIcon from "../components/AppIcon";
import { useAuth } from "../contexts/auth";
import { usePeriodo } from "../contexts/periodo";
import { ModalEnviarCaixaSaida } from "./auditoria/components/ModalEnviarCaixaSaida";
import { CaixaSaidaSheets } from "./auditoria/components/CaixaSaidaSheets";
import { DiagnosticoConsistencia } from "./auditoria/components/DiagnosticoConsistencia";
import { ListaAuditoria } from "./auditoria/components/ListaAuditoria";
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

type RegistroAuditoria = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_username: string | null;
  periodo_codigo?: string | null;
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
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [busca, setBusca] = useState("");
  const [acao, setAcao] = useState("TODAS");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
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

  async function carregar() {
    try {
      setCarregando(true);
      setErro("");
      const resposta = await fetch("/api/log?limit=500&scope=all", {
        cache: "no-store",
      });
      const dados = (await resposta.json()) as
        | RegistroAuditoria[]
        | { erro?: string };
      if (!resposta.ok) {
        throw new Error(
          Array.isArray(dados) ? "Falha ao carregar auditoria." : dados.erro,
        );
      }
      setRegistros(dados as RegistroAuditoria[]);
    } catch (falha) {
      setErro(
        falha instanceof Error ? falha.message : "Falha ao carregar auditoria.",
      );
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

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
      await Promise.all([carregarCaixaSaida(), carregar()]);
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

  const acoes = useMemo(
    () => [...new Set(registros.map((registro) => registro.acao))].sort(),
    [registros],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return registros.filter((registro) => {
      if (acao !== "TODAS" && registro.acao !== acao) return false;
      if (!termo) return true;
      return [
        registro.acao,
        registro.entidade,
        registro.descricao,
        registro.ra,
        registro.unidade,
        registro.usuario_nome,
        registro.usuario_username,
        registro.periodo_codigo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(termo);
    });
  }, [acao, busca, registros]);

  const usuarios = new Set(registros.map((r) => r.usuario_id).filter(Boolean))
    .size;
  const semAutoria = registros.filter((r) => !r.usuario_id).length;
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
      <header className="page-header audit-header">
        <div>
          <span>RASTREABILIDADE</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="audit" size={22} />
            </span>
            <h1>Auditoria</h1>
          </div>
          <p>
            Quem fez o quê, quando e em qual registro do período selecionado.
          </p>
        </div>
        <button type="button" className="log-refresh" onClick={carregar}>
          <span aria-hidden="true">↻</span>
          Atualizar auditoria
        </button>
      </header>

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

      <CaixaSaidaSheets
        admin={admin}
        periodoCodigo={periodoAtual?.codigo}
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
      />

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

      <ListaAuditoria
        registros={registros}
        filtrados={filtrados}
        usuarios={usuarios}
        semAutoria={semAutoria}
        busca={busca}
        setBusca={setBusca}
        acao={acao}
        setAcao={setAcao}
        acoes={acoes}
        carregando={carregando}
        erro={erro}
      />
    </section>
  );
}

export default Auditoria;
