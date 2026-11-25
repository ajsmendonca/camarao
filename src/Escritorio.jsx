// App do escritório (gestor/admin): menu lateral com as páginas de gestão.
// O coletor de campo (App.jsx) continua sendo o app do celular, enxuto e offline.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { carregarPainel, hoje, MODO_DEMO, salvarConfig, supabase, PRECO_PADRAO, PLANO_PADRAO, kgPadrao } from './data'
import { CustosViveiros, NotasApresentame } from './Financeiro'
import { TabelaPreco, Impostos } from './Painel'

const fmt = (n, d = 1) => n == null || Number.isNaN(n) ? '–'
  : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const num = (s) => {
  if (s === '' || s == null) return null
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const txt = (n) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','))
const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : ''
const mil = (n) => n == null ? '–' : n >= 1e6 ? `${fmt(n / 1e6, 2)} mi` : `${fmt(n / 1000, 0)} mil`
const reais2 = (n) => n == null ? '–' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const RESULT = { zerou: 'Zerou', pouca_sobra: 'Pouca sobra', muita_sobra: 'Muita sobra' }
const CAT = { racao: 'Ração', pos_larva: 'Pós-larva', fertilizante: 'Fertilizante', calcario: 'Calcário / cal', probiotico: 'Probiótico', outro: 'Outro' }

export const MENU = [
  ['painel', '📊', 'Painel', 'Produção'],
  ['ciclos', '🔄', 'Viveiros e ciclos'],
  ['plano', '📋', 'Plano de ração'],
  ['despescas', '🧺', 'Despescas'],
  ['racao', '🍚', 'Ração', 'Acompanhamento do campo'],
  ['biometria', '⚖️', 'Biometria'],
  ['agua', '💧', 'Água'],
  ['ocorrencias', '⚠️', 'Ocorrências'],
  ['insumos', '🧪', 'Insumos'],
  ['estoque', '📦', 'Estoque', 'Gestão'],
  ['financeiro', '💰', 'Financeiro'],
  ['lancamentos', '📝', 'Lançamentos (corrigir)'],
  ['cadastros', '🤝', 'Cadastros'],
  ['configuracoes', '⚙️', 'Configurações'],
]

export function Escritorio({ pagina, setPagina, usuario, online, pendentes, onEnvios, onColetor, onSair, children }) {
  const titulo = MENU.find((m) => m[0] === pagina)?.[2] || ''
  const [aberto, setAberto] = useState(false)   // menu no celular
  const ir = (id) => { setAberto(false); setPagina(id) }
  return (
    <div className={`esc ${aberto ? 'menu-aberto' : ''}`}>
      <nav className="esc-menu" aria-label="Menu do escritório">
        <div className="esc-marca">🦐 <b>Barra Maricultura</b><small>Escritório</small></div>
        {MENU.map(([id, ic, nome, grupo]) => [
          grupo && <span key={'g' + id} className="esc-grupo">{grupo}</span>,
          <button key={id} className={pagina === id ? 'sel' : ''} aria-current={pagina === id ? 'page' : undefined}
            onClick={() => ir(id)}><span>{ic}</span>{nome}</button>,
        ])}
        <div className="esc-rodape">
          <button onClick={() => { setAberto(false); onColetor() }}><span>📱</span>Coletor de campo</button>
          {onSair && <button onClick={onSair}><span>🚪</span>Sair</button>}
        </div>
      </nav>
      <div className="esc-corpo">
        <header className="esc-topo">
          <button className="esc-menu-btn" onClick={() => setAberto((x) => !x)} aria-expanded={aberto} aria-label="Abrir menu">{aberto ? '✕' : '☰'}<small>Menu</small></button>
          <div className="titulo"><strong>{titulo}</strong><small>{usuario}{MODO_DEMO && ' · demonstração'} · versão {__VERSAO__}</small></div>
          <button className={`status ${online ? 'on' : 'off'}`} onClick={onEnvios} title="Lançamentos guardados neste aparelho">
            <span className="ponto" />{online ? 'Online' : 'Sem sinal'}
            {pendentes > 0 && <b className="badge">{pendentes}</b>}
          </button>
        </header>
        <div className="esc-conteudo">{children}</div>
      </div>
    </div>
  )
}

// aviso para páginas que só existem no sistema real ou precisam de internet
export function SoOnline({ online, children }) {
  if (MODO_DEMO) return <div className="painel"><p className="p-vazio">Disponível só no sistema real (não na demonstração).</p></div>
  if (!online) return <div className="painel"><p className="p-erro">Sem internet: esta página precisa de sinal.</p></div>
  return children
}

