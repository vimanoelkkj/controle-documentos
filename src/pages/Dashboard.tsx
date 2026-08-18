import { useEffect, useMemo, useState } from "react";
import MockupStyle from "../components/MockupStyle";
import dashboardCss from "../mockups/dashboard.css?raw";
import { usePeriodo } from "../contexts/periodo";
import type { AlunoApi } from "./conferencia/model";

type DocumentoCampo = "identidade" | "cpf" | "certidao" | "residencia" | "titulo" | "ensino_medio" | "contrato";
const DOCS: { campo: DocumentoCampo; nome: string; cor: string }[] = [
  { campo: "ensino_medio", nome: "Histórico", cor: "var(--blue)" },
  { campo: "certidao", nome: "Certidão", cor: "var(--amber)" },
  { campo: "titulo", nome: "Título", cor: "var(--teal)" },
  { campo: "residencia", nome: "Residência", cor: "var(--terracotta)" },
  { campo: "contrato", nome: "Contrato", cor: "var(--terracotta)" },
  { campo: "identidade", nome: "Identidade", cor: "var(--blue)" },
  { campo: "cpf", nome: "CPF", cor: "var(--amber)" },
];
function status(a: AlunoApi) {
  const n = DOCS.filter((d) => a[d.campo] === 1).length;
  if (n === 7) return "COMPLETO";
  if (a.ensino_medio === 1 && a.contrato === 1) return "PARCIAL";
  return "CRITICO";
}
function pct(n: number, total: number) { return total ? n / total * 100 : 0; }
function fmt(n: number) { return n.toLocaleString("pt-BR"); }
function cursoLabel(s: string) {
  return s.replace(/^(EAD|SEMIPRESENCIAL|BACHARELADO EM|TECNOLOGIA EM)\s*[-–—:]?\s*/i, "").replace(/\s+(EAD|SEMIPRESENCIAL)$/i, "").trim().toUpperCase();
}

