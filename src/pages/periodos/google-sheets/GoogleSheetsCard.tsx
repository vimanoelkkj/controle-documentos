import type {
  SheetsConfig,
  SheetsPrevia,
  SheetsStatus,
  AbaPrevia,
} from "../hooks/useGoogleSheetsPeriodo";
import { GoogleSheetsPreview } from "./GoogleSheetsPreview";

type Props = {
  codigoPeriodo?: string;
  modoApresentacao: boolean;
  sheetsConfig: SheetsConfig;
  setSheetsConfig: React.Dispatch<React.SetStateAction<SheetsConfig>>;
  sheetsStatus: SheetsStatus;
  sheetsTitulo: string;
  sheetsSalvo: boolean;
  sheetsCarregando: boolean;
  sheetsErro: string;
  sheetsPrevia: SheetsPrevia | null;
  abaPrevia: AbaPrevia | null;
  setAbaPrevia: (aba: AbaPrevia | null) => void;
  listaPreviaRef: React.RefObject<HTMLDivElement | null>;
  mapeamentos: Record<string, string>;
  setMapeamentos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  salvandoMapeamentos: boolean;
  mapeamentosAlterados: Array<[string, string]>;
  salvarSheets: () => Promise<void>;
  gerarPreviaSheets: () => Promise<void>;
  salvarMapeamentos: () => Promise<void>;
  totalOperacoesPrevia: number;
  sincronizandoSheets: boolean;
  abrirSincronizacao: () => void;
};

export function GoogleSheetsCard(props: Props) {
  const {
    codigoPeriodo,
    modoApresentacao,
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
    salvarSheets,
    gerarPreviaSheets,
    salvarMapeamentos,
    totalOperacoesPrevia,
    sincronizandoSheets,
    abrirSincronizacao,
  } = props;

  const campos: Array<[string, keyof SheetsConfig]> = [
    ["Base FACE / FEA", "aba_base_face_fea"],
    ["Base FCH / EAD", "aba_base_fch_ead"],
    ["Documentos FACE / FEA", "aba_docs_face_fea"],
    ["Documentos FCH / EAD", "aba_docs_fch_ead"],
    ["Cancelados FACE / FEA", "aba_cancelados_face_fea"],
    ["Cancelados FCH / EAD", "aba_cancelados_fch_ead"],
  ];

  return (
    <section className="period-sheets-card">
      <div className="period-sheets-heading">
        <div>
          <span>INTEGRAÇÃO</span>
          <h2>Google Sheets</h2>
          <p>
            Leitura segura da planilha vinculada ao período{" "}
            <strong>{codigoPeriodo ?? "—"}</strong>. A prévia não altera o
            sistema nem a planilha.
          </p>
        </div>
        <div className="period-sheets-heading-status">
          <span
            className={`period-sheets-status ${sheetsStatus === "configurado" ? "connected" : ""}`}
          >
            {sheetsStatus === "carregando"
              ? "CARREGANDO..."
              : sheetsStatus === "configurado"
                ? "CONFIGURADO"
                : sheetsStatus === "indisponivel"
                  ? "INDISPONÍVEL"
                  : "NÃO CONFIGURADO"}
          </span>
          {sheetsTitulo && (
            <div className="period-sheets-file" title={sheetsTitulo}>
              <span>PLANILHA VINCULADA</span>
              <strong>{sheetsTitulo}</strong>
            </div>
          )}
        </div>
      </div>

      <label className="period-sheets-main">
        <span>Link ou ID da planilha</span>
        <input
          value={
            modoApresentacao
              ? sheetsConfig.spreadsheet_id
                ? "Planilha configurada"
                : ""
              : sheetsConfig.spreadsheet_id
          }
          disabled={modoApresentacao}
          onChange={(e) =>
            setSheetsConfig({ ...sheetsConfig, spreadsheet_id: e.target.value })
          }
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
      </label>

      <div className="period-sheets-grid">
        {campos.map(([rotulo, campo]) => (
          <label key={campo}>
            <span>{rotulo}</span>
            <input
              value={sheetsConfig[campo]}
              disabled={modoApresentacao}
              onChange={(e) =>
                setSheetsConfig({ ...sheetsConfig, [campo]: e.target.value })
              }
            />
          </label>
        ))}
      </div>

      {sheetsErro && <div className="period-sheets-error">{sheetsErro}</div>}
      <div className="period-sheets-actions">
        {!modoApresentacao && (
          <button
            type="button"
            className="secondary"
            onClick={salvarSheets}
            disabled={sheetsCarregando || !codigoPeriodo}
          >
            {sheetsCarregando ? "Aguarde..." : "Salvar configuração"}
          </button>
        )}
        <button
          type="button"
          onClick={gerarPreviaSheets}
          disabled={sheetsCarregando || !sheetsSalvo}
        >
          {sheetsCarregando ? "Lendo..." : "Ler planilha e gerar prévia"}
        </button>
      </div>

      {sheetsPrevia && (
        <GoogleSheetsPreview
          previa={sheetsPrevia}
          abaPrevia={abaPrevia}
          setAbaPrevia={setAbaPrevia}
          listaPreviaRef={listaPreviaRef}
          mapeamentos={mapeamentos}
          setMapeamentos={setMapeamentos}
          mapeamentosAlterados={mapeamentosAlterados}
          salvandoMapeamentos={salvandoMapeamentos}
          modoApresentacao={modoApresentacao}
          salvarMapeamentos={salvarMapeamentos}
          totalOperacoesPrevia={totalOperacoesPrevia}
          sincronizandoSheets={sincronizandoSheets}
          abrirSincronizacao={abrirSincronizacao}
        />
      )}
    </section>
  );
}
