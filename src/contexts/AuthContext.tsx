import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Perfil = "ADMIN" | "EDITOR" | "VISUALIZADOR";

export type Usuario = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: Perfil;
};

type AuthValue = {
  usuario: Usuario | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  logout: () => Promise<void>;
  podeEditar: boolean;
  admin: boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

const TEMPO_INATIVIDADE = 60 * 60 * 1000;
const INTERVALO_RENOVACAO = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  const timerInatividade = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaRenovacao = useRef(0);

  async function recarregar() {
    try {
      const r = await fetch("/api/auth/me");

      if (!r.ok) {
        setUsuario(null);
        return;
      }

      const d = (await r.json()) as { usuario: Usuario };
      setUsuario(d.usuario);
    } finally {
      setCarregando(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUsuario(null);
  }

  useEffect(() => {
    void recarregar();
  }, []);

  useEffect(() => {
    if (!usuario) {
      if (timerInatividade.current) {
        clearTimeout(timerInatividade.current);
        timerInatividade.current = null;
      }

      return;
    }

    async function expirarPorInatividade() {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
        });
      } finally {
        setUsuario(null);
      }
    }

    function reiniciarTimer() {
      if (timerInatividade.current) {
        clearTimeout(timerInatividade.current);
      }

      timerInatividade.current = setTimeout(
        expirarPorInatividade,
        TEMPO_INATIVIDADE,
      );
    }

    async function renovarSessao() {
      const agora = Date.now();

      if (agora - ultimaRenovacao.current < INTERVALO_RENOVACAO) {
        return;
      }

      ultimaRenovacao.current = agora;

      try {
        const r = await fetch("/api/auth/atividade", {
          method: "POST",
        });

        if (r.status === 401) {
          setUsuario(null);
        }
      } catch {
        // Falha momentânea de rede não deve derrubar a sessão.
      }
    }

    function registrarAtividade() {
      reiniciarTimer();
      void renovarSessao();
    }

    const eventos = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

    for (const evento of eventos) {
      window.addEventListener(evento, registrarAtividade, {
        passive: true,
      });
    }

    reiniciarTimer();
    void renovarSessao();

    return () => {
      if (timerInatividade.current) {
        clearTimeout(timerInatividade.current);
      }

      for (const evento of eventos) {
        window.removeEventListener(evento, registrarAtividade);
      }
    };
  }, [usuario]);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        carregando,
        recarregar,
        logout,
        podeEditar: usuario?.perfil === "ADMIN" || usuario?.perfil === "EDITOR",
        admin: usuario?.perfil === "ADMIN",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);

  if (!c) {
    throw new Error("useAuth fora do AuthProvider");
  }

  return c;
}
