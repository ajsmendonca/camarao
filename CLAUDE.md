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
2. **Painel do escritório** — v1 feito em 24/11/2026 (`src/Painel.jsx`; gestor; botão "Painel do escritório" na tela
   inicial ou endereço `…/#painel`, que sobrevive ao recarregar). Precisa de sinal (busca o histórico no Supabase via
   `carregarPainel` em `data.js`; na demonstração usa séries de exemplo). Mostra: indicadores (viveiros em cultivo,
   biomassa estimada, **valor de venda estimado**, ração hoje × previsto, despesca prevista em 30 dias em kg e R$, ração em estoque e dias pelo plano);
   alertas (≥110 dias crítico, >90 atenção, OD<3, muita sobra/zerou, sem biometria ou >10 dias, sem plano, sem
   sobrevivência estimada, previsão atrasada, estoque abaixo do mínimo, ração <7 dias); tabela dos viveiros (dias, PL,
   PL/m², peso, ganho g/semana, sobrev. est., biomassa est., **R$/kg e valor de venda** (biomassa est. × preço: da previsão
   de despesca do viveiro, senão **preço de tabela** pelo último peso), ração consumida, linha de total, **FCA parcial** = consumida ÷ (biomassa est.
   + despescada), ração hoje/plano, bandejas, OD; impostos est., resultado est. e **resultado/dia** = resultado est. ÷ dias
   do ciclo desde o início da preparação; no total, a soma dos viveiros); por viveiro: curva de crescimento (peso × dias, linha de referência
   em 90 dias) e ração colocada por dia nos últimos 30 dias com o previsto tracejado; previsões de despesca; estoque;
   **histórico de ciclos encerrados**: quadro por faixa de dias de cultivo (até 89, 90–109, ≥110: ciclos, sobrevivência,
   FCA, peso, R$/kg vendido, custo/kg, resultado, ciclos positivos) e tabela ciclo a ciclo com faturamento, custo,
   resultado e cliente (view `vw_ciclo_financeiro_historico`, só gestor). Gráficos em SVG próprio, com dica ao passar o mouse.
   Falta: custos/resultado (Apresenta.me), plano de ração lado a lado editável no painel.
