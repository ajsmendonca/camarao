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
  perfil   text not null default 'campo' check (perfil in ('admin','gestor','campo'))
);
-- admin: tudo do gestor + equipe + editar/apagar lançamentos
alter table perfis drop constraint if exists perfis_perfil_check;
alter table perfis add constraint perfis_perfil_check check (perfil in ('admin','gestor','campo'));
create or replace function eh_gestor() returns boolean language sql stable security definer as $$
  select exists (select 1 from perfis where user_id = auth.uid() and perfil in ('gestor','admin'))
$$;
create or replace function eh_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from perfis where user_id = auth.uid() and perfil = 'admin')
$$;

create table if not exists configuracoes (
  chave text primary key,
  valor jsonb not null
);
insert into configuracoes(chave, valor) values
  ('tratos_por_dia', '4'),
  ('parametros_agua', '["od","ph","temperatura","salinidade","transparencia"]'),
  -- preço de venda estimado: base no peso de referência, + passo (R$) por grama acima, − por grama abaixo
  ('preco_venda', '{"base": 20, "peso_ref": 10, "passo": 1}'),
  -- impostos estimados sobre a venda (% do valor de venda estimado)
  ('imposto_venda', '{"pct": 0}')
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
-- tratos importados do histórico (Meu Pescado): contam no viveiro, mas não saem do estoque (o saldo inicial já os descontou)
alter table racao add column if not exists fora_estoque boolean not null default false;

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
-- Povoamento: a data de povoamento do ciclo é o 1º povoamento; com povoamento o ciclo fica em cultivo, sem nenhum volta
-- para preparação (vale ao lançar, corrigir ou apagar)
create or replace function povoa_ciclo() returns trigger language plpgsql security definer as $$
declare cid uuid := coalesce(new.ciclo_id, old.ciclo_id); primeira date;
begin
  select min(data) into primeira from povoamentos where ciclo_id = cid;
  update ciclos set data_povoamento = primeira,
         status = case when status in ('preparacao','em_cultivo') then (case when primeira is null then 'preparacao' else 'em_cultivo' end) else status end
   where id = cid;
  return null;
end $$;
drop trigger if exists tg_povoa_ciclo on povoamentos;
create trigger tg_povoa_ciclo after insert or update or delete on povoamentos for each row execute function povoa_ciclo();

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

-- Fornecedores da Barra Maricultura (ração, insumos, pós-larva, serviços). Vêm do Apresenta.me (pessoas das despesas da
-- Barra Maricultura, ligadas por apresentame_person_id) e podem ser cadastrados/corrigidos pelo gestor.
create table if not exists fornecedores (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  documento             text,
  telefone              text,
  cidade                text,
  observacao            text,
  apresentame_person_id bigint unique,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now()
);
alter table clientes add column if not exists observacao text;

