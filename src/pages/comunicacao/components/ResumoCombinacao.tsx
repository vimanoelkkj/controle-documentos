import type { Grupo } from "../model";

type Props = {
  grupo: Grupo;
  alunosJaCobrados: number;
  alunosNaoCobrados: number;
  ultimaCobrancaGrupo: string;
};

export function ResumoCombinacao({
  grupo,
  alunosJaCobrados,
  alunosNaoCobrados,
  ultimaCobrancaGrupo,
}: Props) {
  return (
    <>
      <div className="communication-detail-header">
        <div>
          <span>COMBINAÇÃO EXATA</span>

          <h2>
            {grupo.documentos.length === 7
              ? "Todos os documentos"
              : grupo.documentos.map((doc) => doc.curto).join(" + ")}
          </h2>

          <p>
            Aqui entram somente alunos que devem exatamente estes documentos —
            nenhum a mais e nenhum a menos.
          </p>

          <div className="communication-charge-summary">
            <span>
              <b>{alunosJaCobrados}</b> já cobrado(s)
            </span>

            <span>
              <b>{alunosNaoCobrados}</b> ainda não cobrado(s)
            </span>

            {ultimaCobrancaGrupo && (
              <span>
                Última cobrança:{" "}
                <b>{new Date(ultimaCobrancaGrupo).toLocaleString("pt-BR")}</b>
              </span>
            )}
          </div>
        </div>

        <strong className="communication-big-count">
          {grupo.alunos.length}
        </strong>
      </div>

      <div className="communication-tags">
        {grupo.documentos.map((documento) => (
          <span
            key={documento.campo}
            className={documento.prioritario ? "priority" : ""}
          >
            {documento.curto}
            {documento.prioritario ? " • prioritário" : ""}
          </span>
        ))}
      </div>
    </>
  );
}
