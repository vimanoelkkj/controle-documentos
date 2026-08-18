import { useEffect, useMemo, useState } from "react";
import MockupStyle from "../components/MockupStyle";
import cursosCss from "../mockups/cursos.css?raw";
import conferenciaCss from "../mockups/conferencia.css?raw";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import { api } from "../lib/api";
import type { Unidade } from "../types/domain";

type Curso={curso:string;total_alunos:number;unidades:Array<{unidade:string;total:number}>};
const UNITS:Unidade[]=["EAD","FACE","FCH","FEA"];
export default function Cursos(){
 const {periodoAtual}=usePeriodo(); const {podeEditar}=useAuth();
 const [cursos,setCursos]=useState<Curso[]>([]),[busca,setBusca]=useState(""),[destinos,setDestinos]=useState<Record<string,Unidade>>({}),[open,setOpen]=useState<string|null>(null),[confirmando,setConfirmando]=useState<Curso|null>(null),[salvando,setSalvando]=useState(false),[erro,setErro]=useState("");
 async function carregar(){try{setErro("");const d=await api.get<Curso[]>("/api/cursos",{cache:"no-store"});setCursos(d);setDestinos(Object.fromEntries(d.map(c=>[c.curso,(c.unidades.length===1&&UNITS.includes(c.unidades[0].unidade as Unidade)?c.unidades[0].unidade:"FACE") as Unidade])))}catch(e){setErro(e instanceof Error?e.message:"Não foi possível carregar os cursos.")}}
 useEffect(()=>{void carregar()},[periodoAtual?.id]);
 const filtrados=useMemo(()=>{const q=busca.trim().toLowerCase();return q?cursos.filter(c=>c.curso.toLowerCase().includes(q)):cursos},[busca,cursos]);
 const totalAlunos=cursos.reduce((s,c)=>s+c.total_alunos,0); const diverg=cursos.filter(c=>c.unidades.length>1).length;
 async function aplicar(){if(!confirmando)return;setSalvando(true);try{await api.put("/api/cursos/unidade",{curso:confirmando.curso,unidade:destinos[confirmando.curso],confirmacao:"ALTERAR"});setConfirmando(null);await carregar()}catch(e){setErro(e instanceof Error?e.message:"Não foi possível alterar a unidade.")}finally{setSalvando(false)}}
 return <><MockupStyle css={cursosCss}/>{confirmando&&<MockupStyle css={conferenciaCss}/>}<div className="page-head"><h1>Cursos e unidades</h1><p>Corrija a unidade de um curso e atualize todos os alunos vinculados no período {periodoAtual?.codigo}.</p></div>
 <div className="cursos-stats"><div><div className="c-stat-label">Cursos cadastrados</div><div className="c-stat-value">{cursos.length}</div></div><div><div className="c-stat-label">Alunos vinculados</div><div className="c-stat-value">{totalAlunos}</div></div><div><div className="c-stat-label">Com unidades divergentes</div><div className={`c-stat-value${diverg?" divergent":""}`}>{diverg}</div></div></div>
 <div className="cursos-toolbar"><div><h2>Mapeamento por curso</h2><div className="result-count">{filtrados.length} resultado(s)</div></div><div className="search-input"><span className="icon">⌕</span><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar curso..." type="text"/></div></div>
 {erro&&<div className="no-results">{erro}</div>}
 <div className="course-table">{filtrados.map(c=>{const atual=c.unidades.length===1?c.unidades[0].unidade:"DIVERGENTE";const dest=destinos[c.curso]||"FACE";return <div className="course-row" key={c.curso}><div><div className="course-name">{c.curso.toUpperCase()}</div><div className="course-meta">{c.total_alunos} aluno(s)</div></div><div><div className="cur-label">Unidade atual</div><div className="cur-value">{atual}</div></div><div><div className="cur-label">Nova unidade</div><div className="cur-new-row"><div className={`custom-select${open===c.curso?" open":""}`} data-value={dest}><button type="button" className="cs-trigger plain" onClick={()=>setOpen(open===c.curso?null:c.curso)}><span className="cs-label">{dest}</span><span className="cs-chev"/></button><div className="cs-dropdown"><ul>{UNITS.map(u=><li key={u} data-value={u} className={u===dest?"selected":""} onClick={()=>{setDestinos(d=>({...d,[c.curso]:u}));setOpen(null)}}>{u}</li>)}</ul></div></div><span className="cur-sep">•</span><a className="cur-apply" onClick={()=>podeEditar&&setConfirmando(c)}>{podeEditar?"Aplicar aos alunos":"Somente leitura"}</a></div></div></div>})}</div>
 {!filtrados.length&&<div className="no-results">Nenhum curso encontrado.</div>}
 {confirmando&&<div className="modal-overlay open"><div className="modal-card modal-card-sm"><button className="modal-close" onClick={()=>setConfirmando(null)}>✕</button><div className="modal-eyebrow">Cursos e unidades</div><h2 className="modal-title compact">Aplicar nova unidade?</h2><p className="modal-sub">Todos os alunos de <b>{confirmando.curso}</b> no período {periodoAtual?.codigo} serão atualizados para <b>{destinos[confirmando.curso]}</b>.</p><div className="modal-footer"><a onClick={()=>setConfirmando(null)}>Cancelar</a><a className="modal-save" onClick={()=>void aplicar()}>{salvando?"Salvando...":"Aplicar aos alunos"}</a></div></div></div>}
 </>;
}