// ---------- Viveiros e ciclos: quadro de todos os viveiros + formulário do escolhido ----------
export function PaginaCiclos({ viveiros, sel, onSel, children }) {
  // em tela estreita o formulário fica embaixo da tabela: rola até ele ao escolher
  useEffect(() => { if (sel && window.innerWidth < 1100) document.querySelector('.e-ciclo-form')?.scrollIntoView({ behavior: 'smooth' }) }, [sel])
  return (
    <div className="painel e-duas">
      <section className="p-bloco">
        <h2>Viveiros</h2>
        <div className="p-tabela"><table>
          <thead><tr><th>Viveiro</th><th className="n">Área</th><th>Situação</th><th>Início</th><th>Povoamento</th><th className="n">Dias ciclo</th><th className="n">Dias cultivo</th><th className="n">PL</th><th className="n">PL/m²</th></tr></thead>
          <tbody>{viveiros.map((v) => (
            <tr key={v.id} className={`clicavel ${sel === v.id ? 'sel' : ''} ${v.ciclo ? '' : 'vazio'}`} onClick={() => onSel(v.id)}>
              <td><b>{v.codigo}</b></td><td className="n">{fmt(v.area_ha, 1)} ha</td>
              <td>{!v.ciclo ? 'Vazio' : v.emCultivo ? 'Em cultivo' : 'Preparação'}</td>
              <td>{v.ciclo ? dataBR(v.ciclo.data_inicio) : ''}</td>
              <td>{v.ciclo?.data_povoamento ? dataBR(v.ciclo.data_povoamento) : ''}</td>
              <td className="n">{v.ciclo ? v.diasCiclo : ''}</td>
              <td className="n">{v.emCultivo ? v.dias : ''}</td>
              <td className="n">{v.pl ? mil(v.pl) : ''}</td>
              <td className="n">{v.pl && v.area_ha ? fmt(v.pl / (v.area_ha * 10000), 1) : ''}</td>
            </tr>))}</tbody>
        </table></div>
        <p className="p-nota">Clique num viveiro para iniciar o ciclo, povoar, lançar complemento ou corrigir os dados gravados.</p>
      </section>
      <section className="p-bloco e-form e-ciclo-form">{children}</section>
    </div>
  )
}

