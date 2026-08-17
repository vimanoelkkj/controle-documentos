import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { PeriodoProvider } from "../contexts/PeriodoContext";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import ChangelogModal from "../components/ChangelogModal";
import AppIcon from "../components/AppIcon";

type SheetsEstado = "carregando" | "conectado" | "nao-conectado" | "temporario";

type SheetsStatus = {
  configurado: boolean;
  conectado: boolean;
  spreadsheet_id: string | null;
  titulo: string | null;
  erro: string | null;
};

function GoogleSheetsIcon() {
  return (
    <svg
      className="google-sheets-status-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M6.5 2h7.2L19 7.3V21a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6.4 1.8V8h4.2l-4.2-4.2ZM8 10v8.5h8V10H8Zm1.4 1.4h2.1v1.7H9.4v-1.7Zm3.5 0h1.7v1.7h-1.7v-1.7Zm-3.5 3.1h2.1v2.6H9.4v-2.6Zm3.5 0h1.7v2.6h-1.7v-2.6Z"
      />
    </svg>
  );
}

function LayoutContent() {
  const navigate = useNavigate();
  const location = useLocation();

  const { periodos, periodoAtual, carregando, erro, selecionarPeriodo } =
    usePeriodo();

  const { modoApresentacao } = useAuth();

  const [sheetsStatus, setSheetsStatus] = useState<SheetsStatus | null>(null);
  const [testandoSheets, setTestandoSheets] = useState(false);
  const [modalSheets, setModalSheets] = useState(false);
  const [modalSheetsSaindo, setModalSheetsSaindo] = useState(false);
  const [periodDropdownAberto, setPeriodDropdownAberto] = useState(false);
  const [periodDropdownFechando, setPeriodDropdownFechando] = useState(false);
  const periodDropdownRef = useRef<HTMLDivElement | null>(null);
  const periodDropdownCloseTimerRef = useRef<number | null>(null);
  const retrySheetsRef = useRef<number | null>(null);

  useEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    if (navigation?.type === "reload" && location.pathname !== "/") {
      navigate("/", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fecharPeriodDropdown = useCallback(() => {
    if (!periodDropdownAberto || periodDropdownFechando) return;

    setPeriodDropdownFechando(true);

    if (periodDropdownCloseTimerRef.current !== null) {
      window.clearTimeout(periodDropdownCloseTimerRef.current);
    }

    periodDropdownCloseTimerRef.current = window.setTimeout(() => {
      setPeriodDropdownAberto(false);
      setPeriodDropdownFechando(false);
      periodDropdownCloseTimerRef.current = null;
    }, 120);
  }, [periodDropdownAberto, periodDropdownFechando]);

  useEffect(() => {
    function fecharSeClicarFora(event: MouseEvent) {
      if (
        periodDropdownRef.current &&
        !periodDropdownRef.current.contains(event.target as Node)
      ) {
        fecharPeriodDropdown();
      }
    }

    function fecharComEsc(event: KeyboardEvent) {
      if (event.key === "Escape") fecharPeriodDropdown();
    }

    document.addEventListener("mousedown", fecharSeClicarFora);
    document.addEventListener("keydown", fecharComEsc);

    return () => {
      document.removeEventListener("mousedown", fecharSeClicarFora);
      document.removeEventListener("keydown", fecharComEsc);
    };
  }, [fecharPeriodDropdown]);

  useEffect(() => {
    return () => {
      if (periodDropdownCloseTimerRef.current !== null) {
        window.clearTimeout(periodDropdownCloseTimerRef.current);
      }
    };
  }, []);

  async function testarGoogleSheets(silencioso = false) {
    if (!periodoAtual) return;

    if (retrySheetsRef.current !== null) {
      window.clearTimeout(retrySheetsRef.current);
      retrySheetsRef.current = null;
    }

    if (!silencioso) setTestandoSheets(true);

    try {
      const resposta = await fetch(
        `/api/periodos/${periodoAtual.id}/google-sheets/status`,
      );

      const dados = (await resposta.json()) as SheetsStatus & {
        codigo?: string;
        temporario?: boolean;
      };

      if (resposta.status === 503 && dados.temporario) {
        setSheetsStatus({
          configurado: Boolean(dados.configurado),
          conectado: false,
          spreadsheet_id: dados.spreadsheet_id ?? null,
          titulo: dados.titulo ?? null,
          erro: dados.erro || "Serviço temporariamente indisponível.",
        });

        const retryAfter = Number(resposta.headers.get("Retry-After") || "2");
        const atraso = Number.isFinite(retryAfter)
          ? Math.max(1, retryAfter) * 1000
          : 2000;

        retrySheetsRef.current = window.setTimeout(() => {
          void testarGoogleSheets(true);
        }, atraso);

        return;
      }

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível verificar o Google Planilhas.",
        );
      }

      setSheetsStatus(dados);
    } catch (erro) {
      setSheetsStatus({
        configurado: false,
        conectado: false,
        spreadsheet_id: null,
        titulo: null,
        erro:
          erro instanceof Error
            ? erro.message
            : "Não foi possível verificar o Google Planilhas.",
      });
    } finally {
      if (!silencioso) setTestandoSheets(false);
    }
  }

  useEffect(() => {
    setSheetsStatus(null);
    void testarGoogleSheets(true);

    return () => {
      if (retrySheetsRef.current !== null) {
        window.clearTimeout(retrySheetsRef.current);
        retrySheetsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoAtual?.id]);

  function abrirModalSheets() {
    setModalSheetsSaindo(false);
    setModalSheets(true);
  }

  function fecharModalSheets() {
    if (modalSheetsSaindo) return;

    setModalSheetsSaindo(true);

    window.setTimeout(() => {
      setModalSheets(false);
      setModalSheetsSaindo(false);
    }, 180);
  }

  function gerenciarIntegracao() {
    fecharModalSheets();

    window.setTimeout(() => {
      navigate("/periodos");
    }, 180);
  }

  if (carregando) {
    return null;
  }

  if (erro || !periodoAtual) {
    return (
      <div className="period-boot error">
        <strong>Não foi possível iniciar os períodos letivos.</strong>
        <span>{erro || "Nenhum período cadastrado."}</span>
        <small>
          Execute a migration 003_periodos.sql no D1 DEV e recarregue.
        </small>
      </div>
    );
  }

  const sheetsTemporariamenteIndisponivel =
    Boolean(sheetsStatus?.erro) &&
    /temporariamente indisponível|temporarily unavailable/i.test(
      sheetsStatus?.erro || "",
    );

  const sheetsEstado: SheetsEstado =
    sheetsStatus === null
      ? "carregando"
      : sheetsTemporariamenteIndisponivel
        ? "temporario"
        : sheetsStatus.conectado
          ? "conectado"
          : "nao-conectado";

  const conectado = sheetsEstado === "conectado";
  const paginaMeta = (() => {
    if (location.pathname.startsWith("/conferencia")) {
      return {
        title: "Conferência",
        description: "Confira e atualize a documentação dos alunos.",
      };
    }

    if (location.pathname === "/") {
      return {
        title: "Dashboard",
        description: "Visão geral da documentação dos alunos por unidade.",
      };
    }

    if (location.pathname.startsWith("/comunicacao")) {
      return {
        title: "Comunicação",
        description: "Grupos automáticos por combinação exata de pendências.",
      };
    }

    if (location.pathname.startsWith("/auditoria")) {
      return {
        title: "Auditoria",
        description: "Integridade entre os dados do sistema e da planilha no período selecionado.",
      };
    }

    if (location.pathname.startsWith("/estatisticas")) {
      return {
        title: "Estatísticas documentais",
        description: "Onde estão os gargalos, como os alunos se distribuem e quais grupos merecem prioridade na conferência.",
      };
    }

    if (location.pathname.startsWith("/log")) {
      return {
        title: "LOG",
        description: "Registro cronológico das ações realizadas no sistema.",
      };
    }

    if (location.pathname.startsWith("/periodos")) {
      return {
        title: "Períodos letivos",
        description: "Crie novos ciclos, alterne o contexto do sistema e arquive períodos antigos sem perder o acesso aos dados.",
      };
    }

    if (location.pathname.startsWith("/cursos")) {
      return {
        title: "Cursos e unidades",
        description: `Corrija a unidade de um curso e atualize todos os alunos vinculados no período ${periodoAtual.codigo}.`,
      };
    }

    if (location.pathname.startsWith("/configuracoes")) {
      return {
        title: "Configurações",
        description: "Preferências, integrações e controle de acesso.",
      };
    }

    if (location.pathname.startsWith("/sobre")) {
      return {
        title: "Sobre",
        description: "Uma visão geral do sistema, sua proposta e os recursos que fazem parte da operação acadêmica.",
      };
    }

    return null;
  })();

  return (
    <div className="app-layout">
      <Sidebar sheetsEstado={sheetsEstado} onSheetsClick={abrirModalSheets} hideSheetsStatus />

      <div className="app-main-column">
        <header className="period-toolbar period-toolbar--conference-replica">
          <div className="conference-replica-period">
            <span>Período</span>
            <div
              className={`period-dropdown ${
                periodDropdownAberto ? "is-open" : ""
              } ${periodDropdownFechando ? "is-closing" : ""}`}
              ref={periodDropdownRef}
            >
              <button
                type="button"
                className="period-dropdown-trigger conference-replica-period-trigger"
                aria-haspopup="listbox"
                aria-expanded={periodDropdownAberto}
                onClick={() => {
                  if (periodDropdownAberto) {
                    fecharPeriodDropdown();
                  } else {
                    setPeriodDropdownFechando(false);
                    setPeriodDropdownAberto(true);
                  }
                }}
              >
                <AppIcon name="calendarSmall" size={17} />
                <span className="conference-replica-period-value">{periodoAtual.codigo}</span>
                <span
                  className="period-dropdown-chevron period-dropdown-chevron-animated"
                  aria-hidden="true"
                />
              </button>

              <div
                className="period-dropdown-menu period-dropdown-disclosure"
                role="listbox"
                aria-hidden={!periodDropdownAberto}
              >
                {periodos.map((periodo) => {
                  const selecionado = periodo.codigo === periodoAtual.codigo;
                  return (
                    <button
                      type="button"
                      role="option"
                      tabIndex={periodDropdownAberto ? 0 : -1}
                      aria-selected={selecionado}
                      className={`period-dropdown-option ${selecionado ? "selected" : ""}`}
                      key={periodo.id}
                      onClick={() => {
                        if (periodDropdownFechando) return;

                        if (selecionado) {
                          fecharPeriodDropdown();
                          return;
                        }

                        setPeriodDropdownFechando(true);

                        if (periodDropdownCloseTimerRef.current !== null) {
                          window.clearTimeout(periodDropdownCloseTimerRef.current);
                        }

                        periodDropdownCloseTimerRef.current = window.setTimeout(() => {
                          selecionarPeriodo(periodo.codigo);
                          setPeriodDropdownAberto(false);
                          setPeriodDropdownFechando(false);
                          periodDropdownCloseTimerRef.current = null;
                        }, 120);
                      }}
                    >
                      <span>{periodo.codigo}</span>
                      <span className="period-dropdown-option-meta">
                        {periodo.status === "ARQUIVADO" && <small>arquivado</small>}
                        {selecionado && (
                          <span className="period-dropdown-option-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={`conference-replica-sheets conference-replica-sheets--${sheetsEstado}`}
            onClick={abrirModalSheets}
            title="Abrir status da integração com Google Planilhas"
          >
            <GoogleSheetsIcon />
            <span>Google Planilhas</span>
            <i className="google-sheets-status-dot" aria-hidden="true" />
            <strong>
              {sheetsEstado === "carregando"
                ? "Verificando"
                : sheetsEstado === "temporario"
                  ? "Indisponível"
                  : conectado
                    ? "Conectado"
                    : "Desconectado"}
            </strong>
          </button>
        </header>

        {periodoAtual.status === "ARQUIVADO" && (
          <div className="period-archive-warning">
            {modoApresentacao
              ? "Você está visualizando um período arquivado em modo somente leitura."
              : "Você está visualizando um período arquivado. Alterações continuam permitidas e ficam registradas no LOG."}
          </div>
        )}

        {paginaMeta && (
          <header className="unified-reference-page-heading">
            <h1>{paginaMeta.title}</h1>
            <p>{paginaMeta.description}</p>
          </header>
        )}

        <main className="app-content" key={periodoAtual.codigo}>
          <Outlet />
        </main>
      </div>

      <ChangelogModal />

      {modalSheets && (
        <div
          className={`modal-overlay google-sheets-modal-overlay ${
            modalSheetsSaindo ? "google-sheets-modal-overlay-exit" : ""
          }`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) fecharModalSheets();
          }}
        >
          <section
            className="google-sheets-modal"
            role="dialog"
            aria-modal="true"
          >
            <header className="google-sheets-modal-head">
              <div
                className={`google-sheets-modal-icon ${
                  conectado ? "connected" : "disconnected"
                }`}
              >
                <GoogleSheetsIcon />
              </div>

              <div>
                <span>INTEGRAÇÃO</span>
                <h2>Google Planilhas</h2>
                <p>Período {periodoAtual.codigo}</p>
              </div>

              <button
                type="button"
                className="modal-fechar"
                onClick={fecharModalSheets}
                disabled={testandoSheets}
              >
                ×
              </button>
            </header>

            <div className="google-sheets-modal-body">
              <div
                className={`google-sheets-connection-state ${
                  conectado ? "connected" : "disconnected"
                }`}
              >
                <span className="google-sheets-connection-dot" />
                <div>
                  <strong>
                    {sheetsStatus === null
                      ? "Verificando conexão..."
                      : sheetsEstado === "temporario"
                        ? "Conexão temporariamente indisponível"
                        : conectado
                          ? "Conexão confirmada"
                          : sheetsStatus.configurado
                            ? "Configuração encontrada, mas sem conexão"
                            : "Não conectado"}
                  </strong>

                  <small>
                    {conectado
                      ? "O sistema conseguiu acessar a planilha pelo Google Sheets."
                      : sheetsEstado === "temporario"
                        ? "O armazenamento de autenticação está instável. O sistema tentará novamente automaticamente."
                        : sheetsStatus?.configurado
                          ? "A configuração existe, mas o Google não confirmou o acesso."
                          : "Nenhuma planilha está configurada para este período."}
                  </small>
                </div>
              </div>

              {sheetsStatus?.configurado && (
                <div className="google-sheets-modal-details">
                  <div>
                    <span>Planilha vinculada</span>
                    <strong>{sheetsStatus.titulo || "Google Sheets"}</strong>
                  </div>

                  <div>
                    <span>ID da planilha</span>
                    <code>{sheetsStatus.spreadsheet_id}</code>
                  </div>
                </div>
              )}

              {sheetsStatus?.erro && (
                <div className="google-sheets-modal-error">
                  {sheetsStatus.erro}
                </div>
              )}
            </div>

            <footer className="google-sheets-modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void testarGoogleSheets(false)}
                disabled={testandoSheets || !sheetsStatus?.configurado}
              >
                {testandoSheets
                  ? "Testando..."
                  : sheetsEstado === "temporario"
                    ? "↻ Tentar agora"
                    : "↻ Testar conexão"}
              </button>

              <button
                type="button"
                className="primary-action"
                onClick={gerenciarIntegracao}
              >
                {sheetsStatus?.configurado
                  ? "Gerenciar integração"
                  : "Configurar integração"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function AppLayout() {
  return (
    <PeriodoProvider>
      <LayoutContent />
    </PeriodoProvider>
  );
}

export default AppLayout;