-- Lançamentos financeiros copiados do Apresenta.me (só leitura; gravados pela Edge Function "apresentame").
create table if not exists financeiro_lancamentos (
  apresentame_id   bigint primary key,
  data             date,               -- vencimento/data do lançamento
  competencia      date,
  tipo             text not null,      -- debit (despesa) | credit (receita)
  valor            numeric(14,2) not null,
  descricao        text,
  plano_id         bigint,
  plano_nome       text,
  centro_custo_id  bigint,
  pessoa_id        bigint,
  pessoa_nome      text,
  pago             boolean,
  observacoes      text,
  atualizado_em    timestamptz not null default now()
);
create index if not exists ix_fin_data on financeiro_lancamentos(data);
create index if not exists ix_fin_plano on financeiro_lancamentos(plano_id);
create table if not exists integracao_execucoes (
  id          bigserial primary key,
  sistema     text not null default 'apresentame',
  inicio      timestamptz not null default now(),
  fim         timestamptz,
  ok          boolean,
  resumo      jsonb,
  erro        text,
  executado_por text
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
-- apagar a despesca que encerrou o ciclo reabre o ciclo (em cultivo)
create or replace function reabre_ciclo() returns trigger language plpgsql security definer as $$
begin
  if old.tipo in ('total','perda_total') and not exists (select 1 from despescas where ciclo_id = old.ciclo_id and tipo in ('total','perda_total')) then
    update ciclos set status = 'em_cultivo', data_fim = null where id = old.ciclo_id and status = 'encerrado';
  end if;
  return old;
end $$;
drop trigger if exists tg_reabre_ciclo on despescas;
create trigger tg_reabre_ciclo after delete on despescas for each row execute function reabre_ciclo();
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
             select produto_id, kg q from racao where not fora_estoque
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

-- Histórico de vendas do Meu Pescado (antes do Apresenta.me): uma linha por despesca, com cliente, NF,
-- faturamento, custo e resultado como estavam no Meu Pescado. Só o gestor lê. Daqui para frente a receita
-- vem do Apresenta.me (plano Venda de camarão).
create table if not exists vendas_historico (
  id           uuid primary key default gen_random_uuid(),
  despesca_id  uuid not null unique references despescas(id),
  cliente_id   uuid references clientes(id),
  nota_fiscal  text,
  faturamento  numeric(14,2),
  custo        numeric(14,2),
  resultado    numeric(14,2),
  origem       text not null default 'Meu Pescado',
  observacao   text,
  criado_em    timestamptz not null default now()
);

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

-- Financeiro histórico por ciclo (painel). security_invoker: só o gestor enxerga (RLS de vendas_historico).
create or replace view vw_ciclo_financeiro_historico with (security_invoker = true) as
select d.ciclo_id, sum(h.faturamento) as faturamento, sum(h.custo) as custo, sum(h.resultado) as resultado,
       string_agg(distinct cl.nome, ', ') as clientes, string_agg(distinct h.nota_fiscal, ', ') as notas, min(h.origem) as origem
from vendas_historico h join despescas d on d.id = h.despesca_id left join clientes cl on cl.id = h.cliente_id
group by d.ciclo_id;

-- ============================================================
-- Custos por ciclo (Apresenta.me + consumo)
-- 1) materiais: consumo do ciclo × preço médio do produto (Meu Pescado no saldo inicial + notas ligadas a entradas)
-- 2) despesas comuns do Apresenta.me rateadas por hectare entre os ciclos abertos na data da nota (sem Investimento 1829)
-- 3) notas de Ração/Larva/Insumos ainda não classificadas contam no rateio como "provisórias"
-- ============================================================
alter table produtos add column if not exists custo_inicial numeric(12,4);          -- preço médio do Meu Pescado (R$/unidade)
alter table estoque_movimentos add column if not exists apresentame_id bigint;     -- nota do Apresenta.me desta entrada
alter table estoque_movimentos add column if not exists valor numeric(14,2);       -- R$ desta entrada (parte da nota)
insert into configuracoes(chave, valor) values ('preco_pl_milheiro', '14') on conflict (chave) do nothing;
-- plano de ração padrão dos primeiros dias de cultivo (kg/dia por 100 mil PL, por faixa de dias desde o povoamento);
-- valores iniciais = mediana do arraçoamento de abr–nov/2026 (Meu Pescado). O gestor altera em Configurações.
insert into configuracoes(chave, valor) values ('plano_padrao',
  '{"dias":30,"tratos":4,"produto_id":null,"faixas":[{"dia":1,"kg":1},{"dia":8,"kg":2},{"dia":14,"kg":3},{"dia":20,"kg":4},{"dia":26,"kg":5.33},{"dia":28,"kg":5.75},{"dia":30,"kg":7}]}')
  on conflict (chave) do nothing;
-- ração das bandejas de checagem: % do kg/dia do plano, tirado do trato em que a checagem é feita (tela "Pesar ração")
insert into configuracoes(chave, valor) values ('checagem', '{"pct":2,"trato":1}') on conflict (chave) do nothing;

-- destino que o gestor deu a cada nota (a nota em si vem do Apresenta.me e é regravada a cada sincronização)
create table if not exists financeiro_destino (
  apresentame_id bigint primary key,
  destino     text not null check (destino in ('estoque','ja_no_estoque','ciclo','rateio','ignorar')),
  ciclo_id    uuid references ciclos(id),
  observacao  text,
  definido_por text,
  criado_em   timestamptz not null default now(),
  check (destino <> 'ciclo' or ciclo_id is not null)
);

-- preço médio ponderado de cada produto
create or replace view vw_preco_medio with (security_invoker = true) as
select p.id as produto_id, p.nome, p.categoria, p.unidade, p.custo_inicial,
  coalesce(si.q, 0) as qtd_inicial, coalesce(e.q, 0) as qtd_notas, coalesce(e.v, 0) as valor_notas,
  case when coalesce(e.q, 0) + case when p.custo_inicial is not null then coalesce(si.q, 0) else 0 end > 0
       then (coalesce(si.q, 0) * coalesce(p.custo_inicial, 0) + coalesce(e.v, 0))
            / (coalesce(e.q, 0) + case when p.custo_inicial is not null then coalesce(si.q, 0) else 0 end)
       else p.custo_inicial end as preco_medio
