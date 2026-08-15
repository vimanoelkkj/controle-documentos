import type { useImportacaoAlunos } from "../hooks/useImportacaoAlunos";

type FluxoImportacao = ReturnType<typeof useImportacaoAlunos>;

type Props = {
  previa: FluxoImportacao["previaImportacao"];
  aoEditar: () => void;
};

export function PreviaImportacaoAlunos({ previa, aoEditar }: Props) {
  const novos = previa.filter((aluno) => aluno.status === "valido").length;

  const alterados = previa.filter(
    (aluno) => aluno.status === "alterado",
  ).length;

  const iguais = previa.filter((aluno) => aluno.status === "igual").length;

  const problemas = previa.filter(
    (aluno) => aluno.status === "duplicado" || aluno.status === "invalido",
  ).length;

  return (
    <div className="importacao-previa">
      <div className="importacao-previa-cabecalho">
        <div>
          <span>PRÉVIA</span>
          <h3>Confira antes de importar</h3>
        </div>

        <button type="button" onClick={aoEditar}>
          ← Editar dados
        </button>
      </div>

      <div className="importacao-resumo resultado">
        <div>
          <strong>{previa.length}</strong>
          <span>Encontrados</span>
        </div>

        <div>
          <strong>{novos}</strong>
          <span>Novos</span>
        </div>

        <div>
          <strong>{alterados}</strong>
          <span>Com alterações</span>
        </div>

        <div>
          <strong>{iguais}</strong>
          <span>Sem alterações</span>
        </div>

        <div>
          <strong>{problemas}</strong>
          <span>Problemas</span>
        </div>
      </div>

      <div className="importacao-lista">
        {previa.map((aluno, indice) => (
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
              <strong>{aluno.nome || "Nome não informado"}</strong>

              <span>
                RA {aluno.ra || "—"} · {aluno.curso || "Curso não informado"}
              </span>

              {(aluno.email || aluno.email_outro) && (
                <small>{aluno.email || aluno.email_outro}</small>
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
  );
}
