type AppIconName =
  | "document"
  | "dashboard"
  | "check"
  | "mail"
  | "audit"
  | "stats"
  | "log"
  | "calendar"
  | "settings"
  | "info";

type AppIconProps = {
  name: AppIconName;
  size?: number;
  strokeWidth?: number;
};

function AppIcon({ name, size = 20, strokeWidth = 1.8 }: AppIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<AppIconName, React.ReactNode> = {
    document: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 16h6"/></>,
    dashboard: <><rect x="4" y="4" width="6" height="7" rx="1"/><rect x="14" y="4" width="6" height="4" rx="1"/><rect x="14" y="12" width="6" height="8" rx="1"/><rect x="4" y="15" width="6" height="5" rx="1"/></>,
    check: <><path d="M5 12.5 9.2 17 19 7"/><path d="M19 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8"/></>,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 7 7 5 7-5"/></>,
    audit: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/><path d="M8.5 10.5 10 12l3-3"/></>,
    stats: <><path d="M5 19V11M12 19V5M19 19v-7"/><path d="M3 19h18"/></>,
    log: <><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r=".7" fill="currentColor" stroke="none"/></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7 3v4M17 3v4M3.5 9.5h17"/><path d="M8 13h3v3H8z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 3h-3l-.7 2a7 7 0 0 0-1.6.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 11.5v3l2 .7c.2.6.4 1.1.7 1.6l-.9 1.9 2.1 2.1 1.9-.9c.5.3 1 .5 1.6.7l.7 2h3l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 2.1-2.1-.9-1.9c.3-.5.5-1 .7-1.6l1.8-.7Z" transform="translate(2.5 -1.5) scale(.8)"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

export default AppIcon;
export type { AppIconName };
