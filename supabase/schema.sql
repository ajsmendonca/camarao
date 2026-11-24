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

-- Ciclo: iniciado pelo gestor (viveiro entra em PREPARAÇÃO) → povoamento (EM CULTIVO) → despesca total (ENCERRADO).
-- O custo comum é rateado por hectare × dia do ciclo inteiro (data_inicio até data_fim), incluindo a preparação.
-- Quantidade de PL, fornecedor etc. ficam em `povoamentos`; despesca em `despescas`.
create table if not exists ciclos (
  id                uuid primary key default gen_random_uuid(),
  viveiro_id        uuid not null references viveiros(id),
  codigo            text not null unique,        -- V01-2026-11-24 (data de início)
  data_inicio       date not null,               -- início da preparação
  data_povoamento   date,                        -- preenchida pelo 1º povoamento
  data_fim          date,                        -- preenchida pela despesca total
  status            text not null default 'preparacao'
                    check (status in ('preparacao','em_cultivo','encerrado','cancelado')),
  observacao        text,
  criado_em         timestamptz not null default now(),
  check (data_povoamento is null or data_povoamento >= data_inicio),
  check (data_fim is null or data_fim >= data_inicio)
);
-- só um ciclo aberto (em preparação ou em cultivo) por viveiro
create unique index if not exists ux_ciclo_ativo_viveiro
  on ciclos(viveiro_id) where status in ('preparacao','em_cultivo');

-- Produtos: rações e insumos (fertilizantes, calcário, probióticos...)
create table if not exists produtos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  categoria  text not null check (categoria in ('racao','pos_larva','fertilizante','calcario','probiotico','outro')), -- pos_larva: unidade 'un' (PL)
  unidade    text not null default 'kg' check (unidade in ('kg','g','L','mL','sc','un')),
  estoque_minimo numeric(12,2),           -- avisa quando o saldo ficar abaixo
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
alter table produtos add column if not exists estoque_minimo numeric(12,2);

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

-- Povoamento: pós-larvas colocadas no viveiro. Um ciclo pode ter complemento (2º povoamento).
-- O custo da PL vem do Apresenta.me (centro de custo próprio), não daqui.
create table if not exists povoamentos (
  id            uuid primary key,
  ciclo_id      uuid not null references ciclos(id),
  data          date not null,
  hora          time not null,
  pl_quantidade integer not null check (pl_quantidade > 0),
  produto_id    uuid references produtos(id),   -- lote de PL do estoque (sai do estoque)
  fornecedor    text,
  estagio       text,                    -- PL10, PL12...
  observacao    text,
  lancado_por   text,
  criado_em     timestamptz not null default now()
);
create index if not exists ix_pov_ciclo on povoamentos(ciclo_id);
-- 1º povoamento: ciclo passa de preparação para em cultivo
create or replace function povoa_ciclo() returns trigger language plpgsql security definer as $$
begin
  update ciclos set status = 'em_cultivo',
         data_povoamento = least(coalesce(data_povoamento, new.data), new.data)
   where id = new.ciclo_id and status in ('preparacao','em_cultivo');
  return new;
end $$;
drop trigger if exists tg_povoa_ciclo on povoamentos;
create trigger tg_povoa_ciclo after insert or update on povoamentos for each row execute function povoa_ciclo();

-- Clientes (compradores) da Barra Maricultura. Preenchida pela integração com as pessoas que têm lançamentos
-- da Barra Maricultura no Apresenta.me (apresentame_person_id) e, para comprador novo, pré-cadastro pelo gestor.
create table if not exists clientes (
  id                    uuid primary key,
  nome                  text not null,
  telefone              text,
  documento             text,                       -- CPF/CNPJ
  cidade                text,
  apresentame_person_id bigint unique,              -- liga ao cadastro do Apresenta.me
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now()
);

