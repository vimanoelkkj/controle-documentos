import { useEffect, useMemo, useRef, useState } from "react";
import AppSelect from "../../../components/AppSelect";

type RegistroAuditoria = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_username: string | null;
  periodo_codigo?: string | null;
};

type Props = {
  registros: RegistroAuditoria[];
  filtrados: RegistroAuditoria[];
  usuarios: number;
  semAutoria: number;
  busca: string;
  setBusca: (valor: string) => void;
  acao: string;
  setAcao: (valor: string) => void;
  acoes: string[];
  carregando: boolean;
  erro: string;
};


function FiltroAcoes({
  valor,
  onChange,
  acoes,
  registros,
}: {
  valor: string;
  onChange: (valor: string) => void;
  acoes: string[];
  registros: RegistroAuditoria[];
}) {
  const [aberto, setAberto] = useState(false);
  const [fechando, setFechando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const contagens = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const registro of registros) {
      mapa.set(registro.acao, (mapa.get(registro.acao) ?? 0) + 1);
    }
    return mapa;
  }, [registros]);

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFechando(true);
        window.setTimeout(() => {
          setAberto(false);
          setFechando(false);
        }, 120);
      }
    };

    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const fechar = () => {
    if (!aberto || fechando) return;
    setFechando(true);
    closeTimerRef.current = window.setTimeout(() => {
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const selecionar = (proximo: string) => {
    if (fechando) return;
    setFechando(true);
    closeTimerRef.current = window.setTimeout(() => {
      onChange(proximo);
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const rotuloAtual = valor === "TODAS" ? "Todas as ações" : valor;

  return (
    <div
      ref={containerRef}
      className={`conference-replica-unit-filter audit-action-filter ${aberto ? "is-open" : ""} ${fechando ? "is-closing" : ""}`}
    >
      <button
        type="button"
        className="conference-replica-unit-trigger"
        onClick={() => {
          if (aberto) fechar();
          else {
            setFechando(false);
            setAberto(true);
          }
        }}
        aria-expanded={aberto}
        aria-controls="audit-action-disclosure"
      >
        <span>{aberto ? "Filtrar por ação" : rotuloAtual}</span>
        <span
          className="conference-replica-chevron conference-unit-chevron"
          aria-hidden="true"
        />
      </button>

      <div
        id="audit-action-disclosure"
        className="conference-replica-unit-menu conference-unit-disclosure audit-action-disclosure"
        role="listbox"
        aria-hidden={!aberto}
      >
        <div className="conference-unit-disclosure-inner">
          <button
            type="button"
            role="option"
            tabIndex={aberto ? 0 : -1}
            aria-selected={valor === "TODAS"}
            className={valor === "TODAS" ? "active" : ""}
            onClick={() => selecionar("TODAS")}
          >
            <span className="conference-replica-unit-option-copy">
              <i className="conference-replica-unit-radio" aria-hidden="true" />
              <span>Todas as ações</span>
            </span>
            <strong>{registros.length}</strong>
          </button>

          {acoes.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              tabIndex={aberto ? 0 : -1}
              aria-selected={valor === item}
              className={valor === item ? "active" : ""}
              onClick={() => selecionar(item)}
            >
              <span className="conference-replica-unit-option-copy">
                <i className="conference-replica-unit-radio" aria-hidden="true" />
                <span>{item}</span>
              </span>
              <strong>{contagens.get(item) ?? 0}</strong>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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

export function ListaAuditoria({
  registros,
  filtrados,
  usuarios,
  semAutoria,
  busca,
  setBusca,
  acao,
  setAcao,
  acoes,
  carregando,
  erro,
}: Props) {
  void carregando;
  void usuarios;
  void semAutoria;
  const [porPagina, setPorPagina] = useState(10);
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));

  useEffect(() => { setPagina(1); }, [busca, acao, porPagina]);
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);

  const paginaAtual = Math.min(pagina, totalPaginas);
  const registrosPagina = filtrados.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);
  const paginasVisiveis = Array.from({ length: totalPaginas }, (_, i) => i + 1).filter((n) =>
    n === 1 || n === totalPaginas || Math.abs(n - paginaAtual) <= 1
  );

  return (
    <section className="audit-history">
      <h2 className="audit-history-title">Histórico de auditoria</h2>

      <div className="audit-history-count">
        {registros.length.toLocaleString("pt-BR")} {registros.length === 1 ? "evento encontrado" : "eventos encontrados"}
      </div>

      <div className="audit-toolbar">
        <input
          type="search"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Buscar usuário, ação, RA ou unidade..."
        />

        <FiltroAcoes
          valor={acao}
          onChange={setAcao}
          acoes={acoes}
          registros={registros}
        />

        <span>{filtrados.length} resultado(s)</span>
      </div>

      {erro ? (
        <div className="log-state error">{erro}</div>
      ) : filtrados.length === 0 ? (
        <div className="log-state">Nenhum evento encontrado.</div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Responsável</th>
                <th>Período</th>
                <th>Ação</th>
                <th>Registro</th>
                <th>Descrição</th>
              </tr>
            </thead>

            <tbody>
              {registrosPagina.map((registro) => (
                <tr key={registro.id}>
                  <td>
                    <time>{formatarData(registro.criado_em)}</time>
                  </td>

                  <td>
                    <strong>{registro.usuario_nome || "Sistema/legado"}</strong>

                    {registro.usuario_username && (
                      <small>@{registro.usuario_username}</small>
                    )}
                  </td>

                  <td>
                    <span className="audit-period">
                      {registro.periodo_codigo || "Global"}
                    </span>
                  </td>

                  <td>
                    <span className="audit-action">{registro.acao}</span>
                  </td>

                  <td>
                    <strong>
                      {registro.ra ? `RA ${registro.ra}` : registro.entidade}
                    </strong>

                    {registro.unidade && <small>{registro.unidade}</small>}
                  </td>

                  <td>{registro.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPaginas > 1 && (
            <nav className="audit-pagination" aria-label="Paginação do histórico">
              <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}>‹ <span>Anterior</span></button>
              <div className="audit-pagination-pages">
                {paginasVisiveis.map((n, i) => {
                  const anterior = paginasVisiveis[i - 1];
                  return (
                    <span key={n} className="audit-pagination-slot">
                      {anterior && n - anterior > 1 && <i>…</i>}
                      <button type="button" className={n === paginaAtual ? "active" : ""} onClick={() => setPagina(n)}>{n}</button>
                    </span>
                  );
                })}
              </div>
              <button type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}><span>Próxima</span> ›</button>
              <div className="audit-pagination-meta">
                <label>
                  <AppSelect
                    value={String(porPagina)}
                    onChange={(valor) => setPorPagina(Number(valor))}
                    ariaLabel="Registros por página"
                    className="audit-page-size-select"
                    menuClassName="audit-page-size-menu"
                    options={[
                      { value: "10", label: "10 por página" },
                      { value: "25", label: "25 por página" },
                      { value: "50", label: "50 por página" },
                    ]}
                  />
                </label>
                <span className="audit-pagination-count">Página {paginaAtual} de {totalPaginas}</span>
              </div>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
