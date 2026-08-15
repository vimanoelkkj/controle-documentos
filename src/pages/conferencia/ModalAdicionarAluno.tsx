type ModalAdicionarAlunoProps = {
  aberto: boolean;
  saindo: boolean;
  aoFechar: () => void;
  aoNovoAluno: () => void;
  aoImportar: () => void;
};

export function ModalAdicionarAluno({
  aberto,
  saindo,
  aoFechar,
  aoNovoAluno,
  aoImportar,
}: ModalAdicionarAlunoProps) {
  if (!aberto) return null;

  return (
    <div className={`modal-overlay ${saindo ? "modal-overlay-exit" : ""}`}>
      <div className="modal-novo-aluno modal-adicionar-aluno">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">ALUNOS</span>
            <h2>Adicionar alunos</h2>
            <p>Escolha como deseja incluir alunos na conferência.</p>
          </div>
          <button type="button" className="modal-fechar" onClick={aoFechar}>
            ×
          </button>
        </div>

        <div className="adicionar-aluno-opcoes">
          <button type="button" onClick={aoNovoAluno}>
            <strong>+ Novo aluno</strong>
            <span>Cadastrar um aluno manualmente.</span>
          </button>
          <button type="button" onClick={aoImportar}>
            <strong>⇧ Importar lista</strong>
            <span>Adicionar ou atualizar vários alunos de uma vez.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
