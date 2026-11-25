// Escritório: acompanhamento dos lançamentos do campo (ração, biometria, água, ocorrências, insumos) de todos os viveiros,
// com resumo por viveiro, gráficos, histórico do período e o formulário de lançamento ao lado.
// Lê direto do banco (precisa de sinal); correções e exclusões ficam em Lançamentos (admin).
import { useEffect, useState, useMemo } from 'react'
import { supabase, hoje, MODO_DEMO } from './data'

const fmt = (n, d = 1) => n == null || Number.isNaN(Number(n)) ? '–'
  : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''
const ddmm = (iso) => dataBR(iso).slice(0, 5)
// quando o registro chegou ao servidor (log): dd/mm hh:mm no horário do aparelho
const registrado = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}` }
const hhmm = (h) => (h ? String(h).slice(0, 5) : '')
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5)
const diasAntes = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const N = (x) => (x == null ? null : Number(x))
const RESULT = { zerou: 'Zerou', pouca_sobra: 'Pouca sobra', muita_sobra: 'Muita sobra' }
const RES_CURTO = { zerou: 'Z', pouca_sobra: 'P', muita_sobra: 'M' }
const TIPOS_OC = { mortalidade: 'Mortalidade', doenca: 'Doença / sinais', manutencao: 'Manutenção', outro: 'Outro' }
// cores fixas por viveiro (mesma cor em todos os gráficos)
const CORES = ['#0f4c5c', '#e36414', '#2f7d4f', '#7b4fa0', '#b8860b', '#c0392b', '#3a7bd5', '#6b777b', '#8c564b', '#17becf']
const cvClasses = (cl) => {
  const n = (cl || []).reduce((a, c) => a + c.qtd, 0)
  if (!n) return null
  const m = cl.reduce((a, c) => a + c.g * c.qtd, 0) / n
  return m ? (Math.sqrt(cl.reduce((a, c) => a + c.qtd * (c.g - m) ** 2, 0) / n) / m) * 100 : null
}

// busca paginada (o servidor devolve no máximo 1000 linhas por vez)
async function buscar(tabela, select, ids, desde) {
  let todos = []
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(select).in('ciclo_id', ids)
    if (desde) q = q.gte('data', desde)
    const { data, error } = await q.order('data', { ascending: false }).range(de, de + 999)
    if (error) throw error
    todos = todos.concat(data || [])
    if (!data || data.length < 1000) break
  }
  return todos
}

function useDados(viveiros, online, periodo, consultas) {
  const ativos = viveiros.filter((v) => v.ciclo)
  const ids = ativos.map((v) => v.ciclo.id).join(',')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  useEffect(() => {
    if (MODO_DEMO || !online || !ids) return
    let vivo = true
    setDados(null); setErro(null)
    const desde = periodo === 'ciclo' ? null : diasAntes(Number(periodo) - 1)
    Promise.all(consultas.map(([t, s]) => buscar(t, s, ids.split(','), desde)))
      .then((r) => vivo && setDados(r)).catch((e) => vivo && setErro(e.message || String(e)))
    return () => { vivo = false }
  }, [ids, online, periodo]) // eslint-disable-line
  return { dados, erro }
}

// ---------- moldura comum: filtros + conteúdo + formulário ao lado ----------
function Moldura({ viveiros, vid, setVid, periodo, setPeriodo, erro, carregando, children, form, tituloForm }) {
  const ativos = viveiros.filter((v) => v.ciclo)
  return (
    <div className="painel e-duas e-acomp">
      <div className="e-col">
        <div className="e-filtros">
          <div className="chips-v" role="group" aria-label="Viveiro">
            <button className={!vid ? 'sel' : ''} onClick={() => setVid(null)}>Todos</button>
            {ativos.map((v) => <button key={v.id} className={vid === v.id ? 'sel' : ''} onClick={() => setVid(v.id)}>{v.codigo}</button>)}
          </div>
          <label>Período <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="7">últimos 7 dias</option><option value="15">últimos 15 dias</option><option value="30">últimos 30 dias</option>
            <option value="90">últimos 90 dias</option><option value="ciclo">ciclo atual inteiro</option></select></label>
        </div>
        {MODO_DEMO && <p className="p-vazio">Na demonstração o histórico do servidor não aparece; o resumo usa só os dados de exemplo.</p>}
        {erro && <p className="p-erro">Não foi possível carregar: {erro}</p>}
        {carregando && <p className="p-vazio">Carregando…</p>}
        {children}
      </div>
      <section className="p-bloco e-form"><h2>{tituloForm}</h2>{form}</section>
    </div>
  )
}

function useFiltros() {
  const [vid, setVid] = useState(null)
  const [periodo, setPeriodo] = useState('30')
  return { vid, setVid, periodo, setPeriodo }
}
const mapaCiclos = (viveiros) => Object.fromEntries(viveiros.filter((v) => v.ciclo).map((v, i) => [v.ciclo.id, { ...v, cor: CORES[i % CORES.length] }]))

// ---------- gráfico de linhas (uma por viveiro) ----------
function Linhas({ series, xFmt = (x) => x, yFmt = (y) => fmt(y, 1), refX, refY, rotuloY, altura = 240 }) {
  const pts = series.flatMap((s) => s.pontos)
  if (!pts.length) return <p className="p-vazio">Sem dados no período.</p>
  const W = 720, H = altura, m = { l: 44, r: 12, t: 12, b: 26 }
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x))
  if (refX != null) x1 = Math.max(x1, refX)
  if (x1 === x0) x1 = x0 + 1
  const ys = pts.map((p) => p.y).concat(refY != null ? [refY] : [])
  let y0 = Math.min(0, ...ys), y1 = Math.max(...ys) * 1.08 || 1
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r)
  const Y = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + (y1 - y0) * f)
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + (x1 - x0) * f)
  return (
    <figure className="e-grafico">
      {rotuloY && <figcaption>{rotuloY}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rotuloY || 'gráfico'}>
        {ticks.map((t, i) => <g key={i}><line className="grade" x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} /><text x={m.l - 6} y={Y(t) + 4} textAnchor="end">{yFmt(t)}</text></g>)}
        {xt.map((t, i) => <text key={i} x={X(t)} y={H - 8} textAnchor="middle">{xFmt(t)}</text>)}
        {refX != null && <line className="ref" x1={X(refX)} x2={X(refX)} y1={m.t} y2={H - m.b} />}
        {refY != null && <line className="ref" x1={m.l} x2={W - m.r} y1={Y(refY)} y2={Y(refY)} />}
        {series.map((s) => {
          const p = [...s.pontos].sort((a, b) => a.x - b.x)
          return (
            <g key={s.nome}>
              <polyline fill="none" stroke={s.cor} strokeWidth="2" points={p.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')} />
              {p.map((q, i) => <circle key={i} cx={X(q.x)} cy={Y(q.y)} r="3.5" fill={s.cor}><title>{`${s.nome} · ${q.rot || xFmt(q.x)}: ${yFmt(q.y)}`}</title></circle>)}
            </g>)
        })}
      </svg>
      {series.length > 1 && <div className="e-legenda">{series.map((s) => <span key={s.nome}><i style={{ background: s.cor }} />{s.nome}</span>)}</div>}
    </figure>
  )
}
const diaNum = (iso) => Math.round(new Date(iso + 'T12:00:00') / 864e5)
const diaIso = (n) => new Date(n * 864e5).toISOString().slice(0, 10)

// ======================= RAÇÃO =======================
export function PaginaRacao({ viveiros, produtos, online, children }) {
  const f = useFiltros()
  const { dados, erro } = useDados(viveiros, online, f.periodo, [
    ['vw_racao_diaria', 'ciclo_id, data, lanco_kg, bandejas_kg, sobra_kg, colocado_kg, consumido_kg'],
    ['bandeja_colocacoes', 'id, ciclo_id, data, hora, kg_bandejas, produto_id, lancado_por, criado_em, bandeja_retiradas(hora, sobra_kg, resultado, lancado_por, criado_em)'],
    ['racao', 'id, ciclo_id, data, hora, trato, kg, produto_id, lancado_por, fora_estoque, criado_em'],
    ['pesagens', '*'],
  ])
  const [dias, bandejas, tratos, pesagens] = dados || [[], [], [], []]
  const nomeProd = (id) => produtos.find((p) => p.id === id)?.nome || '—'
  const vis = viveiros.filter((v) => v.emCultivo && (!f.vid || v.id === f.vid))
  const datas = [...new Set(dias.map((d) => d.data))].sort().reverse()
  const dia = (cid, data) => dias.find((d) => d.ciclo_id === cid && d.data === data)
  const resDia = (cid, data) => bandejas.find((b) => b.ciclo_id === cid && b.data === data && b.bandeja_retiradas?.[0])?.bandeja_retiradas[0]
  const media = (v, n) => { const l = dias.filter((d) => d.ciclo_id === v.ciclo.id && d.data >= diasAntes(n) && d.data < hoje()); return l.length ? l.reduce((s, d) => s + N(d.colocado_kg), 0) / l.length : null }
  const fca = (v) => { const bio = (v.biomassaPrevista || 0) + (v.biomassaDespescada || 0); return bio > 0 && v.racaoConsumida > 0 ? v.racaoConsumida / bio : null }
  const totPer = (v) => dias.filter((d) => d.ciclo_id === v.ciclo.id).reduce((s, d) => s + N(d.colocado_kg), 0)
  return (
    <Moldura {...f} viveiros={viveiros} erro={erro} carregando={!dados && !erro && online && !MODO_DEMO} form={children} tituloForm="Lançar trato ou bandejas">
      <section className="p-bloco">
        <h2>Resumo por viveiro</h2>
        <div className="p-tabela"><table>
          <thead><tr><th>Viveiro</th><th className="n">Dias</th><th className="n">Plano kg/dia</th><th className="n">Hoje</th><th className="n">% do plano</th><th className="n">Tratos hoje</th><th className="n">Pesados hoje</th>
            <th className="n">Ontem</th><th className="n">Média 7 dias</th><th>Bandejas (última)</th><th className="n">No período</th><th className="n">Consumida no ciclo</th><th className="n">FCA parcial</th></tr></thead>
          <tbody>{vis.map((v) => {
            const ck = v.bandejaHoje?.retirada || v.bandejaOntem?.retirada
            const pct = v.plano?.kg_dia ? (v.kgHoje / v.plano.kg_dia) * 100 : null
            return (
              <tr key={v.id}>
                <td><b>{v.codigo}</b></td><td className="n">{v.dias}</td>
                <td className="n">{v.plano ? fmt(v.plano.kg_dia, 1) : '–'}{v.plano?.padrao && <small className="fonte"> padrão</small>}</td>
                <td className="n"><b>{fmt(v.kgHoje, 1)}</b></td>
                <td className={`n ${pct != null && pct < 80 && new Date().getHours() >= 17 ? 'ruim' : ''}`}>{pct != null ? `${fmt(pct, 0)}%` : '–'}</td>
                <td className="n">{v.tratosHoje.length} de {v.plano?.tratos?.length || 4}</td>
                <td className="n">{Object.keys(v.pesado || {}).length}</td>
                <td className="n">{fmt(v.racaoOntem, 1)}</td>
                <td className="n">{dados ? fmt(media(v, 7), 1) : '–'}</td>
                <td className={ck ? `ck-${ck.resultado}` : ''}>{ck ? `${RESULT[ck.resultado]} (${v.bandejaHoje?.retirada ? 'hoje' : 'ontem'})` : '–'}</td>
                <td className="n">{dados ? `${fmt(totPer(v), 0)} kg` : '–'}</td>
                <td className="n">{fmt(v.racaoConsumida, 0)} kg</td>
                <td className="n">{fmt(fca(v), 2)}</td>
              </tr>)
          })}</tbody>
          <tfoot><tr><td><b>Total</b></td><td /><td className="n"><b>{fmt(vis.reduce((s, v) => s + (v.plano?.kg_dia || 0), 0), 0)}</b></td>
            <td className="n"><b>{fmt(vis.reduce((s, v) => s + v.kgHoje, 0), 0)}</b></td><td colSpan={3} />
            <td className="n"><b>{fmt(vis.reduce((s, v) => s + v.racaoOntem, 0), 0)}</b></td><td colSpan={2} />
            <td className="n"><b>{dados ? `${fmt(vis.reduce((s, v) => s + totPer(v), 0), 0)} kg` : '–'}</b></td>
            <td className="n"><b>{fmt(vis.reduce((s, v) => s + (v.racaoConsumida || 0), 0), 0)} kg</b></td><td /></tr></tfoot>
        </table></div>
        <p className="p-nota">Colocado = lanço + ração das bandejas. Consumida = colocado − sobra (inclui o consumo anterior ao sistema). FCA parcial = consumida ÷ (biomassa estimada + despescada).</p>
      </section>

      {dados && (
        <section className="p-bloco">
          <h2>Ração colocada por dia (kg)</h2>
          {datas.length === 0 ? <p className="p-vazio">Sem lançamentos no período.</p> : (
            <div className="p-tabela e-matriz"><table>
              <thead><tr><th>Data</th>{vis.map((v) => <th key={v.id} className="n">{v.codigo}</th>)}<th className="n">Total</th></tr></thead>
              <tbody>{datas.map((d) => (
                <tr key={d}><td>{dataBR(d)}</td>
                  {vis.map((v) => {
                    const x = dia(v.ciclo.id, d), r = resDia(v.ciclo.id, d)
                    return <td key={v.id} className="n" title={x ? `lanço ${fmt(N(x.lanco_kg))} · bandejas ${fmt(N(x.bandejas_kg))} · sobra ${fmt(N(x.sobra_kg), 2)} kg${r ? ` · ${RESULT[r.resultado]}` : ''}` : ''}>
                      {x ? fmt(N(x.colocado_kg), 0) : ''}{r && <span className={`e-res ck-${r.resultado}`}>{RES_CURTO[r.resultado]}</span>}</td>
                  })}
                  <td className="n"><b>{fmt(vis.reduce((s, v) => s + N(dia(v.ciclo.id, d)?.colocado_kg || 0), 0), 0)}</b></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="p-nota">Letra ao lado = resultado das bandejas no dia: <b>Z</b> zerou · <b>P</b> pouca sobra (≤ 20%) · <b>M</b> muita sobra (&gt; 20%). Passe o mouse para ver lanço, bandejas e sobra.</p>
        </section>
      )}

      {dados && f.vid && (() => {
        const v = viveiros.find((x) => x.id === f.vid)
        const tr = tratos.filter((t) => t.ciclo_id === v.ciclo.id)
        const bd = bandejas.filter((b) => b.ciclo_id === v.ciclo.id)
        const serie = [...dias.filter((d) => d.ciclo_id === v.ciclo.id)].sort((a, b) => a.data.localeCompare(b.data))
        return (<>
          <section className="p-bloco">
            <h2>{v.codigo} · colocado × consumido por dia</h2>
            <Linhas rotuloY="kg por dia" xFmt={(x) => ddmm(diaIso(Math.round(x)))} yFmt={(y) => fmt(y, 0)} refY={v.plano?.kg_dia}
              series={[{ nome: 'Colocado', cor: CORES[0], pontos: serie.map((d) => ({ x: diaNum(d.data), y: N(d.colocado_kg), rot: dataBR(d.data) })) },
                { nome: 'Consumido', cor: CORES[1], pontos: serie.map((d) => ({ x: diaNum(d.data), y: N(d.consumido_kg), rot: dataBR(d.data) })) }]} />
            {v.plano && <p className="p-nota">Linha tracejada = plano atual ({fmt(v.plano.kg_dia, 1)} kg/dia).</p>}
          </section>
          <section className="p-bloco">
            <h2>{v.codigo} · bandejas</h2>
            {bd.length === 0 ? <p className="p-vazio">Nenhuma checagem no período.</p> : (
              <div className="p-tabela"><table><thead><tr><th>Data</th><th>Colocação</th><th className="n">Colocado</th><th>Retirada</th><th className="n">Intervalo</th><th className="n">Sobra</th><th className="n">% sobra</th><th>Resultado</th><th>Lançado por</th><th>Registrado em</th></tr></thead>
                <tbody>{bd.map((b) => {
                  const r = b.bandeja_retiradas?.[0]
                  const min = r ? (new Date('2000-01-01T' + hhmm(r.hora)) - new Date('2000-01-01T' + hhmm(b.hora))) / 60000 : null
                  return (
                    <tr key={b.id}><td>{dataBR(b.data)}</td><td>{hhmm(b.hora)}</td><td className="n">{fmt(N(b.kg_bandejas), 2)} kg</td>
                      <td>{r ? hhmm(r.hora) : <em>sem retirada</em>}</td><td className="n">{min != null && min >= 0 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}` : '–'}</td>
                      <td className="n">{r ? `${fmt(N(r.sobra_kg), 2)} kg` : '–'}</td>
                      <td className="n">{r && N(b.kg_bandejas) > 0 ? `${fmt(N(r.sobra_kg) / N(b.kg_bandejas) * 100, 0)}%` : '–'}</td>
                      <td className={r ? `ck-${r.resultado}` : ''}>{r ? RESULT[r.resultado] : '–'}</td><td>{[b.lancado_por, r?.lancado_por].filter(Boolean).join(' / ')}</td><td>{[registrado(b.criado_em), r && registrado(r.criado_em)].filter(Boolean).join(' / ')}</td></tr>)
                })}</tbody></table></div>
            )}
          </section>
          <section className="p-bloco">
            <h2>{v.codigo} · pesagens</h2>
            {(() => { const pz = pesagens.filter((x) => x.ciclo_id === v.ciclo.id).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
              return pz.length === 0 ? <p className="p-vazio">Nenhuma pesagem no período.</p> : (
                <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th className="n">Trato</th><th>Ração</th><th className="n">Lanço</th><th className="n">Bandejas</th><th>Pesado por</th><th>Registrado em</th></tr></thead>
                  <tbody>{pz.map((x) => <tr key={x.id}><td>{dataBR(x.data)}</td><td>{hhmm(x.hora)}</td><td className="n">{x.trato}º</td><td>{nomeProd(x.produto_id)}</td>
                    <td className="n">{fmt(N(x.kg_lanco), 1)}</td><td className="n">{N(x.kg_bandeja) ? fmt(N(x.kg_bandeja), 2) : '–'}</td><td>{x.lancado_por}</td><td>{registrado(x.criado_em)}</td></tr>)}</tbody></table></div>) })()}
          </section>
          <section className="p-bloco">
            <h2>{v.codigo} · tratos a lanço</h2>
            {tr.length === 0 ? <p className="p-vazio">Nenhum trato no período.</p> : (
              <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th className="n">Trato</th><th>Ração</th><th className="n">kg</th><th className="n">Pesado</th><th>Lançado por</th><th>Registrado em</th></tr></thead>
                <tbody>{tr.map((t) => {
                  const pz = pesagens.filter((x) => x.ciclo_id === t.ciclo_id && x.data === t.data && x.trato === t.trato).sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0]
                  return <tr key={t.id}><td>{dataBR(t.data)}</td><td>{hhmm(t.hora)}</td><td className="n">{t.trato}º</td><td>{nomeProd(t.produto_id)}{t.fora_estoque && <small className="fonte"> histórico</small>}</td>
                    <td className="n">{fmt(N(t.kg), 1)}</td><td className="n" title={pz ? `pesado às ${hhmm(pz.hora)} por ${pz.lancado_por || '?'}` : ''}>{pz ? fmt(N(pz.kg_lanco), 1) : '–'}</td>
                    <td>{t.lancado_por}</td><td>{registrado(t.criado_em)}</td></tr>
                })}</tbody></table></div>
            )}
          </section>
        </>)
      })()}
      {dados && !f.vid && <p className="p-nota">Escolha um viveiro acima para ver o gráfico, as bandejas e cada trato.</p>}
    </Moldura>
  )
}

