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
// Funcionário sem e-mail entra com um "usuário" (ex.: joao); por trás vira joao@equipe.barramaricultura.com.br
// (só para o login, nenhum e-mail é enviado). Mesma regra da Edge Function supabase/functions/usuarios.
export const DOMINIO_EQUIPE = 'equipe.barramaricultura.com.br'
export const normalizaLogin = (s) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
export const emailDoLogin = (login) => (login.includes('@') ? login.trim().toLowerCase() : `${normalizaLogin(login)}@${DOMINIO_EQUIPE}`)

const TABELA = { cliente: 'clientes', previsao: 'previsoes_despesca', ciclo: 'ciclos', povoamento: 'povoamentos', despesca: 'despescas', estoque: 'estoque_movimentos', produto: 'produtos', plano: 'planos_racao', insumo: 'aplicacoes_insumos', racao: 'racao', colocacao: 'bandeja_colocacoes', retirada: 'bandeja_retiradas', biometria: 'biometrias', agua: 'agua', ocorrencia: 'ocorrencias' }

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
    const dataIni = diasAtras(dias + 20) // ~20 dias de preparação antes do povoamento
    ciclos.push({ id: cid, viveiro_id: vid, codigo: `${cod}-${dataIni}`, data_inicio: dataIni, data_povoamento: dataPov, status: 'em_cultivo' })
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
    ['p10', 'PL Carapitanga', 'pos_larva', 'un'],
  ].map(([id, nome, categoria, unidade]) => ({ id: `demo-${id}`, nome, categoria, unidade, ativo: true,
    ...{ p1: { saldo: 2400, estoque_minimo: 1500 }, p2: { saldo: 850 }, p3: { saldo: 120, estoque_minimo: 100 },
      p4: { saldo: 300 }, p5: { saldo: 0 }, p6: { saldo: 1000 }, p7: { saldo: 40, estoque_minimo: 100 },
      p8: { saldo: 20 }, p9: { saldo: 0 }, p10: { saldo: 330000 } }[id] }))
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
  const clientes = [{ id: 'demo-cl1', nome: 'Comprador A (exemplo)', telefone: null }, { id: 'demo-cl2', nome: 'Comprador B (exemplo)', telefone: null }]
  const previsoes = [{ id: 'demo-pv1', ciclo_id: 'demo-c8', cliente_id: 'demo-cl1', data_prevista: diasAtras(-5), biomassa_prev_kg: 2500,
    peso_medio_prev_g: 13.5, preco_kg_prev: 28, status: 'aberta', observacao: null }]
  return { versao: 6, clientes, previsoes, carregado_em: new Date().toISOString(), viveiros, ciclos, resumos, fornecedores: ['Carapitanga', 'Larva da Barra'], biometrias, produtos, planos, perfil: 'gestor', colocacoes: [], config: { tratos_por_dia: 4,
    parametros_agua: ['od', 'ph', 'temperatura', 'salinidade', 'transparencia'] } }
}