-- Previsão de despesca (pedido de venda): quanto, com que peso, a que preço e para quem.
create table if not exists previsoes_despesca (
  id                  uuid primary key,
  ciclo_id            uuid not null references ciclos(id),
  cliente_id          uuid references clientes(id),
  data_prevista       date not null,
  biomassa_prev_kg    numeric(12,2) not null check (biomassa_prev_kg > 0),
  peso_medio_prev_g   numeric(8,3) not null check (peso_medio_prev_g > 0 and peso_medio_prev_g < 100),
  preco_kg_prev       numeric(10,2) check (preco_kg_prev >= 0),
  valor_prev          numeric(14,2) generated always as (round(biomassa_prev_kg * preco_kg_prev, 2)) stored,
  status              text not null default 'aberta' check (status in ('aberta','realizada','cancelada')),
  despesca_id         uuid,                         -- preenchido quando a despesca é lançada a partir da previsão
  observacao          text,
  lancado_por         text,
  criado_em           timestamptz not null default now()
);
create index if not exists ix_prev_ciclo on previsoes_despesca(ciclo_id, data_prevista);

-- Despesca: parcial (ciclo continua), total (encerra o ciclo) ou perda_total (encerra sem despesca:
-- doença, mortalidade; biomassa 0 e motivo obrigatório).
create table if not exists despescas (
  id            uuid primary key,
  ciclo_id      uuid not null references ciclos(id),
  data          date not null,
  hora          time not null,
  tipo          text not null check (tipo in ('parcial','total','perda_total')),
  biomassa_kg   numeric(12,2) not null default 0,
  peso_medio_g  numeric(8,3),
  previsao_id   uuid references previsoes_despesca(id),  -- previsão/pedido que esta despesca realizou
  populacao     integer generated always as (case when peso_medio_g > 0 then round(biomassa_kg * 1000 / peso_medio_g) else 0 end) stored,
  observacao    text,
  lancado_por   text,
  criado_em     timestamptz not null default now(),
  check ((tipo in ('parcial','total') and biomassa_kg > 0 and peso_medio_g > 0 and peso_medio_g < 100)
      or (tipo = 'perda_total' and biomassa_kg = 0 and length(trim(coalesce(observacao, ''))) > 2))
);
create index if not exists ix_desp_ciclo on despescas(ciclo_id);
create or replace function fecha_ciclo_na_despesca() returns trigger language plpgsql security definer as $$
begin
  if new.tipo in ('total','perda_total') then
    update ciclos set status = 'encerrado', data_fim = new.data where id = new.ciclo_id;
    -- previsões ainda abertas do ciclo encerrado ficam canceladas
    update previsoes_despesca set status = 'cancelada' where ciclo_id = new.ciclo_id and status = 'aberta'
       and id is distinct from new.previsao_id;
  end if;
  if new.previsao_id is not null then
    update previsoes_despesca set status = 'realizada', despesca_id = new.id where id = new.previsao_id;
  end if;
  return new;
end $$;
drop trigger if exists tg_fecha_ciclo on despescas;
create trigger tg_fecha_ciclo after insert or update on despescas for each row execute function fecha_ciclo_na_despesca();

