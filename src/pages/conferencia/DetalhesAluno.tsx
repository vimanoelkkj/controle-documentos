import AppIcon from "../../components/AppIcon";
import type { RefObject } from "react";
import type { Aluno, Unidade } from "./model";

type StatusResumo = "COMPLETO" | "PARCIAL" | "CRITICO";

type Props = {
  detalhesAlunoRef: RefObject<HTMLElement | null>;
  temAlunoSelecionadoNoFiltro: boolean;
  alunoSelecionado: Aluno;
  iniciais: string;
  modoApresentacao: boolean;
  statusResumo: StatusResumo;
  percentual: number;
  entregues: Aluno["documentos"];
  pendentes: Aluno["documentos"];
  erroSalvamento: string;
  salvando: boolean;
  temAlteracoes: boolean;
  status: "salvo" | "pendente";
  unidadeSelecionada: Unidade | "";
  alunosFiltrados: Aluno[];
  abrirHistoricoAluno: (ra: string) => void;
  abrirEdicaoAluno: () => void;
  abrirModalStatusAluno: () => void;
  alternarDocumento: (nomeDocumento: string) => void;
  restaurarAlteracoes: () => void;
  salvarAlteracoes: () => Promise<void>;
};

export function DetalhesAluno({
  detalhesAlunoRef,
  temAlunoSelecionadoNoFiltro,
  alunoSelecionado,
  iniciais,
  modoApresentacao,
  statusResumo,
  percentual,
  entregues,
  pendentes,
  erroSalvamento,
  salvando,
  temAlteracoes,
  status,
  unidadeSelecionada,
  alunosFiltrados,
  abrirHistoricoAluno,
  abrirEdicaoAluno,
  abrirModalStatusAluno,
  alternarDocumento,
  restaurarAlteracoes,
  salvarAlteracoes,
}: Props) {
  return (
    <>
        {temAlunoSelecionadoNoFiltro ? (
          <article
            ref={detalhesAlunoRef}
            key={alunoSelecionado.ra}
            className="student-details student-details-animated"
          >
            <header className="student-details-header">
              <div className="student-avatar">{iniciais}</div>

              <div className="student-identity">
                <h2>{alunoSelecionado.nome}</h2>

                <div className="student-tags">
                  <span>RA {alunoSelecionado.ra}</span>
                  <span>{alunoSelecionado.unidade}</span>
                  <span>{alunoSelecionado.curso}</span>
                  <span
                    className={
                      alunoSelecionado.status === "CANCELADO"
                        ? "student-tag-cancelled"
                        : "student-tag-active"
                    }
                  >
                    {alunoSelecionado.status}
                  </span>
                </div>
              </div>

              <div className="student-header-actions">
                <button
                  type="button"
                  className="student-history-button"
                  onClick={() => abrirHistoricoAluno(alunoSelecionado.ra)}
                >
                  Histórico
                </button>

                {!modoApresentacao && (
                  <>
                    <button
                      type="button"
                      className="student-edit-button"
                      onClick={abrirEdicaoAluno}
                    >
                      Editar aluno
                    </button>

                    <button
                      type="button"
                      className={
                        alunoSelecionado.status === "ATIVO"
                          ? "student-delete-button"
                          : "student-edit-button"
                      }
                      onClick={abrirModalStatusAluno}
                    >
                      {alunoSelecionado.status === "ATIVO"
                        ? "Cancelar matrícula"
                        : "Reativar matrícula"}
                    </button>
                  </>
                )}
              </div>

              <div className="student-progress">
                <strong
                  className={`student-progress-percent student-progress-percent--${statusResumo.toLowerCase()}`}
                >
                  {percentual}%
                </strong>

                <span
                  className={`student-progress-status student-progress-status--${statusResumo.toLowerCase()}`}
                >
                  {statusResumo === "COMPLETO"
                    ? "COMPLETO"
                    : statusResumo === "PARCIAL"
                      ? "PARCIAL"
                      : "CRÍTICO"}
                </span>
              </div>
            </header>

            <div className="document-progress">
              <div className="document-progress-label">
                <span>Progresso documental</span>

                <span>
                  {entregues.length}/{alunoSelecionado.documentos.length}{" "}
                  documentos
                </span>
              </div>

              <div className="progress-track">
                <div
                  className="progress-value"
                  style={{ width: `${percentual}%` }}
                />
              </div>
            </div>

            <div className="documents-area">
              <div>
                <h3>Documentos</h3>

                <div className="documents-grid">
                  {alunoSelecionado.documentos.map((documento) => (
                    <label
                      key={documento.nome}
                      className={`document-card ${
                        documento.entregue ? "delivered" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={documento.entregue}
                        disabled={modoApresentacao}
                        onChange={() => alternarDocumento(documento.nome)}
                      />

                      <div>
                        <strong>{documento.nome}</strong>

                        <span>
                          {documento.entregue
                            ? "Documento entregue"
                            : "Documento pendente"}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <aside
                className={`summary-card summary-card--${statusResumo.toLowerCase()}`}
              >
                <span>RESUMO</span>

                {statusResumo === "COMPLETO" ? (
                  <div className="summary-complete">
                    <strong className="summary-check">✓</strong>
                    <span>Documentação Entregue</span>
                  </div>
                ) : (
                  <>
                    <div className="summary-number">
                      <strong>{pendentes.length}</strong>
                      <span>
                        {statusResumo === "PARCIAL"
                          ? "Pendências restantes"
                          : "Pendências críticas"}
                      </span>
                    </div>

                    <ul>
                      {pendentes.map((documento) => (
                        <li key={documento.nome}>{documento.nome}</li>
                      ))}
                    </ul>
                  </>
                )}
              </aside>
            </div>

            {!modoApresentacao && (
              <footer
                className={`conference-actions ${
                  erroSalvamento ? "conference-actions-error" : ""
                }`}
                style={
                  erroSalvamento
                    ? {
                        background: "rgba(220, 53, 69, 0.10)",
                        borderTopColor: "rgba(220, 53, 69, 0.45)",
                        boxShadow: "inset 4px 0 0 #dc3545",
                      }
                    : undefined
                }
              >
                <span
                  className={
                    erroSalvamento
                      ? "save-feedback error"
                      : salvando
                        ? "save-feedback saving"
                        : temAlteracoes
                          ? "pending"
                          : "saved"
                  }
                  role="status"
                  aria-live="polite"
                >
                  {erroSalvamento
                    ? `✕ ${erroSalvamento}`
                    : salvando
                      ? "↻ Salvando alterações..."
                      : temAlteracoes
                        ? "● Alterações pendentes"
                        : status === "salvo"
                          ? "✓ Alterações salvas"
                          : "Nenhuma alteração"}
                </span>

                <div>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!temAlteracoes || salvando}
                    onClick={restaurarAlteracoes}
                  >
                    Restaurar
                  </button>

                  <button
                    type="button"
                    className="primary-action"
                    disabled={!temAlteracoes || salvando}
                    onClick={salvarAlteracoes}
                  >
                    {salvando ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </footer>
            )}
          </article>
        ) : (
          <article
            ref={detalhesAlunoRef}
            className="student-details student-details-empty"
          >
            <div>
              <span className="empty-state-icon">
                <AppIcon name="info" size={24} />
              </span>
              <h2>Selecione um aluno</h2>
              <p>
                {!unidadeSelecionada
                  ? "Para começar, selecione uma unidade e em seguida selecione um aluno. Ele aparecerá aqui."
                  : alunosFiltrados.length > 0
                    ? "Agora selecione um aluno da lista para visualizar e conferir os documentos."
                    : "Não há alunos nesta unidade para o filtro selecionado."}
              </p>
            </div>
          </article>
        )}
    </>
  );
}
