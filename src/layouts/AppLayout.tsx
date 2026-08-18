import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { PeriodoProvider } from "../contexts/PeriodoContext";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import shellCss from "../mockups/sobre.css?raw";

type SheetsStatus = {
  configurado: boolean;
  conectado: boolean;
  spreadsheet_id: string | null;
  titulo: string | null;
  erro: string | null;
};

function LayoutContent() {
  const navigate = useNavigate();
  const { periodos, periodoAtual, carregando, erro, selecionarPeriodo } = usePeriodo();
  const { modoApresentacao } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("tema-v3") === "dark");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [sheetsStatus, setSheetsStatus] = useState<SheetsStatus | null>(null);
  const [testingSheets, setTestingSheets] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);
  const integrationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("tema-v3", dark ? "dark" : "light");
  }, [dark]);

  async function loadSheetsStatus() {
    if (!periodoAtual) return;
    try {
      const resposta = await fetch(`/api/periodos/${periodoAtual.id}/google-sheets/status`);
      const dados = (await resposta.json()) as SheetsStatus;
      if (!resposta.ok) throw new Error(dados.erro || "Falha ao verificar integração.");
      setSheetsStatus(dados);
    } catch (e) {
      setSheetsStatus({
        configurado: false,
        conectado: false,
        spreadsheet_id: null,
        titulo: null,
        erro: e instanceof Error ? e.message : "Falha ao verificar integração.",
      });
    }
  }

  useEffect(() => {
    setSheetsStatus(null);
    void loadSheetsStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoAtual?.id]);

  useEffect(() => {
    function outside(e: MouseEvent) {
      const target = e.target as Node;
      if (periodRef.current && !periodRef.current.contains(target)) setPeriodOpen(false);
      if (integrationRef.current && !integrationRef.current.contains(target)) setIntegrationOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPeriodOpen(false);
        setIntegrationOpen(false);
        setSidebarOpen(false);
      }
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (carregando) return null;
  if (erro || !periodoAtual) {
    return <div style={{ padding: 32, fontFamily: "system-ui" }}>{erro || "Nenhum período cadastrado."}</div>;
  }

  const connected = Boolean(sheetsStatus?.conectado);

  return (
    <>
      <style data-claude-shell>{shellCss}</style>
      <div className="app">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        dark={dark}
        onToggleDark={() => setDark((v) => !v)}
      />

      <div className="main">
        <div className="topbar">
          <button className="sidebar-toggle" id="sidebarToggle" onClick={() => setSidebarOpen((v) => !v)}>☰ Menu</button>

          <div className={`period-picker${periodOpen ? " open" : ""}`} id="periodPicker" ref={periodRef}>
            <div className="period-select" id="periodTrigger" onClick={() => setPeriodOpen((v) => !v)}>
              Período · <strong id="periodValue">{periodoAtual.codigo}</strong><span className="p-chev" />
            </div>
            <div className="period-dropdown">
              <ul id="periodList">
                {periodos.map((periodo) => {
                  const selected = periodo.codigo === periodoAtual.codigo;
                  return (
                    <li
                      key={periodo.id}
                      data-value={periodo.codigo}
                      className={selected ? "selected" : ""}
                      onClick={(e) => {
                        e.stopPropagation();
                        selecionarPeriodo(periodo.codigo);
                        setPeriodOpen(false);
                      }}
                    >
                      <span>{periodo.codigo}</span>
                      {selected ? <span className="p-check">✓</span> : periodo.status === "ARQUIVADO" ? <span className="p-archived">arquivado</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className={`integration-picker${integrationOpen ? " open" : ""}`} id="integrationPicker" ref={integrationRef}>
            <div className="conn-status" id="integrationTrigger" onClick={() => setIntegrationOpen((v) => !v)}>
              <span className="led" style={!connected && sheetsStatus ? { background: "var(--terracotta)" } : undefined} />
              Google Planilhas · {sheetsStatus === null ? "Verificando" : connected ? "Conectado" : "Desconectado"}
            </div>
            <div className="integration-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="int-close" id="closeIntegration" aria-label="Fechar" onClick={() => setIntegrationOpen(false)}>✕</button>
              <div className="int-eyebrow">Integração</div>
              <div className="int-header">
                <div className="int-icon">▦</div>
                <div>
                  <h3 className="int-title">Google Planilhas</h3>
                  <p className="int-sub">Período {periodoAtual.codigo}</p>
                </div>
              </div>

              <div className="int-status">
                <span className="led" style={!connected ? { background: "var(--terracotta)" } : undefined} />
                <div>
                  <strong>{connected ? "Conexão confirmada" : sheetsStatus?.configurado ? "Configuração sem conexão" : "Não conectado"}</strong>
                  <p>{connected ? "O sistema conseguiu acessar a planilha pelo Google Sheets." : sheetsStatus?.erro || "Nenhuma planilha está configurada para este período."}</p>
                </div>
              </div>

              {sheetsStatus?.configurado && (
                <>
                  <div className="int-field">
                    <div className="if-label">Planilha vinculada</div>
                    <div className="if-value">{sheetsStatus.titulo || "Google Sheets"}</div>
                  </div>
                  <div className="int-field" style={{ marginBottom: 0 }}>
                    <div className="if-label">ID da planilha</div>
                    <div className="if-value mono">{sheetsStatus.spreadsheet_id}</div>
                  </div>
                </>
              )}

              <div className="int-footer">
                <a onClick={async () => {
                  setTestingSheets(true);
                  await loadSheetsStatus();
                  setTestingSheets(false);
                }}>{testingSheets ? "Testando..." : "↻ Testar conexão"}</a>
                {!modoApresentacao && <a className="int-primary" onClick={() => { setIntegrationOpen(false); navigate("/periodos"); }}>Gerenciar integração</a>}
              </div>
            </div>
          </div>
        </div>

        {periodoAtual.status === "ARQUIVADO" && (
          <div style={{ padding: "0.7rem clamp(1rem, 3vw, 2rem)", fontSize: ".8rem", color: "var(--amber)", borderBottom: "1px solid var(--border)" }}>
            {modoApresentacao ? "Período arquivado em modo somente leitura." : "Você está visualizando um período arquivado."}
          </div>
        )}

        <div className="content" key={periodoAtual.codigo}>
          <Outlet />
        </div>
      </div>
    </div>
    </>
  );
}

export default function AppLayout() {
  return <PeriodoProvider><LayoutContent /></PeriodoProvider>;
}
