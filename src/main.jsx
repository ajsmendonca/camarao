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

// Rede de segurança (alguns celulares seguravam a versão antiga): pergunta ao servidor a versão atual
// (version.json, fora do cache) e, se for outra, apaga o service worker e o cache e recarrega — uma vez por versão.
async function conferirVersao() {
  try {
    const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!r.ok) return
    const { versao } = await r.json()
    if (!versao || versao === __VERSAO__) return
    const chave = 'recarregou-' + versao
    try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1') } catch { /* sem armazenamento */ }
    const regs = (await navigator.serviceWorker?.getRegistrations()) || []
    await Promise.all(regs.map((x) => x.unregister()))
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
    location.reload()
  } catch { /* sem sinal: segue com a versão guardada */ }
}
conferirVersao()
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferirVersao() })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
