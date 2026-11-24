// Camada de dados: guarda tudo no aparelho (IndexedDB) e sincroniza com o
// Supabase quando houver internet. Sem Supabase configurado, roda em modo
// demonstração com os viveiros de exemplo.
import { get as idbGet, set as idbSet } from 'idb-keyval'

// Se o navegador bloquear o IndexedDB, guarda em memória (só na sessão).
const memoria = new Map()
async function get(k) { try { return await idbGet(k) } catch { return memoria.get(k) } }
async function set(k, v) { memoria.set(k, v); try { await idbSet(k, v) } catch { /* sem armazenamento */ } }
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = URL && KEY ? createClient(URL, KEY) : null
export const MODO_DEMO = !supabase

const TABELA = { ciclo: 'ciclos', povoamento: 'povoamentos', despesca: 'despescas', estoque: 'estoque_movimentos', produto: 'produtos', plano: 'planos_racao', insumo: 'aplicacoes_insumos', racao: 'racao', colocacao: 'bandeja_colocacoes', retirada: 'bandeja_retiradas', biometria: 'biometrias', agua: 'agua', ocorrencia: 'ocorrencias' }

export const hoje = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const diasAtras = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
export const agora = () => new Date().toTimeString().slice(0, 5)
export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

// ---------- Dados de demonstração (situação dos viveiros em 24/11/2026) ----------
function cadastroDemo() {
  const base = [
    ['V01', 3, 83, 300000, 'Carapitanga', 11.9],
    ['V02', 3, 14, 300000, 'Carapitanga', 0.02],
    ['V03', 3, 54, 300000, 'Larva da Barra', 5.07],
    ['V04', 3, 54, 300000, 'Larva da Barra', 5.3],
    ['V05', 3, 105, 300000, 'Carapitanga', 12.4],
    ['V06', 3, 104, 300000, 'Carapitanga', 10.53],
    ['V07', 3, 13, 300000, 'Carapitanga', 0.02],
    ['V08', 3.8, 102, 400000, 'Carapitanga', 12.65],
  ]
  const viveiros = [], ciclos = [], biometrias = [], resumos = {}
  base.forEach(([cod, area, dias, pl, , peso], i) => {
    const vid = `demo-v${i + 1}`, cid = `demo-c${i + 1}`
    const dataPov = diasAtras(dias)
    viveiros.push({ id: vid, codigo: cod, area_ha: area, ativo: true })
    ciclos.push({ id: cid, viveiro_id: vid, codigo: `${cod}-${dataPov}`, data_povoamento: dataPov, status: 'em_cultivo' })
    if (dias > 20) biometrias.push({ ciclo_id: cid, data: diasAtras(7), peso_medio_g: peso })
    // ração consumida até hoje (aproximada, só para a demonstração)
    resumos[cid] = { pl_quantidade: pl, racao_consumida_kg: Math.round(dias * dias * 0.42 * (area / 3)),
      populacao_despescada: 0, biomassa_despescada_kg: 0 }
  })
  const produtos = [
    ['p1', 'Ração engorda 35% PB 2,0 mm', 'racao', 'kg'], ['p2', 'Ração engorda 32% PB 2,4 mm', 'racao', 'kg'],
    ['p3', 'Ração crescimento 40% PB 1,2 mm', 'racao', 'kg'], ['p4', 'Ureia', 'fertilizante', 'kg'],
    ['p5', 'Superfosfato triplo', 'fertilizante', 'kg'], ['p6', 'Calcário dolomítico', 'calcario', 'kg'],
    ['p7', 'Cal hidratada', 'calcario', 'kg'], ['p8', 'Probiótico', 'probiotico', 'L'], ['p9', 'Melaço', 'outro', 'L'],
  ].map(([id, nome, categoria, unidade]) => ({ id: `demo-${id}`, nome, categoria, unidade, ativo: true,
    ...{ p1: { saldo: 2400, estoque_minimo: 1500 }, p2: { saldo: 850 }, p3: { saldo: 120, estoque_minimo: 100 },
      p4: { saldo: 300 }, p5: { saldo: 0 }, p6: { saldo: 1000 }, p7: { saldo: 40, estoque_minimo: 100 },
      p8: { saldo: 20 }, p9: { saldo: 0 } }[id] }))
  // plano de exemplo: ~3% da biomassa para os maiores, ração inicial para os novos
  const kgDia = { V01: 84, V02: 6, V03: 48, V04: 50, V05: 68, V06: 76, V07: 6, V08: 120 }
  const planos = ciclos.map((c, i) => {
    const cod = viveiros[i].codigo, kg = kgDia[cod]
    const novo = kg < 10
    const tratos = [1, 2, 3, 4].map((t) => ({ trato: t, kg: Math.round((kg / 4) * 10) / 10 }))
    return { id: `demo-pl${i}`, ciclo_id: c.id, data_inicio: diasAtras(1), kg_dia: kg, tratos,
      sobrevivencia_est: novo ? null : ['V05', 'V06', 'V08'].includes(cod) ? 55 : 70,
      produto_id: novo ? 'demo-p3' : 'demo-p1', lancado_por: 'Gestor (exemplo)' }
  })
  return { versao: 3, carregado_em: new Date().toISOString(), viveiros, ciclos, resumos, fornecedores: ['Carapitanga', 'Larva da Barra'], biometrias, produtos, planos, perfil: 'gestor', colocacoes: [], config: { tratos_por_dia: 4,
    parametros_agua: ['od', 'ph', 'temperatura', 'salinidade', 'transparencia'] } }
}