-- Plano de ração definido pelo gestor: vale a partir de data_inicio até o próximo plano
create table if not exists planos_racao (
  id           uuid primary key,
  ciclo_id     uuid not null references ciclos(id),
  data_inicio  date not null,
  produto_id   uuid references produtos(id),
  kg_dia       numeric(8,2) not null check (kg_dia > 0),
  sobrevivencia_est numeric(5,2) check (sobrevivencia_est > 0 and sobrevivencia_est <= 100), -- % estimado pelo gestor
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

-- ---------- Estoque de rações e insumos ----------
-- Entradas (notas recebidas) e ajustes de contagem são lançados pelo gestor.
-- As saídas não são lançadas aqui: saem sozinhas de cada povoamento (PL), trato (racao.kg),
-- colocação de bandeja (kg_bandejas — a sobra é descartada) e aplicação de insumo.
create table if not exists estoque_movimentos (
  id          uuid primary key,
  produto_id  uuid not null references produtos(id),
  data        date not null,
  tipo        text not null check (tipo in ('entrada','ajuste')),
  quantidade  numeric(12,2) not null check (quantidade <> 0 and (tipo = 'ajuste' or quantidade > 0)), -- ajuste pode ser negativo
  documento   text,                      -- NF / fornecedor
  observacao  text,
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_estoque_prod on estoque_movimentos(produto_id, data);

create or replace view vw_estoque_saldo with (security_invoker = true) as
select p.id, p.nome, p.categoria, p.unidade, p.estoque_minimo, p.ativo,
  coalesce(e.entradas, 0)                                   as entradas,
  coalesce(e.ajustes, 0)                                    as ajustes,
  coalesce(s.saidas, 0)                                     as saidas,
  coalesce(e.entradas, 0) + coalesce(e.ajustes, 0) - coalesce(s.saidas, 0) as saldo
from produtos p
left join (select produto_id,
                  sum(quantidade) filter (where tipo = 'entrada') entradas,
                  sum(quantidade) filter (where tipo = 'ajuste')  ajustes
           from estoque_movimentos group by produto_id) e on e.produto_id = p.id
left join (select produto_id, sum(q) saidas from (
             select produto_id, kg q from racao
             union all select produto_id, kg_bandejas from bandeja_colocacoes
             union all select produto_id, quantidade from aplicacoes_insumos
             union all select produto_id, pl_quantidade from povoamentos
           ) x where produto_id is not null group by produto_id) s on s.produto_id = p.id;

-- Consumo anterior ao sistema (migração do Meu Pescado): ração e insumos já usados no ciclo antes de começar a lançar
-- aqui. Entra na ração consumida/FCA do ciclo, mas NÃO mexe no estoque (o saldo inicial já veio descontado).
create table if not exists consumo_anterior (
  id          uuid primary key default gen_random_uuid(),
  ciclo_id    uuid not null references ciclos(id),
  produto_id  uuid not null references produtos(id),
  quantidade  numeric(12,2) not null check (quantidade > 0),
  data_ref    date,                        -- data informada no relatório de origem
  origem      text not null default 'Meu Pescado',
  criado_em   timestamptz not null default now()
);
create index if not exists ix_consumo_ant_ciclo on consumo_anterior(ciclo_id);

-- Sobrevivência estimada fora do plano de ração (ex.: carga do Meu Pescado). Vale a informação mais recente entre
-- esta tabela e o plano de ração (`planos_racao.sobrevivencia_est`).
create table if not exists estimativas_sobrevivencia (
  id          uuid primary key default gen_random_uuid(),
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  pct         numeric(5,2) not null check (pct > 0 and pct <= 100),
  origem      text,
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_est_sobrev on estimativas_sobrevivencia(ciclo_id, data desc);

-- ---------- Resumo por ciclo (painel) ----------
-- Sobrevivência: estimada = a do plano de ração vigente (gestor); real = população despescada / PL povoadas.
-- Previsto = PL × sobrevivência estimada − já despescado (parcial); biomassa prevista = previsto × último peso.
drop view if exists vw_ciclo_resumo;
create view vw_ciclo_resumo with (security_invoker = true) as
select
  c.id as ciclo_id, c.codigo, v.codigo as viveiro, v.area_ha,
  c.data_inicio, c.data_povoamento, c.data_fim, c.status,
  (coalesce(c.data_fim, current_date) - c.data_inicio)           as dias_ciclo,        -- base do rateio (ha × dia)
  (coalesce(c.data_povoamento, coalesce(c.data_fim, current_date)) - c.data_inicio) as dias_preparacao,
  (coalesce(c.data_fim, current_date) - c.data_povoamento)       as dias_cultivo,
  round(v.area_ha * (coalesce(c.data_fim, current_date) - c.data_inicio), 2) as hectare_dia,
  coalesce(pv.pl, 0)                                              as pl_quantidade,
  round(pv.pl / nullif(v.area_ha * 10000, 0), 1)                 as densidade_m2,
  coalesce(r.kg_total, 0)                                         as racao_lanco_kg,
  coalesce(ck.bandejas, 0)                                        as racao_bandejas_kg,
  coalesce(ck.sobra, 0)                                           as sobra_kg,
  coalesce(ca.racao, 0)                                           as racao_anterior_kg,   -- antes do sistema (Meu Pescado)
  coalesce(r.kg_total, 0) + coalesce(ck.bandejas, 0) + coalesce(ca.racao, 0) as racao_colocada_kg,   -- lanço + bandejas + anterior
  coalesce(r.kg_total, 0) + coalesce(ck.bandejas, 0) - coalesce(ck.sobra, 0) + coalesce(ca.racao, 0) as racao_consumida_kg,
  b.peso_medio_g                                                  as ultimo_peso_g,
  b.data                                                          as ultima_biometria,
  coalesce(o.mortos, 0)                                           as mortalidade_lancada,
  pr.sobrevivencia_est                                            as sobrevivencia_est_pct,
  round(pv.pl * pr.sobrevivencia_est / 100) - coalesce(d.pop, 0)  as populacao_prevista,
  round((pv.pl * pr.sobrevivencia_est / 100 - coalesce(d.pop, 0)) * b.peso_medio_g / 1000, 1) as biomassa_prevista_kg,
  coalesce(d.biomassa, 0)                                         as biomassa_despescada_kg,
  coalesce(d.pop, 0)                                              as populacao_despescada,
  case when c.status = 'encerrado' then round(d.pop * 100.0 / nullif(pv.pl, 0), 1) end as sobrevivencia_real_pct,
  case when c.status = 'encerrado' then round((coalesce(r.kg_total, 0) + coalesce(ck.bandejas, 0) - coalesce(ck.sobra, 0) + coalesce(ca.racao, 0))
                                               / nullif(d.biomassa, 0), 2) end as fca
from ciclos c
join viveiros v on v.id = c.viveiro_id
left join (select ciclo_id, sum(pl_quantidade) pl from povoamentos group by ciclo_id) pv on pv.ciclo_id = c.id
left join (select ciclo_id, sum(kg) kg_total from racao group by ciclo_id) r on r.ciclo_id = c.id
left join (select a.ciclo_id, sum(a.quantidade) racao from consumo_anterior a join produtos p on p.id = a.produto_id
           where p.categoria = 'racao' group by a.ciclo_id) ca on ca.ciclo_id = c.id
left join (select bc.ciclo_id, sum(bc.kg_bandejas) bandejas, sum(coalesce(br.sobra_kg, 0)) sobra
           from bandeja_colocacoes bc left join bandeja_retiradas br on br.colocacao_id = bc.id
           group by bc.ciclo_id) ck on ck.ciclo_id = c.id
left join lateral (select peso_medio_g, data from biometrias
                   where ciclo_id = c.id and tipo = 'simples'   -- por tamanho é só distribuição
                   order by data desc, hora desc limit 1) b on true
left join lateral (select pct as sobrevivencia_est from (
                     select sobrevivencia_est as pct, data_inicio as d, criado_em from planos_racao
                      where ciclo_id = c.id and data_inicio <= current_date and sobrevivencia_est is not null
                     union all
                     select pct, data, criado_em from estimativas_sobrevivencia where ciclo_id = c.id and data <= current_date
                   ) x order by d desc, criado_em desc limit 1) pr on true
left join (select ciclo_id, sum(biomassa_kg) biomassa, sum(populacao) pop from despescas group by ciclo_id) d on d.ciclo_id = c.id
left join (select ciclo_id, sum(quantidade) mortos from ocorrencias
           where tipo = 'mortalidade' group by ciclo_id) o on o.ciclo_id = c.id;

-- Ração por viveiro e dia (painel): lanço, bandejas e sobra pesada (sobra na data da colocação)
create or replace view vw_racao_diaria with (security_invoker = true) as
select ciclo_id, data, sum(lanco) as lanco_kg, sum(bandejas) as bandejas_kg, sum(sobra) as sobra_kg,
       sum(lanco) + sum(bandejas) as colocado_kg, sum(lanco) + sum(bandejas) - sum(sobra) as consumido_kg
from (
  select ciclo_id, data, kg as lanco, 0::numeric as bandejas, 0::numeric as sobra from racao
  union all select ciclo_id, data, 0, kg_bandejas, 0 from bandeja_colocacoes
  union all select bc.ciclo_id, bc.data, 0, 0, br.sobra_kg from bandeja_retiradas br join bandeja_colocacoes bc on bc.id = br.colocacao_id
) x group by ciclo_id, data;

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
alter table estoque_movimentos enable row level security;
alter table povoamentos  enable row level security;
alter table consumo_anterior enable row level security;
alter table estimativas_sobrevivencia enable row level security;
alter table despescas    enable row level security;
alter table clientes     enable row level security;
alter table previsoes_despesca enable row level security;

do $$
declare t text;
begin
  foreach t in array array['viveiros','configuracoes','aplicacoes_insumos','racao','bandeja_colocacoes','bandeja_retiradas','biometrias','agua','ocorrencias'] loop
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

-- Produtos e estoque: todos leem; só o gestor cadastra produto e lança entrada/ajuste
drop policy if exists "produtos_auth" on produtos;
drop policy if exists "produtos_ler" on produtos;
create policy "produtos_ler" on produtos for select to authenticated using (true);
drop policy if exists "produtos_gestor" on produtos;
create policy "produtos_gestor" on produtos for insert to authenticated with check (eh_gestor());
drop policy if exists "produtos_gestor_upd" on produtos;
create policy "produtos_gestor_upd" on produtos for update to authenticated using (eh_gestor()) with check (eh_gestor());
drop policy if exists "estoque_ler" on estoque_movimentos;
create policy "estoque_ler" on estoque_movimentos for select to authenticated using (true);
drop policy if exists "estoque_gestor" on estoque_movimentos;
create policy "estoque_gestor" on estoque_movimentos for insert to authenticated with check (eh_gestor());
drop policy if exists "estoque_gestor_upd" on estoque_movimentos;
create policy "estoque_gestor_upd" on estoque_movimentos for update to authenticated using (eh_gestor()) with check (eh_gestor());

-- Ciclos, povoamentos e despescas: todos leem; só o gestor grava
do $$
declare t text;
begin
  foreach t in array array['ciclos','povoamentos','despescas','consumo_anterior','estimativas_sobrevivencia'] loop
    execute format('drop policy if exists "%1$s_auth" on %1$I', t);
    execute format('drop policy if exists "%1$s_ler" on %1$I', t);
    execute format('create policy "%1$s_ler" on %1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "%1$s_gestor" on %1$I', t);
    execute format('create policy "%1$s_gestor" on %1$I for insert to authenticated with check (eh_gestor())', t);
    execute format('drop policy if exists "%1$s_gestor_upd" on %1$I', t);
    execute format('create policy "%1$s_gestor_upd" on %1$I for update to authenticated using (eh_gestor()) with check (eh_gestor())', t);
  end loop;
end $$;

-- Clientes e previsões de despesca (têm preço): só o gestor lê e grava
do $$
declare t text;
begin
  foreach t in array array['clientes','previsoes_despesca'] loop
    execute format('drop policy if exists "%1$s_gestor_all" on %1$I', t);
    execute format('create policy "%1$s_gestor_all" on %1$I for all to authenticated using (eh_gestor()) with check (eh_gestor())', t);
  end loop;
end $$;

-- Os produtos (rações e insumos) são cadastrados pelo gestor no app, em Estoque › Produto.
