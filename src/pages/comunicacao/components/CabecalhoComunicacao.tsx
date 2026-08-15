import AppIcon from "../../../components/AppIcon";
import AppSelect from "../../../components/AppSelect";

type Props = {
  quantidadeGrupos: number;
  unidade: string;
  setUnidade: (valor: string) => void;
  unidades: string[];
  buscaGrupo: string;
  setBuscaGrupo: (valor: string) => void;
};

export function CabecalhoComunicacao({
  quantidadeGrupos,
  unidade,
  setUnidade,
  unidades,
  buscaGrupo,
  setBuscaGrupo,
}: Props) {
  return (
    <>
      <header className="communication-header">
        <div>
          <span className="communication-eyebrow">CENTRAL DE COMUNICAÇÃO</span>

          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="mail" size={22} />
            </span>
            <h1>Cobrança de documentos</h1>
          </div>

          <p>
            Grupos automáticos por combinação exata de pendências. Escolha um
            grupo, revise os alunos e copie os destinatários para o Outlook.
          </p>
        </div>

        <div className="communication-summary">
          <strong>{quantidadeGrupos}</strong>
          <span>combinações encontradas</span>
        </div>
      </header>

      <div className="communication-toolbar">
        <label>
          Unidade
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Filtrar comunicação por unidade"
            options={[
              { value: "TODAS", label: "Todas as unidades" },
              ...unidades.map((item) => ({
                value: item,
                label: item,
              })),
            ]}
          />
        </label>

        <label className="communication-search">
          Buscar combinação
          <input
            type="search"
            value={buscaGrupo}
            onChange={(e) => setBuscaGrupo(e.target.value)}
            placeholder="Ex.: Contrato, CPF, Histórico..."
          />
        </label>
      </div>
    </>
  );
}
