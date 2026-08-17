import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/auth";
import AppIcon, { type AppIconName } from "../components/AppIcon";
import { APP_VERSION } from "../data/changelog";

const grupos: {
  titulo: string;
  items: { label: string; to: string; icon: AppIconName }[];
}[] = [
  {
    titulo: "FLUXO DE TRABALHO",
    items: [
      { label: "Dashboard", to: "/", icon: "dashboard" },
      { label: "Conferência", to: "/conferencia", icon: "check" },
      { label: "Comunicação", to: "/comunicacao", icon: "mail" },
      { label: "Auditoria", to: "/auditoria", icon: "audit" },
    ],
  },
  {
    titulo: "ANÁLISE",
    items: [
      { label: "Estatísticas", to: "/estatisticas", icon: "stats" },
      { label: "Log", to: "/log", icon: "log" },
    ],
  },
  {
    titulo: "ADMINISTRAÇÃO",
    items: [
      { label: "Períodos", to: "/periodos", icon: "calendar" },
      { label: "Cursos", to: "/cursos", icon: "courses" },
      { label: "Configurações", to: "/configuracoes", icon: "settings" },
      { label: "Sobre", to: "/sobre", icon: "info" },
    ],
  },
];

type SidebarSheetsEstado = "carregando" | "conectado" | "nao-conectado" | "temporario";

type SidebarProps = {
  sheetsEstado?: SidebarSheetsEstado;
  onSheetsClick?: () => void;
  hideSheetsStatus?: boolean;
};

function SidebarSheetsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.5 2h7.2L19 7.3V21a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6.4 1.8V8h4.2l-4.2-4.2ZM8 10v8.5h8V10H8Zm1.4 1.4h2.1v1.7H9.4v-1.7Zm3.5 0h1.7v1.7h-1.7v-1.7Zm-3.5 3.1h2.1v2.6H9.4v-2.6Zm3.5 0h1.7v2.6h-1.7v-2.6Z"
      />
    </svg>
  );
}

function Sidebar({ sheetsEstado = "carregando", onSheetsClick, hideSheetsStatus = false }: SidebarProps) {
  const { usuario, logout, modoApresentacao } = useAuth();
  const navigate = useNavigate();
  const ambienteBeta = window.location.hostname.startsWith(
    "controle-documentos-dev.",
  );
  const [tema, setTema] = useState<"dark" | "black" | "light">(() => {
    const salvo = localStorage.getItem("tema");
    return salvo === "light" || salvo === "black" ? salvo : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
    document.documentElement.style.colorScheme = tema === "light" ? "light" : "dark";
    localStorage.setItem("tema", tema);
  }, [tema]);

  function alternarTema() {
    const root = document.documentElement;

    // Evita que background/border/color sejam interpolados entre os temas.
    root.classList.add("theme-switching");

    setTema((atual) =>
      atual === "light" ? "dark" : atual === "dark" ? "black" : "light",
    );

    // Mantém as transições desligadas até o navegador pintar o novo tema.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("theme-switching");
      });
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <AppIcon name="document" size={22} strokeWidth={1.9} />
        </div>

        <div className="sidebar-brand-copy">
          <strong>Controle de Documentos</strong>
          <div className="sidebar-brand-meta">
            <span>v{APP_VERSION}</span>
            {ambienteBeta && (
              <span
                className="environment-beta-badge"
                title="Ambiente de testes — não é produção"
              >
                BETA
              </span>
            )}
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Navegação principal">
        {grupos.map((grupo) => {
          const itensVisiveis = grupo.items.filter(
            (item) =>
              !modoApresentacao ||
              !["/auditoria", "/log", "/configuracoes"].includes(item.to),
          );

          if (itensVisiveis.length === 0) return null;

          return (
            <div className="sidebar-nav-group" key={grupo.titulo}>
              <div className="sidebar-nav-heading">{grupo.titulo}</div>

              <div className="sidebar-nav-links">
                {itensVisiveis.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="sidebar-link-icon">
                      <AppIcon name={item.icon} size={17} strokeWidth={1.8} />
                    </span>
                    <span className="sidebar-link-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {usuario && (
          <div className="sidebar-user-row">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {usuario.nome.slice(0, 1).toUpperCase()}
              </div>
              <div className="sidebar-user-copy">
                <strong>{usuario.nome}</strong>
                <span>{modoApresentacao ? "APRESENTAÇÃO" : usuario.perfil}</span>
              </div>
            </div>

            {!hideSheetsStatus && (
            <button
              type="button"
              className={`sidebar-sheets-button sidebar-sheets-button--${sheetsEstado}`}
              onClick={onSheetsClick}
              disabled={!onSheetsClick}
              aria-label={
                sheetsEstado === "conectado"
                  ? "Google Planilhas conectado"
                  : sheetsEstado === "carregando" || sheetsEstado === "temporario"
                    ? "Verificando Google Planilhas"
                    : "Google Planilhas desconectado"
              }
              title={
                sheetsEstado === "conectado"
                  ? "Google Planilhas conectado"
                  : sheetsEstado === "carregando" || sheetsEstado === "temporario"
                    ? "Verificando Google Planilhas"
                    : "Google Planilhas desconectado"
              }
            >
              <span className="sidebar-sheets-icon">
                <SidebarSheetsIcon />
              </span>
              <span className="sidebar-sheets-dot" aria-hidden="true" />
            </button>
            )}
          </div>
        )}

        <div className="sidebar-footer-actions">
          <button type="button" className="theme-button" onClick={alternarTema}>
            <span className="sidebar-action-main">
              <span className="sidebar-action-icon" aria-hidden="true">
                <AppIcon name="moon" size={17} strokeWidth={1.8} />
              </span>
              <span>
                {tema === "light"
                  ? "Modo escuro"
                  : tema === "dark"
                    ? "Modo preto"
                    : "Modo claro"}
              </span>
            </span>
            <span className={`sidebar-theme-switch sidebar-theme-switch--${tema}`} aria-hidden="true">
              <span />
            </span>
          </button>
          <button
            type="button"
            className="logout-button"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <span className="sidebar-action-icon" aria-hidden="true">
              <AppIcon name="logout" size={17} strokeWidth={1.8} />
            </span>
            <span>Sair</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
