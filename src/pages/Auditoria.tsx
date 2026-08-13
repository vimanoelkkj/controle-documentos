import { useCallback, useEffect, useMemo, useState } from "react";
import AppIcon from "../components/AppIcon";
import { useAuth } from "../contexts/AuthContext";
import { usePeriodo } from "../contexts/PeriodoContext";
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

function formatarData(valor: string) {
  const normalizado = valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`;
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Auditoria() {
  const { admin } = useAuth();
  const { periodoAtual } = usePeriodo();
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [busca, setBusca] = useState("");
  const [acao, setAcao] = useState("TODAS");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [diagnostico, setDiagnostico] = useState<DiagnosticoSheets | null>(null);
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
      const resposta = await fetch("/api/log?limit=500&scope=all", { cache: "no-store" });
      const dados = (await resposta.json()) as RegistroAuditoria[] | { erro?: string };
      if (!resposta.ok) {
        throw new Error(Array.isArray(dados) ? "Falha ao carregar auditoria." : dados.erro);
      }
      setRegistros(dados as RegistroAuditoria[]);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Falha ao carregar auditoria.");
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
      const dados = (await resposta.json()) as CaixaSaidaSheets & { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar a caixa de saída.");
      setCaixaSaida(dados);
    } catch (falha) {
      setErroCaixa(falha instanceof Error ? falha.message : "Falha ao carregar a caixa de saída.");
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
      const dados = (await resposta.json()) as DiagnosticoSheets & { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível comparar as bases.");
      setDiagnostico(dados);
    } catch (falha) {
      setErroDiagnostico(falha instanceof Error ? falha.message : "Falha ao comparar as bases.");
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
      if (!resposta.ok) throw new Error(dados.erro || "Falha ao escrever na planilha.");
      setResultadoEnvio(
        `✓ ${dados.enviados ?? 0} pendência(s) enviada(s); ${dados.conflitos ?? 0} conflito(s) bloqueado(s).`,
      );
      setConfirmandoEnvio(false);
      setConfirmacaoEnvio("");
      await Promise.all([carregarCaixaSaida(), carregar()]);
    } catch (falha) {
      setErroCaixa(falha instanceof Error ? falha.message : "Falha ao escrever na planilha.");
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

  const usuarios = new Set(registros.map((r) => r.usuario_id).filter(Boolean)).size;
  const semAutoria = registros.filter((r) => !r.usuario_id).length;
  const totalDivergencias = diagnostico
    ? diagnostico.novos + diagnostico.alteracoes_cadastrais +
      diagnostico.documentos_alterados + diagnostico.prontos_para_cancelar +
      diagnostico.prontos_para_reativar + diagnostico.prontos_para_remover
    : 0;
  const bloqueado = Boolean(diagnostico?.unidades_nao_resolvidas);
  const cursosNaoMapeados = diagnostico
    ? diagnostico.cursos_nao_mapeados ?? 0
    : 0;
  const alunosSemUnidade = diagnostico
    ? diagnostico.alunos_sem_unidade ?? diagnostico.unidades_nao_resolvidas
    : 0;

  return (
    <section className="audit-page">
      <header className="page-header audit-header">
        <div>
          <span>RASTREABILIDADE</span>
          <div className="page-title-row">
            <span className="page-title-icon"><AppIcon name="audit" size={22} /></span>
            <h1>Auditoria</h1>
          </div>
          <p>Quem fez o quê, quando e em qual registro do período selecionado.</p>
        </div>
        <button type="button" className="log-refresh" onClick={carregar}>
          <span aria-hidden="true">↻</span>
          Atualizar auditoria
        </button>
      </header>

      <section className={`audit-consistency ${bloqueado ? "blocked" : diagnostico ? "checked" : ""}`}>
        <div className="audit-consistency-head">
          <div>
            <span>PLANILHA ↔ SISTEMA</span>
            <strong>Diagnóstico de consistência · {periodoAtual?.codigo || "—"}</strong>
            <p>A comparação é somente leitura. Nenhum dado será alterado.</p>
          </div>
          <button type="button" onClick={verificarConsistencia} disabled={verificando || !periodoAtual}>
            {verificando ? "Comparando bases..." : diagnostico ? "Verificar novamente" : "Verificar agora"}
          </button>
        </div>

        {erroDiagnostico && <div className="audit-consistency-error">{erroDiagnostico}</div>}

        {diagnostico && (
          <>
            <div className="audit-consistency-status">
              <strong>
                {bloqueado
                  ? "Sincronização bloqueada"
                  : totalDivergencias
                    ? `${totalDivergencias} divergência(s) encontrada(s)`
                    : "Bases consistentes"}
              </strong>
              <span>
                {bloqueado
                  ? `${cursosNaoMapeados} curso(s) precisam ser mapeados, afetando ${alunosSemUnidade} aluno(s).`
                  : `${diagnostico.encontrados} aluno(s) analisado(s).`}
              </span>
            </div>
            <div className="audit-consistency-grid">
              {[
                ["Somente na planilha", diagnostico.novos, "new"],
                ["Cadastros diferentes", diagnostico.alteracoes_cadastrais, "change"],
                ["Documentos diferentes", diagnostico.documentos_alterados, "change"],
                ["A cancelar", diagnostico.prontos_para_cancelar, "warning"],
                ["A reativar", diagnostico.prontos_para_reativar, "change"],
                ["Somente no sistema", diagnostico.prontos_para_remover, "warning"],
                ["Cursos a mapear", cursosNaoMapeados, "blocked"],
              ].map(([rotulo, valor, classe]) => (
                <article className={String(classe)} key={String(rotulo)}>
                  <span>{rotulo}</span><strong>{valor}</strong>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="audit-outbox">
        <div className="audit-outbox-head">
          <div>
            <span>SISTEMA → PLANILHA</span>
            <strong>Caixa de saída · {periodoAtual?.codigo || "—"}</strong>
            <p>Prévia das alterações locais aguardando envio. A planilha não será modificada.</p>
          </div>
          <div className="audit-outbox-actions">
            <button type="button" onClick={() => void carregarCaixaSaida()} disabled={carregandoCaixa || enviandoCaixa || !periodoAtual}>
              {carregandoCaixa ? "Atualizando..." : "Atualizar prévia"}
            </button>
            {admin && Boolean(caixaSaida?.total) && (
              <button
                type="button"
                className="audit-outbox-send"
                onClick={() => {
                  setConfirmandoEnvio(true);
                  setConfirmacaoEnvio("");
                  setErroCaixa("");
                }}
                disabled={carregandoCaixa || enviandoCaixa || !periodoAtual}
              >
                Enviar à planilha
              </button>
            )}
          </div>
        </div>

        {erroCaixa ? (
          <div className="audit-consistency-error">{erroCaixa}</div>
        ) : resultadoEnvio ? (
          <div className="audit-outbox-success">{resultadoEnvio}</div>
        ) : caixaSaida && (
          <>
            <div className="audit-outbox-summary">
              <article><span>Pendências</span><strong>{caixaSaida.total}</strong></article>
              <article><span>A atualizar</span><strong>{caixaSaida.atualizar}</strong></article>
              <article><span>A remover</span><strong>{caixaSaida.remover}</strong></article>
              <article className={caixaSaida.conflitos ? "danger" : ""}><span>Conflitos</span><strong>{caixaSaida.conflitos}</strong></article>
              <article className={caixaSaida.erros ? "danger" : ""}><span>Erros</span><strong>{caixaSaida.erros}</strong></article>
            </div>

            {caixaSaida.pendencias.length === 0 ? (
              <div className="audit-outbox-empty">✓ Nenhuma alteração local aguardando envio.</div>
            ) : (
              <div className="audit-outbox-list">
                {caixaSaida.pendencias.map((item) => (
                  <article key={item.id}>
                    <span className={`audit-outbox-operation ${item.operacao.toLowerCase()}`}>{item.operacao}</span>
                    <div>
                      <strong>{item.aluno?.nome || `RA ${item.ra}`}</strong>
                      <span>RA {item.ra} · {item.aluno?.unidade || "—"} · {item.aluno?.curso || "registro removido"}</span>
                      <span className="audit-outbox-reasons">{item.motivos.join(" + ")}</span>
                      {item.aluno && item.motivos.includes("DOCUMENTOS") && (
                        <span className="audit-outbox-documents">
                          {Object.entries(item.aluno.documentos)
                            .filter(([, entregue]) => entregue)
                            .map(([nome]) => nome.replace("_", " ").toLocaleUpperCase("pt-BR"))
                            .join(" · ") || "Nenhum documento marcado como entregue"}
                        </span>
                      )}
                    </div>
                    <div>
                      <strong>{item.usuario_nome || "Sistema"}</strong>
                      <span>{formatarData(item.atualizado_em)}</span>
                    </div>
                    <span className={`audit-outbox-state ${item.status.toLowerCase()}`}>{item.status}</span>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {confirmandoEnvio && caixaSaida && (
        <div className="modal-overlay">
          <div className="modal-novo-aluno audit-sync-modal">
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">SISTEMA → GOOGLE SHEETS</span>
                <h2>Confirmar escrita na planilha</h2>
                <p>O sistema relerá as seis abas e bloqueará conflitos antes de escrever.</p>
              </div>
              <button
                type="button"
                className="modal-fechar"
                onClick={() => setConfirmandoEnvio(false)}
                disabled={enviandoCaixa}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="audit-sync-content">
              <div className="audit-sync-summary">
                <article><span>A atualizar</span><strong>{caixaSaida.atualizar}</strong></article>
                <article><span>A remover</span><strong>{caixaSaida.remover}</strong></article>
                <article><span>Total</span><strong>{caixaSaida.total}</strong></article>
              </div>
              <div className="audit-sync-warning">
                <strong>Alteração externa</strong>
                <span>
                  A operação modificará a planilha configurada para o período {periodoAtual?.codigo}.
                  RAs duplicados, abas trocadas e cabeçalhos incompatíveis serão bloqueados.
                </span>
              </div>
              <label className="audit-sync-confirm">
                <span>Digite <b>SINCRONIZAR</b> para confirmar</span>
                <input
                  value={confirmacaoEnvio}
                  onChange={(event) => setConfirmacaoEnvio(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  disabled={enviandoCaixa}
                />
              </label>
            </div>

            <div className="modal-acoes">
              <button type="button" className="botao-cancelar" onClick={() => setConfirmandoEnvio(false)} disabled={enviandoCaixa}>
                Cancelar
              </button>
              <button
                type="button"
                className="audit-sync-confirm-button"
                onClick={() => void enviarCaixaSaida()}
                disabled={enviandoCaixa || confirmacaoEnvio.trim().toUpperCase() !== "SINCRONIZAR"}
              >
                {enviandoCaixa ? "Validando e enviando..." : "Confirmar envio"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="audit-summary">
        <article><span>Eventos</span><strong>{registros.length}</strong></article>
        <article><span>Usuários identificados</span><strong>{usuarios}</strong></article>
        <article className={semAutoria ? "audit-warning" : ""}>
          <span>Sem autoria</span><strong>{semAutoria}</strong>
        </article>
      </div>

      <div className="audit-toolbar">
        <input
          type="search"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Buscar usuário, ação, RA ou unidade..."
        />
        <select value={acao} onChange={(event) => setAcao(event.target.value)}>
          <option value="TODAS">Todas as ações</option>
          {acoes.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
        <span>{filtrados.length} resultado(s)</span>
      </div>

      {carregando ? (
        <div className="log-state">Carregando auditoria...</div>
      ) : erro ? (
        <div className="log-state error">{erro}</div>
      ) : filtrados.length === 0 ? (
        <div className="log-state">Nenhum evento encontrado.</div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>Data</th><th>Responsável</th><th>Período</th><th>Ação</th><th>Registro</th><th>Descrição</th></tr></thead>
            <tbody>
              {filtrados.map((registro) => (
                <tr key={registro.id}>
                  <td><time>{formatarData(registro.criado_em)}</time></td>
                  <td>
                    <strong>{registro.usuario_nome || "Sistema/legado"}</strong>
                    {registro.usuario_username && <small>@{registro.usuario_username}</small>}
                  </td>
                  <td><span className="audit-period">{registro.periodo_codigo || "Global"}</span></td>
                  <td><span className="audit-action">{registro.acao}</span></td>
                  <td>
                    <strong>{registro.ra ? `RA ${registro.ra}` : registro.entidade}</strong>
                    {registro.unidade && <small>{registro.unidade}</small>}
                  </td>
                  <td>{registro.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default Auditoria;
