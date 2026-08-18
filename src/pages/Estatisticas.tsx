import { useEffect, useMemo, useRef, useState } from "react";
import MockupStyle from "../components/MockupStyle";
import statsCss from "../mockups/estatisticas.css?raw";
import type { AlunoApi } from "./conferencia/model";
import { usePeriodo } from "../contexts/periodo";

type Campo = "identidade"|"cpf"|"certidao"|"residencia"|"titulo"|"ensino_medio"|"contrato";
const docs:{campo:Campo; nome:string; curto:string; critico?:boolean}[]=[
 {campo:"ensino_medio",nome:"Histórico do Ensino Médio",curto:"Ens. Médio",critico:true},
 {campo:"certidao",nome:"Certidão de Registro Civil",curto:"Certidão"},
 {campo:"titulo",nome:"Título de Eleitor",curto:"Título"},
 {campo:"residencia",nome:"Comprovante de Residência",curto:"Residência"},
 {campo:"cpf",nome:"CPF",curto:"CPF"},
 {campo:"identidade",nome:"Identidade",curto:"Identidade"},
 {campo:"contrato",nome:"Contrato",curto:"Contrato",critico:true},
];
function fmt(n:number){return n.toLocaleString("pt-BR")}
function pct(n:number,t:number){return t?n/t*100:0}
function entregues(a:AlunoApi){return docs.filter(d=>a[d.campo]===1).length}
function isCritico(a:AlunoApi){return a.ensino_medio!==1||a.contrato!==1}

