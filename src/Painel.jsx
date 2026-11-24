// Painel do escritório (gestor, tela grande): situação de todos os viveiros, alertas, crescimento,
// ração diária, previsões de despesca, estoque e ciclos encerrados.
// Os custos do Apresenta.me entram numa próxima etapa.
import { useEffect, useState, useCallback } from 'react'
import { carregarPainel, hoje, MODO_DEMO } from './data'

const fmt = (n, d = 1) => n == null || Number.isNaN(n) ? '–'
  : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : ''
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5)
const mil = (n) => n == null ? '–' : n >= 1e6 ? `${fmt(n / 1e6, 2)} mi` : `${fmt(n / 1000, 0)} mil`
const reais = (n) => n == null ? '–' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const RESULT = { zerou: 'Zerou', pouca_sobra: 'Pouca sobra', muita_sobra: 'Muita sobra' }

export default function Painel({ cad, viveiros, produtos, previsoes, clientes, online, onVoltar }) {
  const [serie, setSerie] = useState(null)
  const [erro, setErro] = useState(null)
  const [atualizado, setAtualizado] = useState(null)
  const carregar = useCallback(async () => {
    setErro(null)
    try { setSerie(await carregarPainel(cad)); setAtualizado(new Date()) } catch (e) { setErro(e.message || String(e)) }
  }, [cad])
  useEffect(() => { if (online || MODO_DEMO) carregar() }, [online, carregar])

  const ativos = viveiros.filter((v) => v.ciclo)
  const cultivo = ativos.filter((v) => v.emCultivo)
  const bioDe = (v) => (serie?.biometrias || []).filter((b) => b.ciclo_id === v.ciclo.id)
  const racaoDe = (v) => (serie?.racao || []).filter((r) => r.ciclo_id === v.ciclo.id)
  const aguaDe = (v) => (serie?.agua || []).find((a) => a.ciclo_id === v.ciclo.id) || null
  const retDe = (v) => (serie?.retiradas || []).find((r) => r.ciclo_id === v.ciclo.id) || null
  // ganho de peso por semana entre as duas últimas biometrias
  const ganho = (v) => {
    const b = bioDe(v)
    if (b.length < 2) return null
    const [a, c] = b.slice(-2)
    const d = diasEntre(a.data, c.data)
    return d > 0 ? ((c.peso_medio_g - a.peso_medio_g) / d) * 7 : null
  }
  // FCA parcial = ração consumida ÷ (biomassa estimada + já despescada)
  const fcaParcial = (v) => {
    const bio = (v.biomassaPrevista || 0) + (v.biomassaDespescada || 0)
    return bio > 0 && v.racaoConsumida > 0 ? v.racaoConsumida / bio : null
  }

  // ---- preço de venda: previsão de despesca do viveiro; senão média das vendas dos últimos 90 dias
  const desde90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const vendas90 = (serie?.encerrados || []).filter((c) => c.data_fim >= desde90 && c.faturamento > 0 && c.biomassa_despescada_kg > 0)
  const bio90 = vendas90.reduce((s, c) => s + c.biomassa_despescada_kg, 0)
  const precoRef = bio90 > 0 ? vendas90.reduce((s, c) => s + c.faturamento, 0) / bio90 : null
  const precoDe = (v) => {
    const pv = v.previsoes.filter((p) => p.preco_kg_prev != null)
    const kg = pv.reduce((s, p) => s + p.biomassa_prev_kg, 0)
    if (kg > 0) return { preco: pv.reduce((s, p) => s + p.biomassa_prev_kg * p.preco_kg_prev, 0) / kg, fonte: 'previsão' }
    return precoRef != null ? { preco: precoRef, fonte: 'média 90 dias' } : null
  }
  const valorVenda = (v) => { const p = precoDe(v); return p && v.biomassaPrevista != null ? v.biomassaPrevista * p.preco : null }
  const totalVenda = cultivo.reduce((s, v) => s + (valorVenda(v) || 0), 0)

  // ---- indicadores do topo
  const biomassaTotal = cultivo.reduce((s, v) => s + (v.biomassaPrevista || 0), 0)
  const semEstimativa = cultivo.filter((v) => v.biomassaPrevista == null).length
  const racaoHoje = cultivo.reduce((s, v) => s + v.kgHoje, 0)
  const racaoPrev = cultivo.reduce((s, v) => s + (v.plano?.kg_dia || 0), 0)
  const em30 = previsoes.filter((p) => diasEntre(hoje(), p.data_prevista) <= 30)
  const kg30 = em30.reduce((s, p) => s + p.biomassa_prev_kg, 0)
  const r30 = em30.reduce((s, p) => s + (p.preco_kg_prev != null ? p.biomassa_prev_kg * p.preco_kg_prev : 0), 0)
  const racoes = produtos.filter((p) => p.categoria === 'racao')
  const saldoRacao = racoes.reduce((s, p) => s + Math.max(0, p.saldo), 0)
  const diasRacao = racaoPrev > 0 ? saldoRacao / racaoPrev : null

  // ---- alertas (status com ícone + texto, nunca só cor)
  const alertas = []
  const add = (nivel, texto) => alertas.push({ nivel, texto })
  cultivo.forEach((v) => {
    if (v.dias >= 110) add('critico', `${v.codigo}: ${v.dias} dias de cultivo — despescas com 110 dias ou mais foram quase todas negativas.`)
    else if (v.dias > 90) add('atencao', `${v.codigo}: ${v.dias} dias de cultivo — planejar a despesca.`)
    const a = aguaDe(v)
    if (a?.od != null && a.od < 3) add('critico', `${v.codigo}: oxigênio ${fmt(a.od)} mg/L em ${dataBR(a.data)} ${String(a.hora).slice(0, 5)}.`)
    const r = retDe(v)
    if (r?.resultado === 'muita_sobra') add('atencao', `${v.codigo}: muita sobra nas bandejas (${dataBR(r.data)}) — avaliar reduzir a ração.`)
    if (r?.resultado === 'zerou') add('info', `${v.codigo}: bandejas zeradas (${dataBR(r.data)}) — pode ser hora de aumentar a ração.`)
    if (!v.ultimaBio) add('atencao', `${v.codigo}: sem biometria por peso total.`)
    else if (diasEntre(v.ultimaBio.data, hoje()) > 10) add('atencao', `${v.codigo}: última biometria há ${diasEntre(v.ultimaBio.data, hoje())} dias.`)
    if (!v.plano) add('atencao', `${v.codigo}: sem plano de ração.`)
    else if (v.sobrevEst == null) add('info', `${v.codigo}: plano sem sobrevivência estimada — sem biomassa prevista.`)
  })
  previsoes.filter((p) => p.data_prevista < hoje()).forEach((p) => {
    const v = viveiros.find((x) => x.ciclo?.id === p.ciclo_id)
    add('atencao', `${v?.codigo || '?'}: previsão de despesca de ${dataBR(p.data_prevista)} atrasada.`)
  })
  produtos.filter((p) => p.ativo !== false).forEach((p) => {
    if (p.estoque_minimo != null && p.saldo < p.estoque_minimo) add('atencao', `Estoque de ${p.nome} abaixo do mínimo.`)
  })
  if (diasRacao != null && diasRacao < 7) add('critico', `Ração em estoque dá para ~${fmt(diasRacao, 0)} dias pelo plano.`)
  const ordem = { critico: 0, atencao: 1, info: 2 }
  alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel])

  return (
    <div className="painel">
      <header className="p-topo">
        <div>
          <h1>Painel · Barra Maricultura</h1>
          <small>{dataBR(hoje())}{atualizado ? ` · atualizado às ${atualizado.toTimeString().slice(0, 5)}` : ''}{MODO_DEMO ? ' · demonstração (séries de exemplo)' : ''}</small>
        </div>
        <div className="p-botoes">
          <button onClick={carregar} disabled={!online && !MODO_DEMO}>Atualizar</button>
          <button onClick={onVoltar}>Voltar ao app</button>
        </div>
      </header>
      {erro && <p className="p-erro">Não foi possível carregar o histórico: {erro}</p>}
      {!online && !MODO_DEMO && <p className="p-erro">Sem internet: o painel mostra só o que está guardado neste aparelho.</p>}

      <section className="p-kpis">
        <Kpi titulo="Viveiros em cultivo" valor={`${cultivo.length} de ${viveiros.length}`}
          nota={ativos.length > cultivo.length ? `${ativos.length - cultivo.length} em preparação` : 'nenhum em preparação'} />
        <Kpi titulo="Biomassa estimada" valor={`${fmt(biomassaTotal, 0)} kg`}
          nota={semEstimativa ? `${semEstimativa} viveiro(s) sem estimativa` : 'pela sobrevivência do plano'} />
        <Kpi titulo="Valor de venda estimado" valor={totalVenda ? reais(totalVenda) : '–'}
          nota={precoRef != null ? `média das vendas em 90 dias: ${fmt(precoRef, 2)} R$/kg` : 'sem vendas recentes'} />
        <Kpi titulo="Ração hoje" valor={`${fmt(racaoHoje, 0)} kg`} nota={racaoPrev ? `de ${fmt(racaoPrev, 0)} kg previstos (${fmt((racaoHoje / racaoPrev) * 100, 0)}%)` : 'sem plano'} />
        <Kpi titulo="Despesca em 30 dias" valor={`${fmt(kg30, 0)} kg`} nota={em30.length ? `${em30.length} previsão(ões) · ${reais(r30)}` : 'nenhuma prevista'} />
        <Kpi titulo="Ração em estoque" valor={`${fmt(saldoRacao, 0)} kg`} nota={diasRacao != null ? `~${fmt(diasRacao, 0)} dias pelo plano` : '—'} />
      </section>

      <div className="p-grade">
        <section className="p-bloco p-alertas">
          <h2>Alertas</h2>
          {alertas.length === 0 ? <p className="p-vazio">Nenhum alerta.</p> : (
            <ul>{alertas.map((a, i) => (
              <li key={i} className={a.nivel}><b>{a.nivel === 'critico' ? '⛔ Crítico' : a.nivel === 'atencao' ? '⚠️ Atenção' : 'ℹ️ Info'}</b> {a.texto}</li>
            ))}</ul>
          )}
        </section>

        <section className="p-bloco p-prev">
          <h2>Previsões de despesca</h2>
          {previsoes.length === 0 ? <p className="p-vazio">Nenhuma prevista.</p> : (
            <table><thead><tr><th>Data</th><th>Viveiro</th><th>Cliente</th><th className="n">kg</th><th className="n">g</th><th className="n">R$/kg</th><th className="n">Valor</th></tr></thead>
              <tbody>{previsoes.map((p) => (
                <tr key={p.id} className={p.data_prevista < hoje() ? 'atrasada' : ''}>
                  <td>{dataBR(p.data_prevista)}</td><td>{viveiros.find((v) => v.ciclo?.id === p.ciclo_id)?.codigo || '?'}</td>
                  <td>{clientes.find((c) => c.id === p.cliente_id)?.nome || '—'}</td>
                  <td className="n">{fmt(p.biomassa_prev_kg, 0)}</td><td className="n">{fmt(p.peso_medio_prev_g, 1)}</td>
                  <td className="n">{p.preco_kg_prev != null ? fmt(p.preco_kg_prev, 2) : '–'}</td>
                  <td className="n">{p.preco_kg_prev != null ? reais(p.biomassa_prev_kg * p.preco_kg_prev) : '–'}</td>
                </tr>))}</tbody></table>
          )}
        </section>
      </div>

      <section className="p-bloco">
        <h2>Viveiros</h2>
        <div className="p-tabela">
          <table>
            <thead><tr>
              <th>Viveiro</th><th>Situação</th><th className="n">Dias</th><th className="n">PL</th><th className="n">PL/m²</th>
              <th className="n">Peso (g)</th><th className="n">Ganho g/sem</th><th className="n">Sobrev. est.</th><th className="n">Biomassa est.</th><th className="n">R$/kg</th><th className="n">Valor de venda</th>
              <th className="n">Ração consumida</th><th className="n">FCA parcial</th><th className="n">Ração hoje</th><th>Bandejas</th><th className="n">OD</th>
            </tr></thead>
            <tbody>{viveiros.map((v) => {
              if (!v.ciclo) return <tr key={v.id} className="vazio"><td><b>{v.codigo}</b></td><td>Vazio</td><td colSpan={14} /></tr>
              if (!v.emCultivo) return <tr key={v.id}><td><b>{v.codigo}</b></td><td>Preparação ({v.diasCiclo} d)</td><td colSpan={14} /></tr>
              const g = ganho(v), f = fcaParcial(v), a = aguaDe(v), r = retDe(v), pr = precoDe(v), vv = valorVenda(v)
              return (
                <tr key={v.id} className={v.dias >= 110 ? 'critico' : v.dias > 90 ? 'atencao' : ''}>
                  <td><b>{v.codigo}</b></td><td>Em cultivo</td>
                  <td className="n">{v.dias}</td><td className="n">{v.pl ? mil(v.pl) : '–'}</td>
                  <td className="n">{v.pl && v.area_ha ? fmt(v.pl / (v.area_ha * 10000), 1) : '–'}</td>
                  <td className="n">{v.ultimaBio ? fmt(v.ultimaBio.peso_medio_g, 2) : '–'}</td>
                  <td className="n">{g != null ? fmt(g, 2) : '–'}</td>
                  <td className="n">{v.sobrevEst != null ? `${fmt(v.sobrevEst, 0)}%` : '–'}</td>
                  <td className="n">{v.biomassaPrevista != null ? `${fmt(v.biomassaPrevista, 0)} kg` : '–'}</td>
                  <td className="n" title={pr ? `preço da ${pr.fonte}` : ''}>{pr ? <>{fmt(pr.preco, 2)} <small className="fonte">{pr.fonte === 'previsão' ? 'prev.' : 'méd.'}</small></> : '–'}</td>
                  <td className="n"><b>{vv != null ? reais(vv) : '–'}</b></td>
                  <td className="n">{fmt(v.racaoConsumida, 0)} kg</td>
                  <td className="n">{f != null ? fmt(f, 2) : '–'}</td>
                  <td className="n">{fmt(v.kgHoje, 0)}{v.plano ? ` / ${fmt(v.plano.kg_dia, 0)}` : ''}</td>
                  <td>{r ? `${RESULT[r.resultado]} (${dataBR(r.data).slice(0, 5)})` : '–'}</td>
                  <td className={`n ${a?.od != null && a.od < 3 ? 'ruim' : ''}`}>{a?.od != null ? fmt(a.od) : '–'}</td>
                </tr>
              )
            })}</tbody>
            <tfoot><tr>
              <td><b>Total</b></td><td colSpan={7} />
              <td className="n"><b>{fmt(biomassaTotal, 0)} kg</b></td><td />
              <td className="n"><b>{totalVenda ? reais(totalVenda) : '–'}</b></td>
              <td className="n"><b>{fmt(cultivo.reduce((s, v) => s + (v.racaoConsumida || 0), 0), 0)} kg</b></td><td colSpan={4} />
            </tr></tfoot>
          </table>
        </div>
        <p className="p-nota">FCA parcial = ração consumida ÷ (biomassa estimada + já despescada). Biomassa estimada = PL × sobrevivência estimada × último peso.
          Valor de venda = biomassa estimada × R$/kg: <b>prev.</b> = preço da previsão de despesca do viveiro; <b>méd.</b> = média das vendas dos últimos 90 dias{precoRef != null ? ` (${fmt(precoRef, 2)} R$/kg)` : ''}.</p>
      </section>

      <section className="p-bloco">
        <h2>Crescimento e ração por viveiro</h2>
        {!serie && !erro && <p className="p-vazio">Carregando…</p>}
        {serie && cultivo.length === 0 && <p className="p-vazio">Nenhum viveiro em cultivo.</p>}
        <div className="p-mult">
          {serie && cultivo.map((v) => (
            <div key={v.id} className="p-viv">
              <div className="p-viv-topo"><b>{v.codigo}</b><span>{v.dias} dias · {v.ultimaBio ? `${fmt(v.ultimaBio.peso_medio_g, 2)} g` : 'sem biometria'}</span></div>
              <GraficoPeso pontos={bioDe(v).map((b) => ({ x: diasEntre(v.ciclo.data_povoamento, b.data), y: b.peso_medio_g, data: b.data }))} dias={v.dias} />
              <GraficoRacao dias={racaoDe(v)} previsto={v.plano?.kg_dia} />
            </div>
          ))}
        </div>
      </section>

      <div className="p-grade">
        <section className="p-bloco">
          <h2>Estoque</h2>
          {produtos.length === 0 ? <p className="p-vazio">Nenhum produto cadastrado.</p> : (
            <table><thead><tr><th>Produto</th><th className="n">Saldo</th><th className="n">Mínimo</th></tr></thead>
              <tbody>{produtos.map((p) => (
                <tr key={p.id} className={p.saldo <= 0 ? 'critico' : p.estoque_minimo != null && p.saldo < p.estoque_minimo ? 'atencao' : ''}>
                  <td>{p.nome}</td>
                  <td className="n">{p.categoria === 'pos_larva' ? `${mil(p.saldo)} PL` : `${fmt(p.saldo, 0)} ${p.unidade}`}</td>
                  <td className="n">{p.estoque_minimo != null ? fmt(p.estoque_minimo, 0) : '–'}</td>
                </tr>))}</tbody></table>
          )}
        </section>
      </div>
      <Historico encerrados={serie?.encerrados || []} carregado={!!serie} />
      <p className="p-nota">Custos por viveiro e resultado por ciclo entram com a integração do Apresenta.me.</p>
    </div>
  )
}

