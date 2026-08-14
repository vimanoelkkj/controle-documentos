type ModalTrocaAlunoProps = {
  aberto: boolean;
  nomeAluno: string;
  aoVoltar: () => void;
  aoDescartar: () => void;
};

export function ModalTrocaAluno({
  aberto,
  nomeAluno,
  aoVoltar,
  aoDescartar,
}: ModalTrocaAlunoProps) {
  if (!aberto) return null;

  return (
    <div className="modal-overlay">
      <section
        className="unsaved-student-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-student-title"
      >
        <div className="unsaved-student-icon">!</div>
        <span className="unsaved-student-eyebrow">
          ALTERAÇÕES NÃO SALVAS
        </span>
        <h2 id="unsaved-student-title">Trocar de aluno?</h2>
        <p>
          Você modificou a documentação de <strong>{nomeAluno}</strong>. Se
          continuar, essas alterações serão descartadas.
        </p>
        <div className="unsaved-student-actions">
          <button
            type="button"
            className="unsaved-student-back"
            onClick={aoVoltar}
          >
            Voltar e salvar
          </button>
          <button
            type="button"
            className="unsaved-student-discard"
            onClick={aoDescartar}
          >
            Descartar e continuar
          </button>
        </div>
      </section>
    </div>
  );
}