// ======================= BIOMETRIA =======================
export function PaginaBiometria({ viveiros, online, children }) {
  const f = useFiltros()
  const { dados, erro } = useDados(viveiros, online, f.periodo === '7' || f.periodo === '15' ? '30' : f.periodo, [
    ['biometrias', 'id, ciclo_id, data, hora, tipo, classes, n_amostra, peso_total_g, peso_medio_g, lancado_por, criado_em'],
  ])
  // biometria tem poucos pontos: o período mínimo é 30 dias; para a curva usa-se o ciclo inteiro quando escolhido
  const cic = mapaCiclos(viveiros)
  const bios = (dados?.[0] || []).filter((b) => cic[b.ciclo_id] && (!f.vid || cic[b.ciclo_id].id === f.vid))
  const simples = bios.filter((b) => b.tipo !== 'classes').sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
  const vis = viveiros.filter((v) => v.emCultivo && (!f.vid || v.id === f.vid))
  const ganhoEntre = (a, b) => { const d = diasEntre(a.data, b.data); return d > 0 ? (N(b.peso_medio_g) - N(a.peso_medio_g)) / d * 7 : null }
  const lista = [...bios].sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
  return (
    <Moldura {...f} viveiros={viveiros} erro={erro} carregando={!dados && !erro && online && !MODO_DEMO} form={children} tituloForm="Lançar biometria">
      <section className="p-bloco">
        <h2>Resumo por viveiro</h2>
        <div className="p-tabela"><table>
          <thead><tr><th>Viveiro</th><th className="n">Dias</th><th className="n">Peso atual</th><th>Data</th><th className="n">Há</th><th className="n">Anterior</th>
            <th className="n">Ganho g/sem</th><th className="n">Média g/sem no ciclo</th><th className="n">Biometrias no período</th><th className="n">CV (tamanho)</th></tr></thead>
          <tbody>{vis.map((v) => {
            const b = simples.filter((x) => x.ciclo_id === v.ciclo.id)
            const ult = v.ultimaBio, ant = b.length >= 2 ? b[b.length - 2] : null
            const g = b.length >= 2 ? ganhoEntre(b[b.length - 2], b[b.length - 1]) : null
            const gm = ult && v.dias > 0 ? N(ult.peso_medio_g) / v.dias * 7 : null
            const ha = ult ? diasEntre(ult.data, hoje()) : null
            return (
              <tr key={v.id} className={ha == null || ha > 10 ? 'atencao' : ''}>
                <td><b>{v.codigo}</b></td><td className="n">{v.dias}</td>
                <td className="n"><b>{ult ? `${fmt(N(ult.peso_medio_g), 2)} g` : '–'}</b></td><td>{ult ? dataBR(ult.data) : 'sem biometria'}</td>
                <td className="n">{ha != null ? `${ha} d` : '–'}</td>
                <td className="n">{ant ? `${fmt(N(ant.peso_medio_g), 2)} g` : '–'}</td>
                <td className={`n ${g != null && g < 0.5 ? 'ruim' : ''}`}>{fmt(g, 2)}</td><td className="n">{fmt(gm, 2)}</td>
                <td className="n">{dados ? b.length : '–'}</td>
                <td className={`n ${v.uniformidade?.cv > 30 ? 'ruim' : ''}`}>{v.uniformidade?.cv != null ? `${fmt(v.uniformidade.cv, 0)}%` : '–'}</td>
              </tr>)
          })}</tbody>
        </table></div>
        <p className="p-nota">Peso = biometria por peso total (nº de camarões + peso). A biometria por tamanho só mede a uniformidade (CV: até 20% boa, acima de 30% ruim). Linha em amarelo: sem biometria ou última há mais de 10 dias.</p>
      </section>
      {dados && (
        <section className="p-bloco">
          <h2>Curva de crescimento</h2>
          <Linhas rotuloY="Peso médio (g) × dias de cultivo" xFmt={(x) => `${Math.round(x)} d`} yFmt={(y) => fmt(y, 1)} refX={90}
            series={vis.map((v) => ({ nome: v.codigo, cor: cic[v.ciclo.id].cor,
              pontos: simples.filter((b) => b.ciclo_id === v.ciclo.id && v.ciclo.data_povoamento)
                .map((b) => ({ x: diasEntre(v.ciclo.data_povoamento, b.data), y: N(b.peso_medio_g), rot: `${dataBR(b.data)} (${diasEntre(v.ciclo.data_povoamento, b.data)} d)` })) }))
              .filter((s) => s.pontos.length)} />
          <p className="p-nota">Linha tracejada em 90 dias de cultivo. Período mínimo do gráfico: 30 dias (escolha “ciclo atual inteiro” para a curva completa).</p>
        </section>
      )}
      {dados && (
        <section className="p-bloco">
          <h2>Biometrias do período</h2>
          {lista.length === 0 ? <p className="p-vazio">Nenhuma biometria no período.</p> : (
            <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th>Viveiro</th><th className="n">Dias</th><th>Tipo</th><th className="n">Camarões</th><th className="n">Peso total</th><th className="n">Peso médio</th><th className="n">Ganho g/sem</th><th className="n">CV</th><th>Lançado por</th><th>Registrado em</th></tr></thead>
              <tbody>{lista.map((b) => {
                const v = cic[b.ciclo_id]
                const prev = b.tipo !== 'classes' ? [...simples].reverse().find((x) => x.ciclo_id === b.ciclo_id && (x.data + x.hora) < (b.data + b.hora)) : null
                return (
                  <tr key={b.id}><td>{dataBR(b.data)}</td><td>{hhmm(b.hora)}</td><td><b>{v.codigo}</b></td>
                    <td className="n">{v.ciclo.data_povoamento ? diasEntre(v.ciclo.data_povoamento, b.data) : '–'}</td>
                    <td>{b.tipo === 'classes' ? 'por tamanho' : 'peso total'}</td><td className="n">{b.n_amostra}</td><td className="n">{fmt(N(b.peso_total_g), 0)} g</td>
                    <td className="n"><b>{fmt(N(b.peso_medio_g), 2)} g</b></td><td className="n">{prev ? fmt(ganhoEntre(prev, b), 2) : '–'}</td>
                    <td className="n">{b.tipo === 'classes' ? `${fmt(cvClasses(b.classes), 0)}%` : ''}</td><td>{b.lancado_por}</td><td>{registrado(b.criado_em)}</td></tr>)
              })}</tbody></table></div>
          )}
        </section>
      )}
    </Moldura>
  )
}

