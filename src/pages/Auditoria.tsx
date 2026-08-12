import { useEffect, useMemo, useState } from "react";
import AppIcon from "../components/AppIcon";
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

function formatarData(valor: string) {
  const normalizado = valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`;
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Auditoria() {
  const { periodoAtual } = usePeriodo();
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [busca, setBusca] = useState("");
  const [acao, setAcao] = useState("TODAS");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [diagnostico, setDiagnostico] = useState<DiagnosticoSheets | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [erroDiagnostico, setErroDiagnostico] = useState("");

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

  useEffect(() => {
    setDiagnostico(null);
    setErroDiagnostico("");
  }, [periodoAtual?.id]);

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
        <button type="button" className="log-refresh" onClick={carregar}>Atualizar</button>
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
                  ? `${diagnostico.unidades_nao_resolvidas} unidade(s) precisam ser resolvidas.`
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
                ["Unidades não resolvidas", diagnostico.unidades_nao_resolvidas, "blocked"],
              ].map(([rotulo, valor, classe]) => (
                <article className={String(classe)} key={String(rotulo)}>
                  <span>{rotulo}</span><strong>{valor}</strong>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

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
