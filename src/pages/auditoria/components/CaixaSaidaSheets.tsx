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
  periodoCodigo?: string | null;
  periodoDisponivel: boolean;
  caixaSaida: CaixaSaida | null;
  carregandoCaixa: boolean;
  enviandoCaixa: boolean;
  erroCaixa: string;
  resultadoEnvio: string;
  aoAtualizar: () => void | Promise<void>;
  aoAbrirEnvio: () => void;
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
  periodoCodigo,
  periodoDisponivel,
  caixaSaida,
  carregandoCaixa,
  enviandoCaixa,
  erroCaixa,
  resultadoEnvio,
  aoAtualizar,
  aoAbrirEnvio,
}: Props) {
  return (
    <section className="audit-outbox">
      <div className="audit-outbox-head">
        <div>
          <span>SISTEMA → PLANILHA</span>
          <strong>Caixa de saída · {periodoCodigo || "—"}</strong>
          <p>
            Prévia das alterações locais aguardando envio. A planilha não será
            modificada.
          </p>
        </div>

        <div className="audit-outbox-actions">
          <button
            type="button"
            onClick={() => void aoAtualizar()}
            disabled={carregandoCaixa || enviandoCaixa || !periodoDisponivel}
          >
            {carregandoCaixa ? "Atualizando..." : "Atualizar prévia"}
          </button>

          {admin && Boolean(caixaSaida?.total) && (
            <button
              type="button"
              className="audit-outbox-send"
              onClick={aoAbrirEnvio}
              disabled={carregandoCaixa || enviandoCaixa || !periodoDisponivel}
            >
              Enviar à planilha
            </button>
          )}
        </div>
      </div>

      {erroCaixa ? (
        <div className="audit-consistency-error">{erroCaixa}</div>
      ) : resultadoEnvio ? (
        <div className="audit-outbox-success">{resultadoEnvio}</div>
      ) : (
        caixaSaida && (
          <>
            <div className="audit-outbox-summary">
              <article>
                <span>Pendências</span>
                <strong>{caixaSaida.total}</strong>
              </article>

              <article>
                <span>A atualizar</span>
                <strong>{caixaSaida.atualizar}</strong>
              </article>

              <article>
                <span>A remover</span>
                <strong>{caixaSaida.remover}</strong>
              </article>

              <article className={caixaSaida.conflitos ? "danger" : ""}>
                <span>Conflitos</span>
                <strong>{caixaSaida.conflitos}</strong>
              </article>

              <article className={caixaSaida.erros ? "danger" : ""}>
                <span>Erros</span>
                <strong>{caixaSaida.erros}</strong>
              </article>
            </div>

            {caixaSaida.pendencias.length === 0 ? (
              <div className="audit-outbox-empty">
                ✓ Nenhuma alteração local aguardando envio.
              </div>
            ) : (
              <div className="audit-outbox-list">
                {caixaSaida.pendencias.map((item) => (
                  <article key={item.id}>
                    <span
                      className={`audit-outbox-operation ${item.operacao.toLowerCase()}`}
                    >
                      {item.operacao}
                    </span>

                    <div>
                      <strong>{item.aluno?.nome || `RA ${item.ra}`}</strong>

                      <span>
                        RA {item.ra} · {item.aluno?.unidade || "—"} ·{" "}
                        {item.aluno?.curso || "registro removido"}
                      </span>

                      <span className="audit-outbox-reasons">
                        {item.motivos.join(" + ")}
                      </span>

                      {item.aluno && item.motivos.includes("DOCUMENTOS") && (
                        <span className="audit-outbox-documents">
                          {Object.entries(item.aluno.documentos)
                            .filter(([, entregue]) => entregue)
                            .map(([nome]) =>
                              nome.replace("_", " ").toLocaleUpperCase("pt-BR"),
                            )
                            .join(" · ") ||
                            "Nenhum documento marcado como entregue"}
                        </span>
                      )}
                    </div>

                    <div>
                      <strong>{item.usuario_nome || "Sistema"}</strong>
                      <span>{formatarData(item.atualizado_em)}</span>
                    </div>

                    <span
                      className={`audit-outbox-state ${item.status.toLowerCase()}`}
                    >
                      {item.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
