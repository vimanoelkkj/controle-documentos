import { PeriodoCard } from "./periodos/PeriodoCard";
import AppIcon from "../components/AppIcon";
import { useEffect, useMemo } from "react";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import { useGoogleSheetsPeriodo } from "./periodos/hooks/useGoogleSheetsPeriodo";
import { GoogleSheetsCard } from "./periodos/google-sheets/GoogleSheetsCard";
import { ModalSincronizacaoSucesso } from "./periodos/google-sheets/ModalSincronizacaoSucesso";
import { ModalConfirmarSincronizacao } from "./periodos/google-sheets/ModalConfirmarSincronizacao";
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
      <header className="period-hero">
        <div>
          <span className="period-eyebrow">GESTÃO ACADÊMICA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="calendar" size={22} />
            </span>
            <h1>Períodos letivos</h1>
          </div>
          <p>
            Crie novos ciclos, alterne o contexto do sistema e arquive períodos
            antigos sem perder o acesso aos dados.
          </p>
        </div>
        <div className="period-current">
          <span>PERÍODO EM USO</span>
          <strong>{periodoAtual?.codigo ?? "—"}</strong>
          <small>{periodoAtual?.status ?? ""}</small>
        </div>
      </header>

      {!modoApresentacao && (
        <section className="period-create-card">
          <div>
            <span>NOVO PERÍODO</span>
            <h2>Criar período letivo</h2>
            <p>
              Use o padrão <strong>AAAA-1</strong> ou <strong>AAAA-2</strong>.
            </p>
          </div>

          <div className="period-create-form">
            <input
              value={novoCodigo}
              onChange={(e) =>
                setNovoCodigo(formatarCodigoPeriodo(e.target.value))
              }
              onKeyDown={(e) => {
                const input = e.currentTarget;
                const cursorNoFim =
                  input.selectionStart === novoCodigo.length &&
                  input.selectionEnd === novoCodigo.length;

                if (
                  e.key === "Backspace" &&
                  novoCodigo.endsWith("-") &&
                  cursorNoFim
                ) {
                  e.preventDefault();
                  setNovoCodigo(novoCodigo.slice(0, -2));
                }
              }}
              placeholder="2027-1"
              maxLength={6}
              inputMode="numeric"
              aria-label="Novo período letivo no formato ano e semestre"
            />

            <button type="button" onClick={criarPeriodo} disabled={processando}>
              + Criar período
            </button>
          </div>
        </section>
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

      <section className="period-section">
        <div className="period-section-header">
          <div>
            <span>OPERAÇÃO</span>
            <h2>Períodos ativos</h2>
          </div>
          <strong>{ativos.length}</strong>
        </div>
        <div className="period-list">
          {ativos.map((periodo) => (
            <PeriodoCard
              key={periodo.id}
              periodo={periodo}
              codigoPeriodoAtual={periodoAtual?.codigo}
              modoApresentacao={modoApresentacao}
              processando={processando}
              aoAbrir={selecionarPeriodo}
              aoAlterarStatus={setConfirmacao}
            />
          ))}
        </div>
      </section>

      <section
        className={`period-section archived ${arquivados.length === 0 ? "empty" : ""}`}
      >
        <div className="period-section-header">
          <div>
            <span>HISTÓRICO</span>
            <h2>Períodos arquivados</h2>
          </div>
          <strong>{arquivados.length}</strong>
        </div>
        {arquivados.length ? (
          <div className="period-list">
            {arquivados.map((periodo) => (
              <PeriodoCard
                key={periodo.id}
                periodo={periodo}
                codigoPeriodoAtual={periodoAtual?.codigo}
                modoApresentacao={modoApresentacao}
                processando={processando}
                aoAbrir={selecionarPeriodo}
                aoAlterarStatus={setConfirmacao}
              />
            ))}
          </div>
        ) : (
          <div className="period-empty">
            <div className="period-empty-icon" aria-hidden="true">
              ◷
            </div>
            <strong>Nenhum período arquivado</strong>
            <p>
              Quando um período for arquivado, ele continuará disponível aqui
              para consulta, edição ou reativação.
            </p>
          </div>
        )}
      </section>

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
        <div
          className="modal-overlay"
          onMouseDown={() => !processando && setConfirmacao(null)}
        >
          <div
            className="period-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="period-confirm-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">PERÍODOS LETIVOS</span>
                <h2 id="period-confirm-title">
                  {confirmacao.status === "ARQUIVADO"
                    ? "Arquivar período?"
                    : "Reativar período?"}
                </h2>
                <p>
                  {confirmacao.status === "ARQUIVADO" ? (
                    <>
                      O período <strong>{confirmacao.codigo}</strong> sairá da
                      operação diária, mas continuará acessível e poderá ser
                      editado quando necessário.
                    </>
                  ) : (
                    <>
                      O período <strong>{confirmacao.codigo}</strong> voltará
                      para a lista de períodos ativos e poderá ser usado
                      normalmente.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="modal-fechar"
                onClick={() => setConfirmacao(null)}
                disabled={processando}
              >
                ×
              </button>
            </div>
            <div className="modal-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setConfirmacao(null)}
                disabled={processando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={
                  confirmacao.status === "ARQUIVADO"
                    ? "period-confirm-danger"
                    : "botao-cadastrar"
                }
                onClick={() =>
                  alterarStatus(confirmacao.id, confirmacao.status)
                }
                disabled={processando}
              >
                {processando
                  ? "Processando..."
                  : confirmacao.status === "ARQUIVADO"
                    ? "Arquivar período"
                    : "Reativar período"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Periodos;
