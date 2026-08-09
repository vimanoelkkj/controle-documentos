import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined

    if (navigation?.type === 'reload' && location.pathname !== '/') {
      navigate('/', { replace: true })
    }
    // Executa apenas na montagem inicial. Se dependesse de location.pathname,
    // a entrada de performance continuaria marcada como reload e qualquer
    // clique no menu seria redirecionado de volta ao Dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout