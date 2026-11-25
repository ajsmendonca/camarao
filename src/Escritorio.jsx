// App do escritório (gestor/admin): menu lateral com as páginas de gestão.
// O coletor de campo (App.jsx) continua sendo o app do celular, enxuto e offline.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { carregarPainel, hoje, MODO_DEMO, salvarConfig, supabase, PRECO_PADRAO } from './data'
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
  ['painel', '📊', 'Painel'],
  ['ciclos', '🔄', 'Viveiros e ciclos'],
  ['plano', '📋', 'Plano de ração'],
  ['despescas', '🧺', 'Despescas'],
  ['estoque', '📦', 'Estoque'],
  ['financeiro', '💰', 'Financeiro'],
  ['lancamentos', '📝', 'Lançamentos'],
  ['cadastros', '🤝', 'Cadastros'],
  ['configuracoes', '⚙️', 'Configurações'],
]

export function Escritorio({ pagina, setPagina, usuario, online, pendentes, onEnvios, onColetor, onSair, children }) {
  const titulo = MENU.find((m) => m[0] === pagina)?.[2] || ''
  return (
    <div className="esc">
      <nav className="esc-menu" aria-label="Menu do escritório">
        <div className="esc-marca">🦐 <b>Barra Maricultura</b><small>Escritório</small></div>
        {MENU.map(([id, ic, nome]) => (
          <button key={id} className={pagina === id ? 'sel' : ''} aria-current={pagina === id ? 'page' : undefined}
            onClick={() => setPagina(id)}><span>{ic}</span>{nome}</button>
        ))}
        <div className="esc-rodape">
          <button onClick={onColetor}><span>📱</span>Coletor de campo</button>
          {onSair && <button onClick={onSair}><span>🚪</span>Sair</button>}
        </div>
      </nav>
      <div className="esc-corpo">
        <header className="esc-topo">
          <div className="titulo"><strong>{titulo}</strong><small>{usuario}{MODO_DEMO && ' · demonstração'} · {dataBR(hoje())}</small></div>
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
      <section className="p-bloco e-form">{children}</section>
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
      : kg !== Number(p.kg_dia) || l.produto !== p.produto_id || Number(l.tratos) !== (p.tratos?.length || tratosPadrao)
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
                  <td><b>{v.codigo}</b>{v.planoFuturo && <small className="fonte" title={`plano a partir de ${dataBR(v.planoFuturo.data_inicio)}: ${fmt(v.planoFuturo.kg_dia)} kg/dia`}> futuro</small>}</td>
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
          mudando o número de tratos, a divisão é igual — para dividir à mão, use “detalhar”. Biomassa est. = PL × sobrevivência × último peso.</p>
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
export function PaginaConfig({ cad, online, onAlterado, children }) {
  const tabela = { ...PRECO_PADRAO, ...(cad.config?.preco_venda || {}) }
  const impostoPct = Number(cad.config?.imposto_venda?.pct ?? 0)
  return (
    <div className="painel">
      <div className="p-grade">
        <TabelaPreco key={JSON.stringify(tabela)} tabela={tabela} online={online} onSalvo={onAlterado} />
        <Impostos key={impostoPct} pct={impostoPct} online={online} onSalvo={onAlterado} />
        <PrecoPL key={String(cad.config?.preco_pl_milheiro)} valor={Number(cad.config?.preco_pl_milheiro ?? 14)} online={online} onSalvo={onAlterado} />
      </div>
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
