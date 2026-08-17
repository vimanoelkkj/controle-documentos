import { useEffect, useMemo } from "react";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import { useGoogleSheetsPeriodo } from "./periodos/hooks/useGoogleSheetsPeriodo";
import { GoogleSheetsCard } from "./periodos/google-sheets/GoogleSheetsCard";
import { ModalSincronizacaoSucesso } from "./periodos/google-sheets/ModalSincronizacaoSucesso";
import { ModalConfirmarSincronizacao } from "./periodos/google-sheets/ModalConfirmarSincronizacao";
import { CriarPeriodoCard } from "./periodos/CriarPeriodoCard";
import { ListaPeriodos } from "./periodos/ListaPeriodos";
import { ModalConfirmarStatusPeriodo } from "./periodos/ModalConfirmarStatusPeriodo";
import {
  formatarCodigoPeriodo,
  useGerenciamentoPeriodos,
} from "./periodos/hooks/useGerenciamentoPeriodos";

function Periodos() {
  const { modoApresentacao } = useAuth();
  const { periodos, periodoAtual, selecionarPeriodo, recarregarPeriodos } =
    usePeriodo();
  const {
    novoCodigo,
    setNovoCodigo,
    processando,
    erro,
    erroCriacao,
    limparErroCriacao,
    confirmacao,
    setConfirmacao,
    criarPeriodo,
    alterarStatus,
  } = useGerenciamentoPeriodos({
    recarregarPeriodos,
    selecionarPeriodo,
  });
  const {
    sheetsConfig,
    setSheetsConfig,
    sheetsStatus,
    sheetsTitulo,
    sheetsSalvo,
    sheetsCarregando,
    sheetsErro,
    sheetsPrevia,
    abaPrevia,
    setAbaPrevia,
    listaPreviaRef,
    mapeamentos,
    setMapeamentos,
    salvandoMapeamentos,
    mapeamentosAlterados,
    modalSincronizar,
    setModalSincronizar,
    sincronizandoSheets,
    resultadoSync,
    setResultadoSync,
    modalSucessoSync,
    setModalSucessoSync,
    mostrarAlteracoesSync,
    setMostrarAlteracoesSync,
    salvarSheets,
    gerarPreviaSheets,
    salvarMapeamentos,
    sincronizarSheets,
    totalOperacoesPrevia,
  } = useGoogleSheetsPeriodo({
    periodoAtual,
    recarregarPeriodos,
  });
  useEffect(() => {
    const temModalAberto =
      modalSincronizar || modalSucessoSync || confirmacao !== null;

    if (!temModalAberto) return;

    const overflowAnterior = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [modalSincronizar, modalSucessoSync, confirmacao]);

  const ativos = useMemo(
    () => periodos.filter((periodo) => periodo.status === "ATIVO"),
    [periodos],
  );
  const arquivados = useMemo(
    () => periodos.filter((periodo) => periodo.status === "ARQUIVADO"),
    [periodos],
  );

  return (
    <section className="period-page">
      {!modoApresentacao && (
        <CriarPeriodoCard
          novoCodigo={novoCodigo}
          setNovoCodigo={setNovoCodigo}
          processando={processando}
          erro={erroCriacao}
          limparErro={limparErroCriacao}
          criarPeriodo={criarPeriodo}
          formatarCodigoPeriodo={formatarCodigoPeriodo}
        />
      )}

      <GoogleSheetsCard
        codigoPeriodo={periodoAtual?.codigo}
        modoApresentacao={modoApresentacao}
        sheetsConfig={sheetsConfig}
        setSheetsConfig={setSheetsConfig}
        sheetsStatus={sheetsStatus}
        sheetsTitulo={sheetsTitulo}
        sheetsSalvo={sheetsSalvo}
        sheetsCarregando={sheetsCarregando}
        sheetsErro={sheetsErro}
        sheetsPrevia={sheetsPrevia}
        abaPrevia={abaPrevia}
        setAbaPrevia={setAbaPrevia}
        listaPreviaRef={listaPreviaRef}
        mapeamentos={mapeamentos}
        setMapeamentos={setMapeamentos}
        salvandoMapeamentos={salvandoMapeamentos}
        mapeamentosAlterados={mapeamentosAlterados}
        salvarSheets={salvarSheets}
        gerarPreviaSheets={gerarPreviaSheets}
        salvarMapeamentos={salvarMapeamentos}
        totalOperacoesPrevia={totalOperacoesPrevia}
        sincronizandoSheets={sincronizandoSheets}
        abrirSincronizacao={() => {
          setResultadoSync(null);
          setModalSucessoSync(false);
          setModalSincronizar(true);
        }}
      />

      {erro && <div className="period-error">{erro}</div>}

      <ListaPeriodos
        tipo="ativos"
        periodos={ativos}
        codigoPeriodoAtual={periodoAtual?.codigo}
        modoApresentacao={modoApresentacao}
        processando={processando}
        aoAbrir={selecionarPeriodo}
        aoAlterarStatus={setConfirmacao}
      />

      <ListaPeriodos
        tipo="arquivados"
        periodos={arquivados}
        codigoPeriodoAtual={periodoAtual?.codigo}
        modoApresentacao={modoApresentacao}
        processando={processando}
        aoAbrir={selecionarPeriodo}
        aoAlterarStatus={setConfirmacao}
      />

      {resultadoSync && (
        <div className="period-sheets-sync-result">
          <div>
            <span>ÚLTIMA SINCRONIZAÇÃO</span>
            <strong>✓ Google Sheets aplicado ao sistema</strong>
          </div>
          <p>
            {resultadoSync.novos} novo(s) ·{" "}
            {resultadoSync.alteracoes_cadastrais} cadastro(s) ·{" "}
            {resultadoSync.documentos_alterados} documento(s) ·{" "}
            {resultadoSync.cancelamentos} cancelamento(s) ·{" "}
            {resultadoSync.reativacoes} reativação(ões)
          </p>
          <button type="button" onClick={() => setResultadoSync(null)}>
            ×
          </button>
        </div>
      )}

      {modalSucessoSync && resultadoSync && (
        <ModalSincronizacaoSucesso
          codigoPeriodo={periodoAtual?.codigo}
          resultado={resultadoSync}
          aoFechar={() => setModalSucessoSync(false)}
        />
      )}

      {modalSincronizar && sheetsPrevia && (
        <ModalConfirmarSincronizacao
          codigoPeriodo={periodoAtual?.codigo}
          previa={sheetsPrevia}
          mostrarAlteracoes={mostrarAlteracoesSync}
          setMostrarAlteracoes={setMostrarAlteracoesSync}
          sincronizando={sincronizandoSheets}
          aoVoltar={() => setModalSincronizar(false)}
          aoConfirmar={sincronizarSheets}
        />
      )}
      {confirmacao && (
        <ModalConfirmarStatusPeriodo
          confirmacao={confirmacao}
          processando={processando}
          aoFechar={() => setConfirmacao(null)}
          aoConfirmar={alterarStatus}
        />
      )}
    </section>
  );
}

export default Periodos;
