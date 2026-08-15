import AppSelect from "../../components/AppSelect";
import type { useImportacaoCancelados } from "./hooks/useImportacaoCancelados";
import type { Unidade } from "./model";

type FluxoCancelados = ReturnType<typeof useImportacaoCancelados>;

type Props = {
  fluxo: FluxoCancelados;
  saindo: boolean;
  aoFechar: () => void;
};

export function ModalImportarCancelados({ fluxo, saindo, aoFechar }: Props) {
  const {
    modalImportarCancelados,
    modoCancelados,
    setModoCancelados,
    unidadeCancelados,
    setUnidadeCancelados,
    textoCancelados,
    setTextoCancelados,
    arquivoCancelados,
    previaCancelados,
    setPreviaCancelados,
    resultadoCancelados,
    processandoCancelados,
    erroCancelados,
    setErroCancelados,
    limparImportacaoCancelados,
    selecionarArquivoCancelados,
    gerarPreviaCancelados,
    confirmarCancelados,
  } = fluxo;
  const modalSaindo = saindo ? "importar-cancelados" : null;
  const fecharImportacaoCancelados = aoFechar;

  if (!modalImportarCancelados) return null;

  return (
      <div
        className={`modal-overlay ${modalSaindo === "importar-cancelados" ? "modal-overlay-exit" : ""}`}
      >
        <div className="modal-importacao">
          <div className="modal-cabecalho">
            <div>
              <span className="modal-eyebrow modal-eyebrow-danger">
                CANCELAMENTOS
              </span>
              <h2>Importar cancelados</h2>
              <p>
                Informe a lista oficial. O sistema apenas altera o status do
                aluno e preserva toda a conferência documental.
              </p>
            </div>
    
            <button
              type="button"
              className="modal-fechar"
              onClick={fecharImportacaoCancelados}
              disabled={processandoCancelados}
            >
              ×
            </button>
          </div>
    
          <div className="importacao-conteudo">
            {!resultadoCancelados && (
              <>
                <label className="importacao-unidade">
                  <span>Unidade da lista</span>
    
                  <AppSelect
                    value={unidadeCancelados}
                    onChange={(valor) => {
                      setUnidadeCancelados(valor as Unidade);
                      setPreviaCancelados(null);
                    }}
                    disabled={processandoCancelados}
                    ariaLabel="Unidade da lista"
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
                    className={modoCancelados === "colar" ? "active" : ""}
                    onClick={() => {
                      setModoCancelados("colar");
                      limparImportacaoCancelados();
                    }}
                  >
                    Colar dados
                  </button>
    
                  <button
                    type="button"
                    className={modoCancelados === "csv" ? "active" : ""}
                    onClick={() => {
                      setModoCancelados("csv");
                      limparImportacaoCancelados();
                    }}
                  >
                    Arquivo CSV
                  </button>
                </div>
    
                {!previaCancelados ? (
                  <>
                    {modoCancelados === "colar" ? (
                      <div className="importacao-colar">
                        <textarea
                          value={textoCancelados}
                          onChange={(event) => {
                            setTextoCancelados(event.target.value);
                            setErroCancelados("");
                          }}
                          placeholder={`Cole a lista com cabeçalho.
    
    Exemplo:
    Contrato    Curso    E-mail (outro)    E-mail    Nome    RA
    Não Entregue    PSICOLOGIA    aluno@gmail.com    a123@fumec.edu.br    JOÃO DA SILVA    2910130000`}
                        />
                      </div>
                    ) : (
                      <div className="importacao-arquivo">
                        <input
                          id="arquivo-cancelados"
                          type="file"
                          accept=".csv,text/csv"
                          onChange={selecionarArquivoCancelados}
                        />
    
                        <label
                          htmlFor="arquivo-cancelados"
                          className="importacao-dropzone"
                        >
                          <strong>
                            {arquivoCancelados ||
                              "Selecionar arquivo de cancelados"}
                          </strong>
                          <span>
                            {arquivoCancelados
                              ? "Arquivo carregado e pronto para análise."
                              : "Clique para selecionar um arquivo .csv"}
                          </span>
                        </label>
                      </div>
                    )}
    
                    <button
                      type="button"
                      className="botao-analisar-importacao"
                      onClick={gerarPreviaCancelados}
                      disabled={
                        !textoCancelados.trim() || processandoCancelados
                      }
                    >
                      {processandoCancelados
                        ? "Analisando..."
                        : "Analisar cancelados"}
                    </button>
                  </>
                ) : (
                  <div className="importacao-previa">
                    <div className="importacao-previa-cabecalho">
                      <div>
                        <span>PRÉVIA</span>
                        <h3>Confira antes de cancelar</h3>
                      </div>
    
                      <button
                        type="button"
                        onClick={() => setPreviaCancelados(null)}
                      >
                        ← Editar dados
                      </button>
                    </div>
    
                    <div className="importacao-resumo resultado">
                      <div>
                        <strong>{previaCancelados.recebidos}</strong>
                        <span>Encontrados</span>
                      </div>
                      <div>
                        <strong>
                          {previaCancelados.prontos_para_cancelar}
                        </strong>
                        <span>Prontos</span>
                      </div>
                      <div>
                        <strong>{previaCancelados.ja_cancelados}</strong>
                        <span>Já cancelados</span>
                      </div>
                      <div>
                        <strong>{previaCancelados.nao_encontrados}</strong>
                        <span>Não encontrados</span>
                      </div>
                      <div>
                        <strong>{previaCancelados.outra_unidade}</strong>
                        <span>Outra unidade</span>
                      </div>
                    </div>
    
                    <div className="importacao-lista">
                      {previaCancelados.alunos.map((aluno, indice) => (
                        <div
                          key={`${aluno.ra}-${indice}`}
                          className={`importacao-item ${
                            aluno.status_previa === "PRONTO"
                              ? "cancelar"
                              : aluno.status_previa === "JA_CANCELADO"
                                ? "duplicado"
                                : "invalido"
                          }`}
                        >
                          <div className="importacao-item-principal">
                            <strong>
                              {aluno.nome || "Aluno não encontrado"}
                            </strong>
                            <span>
                              RA {aluno.ra}
                              {aluno.curso ? ` · ${aluno.curso}` : ""}
                            </span>
                            {aluno.unidade && (
                              <small>Unidade atual: {aluno.unidade}</small>
                            )}
                          </div>
    
                          <div className="importacao-item-status">
                            <strong>
                              {aluno.status_previa === "PRONTO"
                                ? "ATIVO → CANCELADO"
                                : aluno.status_previa === "JA_CANCELADO"
                                  ? "JÁ CANCELADO"
                                  : aluno.status_previa === "OUTRA_UNIDADE"
                                    ? "OUTRA UNIDADE"
                                    : "NÃO ENCONTRADO"}
                            </strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
    
            {resultadoCancelados && (
              <div className="importacao-resultado">
                <div className="importacao-resultado-ok">✓</div>
                <h3>Cancelamentos concluídos</h3>
                <p>Os registros documentais foram preservados.</p>
    
                <div className="importacao-resumo resultado">
                  <div>
                    <strong>{resultadoCancelados.recebidos}</strong>
                    <span>Processados</span>
                  </div>
                  <div>
                    <strong>{resultadoCancelados.cancelados}</strong>
                    <span>Cancelados</span>
                  </div>
                  <div>
                    <strong>{resultadoCancelados.ja_cancelados}</strong>
                    <span>Já cancelados</span>
                  </div>
                  <div>
                    <strong>{resultadoCancelados.nao_encontrados}</strong>
                    <span>Não encontrados</span>
                  </div>
                  <div>
                    <strong>{resultadoCancelados.outra_unidade}</strong>
                    <span>Outra unidade</span>
                  </div>
                </div>
              </div>
            )}
    
            {erroCancelados && (
              <div className="modal-erro">{erroCancelados}</div>
            )}
          </div>
    
          <div className="modal-acoes">
            {!resultadoCancelados ? (
              <>
                <button
                  type="button"
                  className="botao-cancelar"
                  onClick={fecharImportacaoCancelados}
                  disabled={processandoCancelados}
                >
                  Cancelar
                </button>
    
                {previaCancelados && (
                  <button
                    type="button"
                    className="botao-confirmar-exclusao"
                    onClick={confirmarCancelados}
                    disabled={
                      processandoCancelados ||
                      previaCancelados.prontos_para_cancelar === 0
                    }
                  >
                    {processandoCancelados
                      ? "Cancelando..."
                      : `Cancelar ${previaCancelados.prontos_para_cancelar} aluno(s)`}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="botao-cadastrar"
                onClick={fecharImportacaoCancelados}
              >
                Concluir
              </button>
            )}
          </div>
        </div>
      </div>
    
  );
}