function Kpi({ titulo, valor, nota }) {
  return <div className="p-kpi"><span>{titulo}</span><b>{valor}</b><small>{nota}</small></div>
}

// Curva de crescimento: peso médio (g) × dias de cultivo. Uma série, sem legenda (o título nomeia).
function GraficoPeso({ pontos, dias }) {
  const W = 300, H = 120, m = { l: 30, r: 8, t: 8, b: 20 }
  const xMax = Math.max(100, dias), yMax = Math.max(15, ...pontos.map((p) => p.y)) * 1.1
  const X = (x) => m.l + (x / xMax) * (W - m.l - m.r), Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b)
  const yTicks = [0, Math.round(yMax / 2), Math.floor(yMax)]
  return (
    <figure className="p-graf">
      <figcaption>Peso médio (g) × dias de cultivo</figcaption>
      {pontos.length === 0 ? <p className="p-vazio">Sem biometrias.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de crescimento">
          {yTicks.map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} className="grade" /><text x={m.l - 4} y={Y(t) + 3} className="eixo" textAnchor="end">{t}</text></g>)}
          {[0, 30, 60, 90].filter((t) => t <= xMax).map((t) => <text key={t} x={X(t)} y={H - 6} className="eixo" textAnchor="middle">{t}</text>)}
          <line x1={X(90)} x2={X(90)} y1={m.t} y2={H - m.b} className="ref" />
          <polyline points={pontos.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className="linha" />
          {pontos.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4} className="ponto"><title>{`${dataBR(p.data)} · dia ${p.x}: ${fmt(p.y, 2)} g`}</title></circle>
          ))}
        </svg>
      )}
    </figure>
  )
}

