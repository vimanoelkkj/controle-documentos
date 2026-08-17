type AppIconName =
  | "document"
  | "documentRefresh"
  | "dashboard"
  | "user"
  | "pie"
  | "unitEad"
  | "unitFace"
  | "unitFch"
  | "unitFea"
  | "check"
  | "mail"
  | "audit"
  | "stats"
  | "log"
  | "calendar"
  | "courses"
  | "settings"
  | "info"
  | "identity"
  | "cpf"
  | "certificate"
  | "residence"
  | "voter"
  | "education"
  | "contract"
  | "search"
  | "refresh"
  | "reload"
  | "plus"
  | "calendarSmall"
  | "clock"
  | "edit"
  | "close"
  | "save"
  | "restore"
  | "more"
  | "moon"
  | "logout"
  | "chevronLeft"
  | "chevronRight";

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
    documentRefresh: <><path d="M6.5 3.5h7l4 4v6.2"/><path d="M13.5 3.5V8h4"/><path d="M9 11h5M9 14h3.4"/><path d="M8.7 20H6.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1"/><path d="M20 16a4.6 4.6 0 0 0-7.9-2.7"/><path d="M12 10.8v2.9h2.9"/><path d="M12 17a4.6 4.6 0 0 0 7.9 2.7"/><path d="M20 22.2v-2.9h-2.9"/></>,
    dashboard: <><rect x="4" y="4" width="6" height="7" rx="1"/><rect x="14" y="4" width="6" height="4" rx="1"/><rect x="14" y="12" width="6" height="8" rx="1"/><rect x="4" y="15" width="6" height="5" rx="1"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4.2 2.7-6.5 6.5-6.5s6 2.3 6.5 6.5"/></>,
    pie: <><path d="M12 3v9h9A9 9 0 1 1 12 3Z"/><path d="M15 3.6A9 9 0 0 1 20.4 9H15V3.6Z"/></>,
    unitEad: <>
      <rect x="3.2" y="6.1" width="14.8" height="10.3" rx="1.8"/>
      <path d="M7.2 19.3h6.8M10.6 16.5v2.8"/>
      <path d="m7.2 10.7 4-2.25 4 2.25-4 2.25-4-2.25Z"/>
      <path d="M8.6 11.6v2.1c1.6 1 3.6 1 5.2 0v-2.1"/>
      <path d="M16.5 4.9c1.45.1 2.55 1.2 2.7 2.65"/>
      <path d="M16.7 2.4c2.85.15 5.05 2.35 5.25 5.15"/>
    </>,
    unitFace: <>
      <path d="M5.2 20V6.2h8.6V20"/>
      <path d="M13.8 10h4.8v10"/>
      <path d="M3.2 20h17.6"/>
      <rect x="7.6" y="8.5" width="1.5" height="1.5" rx=".2"/>
      <rect x="10.5" y="8.5" width="1.5" height="1.5" rx=".2"/>
      <rect x="7.6" y="12" width="1.5" height="1.5" rx=".2"/>
      <rect x="10.5" y="12" width="1.5" height="1.5" rx=".2"/>
      <rect x="7.6" y="15.5" width="1.5" height="1.5" rx=".2"/>
      <rect x="10.5" y="15.5" width="1.5" height="1.5" rx=".2"/>
      <path d="M15.7 13h1.2M15.7 16h1.2"/>
    </>,
    unitFch: <>
      <path d="m8.1 4.6 2.6-2.6 5.8 5.8-2.6 2.6-5.8-5.8Z"/>
      <path d="m6.6 6.1 10.9 10.9"/>
      <path d="m15.9 15.4 2.2-2.2 3.5 3.5-2.2 2.2"/>
      <path d="M4.2 20.2h9.2"/>
      <path d="M5.4 16.5h6.8v3.7H5.4z"/>
      <path d="M6.4 15.1h4.8"/>
    </>,
    unitFea: <>
      <circle cx="12" cy="5.1" r="2.15"/>
      <path d="M10.75 7 7.05 21M13.25 7 16.95 21"/>
      <path d="M8.7 14h6.6"/>
      <path d="M12 7.3v4.1"/>
      <path d="M9.2 13.9 7.6 18.8M14.8 13.9l1.6 4.9"/>
      <circle cx="12" cy="5.1" r=".55"/>
      <path d="M6.2 21h2M15.8 21h2"/>
    </>,
    check: <><path d="M5 12.5 9.2 17 19 7"/><path d="M19 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8"/></>,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 7 7 5 7-5"/></>,
    audit: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/><path d="M8.5 10.5 10 12l3-3"/></>,
    stats: <><path d="M5 19V11M12 19V5M19 19v-7"/><path d="M3 19h18"/></>,
    log: <><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r=".7" fill="currentColor" stroke="none"/></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7 3v4M17 3v4M3.5 9.5h17"/><path d="M8 13h3v3H8z"/></>,
    courses: <><path d="m3 8.5 9-4.5 9 4.5-9 4.5-9-4.5Z"/><path d="M7 11v4.2c2.8 2.1 7.2 2.1 10 0V11"/><path d="M21 9v6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 3h-3l-.7 2a7 7 0 0 0-1.6.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 11.5v3l2 .7c.2.6.4 1.1.7 1.6l-.9 1.9 2.1 2.1 1.9-.9c.5.3 1 .5 1.6.7l.7 2h3l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 2.1-2.1-.9-1.9c.3-.5.5-1 .7-1.6l1.8-.7Z" transform="translate(2.5 -1.5) scale(.8)"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></>,
    identity: <><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.8-1.5 1.8-2.3 3-2.3s2.3.8 3 2.3M14 9h4M14 12h4M14 15h3"/></>,
    cpf: <><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/><circle cx="16.5" cy="16" r="1.2"/></>,
    certificate: <><path d="M7 3.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z"/><path d="M8.5 8h7M8.5 11h7"/><path d="m10 17-1 4 3-1.6 3 1.6-1-4"/></>,
    residence: <><path d="m3.5 11 8.5-7 8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/></>,
    voter: <><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 13h5"/><path d="m14 16 1.5 1.5L19 14"/></>,
    education: <><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M6.5 12v4.2c3.3 2.4 7.7 2.4 11 0V12"/><path d="M21 9v6"/></>,
    contract: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M9 12h6M9 15h4"/><path d="m10 18 1.2 1.2L14 16.5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4.8 9A7.5 7.5 0 0 1 18.5 6.5L20 11"/><path d="M4 18v-5h5"/><path d="M19.2 15A7.5 7.5 0 0 1 5.5 17.5L4 13"/></>,
    reload: <><path d="M20 11a8 8 0 1 0-2.35 5.65"/><path d="M20 5v6h-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    calendarSmall: <><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 9h16"/><path d="M8 13h3v3H8z"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3.5 2"/></>,
    edit: <><path d="M4 20h4l11-11a2.3 2.3 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
    close: <><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></>,
    save: <><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></>,
    restore: <><path d="M5 4.5v5h5"/><path d="M5.4 9.2A7.8 7.8 0 1 1 4.6 14"/></>,
    more: <><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    moon: <><path d="M20 15.2A8.4 8.4 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></>,
    logout: <><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4M18 12H9"/></>,
    chevronLeft: <path d="m15 18-6-6 6-6"/>,
    chevronRight: <path d="m9 18 6-6-6-6"/>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

export default AppIcon;
export type { AppIconName };
