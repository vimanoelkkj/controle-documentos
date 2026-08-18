import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import MockupStyle from "../components/MockupStyle";
import logCss from "../mockups/log.css?raw";

type RegistroLog={id:number;criado_em:string;acao:string;entidade:string;descricao:string;ra:string|null;unidade:string|null};
function formatarData(valor:string){const normalizado=valor.includes("T")?valor:`${valor.replace(" ","T")}Z`;const d=new Date(normalizado);return Number.isNaN(d.getTime())?valor:d.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}
export default function Log(){
 const [registros,setRegistros]=useState<RegistroLog[]>([]),[busca,setBusca]=useState(""),[erro,setErro]=useState(""),[carregando,setCarregando]=useState(true),[refreshing,setRefreshing]=useState(false);
 async function carregar(silent=false){try{if(!silent)setCarregando(true);else setRefreshing(true);setErro("");setRegistros(await api.get<RegistroLog[]>("/api/log?limit=300",{cache:"no-store"}))}catch(e){setErro(e instanceof Error?e.message:"Não foi possível carregar o LOG.")}finally{setCarregando(false);setRefreshing(false)}}
 useEffect(()=>{void carregar()},[]);
 const filtrados=useMemo(()=>{const q=busca.trim().toLowerCase();if(!q)return registros;return registros.filter(r=>[r.acao,r.descricao,r.ra,r.unidade,r.entidade].filter(Boolean).join(" ").toLowerCase().includes(q))},[registros,busca]);
 return <><MockupStyle css={logCss}/><div className="page-head-row"><div className="page-head"><h1>Log</h1><p>Registro cronológico das ações realizadas no sistema.</p></div><a className="refresh-link" id="refreshLog" onClick={()=>void carregar(true)} style={refreshing?{opacity:.45}:undefined}>↻ Atualizar</a></div>
 <div className="log-search-row"><div className="search-input"><span className="icon">⌕</span><input type="text" value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Pesquisar por ação, aluno, RA ou unidade..."/></div><span className="log-count">{(busca?filtrados.length:registros.length).toLocaleString("pt-BR")} {busca?`encontrado${filtrados.length===1?"":"s"}`:`registro${registros.length===1?"":"s"}`}</span></div>
 {erro?<p className="log-empty show">{erro}</p>:carregando?<p className="log-empty show">Carregando histórico...</p>:<><ul className="log-page-list" id="logList">{filtrados.map(r=><li className="log-page-item" key={r.id}><div className="lp-main"><div className="lp-action">{r.acao}</div><div className="lp-desc">{r.descricao}</div><div className="lp-tags">{r.unidade&&<>{r.unidade}<span className="sep">•</span></>} {r.entidade}{r.ra&&<><span className="sep">•</span>RA {r.ra}</>}</div></div><div className="lp-time">{formatarData(r.criado_em)}</div></li>)}</ul><p className={`log-empty${filtrados.length===0?" show":""}`}>Nenhum registro encontrado para essa busca.</p></>}
 </>;
}