from produtos p
left join (select produto_id, sum(quantidade) q from estoque_movimentos where tipo = 'ajuste' and documento = 'Saldo inicial' group by produto_id) si on si.produto_id = p.id
left join (select produto_id, sum(quantidade) q, sum(valor) v from estoque_movimentos where tipo = 'entrada' and valor is not null group by produto_id) e on e.produto_id = p.id;

-- consumo de cada ciclo por produto (tudo: lançado aqui, histórico importado e consumo anterior)
create or replace view vw_consumo_ciclo with (security_invoker = true) as
select ciclo_id, produto_id, sum(q) as quantidade from (
  select ciclo_id, produto_id, kg q from racao
  union all select ciclo_id, produto_id, kg_bandejas from bandeja_colocacoes
  union all select ciclo_id, produto_id, quantidade from aplicacoes_insumos
  union all select ciclo_id, produto_id, quantidade from consumo_anterior
  union all select ciclo_id, produto_id, pl_quantidade from povoamentos where produto_id is not null
) x where produto_id is not null group by ciclo_id, produto_id;

-- notas de despesa elegíveis ao rateio (comuns ou ainda não classificadas)
create or replace view vw_notas_rateio with (security_invoker = true) as
select f.apresentame_id, coalesce(f.competencia, f.data) as data_ref, f.valor, f.plano_id, f.plano_nome, f.pessoa_nome, f.descricao,
  (d.destino is null and f.plano_id in (15368, 16636, 16938)) as provisoria
from financeiro_lancamentos f
left join financeiro_destino d on d.apresentame_id = f.apresentame_id
where f.tipo = 'debit' and coalesce(f.centro_custo_id, 0) <> 1829
  and coalesce(d.destino, 'rateio') = 'rateio'
  and not exists (select 1 from estoque_movimentos m where m.apresentame_id = f.apresentame_id);

-- rateio por hectare entre os ciclos abertos na data (inclui perdas de estoque = ajustes negativos de contagem)
create or replace view vw_custo_rateio with (security_invoker = true) as
with itens as (
  select apresentame_id::text as item, data_ref, valor, provisoria from vw_notas_rateio
  union all
  select m.id::text, m.data, -m.quantidade * pm.preco_medio, false
  from estoque_movimentos m join vw_preco_medio pm on pm.produto_id = m.produto_id
  where m.tipo = 'ajuste' and m.quantidade < 0 and coalesce(m.documento, '') <> 'Saldo inicial' and pm.preco_medio is not null
), abertos as (
  select i.item, i.valor, i.provisoria, c.id as ciclo_id, v.area_ha, sum(v.area_ha) over (partition by i.item) as area_total
  from itens i
  join ciclos c on c.status <> 'cancelado' and c.data_inicio <= i.data_ref and (c.data_fim is null or c.data_fim >= i.data_ref)
  join viveiros v on v.id = c.viveiro_id
)
select ciclo_id, sum(valor * area_ha / area_total) as rateio,
       sum(case when provisoria then valor * area_ha / area_total else 0 end) as rateio_provisorio
from abertos group by ciclo_id;

