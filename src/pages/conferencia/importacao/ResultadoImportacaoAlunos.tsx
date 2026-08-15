import type { ResultadoImportacao } from "../model";
import { quantidadeResultado } from "../utils";

type Props = {
  resultado: ResultadoImportacao;
};

export function ResultadoImportacaoAlunos({ resultado }: Props) {
  return (
    <div className="importacao-resultado">
      <div className="importacao-resultado-ok">✓</div>

      <h3>Importação concluída</h3>

      <p>O servidor terminou de processar o lote.</p>

      <div className="importacao-resumo resultado">
        <div>
          <strong>{quantidadeResultado(resultado.encontrados)}</strong>
          <span>Processados</span>
        </div>

        <div>
          <strong>{quantidadeResultado(resultado.importados)}</strong>
          <span>Novos</span>
        </div>

        <div>
          <strong>{quantidadeResultado(resultado.atualizados)}</strong>
          <span>Atualizados</span>
        </div>

        <div>
          <strong>{quantidadeResultado(resultado.sem_alteracoes)}</strong>
          <span>Sem alterações</span>
        </div>

        <div>
          <strong>{quantidadeResultado(resultado.invalidos)}</strong>
          <span>Inválidos</span>
        </div>
      </div>
    </div>
  );
}