// ---------- Cadastro (viveiros, ciclos ativos, configuração) ----------
export async function carregarCadastro() {
  let cad = await get('cadastro')
  if (MODO_DEMO) {
    if (!cad || cad.versao !== 3) { cad = cadastroDemo(); await set('cadastro', cad) }
    return cad
  }
  if (navigator.onLine) {
    try {
      const carregado_em = new Date().toISOString() // saldo do servidor vale até aqui
      const desde = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess.session?.user?.id
      const [v, c, cfg, b, col, prod, pl, pf, bc, fo] = await Promise.all([
        supabase.from('viveiros').select('*').eq('ativo', true).order('codigo'),
        supabase.from('ciclos').select('*').eq('status', 'em_cultivo'),
        supabase.from('configuracoes').select('*'),
        supabase.from('vw_ciclo_resumo').select('ciclo_id, ultimo_peso_g, ultima_biometria, pl_quantidade, racao_consumida_kg, populacao_despescada, biomassa_despescada_kg').eq('status', 'em_cultivo'),
        // colocações recentes (de qualquer aparelho) e se já têm retirada
        supabase.from('bandeja_colocacoes').select('id, ciclo_id, data, hora, kg_bandejas, lancado_por, bandeja_retiradas(id, data, hora, sobra_kg, resultado, lancado_por)').gte('data', desde),
        supabase.from('vw_estoque_saldo').select('id, nome, categoria, unidade, estoque_minimo, saldo').eq('ativo', true).order('nome'),
        supabase.from('planos_racao').select('*').order('data_inicio', { ascending: false }).order('criado_em', { ascending: false }).limit(300),
        uid ? supabase.from('perfis').select('perfil').eq('user_id', uid).maybeSingle() : Promise.resolve({ data: null }),
        // biometrias por tamanho (só distribuição / uniformidade)
        supabase.from('biometrias').select('ciclo_id, data, hora, classes').eq('tipo', 'classes')
          .order('data', { ascending: false }).order('hora', { ascending: false }).limit(200),
        supabase.from('povoamentos').select('fornecedor').order('data', { ascending: false }).limit(200),
      ])
      if (v.error || c.error) throw v.error || c.error
      const config = { tratos_por_dia: 4, parametros_agua: ['od', 'ph', 'temperatura', 'salinidade', 'transparencia'] }
      ;(cfg.data || []).forEach((r) => (config[r.chave] = r.valor))
      cad = {
        carregado_em,
        viveiros: v.data, ciclos: c.data, config,
        resumos: Object.fromEntries((b.data || []).map((r) => [r.ciclo_id, {
          pl_quantidade: Number(r.pl_quantidade), racao_consumida_kg: Number(r.racao_consumida_kg),
          populacao_despescada: Number(r.populacao_despescada), biomassa_despescada_kg: Number(r.biomassa_despescada_kg) }])),
        fornecedores: [...new Set((fo.data || []).map((r) => r.fornecedor).filter(Boolean))],
        biometrias: (b.data || []).filter((r) => r.ultimo_peso_g)
          .map((r) => ({ ciclo_id: r.ciclo_id, data: r.ultima_biometria, peso_medio_g: Number(r.ultimo_peso_g) })),
        produtos: (prod.data || []).map((p) => ({ ...p, saldo: Number(p.saldo), estoque_minimo: p.estoque_minimo == null ? null : Number(p.estoque_minimo) })),
        distribuicoes: (bc.data || []).map((r) => ({ ...r, hora: String(r.hora).slice(0, 5) })),
        planos: (pl.data || []).map((r) => ({ ...r, kg_dia: Number(r.kg_dia), sobrevivencia_est: r.sobrevivencia_est == null ? null : Number(r.sobrevivencia_est) })),
        perfil: pf.data?.perfil || 'campo',
        colocacoes: (col.data || []).map((r) => ({
          id: r.id, ciclo_id: r.ciclo_id, data: r.data, hora: String(r.hora).slice(0, 5), kg_bandejas: Number(r.kg_bandejas),
          lancado_por: r.lancado_por,
          retirada: r.bandeja_retiradas?.[0] ? { ...r.bandeja_retiradas[0], hora: String(r.bandeja_retiradas[0].hora).slice(0, 5), sobra_kg: Number(r.bandeja_retiradas[0].sobra_kg) } : null,
        })),
      }
      await set('cadastro', cad)
    } catch (e) { console.warn('Sem acesso ao servidor, usando cadastro salvo', e) }
  }
  return cad || { viveiros: [], ciclos: [], resumos: {}, fornecedores: [], biometrias: [], colocacoes: [], produtos: [], planos: [], perfil: 'campo', config: { tratos_por_dia: 4, parametros_agua: [] } }
}

