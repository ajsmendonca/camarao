// Edge Function "apresentame": integração SÓ DE LEITURA com o Apresenta.me (financeiro da Barra Maricultura).
// Copia os lançamentos (despesas e receitas) para financeiro_lancamentos e preenche fornecedores (pessoas das despesas)
// e clientes (pessoas das receitas), ligados por apresentame_person_id. Nunca grava no Apresenta.me.
// Segredos (Supabase › Edge Functions › Secrets; nunca no app nem no chat):
//   APRESENTAME_URL    endereço base da API (ex.: https://api.apresenta.me)
//   APRESENTAME_TOKEN  chave de acesso
//   APRESENTAME_HEADER (opcional) nome do cabeçalho da chave; padrão "Authorization: Bearer <chave>"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const EMPRESA = 1754                     // Barra Maricultura LTDA (business_id)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function apresentame(caminho: string, params: Record<string, string | string[]>) {
  const base = (Deno.env.get('APRESENTAME_URL') || '').replace(/\/+$/, '')
  const chave = Deno.env.get('APRESENTAME_TOKEN') || ''
  if (!base || !chave) throw new Error('Integração não configurada: faltam os segredos APRESENTAME_URL e/ou APRESENTAME_TOKEN no Supabase.')
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) (Array.isArray(v) ? v : [v]).forEach((x) => qs.append(k, x))
  const cab = Deno.env.get('APRESENTAME_HEADER')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cab) headers[cab] = chave; else headers.Authorization = `Bearer ${chave}`
  const r = await fetch(`${base}${caminho}?${qs}`, { headers })
  const texto = await r.text()
  if (!r.ok) throw new Error(`Apresenta.me respondeu ${r.status}: ${texto.slice(0, 300)}`)
  try { return JSON.parse(texto) } catch { throw new Error(`Resposta inesperada do Apresenta.me: ${texto.slice(0, 200)}`) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return json({ erro: 'Entre novamente.' }, 401)
  const { data: eu } = await db.from('perfis').select('perfil, nome').eq('user_id', user.id).maybeSingle()
  if (!['gestor', 'admin'].includes(eu?.perfil)) return json({ erro: 'Só gestor ou admin sincronizam com o Apresenta.me.' }, 403)
  const b = await req.json().catch(() => ({}))

  const { data: exec } = await db.from('integracao_execucoes').insert({ executado_por: eu?.nome }).select('id').single()
  const fim = async (ok: boolean, resumo: unknown, erro?: string) =>
    db.from('integracao_execucoes').update({ fim: new Date().toISOString(), ok, resumo, erro: erro || null }).eq('id', exec!.id)

  try {
    // desde quando: o pedido, ou 60 dias antes do lançamento mais recente já copiado, ou 01/01/2026
    let desde: string = b.desde
    if (!desde) {
      const { data: ult } = await db.from('financeiro_lancamentos').select('data').order('data', { ascending: false }).limit(1).maybeSingle()
      desde = ult?.data ? new Date(new Date(ult.data).getTime() - 60 * 864e5).toISOString().slice(0, 10) : '2026-01-01'
    }
    const linhas: Record<string, unknown>[] = []
    const pessoas = new Map<number, { nome: string; despesa: boolean; receita: boolean }>()
    let pagina = 1, ultima = 1
    do {
      const r = await apresentame('/transactions', {
        'filter[business_id]': String(EMPRESA), sort: '-date', page: String(pagina), perPage: '50',
        'include[]': ['plan', 'person'],
      })
      const dados = r.data || []
      ultima = r.last_page || 1
      let antigos = 0
      for (const t of dados) {
        if (!t.date || t.date < desde) { antigos++; continue }
        if (t.transfer_id) continue                              // transferências internas não são custo nem receita
        linhas.push({
          apresentame_id: t.id, data: t.date, competencia: t.competence || null, tipo: t.type, valor: Math.abs(Number(t.amount)),
          descricao: t.description || null, plano_id: t.plan_id || null, plano_nome: t.plan?.description || null,
          centro_custo_id: t.cost_center_id || null, pessoa_id: t.person_id || null, pessoa_nome: t.person?.name || null,
          pago: !!t.paid, observacoes: t.notes || null, atualizado_em: new Date().toISOString(),
        })
        if (t.person_id && t.person?.name) {
          const p = pessoas.get(t.person_id) || { nome: t.person.name, despesa: false, receita: false }
          if (t.type === 'debit') p.despesa = true; else p.receita = true
          pessoas.set(t.person_id, p)
        }
      }
      if (antigos === dados.length) break                        // página inteira mais antiga que "desde": acabou
      pagina++
    } while (pagina <= ultima && pagina <= 200)

    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await db.from('financeiro_lancamentos').upsert(linhas.slice(i, i + 500), { onConflict: 'apresentame_id' })
      if (error) throw error
    }
    // fornecedores (despesas) e clientes (receitas): liga pelo id do Apresenta.me; se já houver o mesmo nome sem ligação, liga
    const liga = async (tabela: string, id: number, nome: string) => {
      const { data: ja } = await db.from(tabela).select('id').eq('apresentame_person_id', id).maybeSingle()
      if (ja) { await db.from(tabela).update({ nome }).eq('id', ja.id); return 0 }
      const { data: mesmo } = await db.from(tabela).select('id').is('apresentame_person_id', null).ilike('nome', nome).limit(1).maybeSingle()
      if (mesmo) { await db.from(tabela).update({ apresentame_person_id: id }).eq('id', mesmo.id); return 0 }
      await db.from(tabela).insert({ id: crypto.randomUUID(), nome, apresentame_person_id: id })
      return 1
    }
    let novosF = 0, novosC = 0
    for (const [id, p] of pessoas) {
      if (p.despesa) novosF += await liga('fornecedores', id, p.nome)
      if (p.receita) novosC += await liga('clientes', id, p.nome)
    }
    const resumo = { desde, lancamentos: linhas.length, despesas: linhas.filter((l) => l.tipo === 'debit').length,
      receitas: linhas.filter((l) => l.tipo === 'credit').length, pessoas: pessoas.size, fornecedores_novos: novosF, clientes_novos: novosC, paginas: pagina }
    await fim(true, resumo)
    return json({ ok: true, ...resumo })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    await fim(false, null, msg)
    return json({ erro: msg }, 502)
  }
})
