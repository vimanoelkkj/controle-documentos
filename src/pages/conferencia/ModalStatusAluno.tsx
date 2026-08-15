import type { Aluno } from "./model";

type ModalStatusAlunoProps = {
  aberto: boolean;
  saindo: boolean;
  aluno: Aluno;
  processando: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void;
};

export function ModalStatusAluno({
  aberto,
  saindo,
  aluno,
  processando,
  aoFechar,
  aoConfirmar,
}: ModalStatusAlunoProps) {
  if (!aberto) return null;

  const cancelando = aluno.status === "ATIVO";

  return (
    <div className={`modal-overlay ${saindo ? "modal-overlay-exit" : ""}`}>
      <div className="modal-excluir-aluno">
        <div className={cancelando ? "modal-excluir-icon" : "modal-reativar-icon"}>
          {cancelando ? "!" : "↻"}
        </div>

        <div className="modal-excluir-conteudo">
          <span
            className={
              cancelando ? "modal-eyebrow modal-eyebrow-danger" : "modal-eyebrow"
            }
          >
            {cancelando ? "CANCELAMENTO" : "REATIVAÇÃO"}
          </span>
          <h2>{cancelando ? "Cancelar matrícula?" : "Reativar matrícula?"}</h2>
          <p>
            {cancelando
              ? "O aluno será retirado da lista de ativos, mas todo o cadastro e a conferência documental serão preservados."
              : "O aluno voltará para a lista de ativos e manterá todo o histórico documental existente."}
          </p>
          <div className="aluno-exclusao-card">
            <strong>{aluno.nome}</strong>
            <span>
              RA {aluno.ra} · {aluno.curso}
            </span>
          </div>
          <p className="modal-excluir-aviso">
            {cancelando
              ? "Status atual: ATIVO → novo status: CANCELADO"
              : "Status atual: CANCELADO → novo status: ATIVO"}
          </p>
        </div>

        <div className="modal-excluir-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={processando}
          >
            Voltar
          </button>
          <button
            type="button"
            className={cancelando ? "botao-confirmar-exclusao" : "botao-cadastrar"}
            onClick={aoConfirmar}
            disabled={processando}
          >
            {processando
              ? "Salvando..."
              : cancelando
                ? "Cancelar matrícula"
                : "Reativar matrícula"}
          </button>
        </div>
      </div>
    </div>
  );
}
