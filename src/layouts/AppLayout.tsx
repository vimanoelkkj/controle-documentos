import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { PeriodoProvider, usePeriodo } from '../contexts/PeriodoContext'
import { useAuth } from '../contexts/AuthContext'

function LayoutContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { periodos, periodoAtual, carregando, erro, selecionarPeriodo } = usePeriodo()
  const { usuario } = useAuth()

  useEffect(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined

    if (navigation?.type === 'reload' && location.pathname !== '/') {
      navigate('/', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (carregando) {
    return <div className="period-boot">Carregando período letivo...</div>
  }

  if (erro || !periodoAtual) {
    return (
      <div className="period-boot error">
        <strong>Não foi possível iniciar os períodos letivos.</strong>
        <span>{erro || 'Nenhum período cadastrado.'}</span>
        <small>Execute a migration 003_periodos.sql no D1 DEV e recarregue.</small>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <Sidebar />

      <div className="app-main-column">
        <header className="period-toolbar">
          <div className="period-toolbar-copy">
            <span>PERÍODO LETIVO</span>
            <strong>{periodoAtual.codigo}</strong>
            {periodoAtual.status === 'ARQUIVADO' && <em>ARQUIVADO · edição permitida</em>}
          </div>

          {usuario?.perfil === 'VISUALIZADOR' && (
            <div className="period-toolbar-readonly" role="status">
              <span>VISUALIZADOR</span>
              <strong>Somente leitura</strong>
              <small>Alterações bloqueadas para esta conta</small>
            </div>
          )}

          <label className="period-toolbar-select">
            <span>Trocar período</span>
            <select value={periodoAtual.codigo} onChange={(event) => selecionarPeriodo(event.target.value)}>
              {periodos.map((periodo) => (
                <option value={periodo.codigo} key={periodo.id}>
                  {periodo.codigo}{periodo.status === 'ARQUIVADO' ? ' · arquivado' : ''}
                </option>
              ))}
            </select>
          </label>
        </header>

        {periodoAtual.status === 'ARQUIVADO' && (
          <div className="period-archive-warning">
            Você está visualizando um período arquivado. Alterações continuam permitidas e ficam registradas no LOG.
          </div>
        )}

        <main className="app-content" key={periodoAtual.codigo}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function AppLayout() {
  return (
    <PeriodoProvider>
      <LayoutContent />
    </PeriodoProvider>
  )
}

export default AppLayout
