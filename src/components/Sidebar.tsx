import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AppIcon, { type AppIconName } from "../components/AppIcon";
import { APP_VERSION } from "../data/changelog";

const items: { label: string; to: string; icon: AppIconName }[] = [
  { label: "Dashboard", to: "/", icon: "dashboard" },
  { label: "Conferência", to: "/conferencia", icon: "check" },
  { label: "Comunicação", to: "/comunicacao", icon: "mail" },
  { label: "Auditoria", to: "/auditoria", icon: "audit" },
  { label: "Estatísticas", to: "/estatisticas", icon: "stats" },
  { label: "LOG", to: "/log", icon: "log" },
  { label: "Períodos", to: "/periodos", icon: "calendar" },
  { label: "Cursos", to: "/cursos", icon: "courses" },
  { label: "Configurações", to: "/configuracoes", icon: "settings" },
  { label: "Sobre", to: "/sobre", icon: "info" },
];

function Sidebar() {
  const { usuario, logout } = useAuth();
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

      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            <span className="sidebar-link-icon">
              <AppIcon name={item.icon} size={16} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {usuario && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {usuario.nome.slice(0, 1).toUpperCase()}
            </div>
            <div className="sidebar-user-copy">
              <strong>{usuario.nome}</strong>
              <span>{usuario.perfil}</span>
            </div>
          </div>
        )}

        <div className="sidebar-footer-actions">
          <button type="button" className="theme-button" onClick={alternarTema}>
            <span aria-hidden="true">
              {tema === "light" ? "☾" : tema === "dark" ? "●" : "☀"}
            </span>
            {tema === "light"
              ? "Modo escuro"
              : tema === "dark"
                ? "Modo preto"
                : "Modo claro"}
          </button>
          <button
            type="button"
            className="logout-button"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <span aria-hidden="true">↪</span>
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
