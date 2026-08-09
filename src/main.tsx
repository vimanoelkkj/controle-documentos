import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/*
 * O tema precisa ser aplicado ANTES do React renderizar.
 *
 * Antes desta correção, o tema só era aplicado no useEffect da Sidebar.
 * Porém, durante "Carregando sessão..." / "Carregando período letivo...",
 * a Sidebar ainda nem existe. Por isso o CSS caía no tema escuro padrão
 * após um F5, mesmo quando o usuário havia escolhido o tema claro.
 */
const temaSalvo = localStorage.getItem('tema')
const temaInicial = temaSalvo === 'light' ? 'light' : 'dark'

document.documentElement.dataset.theme = temaInicial
document.documentElement.style.colorScheme = temaInicial

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