// Ração colocada por dia (últimos 30 dias) + linha tracejada do previsto pelo plano atual (mesma unidade, um eixo).
function GraficoRacao({ dias, previsto }) {
  const W = 300, H = 110, m = { l: 30, r: 8, t: 8, b: 18 }
  const ult = dias.slice(-30)
  const yMax = Math.max(10, previsto || 0, ...ult.map((d) => d.colocado_kg)) * 1.1
  const n = 30, bw = (W - m.l - m.r) / n
  const Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b)
  const inicio = new Date(Date.now() - 29 * 864e5)
  const idx = (data) => Math.round((new Date(data) - inicio) / 864e5)
  return (
    <figure className="p-graf">
      <figcaption>Ração colocada por dia (kg), últimos 30 dias{previsto ? <span className="leg"> · <i className="tracejado" /> previsto {fmt(previsto, 0)} kg</span> : null}</figcaption>
      {ult.length === 0 ? <p className="p-vazio">Sem lançamentos de ração.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ração diária">
          {[0, Math.round(yMax / 2)].map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} className="grade" /><text x={m.l - 4} y={Y(t) + 3} className="eixo" textAnchor="end">{t}</text></g>)}
          {ult.map((d) => {
            const i = idx(d.data); if (i < 0 || i >= n) return null
            const x = m.l + i * bw + 1, y = Y(d.colocado_kg)
            return <rect key={d.data} x={x} y={y} width={Math.max(1, bw - 2)} height={Math.max(0, H - m.b - y)} rx={2} className="barra">
              <title>{`${dataBR(d.data)}: ${fmt(d.colocado_kg, 1)} kg colocados${d.sobra_kg ? ` · sobra ${fmt(d.sobra_kg, 2)} kg` : ''}`}</title></rect>
          })}
          {previsto ? <line x1={m.l} x2={W - m.r} y1={Y(previsto)} y2={Y(previsto)} className="previsto" /> : null}
          <text x={m.l} y={H - 4} className="eixo">{dataBR(inicio.toISOString()).slice(0, 5)}</text>
          <text x={W - m.r} y={H - 4} className="eixo" textAnchor="end">hoje</text>
        </svg>
      )}
    </figure>
  )
}

