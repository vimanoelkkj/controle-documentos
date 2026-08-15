import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { PeriodoProvider } from "../contexts/PeriodoContext";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import ChangelogModal from "../components/ChangelogModal";

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

  const { usuario, modoApresentacao } = useAuth();

  const [sheetsStatus, setSheetsStatus] = useState<SheetsStatus | null>(null);
  const [testandoSheets, setTestandoSheets] = useState(false);
  const [modalSheets, setModalSheets] = useState(false);
  const [modalSheetsSaindo, setModalSheetsSaindo] = useState(false);
  const [periodDropdownAberto, setPeriodDropdownAberto] = useState(false);
  const periodDropdownRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    function fecharSeClicarFora(event: MouseEvent) {
      if (
        periodDropdownRef.current &&
        !periodDropdownRef.current.contains(event.target as Node)
      ) {
        setPeriodDropdownAberto(false);
      }
    }

    document.addEventListener("mousedown", fecharSeClicarFora);
    return () => document.removeEventListener("mousedown", fecharSeClicarFora);
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
    return <div className="period-boot">Carregando período letivo...</div>;
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

  return (
    <div className="app-layout">
      <Sidebar />

      <div className="app-main-column">
        <header className="period-toolbar">
          <div className="period-toolbar-copy">
            <span>PERÍODO LETIVO</span>
            <strong>{periodoAtual.codigo}</strong>

            {periodoAtual.status === "ARQUIVADO" && (
              <em>
                ARQUIVADO · {modoApresentacao ? "somente leitura" : "edição permitida"}
              </em>
            )}
          </div>

          <button
            type="button"
            className={`google-sheets-status google-sheets-status--${
              sheetsEstado === "temporario" ? "carregando" : sheetsEstado
            }`}
            onClick={abrirModalSheets}
            title="Abrir status da integração com Google Planilhas"
          >
            <GoogleSheetsIcon />

            <span className="google-sheets-status-copy">
              <strong>Google Planilhas</strong>
              <small>
                {sheetsEstado === "carregando"
                  ? "Verificando..."
                  : sheetsEstado === "temporario"
                    ? "Tentando novamente..."
                    : conectado
                      ? "Conectado"
                      : "Não conectado"}
              </small>
            </span>

            <span className="google-sheets-status-dot" aria-hidden="true" />
          </button>

          {usuario?.perfil === "VISUALIZADOR" && (
            <div className="period-toolbar-readonly" role="status">
              <span>{modoApresentacao ? "APRESENTAÇÃO" : "VISUALIZADOR"}</span>
              <strong>Somente leitura</strong>
              <small>Alterações bloqueadas para esta conta</small>
            </div>
          )}

          <div className="period-toolbar-select">
            <span>Trocar período</span>

            <div className="period-dropdown" ref={periodDropdownRef}>
              <button
                type="button"
                className="period-dropdown-trigger"
                aria-haspopup="listbox"
                aria-expanded={periodDropdownAberto}
                onClick={() => setPeriodDropdownAberto((aberto) => !aberto)}
              >
                <span>{periodoAtual.codigo}</span>
                <span
                  className={`period-dropdown-chevron ${
                    periodDropdownAberto ? "open" : ""
                  }`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </button>

              {periodDropdownAberto && (
                <div className="period-dropdown-menu" role="listbox">
                  {periodos.map((periodo) => {
                    const selecionado = periodo.codigo === periodoAtual.codigo;

                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selecionado}
                        className={`period-dropdown-option ${
                          selecionado ? "selected" : ""
                        }`}
                        key={periodo.id}
                        onClick={() => {
                          setPeriodDropdownAberto(false);
                          if (!selecionado) selecionarPeriodo(periodo.codigo);
                        }}
                      >
                        <span>{periodo.codigo}</span>
                        {periodo.status === "ARQUIVADO" && (
                          <small>arquivado</small>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </header>

        {periodoAtual.status === "ARQUIVADO" && (
          <div className="period-archive-warning">
            {modoApresentacao
              ? "Você está visualizando um período arquivado em modo somente leitura."
              : "Você está visualizando um período arquivado. Alterações continuam permitidas e ficam registradas no LOG."}
          </div>
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
