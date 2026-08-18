import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/auth";
import { APP_VERSION } from "../data/changelog";

type IconName =
  | "dashboard"
  | "conferencia"
  | "comunicacao"
  | "estatisticas"
  | "log"
  | "periodos"
  | "cursos"
  | "configuracoes"
  | "sobre";

type NavItem = readonly [label: string, to: string, icon: IconName];

const grupos: ReadonlyArray<{ titulo: string; items: ReadonlyArray<NavItem> }> = [
  {
    titulo: "Fluxo de trabalho",
    items: [
      ["Dashboard", "/", "dashboard"],
      ["Conferência", "/conferencia", "conferencia"],
      ["Comunicação", "/comunicacao", "comunicacao"],
    ],
  },
  {
    titulo: "Análise",
    items: [
      ["Estatísticas", "/estatisticas", "estatisticas"],
      ["Log", "/log", "log"],
    ],
  },
  {
    titulo: "Administração",
    items: [
      ["Períodos", "/periodos", "periodos"],
      ["Cursos", "/cursos", "cursos"],
      ["Configurações", "/configuracoes", "configuracoes"],
      ["Sobre", "/sobre", "sobre"],
    ],
  },
];

function NavIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "dashboard") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }

  if (name === "conferencia") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M7 12l3 3 7-7" />
      </svg>
    );
  }

  if (name === "comunicacao") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    );
  }

  if (name === "estatisticas") {
    return (
      <svg {...common}>
        <path d="M4 20V10" />
        <path d="M12 20V4" />
        <path d="M20 20v-7" />
      </svg>
    );
  }

  if (name === "log") {
    return (
      <svg {...common}>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    );
  }

  if (name === "periodos") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
      </svg>
    );
  }

  if (name === "cursos") {
    return (
      <svg {...common}>
        <path d="M2 9l10-5 10 5-10 5-10-5z" />
        <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      </svg>
    );
  }

  if (name === "configuracoes") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 005 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 005 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 5c.36-.15.68-.4.94-.7.26-.3.44-.66.51-1.05V3a2 2 0 114 0v.09c.07.39.25.75.51 1.05.26.3.58.55.94.7a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019 9c.15.36.4.68.7.94.3.26.66.44 1.05.51H21a2 2 0 110 4h-.09c-.39.07-.75.25-1.05.51-.3.26-.55.58-.7.94z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

export default function Sidebar({
  open,
  onClose,
  dark,
  onToggleDark,
}: {
  open: boolean;
  onClose: () => void;
  dark: boolean;
  onToggleDark: () => void;
}) {
  const { usuario, logout, modoApresentacao } = useAuth();
  const navigate = useNavigate();

  return (
    <aside
      className={`sidebar${open ? " open" : ""}`}
      id="sidebar"
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="brand">
        <div className="brand-icon">CD</div>
        <div>
          <div className="brand-name">Controle de Documentos</div>
          <div className="brand-version">v{APP_VERSION}</div>
        </div>
      </div>

      {grupos.map((grupo) => {
        const items = grupo.items.filter(([, to]) =>
          !modoApresentacao || !["/log", "/configuracoes"].includes(to),
        );
        if (!items.length) return null;
        return (
          <nav className="nav-group" key={grupo.titulo}>
            <div className="nav-label">{grupo.titulo}</div>
            {items.map(([label, to, icon]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                onClick={onClose}
              >
                <span className="nav-icon"><NavIcon name={icon} /></span>
                {label}
              </NavLink>
            ))}
          </nav>
        );
      })}

      <div className="sidebar-footer">
        {usuario && (
          <div className="sf-user">
            <div className="avatar">{iniciais(usuario.nome)}</div>
            <div className="who">
              {usuario.nome}
              <div className="role">{modoApresentacao ? "Apresentação" : usuario.perfil === "ADMIN" ? "Admin" : usuario.perfil}</div>
            </div>
          </div>
        )}

        <div className="sf-row" onClick={onToggleDark} role="button" tabIndex={0}>
          <span className="sf-icon">☾</span><span>Modo escuro</span>
          <label className="switch" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={dark} onChange={onToggleDark} />
            <span className="track" />
          </label>
        </div>

        <a
          className="sf-row"
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          <span className="sf-icon">↪</span><span>Sair</span>
        </a>
      </div>
    </aside>
  );
}
