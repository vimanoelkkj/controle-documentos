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
    <div className="audit-consistency-compact">
      <button
        type="button"
        className="audit-verify-link audit-integrity-action"
        onClick={() => void aoVerificar()}
        disabled={verificando || !periodoDisponivel}
      >
        <span>
          <strong>{verificando ? "Comparando bases..." : diagnostico ? "Verificar novamente" : "Verificar agora"}</strong>
          <small>Verifique novamente a integridade entre o sistema e a planilha.</small>
        </span>
      </button>

      {erroDiagnostico && (
        <div className="audit-consistency-error">{erroDiagnostico}</div>
      )}

      {diagnostico && !erroDiagnostico && (
        <div className={`audit-consistency-result ${bloqueado ? "blocked" : ""}`}>
          <strong>
            {bloqueado
              ? "Sincronização bloqueada"
              : totalDivergencias
                ? `${totalDivergencias} divergência(s)`
                : "Bases consistentes"}
          </strong>
          <span>
            {bloqueado
              ? `${cursosNaoMapeados} curso(s) a mapear · ${alunosSemUnidade} aluno(s) afetado(s)`
              : `${diagnostico.encontrados} aluno(s) analisado(s)`}
          </span>
        </div>
      )}
    </div>
  );
}
