import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Perfil = 'ADMIN' | 'EDITOR' | 'VISUALIZADOR'
export type Usuario = { id: number; nome: string; email: string; username: string; perfil: Perfil }

type AuthValue = { usuario: Usuario | null; carregando: boolean; recarregar: () => Promise<void>; logout: () => Promise<void>; podeEditar: boolean; admin: boolean }
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)
  async function recarregar() {
    try {
      const r = await fetch('/api/auth/me')
      if (!r.ok) { setUsuario(null); return }
      const d = await r.json() as { usuario: Usuario }; setUsuario(d.usuario)
    } finally { setCarregando(false) }
  }
  useEffect(() => { void recarregar() }, [])
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); setUsuario(null) }
  return <AuthContext.Provider value={{ usuario, carregando, recarregar, logout, podeEditar: usuario?.perfil === 'ADMIN' || usuario?.perfil === 'EDITOR', admin: usuario?.perfil === 'ADMIN' }}>{children}</AuthContext.Provider>
}
export function useAuth() { const c = useContext(AuthContext); if (!c) throw new Error('useAuth fora do AuthProvider'); return c }
