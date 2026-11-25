// Histórico / Registros: lista os lançamentos por viveiro e ciclo (atual ou anteriores).
// Gestor só consulta; admin também corrige e apaga. Precisa de sinal: lê e grava direto no banco (RLS: só admin altera/apaga).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from './data'

const fmt = (n, d = 1) => n == null || n === '' || Number.isNaN(Number(n)) ? '–'
  : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''
const hhmm = (h) => (h ? String(h).slice(0, 5) : '')
const paraNum = (s) => { const t = String(s ?? '').trim(); if (!t) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const paraTexto = (v, tipo) => v == null ? '' : tipo === 'num' ? String(v).replace('.', ',') : tipo === 'hora' ? hhmm(v) : String(v)
const TIPOS_OC = { mortalidade: 'Mortalidade', doenca: 'Doença / sinais', manutencao: 'Manutenção', outro: 'Outro' }
const RESULT = { zerou: 'Zerou', pouca_sobra: 'Pouca sobra', muita_sobra: 'Muita sobra' }
const classificar = (sobra, colocado) => (!sobra ? 'zerou' : !colocado ? 'pouca_sobra' : sobra / colocado <= 0.2 ? 'pouca_sobra' : 'muita_sobra')
const STATUS = { preparacao: 'em preparação', em_cultivo: 'em cultivo', encerrado: 'encerrado', cancelado: 'cancelado' }

// campos: [chave, rótulo, tipo, opções] — tipo: data | hora | num | int | texto | produto:<categoria|insumo> | lista
const TIPOS = {
  racao: { nome: 'Ração', tabela: 'racao', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['trato', 'Trato', 'int'], ['produto_id', 'Ração', 'produto:racao'], ['kg', 'kg', 'num']],
    resumo: (r, nomeProd) => `${r.trato}º trato · ${fmt(r.kg)} kg · ${nomeProd(r.produto_id)}${r.fora_estoque ? ' · histórico' : ''}` },
  bandejas: { nome: 'Bandejas', tabela: 'bandeja_colocacoes', ordem: 'data', select: '*, bandeja_retiradas(*)',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora da colocação', 'hora'], ['kg_bandejas', 'Colocado (kg)', 'num'], ['produto_id', 'Ração', 'produto:racao'],
      ['_sobra', 'Sobra pesada (kg)', 'num'], ['_hora_ret', 'Hora da retirada', 'hora']],
    resumo: (r) => { const ret = r.bandeja_retiradas?.[0]; return `colocou ${fmt(r.kg_bandejas, 2)} kg${ret ? ` · sobra ${fmt(ret.sobra_kg, 2)} kg · ${RESULT[ret.resultado]}` : ' · sem retirada'}` } },
  biometria: { nome: 'Biometria', tabela: 'biometrias', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['n_amostra', 'Camarões pesados', 'int'], ['peso_total_g', 'Peso total (g)', 'num']],
    resumo: (r) => `${r.tipo === 'classes' ? 'por tamanho · ' : ''}${fmt(Number(r.peso_total_g) / Number(r.n_amostra), 2)} g (${r.n_amostra} un)` },
  agua: { nome: 'Água', tabela: 'agua', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['od', 'Oxigênio (mg/L)', 'num'], ['ph', 'pH', 'num'], ['temperatura', 'Temperatura (°C)', 'num'],
      ['salinidade', 'Salinidade (ppt)', 'num'], ['transparencia', 'Transparência (cm)', 'num']],
    resumo: (r) => [['OD', r.od], ['pH', r.ph], ['T', r.temperatura], ['Sal', r.salinidade], ['Transp', r.transparencia]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') },
  ocorrencia: { nome: 'Ocorrência', tabela: 'ocorrencias', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['tipo', 'Tipo', 'lista', TIPOS_OC], ['quantidade', 'Quantidade (mortalidade)', 'int'], ['descricao', 'Descrição', 'texto']],
    resumo: (r) => `${TIPOS_OC[r.tipo]}${r.quantidade ? ` · ${r.quantidade} un` : ''}${r.descricao ? ` · ${r.descricao}` : ''}` },
  insumo: { nome: 'Insumos', tabela: 'aplicacoes_insumos', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['produto_id', 'Produto', 'produto:insumo'], ['quantidade', 'Quantidade', 'num'], ['observacao', 'Observação', 'texto']],
    resumo: (r, nomeProd) => `${nomeProd(r.produto_id)} · ${fmt(r.quantidade)}` },
  pesagem: { nome: 'Pesagens', tabela: 'pesagens', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['trato', 'Trato', 'int'], ['kg_lanco', 'Lanço (kg)', 'num'], ['kg_bandeja', 'Bandejas (kg)', 'num']],
    resumo: (r) => `${r.trato}º trato · lanço ${fmt(r.kg_lanco)} kg${Number(r.kg_bandeja) ? ` + bandejas ${fmt(r.kg_bandeja, 2)} kg` : ''}` },
  plano: { nome: 'Planos', tabela: 'planos_racao', ordem: 'data_inicio',
    campos: [['data_inicio', 'Vale a partir de', 'data'], ['kg_dia', 'kg por dia', 'num'], ['sobrevivencia_est', 'Sobrevivência estimada (%)', 'num'], ['observacao', 'Recado', 'texto']],
    resumo: (r) => `${fmt(r.kg_dia)} kg/dia em ${(r.tratos || []).length} tratos${r.sobrevivencia_est != null ? ` · sobrev. ${fmt(r.sobrevivencia_est, 0)}%` : ''}` },
  povoamento: { nome: 'Povoamento', tabela: 'povoamentos', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['pl_quantidade', 'PL povoadas', 'int'], ['fornecedor', 'Laboratório', 'texto'], ['estagio', 'Estágio', 'texto'], ['observacao', 'Observação', 'texto']],
    resumo: (r) => `${fmt(r.pl_quantidade / 1000, 0)} mil PL${r.fornecedor ? ` · ${r.fornecedor}` : ''}` },
  despesca: { nome: 'Despesca', tabela: 'despescas', ordem: 'data',
    campos: [['data', 'Data', 'data'], ['hora', 'Hora', 'hora'], ['biomassa_kg', 'Biomassa (kg)', 'num'], ['peso_medio_g', 'Peso médio (g)', 'num'], ['observacao', 'Observação', 'texto']],
    resumo: (r) => r.tipo === 'perda_total' ? `perda total · ${r.observacao || ''}` : `${r.tipo} · ${fmt(r.biomassa_kg, 0)} kg · ${fmt(r.peso_medio_g, 1)} g` },
}

