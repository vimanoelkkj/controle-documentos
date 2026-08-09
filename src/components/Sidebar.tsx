import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AppIcon, { type AppIconName } from '../components/AppIcon'

const items: { label: string; to: string; icon: AppIconName }[] = [
  { label: 'Dashboard', to: '/', icon: 'dashboard' },
  { label: 'Conferência', to: '/conferencia', icon: 'check' },
  { label: 'Comunicação', to: '/comunicacao', icon: 'mail' },
  { label: 'Auditoria', to: '/auditoria', icon: 'audit' },
  { label: 'Estatísticas', to: '/estatisticas', icon: 'stats' },
  { label: 'LOG', to: '/log', icon: 'log' },
  { label: 'Períodos', to: '/periodos', icon: 'calendar' },
  { label: 'Configurações', to: '/configuracoes', icon: 'settings' },
  { label: 'Sobre', to: '/sobre', icon: 'info' },
]

function Sidebar() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const [tema, setTema] = useState<'dark' | 'light'>(() => {
    const salvo = localStorage.getItem('tema')
    return salvo === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = tema
    localStorage.setItem('tema', tema)
  }, [tema])

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon"><AppIcon name="document" size={22} strokeWidth={1.9} /></div>

        <div className="sidebar-brand-copy">
          <strong>Controle de Documentos</strong>
          <span>v2.0.0</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <span className="sidebar-link-icon"><AppIcon name={item.icon} size={16} /></span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {usuario && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{usuario.nome.slice(0, 1).toUpperCase()}</div>
            <div className="sidebar-user-copy">
              <strong>{usuario.nome}</strong>
              <span>{usuario.perfil}</span>
            </div>
          </div>
        )}

        <div className="sidebar-footer-actions">
          <button
            type="button"
            className="theme-button"
            onClick={() => setTema((atual) => (atual === 'dark' ? 'light' : 'dark'))}
          >
            <span aria-hidden="true">{tema === 'dark' ? '☀' : '☾'}</span>
            {tema === 'dark' ? 'Modo claro' : 'Modo escuro'}
          </button>
          <button
            type="button"
            className="logout-button"
            onClick={async () => {
              await logout()
              navigate('/login', { replace: true })
            }}
          >
            <span aria-hidden="true">↪</span>
            Sair
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar