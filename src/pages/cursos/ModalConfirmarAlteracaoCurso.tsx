import type { Unidade } from "../../types/domain";

type Curso = {
  curso: string;
  total_alunos: number;
  unidades: Array<{ unidade: string; total: number }>;
};

type Props = {
  curso: Curso;
  unidadeDestino: Unidade;
  periodoCodigo?: string;
  confirmacao: string;
  setConfirmacao: (valor: string) => void;
  salvando: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void | Promise<void>;
};

export function ModalConfirmarAlteracaoCurso({
  curso,
  unidadeDestino,
  periodoCodigo,
  confirmacao,
  setConfirmacao,
  salvando,
  aoFechar,
  aoConfirmar,
}: Props) {
  return (
    <div
      className="modal-overlay courses-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !salvando) {
          aoFechar();
        }
      }}
    >
      <section
        className="courses-confirm-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <span>ALTERAÇÃO EM MASSA</span>
          <h2>Confirmar nova unidade</h2>
          <p>
            <strong>{curso.curso}</strong>
          </p>
        </header>

        <div className="courses-confirm-body">
          <div>
            <span>Alunos afetados</span>
            <strong>{curso.total_alunos}</strong>
          </div>

          <div>
            <span>Nova unidade</span>
            <strong>{unidadeDestino}</strong>
          </div>

          <p>
            Todos os alunos desse curso no período{" "}
            <strong>{periodoCodigo || "atual"}</strong> serão vinculados à nova
            unidade. O mapeamento também será usado nas próximas sincronizações.
          </p>

          <label>
            <span className="courses-confirm-label">
              Digite <strong>ALTERAR</strong> para confirmar
            </span>

            <input
              autoFocus
              value={confirmacao}
              onChange={(e) =>
                setConfirmacao(e.target.value.toLocaleUpperCase("pt-BR"))
              }
            />
          </label>
        </div>

        <footer>
          <button type="button" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>

          <button
            type="button"
            className="confirm"
            onClick={() => void aoConfirmar()}
            disabled={salvando || confirmacao !== "ALTERAR"}
          >
            {salvando ? "Alterando..." : "Confirmar alteração"}
          </button>
        </footer>
      </section>
    </div>
  );
}
