# Camarão — Coleta de campo

App de celular (PWA, funciona offline) para o campo e o gestor.

**Estoque:** rações e insumos têm saldo. O gestor lança as entradas (notas) e as contagens; o consumo sai sozinho
a cada trato, bandeja e insumo lançado. No campo só aparecem os produtos que têm estoque.

**Gestor:** inicia o ciclo (viveiro em preparação), lança o povoamento (em cultivo), as previsões de despesca (pedidos de venda, com cliente e preço) e a despesca (sobrevivência real e FCA), e define o plano de ração
por viveiro (kg/dia, sobrevivência estimada, ração, divisão por trato, recado), vigente a partir de uma data.

**Campo** registra:
**trato a lanço (com a ração usada e o previsto pelo gestor), bandejas (colocação e retirada com sobra pesada), insumos (fertilizante, calcário, probiótico...), biometria (peso total ou por tamanho), parâmetros de água e ocorrências**, todos com data e hora.
O financeiro continua no Apresenta.me; este projeto cuida só da produção.

## Como funciona
- Tudo é salvo primeiro no aparelho (IndexedDB) e enviado ao Supabase quando houver sinal
  (automático a cada 1 min ou pelo botão "Enviar agora").
- Cada lançamento recebe um id gerado no celular, então reenviar nunca duplica.
- Validações avisam antes de salvar: trato repetido, kg fora da média, biometria menor que a anterior,
  ganho semanal alto demais, amostra pequena, OD < 3 mg/L, pH fora de 7–9,5.
- Lançamento ainda não enviado pode ser excluído no celular; depois de enviado, a correção é no escritório.
- Sem `.env` configurado, roda em **modo demonstração** com os 8 viveiros de exemplo.

## Colocar no ar
1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor.
2. Cadastre os viveiros (tabela `viveiros`). Os ciclos são iniciados pelo gestor no app (botão Ciclos).
3. Em Authentication, crie os usuários (e-mail e senha) e cadastre cada um em `perfis` como `gestor` ou `campo`.
   Depois, entrando como gestor no app: Estoque › Produto (cadastrar rações e insumos) e Estoque › Contagem (saldo inicial).
4. No Vercel, importe o repositório e defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
5. No celular, abra o endereço no Chrome e use "Adicionar à tela inicial".

> Próxima etapa: foto na ocorrência e o painel do escritório com FCA, sobrevivência, custo por viveiro (Apresenta.me).

## Desenvolvimento
```
npm install
npm run dev
```