// ---------- Cadastro (viveiros, ciclos ativos, configuração) ----------
export async function carregarCadastro() {
  let cad = await get('cadastro')
  if (MODO_DEMO) {
    if (!cad || cad.versao !== 6) { cad = cadastroDemo(); await set('cadastro', cad) }
    return cad
  }
  if (navigator.onLine) {
    try {
      const carregado_em = new Date().toISOString() // saldo do servidor vale até aqui
      const desde = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess.session?.user?.id
      const [v, c, cfg, b, col, prod, pl, pf, bc, fo, cl, pv, rc] = await Promise.all([
        supabase.from('viveiros').select('*').eq('ativo', true).order('codigo'),
        supabase.from('ciclos').select('*').in('status', ['preparacao', 'em_cultivo']),
        supabase.from('configuracoes').select('*'),
        supabase.from('vw_ciclo_resumo').select('ciclo_id, ultimo_peso_g, ultima_biometria, pl_quantidade, racao_consumida_kg, populacao_despescada, biomassa_despescada_kg, sobrevivencia_est_pct').in('status', ['preparacao', 'em_cultivo']),
        // colocações recentes (de qualquer aparelho) e se já têm retirada
        supabase.from('bandeja_colocacoes').select('id, ciclo_id, data, hora, kg_bandejas, lancado_por, bandeja_retiradas(id, data, hora, sobra_kg, resultado, lancado_por)').gte('data', desde),
        supabase.from('vw_estoque_saldo').select('id, nome, categoria, unidade, estoque_minimo, saldo').eq('ativo', true).order('nome'),
        supabase.from('planos_racao').select('*').order('data_inicio', { ascending: false }).order('criado_em', { ascending: false }).limit(300),
        uid ? supabase.from('perfis').select('perfil, nome').eq('user_id', uid).maybeSingle() : Promise.resolve({ data: null }),
        // biometrias por tamanho (só distribuição / uniformidade)
        supabase.from('biometrias').select('ciclo_id, data, hora, classes').eq('tipo', 'classes')
          .order('data', { ascending: false }).order('hora', { ascending: false }).limit(200),
        supabase.from('povoamentos').select('fornecedor').order('data', { ascending: false }).limit(200),
        // clientes e previsões de despesca: só o gestor enxerga (RLS); para o campo voltam vazios
        supabase.from('clientes').select('id, nome, telefone').eq('ativo', true).order('nome'),
        supabase.from('previsoes_despesca').select('*').eq('status', 'aberta').order('data_prevista'),
        // tratos recentes (de qualquer aparelho ou importados) para ração de hoje/ontem e tratos feitos
        supabase.from('racao').select('id, ciclo_id, data, hora, trato, kg').gte('data', desde).order('data', { ascending: false }).limit(500),
      ])
      if (v.error || c.error) throw v.error || c.error
      const config = { tratos_por_dia: 4, parametros_agua: ['od', 'ph', 'temperatura', 'salinidade', 'transparencia'] }
      ;(cfg.data || []).forEach((r) => (config[r.chave] = r.valor))
      cad = {
        carregado_em,
        viveiros: v.data, ciclos: c.data, config,
        resumos: Object.fromEntries((b.data || []).map((r) => [r.ciclo_id, {
          pl_quantidade: Number(r.pl_quantidade), racao_consumida_kg: Number(r.racao_consumida_kg),
          populacao_despescada: Number(r.populacao_despescada), biomassa_despescada_kg: Number(r.biomassa_despescada_kg),
          sobrevivencia_est_pct: r.sobrevivencia_est_pct == null ? null : Number(r.sobrevivencia_est_pct) }])),
        clientes: cl.data || [],
        tratos: (rc.data || []).map((r) => ({ ...r, kg: Number(r.kg), hora: String(r.hora).slice(0, 5) })),
        previsoes: (pv.data || []).map((r) => ({ ...r, biomassa_prev_kg: Number(r.biomassa_prev_kg), peso_medio_prev_g: Number(r.peso_medio_prev_g),
          preco_kg_prev: r.preco_kg_prev == null ? null : Number(r.preco_kg_prev) })),
        fornecedores: [...new Set((fo.data || []).map((r) => r.fornecedor).filter(Boolean))],
        biometrias: (b.data || []).filter((r) => r.ultimo_peso_g)
          .map((r) => ({ ciclo_id: r.ciclo_id, data: r.ultima_biometria, peso_medio_g: Number(r.ultimo_peso_g) })),
        produtos: (prod.data || []).map((p) => ({ ...p, saldo: Number(p.saldo), estoque_minimo: p.estoque_minimo == null ? null : Number(p.estoque_minimo) })),
        distribuicoes: (bc.data || []).map((r) => ({ ...r, hora: String(r.hora).slice(0, 5) })),
        planos: (pl.data || []).map((r) => ({ ...r, kg_dia: Number(r.kg_dia), sobrevivencia_est: r.sobrevivencia_est == null ? null : Number(r.sobrevivencia_est) })),
        perfil: pf.data?.perfil || 'campo',
        nome: pf.data?.nome || sess.session?.user?.user_metadata?.nome || sess.session?.user?.email?.split('@')[0] || 'Usuário',
        uid,
        colocacoes: (col.data || []).map((r) => ({
          id: r.id, ciclo_id: r.ciclo_id, data: r.data, hora: String(r.hora).slice(0, 5), kg_bandejas: Number(r.kg_bandejas),
          lancado_por: r.lancado_por,
          retirada: r.bandeja_retiradas?.[0] ? { ...r.bandeja_retiradas[0], hora: String(r.bandeja_retiradas[0].hora).slice(0, 5), sobra_kg: Number(r.bandeja_retiradas[0].sobra_kg) } : null,
        })),
      }
      await set('cadastro', cad)
    } catch (e) { console.warn('Sem acesso ao servidor, usando cadastro salvo', e) }
  }
  return cad || { viveiros: [], ciclos: [], resumos: {}, fornecedores: [], clientes: [], previsoes: [], biometrias: [], colocacoes: [], produtos: [], planos: [], perfil: 'campo', config: { tratos_por_dia: 4, parametros_agua: [] } }
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
        if (['produto', 'ciclo', 'cliente'].includes(item.tipo)) delete dados.lancado_por
        // lançamentos do campo só podem ser inseridos (corrigir é do admin): reenvio do mesmo id é ignorado.
        // ciclo, plano, previsão, produto etc. podem ser alterados pelo gestor: reenvio atualiza.
        const soInsere = ['racao', 'colocacao', 'retirada', 'biometria', 'agua', 'ocorrencia', 'insumo'].includes(item.tipo)
        const { error } = await supabase.from(TABELA[item.tipo]).upsert(dados, { onConflict: 'id', ignoreDuplicates: soInsere })
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

// Sair: apaga o cadastro guardado (perfil/nome do usuário anterior); lançamentos não enviados continuam no aparelho.
export async function sair() { await set('cadastro', null); await supabase.auth.signOut() }

// Equipe (só gestor): chama a Edge Function "usuarios", que usa a chave de administração no servidor.
export async function equipe(acao, dados = {}) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body: { acao, ...dados } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).erro || msg } catch { /* sem corpo */ }
    throw new Error(msg)
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

