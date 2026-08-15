import { createContext, useContext } from "react";

export type Perfil = "ADMIN" | "EDITOR" | "VISUALIZADOR";

export type Usuario = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: Perfil;
  modo_apresentacao: number;
};

export type AuthValue = {
  usuario: Usuario | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  logout: () => Promise<void>;
  podeEditar: boolean;
  admin: boolean;
  modoApresentacao: boolean;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error("useAuth fora do AuthProvider");
  return contexto;
}