export default function Estatisticas(){
 const {periodoAtual}=usePeriodo();
 const [alunos,setAlunos]=useState<AlunoApi[]>([]);
 const [unidade,setUnidade]=useState("TODAS");
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{fetch("/api/alunos",{cache:"no-store"}).then(r=>r.ok?r.json() as Promise<AlunoApi[]>:Promise.reject()).then(setAlunos).catch(()=>setAlunos([]))},[periodoAtual?.codigo]);
 useEffect(()=>{function f(e:MouseEvent){if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)}document.addEventListener("mousedown",f);return()=>document.removeEventListener("mousedown",f)},[]);
 const ativos=useMemo(()=>alunos.filter(a=>a.status==="ATIVO"),[alunos]);
 const base=useMemo(()=>unidade==="TODAS"?ativos:ativos.filter(a=>a.unidade===unidade),[ativos,unidade]);
 const unidades=useMemo(()=>["EAD","FACE","FCH","FEA"].map(u=>({u,total:ativos.filter(a=>a.unidade===u).length})),[ativos]);
 const totalDocs=base.length*7, entreguesTotal=base.reduce((s,a)=>s+entregues(a),0);
 const completos=base.filter(a=>entregues(a)===7).length, zeros=base.filter(a=>entregues(a)===0).length;
 const gargalos=useMemo(()=>docs.map(d=>({...d,pend:base.filter(a=>a[d.campo]!==1).length,ok:base.filter(a=>a[d.campo]===1).length})).sort((a,b)=>b.pend-a.pend),[base]);
 const maxPend=Math.max(1,...gargalos.map(g=>g.pend));
 const padroes=useMemo(()=>{
   const m=new Map<string,{labels:string[];count:number}>();
   for(const a of base){const labels=docs.filter(d=>a[d.campo]!==1).map(d=>d.curto);if(!labels.length)continue;const key=labels.join("|");const x=m.get(key);if(x)x.count++;else m.set(key,{labels,count:1});}
   return [...m.values()].sort((a,b)=>b.count-a.count).slice(0,6)
 },[base]);
 const unitStats=useMemo(()=>unidades.map(({u,total})=>{const xs=ativos.filter(a=>a.unidade===u);const ent=xs.reduce((s,a)=>s+entregues(a),0);const comp=xs.filter(a=>entregues(a)===7).length;const crit=xs.filter(isCritico).length;return{u,total,avg:total?ent/total:0,progress:pct(ent,total*7),comp,crit,pendAluno:total?(total*7-ent)/total:0}}).sort((a,b)=>b.progress-a.progress),[ativos,unidades]);
 return <>
 <MockupStyle css={statsCss}/>
 <div className="page-head-row"><div className="page-head"><h1>Estatísticas documentais</h1><p>Onde estão os gargalos, como os alunos se distribuem e quais grupos merecem prioridade na conferência.</p></div>
   <div className={`unit-filter${open?" open":""}`} id="unitFilter" ref={ref}><div className="filter-row" onClick={()=>setOpen(v=>!v)}><span>{unidade==="TODAS"?"Filtrar por unidade":unidade}</span><span className="chev"/></div><div className="unit-filter-panel"><div className="ufp-head">Filtrar por unidade</div><ul><li className={unidade==="TODAS"?"selected":""} onClick={()=>{setUnidade("TODAS");setOpen(false)}}><span className="radio"/><span className="uf-label">Todas as unidades</span><span className="uf-count">{fmt(ativos.length)}</span></li>{unidades.map(x=><li key={x.u} className={unidade===x.u?"selected":""} onClick={()=>{setUnidade(x.u);setOpen(false)}}><span className="radio"/><span className="uf-label">{x.u}</span><span className="uf-count">{fmt(x.total)}</span></li>)}</ul></div></div>
 </div>
 <div className="stats-row">
   <div className="stat-block"><div className="sb-label">Média por aluno</div><div className="sb-value">{(base.length?entreguesTotal/base.length:0).toLocaleString("pt-BR",{maximumFractionDigits:1})}<span className="unit">/7</span></div><div className="sb-sub">documentos entregues por matrícula</div><div className="sb-bar"><div className="sb-bar-fill muted" style={{width:`${pct(entreguesTotal,totalDocs)}%`}}/></div></div>
   <div className="stat-block"><div className="sb-label">Taxa documental</div><div className="sb-value info">{Math.round(pct(entreguesTotal,totalDocs))}%</div><div className="sb-sub">{fmt(entreguesTotal)} de {fmt(totalDocs)} conferidos</div><div className="sb-bar"><div className="sb-bar-fill blue" style={{width:`${pct(entreguesTotal,totalDocs)}%`}}/></div></div>
   <div className="stat-block"><div className="sb-label">Alunos 7/7</div><div className="sb-value good">{fmt(completos)}</div><div className="sb-sub">{Math.round(pct(completos,base.length))}% da base analisada</div><div className="sb-bar"><div className="sb-bar-fill teal" style={{width:`${pct(completos,base.length)}%`}}/></div></div>
   <div className="stat-block"><div className="sb-label">Alunos 0/7</div><div className="sb-value critical">{fmt(zeros)}</div><div className="sb-sub">{Math.round(pct(zeros,base.length))}% sem nenhum documento</div><div className="sb-bar"><div className="sb-bar-fill terracotta" style={{width:`${pct(zeros,base.length)}%`}}/></div></div>
 </div>
 <div className="stats-section"><div className="section-head-row"><div><div className="col-head">Gargalos</div><h2>Pendência por documento</h2></div><span className="section-hint">maior prioridade primeiro</span></div><ul className="bottleneck-list">{gargalos.map((g,i)=><li className="bottleneck-row" key={g.campo}><span className="bn-rank">{i+1}</span><div className="bn-info"><div className="bn-name-row"><span className={`bn-name${g.critico?" critical":""}`}>{g.nome}</span>{g.critico&&<span className="bn-badge">documento crítico</span>}</div><div className="bn-sub">{Math.round(pct(g.ok,base.length))}% já entregue</div></div><div className="bn-bar-wrap"><div className="bn-bar-track"><div className={`bn-bar-fill${g.critico?" critical":""}`} style={{width:`${g.pend/maxPend*100}%`}}/></div><div className="bn-count">{fmt(g.pend)}<span>pendentes</span></div></div></li>)}</ul></div>
 <div className="stats-two-col">
   <div className="stats-section" style={{marginBottom:0}}><div className="section-head-row"><div><div className="col-head">Padrões recorrentes</div><h2>Combinações de pendências</h2></div><span className="section-hint">top 6</span></div><ul className="pattern-list">{padroes.map((p,i)=><li className="pattern-row" key={p.labels.join()}><span className="pattern-rank">#{i+1}</span><span className="pattern-names">{p.labels.join(", ")}</span><div className="pattern-count"><strong>{fmt(p.count)}</strong><span>alunos</span></div></li>)}</ul></div>
   <div className="stats-section" style={{marginBottom:0}}><div className="section-head-row"><div><div className="col-head">Comparativo</div><h2>Eficiência documental por unidade</h2></div><span className="section-hint">ordenado por progresso</span></div><div className="eff-table-wrap"><div className="eff-table"><div className="eff-head-row"><span>Unidade</span><span>Alunos</span><span>Média</span><span>Progresso</span><span style={{textAlign:"right"}}>7/7</span><span style={{textAlign:"right"}}>Críticos</span><span style={{textAlign:"right"}}>Pend./aluno</span></div>{unitStats.map(x=><div className="eff-row" key={x.u}><span className="eff-unit">{x.u}</span><span className="eff-num" data-label="Alunos">{fmt(x.total)}</span><span className="eff-num" data-label="Média">{x.avg.toLocaleString("pt-BR",{maximumFractionDigits:1})}/7</span><div className="eff-progress-cell" data-label="Progresso"><div className="eff-bar-track"><div className="eff-bar-fill" style={{width:`${x.progress}%`}}/></div></div><span className="eff-cell good" data-label="7/7">{x.comp} <span className="pct">({Math.round(pct(x.comp,x.total))}%)</span></span><span className="eff-cell critical" data-label="Críticos">{x.crit} <span className="pct">({Math.round(pct(x.crit,x.total))}%)</span></span><span className="eff-pend" data-label="Pend./aluno">{x.pendAluno.toLocaleString("pt-BR",{maximumFractionDigits:1})}</span></div>)}</div></div></div>
 </div>
 </>
}
