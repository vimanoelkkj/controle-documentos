import AppSelect from "../../components/AppSelect";

import type { Unidade } from "../../types/domain";

type Curso = {
  curso: string;
  total_alunos: number;
  unidades: Array<{ unidade: string; total: number }>;
};

type Mensagem = {
  total: number;
  unidade: string;
};

type Props = {
  cursos: Curso[];
  filtrados: Curso[];
  destinos: Record<string, Unidade>;
  busca: string;
  setBusca: (valor: string) => void;
  podeEditar: boolean;
  carregando: boolean;
  erro: string;
  mensagem: Mensagem | null;
  setMensagem: (valor: Mensagem | null) => void;
  setErro: (valor: string) => void;
  setDestinos: React.Dispatch<React.SetStateAction<Record<string, Unidade>>>;
  aoConfirmarCurso: (curso: Curso) => void;
};

const unidades: Unidade[] = ["FACE", "FEA", "FCH", "EAD"];

export function ListaCursos({
  filtrados,
  destinos,
  busca,
  setBusca,
  podeEditar,
  carregando,
  erro,
  mensagem,
  setMensagem,
  setErro,
  setDestinos,
  aoConfirmarCurso,
}: Props) {
  void carregando;
  return (
    <section className="courses-panel">
      <div className="courses-toolbar">
        <div>
          <strong>Mapeamento por curso</strong>
          <span>{filtrados.length} resultado(s)</span>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar curso..."
        />
      </div>

      {mensagem && (
        <div className="courses-feedback-wrap">
          <div className="courses-success-card" role="status">
            <span className="courses-success-icon" aria-hidden="true">
              ✓
            </span>

            <div>
              <strong>Unidade atualizada</strong>
              <span>
                {mensagem.total} aluno(s) movido(s) para {mensagem.unidade}.
              </span>
            </div>

            <button
              type="button"
              onClick={() => setMensagem(null)}
              aria-label="Fechar confirmação"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {erro && <div className="courses-message error">{erro}</div>}

      {filtrados.length === 0 ? (
        <div className="courses-empty">Nenhum curso encontrado.</div>
      ) : (
        <div className="courses-list">
          {filtrados.map((curso) => {
            const atual =
              curso.unidades.length === 1
                ? curso.unidades[0].unidade
                : "DIVERGENTE";

            const destino = destinos[curso.curso] || "FACE";
            const semAlteracao = atual === destino;

            return (
              <article className="course-row" key={curso.curso}>
                <div className="course-copy">
                  <strong>{curso.curso}</strong>
                  <span>{curso.total_alunos} aluno(s)</span>
                </div>

                <div
                  className={`course-current ${
                    atual === "DIVERGENTE" ? "warning" : ""
                  }`}
                >
                  <small>Unidade atual</small>
                  <strong>{atual}</strong>

                  {curso.unidades.length > 1 && (
                    <span>
                      {curso.unidades
                        .map((u) => `${u.unidade}: ${u.total}`)
                        .join(" · ")}
                    </span>
                  )}
                </div>

                <label>
                  <span>Nova unidade</span>

                  <AppSelect
                    value={destino}
                    onChange={(valor) =>
                      setDestinos((estado) => ({
                        ...estado,
                        [curso.curso]: valor as Unidade,
                      }))
                    }
                    disabled={!podeEditar}
                    options={unidades.map((unidade) => ({
                      value: unidade,
                      label: unidade,
                    }))}
                    ariaLabel={`Nova unidade de ${curso.curso}`}
                    className="course-unit-select"
                    menuClassName="course-unit-select-menu"
                  />
                </label>

                <button
                  type="button"
                  className="course-apply-action"
                  disabled={!podeEditar || semAlteracao}
                  onClick={() => {
                    setMensagem(null);
                    setErro("");
                    aoConfirmarCurso(curso);
                  }}
                >
                  Aplicar aos alunos
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
