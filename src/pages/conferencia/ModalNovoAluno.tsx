import type { Dispatch, SetStateAction } from "react";
import { FormularioAluno } from "./FormularioAluno";
import type { FormAluno } from "./model";

type ModalNovoAlunoProps = {
  aberto: boolean;
  saindo: boolean;
  dados: FormAluno;
  setDados: Dispatch<SetStateAction<FormAluno>>;
  erro: string;
  cadastrando: boolean;
  aoFechar: () => void;
  aoCadastrar: () => void;
};

export function ModalNovoAluno({
  aberto,
  saindo,
  dados,
  setDados,
  erro,
  cadastrando,
  aoFechar,
  aoCadastrar,
}: ModalNovoAlunoProps) {
  if (!aberto) return null;

  return (
    <div className={`modal-overlay ${saindo ? "modal-overlay-exit" : ""}`}>
      <div className="modal-novo-aluno">
        <div className="modal-cabecalho">
          <div>
            <span className="modal-eyebrow">CADASTRO</span>
            <h2>Novo aluno</h2>
            <p>Adicione um aluno ao controle de documentos.</p>
          </div>
          <button
            type="button"
            className="modal-fechar"
            onClick={aoFechar}
            disabled={cadastrando}
          >
            ×
          </button>
        </div>

        <FormularioAluno dados={dados} setDados={setDados} mostrarDocumentos />
        {erro && <div className="modal-erro">{erro}</div>}

        <div className="modal-acoes">
          <button
            type="button"
            className="botao-cancelar"
            onClick={aoFechar}
            disabled={cadastrando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="botao-cadastrar"
            onClick={aoCadastrar}
            disabled={cadastrando}
          >
            {cadastrando ? "Cadastrando..." : "Cadastrar aluno"}
          </button>
        </div>
      </div>
    </div>
  );
}
