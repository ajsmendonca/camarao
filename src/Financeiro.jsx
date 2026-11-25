// Custos por viveiro e classificação das notas do Apresenta.me (painel do escritório; gestor/admin; precisa de sinal).
import { useState } from 'react'
import { supabase, hoje } from './data'

const reais = (n) => n == null ? '–' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const reais2 = (n) => n == null ? '–' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''
const PLANOS_MATERIAL = [15368, 16636, 16938]   // Ração, Larva do Camarão, Insumos de viveiro
const DESTINOS = {
  estoque: 'Entrada no estoque', ja_no_estoque: 'Já contabilizada (estoque inicial ou povoamento)', ciclo: 'Custo direto de um ciclo',
  rateio: 'Custo comum (rateio)', ignorar: 'Não é custo da produção',
}
export const custoTotal = (c) => (c ? c.racao + c.insumos + c.pos_larva + c.comum + c.direto : null)

export function CustosViveiros({ viveiros, custos, primeiraNota }) {
  const linhas = viveiros.filter((v) => v.ciclo && custos[v.ciclo.id]).map((v) => ({ v, c: custos[v.ciclo.id] }))
  if (!linhas.length) return null
  const soma = (k) => linhas.reduce((s, { c }) => s + c[k], 0)
  const tot = linhas.reduce((s, { c }) => s + custoTotal(c), 0)
  return (
    <section className="p-bloco">
      <h2>Custo dos ciclos abertos (até hoje)</h2>
      <div className="p-tabela"><table>
        <thead><tr><th>Viveiro</th><th className="n">Ração</th><th className="n">Insumos</th><th className="n">Pós-larva</th>
          <th className="n">Comum (rateio)</th><th className="n">sendo provisório</th><th className="n">Direto</th><th className="n">Total</th><th className="n">Custo/kg est.</th></tr></thead>
        <tbody>{linhas.map(({ v, c }) => {
          const t = custoTotal(c)
          return (
            <tr key={v.id}><td><b>{v.codigo}</b> <small className="fonte">{v.emCultivo ? `${v.dias} d` : 'prep.'}</small></td>
              <td className="n">{reais(c.racao)}</td><td className="n">{reais(c.insumos)}</td><td className="n">{reais(c.pos_larva)}</td>
              <td className="n">{reais(c.comum)}</td><td className={`n ${c.comum_provisorio > 0 ? 'prov' : ''}`}>{c.comum_provisorio > 0 ? reais(c.comum_provisorio) : '–'}</td>
              <td className="n">{c.direto ? reais(c.direto) : '–'}</td><td className="n"><b>{reais(t)}</b></td>
              <td className="n">{v.biomassaPrevista ? reais2(t / v.biomassaPrevista) : '–'}</td></tr>
          )
        })}</tbody>
        <tfoot><tr><td><b>Total</b></td><td className="n">{reais(soma('racao'))}</td><td className="n">{reais(soma('insumos'))}</td><td className="n">{reais(soma('pos_larva'))}</td>
          <td className="n">{reais(soma('comum'))}</td><td className="n prov">{soma('comum_provisorio') ? reais(soma('comum_provisorio')) : '–'}</td>
          <td className="n">{reais(soma('direto'))}</td><td className="n"><b>{reais(tot)}</b></td><td /></tr></tfoot>
      </table></div>
      <p className="p-nota">Ração e insumos = consumo do ciclo × preço médio (Meu Pescado no saldo inicial + notas ligadas a entradas de estoque).
        Pós-larva = PL × preço do milheiro. Comum = despesas do Apresenta.me rateadas por hectare entre os ciclos abertos na data
        (sem o centro Investimento){primeiraNota ? `; o Apresenta.me tem despesas a partir de ${dataBR(primeiraNota)}` : ''}.
        <b> Provisório</b> = notas de ração, larva ou insumos ainda não classificadas (abaixo) — entram no rateio até serem classificadas.</p>
    </section>
  )
}

