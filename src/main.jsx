import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Atualização automática: quando sai versão nova, o app baixa e recarrega sozinho
// (antes só atualizava na segunda abertura). Também confere a cada 30 min e ao voltar para o app.
const atualizar = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    setInterval(() => reg.update(), 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update() })
  },
})
void atualizar

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
