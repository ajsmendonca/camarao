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
3. **Integração Apresenta.me** — AINDA NÃO FEITA (fazer junto com o painel). **Só leitura**, nunca grava no Apresenta.me.
   Decidido em 24/11/2026:
   - Empresa: **Barra Maricultura LTDA (business_id 1754)**; hoje todas as despesas vão no centro de custo
     **Fazenda Santo Antonio (id 765)**, separadas por plano de contas (Ração 15368 — inclui probiótico —, Energia 40,
     ITR 15336, Manutenção máquinas 15337, Combustível 39, Vale alimentação 9180 etc.).
   - **Regra de custo (decidida em 24/11/2026)** — o sistema puxa **todas** as despesas da Barra Maricultura, exceto o centro
     **Fazenda Santo Antonio – Investimento (1829)**, que nunca entra no lote. Para cada nota:
     1. ligada a uma **entrada de estoque** → vai aos viveiros pelo consumo (ração/insumo) ou povoamento (PL), a preço médio;
     2. **atribuída a um ciclo** pelo gestor → custo direto daquele ciclo;
     3. **todo o resto é rateado automaticamente** por hectare × dia entre os ciclos abertos (preparação + cultivo)
        na data do lançamento (`vw_ciclo_resumo.hectare_dia`).
     Notas com plano **Ração (15368)**, **Larva do Camarão (16636)** ou **Insumos de viveiro (16938)** não ligadas ao estoque
     aparecem no painel como *"provável estoque não lançado"* e contam no rateio como **provisórias**; ao serem ligadas,
     saem do rateio e o custo é recalculado. Perdas de estoque (ajuste negativo de contagem) também vão para o rateio.
   - O escritório continua lançando tudo em Fazenda Santo Antonio (765); só investimento vai no 1829. Sem centro por viveiro.
     (O centro "Fazenda Santo Antonio – Viveiros" (1830) foi criado e depois **inativado** — não é usado.)
   - Plano de contas CAMARÃO (15367): Ração 15368, Larva do Camarão 16636, Análise de Água – ITPS 16637,
     Insumos de viveiro 16938 (criado em 24/11/2026 para calcário, fertilizante, probiótico).
   - **O Apresenta.me não tem itens** (só valor, fornecedor, plano, descrição). Quantidade vem do sistema de produção
     (entrada de estoque); valor vem do lançamento financeiro → preço médio = Σ valor / Σ quantidade por produto.
     As notas lançadas pelo **Sistema de Vistos** trazem nas observações a **chave da NF-e** (`[chave=44 dígitos]`), o que
     permitiria ler os itens do XML — **não usado por ora**.
   - Entrada de estoque deve poder escolher a nota do Apresenta.me (fornecedor/valor/NF → preço médio); se a nota
     tiver vários produtos, o gestor divide o valor (sugestão proporcional à quantidade).
   - O Antônio prefere controlar pelo Apresenta.me (não depender do XML do Sistema de Vistos).
   - **Receita / venda** (decidido em 24/11/2026): a **despesca é lançada no sistema do camarão**; a venda é lançada no
     Apresenta.me pelo escritório como receita da Barra Maricultura, plano **RECEITAS › RECEITA › Venda de camarão (16939)**
     (criado em 24/11/2026), com o cliente. O gestor liga a(s) receita(s) à despesca (uma despesca pode ter várias vendas)
     → preço médio/kg, receita e resultado do ciclo. Em 24/11/2026 **não havia nenhuma receita** da Barra Maricultura no
     Apresenta.me (as vendas estavam só no Meu Pescado).
   - **Fornecedores e clientes**: sem cadastro próprio completo. Vêm do Apresenta.me, **só as pessoas com lançamentos da
     Barra Maricultura** (o cadastro de pessoas é compartilhado com as outras empresas do Antônio). Fornecedor vem da nota
     ligada à entrada de estoque. Exceção: tabela `clientes` local (para previsões de despesca), alimentada pela integração
     (`apresentame_person_id`) e por **pré-cadastro** do gestor para comprador novo (nome, telefone).
   - O Antônio já tem a chave de API; vai como segredo no Supabase (Edge Function), nunca no app nem no chat.
   - API: `financial.transactions.index` com filtros `business_id`, `cost_center_id`, `type` (debit/credit), include `plan`.

