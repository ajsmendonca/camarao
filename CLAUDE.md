# Sistema de controle da produção de camarão — contexto do projeto

Este arquivo resume tudo o que foi decidido nas conversas com o Antônio (dono) até 24/11/2026.
Leia antes de mexer no código. Idioma do projeto e da interface: **português do Brasil**.

## Quem e o quê
- Dono: Antônio (engenheiro civil, Aracaju/SE). Fazenda de camarão (carcinicultura) em **Itaporanga D'Ajuda/SE**,
  empresa **Barra Maricultura**, 8 viveiros escavados (V01–V08, ~3 ha cada; V08 3,8 ha).
- Hoje usam o app **Meu Pescado** (app.meupescado.com.br, feito em Bubble). Objetivo: substituí-lo por sistema próprio.
- **Financeiro fica no Apresenta.me** (ERP que ele já usa nas outras empresas). Este sistema controla **só a produção**.
- Stack preferida: **Supabase + Vercel + GitHub** (ele sobe arquivos no GitHub pelo navegador, sem git local).

## Arquitetura
1. **App de campo** (este repositório) — PWA React/Vite, funciona offline. Pronto (protótipo).
2. **Painel do escritório** — AINDA NÃO FEITO. Indicadores por viveiro/ciclo e plano de ração em tela grande.
3. **Integração Apresenta.me** — AINDA NÃO FEITA. Ler custos por viveiro via API (o Apresenta.me tem
   centros de custo com API: `financial.costCenters.*`). Proposta: um centro de custo por viveiro +
   "Fazenda – custo comum" (rateado pelo sistema de produção) + "Fazenda – investimento" (nunca entra no lote).
   Custo da ração no viveiro = kg consumidos × preço médio da ração (compra entra no Apresenta.me como estoque, sem viveiro).

## App de campo — como funciona
- Tudo é salvo primeiro no aparelho (IndexedDB via idb-keyval) e enviado ao Supabase quando há sinal
  (a cada 1 min ou botão "Enviar agora"). Ids gerados no celular (uuid) → upsert idempotente.
- Envio em ordem cronológica (colocação antes da retirada, por causa da FK).
- Lançamento não enviado pode ser excluído no celular; depois de enviado, correção é no escritório.
- Login e-mail/senha (Supabase Auth); precisa de sinal só no 1º acesso. Sem `.env` → **modo demonstração**
  (8 viveiros de exemplo com a situação real de 24/11/2026).
- Perfis: `gestor` e `campo` (tabela `perfis`). Só gestor vê/grava o **Plano de ração** (RLS no banco).

### Lançamentos (todos com data **e hora**)
- **Trato a lanço**: viveiro, nº do trato, ração usada (produto), kg. Vem preenchido com o previsto do plano;
  avisa se diferir >10% do previsto ou se a ração for diferente da prevista.
- **Bandejas (checagem)** — dois momentos, podem ser pessoas/celulares diferentes, ~1 h de intervalo, normalmente 1×/dia:
  1. *Colocação*: kg de ração colocados nas bandejas + ração + hora.
  2. *Retirada*: sobra **pesada** = soma de todas as bandejas + hora. Classificação automática:
     zerou (0) / pouca sobra (≤20% do colocado) / muita sobra (>20%). Avisa se retirada <40 min ou >3 h.
  - Retirada em outro celular: a colocação chega pelo servidor (cadastro recarrega a cada sync).
    Se não chegou, há opção "colocação + retirada juntas".
  - **A ração das bandejas SOMA no total colocado no viveiro.** Colocado = lanço + bandejas.
    Consumido = colocado − sobra. (Base do FCA.)
- **Biometria**: dois modos.
  - *Peso total* (nº de camarões + peso total) → **é a biometria do viveiro** (peso médio, crescimento, avisos).
  - *Por tamanho* (quantidade em cada grama: 5 g, 6 g…) → **só distribuição/uniformidade (CV)**; NÃO conta como peso do viveiro.
    CV no cartão: verde ≤20%, neutro 20–30%, laranja >30%.
