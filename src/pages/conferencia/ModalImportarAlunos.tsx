import AppSelect from "../../components/AppSelect";
import type { useImportacaoAlunos } from "./hooks/useImportacaoAlunos";
import type { Unidade } from "./model";
import { quantidadeResultado } from "./utils";

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
                    <label className="importacao-unidade">
                      <span>Unidade de destino</span>

                      <AppSelect
                        value={unidadeImportacao}
                        onChange={(valor) => {
                          setUnidadeImportacao(valor as Unidade);
                          setPreviaImportacao([]);
                        }}
                        disabled={importando}
                        ariaLabel="Unidade de destino"
                        options={[
                          { value: "FACE", label: "FACE" },
                          { value: "FEA", label: "FEA" },
                          { value: "FCH", label: "FCH" },
                          { value: "EAD", label: "EAD" },
                        ]}
                      />
                    </label>

                    <div className="importacao-tabs">
                      <button
                        type="button"
                        className={modoImportacao === "colar" ? "active" : ""}
                        onClick={() => {
                          setModoImportacao("colar");
                          limparImportacao();
                        }}
                      >
                        Colar dados
                      </button>

                      <button
                        type="button"
                        className={modoImportacao === "csv" ? "active" : ""}
                        onClick={() => {
                          setModoImportacao("csv");
                          limparImportacao();
                        }}
                      >
                        Arquivo CSV
                      </button>
                    </div>

                    {previaImportacao.length === 0 ? (
                      <>
                        {modoImportacao === "colar" ? (
                          <div className="importacao-colar">
                            <textarea
                              value={textoImportacao}
                              onChange={(event) => {
                                setTextoImportacao(event.target.value);

                                setErroImportacao("");
                              }}
                              placeholder={`Cole aqui os dados copiados da planilha.

Exemplo:
Contrato    Curso    E-mail (outro)    E-mail    Nome    RA
SIM    PSICOLOGIA    aluno@gmail.com    a123@fumec.edu.br    JOÃO DA SILVA    2910130000`}
                            />
                          </div>
                        ) : (
                          <div className="importacao-arquivo">
                            <input
                              id="arquivo-importacao"
                              type="file"
                              accept=".csv,text/csv"
                              onChange={selecionarArquivoImportacao}
                            />

                            <label
                              htmlFor="arquivo-importacao"
                              className="importacao-dropzone"
                            >
                              <strong>
                                {arquivoImportacao || "Selecionar arquivo CSV"}
                              </strong>

                              <span>
                                {arquivoImportacao
                                  ? "Arquivo carregado e pronto para análise."
                                  : "Clique para selecionar um arquivo .csv"}
                              </span>
                            </label>
                          </div>
                        )}

                        <button
                          type="button"
                          className="botao-analisar-importacao"
                          onClick={gerarPreviaImportacao}
                          disabled={!textoImportacao.trim()}
                        >
                          Analisar dados
                        </button>
                      </>
                    ) : (
                      <div className="importacao-previa">
                        <div className="importacao-previa-cabecalho">
                          <div>
                            <span>PRÉVIA</span>
                            <h3>Confira antes de importar</h3>
                          </div>

                          <button
                            type="button"
                            onClick={() => setPreviaImportacao([])}
                          >
                            ← Editar dados
                          </button>
                        </div>

                        <div className="importacao-resumo resultado">
                          <div>
                            <strong>{previaImportacao.length}</strong>
                            <span>Encontrados</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "valido",
                                ).length
                              }
                            </strong>
                            <span>Novos</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "alterado",
                                ).length
                              }
                            </strong>
                            <span>Com alterações</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) => aluno.status === "igual",
                                ).length
                              }
                            </strong>
                            <span>Sem alterações</span>
                          </div>

                          <div>
                            <strong>
                              {
                                previaImportacao.filter(
                                  (aluno) =>
                                    aluno.status === "duplicado" ||
                                    aluno.status === "invalido",
                                ).length
                              }
                            </strong>
                            <span>Problemas</span>
                          </div>
                        </div>

                        <div className="importacao-lista">
                          {previaImportacao.map((aluno, indice) => (
                            <div
                              key={`${aluno.ra}-${indice}`}
                              className={`importacao-item ${
                                aluno.status === "alterado"
                                  ? "valido"
                                  : aluno.status === "igual"
                                    ? "duplicado"
                                    : aluno.status
                              }`}
                            >
                              <div className="importacao-item-principal">
                                <strong>
                                  {aluno.nome || "Nome não informado"}
                                </strong>

                                <span>
                                  RA {aluno.ra || "—"}
                                  {" · "}
                                  {aluno.curso || "Curso não informado"}
                                </span>

                                {(aluno.email || aluno.email_outro) && (
                                  <small>
                                    {aluno.email || aluno.email_outro}
                                  </small>
                                )}
                              </div>

                              <div className="importacao-item-status">
                                <strong>
                                  {aluno.status === "valido"
                                    ? "NOVO"
                                    : aluno.status === "alterado"
                                      ? "ALTERADO"
                                      : aluno.status === "igual"
                                        ? "SEM ALTERAÇÕES"
                                        : aluno.status === "duplicado"
                                          ? "REPETIDO NO ARQUIVO"
                                          : "INVÁLIDO"}
                                </strong>

                                {aluno.motivo && <span>{aluno.motivo}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

              {resultadoImportacao && !importando && !finalizandoImportacao && (
                <div className="importacao-resultado">
                  <div className="importacao-resultado-ok">✓</div>

                  <h3>Importação concluída</h3>

                  <p>O servidor terminou de processar o lote.</p>

                  <div className="importacao-resumo resultado">
                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.encontrados)}
                      </strong>
                      <span>Processados</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.importados)}
                      </strong>
                      <span>Novos</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.atualizados)}
                      </strong>
                      <span>Atualizados</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(
                          resultadoImportacao.sem_alteracoes,
                        )}
                      </strong>
                      <span>Sem alterações</span>
                    </div>

                    <div>
                      <strong>
                        {quantidadeResultado(resultadoImportacao.invalidos)}
                      </strong>
                      <span>Inválidos</span>
                    </div>
                  </div>
                </div>
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