export default function Dashboard() {
  const { periodoAtual } = usePeriodo();
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("EAD");

  useEffect(() => {
    let ativo = true;
    fetch("/api/alunos", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<AlunoApi[]>; })
      .then((d) => ativo && setAlunos(d))
      .catch(() => ativo && setErro("Não foi possível carregar os dados do dashboard."));
    return () => { ativo = false; };
  }, [periodoAtual?.codigo]);

  const ativos = useMemo(() => alunos.filter((a) => a.status === "ATIVO"), [alunos]);
  const resumo = useMemo(() => {
    let completo = 0, parcial = 0, critico = 0, entregues = 0;
    for (const a of ativos) {
      const st = status(a); if (st === "COMPLETO") completo++; else if (st === "PARCIAL") parcial++; else critico++;
      entregues += DOCS.filter((d) => a[d.campo] === 1).length;
    }
    return { completo, parcial, critico, entregues };
  }, [ativos]);

  const unidades = useMemo(() => ["EAD", "FACE", "FCH", "FEA"].map((u) => ({ u, total: ativos.filter((a) => a.unidade === u).length })), [ativos]);
  useEffect(() => { if (!unidades.some((u) => u.u === unidade && u.total > 0)) setUnidade(unidades.find((u) => u.total > 0)?.u || "EAD"); }, [unidades, unidade]);

  const cursos = useMemo(() => {
    const m = new Map<string, number>();
    ativos.filter((a) => a.unidade === unidade).forEach((a) => m.set(a.curso, (m.get(a.curso) || 0) + 1));
    return [...m].map(([nome, total]) => ({ nome, total })).sort((a,b) => b.total-a.total);
  }, [ativos, unidade]);
  const maxCurso = Math.max(1, ...cursos.map((c) => c.total));

  const pendencias = useMemo(() => DOCS.map((d) => ({ ...d, total: ativos.filter((a) => a[d.campo] !== 1).length })).sort((a,b) => b.total-a.total).slice(0,4), [ativos]);
  const totalPend = pendencias.reduce((s,d) => s+d.total,0);
  let cursor = 0;
  const grad = pendencias.map((d) => {
    const start = cursor;
    cursor += totalPend ? d.total / totalPend * 100 : 0;
    return `${d.cor} ${start}% ${cursor}%`;
  }).join(", ");

  if (erro) return <><MockupStyle css={dashboardCss}/><div className="page-head"><h1>Dashboard</h1><p>{erro}</p></div></>;
  const total = ativos.length;
  const conclusao = pct(resumo.entregues, Math.max(1,total*7));

  return <>
    <MockupStyle css={dashboardCss}/>
    <div className="page-head"><h1>Dashboard</h1><p>Visão geral da documentação dos alunos por unidade.</p></div>
    <section>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-icon blue">◆</div><div className="stat-value">{fmt(total)}</div><div className="stat-label">Total de alunos</div><div className="stat-sub">100% do total</div></div>
        <div className="stat-tile"><div className="stat-icon teal">✓</div><div className="stat-value">{fmt(resumo.completo)}</div><div className="stat-label">Completos</div><div className="stat-sub">{pct(resumo.completo,total).toLocaleString("pt-BR",{maximumFractionDigits:1})}% do total</div></div>
        <div className="stat-tile"><div className="stat-icon amber">◐</div><div className="stat-value">{fmt(resumo.parcial)}</div><div className="stat-label">Parciais</div><div className="stat-sub">{pct(resumo.parcial,total).toLocaleString("pt-BR",{maximumFractionDigits:1})}% do total</div></div>
        <div className="stat-tile"><div className="stat-icon terracotta">✕</div><div className="stat-value">{fmt(resumo.critico)}</div><div className="stat-label">Críticos</div><div className="stat-sub">{pct(resumo.critico,total).toLocaleString("pt-BR",{maximumFractionDigits:1})}% do total</div></div>
        <div className="stat-tile"><div className="stat-icon blue">%</div><div className="stat-value">{conclusao.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</div><div className="stat-label">Conclusão geral</div><div className="stat-sub">Média geral</div></div>
      </div>
    </section>

    <section>
      <div className="section-head"><div><h2>Alunos por unidade</h2><p className="section-sub">Selecione uma unidade para visualizar a distribuição por curso.</p></div></div>
      <div className="unit-grid">{unidades.map((x) => <div key={x.u} className={`unit-card${unidade===x.u?" selected":""}`} onClick={() => setUnidade(x.u)}><div className="u-tag">{x.u}</div><div className="u-value">{fmt(x.total)}</div><div className="u-pct">{pct(x.total,total).toLocaleString("pt-BR",{maximumFractionDigits:1})}% do total</div></div>)}</div>
    </section>

    <section>
      <div className="section-head"><div><h2>{unidade}</h2><p className="section-sub">{fmt(unidades.find((u)=>u.u===unidade)?.total||0)} alunos distribuídos em {cursos.length} cursos</p></div></div>
      <div className="bar-scroll">
        <div className="bar-chart" id="barChart">{cursos.map((c) => <div className="bar-col" key={c.nome}><div className="bar-val">{c.total}</div><div className="bar" style={{height:`${Math.max(4,c.total/maxCurso*175)}px`}} /></div>)}</div>
        <div className="bar-labels" id="barLabels">{cursos.map((c) => <div className="bar-label" title={cursoLabel(c.nome)} key={c.nome}>{cursoLabel(c.nome)}</div>)}</div>
      </div>
    </section>

    <section>
      <div className="section-head"><h2>Pendências por tipo de documento</h2></div>
      <div className="donut-wrap"><div className="donut" style={grad?{background:`conic-gradient(${grad})`}:undefined}><div className="donut-hole"><strong>{fmt(totalPend)}</strong><span>Pendências</span></div></div>
        <ul className="legend">{pendencias.map((d) => <li key={d.campo}><span className="swatch" style={{background:d.cor}}/><span className="l-label">{d.nome}</span><span className="l-pct">{pct(d.total,totalPend).toLocaleString("pt-BR",{maximumFractionDigits:1})}%</span><span className="l-value">{fmt(d.total)}</span></li>)}</ul>
      </div>
    </section>
  </>;
}