## App de campo — como funciona
- Tudo é salvo primeiro no aparelho (IndexedDB via idb-keyval) e enviado ao Supabase quando há sinal
  (a cada 1 min ou botão "Enviar agora"). Ids gerados no celular (uuid) → upsert idempotente.
- Envio em ordem cronológica (colocação antes da retirada, por causa da FK).
- Lançamento não enviado pode ser excluído no celular; depois de enviado, correção é no escritório.
- Login por **usuário ou e-mail** + senha (Supabase Auth); precisa de sinal só no 1º acesso. Funcionário sem e-mail:
  usuário `joao.silva` vira `joao.silva@equipe.barramaricultura.com.br` por trás (só para o login; nenhum e-mail é enviado;
  regra em `data.js` `emailDoLogin` e na Edge Function). Quem lança (`lancado_por`) = **nome do perfil do usuário logado**
  — não há mais "Quem está lançando?/Trocar usuário" (só no modo demonstração). Lançamentos: "Trocar senha" e "Sair"
  (sair apaga o cadastro guardado; lançamentos não enviados ficam no aparelho). Após login abre sempre a tela inicial.
- **Equipe** (gestor, precisa de sinal): botão na tela inicial. Lista usuários (nome, usuário, perfil, último acesso);
  novo usuário (nome → sugere `nome.sobrenome`, senha provisória de 6 dígitos, perfil campo/gestor) e mostra uma vez
  "entregue ao funcionário: usuário X · senha Y"; gerar nova senha; mudar perfil; desativar/reativar (bloqueia o login,
  mantém os lançamentos). Gestor não pode desativar nem rebaixar a si mesmo.
  Tudo pela **Edge Function `usuarios`** (`supabase/functions/usuarios/index.ts`; usa service_role no servidor; confere
  que quem chama é gestor). Publicar: `POST https://api.supabase.com/v1/projects/clozwpjdpinuroctpoca/functions/deploy?slug=usuarios`
  (multipart: `metadata` {"entrypoint_path":"index.ts","name":"usuarios","verify_jwt":true} + `file`).
- Sem `.env` → **modo demonstração** (8 viveiros de exemplo com a situação real de 24/11/2026).
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
- **Estoque** (decidido em 24/11/2026: fica **neste sistema**; a API do Apresenta.me não tem estoque/produtos):
  - Saldo = entradas + ajustes − saídas (view `vw_estoque_saldo`). Saídas automáticas: trato (`racao.kg`),
    colocação de bandeja (`kg_bandejas`, a sobra é descartada) e aplicação de insumo.
  - Gestor lança **Entrada** (em kg ou sacos × kg/saco, NF/fornecedor), **Contagem** (grava ajuste = contado − sistema)
    e cadastra **Produto** (nome, tipo, unidade, estoque mínimo). Campo só vê o saldo.
  - Nas telas de ração/insumo aparecem só produtos com saldo (o escolhido e o previsto sempre aparecem;
    botão "Mostrar N sem estoque"). Lançar acima do saldo **avisa** (não bloqueia) — a nota pode não ter sido lançada ainda.
  - No celular: saldo do servidor (até `cad.carregado_em`) + lançamentos do aparelho não enviados ou enviados depois.
  - Tela de saldo mostra "~N dias" de cada ração pela soma dos planos de ração vigentes que a usam.
