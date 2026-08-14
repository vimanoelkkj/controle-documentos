import type { Aluno } from "./model";

type ModalExcluirAlunoProps = {
  aberto: boolean;
  saindo: boolean;
  aluno: Aluno;
  excluindo: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void;
};

export function ModalExcluirAluno({
  aberto,
  saindo,
  aluno,
  excluindo,
  aoFechar,
  aoConfirmar,
}: ModalExcluirAlunoProps) {
  if (!aberto) return null;

  return (
    <div className={`modal-overlay ${saindo ? "modal-overlay-exit" : ""}`}>
      <div className="modal-excluir-aluno">
        <div className="modal-excluir-icon">!</div>

        <div className="modal-excluir-conteudo">
          <span className="modal-eyebrow modal-eyebrow-danger">EXCLUSÃO</span>
          <h2>Excluir permanentemente?</h2>
          <p>Este recurso é reservado para cadastros criados por engano:</p>
          <div className="aluno-exclusao-card">
            <strong>{aluno.nome}</strong>
            <span>
              RA {aluno.ra} · {aluno.curso}
            </span>
          </div>
          <p className="modal-excluir-aviso">
            O aluno e todo o controle de documentos associado serão excluídos.
            Esta ação não pode ser desfeita.
          </p>
        </div>

        <div className="modal-excluir-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={excluindo}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="botao-confirmar-exclusao"
            onClick={aoConfirmar}
            disabled={excluindo}
          >
            {excluindo ? "Excluindo..." : "Excluir permanentemente"}
          </button>
        </div>
      </div>
    </div>
  );
}