3. **Integração Apresenta.me** — sincronização **funcionando desde 24/11/2026**. **Só leitura**.
   - **Edge Function `apresentame`** (`supabase/functions/apresentame/index.ts`; gestor/admin chamam pelo botão "Sincronizar
     agora" em Cadastros): busca `GET {APRESENTAME_URL}/transactions?filter[business_id]=1754&sort=-date&include[]=plan&
     include[]=person` paginado (para quando a página inteira é anterior ao "desde": 60 dias antes do último copiado, ou
     01/01/2026), ignora transferências internas, grava em `financeiro_lancamentos` (upsert por `apresentame_id`) e liga
     pessoas: despesas → `fornecedores`, receitas → `clientes` (por `apresentame_person_id`; se já houver o mesmo nome sem
     ligação, liga). Log em `integracao_execucoes`. Publicar como a função `usuarios` (slug `apresentame`).
   - **Segredos no Supabase** (projeto camarao › Edge Functions › Secrets; nunca no app nem no chat): `APRESENTAME_URL`
     (endereço base da API), `APRESENTAME_TOKEN` (chave) e, se a chave não for `Authorization: Bearer`, `APRESENTAME_HEADER`
     (nome do cabeçalho). **Configurados em 24/11/2026**: o Antônio cadastrou `APRESENTAME_TOKEN` no painel do Supabase;
     `APRESENTAME_URL` = `https://api.apresenta.me` (descoberto testando endereços do Apresenta.me; formato Bearer).
     1ª sincronização (desde 01/01/2025): 43 despesas, R$ 115.634,45, de 15/10/2026 a 15/12/2026 (vencimentos), 26
     fornecedores criados; nenhuma receita (as vendas ainda não são lançadas no Apresenta.me).
   - **Custos por ciclo (feito em 25/11/2026)** — views `vw_preco_medio` (preço médio ponderado: `produtos.custo_inicial` =
     preço do Meu Pescado × saldo inicial + entradas com `valor`), `vw_consumo_ciclo` (racao incl. histórico, bandejas,
     insumos, consumo_anterior, povoamentos com produto), `vw_notas_rateio`, `vw_custo_rateio` (por nota: valor × área do
     viveiro ÷ área dos ciclos abertos na data `competencia`/`data`; inclui perdas = ajustes negativos × preço médio) e
     `vw_custo_ciclo` (ração, insumos, pós-larva — PL sem produto × `configuracoes.preco_pl_milheiro` (R$ 14) —, comum,
     comum_provisorio, direto). Tabela `financeiro_destino` (por nota: estoque | ja_no_estoque | ciclo | rateio | ignorar).
     Entrada via nota: `estoque_movimentos.apresentame_id` + `valor` (nota com vários produtos: valor dividido pela
     quantidade ou informado). Centro 1829 (Investimento) fica fora.
   - **Painel** (`src/Financeiro.jsx`): tabela de viveiros com **Custo até hoje** e **Resultado est.** (valor de venda −
     custo); quadro "Custo dos ciclos abertos" (ração, insumos, PL, comum, provisório, direto, total, custo/kg est.);
     quadro **"Notas do Apresenta.me"** (filtro "A classificar" = Ração/Larva/Insumos sem destino; Classificar: entrada no
     estoque (produto + quantidade), já contabilizada, direto de um ciclo, comum, não é custo; Desfazer — entrada de
     estoque só o admin desfaz). Em 25/11/2026: 9 notas a classificar (7 de ração/aditivo, 2 de larva = PL do V02/V07,
     já contadas pelo povoamento). **Classificadas em 25/11/2026 a pedido do Antônio**: 4 notas de ração da Guaraves
     (R$ 70.152 ≈ consumo desde 14/10 + estoque de 24/11) e 2 de larva (PL do V02/V07) → `ja_no_estoque`; aditivos e
     probiótico INNUTRI (R$ 1.840, não controlados no estoque) → `rateio`. Custo dos ciclos abertos caiu de ≈ R$ 230 mil
     para ≈ R$ 158,5 mil, sem provisório. Notas novas de ração (depois de 24/11) → "Entrada no estoque".
   - Falta: receitas (vendas lançadas no Apresenta.me ligadas à despesca) → resultado real dos novos ciclos.
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
   - **Cadastros** (botão 🤝; gestor/admin; precisa de sinal; `src/Cadastros.jsx`): abas Clientes e Fornecedores com busca,
  novo, correção (nome, CPF/CNPJ, telefone, cidade, observação, ativo) e marca "Apresenta.me #id" nos ligados; quadro da
  última sincronização e botão "Sincronizar agora". Tabela `fornecedores` (gestor lê/grava).
- **Fornecedores e clientes** (decisão anterior): sem cadastro próprio completo. Vêm do Apresenta.me, **só as pessoas com lançamentos da
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
- **Preço de tabela** (decidido em 24/11/2026; estimativa para análise de estoque e venda): preço = base + (peso − peso
  de referência) × passo — padrão R$ 20,00 a 10 g, ± R$ 1,00 por grama (12 g = R$ 22; 9 g = R$ 19; proporcional em
  gramas quebradas). Fica em `configuracoes.preco_venda` ({base, peso_ref, passo}); **gestor e admin alteram no painel**
  (quadro "Preço de tabela", com exemplos 8–16 g). Usado no valor de venda do painel (quando o viveiro não tem previsão com
  preço) e para **preencher o preço da previsão de despesca** pelo peso previsto (o gestor pode digitar outro).
- **Impostos sobre a venda** (decidido em 25/11/2026; estimativa): % do valor de venda estimado, em
  `configuracoes.imposto_venda` ({pct}; o Antônio informou 13% em 25/11/2026). Gestor/admin alteram no painel (quadro "Impostos
  sobre a venda", ao lado do Preço de tabela; `salvarConfig` em data.js faz UPDATE — a linha já existe). Painel: coluna
  **Impostos est.** e **Resultado est. = venda − impostos − custo**; indicador **"Resultado estimado"** no topo com a conta.
  Atenção: COFINS/ICMS pagos no Apresenta.me entram no custo comum (rateio) — se forem impostos da venda, classificar como
  "Não é custo da produção" para não contar duas vezes.
- **Ração de hoje/ontem e tratos feitos** somam os tratos deste aparelho + os do servidor (`cad.tratos`, últimos 2 dias,
  de outros aparelhos ou importados), sem repetir id.
- **Atualização automática** (24/11/2026): `src/main.jsx` registra o service worker (`virtual:pwa-register`, autoUpdate,
  skipWaiting/clientsClaim) e o app **recarrega sozinho** quando há versão nova; confere a cada 30 min e ao voltar para o app.
  Antes só atualizava na 2ª abertura — o que fez o Antônio, já como admin, ver o app antigo como se fosse "campo".
  Versão do app (data/hora do build) aparece no rodapé da tela de lançamentos.
- Sem `.env` → **modo demonstração** (8 viveiros de exemplo com a situação real de 24/11/2026).
- Perfis (tabela `perfis`; decidido em 24/11/2026): **admin** (tudo do gestor + **Equipe** + **Registros** = corrigir/apagar
  lançamentos) · **gestor** (plano de ração, ciclos, despesca, previsões, estoque, painel) · **campo** (trato, bandejas,
  biometria, água, ocorrência, insumos). Funções `eh_gestor()` (gestor ou admin) e `eh_admin()`. RLS: lançamentos do campo
  todos leem/inserem, **só admin altera/apaga**; tabelas do gestor só admin apaga; viveiros/configurações só admin altera.
  O envio offline dos lançamentos do campo usa upsert com `ignoreDuplicates` (reenvio do mesmo id não precisa de UPDATE).
  Antônio = admin. Equipe cadastrada por ele: José Rodrigues (gestor), antonio.campo (campo).
- **Histórico** (botão 📝; **gestor consulta, admin também corrige/apaga**; precisa de sinal; `src/Registros.jsx`,
  prop `podeEditar`): ração tem visão **por dia** (vw_racao_diaria: lanço, bandejas, sobra, total) e **por trato**; biometria
  mostra o **ganho g/semana** sobre a anterior. Escolhe viveiro → ciclo (atual ou anteriores) → tipo
  (Ração, Bandejas, Biometria, Água, Ocorrência, Insumos, Planos, Povoamento, Despesca); lista e, ao tocar, corrige ou
  apaga (2 toques). Bandejas: colocação + retirada juntas (resultado recalculado). Plano: novo kg/dia reparte os tratos na
  mesma proporção. Apagar despesca total/perda **reabre o ciclo** (trigger `reabre_ciclo`); apagar o único povoamento
  volta o ciclo para preparação (trigger `povoa_ciclo` recalcula data do povoamento e situação em insert/update/delete).
- **Ciclos**: ao escolher um viveiro com ciclo, mostra os **dados gravados** para corrigir (início, observação e cada
  povoamento: data, hora, PL, laboratório, estágio, obs.; precisa de sinal); complemento é um botão separado.

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
  (população despescada / PL) e FCA (consumida / biomassa). Sobrevivência **>100% só avisa** (o laboratório às vezes
  manda mais larvas do que vende — confirmado pelo Antônio); **>130% bloqueia**. Total **encerra** o ciclo (trigger).
- **Previsão de despesca** (pedido de venda; gestor; tela Despesca › Previsões): viveiro, cliente (da lista ou novo),
  data prevista, quantidade (kg), peso médio previsto (g), preço/kg → valor previsto e nº de camarões.
  Sugere kg = biomassa estimada − já previsto; avisa se passar da biomassa estimada, se a data der ≥110 dias de cultivo,
  peso menor que a última biometria, sem cliente ou sem preço. Lista com total previsto (kg e R$), atrasadas em vermelho,
  "Lançar despesca" (preenche kg e peso e liga `previsao_id`) e "Cancelar". Cartão do viveiro mostra "Despesca prev.".
  Banco: despesca com `previsao_id` marca a previsão como **realizada**; despesca total/perda cancela as outras abertas.
  **Clientes e previsões têm preço: só o gestor lê (RLS)**.
- **Sobrevivência estimada**: vale a **mais recente** entre o **Plano de ração** (`planos_racao.sobrevivencia_est`) e a
  tabela `estimativas_sobrevivencia` (estimativa avulsa; usada na carga do Meu Pescado). **Biomassa esperada =
  PL povoadas × sobrevivência estimada × peso da última biometria (peso total)** − já despescado (definição do Antônio).
  O plano de ração vem preenchido com a sobrevivência atual. Mostra "ração do dia = X% da biomassa".
- **Plano de ração (gestor)**: por viveiro — kg/dia (total do viveiro, **incluindo** a ração das bandejas — confirmado),
  ração, nº de tratos, divisão por trato (igual ou manual), "vale a partir de", recado ao arraçoador.
  Atalhos −10/−5/+5/+10%. Vale até o próximo plano. O arraçoador vê previsto / colocado / falta.

### Tela inicial
Cartão por viveiro: **dias de cultivo** (desde o povoamento) e **dias do ciclo** (desde o início da preparação), peso (biometria peso total), povoado (PL), previsto (kg e % sobrev.), uniformidade (CV), ração hoje "colocado / previsto",
status das bandejas (a colocar / retirar ~hh:mm / resultado), tratos do dia, alerta ">90 dias".

## Banco (supabase/schema.sql)
viveiros, ciclos (data_inicio, data_povoamento, data_fim, status preparacao|em_cultivo|encerrado|cancelado),
clientes (+ observacao), fornecedores, financeiro_lancamentos (cópia do Apresenta.me; só gestor lê), financeiro_destino, integracao_execucoes (log),
views de custo vw_preco_medio, vw_consumo_ciclo, vw_notas_rateio, vw_custo_rateio, vw_custo_ciclo; produtos.custo_inicial,
previsoes_despesca (aberta|realizada|cancelada; valor_prev calculado), povoamentos (+ produto_id do lote de PL; trigger → em cultivo), despescas (parcial|total|perda_total, previsao_id; trigger → encerrado e atualiza previsões), produtos (+ estoque_minimo), estoque_movimentos (entrada|ajuste), view vw_estoque_saldo,
perfis (admin|gestor|campo; funções eh_gestor, eh_admin), configuracoes, racao (+ fora_estoque), bandeja_colocacoes, bandeja_retiradas,
biometrias (tipo simples|classes, classes jsonb), agua, ocorrencias, planos_racao, aplicacoes_insumos,
estimativas_sobrevivencia (sobrevivência estimada avulsa, por ciclo e data),
vendas_historico (por despesca: cliente, NF, faturamento, custo, resultado — Meu Pescado; só gestor) + view vw_ciclo_financeiro_historico,
consumo_anterior (consumo antes do sistema, por ciclo e produto; entra em racao_consumida_kg, fora do estoque),
view vw_racao_diaria (ração por ciclo e dia: lanço, bandejas, sobra, colocado, consumido — painel),
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
→ No sistema novo: investimento nunca entra no custo do lote; sobrevivência >100% pede confirmação (pode ser real).
- Histórico importado (62 ciclos) por faixa de dias: até 89 dias FCA 1,29 / sobrev. 62% / 11 de 22 positivos;
  90–109 dias FCA 1,83 / 57% / 10 de 27; ≥110 dias FCA 2,34 / 44% / 4 de 13 (resultado −R$ 615 mil).

## Pendências / perguntas em aberto
- **Carga inicial feita em 24/11/2026** (confirmada pelo Antônio), a partir do "Relatório de lotes completo" e do
  "Relatório de estoques" do Meu Pescado: 8 ciclos em cultivo (início = data do povoamento, preparação desconhecida;
  `lancado_por`/observação "Carga inicial (Meu Pescado)"), povoamento (V08 400 mil PL, demais 300 mil; V03/V04 vinham
  num lote só de 600 mil e foram divididos), última biometria de 24/11 (V02 e V07 sem), e 15 produtos com saldo inicial
  (ajuste "Saldo inicial", preço médio do Meu Pescado na observação). Sobrevivência de 80% do Meu Pescado **não** foi
  copiada — o Antônio informa a estimativa no plano de ração.
  Em seguida (também confirmado), com os **relatórios de custos por viveiro** (PDF, V01–V08): início do ciclo =
  povoamento − dias em preparação (V01 16/08, V02 23/10, V03/V04 14/09, V05 14/07, V06 13/07, V07 27/10, V08 14/07;
  código do ciclo atualizado), fornecedor com nome completo, e **ração e fertilização já usadas** gravadas em
  `consumo_anterior` (não mexe no estoque; a ração entra na ração consumida e no FCA). Custos do Meu Pescado não importados.
  A pedido do Antônio, a **sobrevivência estimada do Meu Pescado** foi gravada em `estimativas_sobrevivencia` (24/11/2026):
  80% (V01, V03, V04, V06, V08), 61,83% (V05), 100% (V02, V07). Biomassa e FCA parcial conferem com o Meu Pescado.
  **Histórico (planilha "Lotes vendidos", confirmado):** 62 ciclos encerrados (jan/2024–out/2026), 67 despescas (5 ciclos com
  parcial + total), PL = população ÷ sobrevivência (arredondado a 10 mil), início = povoamento − dias de preparação (só os
  lotes de 2024 informam; os demais início = povoamento), laboratórios padronizados (nome original na observação), ração
  total por ciclo em `consumo_anterior` (produto inativo "Ração (histórico Meu Pescado)"), e **vendas_historico** com
  cliente, NF, faturamento, **custo e resultado do Meu Pescado** (o Antônio quer esses números: o Apresenta.me não era
  usado antes). Totais: 150.390 kg, R$ 3.161.255,50 faturados, R$ 4.171.362,80 de custo. 8 clientes criados.
  V07 despescado em 27/10/2026 tem 103% de sobrevivência — **é real** (laboratório manda mais larvas do que vende).
  **Biometrias (planilha "Biometria por período 01/01/26 a 24/11/26", confirmado):** só as que caem dentro de um ciclo do
  viveiro (povoamento ≤ data ≤ despesca/hoje) — 255 gravadas (`lancado_por` "Histórico (Meu Pescado)", n=100), em 27 ciclos;
  fora: V07 12/08/2026 (1 dia antes do povoamento) e uma linha sem peso. Em 19/11: V05 ficou 12,40 g (havia uma linha de
  5,30 g do V04 lançada no V05) e V04 ficou 5,30 g (descartado 5,03 g). As biometrias de 24/11 da carga inicial (cópias de
  19/11) foram substituídas. V02 e V07 têm só o peso do povoamento (0,02 g).
  **Arraçoamento (planilha "Nutrições por período 01/04/26 a 24/11/26", confirmado):** 1.292 tratos diários (todos dentro
  de ciclos), gravados em `racao` com `fora_estoque = true` (o saldo inicial do Meu Pescado já os descontou; a view de
  estoque ignora esses tratos), `lancado_por` "Rodrigo (Meu Pescado)", trato numerado por dia. Para não contar em dobro:
  nos 14 ciclos povoados a partir de 01/04 o total de ração em `consumo_anterior` foi apagado (o diário bate exatamente);
  nos 5 povoados antes de 01/04 o `consumo_anterior` virou só a parte anterior a 01/04 (total − diário). Ração consumida
  de todos os ciclos e estoque conferidos iguais antes/depois.
- Respondido em 24/11/2026: kg/dia do plano inclui bandejas (sim); muita sobra = >20% do colocado; CV 20%/30% ok;
  4 tratos e 5 parâmetros de água ficam como estão (o plano de ração ajusta as quantidades).
- Rações e insumos vêm do estoque deste sistema (ver "Estoque"). Falta cadastrar a lista real de produtos e o saldo inicial.

## Próximos passos sugeridos
1. Painel do escritório (v1 pronto; falta custos e plano lado a lado): FCA real (consumido/biomassa), sobrevivência estimada e real na despesca, curva de crescimento,
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