- **Ciclo** (decidido em 24/11/2026): **Vazio → Iniciar ciclo (Preparação) → Povoamento (Em cultivo) → Despesca total (Encerrado)**.
  - O gestor **inicia** o ciclo (data de início, obs.); o viveiro fica **em preparação** (secagem, calagem, fertilização).
    Id gerado no celular, código `V01-<data de início>`. Só um ciclo aberto por viveiro (índice único).
  - **Todos os custos rateados entram no ciclo desde o início** (ha × dia de `data_inicio` a `data_fim`), incluindo a preparação.
  - Na preparação o campo pode lançar **insumos, água e ocorrência**; ração, bandejas, biometria, plano e despesca só em cultivo.
  - Dias de cultivo (cartão, alerta >90) contam do povoamento; o cartão em preparação mostra os dias de preparação.
- **Pós-larva no estoque** (categoria `pos_larva`, unidade PL; entrada/contagem digitadas em milheiros): entrada = PL compradas;
  povoamento escolhe o lote e **sai do estoque**; contagem acerta as diferenças (bônus do laboratório, perdas).
- **Encerrar sem despesca**: na Despesca, tipo **Perda total** (motivo obrigatório, biomassa 0) encerra o ciclo.
- **Povoamento (gestor)**, tela "Ciclos": PL povoadas, lote de PL do estoque, fornecedor, estágio (PL12), data/hora, obs.
  Ciclo em preparação → passa para em cultivo (trigger no banco); já em cultivo → **complemento** (soma PL).
  Não pode ser antes do início do ciclo. Mostra densidade (PL/m²), avisa >80 ou <3. Custo da PL vem da nota no Apresenta.me (plano Larva do Camarão) ligada à entrada de estoque.
- **Despesca (gestor)**: parcial ou total; biomassa (kg) + peso médio (g) → população, sobrevivência real
  (população despescada / PL) e FCA (consumida / biomassa). **Sobrevivência >100% bloqueia**. Total **encerra** o ciclo (trigger).
- **Previsão de despesca** (pedido de venda; gestor; tela Despesca › Previsões): viveiro, cliente (da lista ou novo),
  data prevista, quantidade (kg), peso médio previsto (g), preço/kg → valor previsto e nº de camarões.
  Sugere kg = biomassa estimada − já previsto; avisa se passar da biomassa estimada, se a data der ≥110 dias de cultivo,
  peso menor que a última biometria, sem cliente ou sem preço. Lista com total previsto (kg e R$), atrasadas em vermelho,
  "Lançar despesca" (preenche kg e peso e liga `previsao_id`) e "Cancelar". Cartão do viveiro mostra "Despesca prev.".
  Banco: despesca com `previsao_id` marca a previsão como **realizada**; despesca total/perda cancela as outras abertas.
  **Clientes e previsões têm preço: só o gestor lê (RLS)**.
- **Sobrevivência estimada**: o gestor informa no **Plano de ração** (%). Previsto = PL × sobrev. − já despescado;
  biomassa prevista = previsto × último peso. Mostra "ração do dia = X% da biomassa". Sem padrão automático.
- **Plano de ração (gestor)**: por viveiro — kg/dia (total do viveiro, **incluindo** a ração das bandejas — confirmado),
  ração, nº de tratos, divisão por trato (igual ou manual), "vale a partir de", recado ao arraçoador.
  Atalhos −10/−5/+5/+10%. Vale até o próximo plano. O arraçoador vê previsto / colocado / falta.

### Tela inicial
Cartão por viveiro: dias de cultivo, peso (biometria peso total), povoado (PL), previsto (kg e % sobrev.), uniformidade (CV), ração hoje "colocado / previsto",
status das bandejas (a colocar / retirar ~hh:mm / resultado), tratos do dia, alerta ">90 dias".

