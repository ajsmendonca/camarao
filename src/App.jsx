import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  carregarCadastro, listarLancamentos, adicionarLancamento, excluirLancamento, uuid,
  sincronizar, getOperador, setOperador, hoje, agora, MODO_DEMO, resetarDemo, supabase,
} from './data'

const num = (s) => {
  if (s === '' || s == null) return null
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const fmt = (n, d = 1) => n == null || Number.isNaN(n) ? '–'
  : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const dataBR = (iso) => iso ? iso.split('-').reverse().join('/') : ''
const diasAntes = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
// coeficiente de variação (%) de uma biometria por tamanho [{g, qtd}]
const cvClasses = (cl) => {
  const n = (cl || []).reduce((a, c) => a + c.qtd, 0)
  if (!n) return null
  const m = cl.reduce((a, c) => a + c.g * c.qtd, 0) / n
  return m ? (Math.sqrt(cl.reduce((a, c) => a + c.qtd * (c.g - m) ** 2, 0) / n) / m) * 100 : null
}
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5)

const PARAMS = {
  od: { rotulo: 'Oxigênio (mg/L)', min: 0, max: 25 },
  ph: { rotulo: 'pH', min: 0, max: 14 },
  temperatura: { rotulo: 'Temperatura (°C)', min: 10, max: 45 },
  salinidade: { rotulo: 'Salinidade (ppt)', min: 0, max: 60 },
  transparencia: { rotulo: 'Transparência (cm)', min: 0, max: 300 },
}
const minDesde = (data, hora) => Math.round((Date.now() - new Date(`${data}T${hora}:00`)) / 60000)
const duracao = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
const somaHora = (hora, min) => { const [h, m] = hora.split(':').map(Number); const t = (h * 60 + m + min) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
const RESULT_CK = { zerou: 'Zerou', pouca_sobra: 'Pouca sobra', muita_sobra: 'Muita sobra' }
const TIPOS_OC = { mortalidade: 'Mortalidade', doenca: 'Doença / sinais', manutencao: 'Manutenção', outro: 'Outro' }
const CAT_INSUMO = { fertilizante: 'Fertilizante', calcario: 'Calcário / cal', probiotico: 'Probiótico', outro: 'Outro' }
const CAT_PRODUTO = { racao: 'Ração', ...CAT_INSUMO }
const UNIDADES = ['kg', 'g', 'L', 'mL', 'sc', 'un']
// quantidade de estoque: sem casas quando é inteiro
const fq = (n) => fmt(n, Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1)
const TELA_NOME = { estoque: 'Estoque', produto: 'Produto', plano: 'Plano de ração', insumo: 'Insumo', racao: 'Ração', checagem: 'Bandejas', colocacao: 'Colocação', retirada: 'Retirada', biometria: 'Biometria', agua: 'Água', ocorrencia: 'Ocorrência' }

export default function App() {
  const [cad, setCad] = useState(null)
  const [lanc, setLanc] = useState([])
  const [operador, setOp] = useState(undefined)
  const [tela, setTela] = useState('inicio')
  const [online, setOnline] = useState(navigator.onLine)
  const [aviso, setAviso] = useState(null)
  const [logado, setLogado] = useState(MODO_DEMO ? true : undefined)

  useEffect(() => {
    if (MODO_DEMO) return
    supabase.auth.getSession().then(({ data }) => setLogado(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setLogado(!!s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const recarregar = useCallback(async () => setLanc(await listarLancamentos()), [])
  const sync = useCallback(async () => {
    const r = await sincronizar(); await recarregar()
    if (!MODO_DEMO && navigator.onLine) setCad(await carregarCadastro())
    if (r.erro) setAviso({ tipo: 'erro', texto: 'Erro ao enviar: ' + r.erro })
    return r
  }, [recarregar])

  useEffect(() => {
    if (!logado) return
    (async () => {
      setCad(await carregarCadastro()); setOp((await getOperador()) || null); await recarregar(); sync()
    })()
    const on = () => { setOnline(true); sync() }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    const t = setInterval(sync, 60000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [recarregar, sync, logado])

  useEffect(() => { if (aviso) { const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t) } }, [aviso])

  // ciclo ativo por viveiro + indicadores do dia
  const viveiros = useMemo(() => {
    if (!cad) return []
    return cad.viveiros.map((v) => {
      const ciclo = cad.ciclos.find((c) => c.viveiro_id === v.id && c.status === 'em_cultivo')
      if (!ciclo) return { ...v, ciclo: null }
      const meus = lanc.filter((l) => l.dados.ciclo_id === ciclo.id)
      const racaoHoje = meus.filter((l) => l.tipo === 'racao' && l.dados.data === hoje())
      // bandejas: junta colocações/retiradas deste aparelho com as do servidor (outros aparelhos)
      const retLocais = meus.filter((l) => l.tipo === 'retirada')
      const colocacoes = [
        ...meus.filter((l) => l.tipo === 'colocacao').map((l) => ({ id: l.id, ...l.dados })),
        ...(cad.colocacoes || []).filter((c) => c.ciclo_id === ciclo.id && !meus.some((l) => l.id === c.id)),
      ].map((c) => ({ ...c, retirada: c.retirada || retLocais.find((r) => r.dados.colocacao_id === c.id)?.dados || null }))
        .sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
      // plano do gestor vigente hoje (mais recente com início <= hoje), juntando o deste aparelho e o do servidor
      const planos = [
        ...meus.filter((l) => l.tipo === 'plano').map((l) => ({ id: l.id, ...l.dados, criado_em: l.criado_em })),
        ...(cad.planos || []).filter((x) => x.ciclo_id === ciclo.id && !meus.some((l) => l.id === x.id)),
      ].sort((a, b) => (b.data_inicio + (b.criado_em || '')).localeCompare(a.data_inicio + (a.criado_em || '')))
      const plano = planos.find((x) => x.data_inicio <= hoje()) || null
      const planoFuturo = planos.find((x) => x.data_inicio > hoje()) || null
      const distrib = [
        ...meus.filter((l) => l.tipo === 'biometria' && l.dados.tipo === 'classes').map((l) => l.dados),
        ...(cad.distribuicoes || []).filter((d) => d.ciclo_id === ciclo.id),
      ].sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))[0]
      const bioLocal = meus.filter((l) => l.tipo === 'biometria' && l.dados.tipo !== 'classes')
        .map((l) => ({ data: l.dados.data, hora: l.dados.hora, peso_medio_g: l.dados.peso_total_g / l.dados.n_amostra }))
      const bios = [...bioLocal, ...cad.biometrias.filter((b) => b.ciclo_id === ciclo.id)]
        .sort((a, b) => (b.data + (b.hora || '')).localeCompare(a.data + (a.hora || '')))
      const r = {
        ...v, ciclo,
        dias: diasEntre(ciclo.data_povoamento, hoje()),
        // total colocado no viveiro = lanço + ração das bandejas
        kgLancoHoje: racaoHoje.reduce((s, l) => s + l.dados.kg, 0),
        kgBandejaHoje: colocacoes.filter((c) => c.data === hoje()).reduce((s, c) => s + (c.kg_bandejas || 0), 0),
        sobraHoje: colocacoes.filter((c) => c.data === hoje() && c.retirada).reduce((s, c) => s + (c.retirada.sobra_kg || 0), 0),
        tratosHoje: racaoHoje.map((l) => l.dados.trato),
        kgTratoHoje: Object.fromEntries(racaoHoje.map((l) => [l.dados.trato, l.dados.kg])),
        bandejaAberta: colocacoes.find((c) => !c.retirada) || null,
        bandejaHoje: colocacoes.find((c) => c.data === hoje()) || null,
        ultimaColocacao: colocacoes[0] || null,
        ultimaBio: bios[0] || null,
        uniformidade: distrib ? { cv: cvClasses(distrib.classes), data: distrib.data } : null,
        plano, planoFuturo,
        ultimoProduto: meus.find((l) => l.tipo === 'racao')?.dados.produto_id || plano?.produto_id || null,
        racaoOntem: meus.filter((l) => l.tipo === 'racao' && l.dados.data === diasAntes(1)).reduce((s, l) => s + l.dados.kg, 0)
          + colocacoes.filter((c) => c.data === diasAntes(1)).reduce((s, c) => s + (c.kg_bandejas || 0), 0),
        bandejaOntem: colocacoes.find((c) => c.data === diasAntes(1)) || null,
        racaoRecente: meus.filter((l) => l.tipo === 'racao').slice(0, 28).map((l) => l.dados.kg),
      }
      r.kgHoje = r.kgLancoHoje + r.kgBandejaHoje
      return r
    })
  }, [cad, lanc])

  const pendentes = lanc.filter((l) => !l.sincronizado).length
  // saldo de estoque = saldo do servidor (até o último carregamento) + o que este aparelho lançou depois
  const produtos = useMemo(() => {
    if (!cad) return []
    const ref = cad.carregado_em || ''
    const conta = (l) => !l.sincronizado || (l.enviado_em || '') > ref
    const base = cad.produtos || []
    const novos = lanc.filter((l) => l.tipo === 'produto' && !base.some((p) => p.id === l.id))
      .map((l) => ({ id: l.id, ...l.dados, saldo: 0 }))
    const delta = {}
    const add = (id, q) => { if (id && q) delta[id] = (delta[id] || 0) + q }
    lanc.filter(conta).forEach(({ tipo, dados: d }) => {
      if (tipo === 'racao') add(d.produto_id, -d.kg)
      else if (tipo === 'colocacao') add(d.produto_id, -d.kg_bandejas)
      else if (tipo === 'insumo') add(d.produto_id, -d.quantidade)
      else if (tipo === 'estoque') add(d.produto_id, d.quantidade)
    })
    return [...base, ...novos].map((p) => ({ ...p, saldo: Math.round((Number(p.saldo || 0) + (delta[p.id] || 0)) * 100) / 100 }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [cad, lanc])
  const racoes = produtos.filter((x) => x.categoria === 'racao')
  const insumos = produtos.filter((x) => x.categoria !== 'racao')
  const gestor = cad?.perfil === 'gestor'

  const salvar = async (tipo, dados, extra, voltar = 'inicio') => {
    if (extra) { // [{tipo, dados, id}] lançados juntos, na ordem
      for (const e of extra) await adicionarLancamento(e.tipo, e.dados, operador, e.id)
    } else await adicionarLancamento(tipo, dados, operador)
    await recarregar()
    setTela(voltar)
    const nome = tipo === 'estoque' ? (dados.tipo === 'entrada' ? 'Entrada de estoque' : 'Ajuste de estoque') : TELA_NOME[tipo]
    setAviso({ tipo: 'ok', texto: `${nome} ${['plano', 'insumo', 'produto', 'estoque'].includes(tipo) && dados?.tipo !== 'entrada' ? 'salvo' : 'salva'} no aparelho` + (online ? '' : ' — envia quando tiver sinal') })
    if (online) sync()
  }

  if (logado === false) return <Login />
  if (!cad || operador === undefined) return <div className="carregando">Carregando…</div>
  if (!operador) return <Entrada onOk={async (n) => { await setOperador(n); setOp(n); setTela('inicio') }} />

  return (
    <div className="app">
      <header className="topo">
        {tela !== 'inicio'
          ? <button className="voltar" onClick={() => setTela('inicio')} aria-label="Voltar">‹</button>
          : <span className="marca">🦐</span>}
        <div className="titulo">
          <strong>{tela === 'inicio' ? 'Coleta de campo' : tela === 'envios' ? 'Lançamentos' : TELA_NOME[tela]}</strong>
          <small>{operador}{gestor && ' · gestor'}{MODO_DEMO && ' · demonstração'}</small>
        </div>
        <button className={`status ${online ? 'on' : 'off'}`} onClick={() => setTela('envios')}>
          <span className="ponto" />{online ? 'Online' : 'Sem sinal'}
          {pendentes > 0 && <b className="badge">{pendentes}</b>}
        </button>
      </header>

      <main>
        {tela === 'inicio' && <Inicio viveiros={viveiros} irPara={setTela} tratos={cad.config.tratos_por_dia} pendentes={pendentes} gestor={gestor} />}
        {tela === 'racao' && <FormRacao viveiros={viveiros} racoes={racoes} tratos={Number(cad.config.tratos_por_dia) || 4} onSalvar={salvar} irCheck={() => setTela('checagem')} />}
        {tela === 'checagem' && <FormChecagem viveiros={viveiros} racoes={racoes} onSalvar={salvar} irTrato={() => setTela('racao')} />}
        {tela === 'insumo' && <FormInsumo viveiros={viveiros} insumos={insumos} onSalvar={salvar} />}
        {tela === 'estoque' && <TelaEstoque produtos={produtos} viveiros={viveiros} gestor={gestor} onSalvar={salvar} />}
        {tela === 'plano' && gestor && <FormPlano viveiros={viveiros} racoes={racoes} tratosPadrao={Number(cad.config.tratos_por_dia) || 4} onSalvar={salvar} />}
        {tela === 'biometria' && <FormBiometria viveiros={viveiros} onSalvar={salvar} />}
        {tela === 'agua' && <FormAgua viveiros={viveiros} params={cad.config.parametros_agua} onSalvar={salvar} />}
        {tela === 'ocorrencia' && <FormOcorrencia viveiros={viveiros} onSalvar={salvar} />}
        {tela === 'envios' && <Envios lanc={lanc} viveiros={viveiros} produtos={produtos} online={online} onSync={sync}
          onExcluir={async (id) => { await excluirLancamento(id); recarregar() }}
          onTrocarOperador={async () => { await setOperador(''); setOp(null) }}
          onResetDemo={async () => { await resetarDemo(); setCad(await carregarCadastro()); recarregar() }} />}
      </main>

      {aviso && <div className={`aviso ${aviso.tipo}`} role="status">{aviso.texto}</div>}
    </div>
  )
}

// ------------------------------------------------------------------
function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [aguarde, setAguarde] = useState(false)
  const entrar = async () => {
    setAguarde(true); setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    if (error) setErro(navigator.onLine ? 'E-mail ou senha incorretos.' : 'Sem internet: o primeiro acesso precisa de sinal.')
    setAguarde(false)
  }
  return (
    <div className="entrada">
      <div className="logo">🦐</div>
      <h1>Coleta de campo</h1>
      <p>Entre uma vez com sinal; depois funciona offline.</p>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" autoComplete="username" />
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" autoComplete="current-password" />
      {erro && <p className="erro-login">{erro}</p>}
      <button className="primario" disabled={aguarde || !email || !senha} onClick={entrar}>{aguarde ? 'Entrando…' : 'Entrar'}</button>
    </div>
  )
}

function Entrada({ onOk }) {
  const [n, setN] = useState('')
  return (
    <div className="entrada">
      <div className="logo">🦐</div>
      <h1>Coleta de campo</h1>
      <p>Quem está lançando neste aparelho?</p>
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Seu nome" autoFocus />
      <button className="primario" disabled={n.trim().length < 2} onClick={() => onOk(n.trim())}>Começar</button>
    </div>
  )
}

function Inicio({ viveiros, irPara, tratos, pendentes, gestor }) {
  return (
    <>
      <div className="acoes">
        <button className="acao racao" onClick={() => irPara('racao')}><span>🍚</span>Ração</button>
        <button className="acao bio" onClick={() => irPara('biometria')}><span>⚖️</span>Biometria</button>
        <button className="acao agua" onClick={() => irPara('agua')}><span>💧</span>Água</button>
        <button className="acao ocor" onClick={() => irPara('ocorrencia')}><span>⚠️</span>Ocorrência</button>
        <button className="acao insumo" onClick={() => irPara('insumo')}><span>🧪</span>Insumos</button>
        {gestor && <button className="acao plano" onClick={() => irPara('plano')}><span>📋</span>Plano de ração</button>}
        <button className={`acao estoque ${gestor ? 'largo' : ''}`} onClick={() => irPara('estoque')}><span>📦</span>Estoque</button>
      </div>
      {pendentes > 0 && <button className="faixa" onClick={() => irPara('envios')}>{pendentes} lançamento(s) aguardando envio</button>}
      <h2 className="secao">Viveiros hoje · {dataBR(hoje())}</h2>
      <div className="viveiros">
        {viveiros.map((v) => (
          <div key={v.id} className={`card ${v.ciclo ? '' : 'vazio'} ${v.dias > 90 ? 'alerta' : ''}`}>
            <div className="card-topo"><b>{v.codigo}</b>{v.ciclo && <span>{v.dias} dias</span>}</div>
            {v.ciclo ? (
              <>
                <div className="linha"><span>Peso</span><b>{v.ultimaBio ? `${fmt(v.ultimaBio.peso_medio_g, 2)} g` : '–'}</b></div>
                {v.uniformidade?.cv != null && (
                  <div className="linha"><span>Uniformidade</span>
                    <b className={v.uniformidade.cv > 30 ? 'cv-ruim' : v.uniformidade.cv <= 20 ? 'cv-boa' : ''}>
                      CV {fmt(v.uniformidade.cv, 0)}% <small>{dataBR(v.uniformidade.data).slice(0, 5)}</small></b></div>
                )}
                <div className="linha"><span>Ração hoje</span><b>{fmt(v.kgHoje, 0)}{v.plano ? ` / ${fmt(v.plano.kg_dia, 0)}` : ''} kg</b></div>
                {v.plano && <div className="progresso"><i style={{ width: `${Math.min(100, (v.kgHoje / v.plano.kg_dia) * 100)}%` }} /></div>}
                <div className="linha"><span>{v.bandejaAberta ? 'Retirar' : 'Bandejas'}</span>
                  {v.bandejaAberta
                    ? <b className="aguardando">~{somaHora(v.bandejaAberta.hora, 60)}</b>
                    : v.bandejaHoje?.retirada
                      ? <b className={`ck-${v.bandejaHoje.retirada.resultado}`}>{RESULT_CK[v.bandejaHoje.retirada.resultado]}</b>
                      : <b className="pendente">a colocar</b>}</div>
                <div className="tratos">
                  {Array.from({ length: v.plano?.tratos?.length || Number(tratos) || 4 }, (_, i) => (
                    <i key={i} className={v.tratosHoje.includes(i + 1) ? 'feito' : ''}>{i + 1}</i>
                  ))}
                </div>
                {v.dias > 90 && <div className="tag">Passou de 90 dias</div>}
              </>
            ) : <div className="linha"><span>Sem ciclo ativo</span></div>}
          </div>
        ))}
      </div>
    </>
  )
}

// ---------- Componentes de formulário ----------
function EscolhaViveiro({ viveiros, valor, onChange, marcados = [] }) {
  const ativos = viveiros.filter((v) => v.ciclo)
  return (
    <fieldset className="campo">
      <legend>Viveiro</legend>
      <div className="chips cols4">
        {ativos.map((v) => (
          <button key={v.id} type="button" className={`${valor === v.id ? 'sel' : ''} ${marcados.includes(v.id) ? 'marcado' : ''}`} onClick={() => onChange(v.id)}>{v.codigo}</button>
        ))}
      </div>
    </fieldset>
  )
}
function CampoDataHora({ data, hora, onData, onHora }) {
  return (
    <div className="duas">
      <label className="campo"><span>Data</span>
        <input type="date" value={data} max={hoje()} onChange={(e) => onData(e.target.value)} />
      </label>
      <label className="campo"><span>Hora</span>
        <input type="time" value={hora} onChange={(e) => onHora(e.target.value)} />
      </label>
    </div>
  )
}
function Alternar({ opcoes, valor, onChange }) {
  return (
    <div className="alternar">
      {opcoes.map(([k, r]) => <button key={k} type="button" className={valor === k ? 'sel' : ''} onClick={() => onChange(k)}>{r}</button>)}
    </div>
  )
}
function CampoNum({ rotulo, valor, onChange, sufixo, grande }) {
  return (
    <label className={`campo ${grande ? 'grande' : ''}`}><span>{rotulo}</span>
      <div className="num">
        <input inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0" />
        {sufixo && <em>{sufixo}</em>}
      </div>
    </label>
  )
}
function Salvar({ pronto, alertas, onSalvar }) {
  const [confirmar, setConfirmar] = useState(false)
  useEffect(() => setConfirmar(false), [alertas.join('|')])
  return (
    <div className="rodape">
      {alertas.length > 0 && (
        <ul className="alertas">{alertas.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
      <button className="primario" disabled={!pronto}
        onClick={() => (alertas.length && !confirmar ? setConfirmar(true) : onSalvar())}>
        {alertas.length && confirmar ? 'Confirmar e salvar' : 'Salvar'}
      </button>
      {alertas.length > 0 && confirmar && <p className="dica">Confira os valores. Toque de novo para salvar mesmo assim.</p>}
    </div>
  )
}

// ---------- Escolha de produto (ração ou insumo) ----------
// Mostra só o que tem saldo em estoque (o escolhido e o previsto aparecem sempre).
function EscolhaProduto({ rotulo, produtos, valor, onChange, sugerido, todos = false }) {
  const [verTodos, setVerTodos] = useState(todos)
  const lista = verTodos ? produtos : produtos.filter((p) => p.saldo > 0 || p.id === valor || p.id === sugerido)
  const ocultos = produtos.length - lista.length
  return (
    <fieldset className="campo"><legend>{rotulo}</legend>
      <div className="lista-opcoes">
        {lista.map((p) => (
          <button key={p.id} type="button" className={valor === p.id ? 'sel' : ''} onClick={() => onChange(p.id)}>
            <span className="nome-prod">{p.nome}{sugerido === p.id && <em>previsto</em>}</span>
            <small className={`saldo ${p.saldo <= 0 ? 'zerado' : p.estoque_minimo != null && p.saldo < p.estoque_minimo ? 'baixo' : ''}`}>
              {p.saldo <= 0 ? 'sem estoque' : `${fq(p.saldo)} ${p.unidade}`}</small>
          </button>
        ))}
        {produtos.length === 0 && <p className="dica esq">Nenhum produto cadastrado. O gestor cadastra em Estoque › Produto.</p>}
        {produtos.length > 0 && lista.length === 0 && <p className="dica esq">Nada em estoque. Peça ao escritório para lançar a entrada.</p>}
        {!todos && ocultos > 0 && <button type="button" className="mais" onClick={() => setVerTodos(true)}>Mostrar {ocultos} sem estoque</button>}
      </div>
    </fieldset>
  )
}
// aviso (não bloqueia) quando o lançamento passa do saldo em estoque
const alertaEstoque = (prod, qtd) => !prod || !(qtd > 0) || qtd <= prod.saldo + 0.001 ? []
  : [`Estoque de ${prod.nome}: ${prod.saldo <= 0 ? 'zerado' : `só ${fq(prod.saldo)} ${prod.unidade}`}. Avise o escritório para lançar a entrada.`]
const nomeProd = (produtos, id) => produtos.find((p) => p.id === id)?.nome || '—'

// ---------- Ração: trato ----------
function FormRacao({ viveiros, racoes, tratos: tratosCfg, onSalvar, irCheck }) {
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [trato, setTrato] = useState(null)
  const [produto, setProduto] = useState(null)
  const [kg, setKg] = useState('')
  const v = viveiros.find((x) => x.id === vid)
  const plano = v?.plano
  const tratos = plano?.tratos?.length || tratosCfg
  const previsto = plano?.tratos?.find((t) => t.trato === trato)?.kg ?? null
  useEffect(() => {
    if (!v) return
    const prox = Array.from({ length: tratos }, (_, i) => i + 1).find((t) => !v.tratosHoje.includes(t))
    setTrato(prox || null)
    setProduto(plano?.produto_id || v.ultimoProduto || racoes[0]?.id || null)
  }, [vid]) // eslint-disable-line
  // preenche com o previsto do trato escolhido
  useEffect(() => { if (previsto != null) setKg(String(previsto).replace('.', ',')); else setKg('') }, [vid, trato]) // eslint-disable-line
  const k = num(kg)
  const alertas = []
  if (v && trato && data === hoje() && v.tratosHoje.includes(trato)) alertas.push(`O trato ${trato} do ${v.codigo} já foi lançado hoje.`)
  if (previsto && k > 0 && Math.abs(k - previsto) / previsto > 0.1) alertas.push(`${fmt(k)} kg é diferente do previsto pelo gestor (${fmt(previsto)} kg).`)
  if (plano?.produto_id && produto && produto !== plano.produto_id) alertas.push(`Ração diferente da prevista (${nomeProd(racoes, plano.produto_id)}).`)
  if (!previsto && v && k > 0 && v.racaoRecente.length >= 3) {
    const media = v.racaoRecente.reduce((s, x) => s + x, 0) / v.racaoRecente.length
    if (k > media * 2.5) alertas.push(`${fmt(k)} kg é bem acima da média dos tratos (${fmt(media)} kg).`)
    if (k < media * 0.3) alertas.push(`${fmt(k)} kg é bem abaixo da média dos tratos (${fmt(media)} kg).`)
  }
  if (k > 500) alertas.push('Valor acima de 500 kg por trato.')
  alertas.push(...alertaEstoque(racoes.find((p) => p.id === produto), k))
  return (
    <div className="form">
      <Alternar opcoes={[['trato', 'Trato (lanço)'], ['check', 'Bandejas']]} valor="trato" onChange={(x) => x === 'check' && irCheck()} />
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      {v && (plano ? (
        <div className="previsto">
          <div><span>Previsto hoje</span><b>{fmt(plano.kg_dia, 1)} kg</b></div>
          <div><span>Colocado</span><b>{fmt(v.kgHoje, 1)} kg</b></div>
          <div><span>Falta</span><b>{fmt(Math.max(0, plano.kg_dia - v.kgHoje), 1)} kg</b></div>
          <small>Colocado = lanço {fmt(v.kgLancoHoje, 1)} kg + bandejas {fmt(v.kgBandejaHoje, 2)} kg{v.sobraHoje > 0 ? ` · sobra nas bandejas ${fmt(v.sobraHoje, 2)} kg` : ''}</small>
          <small>{nomeProd(racoes, plano.produto_id)} · {plano.tratos.map((t) => `${t.trato}º ${fmt(t.kg)}`).join(' · ')}</small>
          {plano.observacao && <small className="obs">Gestor: {plano.observacao}</small>}
        </div>
      ) : <p className="dica esq aviso-sem-plano">Sem plano do gestor para este viveiro.</p>)}
      <fieldset className="campo"><legend>Trato</legend>
        <div className="chips">
          {Array.from({ length: tratos }, (_, i) => i + 1).map((t) => (
            <button key={t} type="button" className={`${trato === t ? 'sel' : ''} ${v?.tratosHoje.includes(t) && data === hoje() ? 'feito' : ''}`} onClick={() => setTrato(t)}>{t}º</button>
          ))}
        </div>
      </fieldset>
      <CampoNum rotulo={previsto != null ? `Ração a lanço (previsto ${fmt(previsto)} kg)` : 'Ração a lanço'} valor={kg} onChange={setKg} sufixo="kg" grande />
      <EscolhaProduto rotulo="Ração" produtos={racoes} valor={produto} onChange={setProduto} sugerido={plano?.produto_id} />
      <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      <Salvar pronto={v && trato && produto && k > 0 && k <= 500 && hora} alertas={alertas}
        onSalvar={() => onSalvar('racao', { ciclo_id: v.ciclo.id, data, hora, trato, produto_id: produto, kg: k })} />
    </div>
  )
}

// ---------- Bandejas: colocação e retirada (podem ser pessoas diferentes) ----------
const classificar = (sobra, colocado) => {
  if (!sobra) return 'zerou'
  if (!colocado) return 'pouca_sobra'
  return sobra / colocado <= 0.2 ? 'pouca_sobra' : 'muita_sobra'
}
function FormChecagem({ viveiros, racoes, onSalvar, irTrato }) {
  const [produto, setProduto] = useState(null)
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [colocado, setColocado] = useState('')
  const [sobra, setSobra] = useState('')
  const [manual, setManual] = useState(false)       // colocação não aparece no aparelho
  const [horaCol, setHoraCol] = useState('')
  const v = viveiros.find((x) => x.id === vid)
  const aberta = v?.bandejaAberta
  const modo = !v ? null : aberta ? 'retirada' : manual ? 'ambas' : 'colocacao'
  useEffect(() => {
    setManual(false); setSobra(''); setHora(agora()); setHoraCol('')
    if (v?.ultimaColocacao?.kg_bandejas) setColocado(String(v.ultimaColocacao.kg_bandejas).replace('.', ','))
    setProduto(v?.plano?.produto_id || v?.ultimoProduto || racoes[0]?.id || null)
  }, [vid]) // eslint-disable-line

  const c = aberta ? aberta.kg_bandejas : num(colocado)
  const s = num(sobra)
  const validoC = c > 0, validoS = s != null && !Number.isNaN(s) && s >= 0
  const resultado = validoC && validoS ? classificar(s, c) : null
  const inicio = aberta ? { data: aberta.data, hora: aberta.hora } : manual && horaCol ? { data, hora: horaCol } : null
  const intervalo = inicio && hora ? Math.round((new Date(`${data}T${hora}:00`) - new Date(`${inicio.data}T${inicio.hora}:00`)) / 60000) : null

  const alertas = []
  if (modo === 'colocacao' && v.bandejaHoje && data === hoje()) alertas.push(`O ${v.codigo} já teve bandejas colocadas hoje às ${v.bandejaHoje.hora}.`)
  if (modo === 'colocacao' || modo === 'ambas') alertas.push(...alertaEstoque(racoes.find((p) => p.id === produto), c))
  if (modo !== 'colocacao') {
    if (validoC && validoS && s > c) alertas.push(`Sobra (${fmt(s, 2)} kg) maior que o colocado (${fmt(c, 2)} kg).`)
    if (intervalo != null && intervalo < 0) alertas.push('A hora da retirada está antes da colocação.')
    else if (intervalo != null && intervalo < 40) alertas.push(`Só ${duracao(intervalo)} desde a colocação — o normal é cerca de 1 hora.`)
    else if (intervalo != null && intervalo > 180) alertas.push(`${duracao(intervalo)} desde a colocação — bem mais que 1 hora.`)
    if (resultado === 'muita_sobra' && s <= c) alertas.push('Sobra acima de 20% do colocado: avisar o responsável para reduzir a ração.')
    if (resultado === 'zerou') alertas.push('Bandejas zeradas: avisar o responsável, pode ser hora de aumentar a ração.')
  }

  const salvar = () => {
    if (modo === 'colocacao') return onSalvar('colocacao', { ciclo_id: v.ciclo.id, data, hora, kg_bandejas: c, produto_id: produto })
    if (modo === 'retirada') return onSalvar('retirada', { colocacao_id: aberta.id, ciclo_id: v.ciclo.id, data, hora, sobra_kg: s, resultado })
    const idCol = uuid()
    return onSalvar('retirada', null, [
      { tipo: 'colocacao', id: idCol, dados: { ciclo_id: v.ciclo.id, data, hora: horaCol, kg_bandejas: c, produto_id: produto } },
      { tipo: 'retirada', dados: { colocacao_id: idCol, ciclo_id: v.ciclo.id, data, hora, sobra_kg: s, resultado } },
    ])
  }
  const pronto = v && hora && validoC && (modo === 'colocacao' || (validoS && (modo !== 'ambas' || horaCol)))

  return (
    <div className="form">
      <Alternar opcoes={[['trato', 'Trato (lanço)'], ['check', 'Bandejas']]} valor="check" onChange={(x) => x === 'trato' && irTrato()} />
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} marcados={viveiros.filter((x) => x.bandejaAberta).map((x) => x.id)} />
      {!v && <p className="dica esq">Viveiros com • têm bandejas colocadas aguardando retirada.</p>}

      {modo === 'colocacao' && (<>
        <div className="etapa"><b>1 · Colocação</b><span>Ração de teste colocada nas bandejas</span></div>
        <CampoNum rotulo="Ração colocada nas bandejas" valor={colocado} onChange={setColocado} sufixo="kg" grande />
        <EscolhaProduto rotulo="Ração" produtos={racoes} valor={produto} onChange={setProduto} sugerido={v.plano?.produto_id} />
        <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
        {hora && <p className="dica esq">Retirada prevista por volta de <b>{somaHora(hora, 60)}</b>.</p>}
        <button type="button" className="mais" onClick={() => setManual(true)}>Já foi colocado e não aparece aqui? Lançar colocação e retirada juntas</button>
      </>)}

      {modo === 'retirada' && (
        <div className="etapa aberta"><b>2 · Retirada</b>
          <span>Colocado {fmt(aberta.kg_bandejas, 2)} kg às {aberta.hora}{aberta.data !== hoje() ? ` de ${dataBR(aberta.data)}` : ''}{aberta.lancado_por ? ` por ${aberta.lancado_por}` : ''}</span>
          <small>há {duracao(Math.max(0, minDesde(aberta.data, aberta.hora)))}</small>
        </div>
      )}
      {modo === 'ambas' && (<>
        <div className="etapa"><b>Colocação + retirada</b><span>Use só quando a colocação não foi lançada ou não chegou neste aparelho.</span></div>
        <div className="duas">
          <CampoNum rotulo="Colocado nas bandejas" valor={colocado} onChange={setColocado} sufixo="kg" />
          <label className="campo"><span>Hora da colocação</span>
            <input type="time" value={horaCol} onChange={(e) => setHoraCol(e.target.value)} /></label>
        </div>
      </>)}
      {(modo === 'retirada' || modo === 'ambas') && (<>
        <CampoNum rotulo="Sobra pesada — soma de todas as bandejas" valor={sobra} onChange={setSobra} sufixo="kg" grande />
        <button type="button" className="mais" onClick={() => setSobra('0')}>Bandejas zeradas (0 kg)</button>
        {resultado && (
          <div className={`resultado ck-${resultado}`}>
            <span>{RESULT_CK[resultado]}</span>
            <b>{fmt(c > 0 ? (Math.max(0, c - s) / c) * 100 : 0, 0)}%</b>
            <small>consumido · sobra de {fmt(s, 2)} kg de {fmt(c, 2)} kg{intervalo != null && intervalo >= 0 ? ` em ${duracao(intervalo)}` : ''}</small>
          </div>
        )}
        <label className="campo"><span>{modo === 'ambas' ? 'Data e hora da retirada' : 'Hora da retirada'}</span></label>
        <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      </>)}
      {v && <Salvar pronto={pronto} alertas={alertas} onSalvar={salvar} />}
    </div>
  )
}

// ---------- Biometria (simples ou por tamanho) ----------
function FormBiometria({ viveiros, onSalvar }) {
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [modo, setModo] = useState('simples')
  const [n, setN] = useState('100')
  const [total, setTotal] = useState('')
  const [classes, setClasses] = useState([]) // [{g, qtd:''}]
  const v = viveiros.find((x) => x.id === vid)

  // monta as classes em torno do último peso (±4 g)
  useEffect(() => {
    const base = Math.max(1, Math.round(v?.ultimaBio?.peso_medio_g || 6))
    const ini = Math.max(1, base - 4)
    setClasses(Array.from({ length: 9 }, (_, i) => ({ g: ini + i, qtd: '' })))
  }, [vid]) // eslint-disable-line
  const addClasse = (lado) => setClasses((cs) => {
    if (!cs.length) return [{ g: 1, qtd: '' }]
    if (lado === 'menor') return cs[0].g > 1 ? [{ g: cs[0].g - 1, qtd: '' }, ...cs] : cs
    return [...cs, { g: cs[cs.length - 1].g + 1, qtd: '' }]
  })

  let nn, tt, medio = null, cv = null
  if (modo === 'simples') {
    nn = num(n); tt = num(total); medio = nn > 0 && tt > 0 ? tt / nn : null
  } else {
    const cl = classes.map((c) => ({ g: c.g, qtd: num(c.qtd) || 0 })).filter((c) => c.qtd > 0)
    nn = cl.reduce((s, c) => s + c.qtd, 0); tt = cl.reduce((s, c) => s + c.g * c.qtd, 0)
    if (nn > 0) {
      medio = tt / nn
      const varc = cl.reduce((s, c) => s + c.qtd * (c.g - medio) ** 2, 0) / nn
      cv = medio ? (Math.sqrt(varc) / medio) * 100 : null
    }
  }
  const maxQtd = Math.max(1, ...classes.map((c) => num(c.qtd) || 0))
  const alertas = []
  if (nn > 0 && nn < 30) alertas.push('Amostra pequena: o ideal é pesar pelo menos 30 camarões.')
  if (modo === 'simples' && v?.ultimaBio && medio) {
    const ant = v.ultimaBio.peso_medio_g
    const dias = Math.max(1, diasEntre(v.ultimaBio.data, data))
    if (medio < ant * 0.95) alertas.push(`Peso menor que a última biometria (${fmt(ant, 2)} g em ${dataBR(v.ultimaBio.data)}).`)
    const semanal = ((medio - ant) / dias) * 7
    if (semanal > 3) alertas.push(`Ganho de ${fmt(semanal, 2)} g/semana parece alto demais.`)
  }
  if (medio && medio > 45) alertas.push('Peso médio acima de 45 g — confira se o peso está em gramas.')
  if (cv != null && cv > 30) alertas.push(`Lote desuniforme (CV ${fmt(cv, 0)}%).`)

  const dados = () => modo === 'simples'
    ? { ciclo_id: v.ciclo.id, data, hora, tipo: 'simples', n_amostra: nn, peso_total_g: tt }
    : { ciclo_id: v.ciclo.id, data, hora, tipo: 'classes', n_amostra: nn, peso_total_g: tt,
        classes: classes.map((c) => ({ g: c.g, qtd: num(c.qtd) || 0 })).filter((c) => c.qtd > 0) }

  return (
    <div className="form">
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      <Alternar opcoes={[['simples', 'Peso total'], ['classes', 'Por tamanho']]} valor={modo} onChange={setModo} />
      {modo === 'simples' ? (
        <div className="duas">
          <CampoNum rotulo="Camarões pesados" valor={n} onChange={setN} sufixo="un" />
          <CampoNum rotulo="Peso total" valor={total} onChange={setTotal} sufixo="g" />
        </div>
      ) : (
        <fieldset className="campo"><legend>Quantidade em cada tamanho</legend>
          <button type="button" className="mais" onClick={() => addClasse('menor')}>+ tamanho menor</button>
          <div className="classes">
            {classes.map((c, i) => {
              const q = num(c.qtd) || 0
              return (
                <label key={c.g} className="classe">
                  <span className="g">{c.g} g</span>
                  <div className="barra"><i style={{ width: `${(q / maxQtd) * 100}%` }} /></div>
                  <input inputMode="numeric" value={c.qtd} placeholder="0"
                    onChange={(e) => { const val = e.target.value.replace(/\D/g, ''); setClasses((cs) => cs.map((x, j) => (j === i ? { ...x, qtd: val } : x))) }} />
                </label>
              )
            })}
          </div>
          <button type="button" className="mais" onClick={() => addClasse('maior')}>+ tamanho maior</button>
        </fieldset>
      )}
      <div className="resultado">
        <span>{modo === 'classes' ? 'Média da amostra' : 'Peso médio'}</span><b>{medio ? `${fmt(medio, 2)} g` : '–'}</b>
        {modo === 'classes' && <small className="info">Só para ver a distribuição — o peso do viveiro é a biometria por peso total.</small>}
        {modo === 'classes' && nn > 0 && <small>{nn} camarões · uniformidade: CV {fmt(cv, 0)}%</small>}
        {v?.ultimaBio && <small>Anterior: {fmt(v.ultimaBio.peso_medio_g, 2)} g em {dataBR(v.ultimaBio.data)}</small>}
      </div>
      <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      <Salvar pronto={v && nn > 0 && tt > 0 && hora} alertas={alertas} onSalvar={() => onSalvar('biometria', dados())} />
    </div>
  )
}

// ---------- Água ----------
function FormAgua({ viveiros, params, onSalvar }) {
  const lista = (params?.length ? params : Object.keys(PARAMS)).filter((p) => PARAMS[p])
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [val, setVal] = useState({})
  const v = viveiros.find((x) => x.id === vid)
  const nums = Object.fromEntries(lista.map((p) => [p, num(val[p])]))
  const preenchidos = lista.filter((p) => nums[p] != null)
  const invalidos = preenchidos.filter((p) => Number.isNaN(nums[p]) || nums[p] < PARAMS[p].min || nums[p] > PARAMS[p].max)
  const alertas = []
  if (nums.od != null && nums.od < 3) alertas.push(`Oxigênio baixo (${fmt(nums.od)} mg/L): avisar o responsável e ligar aeração.`)
  if (nums.ph != null && (nums.ph < 7 || nums.ph > 9.5)) alertas.push(`pH ${fmt(nums.ph)} fora da faixa 7,0–9,5.`)
  if (nums.temperatura != null && nums.temperatura > 33) alertas.push(`Temperatura alta (${fmt(nums.temperatura)} °C).`)
  invalidos.forEach((p) => alertas.push(`${PARAMS[p].rotulo}: valor fora do possível.`))
  return (
    <div className="form">
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      <div className="duas">
        {lista.map((p) => (
          <CampoNum key={p} rotulo={PARAMS[p].rotulo} valor={val[p] || ''} onChange={(x) => setVal({ ...val, [p]: x })} />
        ))}
      </div>
      <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      <Salvar pronto={v && hora && preenchidos.length > 0 && invalidos.length === 0} alertas={alertas}
        onSalvar={() => onSalvar('agua', { ciclo_id: v.ciclo.id, data, hora, ...Object.fromEntries(preenchidos.map((p) => [p, nums[p]])) })} />
    </div>
  )
}

// ---------- Ocorrência ----------
function FormOcorrencia({ viveiros, onSalvar }) {
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [tipo, setTipo] = useState('mortalidade')
  const [qtd, setQtd] = useState('')
  const [desc, setDesc] = useState('')
  const v = viveiros.find((x) => x.id === vid)
  const q = num(qtd)
  const pronto = v && hora && (tipo === 'mortalidade' ? q > 0 : desc.trim().length > 2)
  return (
    <div className="form">
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      <fieldset className="campo"><legend>Tipo</legend>
        <div className="chips cols2">
          {Object.entries(TIPOS_OC).map(([k, r]) => (
            <button key={k} type="button" className={tipo === k ? 'sel' : ''} onClick={() => setTipo(k)}>{r}</button>
          ))}
        </div>
      </fieldset>
      {tipo === 'mortalidade' && <CampoNum rotulo="Camarões mortos (estimativa)" valor={qtd} onChange={setQtd} sufixo="un" grande />}
      <label className="campo"><span>Observação</span>
        <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="O que foi visto" />
      </label>
      <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      <Salvar pronto={pronto} alertas={[]}
        onSalvar={() => onSalvar('ocorrencia', { ciclo_id: v.ciclo.id, data, hora, tipo, quantidade: tipo === 'mortalidade' ? q : null, descricao: desc.trim() || null })} />
    </div>
  )
}

// ---------- Insumos (fertilizante, calcário, probiótico...) ----------
function FormInsumo({ viveiros, insumos, onSalvar }) {
  const [vid, setVid] = useState(null)
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState(agora())
  const [cat, setCat] = useState(null)
  const [produto, setProduto] = useState(null)
  const [qtd, setQtd] = useState('')
  const [obs, setObs] = useState('')
  const v = viveiros.find((x) => x.id === vid)
  const cats = Object.keys(CAT_INSUMO).filter((c) => insumos.some((p) => p.categoria === c))
  const lista = insumos.filter((p) => !cat || p.categoria === cat)
  const prod = insumos.find((p) => p.id === produto)
  const q = num(qtd)
  return (
    <div className="form">
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      <fieldset className="campo"><legend>Tipo</legend>
        <div className="chips cols2">
          {cats.map((c) => <button key={c} type="button" className={cat === c ? 'sel' : ''} onClick={() => { setCat(c); setProduto(null) }}>{CAT_INSUMO[c]}</button>)}
        </div>
      </fieldset>
      {cat && <EscolhaProduto rotulo="Produto" produtos={lista} valor={produto} onChange={setProduto} />}
      {prod && <CampoNum rotulo="Quantidade aplicada" valor={qtd} onChange={setQtd} sufixo={prod.unidade} grande />}
      <label className="campo"><span>Observação</span>
        <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
      </label>
      <CampoDataHora data={data} hora={hora} onData={setData} onHora={setHora} />
      <Salvar pronto={v && prod && q > 0 && hora} alertas={alertaEstoque(prod, q)}
        onSalvar={() => onSalvar('insumo', { ciclo_id: v.ciclo.id, data, hora, produto_id: produto, quantidade: q, observacao: obs.trim() || null })} />
    </div>
  )
}

// ---------- Plano de ração (gestor) ----------
function FormPlano({ viveiros, racoes, tratosPadrao, onSalvar }) {
  const [vid, setVid] = useState(null)
  const [inicio, setInicio] = useState(hoje())
  const [produto, setProduto] = useState(null)
  const [kgDia, setKgDia] = useState('')
  const [nTratos, setNTratos] = useState(tratosPadrao)
  const [dist, setDist] = useState([]) // kg por trato (texto)
  const [manual, setManual] = useState(false)
  const [obs, setObs] = useState('')
  const v = viveiros.find((x) => x.id === vid)
  const atual = v?.plano
  useEffect(() => {
    if (!v) return
    setProduto(atual?.produto_id || v.ultimoProduto || racoes[0]?.id || null)
    setKgDia(atual ? String(atual.kg_dia).replace('.', ',') : '')
    setNTratos(atual?.tratos?.length || tratosPadrao)
    setManual(false); setObs('')
  }, [vid]) // eslint-disable-line
  const kd = num(kgDia)
  // divisão igual entre os tratos, a não ser que o gestor edite à mão
  useEffect(() => {
    if (manual) return
    const each = kd > 0 ? Math.round((kd / nTratos) * 10) / 10 : ''
    setDist(Array.from({ length: nTratos }, () => (each === '' ? '' : String(each).replace('.', ','))))
  }, [kgDia, nTratos, manual]) // eslint-disable-line
  const somaDist = dist.reduce((s, x) => s + (num(x) || 0), 0)
  const ajustar = (pct) => { if (atual) { setManual(false); setKgDia(String(Math.round(atual.kg_dia * (1 + pct / 100) * 10) / 10).replace('.', ',')) } }
  const alertas = []
  if (kd > 0 && manual && Math.abs(somaDist - kd) > 0.05) alertas.push(`A soma dos tratos (${fmt(somaDist)} kg) é diferente do total do dia (${fmt(kd)} kg).`)
  if (atual && kd > 0 && Math.abs(kd - atual.kg_dia) / atual.kg_dia > 0.3) alertas.push(`Mudança de ${fmt(((kd - atual.kg_dia) / atual.kg_dia) * 100, 0)}% em relação ao plano atual.`)
  const ck = v?.bandejaHoje?.retirada || v?.bandejaOntem?.retirada
  const racaoSel = racoes.find((p) => p.id === produto)
  // quantos dias o estoque dessa ração dura com os planos atuais (este viveiro com o novo kg/dia)
  const usoDia = viveiros.filter((x) => x.id !== vid && x.plano?.produto_id === produto).reduce((s, x) => s + x.plano.kg_dia, 0) + (kd > 0 ? kd : 0)
  if (racaoSel && racaoSel.saldo <= 0) alertas.push(`${racaoSel.nome} está sem estoque.`)
  return (
    <div className="form">
      <EscolhaViveiro viveiros={viveiros} valor={vid} onChange={setVid} />
      {v && (
        <div className="contexto">
          <div><span>Cultivo</span><b>{v.dias} dias</b></div>
          <div><span>Peso</span><b>{v.ultimaBio ? `${fmt(v.ultimaBio.peso_medio_g, 2)} g` : '–'}</b></div>
          <div><span>Plano atual</span><b>{atual ? `${fmt(atual.kg_dia)} kg/dia` : '—'}</b></div>
          <div><span>Colocado ontem</span><b>{fmt(v.racaoOntem)} kg</b></div>
          <div><span>Colocado hoje</span><b>{fmt(v.kgHoje)} kg</b></div>
          <div><span>Bandejas</span><b className={ck ? `ck-${ck.resultado}` : ''}>{ck ? `${RESULT_CK[ck.resultado]}${v.bandejaHoje?.retirada ? ' (hoje)' : ' (ontem)'}` : '—'}</b></div>
          {v.planoFuturo && <small>Já existe plano a partir de {dataBR(v.planoFuturo.data_inicio)}: {fmt(v.planoFuturo.kg_dia)} kg/dia</small>}
        </div>
      )}
      {v && (<>
        <CampoNum rotulo="Ração prevista por dia" valor={kgDia} onChange={(x) => { setManual(false); setKgDia(x) }} sufixo="kg" grande />
        {atual && (
          <div className="ajustes">
            {[-10, -5, 5, 10].map((p) => <button key={p} type="button" onClick={() => ajustar(p)}>{p > 0 ? '+' : ''}{p}%</button>)}
          </div>
        )}
        <fieldset className="campo"><legend>Tratos por dia</legend>
          <div className="chips">
            {[2, 3, 4, 5, 6].map((n) => <button key={n} type="button" className={nTratos === n ? 'sel' : ''} onClick={() => { setManual(false); setNTratos(n) }}>{n}</button>)}
          </div>
        </fieldset>
        <fieldset className="campo"><legend>Divisão por trato {manual ? '(editada)' : '(igual)'}</legend>
          <div className="dist">
            {dist.map((x, i) => (
              <label key={i}><span>{i + 1}º</span>
                <input inputMode="decimal" value={x} onChange={(e) => { setManual(true); const val = e.target.value.replace(/[^\d,.]/g, ''); setDist((d) => d.map((y, j) => (j === i ? val : y))) }} />
              </label>
            ))}
          </div>
          {manual && <small className="info">Soma: {fmt(somaDist)} kg</small>}
        </fieldset>
        <EscolhaProduto rotulo="Ração" produtos={racoes} valor={produto} onChange={setProduto} />
        {racaoSel && racaoSel.saldo > 0 && usoDia > 0 && (
          <p className="dica esq">Estoque de {racaoSel.nome}: {fq(racaoSel.saldo)} kg — dá para ~{fmt(racaoSel.saldo / usoDia, 0)} dias com os planos atuais.</p>
        )}
        <label className="campo"><span>Vale a partir de</span>
          <input type="date" value={inicio} min={hoje()} onChange={(e) => setInicio(e.target.value)} /></label>
        <label className="campo"><span>Recado para o arraçoador</span>
          <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" /></label>
      </>)}
      {v && <Salvar pronto={v && kd > 0 && produto && dist.every((x) => num(x) > 0)} alertas={alertas}
        onSalvar={() => onSalvar('plano', {
          ciclo_id: v.ciclo.id, data_inicio: inicio, produto_id: produto, kg_dia: manual ? Math.round(somaDist * 100) / 100 : kd,
          tratos: dist.map((x, i) => ({ trato: i + 1, kg: num(x) })), observacao: obs.trim() || null,
        })} />}
    </div>
  )
}

// ---------- Lançamentos / envio ----------
function Envios({ lanc, viveiros, produtos, online, onSync, onExcluir, onTrocarOperador, onResetDemo }) {
  const [enviando, setEnviando] = useState(false)
  const nomeViveiro = (cid) => viveiros.find((v) => v.ciclo?.id === cid)?.codigo || '?'
  const resumo = (l) => {
    const d = l.dados
    if (l.tipo === 'estoque') { const pr = produtos.find((x) => x.id === d.produto_id); return `${d.tipo === 'entrada' ? 'entrada' : 'ajuste'} ${d.quantidade > 0 ? '+' : ''}${fq(d.quantidade)} ${pr?.unidade || ''}${d.documento ? ` · ${d.documento}` : ''}` }
    if (l.tipo === 'produto') return `${CAT_PRODUTO[d.categoria]} · ${d.unidade}`
    if (l.tipo === 'racao') return `${d.trato}º trato · ${fmt(d.kg)} kg · ${nomeProd(produtos, d.produto_id)}`
    if (l.tipo === 'plano') return `${fmt(d.kg_dia)} kg/dia em ${d.tratos.length} tratos · a partir de ${dataBR(d.data_inicio)}`
    if (l.tipo === 'insumo') { const pr = produtos.find((x) => x.id === d.produto_id); return `${pr?.nome || '—'} · ${fmt(d.quantidade)} ${pr?.unidade || ''}` }
    if (l.tipo === 'colocacao') return `colocou ${fmt(d.kg_bandejas, 2)} kg nas bandejas`
    if (l.tipo === 'retirada') return `sobra ${fmt(d.sobra_kg, 2)} kg · ${RESULT_CK[d.resultado]}`
    if (l.tipo === 'biometria') return `${d.tipo === 'classes' ? 'por tamanho · ' : ''}${d.n_amostra} un · ${fmt(d.peso_total_g / d.n_amostra, 2)} g`
    if (l.tipo === 'agua') return Object.keys(PARAMS).filter((p) => d[p] != null).map((p) => `${p === 'temperatura' ? 'T' : p === 'transparencia' ? 'Transp' : p === 'ph' ? 'pH' : p === 'od' ? 'OD' : 'Sal'} ${fmt(d[p])}`).join(' · ')
    return `${TIPOS_OC[d.tipo]}${d.quantidade ? ` · ${d.quantidade} un` : ''}`
  }
  const pend = lanc.filter((l) => !l.sincronizado).length
  return (
    <div className="form">
      <div className="resultado">
        <span>{pend ? `${pend} aguardando envio` : 'Tudo enviado'}</span>
        <button className="primario" disabled={!online || !pend || enviando}
          onClick={async () => { setEnviando(true); await onSync(); setEnviando(false) }}>
          {enviando ? 'Enviando…' : online ? 'Enviar agora' : 'Sem sinal'}
        </button>
      </div>
      <ul className="historico">
        {lanc.length === 0 && <li className="vazio">Nenhum lançamento ainda.</li>}
        {lanc.map((l) => (
          <li key={l.id}>
            <span className={`ic ${l.tipo}`}>{{ estoque: '📦', produto: '🏷️', plano: '📋', insumo: '🧪', racao: '🍚', colocacao: '⬇️', retirada: '⬆️', biometria: '⚖️', agua: '💧', ocorrencia: '⚠️' }[l.tipo]}</span>
            <div><b>{l.tipo === 'produto' ? `Novo produto · ${l.dados.nome}` : l.tipo === 'estoque' ? `Estoque · ${nomeProd(produtos, l.dados.produto_id)}` : `${nomeViveiro(l.dados.ciclo_id)} · ${TELA_NOME[l.tipo]}`}</b>
              <small>{l.dados.data ? `${dataBR(l.dados.data)}${l.dados.hora ? ` ${l.dados.hora}` : ''}` : `definido ${dataBR(l.criado_em.slice(0, 10))}`} · {resumo(l)}</small></div>
            {l.sincronizado ? <em className="ok">✓</em>
              : <button className="excluir" onClick={() => onExcluir(l.id)} aria-label="Excluir">Excluir</button>}
          </li>
        ))}
      </ul>
      <p className="dica">Depois de enviado, a correção é feita no escritório.</p>
      <div className="links">
        <button onClick={onTrocarOperador}>Trocar usuário</button>
        {MODO_DEMO && <button onClick={onResetDemo}>Zerar demonstração</button>}
      </div>
    </div>
  )
}

// ---------- Estoque: saldo (todos) · entrada, contagem e produto (gestor) ----------
function TelaEstoque({ produtos, viveiros, gestor, onSalvar }) {
  const [aba, setAba] = useState('saldo')
  const salvar = async (tipo, dados) => { await onSalvar(tipo, dados, null, 'estoque'); setAba('saldo') }
  const abas = [['saldo', 'Saldo'], ...(gestor ? [['entrada', 'Entrada'], ['ajuste', 'Contagem'], ['produto', 'Produto']] : [])]
  return (
    <div className="form">
      {abas.length > 1 && <Alternar opcoes={abas} valor={aba} onChange={setAba} />}
      {aba === 'saldo' && <SaldoEstoque produtos={produtos} viveiros={viveiros} gestor={gestor} />}
      {aba === 'entrada' && <FormEntrada key="e" produtos={produtos} onSalvar={salvar} />}
      {aba === 'ajuste' && <FormAjuste key="a" produtos={produtos} onSalvar={salvar} />}
      {aba === 'produto' && <FormProduto produtos={produtos} onSalvar={(d) => salvar('produto', d)} />}
    </div>
  )
}

function SaldoEstoque({ produtos, viveiros, gestor }) {
  // consumo previsto por dia de cada ração = soma dos planos vigentes que a usam
  const usoDia = {}
  viveiros.forEach((v) => { if (v.plano?.produto_id) usoDia[v.plano.produto_id] = (usoDia[v.plano.produto_id] || 0) + v.plano.kg_dia })
  const grupos = Object.entries(CAT_PRODUTO).map(([c, nome]) => [nome, produtos.filter((p) => p.categoria === c)]).filter(([, l]) => l.length)
  if (!produtos.length) return <p className="dica">Nenhum produto cadastrado.{gestor ? ' Cadastre em “Produto”.' : ' O gestor cadastra os produtos.'}</p>
  return (<>
    {grupos.map(([nome, lista]) => (
      <section key={nome}>
        <h2 className="secao">{nome}</h2>
        <ul className="estoque">
          {lista.map((p) => {
            const baixo = p.estoque_minimo != null && p.saldo < p.estoque_minimo
            const dias = usoDia[p.id] && p.saldo > 0 ? p.saldo / usoDia[p.id] : null
            return (
              <li key={p.id} className={p.saldo <= 0 ? 'zerado' : baixo ? 'baixo' : ''}>
                <div><b>{p.nome}</b>
                  <small>{p.saldo <= 0 ? 'Sem estoque' : baixo ? `Abaixo do mínimo (${fq(p.estoque_minimo)} ${p.unidade})` : dias != null ? `~${fmt(dias, 0)} dias pelo plano de ração` : p.estoque_minimo != null ? `Mínimo ${fq(p.estoque_minimo)} ${p.unidade}` : ' '}
                    {(p.saldo <= 0 || baixo) && dias != null ? ` · ~${fmt(dias, 0)} dias pelo plano` : ''}</small></div>
                <strong>{fq(p.saldo)} <em>{p.unidade}</em></strong>
              </li>
            )
          })}
        </ul>
      </section>
    ))}
    <p className="dica">O consumo sai sozinho do estoque a cada trato, bandeja colocada e insumo aplicado. Entradas e contagens são lançadas pelo gestor.</p>
  </>)
}

function FormEntrada({ produtos, onSalvar }) {
  const [produto, setProduto] = useState(null)
  const [data, setData] = useState(hoje())
  const [modo, setModo] = useState('kg')       // kg direto ou em sacos
  const [qtd, setQtd] = useState('')
  const [kgSaco, setKgSaco] = useState('25')
  const [doc, setDoc] = useState('')
  const [obs, setObs] = useState('')
  const prod = produtos.find((p) => p.id === produto)
  const emSacos = prod?.unidade === 'kg' && modo === 'sacos'
  const q = emSacos ? (num(qtd) || 0) * (num(kgSaco) || 0) : num(qtd)
  const alertas = []
  if (prod && prod.unidade === 'kg' && q > 50000) alertas.push(`${fq(q)} kg é uma entrada muito grande — confira.`)
  return (<>
    <EscolhaProduto rotulo="Produto recebido" produtos={produtos} valor={produto} onChange={setProduto} todos />
    {prod && (<>
      {prod.unidade === 'kg' && <Alternar opcoes={[['kg', 'Em kg'], ['sacos', 'Em sacos']]} valor={modo} onChange={setModo} />}
      {emSacos ? (
        <div className="duas">
          <CampoNum rotulo="Sacos" valor={qtd} onChange={setQtd} sufixo="sc" grande />
          <CampoNum rotulo="kg por saco" valor={kgSaco} onChange={setKgSaco} sufixo="kg" grande />
        </div>
      ) : <CampoNum rotulo="Quantidade recebida" valor={qtd} onChange={setQtd} sufixo={prod.unidade} grande />}
      <div className="resultado"><span>Saldo depois da entrada</span><b>{fq(prod.saldo + (q > 0 ? q : 0))} {prod.unidade}</b>
        {emSacos && q > 0 && <small>{fq(q)} kg recebidos</small>}</div>
      <label className="campo"><span>Data do recebimento</span>
        <input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value)} /></label>
      <label className="campo"><span>Nota fiscal / fornecedor</span>
        <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Opcional" /></label>
      <label className="campo"><span>Observação</span>
        <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" /></label>
    </>)}
    <Salvar pronto={prod && q > 0 && data} alertas={alertas}
      onSalvar={() => onSalvar('estoque', { produto_id: produto, data, tipo: 'entrada', quantidade: Math.round(q * 100) / 100, documento: doc.trim() || null, observacao: obs.trim() || null })} />
  </>)
}

function FormAjuste({ produtos, onSalvar }) {
  const [produto, setProduto] = useState(null)
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const prod = produtos.find((p) => p.id === produto)
  const c = num(contado)
  const dif = prod && c != null && !Number.isNaN(c) && c >= 0 ? Math.round((c - prod.saldo) * 100) / 100 : null
  const alertas = []
  if (dif && prod.saldo > 0 && Math.abs(dif) / prod.saldo > 0.2) alertas.push(`Diferença de ${fmt((dif / prod.saldo) * 100, 0)}% em relação ao sistema — confira a contagem.`)
  return (<>
    <p className="dica esq">Conte o que há no depósito e lance aqui. O sistema acerta o saldo pela diferença.</p>
    <EscolhaProduto rotulo="Produto contado" produtos={produtos} valor={produto} onChange={setProduto} todos />
    {prod && (<>
      <CampoNum rotulo="Quantidade contada no depósito" valor={contado} onChange={setContado} sufixo={prod.unidade} grande />
      <div className="resultado"><span>No sistema</span><b>{fq(prod.saldo)} {prod.unidade}</b>
        {dif != null && <small>{dif === 0 ? 'Contagem bate com o sistema.' : `Ajuste de ${dif > 0 ? '+' : ''}${fq(dif)} ${prod.unidade}`}</small>}</div>
      <label className="campo"><span>Motivo / observação</span>
        <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: inventário do mês, saco rasgado" /></label>
    </>)}
    <Salvar pronto={prod && dif != null && dif !== 0} alertas={alertas}
      onSalvar={() => onSalvar('estoque', { produto_id: produto, data: hoje(), tipo: 'ajuste', quantidade: dif,
        observacao: [`Contagem: ${fq(c)} ${prod.unidade}`, obs.trim()].filter(Boolean).join(' · ') })} />
  </>)
}

function FormProduto({ produtos, onSalvar }) {
  const [nome, setNome] = useState('')
  const [cat, setCat] = useState('racao')
  const [unid, setUnid] = useState('kg')
  const [minimo, setMinimo] = useState('')
  const n = nome.trim().replace(/\s+/g, ' ')
  const repetido = produtos.some((p) => p.nome.toLowerCase() === n.toLowerCase())
  const m = num(minimo)
  return (<>
    <label className="campo"><span>Nome do produto</span>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ração 35% PB 2,0 mm" /></label>
    {repetido && <p className="dica esq aviso-sem-plano">Já existe um produto com esse nome.</p>}
    <fieldset className="campo"><legend>Tipo</legend>
      <div className="chips cols2">
        {Object.entries(CAT_PRODUTO).map(([k, r]) => <button key={k} type="button" className={cat === k ? 'sel' : ''} onClick={() => { setCat(k); if (k === 'racao') setUnid('kg') }}>{r}</button>)}
      </div>
    </fieldset>
    <fieldset className="campo"><legend>Unidade</legend>
      <div className="chips">
        {UNIDADES.map((u) => <button key={u} type="button" className={unid === u ? 'sel' : ''} onClick={() => setUnid(u)}>{u}</button>)}
      </div>
    </fieldset>
    <CampoNum rotulo="Estoque mínimo (avisa abaixo disso)" valor={minimo} onChange={setMinimo} sufixo={unid} />
    <p className="dica esq">Depois de cadastrar, lance o saldo inicial em “Contagem” ou a nota em “Entrada”.</p>
    <Salvar pronto={n.length >= 2 && !repetido && !Number.isNaN(m)} alertas={[]}
      onSalvar={() => onSalvar({ nome: n, categoria: cat, unidade: unid, estoque_minimo: m > 0 ? m : null })} />
  </>)
}