export function NotasApresentame({ notas, destinos, entradasNota, viveiros, produtos, usuario, onAlterado }) {
  const [filtro, setFiltro] = useState('classificar')
  const [aberta, setAberta] = useState(null)
  const [msg, setMsg] = useState(null)
  const entradasDe = (id) => entradasNota.filter((e) => String(e.apresentame_id) === String(id))
  const situacao = (n) => {
    if (n.centro_custo_id === 1829) return { k: 'investimento', t: 'Investimento (fora do lote)' }
    if (entradasDe(n.apresentame_id).length) return { k: 'estoque', t: DESTINOS.estoque }
    const d = destinos[n.apresentame_id]
    if (d) return { k: d.destino, t: d.destino === 'ciclo' ? `Direto: ${viveiros.find((v) => v.ciclo?.id === d.ciclo_id)?.codigo || 'ciclo'}` : DESTINOS[d.destino] }
    if (PLANOS_MATERIAL.includes(Number(n.plano_id))) return { k: 'provisoria', t: 'A classificar (provisório no rateio)' }
    return { k: 'rateio', t: 'Custo comum (rateio)' }
  }
  const lista = notas.filter((n) => (filtro === 'classificar' ? situacao(n).k === 'provisoria' : true))
  const nClass = notas.filter((n) => situacao(n).k === 'provisoria').length

  const desfazer = async (n) => {
    setMsg(null)
    if (entradasDe(n.apresentame_id).length) {
      const { error } = await supabase.from('estoque_movimentos').delete().eq('apresentame_id', n.apresentame_id)
      if (error) return setMsg({ erro: true, texto: 'Só o admin desfaz uma entrada de estoque: ' + error.message })
    }
    await supabase.from('financeiro_destino').delete().eq('apresentame_id', n.apresentame_id)
    setMsg({ texto: 'Classificação desfeita.' }); onAlterado()
  }
  const classificar = async (n, destino, extra) => {
    setMsg(null)
    if (destino === 'estoque') {
      const linhas = extra.linhas.filter((l) => l.produto && l.q > 0)
      if (!linhas.length) return setMsg({ erro: true, texto: 'Informe produto e quantidade.' })
      const qt = linhas.reduce((s, l) => s + (l.v != null ? 0 : l.q), 0), vInf = linhas.reduce((s, l) => s + (l.v || 0), 0)
      const resto = n.valor - vInf
      const rows = linhas.map((l) => ({ id: crypto.randomUUID(), produto_id: l.produto, data: hoje(), tipo: 'entrada', quantidade: l.q,
        valor: Math.round((l.v != null ? l.v : resto * (l.q / qt)) * 100) / 100, apresentame_id: n.apresentame_id,
        documento: [n.pessoa_nome, n.descricao].filter(Boolean).join(' — ').slice(0, 200), lancado_por: usuario }))
      const { error } = await supabase.from('estoque_movimentos').insert(rows)
      if (error) return setMsg({ erro: true, texto: error.message })
    }
    const { error } = await supabase.from('financeiro_destino').upsert({ apresentame_id: n.apresentame_id, destino,
      ciclo_id: destino === 'ciclo' ? extra.ciclo : null, definido_por: usuario }, { onConflict: 'apresentame_id' })
    if (error) return setMsg({ erro: true, texto: error.message })
    setAberta(null); setMsg({ texto: 'Nota classificada.' }); onAlterado()
  }

  return (
    <section className="p-bloco">
      <h2>Notas do Apresenta.me</h2>
      <div className="p-filtros">
        <button className={filtro === 'classificar' ? 'sel' : ''} onClick={() => setFiltro('classificar')}>A classificar ({nClass})</button>
        <button className={filtro === 'todas' ? 'sel' : ''} onClick={() => setFiltro('todas')}>Todas ({notas.length})</button>
      </div>
      {msg && <p className={`p-nota ${msg.erro ? 'p-erro-txt' : 'p-ok-txt'}`}>{msg.texto}</p>}
      {lista.length === 0 ? <p className="p-vazio">{filtro === 'classificar' ? 'Nenhuma nota a classificar.' : 'Nenhuma nota sincronizada. Use Cadastros › Sincronizar agora.'}</p> : (
        <div className="p-tabela"><table>
          <thead><tr><th>Data</th><th>Fornecedor</th><th>Plano</th><th>Descrição</th><th className="n">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>{lista.map((n) => {
            const s = situacao(n)
            return [
              <tr key={n.apresentame_id} className={s.k === 'provisoria' ? 'atencao' : ''}>
                <td>{dataBR(n.competencia || n.data)}</td><td className="p-cli">{n.pessoa_nome || '–'}</td><td>{n.plano_nome || '–'}</td>
                <td className="p-desc" title={n.descricao || ''}>{n.descricao || '–'}</td><td className="n">{reais2(n.valor)}</td>
                <td><span className={`p-sit ${s.k}`}>{s.t}</span></td>
                <td>{s.k !== 'investimento' && (s.k === 'provisoria' || s.k === 'rateio' && !destinos[n.apresentame_id]
                  ? <button className="p-acao" onClick={() => setAberta(aberta === n.apresentame_id ? null : n.apresentame_id)}>Classificar</button>
                  : <button className="p-acao sec" onClick={() => desfazer(n)}>Desfazer</button>)}</td>
              </tr>,
              aberta === n.apresentame_id && (
                <tr key={n.apresentame_id + 'f'} className="p-form-linha"><td colSpan={7}>
                  <Classificar nota={n} viveiros={viveiros} produtos={produtos} onSalvar={(d, x) => classificar(n, d, x)} onFechar={() => setAberta(null)} />
                </td></tr>
              ),
            ]
          })}</tbody>
        </table></div>
      )}
      <p className="p-nota">Entrada no estoque: a quantidade entra no saldo e o valor da nota atualiza o preço médio do produto.
        Já contabilizada: mercadoria que já estava no estoque inicial vindo do Meu Pescado (comprada antes de 24/11/2026) ou pós-larva
        cujo custo já entra pelo povoamento (PL × preço do milheiro) — não entra de novo.
        Direto: custo só de um viveiro. Comum: rateado por hectare. Não é custo da produção: fica fora dos ciclos.</p>
    </section>
  )
}

