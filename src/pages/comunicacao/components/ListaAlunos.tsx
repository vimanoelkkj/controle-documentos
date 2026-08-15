import type { AlunoApi, Grupo } from "../model";
import { normalizarEmail } from "../utils";

type CobrancaPorRa = Map<
  string,
  {
    quantidade: number;
    ultima: string;
  }
>;

type Props = {
  grupo: Grupo;
  modoApresentacao: boolean;
  alturaMaximaAlunos: number | null;
  buscaAluno: string;
  setBuscaAluno: (valor: string) => void;
  selecionados: Set<string>;
  setSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
  alunosNaoCobrados: AlunoApi[];
  alunosVisiveis: AlunoApi[];
  cobrancasPorRa: CobrancaPorRa;
  alternarAluno: (ra: string) => void;
};

export function ListaAlunos({
  grupo,
  modoApresentacao,
  alturaMaximaAlunos,
  buscaAluno,
  setBuscaAluno,
  selecionados,
  setSelecionados,
  alunosNaoCobrados,
  alunosVisiveis,
  cobrancasPorRa,
  alternarAluno,
}: Props) {
  return (
    <section
      className="communication-students-card"
      style={
        alturaMaximaAlunos
          ? { maxHeight: `${alturaMaximaAlunos}px` }
          : undefined
      }
    >
      <div className="communication-students-header">
        <div>
          <span>ALUNOS DO GRUPO</span>
          <strong>
            {modoApresentacao
              ? `${grupo.alunos.length} aluno(s)`
              : `${selecionados.size}/${grupo.alunos.length} selecionados`}
          </strong>
        </div>

        <input
          type="search"
          value={buscaAluno}
          onChange={(e) => setBuscaAluno(e.target.value)}
          placeholder={
            modoApresentacao ? "Nome, RA ou curso" : "Nome, RA, curso ou e-mail"
          }
        />
      </div>

      {!modoApresentacao && (
        <div className="communication-select-actions">
          <button
            type="button"
            onClick={() =>
              setSelecionados(new Set(grupo.alunos.map((aluno) => aluno.ra)))
            }
          >
            Selecionar todos
          </button>

          <button
            type="button"
            onClick={() =>
              setSelecionados(
                new Set(alunosNaoCobrados.map((aluno) => aluno.ra)),
              )
            }
            disabled={alunosNaoCobrados.length === 0}
          >
            Selecionar não cobrados
          </button>

          <button type="button" onClick={() => setSelecionados(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}

      <div className="communication-student-list">
        {alunosVisiveis.map((aluno) => (
          <label key={aluno.ra} className="communication-student">
            {!modoApresentacao && (
              <input
                type="checkbox"
                checked={selecionados.has(aluno.ra)}
                onChange={() => alternarAluno(aluno.ra)}
              />
            )}

            <div>
              <strong>{aluno.nome}</strong>

              <span>
                RA {aluno.ra} • {aluno.curso} • {aluno.unidade}
              </span>

              {!modoApresentacao && (
                <small>
                  {normalizarEmail(aluno.email) || "Sem e-mail institucional"}
                  {" • "}
                  {normalizarEmail(aluno.email_outro) ||
                    "Sem e-mail alternativo"}
                </small>
              )}

              {!modoApresentacao && cobrancasPorRa.has(aluno.ra) && (
                <span className="communication-charged-badge">
                  ✓ Cobrado em{" "}
                  {new Date(
                    cobrancasPorRa.get(aluno.ra)!.ultima,
                  ).toLocaleDateString("pt-BR")}{" "}
                  • {cobrancasPorRa.get(aluno.ra)!.quantidade}x
                </span>
              )}
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
