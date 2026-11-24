-- ============================================================
-- Controle de produção de camarão — schema Supabase (Postgres)
-- Financeiro fica no Apresenta.me; aqui só produção.
-- Os ids dos lançamentos são gerados no celular (uuid) para a
-- sincronização offline ser idempotente (upsert sem duplicar).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Cadastros ----------
create table if not exists viveiros (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,            -- V01, V02...
  area_ha       numeric(8,2),
  linha         text default 'Viveiros',
  ativo         boolean not null default true,
  apresentame_centro_custo_id text,              -- id do centro de custo no Apresenta.me
  criado_em     timestamptz not null default now()
);

create table if not exists ciclos (
  id                uuid primary key default gen_random_uuid(),
  viveiro_id        uuid not null references viveiros(id),
  codigo            text not null unique,        -- V01-2026-04
  data_povoamento   date not null,
  pl_quantidade     integer not null check (pl_quantidade > 0),
  fornecedor_pl     text,
  preco_milheiro_pl numeric(10,2),
  status            text not null default 'em_cultivo'
                    check (status in ('em_cultivo','despescado','cancelado')),
  data_despesca     date,
  biomassa_despescada_kg numeric(12,2),
  populacao_despescada   integer,
  observacao        text,
  criado_em         timestamptz not null default now()
);
-- só um ciclo em cultivo por viveiro
create unique index if not exists ux_ciclo_ativo_viveiro
  on ciclos(viveiro_id) where status = 'em_cultivo';

