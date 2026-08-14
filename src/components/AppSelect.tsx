import {
  useEffect,
  useId,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type AppSelectOption = {
  value: string;
  label: string;
  secondary?: string;
  disabled?: boolean;
};

type AppSelectProps = {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

function AppSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
}: AppSelectProps) {
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selecionado = options.find((option) => option.value === value) ?? options[0];

  const posicionarMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const alturaEstimada = Math.min(320, options.length * 40 + 12);
    const cabeAbaixo = rect.bottom + 8 + alturaEstimada <= window.innerHeight - 8;
    const top = cabeAbaixo
      ? rect.bottom + 8
      : Math.max(8, rect.top - 8 - alturaEstimada);

    setMenuStyle({
      position: "fixed",
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      top,
      width: rect.width,
      zIndex: 10000,
    });
  }, [options.length]);

  function abrir() {
    if (disabled || !options.length) return;
    const atual = Math.max(0, options.findIndex((option) => option.value === value));
    setIndiceAtivo(atual);
    posicionarMenu();
    setAberto(true);
  }

  function selecionar(option: AppSelectOption) {
    if (option.disabled) return;
    setAberto(false);
    if (option.value !== value) onChange(option.value);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!aberto) return;

    function fecharFora(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setAberto(false);
      }
    }

    function reposicionar() {
      posicionarMenu();
    }

    document.addEventListener("mousedown", fecharFora);
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);

    return () => {
      document.removeEventListener("mousedown", fecharFora);
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
    };
  }, [aberto, posicionarMenu]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (!aberto && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      abrir();
      return;
    }

    if (!aberto) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setAberto(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const passo = event.key === "ArrowDown" ? 1 : -1;
      let proximo = indiceAtivo;

      for (let i = 0; i < options.length; i += 1) {
        proximo = (proximo + passo + options.length) % options.length;
        if (!options[proximo]?.disabled) break;
      }

      setIndiceAtivo(proximo);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[indiceAtivo];
      if (option) selecionar(option);
    }
  }

  return (
    <div className={`app-select ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="app-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? listboxId : undefined}
        disabled={disabled}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={onKeyDown}
      >
        <span className="app-select-value">{selecionado?.label ?? value}</span>
        <span className={`app-select-chevron ${aberto ? "open" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {aberto &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="app-select-menu"
            role="listbox"
            style={menuStyle}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === indiceAtivo;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={`app-select-option${isSelected ? " selected" : ""}${
                    isActive ? " active" : ""
                  }`}
                  onMouseEnter={() => setIndiceAtivo(index)}
                  onClick={() => selecionar(option)}
                >
                  <span>{option.label}</span>
                  {option.secondary && <small>{option.secondary}</small>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default AppSelect;
