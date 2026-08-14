import type { Dispatch, SetStateAction } from "react";
import { FormularioAluno } from "./FormularioAluno";
import type { FormAluno } from "./model";

type ModalEditarAlunoProps = {
  aberto: boolean;
  saindo: boolean;
  dados: FormAluno;
  setDados: Dispatch<SetStateAction<FormAluno>>;
  erro: string;
  editando: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  aoExcluir: () => void;
};

export function ModalEditarAluno({
  aberto,
  saindo,
  dados,
  setDados,
  erro,
  editando,
  aoFechar,
  aoSalvar,
  aoExcluir,
}: ModalEditarAlunoProps) {
  if (!aberto) return null;

  return (
    <div className={`modal-overlay ${saindo ? "modal-overlay-exit" : ""}`}>
      <div className="modal-novo-aluno">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">EDIÇÃO</span>
            <h2>Editar aluno</h2>
            <p>Atualize os dados cadastrais do aluno.</p>
          </div>
          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={editando}
          >
            ×
          </button>
        </div>

        <FormularioAluno dados={dados} setDados={setDados} />
        {erro && <div className="modal-erro">{erro}</div>}

        <div className="edit-student-danger-zone">
          <strong>ZONA DE PERIGO</strong>
          <p>
            Excluir permanentemente deve ser usado apenas quando este cadastro
            foi criado por engano. Para saída do aluno, use o cancelamento de
            matrícula.
          </p>
          <button
            type="button"
            className="student-delete-button"
            onClick={aoExcluir}
            disabled={editando}
          >
            Excluir permanentemente
          </button>
        </div>

        <div className="modal-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={editando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="botao-cadastrar"
            onClick={aoSalvar}
            disabled={editando}
          >
            {editando ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