export const getOperador = () => get('operador')
export const setOperador = (n) => set('operador', n)
export async function resetarDemo() { await set('cadastro', cadastroDemo()); await set('lancamentos', []) }

// ---------- Painel do escritório: séries históricas (precisa de sinal; na demonstração, séries de exemplo) ----------
export async function carregarPainel(cad) {
  if (MODO_DEMO) return painelDemo(cad)
  const desde = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)
  const ids = (cad.ciclos || []).map((c) => c.id)
  const [res, bio, rac, ag, ret, enc, fin] = await Promise.all([
    supabase.from('vw_ciclo_resumo').select('*').in('status', ['preparacao', 'em_cultivo']),
    supabase.from('biometrias').select('ciclo_id, data, peso_medio_g').eq('tipo', 'simples').in('ciclo_id', ids).order('data'),
    supabase.from('vw_racao_diaria').select('*').in('ciclo_id', ids).gte('data', desde).order('data'),
    supabase.from('agua').select('ciclo_id, data, hora, od, ph, temperatura, salinidade').in('ciclo_id', ids).gte('data', desde)
      .order('data', { ascending: false }).order('hora', { ascending: false }),
    supabase.from('bandeja_retiradas').select('ciclo_id, data, resultado').in('ciclo_id', ids).gte('data', desde).order('data', { ascending: false }),
    supabase.from('vw_ciclo_resumo').select('*').eq('status', 'encerrado').order('data_fim', { ascending: false }).limit(300),
    // vendas e custos por ciclo (histórico do Meu Pescado; só o gestor enxerga)
    supabase.from('vw_ciclo_financeiro_historico').select('*'),
  ])
  const erro = [res, bio, rac, ag, ret, enc, fin].find((r) => r.error)?.error
  if (erro) throw erro
  const n = (x) => (x == null ? null : Number(x))
  return {
    resumos: Object.fromEntries(res.data.map((r) => [r.ciclo_id, r])),
    biometrias: bio.data.map((r) => ({ ...r, peso_medio_g: n(r.peso_medio_g) })),
    racao: rac.data.map((r) => ({ ...r, colocado_kg: n(r.colocado_kg), consumido_kg: n(r.consumido_kg), sobra_kg: n(r.sobra_kg) })),
    agua: ag.data.map((r) => ({ ...r, od: n(r.od), ph: n(r.ph), temperatura: n(r.temperatura) })),
    retiradas: ret.data,
    encerrados: juntaFinanceiro(enc.data, fin.data),
    demo: false,
  }
}

