type DiagnosticoSheets = {
  encontrados: number;
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  prontos_para_cancelar: number;
  prontos_para_reativar: number;
  prontos_para_remover: number;
  alunos_sem_unidade: number;
  cursos_nao_mapeados: number;
  unidades_nao_resolvidas: number;
};

type Props = {
  diagnostico: DiagnosticoSheets | null;
  periodoCodigo?: string | null;
  verificando: boolean;
  erroDiagnostico: string;
  bloqueado: boolean;
  totalDivergencias: number;
  cursosNaoMapeados: number;
  alunosSemUnidade: number;
  aoVerificar: () => void | Promise<void>;
  periodoDisponivel: boolean;
};

export function DiagnosticoConsistencia({
  diagnostico,
  periodoCodigo,
  verificando,
  erroDiagnostico,
  bloqueado,
  totalDivergencias,
  cursosNaoMapeados,
  alunosSemUnidade,
  aoVerificar,
  periodoDisponivel,
}: Props) {
  return (
    <section
      className={`audit-consistency ${
        bloqueado ? "blocked" : diagnostico ? "checked" : ""
      }`}
    >
      <div className="audit-consistency-head">
        <div>
          <span>PLANILHA ↔ SISTEMA</span>

          <strong>Diagnóstico de consistência · {periodoCodigo || "—"}</strong>

          <p>A comparação é somente leitura. Nenhum dado será alterado.</p>
        </div>

        <button
          type="button"
          onClick={() => void aoVerificar()}
          disabled={verificando || !periodoDisponivel}
        >
          {verificando
            ? "Comparando bases..."
            : diagnostico
              ? "Verificar novamente"
              : "Verificar agora"}
        </button>
      </div>

      {erroDiagnostico && (
        <div className="audit-consistency-error">{erroDiagnostico}</div>
      )}

      {diagnostico && (
        <>
          <div className="audit-consistency-status">
            <strong>
              {bloqueado
                ? "Sincronização bloqueada"
                : totalDivergencias
                  ? `${totalDivergencias} divergência(s) encontrada(s)`
                  : "Bases consistentes"}
            </strong>

            <span>
              {bloqueado
                ? `${cursosNaoMapeados} curso(s) precisam ser mapeados, afetando ${alunosSemUnidade} aluno(s).`
                : `${diagnostico.encontrados} aluno(s) analisado(s).`}
            </span>
          </div>

          <div className="audit-consistency-grid">
            {[
              ["Somente na planilha", diagnostico.novos, "new"],
              [
                "Cadastros diferentes",
                diagnostico.alteracoes_cadastrais,
                "change",
              ],
              [
                "Documentos diferentes",
                diagnostico.documentos_alterados,
                "change",
              ],
              ["A cancelar", diagnostico.prontos_para_cancelar, "warning"],
              ["A reativar", diagnostico.prontos_para_reativar, "change"],
              [
                "Somente no sistema",
                diagnostico.prontos_para_remover,
                "warning",
              ],
              ["Cursos a mapear", cursosNaoMapeados, "blocked"],
            ].map(([rotulo, valor, classe]) => (
              <article className={String(classe)} key={String(rotulo)}>
                <span>{rotulo}</span>
                <strong>{valor}</strong>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
