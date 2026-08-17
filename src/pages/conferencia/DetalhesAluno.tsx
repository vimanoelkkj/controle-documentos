import AppIcon from "../../components/AppIcon";
import type { RefObject } from "react";
import type { Aluno, Unidade } from "./model";

type StatusResumo = "COMPLETO" | "PARCIAL" | "CRITICO";

function iconeDocumento(nome: string) {
  const normalizado = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalizado.includes("cpf")) return "cpf" as const;
  if (normalizado.includes("ident") || normalizado.includes("rg")) return "identity" as const;
  if (normalizado.includes("certidao")) return "certificate" as const;
  if (normalizado.includes("resid")) return "residence" as const;
  if (normalizado.includes("titulo")) return "voter" as const;
  if (normalizado.includes("ensino") || normalizado.includes("historico")) return "education" as const;
  if (normalizado.includes("contrato")) return "contract" as const;
  return "document" as const;
}

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
  const statusLabel =
    statusResumo === "COMPLETO" ? "Completo" : statusResumo === "PARCIAL" ? "Parcial" : "Crítico";

  return temAlunoSelecionadoNoFiltro ? (
    <article
      ref={detalhesAlunoRef}
      key={alunoSelecionado.ra}
      className="student-details conference-replica-details"
    >
      <div className="conference-replica-profile">
        <div className="conference-replica-avatar">{iniciais}</div>

        <div className="conference-replica-profile-copy">
          <h2>{alunoSelecionado.nome}</h2>
          <p>RA {alunoSelecionado.ra} &nbsp;•&nbsp; {alunoSelecionado.unidade}</p>
          <span>{alunoSelecionado.curso}</span>
        </div>

        <div className={`conference-replica-status conference-replica-status--${statusResumo.toLowerCase()}`}>
          <span key={statusResumo} className="conference-replica-status-value">{statusLabel}</span>
        </div>
      </div>

      <div className="conference-replica-actions">
        <button type="button" onClick={() => abrirHistoricoAluno(alunoSelecionado.ra)}>
          <AppIcon name="clock" size={18} strokeWidth={1.7} />
          Histórico
        </button>
        {!modoApresentacao && (
          <>
            <span className="conference-replica-action-divider" aria-hidden="true" />
            <button type="button" onClick={abrirEdicaoAluno}>
              <AppIcon name="edit" size={18} strokeWidth={1.7} />
              Editar aluno
            </button>
            <span className="conference-replica-action-divider" aria-hidden="true" />
            <button type="button" className="danger" onClick={abrirModalStatusAluno}>
              <AppIcon name={alunoSelecionado.status === "ATIVO" ? "close" : "reload"} size={18} strokeWidth={1.7} />
              {alunoSelecionado.status === "ATIVO" ? "Cancelar matrícula" : "Reativar matrícula"}
            </button>
          </>
        )}
      </div>

      <div className="conference-replica-details-scroll">
        <section className="conference-replica-progress-section">
          <div className="conference-replica-section-row">
            <span>Progresso documental</span>
            <strong key={entregues.length} className="conference-replica-progress-count">{entregues.length}/{alunoSelecionado.documentos.length}</strong>
          </div>
          <div className="conference-replica-progress-track" aria-label={`${percentual}% concluído`}>
            <span style={{ width: `${percentual}%` }} />
          </div>
        </section>

        <section className="conference-replica-documents-section">
          <h3>Documentos</h3>
          <div className="conference-replica-documents-grid">
            {alunoSelecionado.documentos.map((documento) => (
              <label
                key={documento.nome}
                className={`conference-replica-document ${documento.entregue ? "delivered" : "pending"}`}
              >
                <input
                  type="checkbox"
                  checked={documento.entregue}
                  disabled={modoApresentacao}
                  onChange={() => alternarDocumento(documento.nome)}
                />
                <span className="conference-replica-document-icon" aria-hidden="true">
                  <AppIcon name={iconeDocumento(documento.nome)} size={18} strokeWidth={1.5} />
                </span>
                <strong>{documento.nome}</strong>
                <span className="conference-replica-document-state">
                  {documento.entregue ? "Entregue" : "Pendente"}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="conference-replica-summary">
          <h3>Resumo</h3>
          <div className={`conference-replica-summary-badge ${pendentes.length === 0 ? "complete" : "critical"}`}>
            {pendentes.length === 0
              ? "Documentação completa"
              : `${pendentes.length} pendência${pendentes.length === 1 ? "" : "s"}`}
          </div>
          {pendentes.length > 0 && (
            <p>{pendentes.map((documento) => documento.nome).join(" • ")}</p>
          )}
        </section>
      </div>

      {!modoApresentacao && (
        <footer className={`conference-replica-savebar ${erroSalvamento ? "has-error" : ""}`}>
          <span className={erroSalvamento ? "error" : temAlteracoes ? "pending" : "saved"} role="status" aria-live="polite">
            <i aria-hidden="true"><AppIcon name="check" size={15} strokeWidth={1.7} /></i>
            {erroSalvamento
              ? erroSalvamento
              : salvando
                ? "Salvando alterações..."
                : temAlteracoes
                  ? "Alterações pendentes"
                  : status === "salvo"
                    ? "Nenhuma alteração"
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
    <article ref={detalhesAlunoRef} className="student-details conference-replica-details conference-replica-empty">
      <div>
        <span><AppIcon name="info" size={25} /></span>
        <h2>Selecione um aluno</h2>
        <p>
          {!unidadeSelecionada
            ? "Selecione uma unidade e um aluno para visualizar os dados e conferir os documentos."
            : alunosFiltrados.length > 0
              ? "Selecione um aluno da lista para abrir a ficha de conferência."
              : "Nenhum aluno encontrado com os filtros atuais."}
        </p>
      </div>
    </article>
  );
}