// ---------- Histórico de ciclos encerrados (produção + vendas e custos; antes de 12/2026 vêm do Meu Pescado) ----------
const FAIXAS = [['Até 89 dias', (d) => d < 90], ['90 a 109 dias', (d) => d >= 90 && d < 110], ['110 dias ou mais', (d) => d >= 110]]
function Historico({ encerrados, carregado }) {
  const [ver, setVer] = useState(15)
  const pesoMedio = (c) => (c.populacao_despescada > 0 ? (c.biomassa_despescada_kg * 1000) / c.populacao_despescada : null)
  const media = (xs, f) => { const v = xs.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const soma = (xs, f) => xs.reduce((a, c) => a + (f(c) || 0), 0)
  const linhas = FAIXAS.map(([nome, ok]) => {
    const xs = encerrados.filter((c) => c.dias_cultivo != null && ok(c.dias_cultivo))
    const bio = soma(xs, (c) => c.biomassa_despescada_kg), fat = soma(xs, (c) => c.faturamento), custo = soma(xs, (c) => c.custo)
    const comFin = xs.filter((c) => c.resultado != null)
    return { nome, n: xs.length, sobrev: media(xs, (c) => c.sobrevivencia_real_pct), fca: media(xs, (c) => c.fca), peso: media(xs, pesoMedio),
      rkg: bio && fat ? fat / bio : null, ckg: bio && custo ? custo / bio : null, res: comFin.length ? soma(comFin, (c) => c.resultado) : null,
      pos: comFin.length ? comFin.filter((c) => c.resultado > 0).length : null, nFin: comFin.length }
  })
  if (!carregado) return null
  return (
    <section className="p-bloco">
      <h2>Histórico de ciclos encerrados ({encerrados.length})</h2>
      {encerrados.length === 0 ? <p className="p-vazio">Nenhum ciclo encerrado ainda.</p> : (<>
        <h3 className="p-sub">Por tempo de cultivo</h3>
        <div className="p-tabela"><table>
          <thead><tr><th>Dias de cultivo</th><th className="n">Ciclos</th><th className="n">Sobrev. média</th><th className="n">FCA médio</th><th className="n">Peso médio</th>
            <th className="n">R$/kg vendido</th><th className="n">Custo/kg</th><th className="n">Resultado</th><th className="n">Ciclos positivos</th></tr></thead>
          <tbody>{linhas.map((l) => (
            <tr key={l.nome} className={l.res != null && l.res < 0 ? 'atencao' : ''}>
              <td><b>{l.nome}</b></td><td className="n">{l.n}</td>
              <td className="n">{l.sobrev != null ? `${fmt(l.sobrev, 1)}%` : '–'}</td><td className="n">{l.fca != null ? fmt(l.fca, 2) : '–'}</td>
              <td className="n">{l.peso != null ? `${fmt(l.peso, 1)} g` : '–'}</td>
              <td className="n">{l.rkg != null ? fmt(l.rkg, 2) : '–'}</td><td className="n">{l.ckg != null ? fmt(l.ckg, 2) : '–'}</td>
              <td className={`n ${l.res != null && l.res < 0 ? 'ruim' : ''}`}>{l.res != null ? reais(l.res) : '–'}</td>
              <td className="n">{l.pos != null ? `${l.pos} de ${l.nFin}` : '–'}</td>
            </tr>))}</tbody>
        </table></div>
        <h3 className="p-sub">Ciclo a ciclo</h3>
        <div className="p-tabela"><table>
          <thead><tr><th>Viveiro</th><th>Povoamento</th><th>Despesca</th><th className="n">Dias</th><th className="n">PL</th><th className="n">Biomassa</th>
            <th className="n">Peso</th><th className="n">Sobrev.</th><th className="n">FCA</th><th className="n">Faturamento</th><th className="n">R$/kg</th>
            <th className="n">Custo</th><th className="n">Resultado</th><th>Cliente</th></tr></thead>
          <tbody>{encerrados.slice(0, ver).map((c) => {
            const pm = pesoMedio(c)
            return (
              <tr key={c.codigo} className={c.dias_cultivo >= 110 ? 'atencao' : ''}>
                <td><b>{c.viveiro}</b></td><td>{dataBR(c.data_povoamento)}</td><td>{dataBR(c.data_fim)}</td>
                <td className="n">{c.dias_cultivo}</td><td className="n">{mil(c.pl_quantidade)}</td>
                <td className="n">{fmt(c.biomassa_despescada_kg, 0)} kg</td><td className="n">{pm != null ? `${fmt(pm, 1)} g` : '–'}</td>
                <td className="n">{c.sobrevivencia_real_pct != null ? `${fmt(c.sobrevivencia_real_pct, 1)}%` : '–'}</td>
                <td className="n">{c.fca != null ? fmt(c.fca, 2) : '–'}</td>
                <td className="n">{c.faturamento != null ? reais(c.faturamento) : '–'}</td>
                <td className="n">{c.faturamento != null && c.biomassa_despescada_kg ? fmt(c.faturamento / c.biomassa_despescada_kg, 2) : '–'}</td>
                <td className="n">{c.custo != null ? reais(c.custo) : '–'}</td>
                <td className={`n ${c.resultado != null && c.resultado < 0 ? 'ruim' : ''}`}>{c.resultado != null ? reais(c.resultado) : '–'}</td>
                <td className="p-cli">{c.clientes || '–'}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
        {encerrados.length > ver && <button type="button" className="p-mais" onClick={() => setVer(encerrados.length)}>Mostrar todos os {encerrados.length} ciclos</button>}
        <p className="p-nota">Ciclos até 11/2026: produção, vendas e custos importados do Meu Pescado (custos com os lançamentos de lá — ex.: a despesca do V07 de 02/03/2026 tem R$ 522 mil de custo por erro de lançamento). A partir daqui, receitas e custos virão do Apresenta.me.</p>
      </>)}
    </section>
  )
}