export default function Registros({ viveiros, produtos, online, onAlterado, podeEditar = false }) {
  const [visao, setVisao] = useState('dia')   // ração: por dia ou por trato
  const [dias, setDias] = useState(null)
  const [vid, setVid] = useState(null)
  const [ciclos, setCiclos] = useState([])
  const [cid, setCid] = useState(null)
  const [tipo, setTipo] = useState('racao')
  const [linhas, setLinhas] = useState(null)
  const [aberto, setAberto] = useState(null)
  const [msg, setMsg] = useState(null)
  const cfg = TIPOS[tipo]
  const nomeProd = (id) => produtos.find((p) => p.id === id)?.nome || (id ? 'produto inativo' : '—')

  useEffect(() => {
    if (!vid || !online) return
    setCiclos([]); setCid(null)
    supabase.from('ciclos').select('id, codigo, data_inicio, data_povoamento, data_fim, status').eq('viveiro_id', vid)
      .order('data_inicio', { ascending: false }).then(({ data, error }) => {
        if (error) return setMsg({ erro: true, texto: error.message })
        setCiclos(data || []); setCid(data?.[0]?.id || null)
      })
  }, [vid, online])

  const carregar = useCallback(async () => {
    if (!cid) return setLinhas(null)
    setLinhas(null); setAberto(null)
    const { data, error } = await supabase.from(cfg.tabela).select(cfg.select || '*').eq('ciclo_id', cid)
      .order(cfg.ordem, { ascending: false }).order('criado_em', { ascending: false }).limit(400)
    if (error) { setMsg({ erro: true, texto: error.message }); setLinhas([]) } else setLinhas(data || [])
  }, [cid, cfg])
  useEffect(() => { carregar() }, [carregar])
  // ração por dia (lanço + bandejas − sobra), da view vw_racao_diaria
  useEffect(() => {
    if (!cid || tipo !== 'racao') return
    setDias(null)
    supabase.from('vw_racao_diaria').select('*').eq('ciclo_id', cid).order('data', { ascending: false }).limit(400)
      .then(({ data }) => setDias(data || []))
  }, [cid, tipo, linhas])

  const depois = async (texto) => { setMsg({ texto }); await carregar(); onAlterado?.() }
  const salvar = async (r, valores) => {
    setMsg(null)
    const campos = {}
    for (const [k, , t] of cfg.campos) {
      if (k.startsWith('_')) continue
      const v = valores[k]
      campos[k] = ['num', 'int'].includes(t) ? paraNum(v) : (v === '' ? null : v)
      if (Number.isNaN(campos[k])) return setMsg({ erro: true, texto: 'Confira os números (use vírgula para decimais).' })
    }
    if (tipo === 'plano' && campos.kg_dia > 0 && Number(r.kg_dia) > 0) {
      // reparte a nova quantidade entre os tratos na mesma proporção
      const f = campos.kg_dia / Number(r.kg_dia)
      campos.tratos = (r.tratos || []).map((t) => ({ ...t, kg: Math.round(t.kg * f * 10) / 10 }))
    }
    let { error } = await supabase.from(cfg.tabela).update(campos).eq('id', r.id)
    if (!error && tipo === 'bandejas' && r.bandeja_retiradas?.[0]) {
      const ret = r.bandeja_retiradas[0], sobra = paraNum(valores._sobra)
      if (Number.isNaN(sobra) || sobra == null) return setMsg({ erro: true, texto: 'Informe a sobra (0 se zerou).' })
      ;({ error } = await supabase.from('bandeja_retiradas').update({ sobra_kg: sobra, hora: valores._hora_ret || ret.hora,
        resultado: classificar(sobra, campos.kg_bandejas) }).eq('id', ret.id))
    }
    if (error) return setMsg({ erro: true, texto: 'Não foi possível salvar: ' + error.message })
    depois('Registro corrigido.')
  }
  const apagar = async (r) => {
    setMsg(null)
    if (tipo === 'bandejas' && r.bandeja_retiradas?.length) {
      const { error } = await supabase.from('bandeja_retiradas').delete().eq('colocacao_id', r.id)
      if (error) return setMsg({ erro: true, texto: error.message })
    }
    if (tipo === 'despesca') await supabase.from('vendas_historico').delete().eq('despesca_id', r.id)
    const { error } = await supabase.from(cfg.tabela).delete().eq('id', r.id)
    if (error) return setMsg({ erro: true, texto: /ux_ciclo_ativo/.test(error.message) ? 'Não dá para reabrir este ciclo: o viveiro já tem outro ciclo aberto.' : 'Não foi possível apagar: ' + error.message })
    depois(tipo === 'despesca' && ['total', 'perda_total'].includes(r.tipo) ? 'Despesca apagada — o ciclo voltou a ficar em cultivo.' : 'Registro apagado.')
  }

  if (!online) return <p className="dica">Os registros só podem ser corrigidos com sinal de internet.</p>
  const ciclo = ciclos.find((c) => c.id === cid)
  return (
    <div className="form">
      <fieldset className="campo"><legend>Viveiro</legend>
        <div className="chips cols4">{viveiros.map((v) => (
          <button key={v.id} type="button" className={vid === v.id ? 'sel' : ''} onClick={() => setVid(v.id)}>{v.codigo}</button>))}</div>
      </fieldset>
      {vid && ciclos.length > 0 && (
        <label className="campo"><span>Ciclo</span>
          <select value={cid || ''} onChange={(e) => setCid(e.target.value)}>
            {ciclos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {STATUS[c.status]}{c.data_povoamento ? ` · povoado ${dataBR(c.data_povoamento)}` : ''}{c.data_fim ? ` · fim ${dataBR(c.data_fim)}` : ''}</option>)}
          </select></label>
      )}
      {vid && ciclos.length === 0 && <p className="dica esq">Este viveiro ainda não tem ciclos.</p>}
      {ciclo && (<>
        <div className="chips reg-tipos">{Object.entries(TIPOS).map(([k, t]) => (
          <button key={k} type="button" className={tipo === k ? 'sel' : ''} onClick={() => setTipo(k)}>{t.nome}</button>))}</div>
        {msg && <p className={`dica esq ${msg.erro ? 'aviso-sem-plano' : 'msg-ok'}`}>{msg.texto}</p>}
        {tipo === 'racao' && (
          <div className="alternar">{[['dia', 'Por dia'], ['trato', 'Por trato']].map(([k, n]) => (
            <button key={k} type="button" className={visao === k ? 'sel' : ''} onClick={() => setVisao(k)}>{n}</button>))}</div>
        )}
        {tipo === 'racao' && visao === 'dia' ? <RacaoPorDia dias={dias} /> :
        linhas == null ? <p className="dica">Carregando…</p> : linhas.length === 0 ? <p className="dica">Nenhum registro de {cfg.nome.toLowerCase()} neste ciclo.</p> : (<>
          <p className="dica esq">{linhas.length} registro(s){linhas.length === 400 ? ' (mostrando os 400 mais recentes)' : ''}.{podeEditar ? ' Toque para corrigir ou apagar.' : ''}</p>
          <ul className="reg-lista">{linhas.map((r, i) => (
            <li key={r.id} className={aberto === r.id ? 'aberto' : ''}>
              <button type="button" className="reg-linha" disabled={!podeEditar} onClick={() => setAberto(aberto === r.id ? null : r.id)}>
                <b>{dataBR(r[cfg.ordem])}{r.hora ? ` ${hhmm(r.hora)}` : ''}</b>
                <span>{cfg.resumo(r, nomeProd)}{tipo === 'biometria' && ganhoSemanal(r, linhas.slice(i + 1))}</span>
                <small>{r.lancado_por || ''}{r.criado_em ? ` · registrado ${new Date(r.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
              </button>
              {podeEditar && aberto === r.id && <Editor cfg={cfg} tipo={tipo} r={r} produtos={produtos} onSalvar={(v) => salvar(r, v)} onApagar={() => apagar(r)} onFechar={() => setAberto(null)} />}
            </li>))}</ul>
        </>)}
      </>)}
    </div>
  )
}

function Editor({ cfg, tipo, r, produtos, onSalvar, onApagar, onFechar }) {
  const ret = r.bandeja_retiradas?.[0]
  const [val, setVal] = useState(() => Object.fromEntries(cfg.campos.map(([k, , t]) => [k,
    k === '_sobra' ? paraTexto(ret?.sobra_kg, 'num') : k === '_hora_ret' ? hhmm(ret?.hora) : paraTexto(r[k], t)])))
  const [confirmar, setConfirmar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setVal((x) => ({ ...x, [k]: v }))
  const avisoApagar = tipo === 'despesca' && ['total', 'perda_total'].includes(r.tipo) ? ' O ciclo volta a ficar em cultivo.'
    : tipo === 'povoamento' ? ' Se for o único povoamento, o ciclo volta para preparação.' : ''
  return (
    <div className="reg-editor">
      {cfg.campos.map(([k, rot, t, opc]) => {
        if ((k === '_sobra' || k === '_hora_ret') && !ret) return null
        if (tipo === 'biometria' && r.tipo === 'classes' && ['n_amostra', 'peso_total_g'].includes(k)) return null
        if (t.startsWith('produto:')) {
          const cat = t.split(':')[1]
          const lista = produtos.filter((p) => (cat === 'insumo' ? !['racao', 'pos_larva'].includes(p.categoria) : p.categoria === cat))
          return <label key={k} className="campo"><span>{rot}</span>
            <select value={val[k] || ''} onChange={(e) => set(k, e.target.value)}>
              {!lista.some((p) => p.id === val[k]) && <option value={val[k] || ''}>{val[k] ? 'produto inativo/histórico' : '—'}</option>}
              {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select></label>
        }
        if (t === 'lista') return <label key={k} className="campo"><span>{rot}</span>
          <select value={val[k]} onChange={(e) => set(k, e.target.value)}>{Object.entries(opc).map(([o, n]) => <option key={o} value={o}>{n}</option>)}</select></label>
        return <label key={k} className="campo"><span>{rot}</span>
          <input type={t === 'data' ? 'date' : t === 'hora' ? 'time' : 'text'} inputMode={['num', 'int'].includes(t) ? 'decimal' : undefined}
            value={val[k]} onChange={(e) => set(k, e.target.value)} /></label>
      })}
      {tipo === 'biometria' && r.tipo === 'classes' && <p className="dica esq">Biometria por tamanho: dá para mudar data/hora ou apagar.</p>}
      <div className="reg-botoes">
        <button type="button" className="primario" disabled={salvando} onClick={async () => { setSalvando(true); await onSalvar(val); setSalvando(false) }}>Salvar correção</button>
        <button type="button" className="perigo" onClick={() => (confirmar ? onApagar() : setConfirmar(true))}>{confirmar ? 'Confirmar exclusão' : 'Apagar'}</button>
        <button type="button" className="mais" onClick={onFechar}>Fechar</button>
      </div>
      {confirmar && <p className="dica esq aviso-sem-plano">Toque de novo para apagar de vez.{avisoApagar}</p>}
    </div>
  )
}

// ganho de peso por semana em relação à biometria (peso total) anterior
function ganhoSemanal(r, anteriores) {
  if (r.tipo === 'classes') return ''
  const a = anteriores.find((x) => x.tipo !== 'classes')
  if (!a) return ''
  const dias = Math.round((new Date(r.data) - new Date(a.data)) / 864e5)
  if (dias <= 0) return ''
  const g = (Number(r.peso_total_g) / Number(r.n_amostra) - Number(a.peso_total_g) / Number(a.n_amostra)) / dias * 7
  return ` · ${g >= 0 ? '+' : ''}${fmt(g, 2)} g/semana`
}

function RacaoPorDia({ dias }) {
  if (dias == null) return <p className="dica">Carregando…</p>
  if (dias.length === 0) return <p className="dica">Nenhuma ração lançada neste ciclo.</p>
  const tot = dias.reduce((s, d) => s + Number(d.consumido_kg || 0), 0)
  return (<>
    <p className="dica esq">{dias.length} dia(s) com ração · {fmt(tot, 0)} kg consumidos nesses dias.</p>
    <div className="p-tabela"><table className="reg-tabela">
      <thead><tr><th>Data</th><th className="n">Lanço</th><th className="n">Bandejas</th><th className="n">Sobra</th><th className="n">Total</th></tr></thead>
      <tbody>{dias.map((d) => (
        <tr key={d.data}><td>{dataBR(d.data)}</td><td className="n">{fmt(d.lanco_kg, 1)}</td><td className="n">{Number(d.bandejas_kg) ? fmt(d.bandejas_kg, 2) : '–'}</td>
          <td className="n">{Number(d.sobra_kg) ? fmt(d.sobra_kg, 2) : '–'}</td><td className="n"><b>{fmt(d.consumido_kg, 1)}</b></td></tr>))}</tbody>
    </table></div>
  </>)
}