-- Produtos: rações e insumos (fertilizantes, calcário, probióticos...)
create table if not exists produtos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  categoria  text not null check (categoria in ('racao','fertilizante','calcario','probiotico','outro')),
  unidade    text not null default 'kg' check (unidade in ('kg','g','L','mL','sc','un')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Perfil de cada usuário do app (gestor define o plano de ração; campo lança)
create table if not exists perfis (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  nome     text not null,
  perfil   text not null default 'campo' check (perfil in ('gestor','campo'))
);
create or replace function eh_gestor() returns boolean language sql stable security definer as $$
  select exists (select 1 from perfis where user_id = auth.uid() and perfil = 'gestor')
$$;

create table if not exists configuracoes (
  chave text primary key,
  valor jsonb not null
);
insert into configuracoes(chave, valor) values
  ('tratos_por_dia', '4'),
  ('parametros_agua', '["od","ph","temperatura","salinidade","transparencia"]')
on conflict (chave) do nothing;

-- ---------- Lançamentos de campo ----------
create table if not exists racao (
  id          uuid primary key,
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  hora        time not null,
  trato       smallint not null check (trato between 1 and 12),
  produto_id  uuid references produtos(id),                     -- qual ração
  kg          numeric(8,2) not null check (kg > 0 and kg <= 500),
  tipo_racao  text,
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_racao_ciclo on racao(ciclo_id, data);

-- Bandejas de checagem: o arraçoamento é a lanço; uma vez por dia coloca-se
-- ração de teste nas bandejas (colocação) e cerca de 1 h depois pesa-se a
-- sobra de todas elas (retirada). Podem ser pessoas/aparelhos diferentes.
create table if not exists bandeja_colocacoes (
  id          uuid primary key,
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  hora        time not null,
  kg_bandejas numeric(8,2) not null check (kg_bandejas > 0),
  produto_id  uuid references produtos(id),
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_bcol_ciclo on bandeja_colocacoes(ciclo_id, data);

create table if not exists bandeja_retiradas (
  id            uuid primary key,
  colocacao_id  uuid not null unique references bandeja_colocacoes(id),
  ciclo_id      uuid not null references ciclos(id),
  data          date not null,
  hora          time not null,
  sobra_kg      numeric(8,2) not null check (sobra_kg >= 0),   -- soma pesada de todas as bandejas
  resultado     text not null check (resultado in ('zerou','pouca_sobra','muita_sobra')), -- 0 / até 20% / acima de 20% do colocado
  lancado_por   text,
  criado_em     timestamptz not null default now()
);

create table if not exists biometrias (
  id            uuid primary key,
  ciclo_id      uuid not null references ciclos(id),
  data          date not null,
  hora          time not null,
  tipo          text not null default 'simples' check (tipo in ('simples','classes')),
  classes       jsonb,                  -- [{"g":5,"qtd":12},...] quando tipo = 'classes' (só distribuição; não é o peso do viveiro)
  n_amostra     integer not null check (n_amostra > 0),
  peso_total_g  numeric(10,2) not null check (peso_total_g > 0),
  peso_medio_g  numeric(8,3) generated always as (peso_total_g / n_amostra) stored,
  lancado_por   text,
  criado_em     timestamptz not null default now()
);
create index if not exists ix_bio_ciclo on biometrias(ciclo_id, data);

create table if not exists agua (
  id              uuid primary key,
  ciclo_id        uuid not null references ciclos(id),
  data            date not null,
  hora            time not null,
  od              numeric(5,2) check (od between 0 and 25),
  ph              numeric(4,2) check (ph between 0 and 14),
  temperatura     numeric(4,1) check (temperatura between 10 and 45),
  salinidade      numeric(5,1) check (salinidade between 0 and 60),
  transparencia   numeric(5,1) check (transparencia between 0 and 300),
  lancado_por     text,
  criado_em       timestamptz not null default now()
);

create table if not exists ocorrencias (
  id          uuid primary key,
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  hora        time not null,
  tipo        text not null check (tipo in ('mortalidade','doenca','manutencao','outro')),
  quantidade  integer,                 -- camarões mortos estimados (mortalidade)
  descricao   text,
  foto_url    text,
  lancado_por text,
  criado_em   timestamptz not null default now()
);

-- Plano de ração definido pelo gestor: vale a partir de data_inicio até o próximo plano
create table if not exists planos_racao (
  id           uuid primary key,
  ciclo_id     uuid not null references ciclos(id),
  data_inicio  date not null,
  produto_id   uuid references produtos(id),
  kg_dia       numeric(8,2) not null check (kg_dia > 0),
  tratos       jsonb not null,            -- [{"trato":1,"kg":20},{"trato":2,"kg":25},...]
  observacao   text,
  lancado_por  text,
  criado_em    timestamptz not null default now()
);
create index if not exists ix_plano_ciclo on planos_racao(ciclo_id, data_inicio desc, criado_em desc);

-- Aplicação de fertilizantes, calcário, probióticos etc.
create table if not exists aplicacoes_insumos (
  id          uuid primary key,
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  hora        time not null,
  produto_id  uuid not null references produtos(id),
  quantidade  numeric(10,2) not null check (quantidade > 0),
  observacao  text,
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_insumo_ciclo on aplicacoes_insumos(ciclo_id, data);

-- ---------- Resumo por ciclo (painel) ----------
create or replace view vw_ciclo_resumo as
select
  c.id as ciclo_id, c.codigo, v.codigo as viveiro, v.area_ha,
  c.data_povoamento, c.pl_quantidade, c.status,
  (coalesce(c.data_despesca, current_date) - c.data_povoamento) as dias_cultivo,
  round(c.pl_quantidade / nullif(v.area_ha * 10000, 0), 1)       as densidade_m2,
  coalesce(r.kg_total, 0)                                         as racao_lanco_kg,
  coalesce(ck.bandejas, 0)                                        as racao_bandejas_kg,
  coalesce(ck.sobra, 0)                                           as sobra_kg,
  coalesce(r.kg_total, 0) + coalesce(ck.bandejas, 0)              as racao_colocada_kg,   -- lanço + bandejas
  coalesce(r.kg_total, 0) + coalesce(ck.bandejas, 0) - coalesce(ck.sobra, 0) as racao_consumida_kg,
  b.peso_medio_g                                                  as ultimo_peso_g,
  b.data                                                          as ultima_biometria,
  coalesce(o.mortos, 0)                                           as mortalidade_lancada
from ciclos c
join viveiros v on v.id = c.viveiro_id
left join (select ciclo_id, sum(kg) kg_total from racao group by ciclo_id) r on r.ciclo_id = c.id
left join (select bc.ciclo_id, sum(bc.kg_bandejas) bandejas, sum(coalesce(br.sobra_kg, 0)) sobra
           from bandeja_colocacoes bc left join bandeja_retiradas br on br.colocacao_id = bc.id
           group by bc.ciclo_id) ck on ck.ciclo_id = c.id
left join lateral (select peso_medio_g, data from biometrias
                   where ciclo_id = c.id and tipo = 'simples'   -- por tamanho é só distribuição
                   order by data desc, hora desc limit 1) b on true
left join (select ciclo_id, sum(quantidade) mortos from ocorrencias
           where tipo = 'mortalidade' group by ciclo_id) o on o.ciclo_id = c.id;

-- ---------- Segurança: só usuários logados ----------
alter table viveiros     enable row level security;
alter table ciclos       enable row level security;
alter table configuracoes enable row level security;
alter table produtos     enable row level security;
alter table perfis       enable row level security;
alter table planos_racao enable row level security;
alter table aplicacoes_insumos enable row level security;
alter table racao        enable row level security;
alter table bandeja_colocacoes enable row level security;
alter table bandeja_retiradas enable row level security;
alter table biometrias   enable row level security;
alter table agua         enable row level security;
alter table ocorrencias  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['viveiros','ciclos','configuracoes','produtos','aplicacoes_insumos','racao','bandeja_colocacoes','bandeja_retiradas','biometrias','agua','ocorrencias'] loop
    execute format('drop policy if exists "%1$s_auth" on %1$I', t);
    execute format('create policy "%1$s_auth" on %1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Perfis: cada um lê o próprio; plano de ração: todos leem, só gestor grava
drop policy if exists "perfis_ler" on perfis;
create policy "perfis_ler" on perfis for select to authenticated using (user_id = auth.uid() or eh_gestor());
drop policy if exists "planos_ler" on planos_racao;
create policy "planos_ler" on planos_racao for select to authenticated using (true);
drop policy if exists "planos_gestor" on planos_racao;
create policy "planos_gestor" on planos_racao for insert to authenticated with check (eh_gestor());
drop policy if exists "planos_gestor_upd" on planos_racao;
create policy "planos_gestor_upd" on planos_racao for update to authenticated using (eh_gestor()) with check (eh_gestor());

-- Exemplos de produtos (ajuste nomes/unidades aos que vocês usam)
insert into produtos (nome, categoria, unidade) values
  ('Ração engorda 35% PB 2,0 mm', 'racao', 'kg'),
  ('Ração engorda 32% PB 2,4 mm', 'racao', 'kg'),
  ('Ração crescimento 40% PB 1,2 mm', 'racao', 'kg'),
  ('Ureia', 'fertilizante', 'kg'),
  ('Superfosfato triplo', 'fertilizante', 'kg'),
  ('Calcário dolomítico', 'calcario', 'kg'),
  ('Cal hidratada', 'calcario', 'kg'),
  ('Probiótico', 'probiotico', 'L'),
  ('Melaço', 'outro', 'L')
on conflict (nome) do nothing;
