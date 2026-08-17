import {
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  type Aluno,
  type FiltroStatus,
  type Unidade,
} from "./model";
import AppIcon from "../../components/AppIcon";

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


type ConferenceUnitFilterProps = {
  unidadeSelecionada: Unidade | "";
  alunosNoStatus: Aluno[];
  quantidadesPorUnidade: Record<Unidade, number>;
  onSelect: (unidade: Unidade | "") => void;
};

function ConferenceUnitFilter({
  unidadeSelecionada,
  alunosNoStatus,
  quantidadesPorUnidade,
  onSelect,
}: ConferenceUnitFilterProps) {
  const [aberto, setAberto] = useState(false);
  const [fechando, setFechando] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const fechar = () => {
    if (!aberto || fechando) return;

    setFechando(true);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const selecionar = (unidade: Unidade | "") => {
    if (!aberto || fechando) return;

    setFechando(true);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      onSelect(unidade);
      setAberto(false);
      setFechando(false);
      closeTimerRef.current = null;
    }, 120);
  };

  return (
    <div
      ref={containerRef}
      className={`conference-replica-unit-filter ${
        aberto ? "is-open" : ""
      } ${fechando ? "is-closing" : ""}`}
    >
      <button
        type="button"
        className="conference-replica-unit-trigger"
        onClick={() => {
          if (aberto) {
            fechar();
          } else {
            setFechando(false);
            setAberto(true);
          }
        }}
        aria-expanded={aberto}
        aria-controls="conference-unit-disclosure"
      >
        <span>
          {aberto
            ? "Filtrar por unidade"
            : unidadeSelecionada || "Todas as unidades"}
        </span>
        <span
          className="conference-replica-chevron conference-unit-chevron"
          aria-hidden="true"
        />
      </button>

      <div
        id="conference-unit-disclosure"
        className="conference-replica-unit-menu conference-unit-disclosure"
        role="listbox"
        aria-hidden={!aberto}
      >
        <div className="conference-unit-disclosure-inner">
          <button
            type="button"
            role="option"
            tabIndex={aberto ? 0 : -1}
            aria-selected={unidadeSelecionada === ""}
            className={unidadeSelecionada === "" ? "active" : ""}
            onClick={() => selecionar("")}
          >
            <span className="conference-replica-unit-option-copy">
              <i className="conference-replica-unit-radio" aria-hidden="true" />
              <span>Todas as unidades</span>
            </span>
            <strong>{alunosNoStatus.length}</strong>
          </button>

          {(["EAD", "FACE", "FCH", "FEA"] as Unidade[]).map((unidade) => (
            <button
              key={unidade}
              type="button"
              role="option"
              tabIndex={aberto ? 0 : -1}
              aria-selected={unidadeSelecionada === unidade}
              className={unidadeSelecionada === unidade ? "active" : ""}
              onClick={() => selecionar(unidade)}
            >
              <span className="conference-replica-unit-option-copy">
                <i className="conference-replica-unit-radio" aria-hidden="true" />
                <span>{unidade}</span>
              </span>
              <strong>{quantidadesPorUnidade[unidade]}</strong>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const [filtroStatusVisual, setFiltroStatusVisual] = useState<FiltroStatus>(filtroStatus);
  const selecionarAlunoRef = useRef(selecionarAluno);
  selecionarAlunoRef.current = selecionarAluno;

  const listaAlunosRenderizada = useMemo(
    () =>
      alunosFiltrados.map((aluno) => {
        const entreguesAluno = aluno.documentos.filter((documento) => documento.entregue).length;
        const total = aluno.documentos.length;
        const scoreClass = entreguesAluno === total ? "complete" : entreguesAluno === 0 ? "critical" : "partial";

        return (
          <button
            key={aluno.ra}
            type="button"
            data-ra={aluno.ra}
            className={`conference-replica-student ${aluno.ra === raSelecionado ? "active" : ""}`}
            onClick={() => selecionarAlunoRef.current(aluno.ra)}
          >
            <span className="conference-replica-student-copy">
              <strong>{aluno.nome}</strong>
              <small>RA {aluno.ra} &nbsp;•&nbsp; {aluno.unidade}</small>
              <span>{aluno.curso}</span>
            </span>
            <b className={`conference-replica-score conference-replica-score--${scoreClass}`}>
              {entreguesAluno}/{total}
            </b>
          </button>
        );
      }),
    [alunosFiltrados, raSelecionado],
  );

  useEffect(() => {
    setFiltroStatusVisual(filtroStatus);
  }, [filtroStatus]);

  return (
    <aside ref={painelListaRef} className="student-panel conference-replica-list-panel">
      <div className="conference-replica-list-head">
        <h2>Alunos</h2>
        {!modoApresentacao && (
          <div className="conference-replica-list-actions">
            <button type="button" className="conference-replica-add" onClick={() => setModalAdicionarAluno(true)}>
              <AppIcon name="plus" size={17} strokeWidth={1.7} />
              <span>Adicionar aluno</span>
            </button>
            <button
              type="button"
              className="conference-replica-more"
              onClick={abrirImportacaoCancelados}
              title="Importar lista de cancelados"
              aria-label="Mais opções"
            >
              <AppIcon name="more" size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="conference-replica-tabs">
        {(["ATIVO", "CANCELADO", "TODOS"] as FiltroStatus[]).map((filtro) => (
          <button
            key={filtro}
            type="button"
            className={filtroStatusVisual === filtro ? "active" : ""}
            aria-pressed={filtroStatusVisual === filtro}
            onClick={() => {
              if (filtroStatusVisual === filtro) return;
              setFiltroStatusVisual(filtro);
              startTransition(() => {
                setFiltroStatus(filtro);
                setRaSelecionado("");
                setStatus("salvo");
              });
            }}
          >
            {filtro === "ATIVO" ? "Ativos" : filtro === "CANCELADO" ? "Cancelados" : "Todos"}
          </button>
        ))}
      </div>

      <label className="conference-replica-search">
        <AppIcon name="search" size={18} strokeWidth={1.7} />
        <input
          ref={buscaAlunoRef}
          type="search"
          placeholder="Pesquisar nome, RA ou curso..."
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
        />
      </label>

      <ConferenceUnitFilter
        unidadeSelecionada={unidadeSelecionada}
        alunosNoStatus={alunosNoStatus}
        quantidadesPorUnidade={quantidadesPorUnidade}
        onSelect={(unidade) => {
          setUnidadeSelecionada(unidade);
          setBusca("");
          setRaSelecionado("");
          setStatus("salvo");
        }}
      />

      {temFiltroDashboard && (
        <div className="dashboard-context-filter conference-replica-dashboard-filter">
          <div>
            <span>DASHBOARD</span>
            <strong>{descricaoFiltroDashboard}</strong>
          </div>
          <button type="button" onClick={limparFiltroDashboard}>×</button>
        </div>
      )}

      <div className="conference-replica-found">
        {alunosFiltrados.length.toLocaleString("pt-BR")} alunos encontrados
      </div>

      <div ref={listaAlunosRef} className="conference-replica-student-list">
        {listaAlunosRenderizada}
      </div>
    </aside>
  );
}
