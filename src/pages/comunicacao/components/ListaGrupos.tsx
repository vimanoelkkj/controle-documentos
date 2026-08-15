import type { Grupo } from "../model";

type Props = {
  grupos: Grupo[];
  grupoSelecionado: string;
  aoSelecionarGrupo: (chave: string) => void;
};

export function ListaGrupos({
  grupos,
  grupoSelecionado,
  aoSelecionarGrupo,
}: Props) {
  return (
    <aside className="communication-groups">
      <div className="communication-panel-title">
        <div>
          <span>COMBINAÇÕES EXATAS</span>
          <strong>{grupos.length} grupos</strong>
        </div>
      </div>

      <div className="communication-group-list">
        {grupos.map((item) => (
          <button
            key={item.chave}
            type="button"
            className={`communication-group-card ${
              item.chave === grupoSelecionado ? "active" : ""
            }`}
            onClick={() => aoSelecionarGrupo(item.chave)}
          >
            <div className="communication-group-copy">
              <strong>
                {item.documentos.length === 7
                  ? "Todos os documentos"
                  : `${item.documentos.length} documentos pendentes`}
              </strong>

              {item.documentos.length !== 7 && (
                <div className="communication-mini-tags">
                  {item.documentos.map((doc) => (
                    <span
                      key={doc.campo}
                      className={doc.prioritario ? "priority" : ""}
                    >
                      {doc.curto}
                    </span>
                  ))}
                </div>
              )}

              <span>
                {item.alunos.length} aluno
                {item.alunos.length === 1 ? "" : "s"}
                {grupos[0]?.chave === item.chave && grupos.length > 1
                  ? " • maior grupo"
                  : ""}
              </span>
            </div>

            <span className="communication-group-count">
              {item.alunos.length}
            </span>
          </button>
        ))}

        {!grupos.length && (
          <div className="communication-empty">
            Nenhuma combinação encontrada.
          </div>
        )}
      </div>
    </aside>
  );
}