## Banco (supabase/schema.sql)
viveiros, ciclos (data_inicio, data_povoamento, data_fim, status preparacao|em_cultivo|encerrado|cancelado),
clientes, previsoes_despesca (aberta|realizada|cancelada; valor_prev calculado), povoamentos (+ produto_id do lote de PL; trigger → em cultivo), despescas (parcial|total|perda_total, previsao_id; trigger → encerrado e atualiza previsões), produtos (+ estoque_minimo), estoque_movimentos (entrada|ajuste), view vw_estoque_saldo,
perfis (+ função eh_gestor), configuracoes, racao, bandeja_colocacoes, bandeja_retiradas,
biometrias (tipo simples|classes, classes jsonb), agua, ocorrencias, planos_racao, aplicacoes_insumos,
view vw_ciclo_resumo (dias_ciclo, dias_preparacao, dias_cultivo, hectare_dia (base do rateio), PL, densidade, ração colocada/consumida, último peso, sobrevivência estimada, população/biomassa
prevista, despescado, sobrevivência real e FCA). Ciclos/povoamentos/despescas: só gestor grava. Schema testado em PostgreSQL 16.
Sem seed de produtos: o gestor cadastra no app (Estoque › Produto). Produtos e estoque: todos leem, só gestor grava (RLS).

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
- Rações e insumos vêm do estoque deste sistema (ver "Estoque"). Falta cadastrar a lista real de produtos e o saldo inicial.

## Próximos passos sugeridos
1. Painel do escritório: FCA real (consumido/biomassa), sobrevivência estimada e real na despesca, curva de crescimento,
   distribuição por tamanho e CV ao longo do ciclo, custo/kg com dados do Apresenta.me, alerta de despesca (~90 dias),
   plano de ração com todos os viveiros lado a lado.
2. Integração Apresenta.me (ver decisões em "Arquitetura").
3. Foto na ocorrência; importação do histórico do Meu Pescado (exporta Excel).
4. Rodar em paralelo com o Meu Pescado por um ciclo antes de desligá-lo.

## Rodar / publicar
```
npm install
npm run dev          # desenvolvimento (sem .env = modo demonstração)
npm run build        # gera dist/
```
Produção: criar projeto Supabase → rodar supabase/schema.sql → cadastrar viveiros, usuários e perfis → no app (gestor): iniciar o ciclo e lançar o povoamento dos viveiros em cultivo,
produtos e contagem inicial do estoque →
Vercel com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY → no celular, "Adicionar à tela inicial".

**Produção (no ar desde 24/11/2026):**
- App: **https://camarao-beryl.vercel.app** (Vercel, projeto `camarao`, time ajsmendoncas-projects; ligado ao GitHub — cada push no `main` publica).
- Supabase: projeto **camarao** (ref `clozwpjdpinuroctpoca`, região sa-east-1 / São Paulo, org Pro do Antônio).
  Schema aplicado e viveiros V01–V08 cadastrados (V08 3,8 ha). Variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` no Vercel.
- Sessões na nuvem: ambiente `camarao` com tokens do Supabase (api.supabase.com) e do Vercel (api.vercel.com) injetados pelo proxy.
  SQL no banco: `POST https://api.supabase.com/v1/projects/clozwpjdpinuroctpoca/database/query` com `{"query": ...}`.
- Usuários: Antonio José (antonio@barramaricultura.com.br) — gestor, criado em 24/11/2026. Os demais o próprio Antônio
  cadastra no app (tela Equipe). Testes: criar usuários temporários e apagá-los depois (o banco real só tem dados reais).

Demonstração publicada (privada do Antônio): https://claude.ai/artifact/UZGwZKU7UmSbVdvs4emqN3 (modo demonstração; atualizada em 24/11/2026 com estoque, ciclos, povoamento, despesca e previsões — publicar o `dist/` com os arquivos)
Repositório: https://github.com/ajsmendonca/camarao

## Convenções
- Interface e textos em pt-BR; números com vírgula decimal; datas dd/mm/aaaa; horas 24 h.
- Botões grandes (uso no sol, com luvas); nada financeiro no app de campo.
- Avisos pedem confirmação (tocar duas vezes), não bloqueiam — exceto valores impossíveis.
