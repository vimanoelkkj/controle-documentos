import { useEffect } from "react";
import AppIcon from "../components/AppIcon";
import { useAuth } from "../contexts/auth";

import { useBackup } from "./configuracoes/hooks/useBackup";
import { useFerramentasDev } from "./configuracoes/hooks/useFerramentasDev";
import { useRedefinirSenha } from "./configuracoes/hooks/useRedefinirSenha";
import { useExcluirUsuario } from "./configuracoes/hooks/useExcluirUsuario";
import { useUsuarios } from "./configuracoes/hooks/useUsuarios";

import { BackupSection } from "./configuracoes/components/BackupSection";
import { FerramentasDevSection } from "./configuracoes/components/FerramentasDevSection";
import { ModalRedefinirSenha } from "./configuracoes/components/ModalRedefinirSenha";
import { ModalExcluirUsuario } from "./configuracoes/components/ModalExcluirUsuario";
import { ListaUsuarios } from "./configuracoes/components/ListaUsuarios";
import { FormNovoUsuario } from "./configuracoes/components/FormNovoUsuario";

function Configuracoes() {
  const { admin } = useAuth();

  const {
    usuarios,
    nome,
    setNome,
    username,
    setUsername,
    email,
    setEmail,
    senha,
    setSenha,
    perfil,
    setPerfil,
    modoApresentacao,
    setModoApresentacao,
    erro,
    carregar,
    criarUsuario,
    alterarUsuario,
  } = useUsuarios({ admin });

  const {
    usuarioSenha,
    novaSenha,
    setNovaSenha,
    mostrarNovaSenha,
    setMostrarNovaSenha,
    salvandoSenha,
    erroSenha,
    setErroSenha,
    abrirModalSenha,
    fecharModalSenha,
    salvarNovaSenha,
  } = useRedefinirSenha();

  const {
    devHabilitado,
    unidadeDev,
    setUnidadeDev,
    confirmacaoDev,
    setConfirmacaoDev,
    limpandoDev,
    mensagemDev,
    setMensagemDev,
    verificarFerramentasDev,
    confirmacaoEsperada,
    limparAlunosDev,
  } = useFerramentasDev({ admin });

  const {
    backupConfigurado,
    gerandoBackup,
    erroBackup,
    backupGerado,
    verificarBackup,
    gerarBackup,
  } = useBackup({ admin });

  const {
    usuarioExcluir,
    confirmacaoExcluir,
    setConfirmacaoExcluir,
    excluindoUsuario,
    erroExcluir,
    setErroExcluir,
    abrirModalExcluir,
    fecharModalExcluir,
    excluirUsuario,
  } = useExcluirUsuario({
    aoExcluir: carregar,
  });

  useEffect(() => {
    void carregar();
    void verificarFerramentasDev();
    void verificarBackup();
  }, [carregar, verificarFerramentasDev, verificarBackup]);

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <span>SISTEMA</span>

          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="settings" size={22} />
            </span>

            <h1>Configurações</h1>
          </div>

          <p>Preferências, integrações e controle de acesso.</p>
        </div>
      </header>

      {!admin ? (
        <div className="settings-readonly">
          O gerenciamento de usuários é exclusivo para administradores.
        </div>
      ) : (
        <>
          <ListaUsuarios
            usuarios={usuarios}
            alterarUsuario={alterarUsuario}
            abrirModalSenha={abrirModalSenha}
            abrirModalExcluir={abrirModalExcluir}
          />

          <FormNovoUsuario
            nome={nome}
            setNome={setNome}
            username={username}
            setUsername={setUsername}
            email={email}
            setEmail={setEmail}
            senha={senha}
            setSenha={setSenha}
            perfil={perfil}
            setPerfil={setPerfil}
            modoApresentacao={modoApresentacao}
            setModoApresentacao={setModoApresentacao}
            erro={erro}
            criarUsuario={criarUsuario}
          />

          <BackupSection
            backupConfigurado={backupConfigurado}
            gerandoBackup={gerandoBackup}
            erroBackup={erroBackup}
            backupGerado={backupGerado}
            gerarBackup={gerarBackup}
          />

          {devHabilitado && (
            <FerramentasDevSection
              unidadeDev={unidadeDev}
              setUnidadeDev={setUnidadeDev}
              confirmacaoDev={confirmacaoDev}
              setConfirmacaoDev={setConfirmacaoDev}
              limpandoDev={limpandoDev}
              mensagemDev={mensagemDev}
              setMensagemDev={setMensagemDev}
              confirmacaoEsperada={confirmacaoEsperada}
              limparAlunosDev={limparAlunosDev}
            />
          )}
        </>
      )}

      {usuarioSenha && (
        <ModalRedefinirSenha
          usuario={usuarioSenha}
          novaSenha={novaSenha}
          setNovaSenha={setNovaSenha}
          mostrarNovaSenha={mostrarNovaSenha}
          setMostrarNovaSenha={setMostrarNovaSenha}
          salvandoSenha={salvandoSenha}
          erroSenha={erroSenha}
          setErroSenha={setErroSenha}
          aoFechar={fecharModalSenha}
          aoSalvar={salvarNovaSenha}
        />
      )}

      {usuarioExcluir && (
        <ModalExcluirUsuario
          usuario={usuarioExcluir}
          confirmacaoExcluir={confirmacaoExcluir}
          setConfirmacaoExcluir={setConfirmacaoExcluir}
          excluindoUsuario={excluindoUsuario}
          erroExcluir={erroExcluir}
          setErroExcluir={setErroExcluir}
          aoFechar={fecharModalExcluir}
          aoExcluir={excluirUsuario}
        />
      )}
    </section>
  );
}

export default Configuracoes;