- **Água**: OD, pH, temperatura, salinidade, transparência (configurável). Alertas: OD<3, pH fora 7–9,5, T>33 °C.
- **Ocorrência**: mortalidade (quantidade), doença, manutenção, outro.
- **Insumos**: fertilizantes, calcário/cal, probióticos, outros — produto, quantidade (unidade do cadastro).
- **Plano de ração (gestor)**: por viveiro — kg/dia (total do viveiro, **incluindo** a ração das bandejas — confirmado),
  ração, nº de tratos, divisão por trato (igual ou manual), "vale a partir de", recado ao arraçoador.
  Atalhos −10/−5/+5/+10%. Vale até o próximo plano. O arraçoador vê previsto / colocado / falta.

### Tela inicial
Cartão por viveiro: dias de cultivo, peso (biometria peso total), uniformidade (CV), ração hoje "colocado / previsto",
status das bandejas (a colocar / retirar ~hh:mm / resultado), tratos do dia, alerta ">90 dias".

## Banco (supabase/schema.sql)
viveiros, ciclos, produtos, perfis (+ função eh_gestor), configuracoes, racao, bandeja_colocacoes, bandeja_retiradas,
biometrias (tipo simples|classes, classes jsonb), agua, ocorrencias, planos_racao, aplicacoes_insumos,
view vw_ciclo_resumo (ração lanço/bandejas/colocada/consumida, último peso só de biometria simples).
Produtos de exemplo no seed são inventados — substituir pela lista real.

## Achados da análise do Meu Pescado (úteis para o painel e para a migração)
- Lançamentos errados distorciam custo dos lotes: **retroescavadeira R$ 279.990 + frete R$ 16.500** lançados como
  despesa variável direta "Diversos" rateada nos 8 viveiros (~R$ 37 mil/viveiro); **gado** (2× R$ 18.000) e ITR de
  outra fazenda também rateados. Despesca V07 de 02/03/2026 com custo ~R$ 522 mil (erro de lançamento) explica
  o resultado anual de −R$ 365.935; sem ela, 18 despescas somam +R$ 77.733.
- Sobrevivência padrão de 80% (não medida) em quase todos os lotes; uma despesca com sobrevivência 103% (impossível).
- Padrão: despescas < 100 dias positivas; ≥ 110 dias quase todas negativas (FCA 2,2–3,7, sobrevivência 13–40%).
- Receitas classificadas como "Financeiro"; R$ 66.264,50 a receber vencidos (Natanailson Barros, NF 35 e 36).
- Cadastro da cidade da fazenda com acento errado ("D´Ajuda") quebrava o clima no painel do Meu Pescado.
→ No sistema novo: investimento nunca entra no custo do lote; validações impedem sobrevivência >100%, etc.

## Pendências / perguntas em aberto
- Respondido em 24/11/2026: kg/dia do plano inclui bandejas (sim); muita sobra = >20% do colocado; CV 20%/30% ok;
  4 tratos e 5 parâmetros de água ficam como estão (o plano de ração ajusta as quantidades).
- **Rações e insumos devem vir do cadastro de estoque**, mostrando o que há em estoque. A API do Apresenta.me
  (consultada em 24/11/2026) não tem módulo de estoque/produtos — definir de onde vem o estoque.

## Próximos passos sugeridos
1. Painel do escritório: FCA real (consumido/biomassa), sobrevivência estimada e real na despesca, curva de crescimento,
   distribuição por tamanho e CV ao longo do ciclo, custo/kg com dados do Apresenta.me, alerta de despesca (~90 dias),
   plano de ração com todos os viveiros lado a lado.
2. Integração Apresenta.me (centros de custo por viveiro).
3. Foto na ocorrência; importação do histórico do Meu Pescado (exporta Excel).
4. Rodar em paralelo com o Meu Pescado por um ciclo antes de desligá-lo.

## Rodar / publicar
```
npm install
npm run dev          # desenvolvimento (sem .env = modo demonstração)
npm run build        # gera dist/
```
Produção: criar projeto Supabase → rodar supabase/schema.sql → cadastrar viveiros, ciclos, produtos, usuários e perfis →
Vercel com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY → no celular, "Adicionar à tela inicial".

Demonstração publicada (privada do Antônio): https://claude.ai/artifact/UZGwZKU7UmSbVdvs4emqN3

## Convenções
- Interface e textos em pt-BR; números com vírgula decimal; datas dd/mm/aaaa; horas 24 h.
- Botões grandes (uso no sol, com luvas); nada financeiro no app de campo.
- Avisos pedem confirmação (tocar duas vezes), não bloqueiam — exceto valores impossíveis.
