import type { ResultadoImportacao, Unidade } from "./model";
import { quantidadeResultado } from "./utils";

type Props = {
  sucesso: {
    resultado: ResultadoImportacao;
    unidade: Unidade;
  } | null;
  aoFechar: () => void;
};

export function ModalSucessoImportacao({ sucesso, aoFechar }: Props) {
  if (!sucesso) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-importacao-sucesso" role="dialog" aria-modal="true">
        <div className="importacao-sucesso-conteudo">
          <div className="importacao-sucesso-icone">✓</div>

          <span className="modal-eyebrow">IMPORTAÇÃO CONCLUÍDA</span>
          <h2>Alunos sincronizados com sucesso</h2>

          <p>
            A importação para a unidade <strong>{sucesso.unidade}</strong> foi
            concluída.
          </p>

          <div className="importacao-sucesso-resumo">
            <div>
              <strong>{quantidadeResultado(sucesso.resultado.importados)}</strong>
              <span>incluídos</span>
            </div>

            <div>
              <strong>{quantidadeResultado(sucesso.resultado.atualizados)}</strong>
              <span>atualizados</span>
            </div>

            <div>
              <strong>
                {quantidadeResultado(sucesso.resultado.sem_alteracoes)}
              </strong>
              <span>sem alterações</span>
            </div>
          </div>
        </div>

        <div className="modal-acoes importacao-sucesso-acoes">
          <button
            type="button"
            className="botao-cadastrar"
            onClick={aoFechar}
            autoFocus
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