// ---------- Plano de ração: todos os viveiros lado a lado, editável ----------
export function PlanoTabela({ viveiros, racoes, tratosPadrao, onSalvar, onDetalhar }) {
  const cultivo = viveiros.filter((v) => v.emCultivo)
  const base = (v) => {
    const p = v.plano
    return { sobrev: txt(v.sobrevEst ?? p?.sobrevivencia_est), produto: p?.produto_id || v.ultimoProduto || '',
      kg: txt(p?.kg_dia), tratos: p?.tratos?.length || tratosPadrao, inicio: hoje(), obs: '' }
  }
  // só guarda as linhas que o gestor mexeu; as outras seguem o plano atual (a página remonta depois de salvar)
  const [linhas, setLinhas] = useState({})
  const [salvando, setSalvando] = useState(false)
  const linha = (v) => linhas[v.id] || base(v)
  const muda = (id, campo, valor) => setLinhas((l) => {
    const v = cultivo.find((x) => x.id === id)
    return { ...l, [id]: { ...(l[id] || base(v)), [campo]: valor } }
  })

  const calc = cultivo.map((v) => {
    const l = linha(v)
    const p = v.plano
    const kg = num(l.kg), sv = num(l.sobrev)
    const svAtual = v.sobrevEst ?? p?.sobrevivencia_est ?? null
    const mudou = !p ? kg > 0
      : kg !== Number(p.kg_dia) || (l.produto || null) !== (p.produto_id || null) || Number(l.tratos) !== (p.tratos?.length || tratosPadrao)
        || (sv ?? null) !== (svAtual != null ? Math.round(svAtual * 100) / 100 : null) || l.inicio !== hoje() || !!l.obs.trim()
    const pop = sv > 0 && v.pl ? Math.max(0, v.pl * sv / 100 - v.popDespescada) : null
    const bio = pop != null && v.ultimaBio ? pop * v.ultimaBio.peso_medio_g / 1000 : null
    const erro = !(kg > 0) ? 'informe o kg/dia' : Number.isNaN(sv) || (sv != null && (sv <= 0 || sv > 100)) ? 'sobrevivência entre 0 e 100%' : !l.produto ? 'escolha a ração' : null
    return { v, l, kg, sv, mudou, bio, erro }
  })
  const alterados = calc.filter((c) => c.mudou)
  const comErro = alterados.filter((c) => c.erro)

  // estoque de cada ração com os planos (os editados valem)
  const uso = {}
  calc.forEach((c) => { if (c.l.produto && c.kg > 0) uso[c.l.produto] = (uso[c.l.produto] || 0) + c.kg })

  const salvar = async () => {
    setSalvando(true)
    const extra = alterados.map(({ v, l, kg, sv }) => {
      const n = Number(l.tratos)
      const ant = v.plano?.tratos
      // mesma quantidade de tratos do plano atual → reparte na mesma proporção; senão, divisão igual
      const somaAnt = ant?.reduce((s, t) => s + Number(t.kg), 0)
      const tratos = ant?.length === n && somaAnt > 0
        ? ant.map((t, i) => ({ trato: i + 1, kg: Math.round(kg * Number(t.kg) / somaAnt * 10) / 10 }))
        : Array.from({ length: n }, (_, i) => ({ trato: i + 1, kg: Math.round(kg / n * 10) / 10 }))
      return { tipo: 'plano', dados: { ciclo_id: v.ciclo.id, data_inicio: l.inicio, produto_id: l.produto, kg_dia: kg,
        sobrevivencia_est: sv > 0 ? sv : null, tratos, observacao: l.obs.trim() || null } }
    })
    try { await onSalvar('plano', null, extra, 'plano') } finally { setSalvando(false) }
  }
  const pct = (id, p) => { const k = num(linha(cultivo.find((x) => x.id === id)).kg); if (k > 0) muda(id, 'kg', txt(Math.round(k * (1 + p / 100) * 10) / 10)) }

  if (!cultivo.length) return <div className="painel"><p className="p-vazio">Nenhum viveiro em cultivo.</p></div>
  return (
    <div className="painel">
      <section className="p-bloco">
        <h2>Plano de ração dos viveiros em cultivo</h2>
        <div className="p-tabela">
          <table className="e-plano">
            <thead><tr>
              <th>Viveiro</th><th className="n">Dias</th><th className="n">Peso (g)</th><th className="n">PL</th>
              <th className="n">Sobrev. est. %</th><th className="n">Biomassa est.</th><th>Ração</th><th className="n">kg/dia</th><th />
              <th className="n" title="ração do dia ÷ biomassa estimada">% biom.</th><th className="n">Tratos</th>
              <th className="n">Colocado ontem</th><th className="n">Hoje</th><th>Bandejas</th><th>Vale a partir de</th><th>Recado ao arraçoador</th><th />
            </tr></thead>
            <tbody>{calc.map(({ v, l, kg, mudou, bio, erro }) => {
              const ck = v.bandejaHoje?.retirada || v.bandejaOntem?.retirada
              return (
                <tr key={v.id} className={`${mudou ? 'alterado' : ''} ${mudou && erro ? 'critico' : ''}`}>
                  <td><b>{v.codigo}</b>{v.plano?.padrao && <small className="fonte" title="plano padrão dos primeiros dias (Configurações)"> padrão · dia {v.plano.dia}</small>}{v.planoFuturo && <small className="fonte" title={`plano a partir de ${dataBR(v.planoFuturo.data_inicio)}: ${fmt(v.planoFuturo.kg_dia)} kg/dia`}> futuro</small>}</td>
                  <td className="n">{v.dias}</td>
                  <td className="n">{v.ultimaBio ? fmt(v.ultimaBio.peso_medio_g, 2) : '–'}</td>
                  <td className="n">{v.pl ? mil(v.pl) : '–'}</td>
                  <td className="n"><input className="e-num" value={l.sobrev} onChange={(e) => muda(v.id, 'sobrev', e.target.value)} inputMode="decimal" aria-label={`Sobrevivência ${v.codigo}`} /></td>
                  <td className="n">{bio != null ? `${fmt(bio, 0)} kg` : '–'}</td>
                  <td><select value={l.produto} onChange={(e) => muda(v.id, 'produto', e.target.value)} aria-label={`Ração ${v.codigo}`}>
                    {!l.produto && <option value="">—</option>}
                    {racoes.filter((p) => p.ativo !== false || p.id === l.produto).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select></td>
                  <td className="n"><input className="e-num" value={l.kg} placeholder={v.racaoOntem > 0 ? fmt(v.racaoOntem, 0) : ''} title={v.racaoOntem > 0 ? `colocado ontem: ${fmt(v.racaoOntem, 0)} kg` : ''} onChange={(e) => muda(v.id, 'kg', e.target.value)} inputMode="decimal" aria-label={`kg por dia ${v.codigo}`} /></td>
                  <td className="e-pct">{[-10, -5, 5, 10].map((p) => <button key={p} type="button" onClick={() => pct(v.id, p)}>{p > 0 ? '+' : ''}{p}</button>)}</td>
                  <td className="n">{bio > 0 && kg > 0 ? `${fmt((kg / bio) * 100, 1)}%` : '–'}</td>
                  <td className="n"><select value={l.tratos} onChange={(e) => muda(v.id, 'tratos', Number(e.target.value))} aria-label={`Tratos ${v.codigo}`}>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                  <td className="n">{fmt(v.racaoOntem, 0)}</td>
                  <td className="n">{fmt(v.kgHoje, 0)}</td>
                  <td>{ck ? `${RESULT[ck.resultado]}${v.bandejaHoje?.retirada ? ' (hoje)' : ' (ontem)'}` : '–'}</td>
                  <td><input type="date" value={l.inicio} min={hoje()} onChange={(e) => muda(v.id, 'inicio', e.target.value)} aria-label={`Vale a partir de ${v.codigo}`} /></td>
                  <td><input className="e-txt" value={l.obs} onChange={(e) => muda(v.id, 'obs', e.target.value)} placeholder="opcional" aria-label={`Recado ${v.codigo}`} /></td>
                  <td><button type="button" className="e-link" onClick={() => onDetalhar(v.id)} title="divisão manual por trato">detalhar</button></td>
                </tr>
              )
            })}</tbody>
            <tfoot><tr>
              <td><b>Total</b></td><td colSpan={4} />
              <td className="n"><b>{fmt(calc.reduce((s, c) => s + (c.bio || 0), 0), 0)} kg</b></td><td />
              <td className="n"><b>{fmt(calc.reduce((s, c) => s + (c.kg > 0 ? c.kg : 0), 0), 0)}</b></td><td colSpan={3} />
              <td className="n"><b>{fmt(cultivo.reduce((s, v) => s + v.racaoOntem, 0), 0)}</b></td>
              <td className="n"><b>{fmt(cultivo.reduce((s, v) => s + v.kgHoje, 0), 0)}</b></td><td colSpan={4} />
            </tr></tfoot>
          </table>
        </div>
        <div className="e-acoes">
          <button className="e-primario" disabled={!alterados.length || comErro.length > 0 || salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : alterados.length ? `Salvar ${alterados.length} plano(s) alterado(s)` : 'Nenhuma alteração'}</button>
          {alterados.length > 0 && <button onClick={() => setLinhas({})}>Desfazer alterações</button>}
          {comErro.length > 0 && <span className="p-msg ruim">{comErro.map((c) => `${c.v.codigo}: ${c.erro}`).join(' · ')}</span>}
        </div>
        <p className="p-nota">kg/dia é o total do viveiro, incluindo a ração das bandejas. Linhas alteradas ficam destacadas; ao salvar, cada uma vira um plano novo
          que vale a partir da data escolhida (até o próximo plano). Com o mesmo número de tratos, o novo kg/dia é repartido na mesma proporção do plano atual;
          mudando o número de tratos, a divisão é igual — para dividir à mão, use “detalhar”. Viveiros marcados “padrão” estão nos primeiros dias de cultivo e seguem sozinhos o plano padrão (Configurações) dia a dia; alterar a linha cria um plano próprio que passa a valer no lugar do padrão. Biomassa est. = PL × sobrevivência × último peso.</p>
      </section>
      <section className="p-bloco">
        <h2>Ração em estoque pelos planos</h2>
        {racoes.length === 0 ? <p className="p-vazio">Nenhuma ração cadastrada.</p> : (
          <table><thead><tr><th>Ração</th><th className="n">Saldo</th><th className="n">Uso pelo plano</th><th className="n">Dura</th></tr></thead>
            <tbody>{racoes.filter((p) => p.saldo > 0 || uso[p.id]).map((p) => (
              <tr key={p.id} className={uso[p.id] && p.saldo / uso[p.id] < 7 ? 'critico' : ''}>
                <td>{p.nome}</td><td className="n">{fmt(p.saldo, 0)} kg</td>
                <td className="n">{uso[p.id] ? `${fmt(uso[p.id], 0)} kg/dia` : '–'}</td>
                <td className="n">{uso[p.id] ? `~${fmt(Math.max(0, p.saldo) / uso[p.id], 0)} dias` : '–'}</td>
              </tr>))}</tbody></table>
        )}
      </section>
    </div>
  )
}

// ---------- Estoque: tabela de saldos (com preço médio) + lançamentos do gestor ----------
export function PaginaEstoque({ produtos, viveiros, online, children }) {
  const [precos, setPrecos] = useState({})
  useEffect(() => {
    if (MODO_DEMO || !online) return
    supabase.from('vw_preco_medio').select('produto_id, preco_medio').then(({ data }) =>
      setPrecos(Object.fromEntries((data || []).map((r) => [r.produto_id, r.preco_medio == null ? null : Number(r.preco_medio)]))))
  }, [online, produtos.length])
  const usoDia = {}
  viveiros.forEach((v) => { if (v.plano?.produto_id) usoDia[v.plano.produto_id] = (usoDia[v.plano.produto_id] || 0) + v.plano.kg_dia })
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const lista = produtos.filter((p) => mostrarInativos || p.ativo !== false)
  const valorTotal = lista.reduce((s, p) => s + (precos[p.id] != null && p.saldo > 0 ? p.saldo * precos[p.id] : 0), 0)
  return (
    <div className="painel e-duas">
      <section className="p-bloco">
        <h2>Saldo em estoque</h2>
        {produtos.length === 0 ? <p className="p-vazio">Nenhum produto cadastrado.</p> : (<div className="p-tabela">
          <table><thead><tr><th>Produto</th><th>Tipo</th><th className="n">Saldo</th><th className="n">Mínimo</th><th className="n">Dura</th><th className="n">Preço médio</th><th className="n">Valor</th></tr></thead>
            <tbody>{Object.keys(CAT).flatMap((c) => lista.filter((p) => p.categoria === c)).map((p) => {
              const pm = precos[p.id]
              const pl = p.categoria === 'pos_larva'
              return (
                <tr key={p.id} className={p.saldo <= 0 ? 'critico' : p.estoque_minimo != null && p.saldo < p.estoque_minimo ? 'atencao' : ''}>
                  <td>{p.nome}{p.ativo === false && <small className="fonte"> inativo</small>}</td><td>{CAT[p.categoria]}</td>
                  <td className="n">{pl ? `${mil(p.saldo)} PL` : `${fmt(p.saldo, 0)} ${p.unidade}`}</td>
                  <td className="n">{p.estoque_minimo != null ? (pl ? mil(p.estoque_minimo) : fmt(p.estoque_minimo, 0)) : '–'}</td>
                  <td className="n">{usoDia[p.id] && p.saldo > 0 ? `~${fmt(p.saldo / usoDia[p.id], 0)} dias` : '–'}</td>
                  <td className="n">{pm != null ? (pl ? `${reais2(pm * 1000)}/mil` : `${reais2(pm)}/${p.unidade}`) : '–'}</td>
                  <td className="n">{pm != null && p.saldo > 0 ? reais2(p.saldo * pm) : '–'}</td>
                </tr>)
            })}</tbody>
            {valorTotal > 0 && <tfoot><tr><td><b>Total</b></td><td colSpan={5} /><td className="n"><b>{reais2(valorTotal)}</b></td></tr></tfoot>}
          </table></div>
        )}
        <label className="e-check"><input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> Mostrar produtos inativos</label>
        <p className="p-nota">Saídas automáticas: trato, ração colocada nas bandejas, aplicação de insumo e povoamento. Preço médio = saldo inicial × preço do Meu Pescado
          + entradas com nota do Apresenta.me, dividido pela quantidade. “Dura” = saldo ÷ soma dos planos de ração vigentes.</p>
      </section>
      <section className="p-bloco e-form">{children}</section>
    </div>
  )
}

// ---------- Financeiro: custo dos ciclos abertos e notas do Apresenta.me ----------
export function PaginaFinanceiro({ cad, viveiros, produtos, online, onAlterado }) {
  const [serie, setSerie] = useState(null)
  const [erro, setErro] = useState(null)
  const carregar = useCallback(async () => {
    setErro(null)
    try { setSerie(await carregarPainel(cad)) } catch (e) { setErro(e.message || String(e)) }
  }, [cad])
  useEffect(() => { if (online || MODO_DEMO) carregar() }, [online, carregar])
  const primeiraNota = useMemo(() => (serie?.notas || []).reduce((m, n) => (!m || (n.competencia || n.data) < m ? (n.competencia || n.data) : m), null), [serie])
  return (
    <div className="painel">
      <div className="e-acoes"><button onClick={carregar} disabled={!online && !MODO_DEMO}>Atualizar</button>
        {MODO_DEMO && <span className="p-msg">Na demonstração não há notas nem custos do Apresenta.me.</span>}</div>
      {erro && <p className="p-erro">Não foi possível carregar: {erro}</p>}
      {!online && !MODO_DEMO && <p className="p-erro">Sem internet: o financeiro precisa de sinal.</p>}
      {!serie && !erro && (online || MODO_DEMO) && <p className="p-vazio">Carregando…</p>}
      {serie && <CustosViveiros viveiros={viveiros} custos={serie.custos || {}} primeiraNota={primeiraNota} />}
      {serie && !serie.demo && <NotasApresentame notas={serie.notas} destinos={serie.destinos} entradasNota={serie.entradasNota}
        viveiros={viveiros} produtos={produtos} usuario={cad.nome} onAlterado={async () => { await carregar(); onAlterado?.() }} />}
    </div>
  )
}

// ---------- Configurações: preço de tabela, impostos, preço da PL, equipe, senha ----------
export function PaginaConfig({ cad, racoes = [], online, onAlterado, children }) {
  const tabela = { ...PRECO_PADRAO, ...(cad.config?.preco_venda || {}) }
  const impostoPct = Number(cad.config?.imposto_venda?.pct ?? 0)
  return (
    <div className="painel">
      <div className="p-grade">
        <TabelaPreco key={JSON.stringify(tabela)} tabela={tabela} online={online} onSalvo={onAlterado} />
        <Impostos key={impostoPct} pct={impostoPct} online={online} onSalvo={onAlterado} />
        <Checagem key={JSON.stringify(cad.config?.checagem)} atual={{ pct: 2, trato: 1, ...(cad.config?.checagem || {}) }} online={online} onSalvo={onAlterado} />
        <PrecoPL key={String(cad.config?.preco_pl_milheiro)} valor={Number(cad.config?.preco_pl_milheiro ?? 14)} online={online} onSalvo={onAlterado} />
      </div>
      <PlanoPadrao key={JSON.stringify(cad.config?.plano_padrao)} atual={{ ...PLANO_PADRAO, ...(cad.config?.plano_padrao || {}) }} racoes={racoes} online={online} onSalvo={onAlterado} />
      {children}
    </div>
  )
}

function PrecoPL({ valor, online, onSalvo }) {
  const [d, setD] = useState(txt(valor))
  const [msg, setMsg] = useState(null)
  const novo = num(d)
  const valido = novo > 0
  return (
    <section className="p-bloco p-preco">
      <h2>Preço da pós-larva sem nota</h2>
      <div className="p-preco-campos">
        <label>Preço por milheiro<span>R$ <input value={d} onChange={(e) => setD(e.target.value)} inputMode="decimal" /></span></label>
        {valido && novo !== valor && <button type="button" disabled={!online && !MODO_DEMO} onClick={async () => {
          setMsg(null)
          try { await salvarConfig('preco_pl_milheiro', novo); setMsg('Preço salvo.'); onSalvo?.() } catch (e) { setMsg('Não foi possível salvar: ' + (e.message || e)) }
        }}>Salvar</button>}
        {msg && <small className="p-msg">{msg}</small>}
      </div>
      <p className="p-nota">Usado no custo do ciclo para povoamentos sem lote de PL com nota do Apresenta.me
        (ex.: 300 mil PL × {reais2(valido ? novo : valor)} = {reais2(300 * (valido ? novo : valor))}).</p>
    </section>
  )
}

// Plano de ração padrão dos primeiros dias de cultivo: kg/dia por 100 mil PL por faixa de dias
function PlanoPadrao({ atual, racoes, online, onSalvo }) {
  const [dias, setDias] = useState(String(atual.dias))
  const [tratos, setTratos] = useState(Number(atual.tratos) || 4)
  const [produto, setProduto] = useState(atual.produto_id || '')
  const [faixas, setFaixas] = useState(() => [...atual.faixas].sort((a, b) => a.dia - b.dia).map((f) => ({ dia: String(f.dia), kg: txt(f.kg) })))
  const [msg, setMsg] = useState(null)
  const novo = { dias: Number(dias), tratos, produto_id: produto || null,
    faixas: faixas.map((f) => ({ dia: Number(f.dia), kg: num(f.kg) })).sort((a, b) => a.dia - b.dia) }
  const valido = novo.dias >= 1 && novo.dias <= 120 && novo.faixas.length > 0 && novo.faixas[0].dia === 1
    && novo.faixas.every((f) => Number.isInteger(f.dia) && f.dia >= 1 && f.kg > 0)
    && new Set(novo.faixas.map((f) => f.dia)).size === novo.faixas.length
  const mudou = JSON.stringify(novo) !== JSON.stringify({ dias: Number(atual.dias), tratos: Number(atual.tratos) || 4, produto_id: atual.produto_id || null,
    faixas: [...atual.faixas].map((f) => ({ dia: Number(f.dia), kg: Number(f.kg) })).sort((a, b) => a.dia - b.dia) })
  const muda = (i, campo, v) => setFaixas((l) => l.map((f, j) => (j === i ? { ...f, [campo]: v } : f)))
  const fim = (i) => (i + 1 < novo.faixas.length ? novo.faixas[i + 1].dia - 1 : novo.dias)
  return (
    <section className="p-bloco">
      <h2>Plano de ração padrão (primeiros dias de cultivo)</h2>
      <div className="e-duas e-padrao">
        <div>
          <div className="p-preco-campos">
            <label>Vale nos primeiros<span><input value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /> dias</span></label>
            <label>Tratos por dia<span><select value={tratos} onChange={(e) => setTratos(Number(e.target.value))}>{[2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></span></label>
            <label>Ração<span><select value={produto} onChange={(e) => setProduto(e.target.value)}>
              <option value="">a do último trato</option>
              {racoes.filter((p) => p.ativo !== false || p.id === produto).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></span></label>
          </div>
          <div className="p-tabela"><table className="e-plano"><thead><tr><th>A partir do dia</th><th>Até o dia</th><th className="n">kg/dia por 100 mil PL</th><th className="n">300 mil PL</th><th className="n">400 mil PL</th><th /></tr></thead>
            <tbody>{faixas.map((f, i) => {
              const k = num(f.kg)
              return (
                <tr key={i}>
                  <td><input className="e-num" value={f.dia} onChange={(e) => muda(i, 'dia', e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="a partir do dia" /></td>
                  <td>{novo.faixas[i] && novo.faixas.indexOf(novo.faixas.find((x) => x.dia === Number(f.dia))) === i ? fim(i) : ''}</td>
                  <td className="n"><input className="e-num" value={f.kg} onChange={(e) => muda(i, 'kg', e.target.value)} inputMode="decimal" aria-label="kg por 100 mil PL" /></td>
                  <td className="n">{k > 0 ? `${fmt(k * 3, 1)} kg` : '–'}</td>
                  <td className="n">{k > 0 ? `${fmt(k * 4, 1)} kg` : '–'}</td>
                  <td>{faixas.length > 1 && <button type="button" className="e-link" onClick={() => setFaixas((l) => l.filter((_, j) => j !== i))}>remover</button>}</td>
                </tr>)
            })}</tbody></table></div>
          <div className="e-acoes">
            <button type="button" onClick={() => setFaixas((l) => [...l, { dia: String(Math.min(novo.dias, (novo.faixas.at(-1)?.dia || 0) + 7)), kg: '' }])}>+ Faixa</button>
            {mudou && <button className="e-primario" disabled={!valido || (!online && !MODO_DEMO)} onClick={async () => {
              setMsg(null)
              try { await salvarConfig('plano_padrao', novo); setMsg('Plano padrão salvo.'); onSalvo?.() } catch (e) { setMsg('Não foi possível salvar: ' + (e.message || e)) }
            }}>Salvar plano padrão</button>}
            {mudou && !valido && <span className="p-msg ruim">A primeira faixa começa no dia 1; dias diferentes e kg maior que zero.</span>}
            {msg && <span className="p-msg">{msg}</span>}
          </div>
        </div>
        <GraficoPadrao pp={valido ? novo : atual} />
      </div>
      <p className="p-nota">Do povoamento até o dia {valido ? novo.dias : atual.dias}, a ração prevista de cada viveiro = kg da faixa × PL povoadas ÷ 100 mil,
        dividida igualmente pelos tratos, e muda sozinha a cada faixa (o arraçoador vê o previsto no coletor). Se o gestor lançar um plano para o viveiro
        depois do povoamento, esse plano passa a valer no lugar do padrão. Depois do período padrão, vale o plano lançado pelo gestor (pela sobra das bandejas).
        Valores iniciais = mediana do arraçoamento de abr–nov/2026 (Meu Pescado).</p>
    </section>
  )
}

function GraficoPadrao({ pp }) {
  const W = 420, H = 180, m = { l: 34, r: 10, t: 10, b: 24 }
  const n = Number(pp.dias)
  const pts = Array.from({ length: n }, (_, i) => ({ d: i + 1, k: kgPadrao(pp, i + 1) * 3 }))
  const max = Math.max(1, ...pts.map((p) => p.k))
  const x = (d) => m.l + ((d - 1) / Math.max(1, n - 1)) * (W - m.l - m.r)
  const y = (k) => H - m.b - (k / max) * (H - m.t - m.b)
  return (
    <figure className="e-grafico">
      <figcaption>kg/dia previstos para 300 mil PL</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Plano padrão em kg por dia">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={m.l} x2={W - m.r} y1={y(max * f)} y2={y(max * f)} className="grade" /><text x={m.l - 6} y={y(max * f) + 4} textAnchor="end">{fmt(max * f, 0)}</text></g>)}
        {pts.map((p) => <rect key={p.d} x={x(p.d) - 4} y={y(p.k)} width={8} height={H - m.b - y(p.k)} className="barra"><title>{`dia ${p.d}: ${fmt(p.k, 1)} kg`}</title></rect>)}
        {[1, Math.round(n / 2), n].map((d) => <text key={d} x={x(d)} y={H - 6} textAnchor="middle">{d}</text>)}
      </svg>
    </figure>
  )
}

// Ração das bandejas de checagem: % do kg/dia, tirado do trato em que a checagem é feita (tela "Pesar ração" do coletor)
function Checagem({ atual, online, onSalvo }) {
  const [pct, setPct] = useState(txt(atual.pct))
  const [trato, setTrato] = useState(Number(atual.trato) || 1)
  const [msg, setMsg] = useState(null)
  const p = num(pct)
  const valido = p != null && p >= 0 && p <= 50
  const mudou = valido && (p !== Number(atual.pct) || trato !== Number(atual.trato))
  return (
    <section className="p-bloco p-preco">
      <h2>Ração da checagem (bandejas)</h2>
      <div className="p-preco-campos">
        <label>% da ração do dia<span><input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" /> %</span></label>
        <label>tirada do trato<span><select value={trato} onChange={(e) => setTrato(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}º</option>)}</select></span></label>
        {mudou && <button type="button" disabled={!online && !MODO_DEMO} onClick={async () => {
          setMsg(null)
          try { await salvarConfig('checagem', { pct: p, trato }); setMsg('Salvo.'); onSalvo?.() } catch (e) { setMsg('Não foi possível salvar: ' + (e.message || e)) }
        }}>Salvar</button>}
        {msg && <small className="p-msg">{msg}</small>}
      </div>
      <p className="p-nota">{valido ? `Ex.: plano de 80 kg/dia → ${fmt(80 * p / 100, 2)} kg nas bandejas, pesados à parte no ${trato}º trato (o lanço desse trato fica menor).` : 'Informe um percentual entre 0 e 50.'}
        {' '}Aparece na tela “Pesar ração” do coletor e preenche a colocação das bandejas. 0% = sem checagem separada.</p>
    </section>
  )
}

// ---------- Sobrevivência e biomassa estimada: o gestor informa a biomassa atual (ou a sobrevivência) e o outro valor é recalculado.
// Grava uma estimativa de sobrevivência (tabela estimativas_sobrevivencia) que vale daí em diante: a biomassa estimada
// passa a acompanhar as próximas biometrias com essa porcentagem.
export function AjusteSobrevivencia({ viveiros, onSalvar }) {
  const cultivo = viveiros.filter((v) => v.emCultivo)
  const [ed, setEd] = useState({})       // id → { sv, bio, por: 'sv'|'bio' }
  const [salvando, setSalvando] = useState(false)
  const peso = (v) => (v.ultimaBio ? Number(v.ultimaBio.peso_medio_g) : null)
  const bioDe = (v, sv) => (sv > 0 && v.pl && peso(v) ? Math.max(0, v.pl * sv / 100 - (v.popDespescada || 0)) * peso(v) / 1000 : null)
  const svDe = (v, bio) => (bio >= 0 && v.pl && peso(v) ? ((bio * 1000 / peso(v)) + (v.popDespescada || 0)) / v.pl * 100 : null)
  const linha = (v) => {
    const e = ed[v.id]
    if (!e) return { sv: v.sobrevEst, bio: v.biomassaPrevista, mudou: false }
    const sv = e.por === 'bio' ? svDe(v, num(e.bio)) : num(e.sv)
    const bio = e.por === 'bio' ? num(e.bio) : bioDe(v, num(e.sv))
    return { sv, bio, mudou: true, e }
  }
  const muda = (v, por, valor) => setEd((o) => ({ ...o, [v.id]: { por, [por]: valor } }))
  const linhas = cultivo.map((v) => ({ v, ...linha(v) }))
  const alterados = linhas.filter((l) => l.mudou)
  const erro = (l) => (l.sv == null || Number.isNaN(l.sv) || !(l.sv > 0) ? 'informe um valor' : l.sv > 130 ? 'sobrevivência acima de 130%' : null)
  const comErro = alterados.filter(erro)
  const salvar = async () => {
    setSalvando(true)
    try {
      await onSalvar('sobrevivencia', null, alterados.map((l) => ({ tipo: 'sobrevivencia', dados: {
        ciclo_id: l.v.ciclo.id, data: hoje(), pct: Math.round(l.sv * 100) / 100,
        origem: l.e.por === 'bio' ? `biomassa informada: ${fmt(l.bio, 0)} kg com ${fmt(peso(l.v), 2)} g` : 'ajuste no escritório' } })), 'x')
      setEd({})
    } finally { setSalvando(false) }
  }
  return (
    <section className="p-bloco">
      <h2>Sobrevivência e biomassa estimada</h2>
      <div className="p-tabela"><table className="e-plano">
        <thead><tr><th>Viveiro</th><th className="n">Dias</th><th className="n">PL povoadas</th><th className="n">Já despescado</th><th className="n">Último peso</th>
          <th className="n">Sobrevivência %</th><th className="n">Biomassa est. (kg)</th><th className="n">Camarões est.</th><th /></tr></thead>
        <tbody>{linhas.map((l) => {
          const { v } = l, e = l.e
          const pop = l.sv > 0 && v.pl ? Math.max(0, v.pl * l.sv / 100 - (v.popDespescada || 0)) : null
          return (
            <tr key={v.id} className={`${l.mudou ? 'alterado' : ''} ${l.mudou && erro(l) ? 'critico' : ''}`}>
              <td><b>{v.codigo}</b></td><td className="n">{v.dias}</td><td className="n">{v.pl ? mil(v.pl) : '–'}</td>
              <td className="n">{v.popDespescada ? mil(v.popDespescada) : '–'}</td>
              <td className="n">{peso(v) ? `${fmt(peso(v), 2)} g` : <small className="fonte">sem biometria</small>}</td>
              <td className="n"><input className="e-num" inputMode="decimal" aria-label={`Sobrevivência ${v.codigo}`}
                value={e?.por === 'sv' ? e.sv : txt(l.sv)} onChange={(x) => muda(v, 'sv', x.target.value)} /></td>
              <td className="n">{peso(v) ? <input className="e-num" inputMode="decimal" aria-label={`Biomassa ${v.codigo}`}
                value={e?.por === 'bio' ? e.bio : l.bio != null ? String(Math.round(l.bio)) : ''} onChange={(x) => muda(v, 'bio', x.target.value)} /> : '–'}</td>
              <td className="n">{pop != null ? mil(pop) : '–'}</td>
              <td>{l.mudou && <button type="button" className="e-link" onClick={() => setEd((o) => { const n = { ...o }; delete n[v.id]; return n })}>desfazer</button>}
                {l.mudou && l.sv > 100 && !erro(l) && <small className="fonte"> acima de 100%</small>}</td>
            </tr>)
        })}</tbody>
      </table></div>
      <div className="e-acoes">
        <button className="e-primario" disabled={!alterados.length || comErro.length > 0 || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : alterados.length ? `Salvar ${alterados.length} estimativa(s)` : 'Nenhuma alteração'}</button>
        {comErro.length > 0 && <span className="p-msg ruim">{comErro.map((l) => `${l.v.codigo}: ${erro(l)}`).join(' · ')}</span>}
      </div>
      <p className="p-nota">Digite a <b>biomassa atual</b> (ex.: pela despesca-teste ou tarrafa) e a sobrevivência é recalculada:
        sobrevivência = (biomassa ÷ último peso + já despescado) ÷ PL povoadas. Ou digite a sobrevivência direto. Ao salvar, essa porcentagem
        vale daí em diante: a biomassa estimada acompanha as próximas biometrias (PL × sobrevivência × peso). Pode passar de 100%
        (o laboratório às vezes manda mais larvas); o limite é 130%. O plano de ração também grava a sobrevivência — vale a mais recente.</p>
    </section>
  )
}