function Classificar({ nota, viveiros, produtos, onSalvar, onFechar }) {
  const sugest = Number(nota.plano_id) === 16636 ? 'pos_larva' : Number(nota.plano_id) === 15368 ? 'racao' : null
  // larva: o custo já entra pelo povoamento (PL × preço do milheiro); ração: normalmente vira entrada no estoque
  const [destino, setDestino] = useState(sugest === 'pos_larva' ? 'ja_no_estoque' : sugest ? 'estoque' : 'rateio')
  const [linhas, setLinhas] = useState([{ produto: '', q: '', v: '' }])
  const [ciclo, setCiclo] = useState('')
  const num = (s) => { const t = String(s ?? '').trim(); if (!t) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
  const prods = produtos.filter((p) => p.ativo !== false).sort((a, b) => (a.categoria === sugest ? -1 : 0) - (b.categoria === sugest ? -1 : 0) || a.nome.localeCompare(b.nome))
  const abertos = viveiros.filter((v) => v.ciclo)
  const fator = (pid) => (produtos.find((p) => p.id === pid)?.categoria === 'pos_larva' ? 1000 : 1)
  const salvar = () => onSalvar(destino, {
    ciclo,
    linhas: linhas.map((l) => ({ produto: l.produto, q: (num(l.q) || 0) * fator(l.produto), v: l.v === '' ? null : num(l.v) })),
  })
  return (
    <div className="p-classif">
      <div className="p-filtros">{Object.entries(DESTINOS).map(([k, t]) => (
        <button key={k} className={destino === k ? 'sel' : ''} onClick={() => setDestino(k)}>{t}</button>))}</div>
      {destino === 'estoque' && (<>
        {linhas.map((l, i) => (
          <div key={i} className="p-linha-ent">
            <select value={l.produto} onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, produto: e.target.value } : x)))}>
              <option value="">Produto…</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <input placeholder={fator(l.produto) > 1 ? 'mil PL' : `quantidade (${produtos.find((p) => p.id === l.produto)?.unidade || 'kg'})`} value={l.q}
              onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
            {linhas.length > 1 && <input placeholder="R$ (opcional)" value={l.v} onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />}
          </div>
        ))}
        <button className="p-acao sec" onClick={() => setLinhas([...linhas, { produto: '', q: '', v: '' }])}>+ outro produto na mesma nota</button>
        <small className="p-nota">Com mais de um produto, o valor é dividido pela quantidade (ou informe o R$ de cada um).</small>
      </>)}
      {destino === 'ciclo' && (
        <select value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
          <option value="">Viveiro…</option>{abertos.map((v) => <option key={v.id} value={v.ciclo.id}>{v.codigo} — {v.ciclo.codigo}</option>)}
        </select>
      )}
      <div className="p-filtros">
        <button className="p-acao" disabled={destino === 'ciclo' && !ciclo} onClick={salvar}>Salvar</button>
        <button className="p-acao sec" onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  )
}
