type CursoStats = {
  curso: string;
  total: number;
  completos: number;
  taxaCompleta: number;
  progresso: number;
};

type Props = {
  cursos: CursoStats[];
};

export function CardCursos({ cursos }: Props) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-header">
        <div>
          <span>CURSOS</span>
          <h2>Maiores bases da seleção</h2>
        </div>
        <small>até 8 cursos</small>
      </div>

      <div className="statistics-course-list">
        {cursos.map((curso) => (
          <div className="statistics-course-row" key={curso.curso}>
            <div className="statistics-course-name">
              <strong title={curso.curso}>{curso.curso}</strong>
              <small>
                {curso.total} alunos · {curso.completos} completos
              </small>
            </div>

            <div className="statistics-course-progress">
              <div>
                <span style={{ width: `${curso.progresso}%` }} />
              </div>
              <strong>{curso.progresso}%</strong>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
