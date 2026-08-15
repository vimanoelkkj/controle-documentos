import { EntradaImportacaoAlunos } from "./importacao/EntradaImportacaoAlunos";
import type { useImportacaoAlunos } from "./hooks/useImportacaoAlunos";
import { PreviaImportacaoAlunos } from "./importacao/PreviaImportacaoAlunos";
import { ResultadoImportacaoAlunos } from "./importacao/ResultadoImportacaoAlunos";

type FluxoImportacao = ReturnType<typeof useImportacaoAlunos>;

type Props = {
  fluxo: FluxoImportacao;
  saindo: boolean;
};

export function ModalImportarAlunos({ fluxo, saindo }: Props) {
  const {
    modalImportarAlunos,
    modoImportacao,
    setModoImportacao,
    unidadeImportacao,
    setUnidadeImportacao,
    textoImportacao,
    setTextoImportacao,
    arquivoImportacao,
    previaImportacao,
    setPreviaImportacao,
    importando,
    finalizandoImportacao,
    erroImportacao,
    setErroImportacao,
    resultadoImportacao,
    fecharImportacao,
    limparImportacao,
    selecionarArquivoImportacao,
    gerarPreviaImportacao,
    confirmarImportacao,
  } = fluxo;
  const modalSaindo = saindo ? "importar-alunos" : null;

  return (
    <>
      {modalImportarAlunos && (
        <div
          className={`modal-overlay ${
            finalizandoImportacao ? "modal-overlay-finalizando" : ""
          } ${modalSaindo === "importar-alunos" ? "modal-overlay-exit" : ""}`}
        >
          <div
            className={`modal-importacao ${
              finalizandoImportacao ? "modal-importacao-finalizando" : ""
            }`}
          >
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">IMPORTAÇÃO EM LOTE</span>

                <h2>Importar alunos</h2>

                <p>
                  Cole os dados da planilha ou selecione um arquivo CSV e
                  confira a prévia antes de confirmar.
                </p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={fecharImportacao}
                disabled={importando || finalizandoImportacao}
              >
                ×
              </button>
            </div>

            <div className="importacao-conteudo">
              {(importando || finalizandoImportacao) && (
                <div
                  className={`importacao-processando ${
                    finalizandoImportacao ? "concluindo" : ""
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <div
                    className="importacao-processando-spinner"
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </div>

                  <strong>
                    {finalizandoImportacao
                      ? "Sincronização concluída"
                      : "Sincronizando alunos..."}
                  </strong>

                  <span>
                    {finalizandoImportacao
                      ? "Preparando o resumo da importação."
                      : "Atualizando a base e conferindo os dados importados."}
                  </span>
                </div>
              )}

              {!resultadoImportacao &&
                !importando &&
                !finalizandoImportacao && (
                  <>
                    {previaImportacao.length === 0 ? (
                      <EntradaImportacaoAlunos
                        modoImportacao={modoImportacao}
                        setModoImportacao={setModoImportacao}
                        unidadeImportacao={unidadeImportacao}
                        setUnidadeImportacao={setUnidadeImportacao}
                        textoImportacao={textoImportacao}
                        setTextoImportacao={setTextoImportacao}
                        arquivoImportacao={arquivoImportacao}
                        importando={importando}
                        limparImportacao={limparImportacao}
                        selecionarArquivoImportacao={
                          selecionarArquivoImportacao
                        }
                        gerarPreviaImportacao={gerarPreviaImportacao}
                        aoMudarUnidade={() => setPreviaImportacao([])}
                        aoLimparErro={() => setErroImportacao("")}
                      />
                    ) : (
                      <PreviaImportacaoAlunos
                        previa={previaImportacao}
                        aoEditar={() => setPreviaImportacao([])}
                      />
                    )}
                  </>
                )}

              {resultadoImportacao && !importando && !finalizandoImportacao && (
                <ResultadoImportacaoAlunos resultado={resultadoImportacao} />
              )}

              {erroImportacao && (
                <div className="modal-erro">{erroImportacao}</div>
              )}
            </div>

            {!importando && !finalizandoImportacao && (
              <div className="modal-acoes">
                {!resultadoImportacao ? (
                  <>
                    <button
                      type="button"
                      className="botao-cancelar"
                      onClick={fecharImportacao}
                      disabled={importando}
                    >
                      Cancelar
                    </button>

                    {previaImportacao.length > 0 && (
                      <button
                        type="button"
                        className="botao-cadastrar"
                        onClick={confirmarImportacao}
                        disabled={
                          importando ||
                          !previaImportacao.some(
                            (aluno) =>
                              aluno.status === "valido" ||
                              aluno.status === "alterado",
                          )
                        }
                      >
                        {importando ? "Importando..." : `Confirmar importação`}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="botao-cadastrar"
                    onClick={fecharImportacao}
                  >
                    Concluir
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