-- custo total por ciclo
create or replace view vw_custo_ciclo with (security_invoker = true) as
select c.id as ciclo_id, c.codigo, v.codigo as viveiro, c.status,
  coalesce(m.racao, 0) as racao, coalesce(m.insumos, 0) as insumos,
  coalesce(m.pl, 0) + coalesce(pl.sem_produto, 0) * (select (valor #>> '{}')::numeric from configuracoes where chave = 'preco_pl_milheiro') / 1000 as pos_larva,
  coalesce(r.rateio, 0) as comum, coalesce(r.rateio_provisorio, 0) as comum_provisorio,
  coalesce(d.direto, 0) as direto,
  coalesce(m.sem_preco, 0) as qtd_sem_preco
from ciclos c join viveiros v on v.id = c.viveiro_id
left join (
  select cc.ciclo_id,
    sum(case when pm.categoria = 'racao' then cc.quantidade * pm.preco_medio end) as racao,
    sum(case when pm.categoria not in ('racao','pos_larva') then cc.quantidade * pm.preco_medio end) as insumos,
    sum(case when pm.categoria = 'pos_larva' then cc.quantidade * pm.preco_medio end) as pl,
    sum(case when pm.preco_medio is null then cc.quantidade end) as sem_preco
  from vw_consumo_ciclo cc join vw_preco_medio pm on pm.produto_id = cc.produto_id group by cc.ciclo_id
) m on m.ciclo_id = c.id
left join (select ciclo_id, sum(pl_quantidade) sem_produto from povoamentos where produto_id is null group by ciclo_id) pl on pl.ciclo_id = c.id
left join vw_custo_rateio r on r.ciclo_id = c.id
left join (select d.ciclo_id, sum(f.valor) direto from financeiro_destino d join financeiro_lancamentos f on f.apresentame_id = d.apresentame_id
           where d.destino = 'ciclo' group by d.ciclo_id) d on d.ciclo_id = c.id;

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
alter table vendas_historico enable row level security;
alter table despescas    enable row level security;
alter table clientes     enable row level security;
alter table previsoes_despesca enable row level security;

do $$
declare t text;
begin
  -- lançamentos do campo: todos leem e lançam; só o admin corrige ou apaga
  foreach t in array array['aplicacoes_insumos','racao','bandeja_colocacoes','bandeja_retiradas','biometrias','agua','ocorrencias'] loop
    execute format('drop policy if exists "%1$s_auth" on %1$I', t);
    execute format('drop policy if exists "%1$s_ler" on %1$I', t);
    execute format('create policy "%1$s_ler" on %1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "%1$s_lancar" on %1$I', t);
    execute format('create policy "%1$s_lancar" on %1$I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "%1$s_admin_upd" on %1$I', t);
    execute format('create policy "%1$s_admin_upd" on %1$I for update to authenticated using (eh_admin()) with check (eh_admin())', t);
    execute format('drop policy if exists "%1$s_admin_del" on %1$I', t);
    execute format('create policy "%1$s_admin_del" on %1$I for delete to authenticated using (eh_admin())', t);
  end loop;
  -- cadastro de viveiros e configurações: todos leem, só o admin altera
  foreach t in array array['viveiros','configuracoes'] loop
    execute format('drop policy if exists "%1$s_auth" on %1$I', t);
    execute format('drop policy if exists "%1$s_ler" on %1$I', t);
    execute format('create policy "%1$s_ler" on %1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "%1$s_admin_all" on %1$I', t);
    execute format('create policy "%1$s_admin_all" on %1$I for all to authenticated using (eh_admin()) with check (eh_admin())', t);
  end loop;
  -- tabela de preço de venda: o gestor também pode alterar
  drop policy if exists "configuracoes_preco_gestor" on configuracoes;
  create policy "configuracoes_preco_gestor" on configuracoes for update to authenticated
    using (eh_gestor() and chave in ('preco_venda','preco_pl_milheiro','imposto_venda','plano_padrao','checagem')) with check (eh_gestor() and chave in ('preco_venda','preco_pl_milheiro','imposto_venda','plano_padrao','checagem'));
  -- tabelas do gestor: só o admin apaga
  foreach t in array array['ciclos','povoamentos','despescas','consumo_anterior','estimativas_sobrevivencia','planos_racao','produtos','estoque_movimentos'] loop
    execute format('drop policy if exists "%1$s_admin_del" on %1$I', t);
    execute format('create policy "%1$s_admin_del" on %1$I for delete to authenticated using (eh_admin())', t);
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
  foreach t in array array['clientes','previsoes_despesca','vendas_historico','fornecedores'] loop
    execute format('drop policy if exists "%1$s_gestor_all" on %1$I', t);
    execute format('create policy "%1$s_gestor_all" on %1$I for all to authenticated using (eh_gestor()) with check (eh_gestor())', t);
  end loop;
end $$;

-- Financeiro do Apresenta.me e log da integração: só o gestor lê; só a Edge Function (service_role) grava
alter table fornecedores enable row level security;
alter table financeiro_lancamentos enable row level security;
alter table financeiro_destino enable row level security;
drop policy if exists "financeiro_destino_gestor" on financeiro_destino;
create policy "financeiro_destino_gestor" on financeiro_destino for all to authenticated using (eh_gestor()) with check (eh_gestor());
alter table integracao_execucoes enable row level security;
drop policy if exists "financeiro_ler" on financeiro_lancamentos;
create policy "financeiro_ler" on financeiro_lancamentos for select to authenticated using (eh_gestor());
drop policy if exists "integracao_ler" on integracao_execucoes;
create policy "integracao_ler" on integracao_execucoes for select to authenticated using (eh_gestor());

-- Os produtos (rações e insumos) são cadastrados pelo gestor no app, em Estoque › Produto.

-- =====================================================================
-- Pesagem da ração (25/11/2026): o funcionário pesa cada trato antes de jogar (tela "Pesar ração").
-- A pesagem é só conferência; o trato é lançado na tela Ração, que puxa o peso da pesagem mais recente do trato no dia.
create table if not exists pesagens (
  id          uuid primary key,
  ciclo_id    uuid not null references ciclos(id),
  data        date not null,
  hora        time not null,
  trato       smallint not null check (trato between 1 and 12),
  produto_id  uuid references produtos(id),
  kg_lanco    numeric(8,2) not null check (kg_lanco >= 0 and kg_lanco <= 500),
  kg_bandeja  numeric(8,2) not null default 0 check (kg_bandeja >= 0 and kg_bandeja <= 50),
  lancado_por text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_pesagens_ciclo on pesagens(ciclo_id, data, trato);
alter table pesagens enable row level security;
drop policy if exists "pesagens_ler" on pesagens;
create policy "pesagens_ler" on pesagens for select to authenticated using (true);
drop policy if exists "pesagens_lancar" on pesagens;
create policy "pesagens_lancar" on pesagens for insert to authenticated with check (true);
drop policy if exists "pesagens_admin_upd" on pesagens;
create policy "pesagens_admin_upd" on pesagens for update to authenticated using (eh_admin()) with check (eh_admin());
drop policy if exists "pesagens_admin_del" on pesagens;
create policy "pesagens_admin_del" on pesagens for delete to authenticated using (eh_admin());

-- Quem gravou (pelo login, gravado pelo banco — não depende do celular) em todos os lançamentos.
-- lancado_por = nome mostrado; criado_por = usuário do login; criado_em = quando chegou ao servidor; data/hora = do lançamento.
do $$
declare t text;
begin
  foreach t in array array['racao','bandeja_colocacoes','bandeja_retiradas','biometrias','agua','ocorrencias','aplicacoes_insumos',
    'pesagens','planos_racao','povoamentos','despescas','estoque_movimentos','previsoes_despesca','ciclos'] loop
    execute format('alter table %I add column if not exists criado_por uuid default auth.uid() references auth.users(id) on delete set null', t);
  end loop;
end $$;

-- Log de correções e exclusões (admin em Lançamentos, gestor em ciclos/planos etc.): quem, quando, antes e depois.
create table if not exists auditoria (
  id            bigserial primary key,
  quando        timestamptz not null default now(),
  usuario       uuid default auth.uid(),
  usuario_nome  text,
  tabela        text not null,
  registro_id   text,
  acao          text not null check (acao in ('alterou','apagou')),
  antes         jsonb,
  depois        jsonb
);
create index if not exists ix_auditoria_quando on auditoria(quando desc);
alter table auditoria enable row level security;
drop policy if exists "auditoria_gestor_ler" on auditoria;
create policy "auditoria_gestor_ler" on auditoria for select to authenticated using (eh_gestor());

create or replace function registra_auditoria() returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb; d jsonb;
begin
  a := to_jsonb(old);
  d := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  if tg_op = 'UPDATE' and a = d then return new; end if;
  insert into auditoria(usuario, usuario_nome, tabela, registro_id, acao, antes, depois)
  values (auth.uid(), (select nome from perfis where user_id = auth.uid()), tg_table_name, a->>'id',
          case when tg_op = 'UPDATE' then 'alterou' else 'apagou' end, a, d);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['racao','bandeja_colocacoes','bandeja_retiradas','biometrias','agua','ocorrencias','aplicacoes_insumos',
    'pesagens','planos_racao','povoamentos','despescas','estoque_movimentos','previsoes_despesca','ciclos','configuracoes'] loop
    execute format('drop trigger if exists auditoria_%1$s on %1$I', t);
    execute format('create trigger auditoria_%1$s after update or delete on %1$I for each row execute function registra_auditoria()', t);
  end loop;
end $$;