// ---------- Lançamentos ----------
export async function listarLancamentos() { return (await get('lancamentos')) || [] }

export async function adicionarLancamento(tipo, dados, operador, id = uuid()) {
  const lista = await listarLancamentos()
  const item = { id, tipo, dados: { ...dados, lancado_por: operador },
    criado_em: new Date().toISOString(), sincronizado: false }
  lista.unshift(item)
  await set('lancamentos', lista)
  return item
}

export async function excluirLancamento(id) {
  const lista = await listarLancamentos()
  const item = lista.find((l) => l.id === id)
  if (!item || item.sincronizado) return false // depois de enviado, correção é no escritório
  await set('lancamentos', lista.filter((l) => l.id !== id))
  return true
}

let sincronizando = false
export async function sincronizar() {
  if (sincronizando || !navigator.onLine) return { enviados: 0, erro: null }
  sincronizando = true
  let enviados = 0, erro = null
  try {
    const lista = await listarLancamentos()
    const fila = lista.filter((l) => !l.sincronizado).sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    for (const item of fila) {
      if (MODO_DEMO) { await new Promise((r) => setTimeout(r, 120)) }
      else {
        const dados = { id: item.id, ...item.dados }
        if (item.tipo === 'produto' || item.tipo === 'ciclo') delete dados.lancado_por
        const { error } = await supabase.from(TABELA[item.tipo]).upsert(dados, { onConflict: 'id' })
        if (error) { erro = error.message; break }
      }
      item.sincronizado = true; item.enviado_em = new Date().toISOString(); enviados++
    }
    // mantém no aparelho só os últimos 30 dias já enviados
    const limite = Date.now() - 30 * 864e5
    await set('lancamentos', lista.filter((l) => !l.sincronizado || new Date(l.criado_em) > limite))
  } finally { sincronizando = false }
  return { enviados, erro }
}

export const getOperador = () => get('operador')
export const setOperador = (n) => set('operador', n)
export async function resetarDemo() { await set('cadastro', cadastroDemo()); await set('lancamentos', []) }
