// Edge Function "usuarios": o administrador (perfil admin) cadastra e administra a equipe pelo app.
// Funcionário sem e-mail entra com um "usuário" (ex.: joao); por trás vira joao@equipe.barramaricultura.com.br
// (endereço que só existe para o login — nenhum e-mail é enviado).
// Usa a chave service_role, que só existe aqui no servidor (nunca no app).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const DOMINIO = 'equipe.barramaricultura.com.br'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// "João Silva" -> "joao.silva"
const normalizaLogin = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
const emailDe = (login: string) => (login.includes('@') ? login.trim().toLowerCase() : `${normalizaLogin(login)}@${DOMINIO}`)
const loginDe = (email: string) => (email.endsWith('@' + DOMINIO) ? email.slice(0, -DOMINIO.length - 1) : email)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ erro: 'Entre novamente.' }, 401)
    const { data: eu } = await admin.from('perfis').select('perfil').eq('user_id', user.id).maybeSingle()
    if (eu?.perfil !== 'admin') return json({ erro: 'Só o administrador pode cuidar da equipe.' }, 403)

    const b = await req.json()
    const senhaOk = (s: unknown) => typeof s === 'string' && s.length >= 6

    if (b.acao === 'listar') {
      const [{ data: perfis }, { data: lista }] = await Promise.all([
        admin.from('perfis').select('user_id, nome, perfil'),
        admin.auth.admin.listUsers({ perPage: 1000 }),
      ])
      const usuarios = (lista?.users || []).map((u) => {
        const p = (perfis || []).find((x) => x.user_id === u.id)
        const bloqueado = u.banned_until && new Date(u.banned_until) > new Date()
        return { id: u.id, nome: p?.nome || u.user_metadata?.nome || loginDe(u.email || ''), perfil: p?.perfil || null,
          login: loginDe(u.email || ''), ativo: !bloqueado, eu: u.id === user.id, ultimo_acesso: u.last_sign_in_at }
      }).sort((a, c) => a.nome.localeCompare(c.nome, 'pt-BR'))
      return json({ usuarios })
    }

    if (b.acao === 'criar') {
      const nome = String(b.nome || '').trim()
      const login = String(b.login || '').trim()
      if (nome.length < 2) return json({ erro: 'Informe o nome.' }, 400)
      if (!login.includes('@') && normalizaLogin(login).length < 3) return json({ erro: 'O usuário precisa de pelo menos 3 letras.' }, 400)
      if (!senhaOk(b.senha)) return json({ erro: 'A senha precisa de pelo menos 6 caracteres.' }, 400)
      if (!['admin', 'gestor', 'campo'].includes(b.perfil)) return json({ erro: 'Perfil inválido.' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email: emailDe(login), password: b.senha, email_confirm: true, user_metadata: { nome } })
      if (error) return json({ erro: /already|registered|exists/i.test(error.message) ? 'Esse usuário já existe.' : error.message }, 400)
      const { error: e2 } = await admin.from('perfis').insert({ user_id: data.user.id, nome, perfil: b.perfil })
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ erro: e2.message }, 400) }
      return json({ ok: true, login: loginDe(data.user.email!) })
    }

    if (b.acao === 'senha') {
      if (!senhaOk(b.senha)) return json({ erro: 'A senha precisa de pelo menos 6 caracteres.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.senha })
      return error ? json({ erro: error.message }, 400) : json({ ok: true })
    }

    if (b.acao === 'alterar') {
      if (b.user_id === user.id && b.perfil && b.perfil !== 'admin') return json({ erro: 'Você não pode tirar o seu próprio acesso de administrador.' }, 400)
      const campos: Record<string, string> = {}
      if (b.nome) campos.nome = String(b.nome).trim()
      if (['admin', 'gestor', 'campo'].includes(b.perfil)) campos.perfil = b.perfil
      const { error } = await admin.from('perfis').update(campos).eq('user_id', b.user_id)
      return error ? json({ erro: error.message }, 400) : json({ ok: true })
    }

    if (b.acao === 'ativo') {
      if (b.user_id === user.id) return json({ erro: 'Você não pode desativar o seu próprio acesso.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.ativo ? 'none' : '876000h' })
      return error ? json({ erro: error.message }, 400) : json({ ok: true })
    }

    return json({ erro: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return json({ erro: String(e?.message || e) }, 500)
  }
})
