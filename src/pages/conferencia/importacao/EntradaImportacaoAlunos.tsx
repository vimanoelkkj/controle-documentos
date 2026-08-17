import type { ChangeEvent } from "react";
import AppSelect from "../../../components/AppSelect";
import type { Unidade } from "../model";

type Props = {
  modoImportacao: "colar" | "csv";
  setModoImportacao: (modo: "colar" | "csv") => void;
  unidadeImportacao: Unidade | "";
  setUnidadeImportacao: (unidade: Unidade | "") => void;
  textoImportacao: string;
  setTextoImportacao: (valor: string) => void;
  arquivoImportacao: string;
  importando: boolean;
  limparImportacao: () => void;
  selecionarArquivoImportacao: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>;
  gerarPreviaImportacao: () => void;
  aoMudarUnidade: () => void;
  aoLimparErro: () => void;
};

export function EntradaImportacaoAlunos({
  modoImportacao,
  setModoImportacao,
  unidadeImportacao,
  setUnidadeImportacao,
  textoImportacao,
  setTextoImportacao,
  arquivoImportacao,
  importando,
  limparImportacao,
  selecionarArquivoImportacao,
  gerarPreviaImportacao,
  aoMudarUnidade,
  aoLimparErro,
}: Props) {
  return (
    <>
      <label className="importacao-unidade">
        <span>Unidade de destino</span>

        <AppSelect
          value={unidadeImportacao}
          onChange={(valor) => {
            setUnidadeImportacao(valor as Unidade | "");
            aoMudarUnidade();
          }}
          disabled={importando}
          ariaLabel="Unidade de destino"
          options={[
            {
              value: "",
              label: "Selecione a unidade",
              disabled: true,
            },
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

      {modoImportacao === "colar" ? (
        <div className="importacao-colar">
          <textarea
            value={textoImportacao}
            onChange={(event) => {
              setTextoImportacao(event.target.value);
              aoLimparErro();
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
            onChange={(event) => void selecionarArquivoImportacao(event)}
          />

          <label htmlFor="arquivo-importacao" className="importacao-dropzone">
            <strong>{arquivoImportacao || "Selecionar arquivo CSV"}</strong>

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
        disabled={!textoImportacao.trim() || !unidadeImportacao}
      >
        Analisar dados
      </button>
    </>
  );
}