function painelDemo(cad) {
  const biometrias = [], racao = [], agua = [], retiradas = []
  const dia = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
  ;(cad.ciclos || []).forEach((c, i) => {
    const dias = Math.round((Date.now() - new Date(c.data_povoamento)) / 864e5)
    const atual = cad.biometrias.find((b) => b.ciclo_id === c.id)?.peso_medio_g
    if (atual) for (let d = 14; d <= dias; d += 7) {
      const frac = d / dias
      biometrias.push({ ciclo_id: c.id, data: dia(dias - d), peso_medio_g: Math.round(atual * frac ** 1.35 * 100) / 100 })
    }
    const kg = cad.planos.find((p) => p.ciclo_id === c.id)?.kg_dia || 0
    for (let d = Math.min(30, dias); d >= 1; d--) {
      const base = kg * (1 - d * 0.008) * (0.92 + ((i * 7 + d * 13) % 17) / 100)
      racao.push({ ciclo_id: c.id, data: dia(d), colocado_kg: Math.round(base), consumido_kg: Math.round(base * 0.97), sobra_kg: Math.round(base * 0.03) })
    }
    agua.push({ ciclo_id: c.id, data: dia(0), hora: '05:30', od: [4.8, 5.2, 3.6, 4.1, 2.7, 3.9, 5.5, 3.2][i % 8], ph: 7.9, temperatura: 29.5, salinidade: 18 })
    retiradas.push({ ciclo_id: c.id, data: dia(1), resultado: ['pouca_sobra', 'zerou', 'pouca_sobra', 'muita_sobra', 'pouca_sobra', 'zerou', 'pouca_sobra', 'pouca_sobra'][i % 8] })
  })
  const encerrados = juntaFinanceiro([
    { ciclo_id: 'e1', viveiro: 'V07', codigo: 'V07-exemplo-1', data_povoamento: dia(120), data_fim: dia(28), dias_cultivo: 92, pl_quantidade: 300000, biomassa_despescada_kg: 2650, populacao_despescada: 212000, sobrevivencia_real_pct: 70.7, fca: 1.48 },
    { ciclo_id: 'e2', viveiro: 'V02', codigo: 'V02-exemplo-1', data_povoamento: dia(135), data_fim: dia(26), dias_cultivo: 109, pl_quantidade: 300000, biomassa_despescada_kg: 1980, populacao_despescada: 138000, sobrevivencia_real_pct: 46, fca: 2.21 },
    { ciclo_id: 'e3', viveiro: 'V05', codigo: 'V05-exemplo-1', data_povoamento: dia(260), data_fim: dia(140), dias_cultivo: 118, pl_quantidade: 300000, biomassa_despescada_kg: 2100, populacao_despescada: 120000, sobrevivencia_real_pct: 40, fca: 2.6 },
  ], [
    { ciclo_id: 'e1', faturamento: 63600, custo: 41000, resultado: 22600, clientes: 'Comprador A (exemplo)' },
    { ciclo_id: 'e2', faturamento: 43560, custo: 47100, resultado: -3540, clientes: 'Comprador B (exemplo)' },
    { ciclo_id: 'e3', faturamento: 48300, custo: 61000, resultado: -12700, clientes: 'Comprador A (exemplo)' },
  ])
  return { resumos: {}, biometrias, racao, agua, retiradas, encerrados, demo: true }
}

function juntaFinanceiro(enc, fin) {
  const n = (x) => (x == null ? null : Number(x))
  const porCiclo = Object.fromEntries((fin || []).map((f) => [f.ciclo_id, f]))
  return (enc || []).map((c) => {
    const f = porCiclo[c.ciclo_id] || {}
    return { ...c, dias_cultivo: n(c.dias_cultivo), pl_quantidade: n(c.pl_quantidade), biomassa_despescada_kg: n(c.biomassa_despescada_kg),
      populacao_despescada: n(c.populacao_despescada), sobrevivencia_real_pct: n(c.sobrevivencia_real_pct), fca: n(c.fca),
      faturamento: n(f.faturamento), custo: n(f.custo), resultado: n(f.resultado), clientes: f.clientes || null, origem_fin: f.origem || null }
  })
}
