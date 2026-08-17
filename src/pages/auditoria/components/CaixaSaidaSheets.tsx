import type { ReactNode } from "react";

type PendenciaSheets = {
  id: number;
  ra: string;
  operacao: "ATUALIZAR" | "REMOVER";
  status: "PENDENTE" | "ENVIANDO" | "CONFLITO" | "ERRO";
  tentativas: number;
  ultimo_erro: string | null;
  motivos: string[];
  usuario_nome: string | null;
  usuario_username: string | null;
  atualizado_em: string;
  aluno: {
    nome: string;
    curso: string;
    unidade: string;
    status: string;
    documentos: Record<string, boolean>;
  } | null;
};

type CaixaSaida = {
  total: number;
  atualizar: number;
  remover: number;
  conflitos: number;
  erros: number;
  pendencias: PendenciaSheets[];
};

type Props = {
  admin: boolean;
  periodoDisponivel: boolean;
  caixaSaida: CaixaSaida | null;
  carregandoCaixa: boolean;
  enviandoCaixa: boolean;
  erroCaixa: string;
  resultadoEnvio: string;
  aoAtualizar: () => void | Promise<void>;
  aoAbrirEnvio: () => void;
  sidebarExtra?: ReactNode;
};

function formatarData(valor: string) {
  const normalizado = valor.includes("T")
    ? valor
    : `${valor.replace(" ", "T")}Z`;

  const data = new Date(normalizado);

  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

export function CaixaSaidaSheets({
  admin,
  periodoDisponivel,
  caixaSaida,
  carregandoCaixa,
  enviandoCaixa,
  erroCaixa,
  resultadoEnvio,
  aoAtualizar,
  aoAbrirEnvio,
  sidebarExtra,
}: Props) {
  const temAlteracoes = Boolean(caixaSaida?.total);

  return (
    <section className={`audit-changes-layout${temAlteracoes ? "" : " no-pending"}`}>
      {temAlteracoes && caixaSaida && (
        <div className="audit-pending">
          <div className="audit-pending-head">
            <div className="audit-pending-title">
              <strong>ALTERAÇÕES PENDENTES LOCAIS</strong>
              <span className="audit-pending-count" aria-label={`${caixaSaida.total} pendências`}>
                {caixaSaida.total}
              </span>
            </div>
          </div>

          <div className="audit-outbox-list">
            {caixaSaida.pendencias.map((item) => (
              <article key={item.id}>
                <span className={`audit-outbox-operation ${item.operacao.toLowerCase()}`}>{item.operacao}</span>
                <div>
                  <strong>{item.aluno?.nome || `RA ${item.ra}`}</strong>
                  <span>RA {item.ra} · {item.aluno?.unidade || "—"} · {item.aluno?.curso || "registro removido"}</span>
                  <span className="audit-outbox-reasons">{item.motivos.join(" + ")}</span>
                  {item.aluno && item.motivos.includes("DOCUMENTOS") && (
                    <span className="audit-outbox-documents">
                      {Object.entries(item.aluno.documentos).filter(([, entregue]) => entregue).map(([nome]) => nome.replace("_", " ").toLocaleUpperCase("pt-BR")).join(" · ") || "Nenhum documento marcado como entregue"}
                    </span>
                  )}
                </div>
                <div className="audit-outbox-author"><strong>{item.usuario_nome || "Sistema"}</strong><span>{formatarData(item.atualizado_em)}</span></div>
                <span className={`audit-outbox-state ${item.status.toLowerCase()}`}>{item.status}</span>
              </article>
            ))}
          </div>
        </div>
      )}

      <aside className="audit-integrity-actions" aria-label="Ações de integridade">
        {sidebarExtra}
        <button className="audit-integrity-action" type="button" onClick={() => void aoAtualizar()} disabled={carregandoCaixa || enviandoCaixa || !periodoDisponivel}>
          <span>
            <strong>{carregandoCaixa ? "Atualizando..." : "Atualizar prévia"}</strong>
            <small>Atualize a lista de alterações pendentes locais.</small>
          </span>
        </button>
        {admin && temAlteracoes && (
          <button type="button" className="audit-integrity-action audit-outbox-send" onClick={aoAbrirEnvio} disabled={carregandoCaixa || enviandoCaixa || !periodoDisponivel}>
            <span>
              <strong>Enviar à planilha</strong>
              <small>Envie as alterações pendentes locais para a planilha.</small>
            </span>
          </button>
        )}
        {erroCaixa ? <div className="audit-consistency-error">{erroCaixa}</div> : resultadoEnvio ? <div className="audit-outbox-success">{resultadoEnvio}</div> : null}
      </aside>
    </section>
  );

}
