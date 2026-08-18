import { useEffect, useRef, useState } from "react";
import MockupStyle from "../components/MockupStyle";
import css from "../mockups/configuracoes.css?raw";
import { useAuth } from "../contexts/auth";
import { api } from "../lib/api";
import type { UsuarioLista } from "./configuracoes/model";
import type { Perfil } from "../contexts/auth";

type BackupGerado={arquivo:string;download_url:string;expira_em_segundos:number};
type PerfilUI="Visualizador"|"Editor"|"Administrador"|"Apresentação";
const mapPerfil:Record<PerfilUI,{perfil:Perfil;modo:boolean;label:string}>={Visualizador:{perfil:"VISUALIZADOR",modo:false,label:"VISUALIZADOR"},Editor:{perfil:"EDITOR",modo:false,label:"EDITOR"},Administrador:{perfil:"ADMIN",modo:false,label:"ADMIN"},Apresentação:{perfil:"VISUALIZADOR",modo:true,label:"APRESENTAÇÃO"}};
function senhaAleatoria(){const c="abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";return Array.from({length:8},()=>c[Math.floor(Math.random()*c.length)]).join("")}
function ini(n:string){return n.trim().charAt(0).toUpperCase()||"?"}
// Mesma técnica do Login: nunca usar type="password" de verdade (o navegador só
// oferece a caixinha de senha salva pra esse tipo, e isso não dá pra desligar via
// código), mascarando os caracteres na mão com "•" num input type="text" comum.
const PONTO_SENHA="•";
function aplicarMascaraSenha(atual:string,exibido:string):{valor:string;cursor:number}{const antiga=PONTO_SENHA.repeat(atual.length);let i=0;while(i<exibido.length&&i<antiga.length&&exibido[i]===antiga[i])i++;let fe=exibido.length,fa=antiga.length;while(fe>i&&fa>i&&exibido[fe-1]===antiga[fa-1]){fe--;fa--}const t=exibido.slice(i,fe);return{valor:atual.slice(0,i)+t+atual.slice(fa),cursor:i+t.length}}
export default function Configuracoes(){
 const {admin}=useAuth();
 const [usuarios,setUsuarios]=useState<UsuarioLista[]>([]),[erro,setErro]=useState("");
 const [nome,setNome]=useState(""),[username,setUsername]=useState(""),[email,setEmail]=useState(""),[senha,setSenha]=useState("acesso2026"),[perfilUI,setPerfilUI]=useState<PerfilUI>("Visualizador"),[profileOpen,setProfileOpen]=useState(false);
 const [senhaUser,setSenhaUser]=useState<UsuarioLista|null>(null),[senhaGerada,setSenhaGerada]=useState(""),[deleteUser,setDeleteUser]=useState<UsuarioLista|null>(null);
 const [backupConfigurado,setBackupConfigurado]=useState<boolean|null>(null),[backupConfirm,setBackupConfirm]=useState(false),[backup,setBackup]=useState<BackupGerado|null>(null),[gerando,setGerando]=useState(false);
 const [acessoLiberado,setAcessoLiberado]=useState(false);
 const senhaInputRef=useRef<HTMLInputElement>(null),cursorPendenteRef=useRef<number|null>(null);
 // Mantém e-mail/senha readOnly no instante do foco (quando o navegador decide se
 // mostra a sugestão de credencial salva) e libera a digitação só um tick depois.
 const liberarAcesso=()=>{setTimeout(()=>setAcessoLiberado(true),0)};
 useEffect(()=>{if(cursorPendenteRef.current!==null&&senhaInputRef.current){const p=cursorPendenteRef.current;senhaInputRef.current.setSelectionRange(p,p);cursorPendenteRef.current=null}},[senha]);
 async function carregar(){if(!admin)return;try{setUsuarios(await api.get<UsuarioLista[]>("/api/usuarios"));}catch(e){setErro(e instanceof Error?e.message:"Erro ao carregar usuários.")}}
 async function statusBackup(){if(!admin)return;try{const d=await api.get<{configurado?:boolean}>("/api/admin/backup/status");setBackupConfigurado(Boolean(d.configurado))}catch{setBackupConfigurado(false)}}
 useEffect(()=>{void carregar();void statusBackup()},[admin]);
 async function criar(){if(!nome.trim()||!username.trim()||!email.trim()||senha.length<8){setErro("Preencha nome, usuário, e-mail e uma senha com ao menos 8 caracteres.");return}const m=mapPerfil[perfilUI];try{setErro("");await api.post("/api/usuarios",{nome,username,email,senha,perfil:m.perfil,modo_apresentacao:m.modo});setNome("");setUsername("");setEmail("");setSenha("acesso2026");setPerfilUI("Visualizador");await carregar()}catch(e){setErro(e instanceof Error?e.message:"Erro ao criar usuário.")}}
 async function toggle(u:UsuarioLista){try{await api.put(`/api/usuarios/${u.id}`,{ativo:!Boolean(u.ativo)});await carregar()}catch(e){setErro(e instanceof Error?e.message:"Não foi possível alterar o usuário.")}}
 async function abrirSenha(u:UsuarioLista){const s=senhaAleatoria();try{await api.put(`/api/usuarios/${u.id}`,{senha:s});setSenhaGerada(s);setSenhaUser(u)}catch(e){setErro(e instanceof Error?e.message:"Não foi possível redefinir a senha.")}}
 async function excluir(){if(!deleteUser)return;try{await api.delete(`/api/usuarios/${deleteUser.id}`);setDeleteUser(null);await carregar()}catch(e){setErro(e instanceof Error?e.message:"Não foi possível excluir o usuário.")}}
 async function gerarBackup(){setGerando(true);try{const d=await api.post<BackupGerado>("/api/admin/backup");setBackup(d);setBackupConfirm(false)}catch(e){setErro(e instanceof Error?e.message:"Não foi possível gerar o backup.")}finally{setGerando(false)}}
 if(!admin)return <><MockupStyle css={css}/><div className="page-head"><h1>Configurações</h1><p>Preferências, integrações e controle de acesso.</p></div><div className="settings-section"><div className="settings-eyebrow">Acesso</div><h2>Usuários</h2><p className="settings-sub">O gerenciamento de usuários é exclusivo para administradores.</p></div></>;
 return <>
 <MockupStyle css={css}/>
 <div className="page-head"><h1>Configurações</h1><p>Preferências, integrações e controle de acesso.</p></div>
 <div className="settings-section"><div className="settings-eyebrow">Acesso</div><h2>Usuários</h2><p className="settings-sub">{usuarios.length} usuário{usuarios.length===1?"":"s"} cadastrado{usuarios.length===1?"":"s"}</p>
 <ul className="user-list">{usuarios.map(u=><li className={`user-row${u.ativo?"":" disabled"}`} key={u.id}><div className="user-avatar">{ini(u.nome)}</div><div className="user-info"><span className="user-name">{u.nome}</span><span className="user-handle">@{u.username} · {u.email}</span></div><div className="user-actions"><a className="user-link" onClick={()=>void abrirSenha(u)}>Senha</a><span className="user-role">{u.modo_apresentacao?"APRESENTAÇÃO":u.perfil}</span><a className={`user-link${u.ativo?"":" reactivate"}`} onClick={()=>void toggle(u)}>{u.ativo?"Desativar":"Reativar"}</a><a className="user-link" onClick={()=>setDeleteUser(u)}>Excluir</a></div></li>)}</ul>
 </div>
 <div className="settings-section"><div className="settings-eyebrow">Novo usuário</div><h2>Criar acesso</h2><div className="create-access-row">
 <label className="field"><span>Nome</span><input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome completo" type="text"/></label>
 <label className="field"><span>Usuário</span><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="ex.: vitormanoel" type="text"/></label>
 {/* Iscas escondidas: o Firefox associa o campo de e-mail deste formulário ao "Senha
     inicial" logo abaixo e oferece a credencial salva do login real. Damos a ele um
     par usuário/senha invisível pra preencher no lugar dos campos visíveis. */}
 <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{position:"absolute",width:1,height:1,padding:0,margin:0,border:0,opacity:0,pointerEvents:"none",left:-9999}}/>
 <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{position:"absolute",width:1,height:1,padding:0,margin:0,border:0,opacity:0,pointerEvents:"none",left:-9999}}/>
 <label className="field"><span>E-mail</span><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@fumec.br" type="text" autoComplete="off" readOnly={!acessoLiberado} onPointerDown={liberarAcesso} onKeyDown={liberarAcesso}/></label>
 <label className="field"><span>Senha inicial</span><input ref={senhaInputRef} value={PONTO_SENHA.repeat(senha.length)} onChange={e=>{const{valor,cursor}=aplicarMascaraSenha(senha,e.target.value);cursorPendenteRef.current=cursor;setSenha(valor)}} type="text" autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" readOnly={!acessoLiberado} onPointerDown={liberarAcesso} onKeyDown={liberarAcesso}/></label>
 <div className={`custom-select${profileOpen?" open":""}`} data-value={perfilUI}><span style={{fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",fontSize:"0.66rem",color:"var(--muted)",display:"block",marginBottom:"0.4rem"}}>Perfil</span><button className="cs-trigger" type="button" onClick={()=>setProfileOpen(v=>!v)}><span className="cs-label">{perfilUI}</span><span className="cs-chev"/></button><div className="cs-dropdown"><ul>{(Object.keys(mapPerfil) as PerfilUI[]).map(p=><li key={p} className={p===perfilUI?"selected":""} onClick={()=>{setPerfilUI(p);setProfileOpen(false)}}><span className="radio"/><span>{p}</span></li>)}</ul></div></div>
 </div><div className="create-access-submit"><a className="settings-action" onClick={()=>void criar()}>Criar usuário</a></div>{erro&&<p className="settings-sub" style={{color:"var(--terracotta)",marginTop:"1rem"}}>{erro}</p>}</div>
 <div className="settings-section"><div className="settings-eyebrow">Proteção dos dados</div><h2>Backup do banco {backupConfigurado&&<span className="badge-configured">✓ Configurado</span>}</h2><p className="settings-sub">Gera uma cópia SQL completa do D1 para guardar fora do repositório. O arquivo contém dados pessoais e hashes de senha.</p><div className="backup-subhead">Exportação manual segura</div><p className="backup-hint">A Cloudflare pode deixar o banco indisponível por alguns instantes durante a exportação.</p><a className="settings-action" onClick={()=>setBackupConfirm(true)}>Gerar backup agora</a></div>
 {senhaUser&&<div className="modal-overlay open"><div className="modal-card modal-card-sm"><button className="modal-close" onClick={()=>setSenhaUser(null)}>✕</button><div className="modal-eyebrow">Acesso</div><h2 className="modal-title compact">Redefinir senha</h2><p className="modal-sub">Uma nova senha temporária foi gerada para {senhaUser.nome}.</p><div className="password-box"><span className="pw-value">{senhaGerada}</span><span className="pw-copy" onClick={()=>void navigator.clipboard?.writeText(senhaGerada)}>Copiar</span></div><div className="modal-footer"><a onClick={()=>setSenhaUser(null)}>Fechar</a></div></div></div>}
 {deleteUser&&<div className="modal-overlay open"><div className="modal-card modal-card-sm"><button className="modal-close" onClick={()=>setDeleteUser(null)}>✕</button><div className="modal-warn-icon">!</div><div className="modal-eyebrow">Exclusão</div><h2 className="modal-title compact">Excluir usuário?</h2><p className="modal-sub">Esta ação remove o acesso permanentemente. O usuário perderá a conexão imediatamente.</p><div className="info-box"><strong>{deleteUser.nome}</strong><p>@{deleteUser.username} · {deleteUser.email} · {deleteUser.modo_apresentacao?"APRESENTAÇÃO":deleteUser.perfil}</p></div><div className="modal-footer"><a onClick={()=>setDeleteUser(null)}>Cancelar</a><a className="modal-save" onClick={()=>void excluir()}>Excluir usuário</a></div></div></div>}
 {backupConfirm&&<div className="modal-overlay open"><div className="modal-card modal-card-sm"><button className="modal-close" onClick={()=>setBackupConfirm(false)}>✕</button><div className="modal-warn-icon">!</div><div className="modal-eyebrow">Backup</div><h2 className="modal-title compact">Gerar backup agora?</h2><p className="modal-sub">A Cloudflare pode deixar o banco indisponível por alguns instantes durante a exportação. O arquivo gerado conterá dados pessoais e hashes de senha.</p><div className="modal-footer"><a onClick={()=>setBackupConfirm(false)}>Cancelar</a><a className="modal-save" onClick={()=>void gerarBackup()}>{gerando?"Gerando...":"Gerar backup"}</a></div></div></div>}
 {backup&&<div className="modal-overlay open"><div className="modal-card modal-card-sm"><button className="modal-close" onClick={()=>setBackup(null)}>✕</button><div className="modal-ok-icon">✓</div><div className="modal-eyebrow">Backup</div><h2 className="modal-title compact">Backup gerado com sucesso</h2><p className="modal-sub">Arquivo pronto para download.</p><div className="info-box"><strong>{backup.arquivo}</strong><p>Link temporário válido por {Math.round(backup.expira_em_segundos/60)} minuto(s).</p></div><div className="modal-footer"><a onClick={()=>setBackup(null)}>Fechar</a><a className="modal-primary-ok" href={backup.download_url}>↓ Baixar arquivo</a></div></div></div>}
 </>;
}