// ======================= ÁGUA =======================
const PARAM = {
  od: { nome: 'Oxigênio (mg/L)', curto: 'OD', fora: (x) => x < 3 },
  ph: { nome: 'pH', curto: 'pH', fora: (x) => x < 7 || x > 9.5 },
  temperatura: { nome: 'Temperatura (°C)', curto: 'T °C', fora: (x) => x > 33 },
  salinidade: { nome: 'Salinidade (ppt)', curto: 'Sal.', fora: () => false },
  transparencia: { nome: 'Transparência (cm)', curto: 'Transp.', fora: () => false },
}
export function PaginaAgua({ viveiros, online, children }) {
  const f = useFiltros()
  const [param, setParam] = useState('od')
  const { dados, erro } = useDados(viveiros, online, f.periodo, [['agua', '*']])
  const cic = mapaCiclos(viveiros)
  const lista = (dados?.[0] || []).filter((a) => cic[a.ciclo_id] && (!f.vid || cic[a.ciclo_id].id === f.vid))
    .sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
  const vis = viveiros.filter((v) => v.ciclo && (!f.vid || v.id === f.vid))
  const t = (a) => diaNum(a.data) + (Number(hhmm(a.hora).slice(0, 2)) * 60 + Number(hhmm(a.hora).slice(3))) / 1440
  return (
    <Moldura {...f} viveiros={viveiros} erro={erro} carregando={!dados && !erro && online && !MODO_DEMO} form={children} tituloForm="Lançar qualidade da água">
      {dados && (<>
        <section className="p-bloco">
          <h2>Última leitura por viveiro</h2>
          <div className="p-tabela"><table>
            <thead><tr><th>Viveiro</th><th>Data</th>{Object.values(PARAM).map((p) => <th key={p.curto} className="n">{p.curto}</th>)}<th className="n">OD mínimo no período</th><th className="n">Leituras</th></tr></thead>
            <tbody>{vis.map((v) => {
              const l = lista.filter((a) => a.ciclo_id === v.ciclo.id)
              const u = l[0]
              const odMin = l.filter((a) => a.od != null).reduce((m, a) => (m == null || N(a.od) < N(m.od) ? a : m), null)
              return (
                <tr key={v.id}><td><b>{v.codigo}</b></td><td>{u ? `${dataBR(u.data)} ${hhmm(u.hora)}` : 'sem leitura'}</td>
                  {Object.entries(PARAM).map(([k, p]) => {
                    const ult = l.find((a) => a[k] != null)
                    return <td key={k} className={`n ${ult && p.fora(N(ult[k])) ? 'ruim' : ''}`} title={ult ? `${dataBR(ult.data)} ${hhmm(ult.hora)}` : ''}>{ult ? fmt(N(ult[k]), k === 'od' || k === 'ph' ? 2 : 1) : '–'}</td>
                  })}
                  <td className={`n ${odMin && N(odMin.od) < 3 ? 'ruim' : ''}`}>{odMin ? `${fmt(N(odMin.od), 2)} (${ddmm(odMin.data)} ${hhmm(odMin.hora)})` : '–'}</td>
                  <td className="n">{l.length}</td></tr>)
            })}</tbody>
          </table></div>
          <p className="p-nota">Em vermelho: OD &lt; 3 mg/L, pH fora de 7–9,5, temperatura &gt; 33 °C.</p>
        </section>
        <section className="p-bloco">
          <h2>Evolução</h2>
          <div className="chips-v" role="group" aria-label="Parâmetro">
            {Object.entries(PARAM).map(([k, p]) => <button key={k} className={param === k ? 'sel' : ''} onClick={() => setParam(k)}>{p.nome}</button>)}
          </div>
          <Linhas rotuloY={PARAM[param].nome} xFmt={(x) => ddmm(diaIso(Math.floor(x)))} yFmt={(y) => fmt(y, 1)} refY={param === 'od' ? 3 : param === 'temperatura' ? 33 : undefined}
            series={vis.map((v) => ({ nome: v.codigo, cor: cic[v.ciclo.id].cor,
              pontos: lista.filter((a) => a.ciclo_id === v.ciclo.id && a[param] != null).map((a) => ({ x: t(a), y: N(a[param]), rot: `${dataBR(a.data)} ${hhmm(a.hora)}` })) }))
              .filter((s) => s.pontos.length)} />
        </section>
        <section className="p-bloco">
          <h2>Leituras do período</h2>
          {lista.length === 0 ? <p className="p-vazio">Nenhuma leitura no período.</p> : (
            <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th>Viveiro</th>{Object.values(PARAM).map((p) => <th key={p.curto} className="n">{p.curto}</th>)}<th>Lançado por</th><th>Registrado em</th></tr></thead>
              <tbody>{lista.map((a) => <tr key={a.id}><td>{dataBR(a.data)}</td><td>{hhmm(a.hora)}</td><td><b>{cic[a.ciclo_id].codigo}</b></td>
                {Object.entries(PARAM).map(([k, p]) => <td key={k} className={`n ${a[k] != null && p.fora(N(a[k])) ? 'ruim' : ''}`}>{a[k] != null ? fmt(N(a[k]), k === 'od' || k === 'ph' ? 2 : 1) : ''}</td>)}
                <td>{a.lancado_por}</td><td>{registrado(a.criado_em)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </>)}
    </Moldura>
  )
}

// ======================= OCORRÊNCIAS =======================
export function PaginaOcorrencias({ viveiros, online, children }) {
  const f = useFiltros()
  const [tipo, setTipo] = useState('')
  const { dados, erro } = useDados(viveiros, online, f.periodo, [['ocorrencias', '*']])
  const cic = mapaCiclos(viveiros)
  const todas = (dados?.[0] || []).filter((o) => cic[o.ciclo_id] && (!f.vid || cic[o.ciclo_id].id === f.vid))
  const lista = todas.filter((o) => !tipo || o.tipo === tipo).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
  const vis = viveiros.filter((v) => v.ciclo && (!f.vid || v.id === f.vid))
  return (
    <Moldura {...f} viveiros={viveiros} erro={erro} carregando={!dados && !erro && online && !MODO_DEMO} form={children} tituloForm="Lançar ocorrência">
      {dados && (<>
        <section className="p-bloco">
          <h2>Resumo do período por viveiro</h2>
          <div className="p-tabela"><table>
            <thead><tr><th>Viveiro</th><th className="n">Mortalidade (camarões)</th><th className="n">% das PL</th>{Object.values(TIPOS_OC).map((t) => <th key={t} className="n">{t}</th>)}<th>Última</th></tr></thead>
            <tbody>{vis.map((v) => {
              const l = todas.filter((o) => o.ciclo_id === v.ciclo.id)
              const mort = l.filter((o) => o.tipo === 'mortalidade').reduce((s, o) => s + (o.quantidade || 0), 0)
              const u = [...l].sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))[0]
              return (
                <tr key={v.id}><td><b>{v.codigo}</b></td><td className="n">{mort ? mort.toLocaleString('pt-BR') : '–'}</td>
                  <td className="n">{mort && v.pl ? `${fmt(mort / v.pl * 100, 2)}%` : '–'}</td>
                  {Object.keys(TIPOS_OC).map((k) => <td key={k} className="n">{l.filter((o) => o.tipo === k).length || '–'}</td>)}
                  <td>{u ? `${dataBR(u.data)} · ${TIPOS_OC[u.tipo]}` : '–'}</td></tr>)
            })}</tbody>
          </table></div>
        </section>
        <section className="p-bloco">
          <h2>Ocorrências do período</h2>
          <div className="chips-v" role="group" aria-label="Tipo">
            <button className={!tipo ? 'sel' : ''} onClick={() => setTipo('')}>Todas</button>
            {Object.entries(TIPOS_OC).map(([k, n]) => <button key={k} className={tipo === k ? 'sel' : ''} onClick={() => setTipo(k)}>{n}</button>)}
          </div>
          {lista.length === 0 ? <p className="p-vazio">Nenhuma ocorrência no período.</p> : (
            <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th>Viveiro</th><th>Tipo</th><th className="n">Quantidade</th><th>Descrição</th><th>Lançado por</th><th>Registrado em</th></tr></thead>
              <tbody>{lista.map((o) => <tr key={o.id}><td>{dataBR(o.data)}</td><td>{hhmm(o.hora)}</td><td><b>{cic[o.ciclo_id].codigo}</b></td><td>{TIPOS_OC[o.tipo]}</td>
                <td className="n">{o.quantidade ? o.quantidade.toLocaleString('pt-BR') : ''}</td><td className="e-quebra">{o.descricao}</td><td>{o.lancado_por}</td><td>{registrado(o.criado_em)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </>)}
    </Moldura>
  )
}

// ======================= INSUMOS =======================
export function PaginaInsumos({ viveiros, produtos, online, children }) {
  const f = useFiltros()
  const { dados, erro } = useDados(viveiros, online, f.periodo, [['aplicacoes_insumos', '*']])
  const cic = mapaCiclos(viveiros)
  const lista = (dados?.[0] || []).filter((a) => cic[a.ciclo_id] && (!f.vid || cic[a.ciclo_id].id === f.vid))
    .sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
  const vis = viveiros.filter((v) => v.ciclo && (!f.vid || v.id === f.vid))
  const prod = (id) => produtos.find((p) => p.id === id)
  const usados = useMemo(() => [...new Set(lista.map((a) => a.produto_id))].sort((a, b) => (prod(a)?.nome || '').localeCompare(prod(b)?.nome || '', 'pt-BR')), [lista]) // eslint-disable-line
  const soma = (pid, cid) => lista.filter((a) => a.produto_id === pid && (!cid || a.ciclo_id === cid)).reduce((s, a) => s + N(a.quantidade), 0)
  return (
    <Moldura {...f} viveiros={viveiros} erro={erro} carregando={!dados && !erro && online && !MODO_DEMO} form={children} tituloForm="Lançar aplicação de insumo">
      {dados && (<>
        <section className="p-bloco">
          <h2>Total aplicado no período</h2>
          {usados.length === 0 ? <p className="p-vazio">Nenhuma aplicação no período.</p> : (
            <div className="p-tabela"><table>
              <thead><tr><th>Produto</th>{vis.map((v) => <th key={v.id} className="n">{v.codigo}</th>)}<th className="n">Total</th></tr></thead>
              <tbody>{usados.map((pid) => (
                <tr key={pid}><td>{prod(pid)?.nome || 'produto inativo'}</td>
                  {vis.map((v) => { const q = soma(pid, v.ciclo.id); return <td key={v.id} className="n">{q ? fmt(q, q % 1 ? 1 : 0) : ''}</td> })}
                  <td className="n"><b>{fmt(soma(pid), 0)} {prod(pid)?.unidade}</b></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="p-nota">Em preparação o campo já pode lançar insumos (calagem, fertilização). O custo entra no ciclo pelo preço médio do estoque.</p>
        </section>
        <section className="p-bloco">
          <h2>Aplicações do período</h2>
          {lista.length === 0 ? <p className="p-vazio">Nenhuma aplicação no período.</p> : (
            <div className="p-tabela"><table><thead><tr><th>Data</th><th>Hora</th><th>Viveiro</th><th>Produto</th><th className="n">Quantidade</th><th>Observação</th><th>Lançado por</th><th>Registrado em</th></tr></thead>
              <tbody>{lista.map((a) => <tr key={a.id}><td>{dataBR(a.data)}</td><td>{hhmm(a.hora)}</td><td><b>{cic[a.ciclo_id].codigo}</b></td><td>{prod(a.produto_id)?.nome || '—'}</td>
                <td className="n">{fmt(N(a.quantidade), 1)} {prod(a.produto_id)?.unidade}</td><td className="e-quebra">{a.observacao}</td><td>{a.lancado_por}</td><td>{registrado(a.criado_em)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </>)}
    </Moldura>
  )
}

// ======================= LOG DE ALTERAÇÕES (auditoria) =======================
// Toda correção ou exclusão de lançamento (admin em Lançamentos; gestor em ciclos, planos, estoque, previsões, configurações)
// fica gravada pelo banco: quem, quando, o que era e como ficou. Só leitura; gestor e admin veem.
const NOME_TABELA = { racao: 'Trato', pesagens: 'Pesagem', bandeja_colocacoes: 'Bandejas (colocação)', bandeja_retiradas: 'Bandejas (retirada)',
  biometrias: 'Biometria', agua: 'Água', ocorrencias: 'Ocorrência', aplicacoes_insumos: 'Insumo', planos_racao: 'Plano de ração',
  povoamentos: 'Povoamento', estimativas_sobrevivencia: 'Sobrevivência estimada', despescas: 'Despesca', estoque_movimentos: 'Estoque', previsoes_despesca: 'Previsão de despesca', ciclos: 'Ciclo', configuracoes: 'Configuração' }
const IGNORAR = new Set(['id', 'criado_em', 'criado_por', 'ciclo_id', 'colocacao_id', 'valor_prev'])
const mostra = (v) => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v)
export function LogAlteracoes({ viveiros, online }) {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState(null)
  useEffect(() => {
    if (MODO_DEMO || !online) return
    supabase.from('auditoria').select('*').order('quando', { ascending: false }).limit(300)
      .then(({ data, error }) => (error ? setErro(error.message) : setLinhas(data || [])))
  }, [online])
  const cod = (r) => { const cid = r.antes?.ciclo_id || r.antes?.id; return viveiros.find((v) => v.ciclo?.id === cid)?.codigo || r.antes?.codigo?.slice(0, 3) || '' }
  const mudou = (r) => r.acao === 'apagou' ? 'registro apagado'
    : Object.keys(r.depois || {}).filter((k) => !IGNORAR.has(k) && JSON.stringify(r.antes?.[k]) !== JSON.stringify(r.depois[k]))
      .map((k) => `${k}: ${mostra(r.antes?.[k])} → ${mostra(r.depois[k])}`).join(' · ')
  return (
    <section className="p-bloco">
      <h2>Log de alterações e exclusões</h2>
      {MODO_DEMO && <p className="p-vazio">Disponível só no sistema real.</p>}
      {erro && <p className="p-erro">{erro}</p>}
      {linhas && linhas.length === 0 && <p className="p-vazio">Nenhuma correção ou exclusão registrada.</p>}
      {linhas && linhas.length > 0 && (
        <div className="p-tabela"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Viveiro</th><th>Data do lançamento</th><th>Mudança</th></tr></thead>
          <tbody>{linhas.map((r) => (
            <tr key={r.id} className={r.acao === 'apagou' ? 'atencao' : ''}>
              <td>{registrado(r.quando)}</td><td>{r.usuario_nome || 'sistema'}</td>
              <td>{NOME_TABELA[r.tabela] || r.tabela} · {r.acao}</td><td>{cod(r)}</td>
              <td>{r.antes?.data ? `${dataBR(r.antes.data)} ${hhmm(r.antes.hora)}` : r.antes?.data_inicio ? dataBR(r.antes.data_inicio) : ''}</td>
              <td className="e-quebra">{mudou(r)}{r.antes?.lancado_por ? <small className="fonte"> (lançado por {r.antes.lancado_por})</small> : null}</td>
            </tr>))}</tbody></table></div>
      )}
      <p className="p-nota">Todo lançamento guarda quem lançou (usuário do login), o dia e a hora informados e quando chegou ao servidor. Correções e exclusões aparecem aqui com o antes e o depois — o registro é feito pelo banco e ninguém apaga.</p>
    </section>
  )
}
