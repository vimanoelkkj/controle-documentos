import AppSelect from "../../../components/AppSelect";
import type { SheetsPrevia } from "./model";

type Props = {
  cursosPendentes: SheetsPrevia["cursos_pendentes"];
  mapeamentos: Record<string, string>;
  setMapeamentos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  mapeamentosAlterados: Array<[string, string]>;
  salvandoMapeamentos: boolean;
  modoApresentacao: boolean;
  salvarMapeamentos: () => Promise<void>;
};

export function GoogleSheetsCourseMap({
  cursosPendentes,
  mapeamentos,
  setMapeamentos,
  mapeamentosAlterados,
  salvandoMapeamentos,
  modoApresentacao,
  salvarMapeamentos,
}: Props) {
  if (!cursosPendentes.length) {
    return (
      <div className="period-sheets-resolved">
        ✓ Todas as unidades foram resolvidas.
      </div>
    );
  }

  return (
    <div className="period-course-map">
      {cursosPendentes.map((grupo) => (
        <article key={grupo.curso}>
          <div className="period-course-info">
            <strong>{grupo.curso}</strong>
            <span>{grupo.quantidade} aluno(s) será(ão) resolvido(s)</span>
            <small>
              {grupo.alunos
                .slice(0, 3)
                .map((a) => a.nome)
                .join(" · ")}
              {grupo.alunos.length > 3 ? ` · +${grupo.alunos.length - 3}` : ""}
            </small>
          </div>
          <div className="period-course-actions">
            <AppSelect
              value={mapeamentos[grupo.curso] || ""}
              onChange={(valor) =>
                setMapeamentos((atual) => ({ ...atual, [grupo.curso]: valor }))
              }
              disabled={modoApresentacao || salvandoMapeamentos}
              ariaLabel={`Mapear ${grupo.curso} para uma unidade`}
              options={[
                { value: "", label: "Selecionar unidade" },
                { value: "FACE", label: "FACE" },
                { value: "FEA", label: "FEA" },
                { value: "FCH", label: "FCH" },
                { value: "EAD", label: "EAD" },
              ]}
            />
          </div>
        </article>
      ))}
      <div className="period-course-map-save">
        <div>
          <span>MAPEAMENTO DE UNIDADES</span>
          <strong>
            {mapeamentosAlterados.length
              ? `${mapeamentosAlterados.length} alteração(ões) pronta(s) para salvar`
              : "Nenhuma alteração para salvar"}
          </strong>
          <small>Ajuste todos os cursos acima e salve tudo de uma vez.</small>
        </div>
        {!modoApresentacao && (
          <button
            type="button"
            onClick={salvarMapeamentos}
            disabled={!mapeamentosAlterados.length || salvandoMapeamentos}
          >
            {salvandoMapeamentos
              ? "Salvando unidades..."
              : mapeamentosAlterados.length
                ? `Salvar ${mapeamentosAlterados.length} alteração(ões)`
                : "Salvar unidades"}
          </button>
        )}
      </div>
    </div>
  );
}
