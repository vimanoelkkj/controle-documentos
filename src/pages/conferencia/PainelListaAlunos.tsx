import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { Aluno, FiltroStatus, Unidade } from "./model";

type Props = {
  painelListaRef: RefObject<HTMLElement | null>;
  buscaAlunoRef: RefObject<HTMLInputElement | null>;
  listaAlunosRef: RefObject<HTMLDivElement | null>;
  modoApresentacao: boolean;
  raSelecionado: string;
  busca: string;
  filtroStatus: FiltroStatus;
  unidadeSelecionada: Unidade | "";
  alunosNoStatus: Aluno[];
  alunosFiltrados: Aluno[];
  quantidadesPorUnidade: Record<Unidade, number>;
  temFiltroDashboard: boolean;
  descricaoFiltroDashboard: string;
  carregarAlunos: (ra?: string) => Promise<void>;
  abrirImportacaoCancelados: () => void;
  setModalAdicionarAluno: Dispatch<SetStateAction<boolean>>;
  setFiltroStatus: Dispatch<SetStateAction<FiltroStatus>>;
  setRaSelecionado: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<"salvo" | "pendente">>;
  setUnidadeSelecionada: Dispatch<SetStateAction<Unidade | "">>;
  setBusca: Dispatch<SetStateAction<string>>;
  limparFiltroDashboard: () => void;
  selecionarAluno: (ra: string) => void;
};

export function PainelListaAlunos({
  painelListaRef,
  buscaAlunoRef,
  listaAlunosRef,
  modoApresentacao,
  raSelecionado,
  busca,
  filtroStatus,
  unidadeSelecionada,
  alunosNoStatus,
  alunosFiltrados,
  quantidadesPorUnidade,
  temFiltroDashboard,
  descricaoFiltroDashboard,
  carregarAlunos,
  abrirImportacaoCancelados,
  setModalAdicionarAluno,
  setFiltroStatus,
  setRaSelecionado,
  setStatus,
  setUnidadeSelecionada,
  setBusca,
  limparFiltroDashboard,
  selecionarAluno,
}: Props) {
  return (
        <aside ref={painelListaRef} className="student-panel">
          <div className="student-panel-header">
            <div>
              <span>ALUNOS POR UNIDADE</span>
              <div className="student-panel-title-row">
                <h2>Lista de conferência</h2>
                <button
                  type="button"
                  className="botao-atualizar-alunos"
                  onClick={() => carregarAlunos(raSelecionado)}
                >
                  ↻ Atualizar
                </button>
              </div>
            </div>

            {!modoApresentacao && (
              <div className="student-panel-actions">
                <button
                  type="button"
                  className="botao-importar-cancelados"
                  onClick={abrirImportacaoCancelados}
                  title="Importar lista de cancelados"
                >
                  ⊘ Cancelados
                </button>

                <button
                  type="button"
                  className="botao-novo-aluno"
                  onClick={() => setModalAdicionarAluno(true)}
                >
                  + Adicionar alunos
                </button>
              </div>
            )}
          </div>

          <div className="status-tabs">
            {(["ATIVO", "CANCELADO", "TODOS"] as FiltroStatus[]).map(
              (filtro) => (
                <button
                  key={filtro}
                  type="button"
                  className={filtroStatus === filtro ? "active" : ""}
                  onClick={() => {
                    setFiltroStatus(filtro);
                    setRaSelecionado("");
                    setStatus("salvo");
                  }}
                >
                  {filtro === "ATIVO"
                    ? "Ativos"
                    : filtro === "CANCELADO"
                      ? "Cancelados"
                      : "Todos"}
                </button>
              ),
            )}
          </div>

          <div className="unit-tabs">
            <button
              type="button"
              className={`unit-tab-all ${unidadeSelecionada === "" ? "active" : ""}`}
              onClick={() => {
                setUnidadeSelecionada("");
                setBusca("");
                setRaSelecionado("");
                setStatus("salvo");
              }}
            >
              Todas as Unidades
              <strong>{alunosNoStatus.length}</strong>
            </button>

            {(["EAD", "FACE", "FCH", "FEA"] as Unidade[]).map((unidade) => (
              <button
                key={unidade}
                type="button"
                className={unidadeSelecionada === unidade ? "active" : ""}
                onClick={() => {
                  setUnidadeSelecionada(unidade);
                  setBusca("");
                  setRaSelecionado("");
                  setStatus("salvo");
                }}
              >
                {unidade}
                <strong>{quantidadesPorUnidade[unidade]}</strong>
              </button>
            ))}
          </div>

          {temFiltroDashboard && (
            <div className="dashboard-context-filter">
              <div>
                <span>DASHBOARD</span>
                <strong>{descricaoFiltroDashboard}</strong>
                <small>
                  {unidadeSelecionada || "Todas as unidades"} ·{" "}
                  {alunosFiltrados.length} aluno(s)
                </small>
              </div>
              <button type="button" onClick={limparFiltroDashboard}>
                × Limpar
              </button>
            </div>
          )}

          <input
            ref={buscaAlunoRef}
            className="student-search"
            type="search"
            placeholder="Pesquisar nome, RA, curso ou e-mail..."
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />

          {busca.trim() && (
            <div className="student-search-result">
              <strong>{alunosFiltrados.length}</strong>
              <span>
                {alunosFiltrados.length === 1
                  ? "aluno encontrado"
                  : "alunos encontrados"}
              </span>
              <button type="button" onClick={() => setBusca("")}>
                × Limpar busca
              </button>
            </div>
          )}

          <div ref={listaAlunosRef} className="student-list">
            {alunosFiltrados.map((aluno) => {
              const entreguesAluno = aluno.documentos.filter(
                (documento) => documento.entregue,
              ).length;

              return (
                <button
                  key={aluno.ra}
                  type="button"
                  data-ra={aluno.ra}
                  className={`student-card ${
                    aluno.ra === raSelecionado ? "active" : ""
                  } ${aluno.status === "CANCELADO" ? "cancelled" : ""}`}
                  onClick={() => selecionarAluno(aluno.ra)}
                >
                  <div className="student-card-main">
                    <strong>{aluno.nome}</strong>

                    <span>
                      RA {aluno.ra} · {aluno.curso}
                    </span>
                  </div>

                  <div className="student-card-footer">
                    <span>{aluno.unidade}</span>

                    {aluno.status === "CANCELADO" && (
                      <span className="student-status-cancelled">
                        CANCELADO
                      </span>
                    )}

                    <strong>
                      {entreguesAluno}/{aluno.documentos.length}
                    </strong>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>


  );
}
