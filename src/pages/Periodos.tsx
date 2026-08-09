import { useMemo, useState } from "react";
import { usePeriodo } from "../contexts/PeriodoContext";

function normalizarCodigo(valor: string) {
  return valor.trim().toUpperCase().replace(/\s+/g, "");
}

function Periodos() {
  const { periodos, periodoAtual, selecionarPeriodo, recarregarPeriodos } = usePeriodo();
  const [novoCodigo, setNovoCodigo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");

  const ativos = useMemo(() => periodos.filter((periodo) => periodo.status === "ATIVO"), [periodos]);
  const arquivados = useMemo(() => periodos.filter((periodo) => periodo.status === "ARQUIVADO"), [periodos]);

  async function criarPeriodo() {
    const codigo = normalizarCodigo(novoCodigo);
    if (!/^\d{4}-(1|2)$/.test(codigo)) {
      setErro("Use o formato AAAA-1 ou AAAA-2. Ex.: 2027-1.");
      return;
    }

    try {
      setProcessando(true);
      setErro("");
      const resposta = await fetch("/api/periodos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const dados = (await resposta.json()) as { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível criar o período.");
      setNovoCodigo("");
      await recarregarPeriodos();
      selecionarPeriodo(codigo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o período.");
    } finally {
      setProcessando(false);
    }
  }

  async function alterarStatus(id: number, status: "ATIVO" | "ARQUIVADO", codigo: string) {
    const mensagem = status === "ARQUIVADO"
      ? `Arquivar ${codigo}? Ele sairá da operação diária, mas continuará acessível e editável.`
      : `Reativar ${codigo}?`;
    if (!window.confirm(mensagem)) return;

    try {
      setProcessando(true);
      setErro("");
      const resposta = await fetch(`/api/periodos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const dados = (await resposta.json()) as { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível alterar o período.");
      await recarregarPeriodos();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar o período.");
    } finally {
      setProcessando(false);
    }
  }

  const renderPeriodo = (periodo: (typeof periodos)[number]) => (
    <article className={`period-card ${periodo.codigo === periodoAtual?.codigo ? "current" : ""}`} key={periodo.id}>
      <div>
        <span className={`period-status ${periodo.status.toLowerCase()}`}>{periodo.status}</span>
        <h3>{periodo.codigo}</h3>
        <p>{periodo.total_alunos} aluno{periodo.total_alunos === 1 ? "" : "s"} vinculado{periodo.total_alunos === 1 ? "" : "s"}</p>
      </div>
      <div className="period-actions">
        <button type="button" onClick={() => selecionarPeriodo(periodo.codigo)} disabled={periodo.codigo === periodoAtual?.codigo}>Abrir período</button>
        <button
          type="button"
          className={periodo.status === "ATIVO" ? "danger-soft" : "secondary"}
          onClick={() => alterarStatus(periodo.id, periodo.status === "ATIVO" ? "ARQUIVADO" : "ATIVO", periodo.codigo)}
          disabled={processando}
        >
          {periodo.status === "ATIVO" ? "Arquivar" : "Reativar"}
        </button>
      </div>
    </article>
  );

  return (
    <section className="period-page">
      <header className="period-hero">
        <div>
          <span className="period-eyebrow">GESTÃO ACADÊMICA</span>
          <h1>Períodos letivos</h1>
          <p>Crie novos ciclos, alterne o contexto do sistema e arquive períodos antigos sem perder o acesso aos dados.</p>
        </div>
        <div className="period-current">
          <span>PERÍODO EM USO</span>
          <strong>{periodoAtual?.codigo ?? "—"}</strong>
          <small>{periodoAtual?.status ?? ""}</small>
        </div>
      </header>

      <section className="period-create-card">
        <div>
          <span>NOVO PERÍODO</span>
          <h2>Criar período letivo</h2>
          <p>Use o padrão <strong>AAAA-1</strong> ou <strong>AAAA-2</strong>.</p>
        </div>
        <div className="period-create-form">
          <input value={novoCodigo} onChange={(e) => setNovoCodigo(e.target.value)} placeholder="2027-1" maxLength={6} />
          <button type="button" onClick={criarPeriodo} disabled={processando}>+ Criar período</button>
        </div>
      </section>

      {erro && <div className="period-error">{erro}</div>}

      <section className="period-section">
        <div className="period-section-header"><div><span>OPERAÇÃO</span><h2>Períodos ativos</h2></div><strong>{ativos.length}</strong></div>
        <div className="period-list">{ativos.map(renderPeriodo)}</div>
      </section>

      <section className="period-section archived">
        <div className="period-section-header"><div><span>HISTÓRICO</span><h2>Períodos arquivados</h2></div><strong>{arquivados.length}</strong></div>
        {arquivados.length ? <div className="period-list">{arquivados.map(renderPeriodo)}</div> : <div className="period-empty">Nenhum período arquivado.</div>}
      </section>
    </section>
  );
}

export default Periodos;
