type ResumoEstatisticas = {
  mediaPorAluno: number;
  taxaDocumental: number;
  documentosEntregues: number;
  documentosPossiveis: number;
  completos: number;
  zerados: number;
};

type Props = {
  resumo: ResumoEstatisticas;
  totalAlunos: number;
};

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

function numero(valor: number, casas = 0) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function EstatisticasKpis({ resumo, totalAlunos }: Props) {
  return (
    <div className="statistics-kpis">
      <article className="statistics-kpi">
        <span>MÉDIA POR ALUNO</span>
        <strong>{numero(resumo.mediaPorAluno, 1)} / 7</strong>
        <small>documentos entregues por matrícula</small>
      </article>

      <article className="statistics-kpi progress">
        <span>TAXA DOCUMENTAL</span>
        <strong>{resumo.taxaDocumental}%</strong>
        <small>
          {numero(resumo.documentosEntregues)} de{" "}
          {numero(resumo.documentosPossiveis)} conferidos
        </small>
      </article>

      <article className="statistics-kpi complete">
        <span>ALUNOS 7/7</span>
        <strong>{numero(resumo.completos)}</strong>
        <small>
          {percentual(resumo.completos, totalAlunos)}% da base analisada
        </small>
      </article>

      <article className="statistics-kpi critical">
        <span>ALUNOS 0/7</span>
        <strong>{numero(resumo.zerados)}</strong>
        <small>
          {percentual(resumo.zerados, totalAlunos)}% sem nenhum documento
        </small>
      </article>
    </div>
  );
}
