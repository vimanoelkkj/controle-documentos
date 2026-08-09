import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

const items = [
  { label: 'Dashboard', to: '/', icon: '▦' },
  { label: 'Conferência', to: '/conferencia', icon: '✓' },
  { label: 'Comunicação', to: '/comunicacao', icon: '✉' },
  { label: 'Auditoria', to: '/auditoria', icon: '⌕' },
  { label: 'Estatísticas', to: '/estatisticas', icon: '↗' },
  { label: 'LOG', to: '/log', icon: '≡' },
  { label: 'Configurações', to: '/configuracoes', icon: '⚙' },
  { label: 'Sobre', to: '/sobre', icon: 'ⓘ' },
]

function Sidebar() {
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
        <div className="sidebar-brand-icon">CD</div>

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
            <span className="sidebar-link-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-button"
          onClick={() => setTema((atual) => (atual === 'dark' ? 'light' : 'dark'))}
        >
          {tema === 'dark' ? '☀ Modo claro' : '☾ Modo escuro'}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar