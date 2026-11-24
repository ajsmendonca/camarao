// Clientes e fornecedores (gestor/admin; precisa de sinal). Vêm do Apresenta.me pela sincronização (ligados pelo código
// da pessoa lá) e podem ser cadastrados ou corrigidos aqui. A sincronização também copia o financeiro da Barra Maricultura.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from './data'

const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const CAMPOS = [['nome', 'Nome'], ['documento', 'CPF / CNPJ'], ['telefone', 'Telefone'], ['cidade', 'Cidade'], ['observacao', 'Observação']]

export default function Cadastros({ online, onAlterado }) {
  const [aba, setAba] = useState('clientes')
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(null)   // id, 'novo' ou null
  const [msg, setMsg] = useState(null)
  const [exec, setExec] = useState(null)
  const [sincronizando, setSincronizando] = useState(false)

  const carregar = useCallback(async () => {
    setLista(null)
    const { data, error } = await supabase.from(aba).select('*').order('nome')
    if (error) { setMsg({ erro: true, texto: error.message }); setLista([]) } else setLista(data || [])
  }, [aba])
  const carregarExec = useCallback(async () => {
    const { data } = await supabase.from('integracao_execucoes').select('*').order('inicio', { ascending: false }).limit(1).maybeSingle()
    setExec(data || null)
  }, [])
  useEffect(() => { if (online) { carregar(); carregarExec() } }, [online, carregar, carregarExec])

  const salvar = async (reg, d) => {
    setMsg(null)
    const campos = Object.fromEntries(CAMPOS.map(([k]) => [k, (d[k] || '').trim() || null]))
    if (!campos.nome || campos.nome.length < 2) return setMsg({ erro: true, texto: 'Informe o nome.' })
    const repetido = (lista || []).some((x) => x.id !== reg?.id && x.nome.toLowerCase() === campos.nome.toLowerCase())
    if (repetido) return setMsg({ erro: true, texto: 'Já existe um cadastro com esse nome.' })
    campos.ativo = d.ativo !== false
    const { error } = reg ? await supabase.from(aba).update(campos).eq('id', reg.id)
      : await supabase.from(aba).insert({ id: crypto.randomUUID(), ...campos })
    if (error) return setMsg({ erro: true, texto: 'Não foi possível salvar: ' + error.message })
    setMsg({ texto: reg ? 'Cadastro atualizado.' : 'Cadastrado.' }); setAberto(null); await carregar(); onAlterado?.()
  }
  const sincronizar = async () => {
    setSincronizando(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('apresentame', { body: { acao: 'sincronizar' } })
    let erro = data?.erro || null
    if (error) { erro = error.message; try { erro = (await error.context.json()).erro || erro } catch { /* sem corpo */ } }
    setSincronizando(false)
    setMsg(erro ? { erro: true, texto: erro } : { texto: `Sincronizado: ${data.lancamentos} lançamentos desde ${data.desde.split('-').reverse().join('/')} · ${data.fornecedores_novos} fornecedor(es) e ${data.clientes_novos} cliente(s) novos.` })
    await carregarExec(); await carregar(); onAlterado?.()
  }

  if (!online) return <p className="dica">Clientes e fornecedores só podem ser consultados com sinal de internet.</p>
  const filtrados = (lista || []).filter((x) => !busca || x.nome.toLowerCase().includes(busca.toLowerCase()) || (x.documento || '').includes(busca))
  return (
    <div className="form">
      <div className="etapa">
        <b>Apresenta.me</b>
        <span>{exec ? `Última sincronização: ${dataHora(exec.inicio)} — ${exec.ok ? `ok, ${exec.resumo?.lancamentos ?? 0} lançamentos` : exec.ok === false ? 'com erro' : 'em andamento'}` : 'Ainda não sincronizado.'}</span>
        {exec?.ok === false && <small className="aviso-sem-plano">{exec.erro}</small>}
        <small>Traz o financeiro da Barra Maricultura e os fornecedores (despesas) e clientes (receitas). Só leitura: nada é alterado no Apresenta.me.</small>
        <button type="button" className="primario" disabled={sincronizando} onClick={sincronizar}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
      </div>
      <div className="alternar">{[['clientes', 'Clientes'], ['fornecedores', 'Fornecedores']].map(([k, n]) => (
        <button key={k} type="button" className={aba === k ? 'sel' : ''} onClick={() => { setAba(k); setAberto(null); setBusca('') }}>{n}</button>))}</div>
      {msg && <p className={`dica esq ${msg.erro ? 'aviso-sem-plano' : 'msg-ok'}`}>{msg.texto}</p>}
      <div className="cad-topo">
        <input className="cad-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar ${aba}`} />
        <button type="button" className="mais" onClick={() => setAberto('novo')}>+ Novo</button>
      </div>
      {aberto === 'novo' && <FormPessoa onSalvar={(d) => salvar(null, d)} onFechar={() => setAberto(null)} />}
      {lista == null ? <p className="dica">Carregando…</p> : filtrados.length === 0 ? <p className="dica">Nenhum cadastro{busca ? ' com essa busca' : ''}.</p> : (
        <ul className="reg-lista">{filtrados.map((x) => (
          <li key={x.id} className={`${aberto === x.id ? 'aberto' : ''} ${x.ativo === false ? 'inativo' : ''}`}>
            <button type="button" className="reg-linha" onClick={() => setAberto(aberto === x.id ? null : x.id)}>
              <b>{x.nome}</b>
              <span>{[x.documento, x.telefone, x.cidade].filter(Boolean).join(' · ') || ' '}</span>
              <small>{x.apresentame_person_id ? `Apresenta.me #${x.apresentame_person_id}` : 'cadastrado aqui'}{x.ativo === false ? ' · inativo' : ''}</small>
            </button>
            {aberto === x.id && <FormPessoa reg={x} onSalvar={(d) => salvar(x, d)} onFechar={() => setAberto(null)} />}
          </li>))}</ul>
      )}
    </div>
  )
}

function FormPessoa({ reg, onSalvar, onFechar }) {
  const [d, setD] = useState(() => ({ ...Object.fromEntries(CAMPOS.map(([k]) => [k, reg?.[k] || ''])), ativo: reg?.ativo !== false }))
  return (
    <div className="reg-editor">
      {CAMPOS.map(([k, rot]) => (
        <label key={k} className="campo"><span>{rot}</span>
          <input value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} inputMode={k === 'telefone' ? 'tel' : undefined} /></label>
      ))}
      {reg?.apresentame_person_id && <p className="dica esq">Ligado ao Apresenta.me: o nome é atualizado a cada sincronização.</p>}
      {reg && <label className="cad-ativo"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
      <div className="reg-botoes">
        <button type="button" className="primario" onClick={() => onSalvar(d)}>{reg ? 'Salvar' : 'Cadastrar'}</button>
        <button type="button" className="mais" onClick={onFechar}>Fechar</button>
      </div>
    </div>
  )
}
