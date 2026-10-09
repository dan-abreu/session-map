# 01 — Ideia e produto

Transforma "eu quero isso" em um problema comprovado, um público definido, um critério de sucesso medível e uma especificação que um agente consegue construir sem adivinhar. É a etapa que mais separa amador de profissional: com IA, escrever código ficou barato e o gargalo passou a ser **especificar e validar** [V GitHub Spec Kit].

## Sumário

1. Quando entra
2. O que é feito, passo a passo
3. Quem faz
4. Entregas
5. Portões
6. O que o fundador decide
7. Erros de amador que isto evita
8. Fontes

## 1. Quando entra

Em toda ideia média ou grande, e em qualquer ideia que mude o que o cliente vê, paga ou recebe. Ideias triviais (corrigir um texto, ajustar um espaçamento) pulam para a etapa 03 com um critério de aceite de uma linha.

## 2. O que é feito, passo a passo

### 2.1 Entender o pedido antes de qualquer solução

1. Registrar a ideia com as palavras exatas do fundador, data e código.
2. Reescrever como **problema**, não como solução: "o cliente não sabe se o prestador chegou" em vez de "botão de rastrear". Uma a três frases: quem sofre, em que situação, o que perde hoje [C].
3. Separar **o pedido literal** da **intenção**: o agente pergunta "por quê?" até chegar ao resultado de negócio (mais vendas, menos reclamação, menos trabalho manual). Pedido complexo recebe a versão enxuta primeiro e a pergunta "precisa do completo?" [C, regra de economia].
4. Verificar se já existe algo parecido no produto, no registro de ideias ou numa decisão anterior. Ideia repetida vira atualização da antiga, não item novo.

### 2.2 Descoberta: o problema é real?

5. **Hipóteses explícitas.** Listar o que precisa ser verdade para a ideia valer a pena: o problema existe, é frequente, dói o bastante para pagar, o público alcança o produto, a solução cabe no orçamento. Ordenar por risco × facilidade de testar (skill `pm-product-discovery:identify-assumptions-new` e `prioritize-assumptions`).
6. **Entrevistas no método "Mom Test"** [V resumo do livro de Rob Fitzpatrick; F/blog nas sínteses]: falar da vida da pessoa, não da ideia; perguntar sobre fatos específicos do passado ("da última vez que isso aconteceu, o que você fez?"), não opiniões sobre o futuro ("você usaria?"); ouvir mais que falar. Elogio não é evidência; "eu pagaria" hipotético não é evidência; quem nunca procurou solução não vai comprar a sua. O agente prepara o roteiro (skill `pm-product-discovery:interview-script`) e resume as transcrições (skill `summarize-interview`). Meta de convenção: 5 a 10 conversas por segmento antes de construir algo grande [C].
7. **Trabalho a ser feito (JTBD).** Descrever o que o cliente "contrata" o produto para fazer, o que ele usa hoje (as alternativas reais, inclusive "não fazer nada" e "planilha") e o que o faria trocar (skill `pm-product-strategy:value-proposition`) [C; fonte primária de JTBD não lida].
8. **Concorrência e alternativas.** Mapa de concorrentes diretos, indiretos e do jeito atual de resolver, com preço e ponto fraco de cada um (skill `pm-market-research:competitor-analysis`). Para mercado local, inclui os informais (grupo de WhatsApp, indicação de vizinho).
9. **Teste barato antes do código** quando a ideia é cara: página de espera com chamada para ação, protótipo clicável, atendimento manual "de mágico de Oz" (uma pessoa faz à mão o que o sistema faria), pré-venda. O agente propõe o teste mais barato que derruba a hipótese mais arriscada (skill `pm-product-discovery:brainstorm-experiments-new`) [C].

### 2.3 Para marketplaces: o problema do começo frio

10. Identificar o **lado difícil** (normalmente a oferta: quem presta o serviço) e começar por ele; montar a menor rede que se sustenta sozinha (uma região, uma categoria) antes de expandir [V Andrew Chen, *The Cold Start Problem*, via resumos].
11. Definir a métrica de **liquidez**: a chance de quem pede encontrar quem atende, medida como taxa de pedidos atendidos e tempo até o primeiro atendimento, contando também as tentativas que não deram em nada [V a16z, glossário de marketplace].

### 2.4 Definir sucesso antes de construir

12. **Uma métrica de resultado** por ideia ("pedidos atendidos em até 2 h sobem de X para Y"), com linha de base atual, alvo e prazo para medir. Sem linha de base, o primeiro passo é medir.
13. **Métricas de funil** quando a ideia toca crescimento: aquisição, ativação, retenção, indicação e receita (AARRR, de Dave McClure, 2007) [V resumo; F nas sínteses]. A etapa com a pior conversão é a que merece a próxima ideia.
14. **Encaixe produto-mercado** para produto novo: pesquisa de Sean Ellis ("como você se sentiria se não pudesse mais usar o produto?"); 40% ou mais de "muito desapontado" é o sinal usado. O próprio autor diz que o limiar é "um pouco arbitrário", tirado da comparação de quase 100 startups; usar por segmento e junto com retenção, nunca sozinho [V/F resumos, citação de segunda mão].

### 2.5 Especificar

15. **Especificação escrita antes do código** nas quatro fases do Spec Kit: especificar (usuários, problema, critérios de sucesso), planejar (tecnologia, restrições), dividir em tarefas pequenas e testáveis, implementar; não se avança sem validar a fase anterior; mudar de rumo é atualizar a especificação e regenerar o plano [V GitHub Blog]. No session-map, uma mudança grande vira proposta em formato OpenSpec (proposta, desenho, especificações, tarefas).
16. **Critério de aceite verificável** em "dado / quando / então" ou caixas de seleção. Teste prático: se o agente não consegue escrever como saberá que terminou, a tarefa não está pronta para codar [F Vonage].
17. **Fora de escopo** escrito: o que a ideia não fará agora. Barra o crescimento silencioso [C].
18. **Tarefas pequenas.** "Construir login" é ruim; "rota de cadastro que valida o e-mail" é bom [V GitHub Blog]. Cada tarefa cabe numa sessão e tem seu teste.
19. **Casos de borda e erros esperados** listados: sem internet, valor zero, pessoa que desiste no meio, duas pessoas ao mesmo tempo, dado faltando.
20. **Estados vazios, de carregamento e de erro** de cada tela listados junto (detalhe na etapa 09).
21. **Impactos cruzados** marcados para as outras etapas: toca dado pessoal (05), muda preço (13), muda texto legal (12), precisa de anúncio ao cliente (10), muda atendimento (11).

### 2.6 Priorizar e dimensionar

22. **Apetite em vez de estimativa.** Fixar o tempo (por exemplo, uma ou duas semanas) e deixar o escopo se ajustar; o que não termina no ciclo é cancelado por padrão e reavaliado, sem prorrogação automática (o "disjuntor" do Shape Up) [V Basecamp, Shape Up].
23. **Priorização como conversa, não como verdade.** MoSCoW para delimitar a entrega e RICE para ordenar dentro dela; um método por sessão. Riscos conhecidos: impacto e alcance inflados, confiança alta sem dado, "obrigatório" passando de 70% do escopo [F ProductLift, secundária].
24. **Estimativa de custo** em tokens e em reais por etapa e total, antes de começar (etapa 14), e comparação com o real no fechamento.
25. **Riscos do fundador solo** no registro de riscos: uma pessoa com todos os acessos, dependência de um único fornecedor ou conta, dependência de regra de plataforma (WhatsApp, lojas de aplicativo) [C].

### 2.7 Definição de pronto

26. Uma **Definição de Pronto** única para o projeto: o estado formal que o trabalho precisa atingir para ser entregue; o que não cumpre volta para a fila [V Scrum Guide]. No session-map ela é a soma dos portões aplicáveis das 14 etapas.

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Reescrever o problema, hipóteses, perguntas | Gerente de produto | Sonnet, alto | `superpowers:brainstorming`, `grilling`, `pm-product-discovery:discover` |
| Roteiro e síntese de entrevistas | Pesquisador de usuários | Sonnet, médio | `pm-product-discovery:interview`, `pm-market-research:research-users` |
| Concorrência, mercado, tamanho | Analista de mercado | Sonnet, alto (busca na web com Haiku, baixo) | `pm-market-research:competitive-analysis`, `market-sizing`, `market-scan` |
| Proposta de valor, posicionamento inicial | Marketing de produto | Opus, alto | `pm-product-strategy:value-proposition`, `lean-canvas` |
| Especificação, critérios de aceite, tarefas | Gerente de produto + arquiteto | Opus, alto | `openspec-propose`, `superpowers:writing-plans` |
| Métricas de sucesso e painel | Analista de produto | Sonnet, alto | `pm-product-discovery:setup-metrics` |
| Revisão da especificação (contraditor) | Revisor independente | Opus, muito alto | outra sessão, sem ter escrito a especificação |

## 4. Entregas

- Ficha da ideia no registro: palavras do fundador, problema, público, intenção, código.
- Mapa de hipóteses priorizado e o resultado de cada teste.
- Roteiro de entrevista e resumo das conversas (sem dados pessoais identificáveis dos entrevistados).
- Mapa de alternativas e concorrentes.
- Especificação (proposta, desenho, critérios de aceite, fora de escopo, tarefas), com teto de 300 linhas por arquivo.
- Métrica de sucesso com linha de base, alvo e data de medição.
- Estimativa de custo e apetite.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Problema e público escritos em 1 a 3 frases | Seção na especificação ou no README; ausência = falhou | Essencial |
| Especificação anterior ao código | Data do commit da especificação anterior à do primeiro commit de código da ideia | Essencial (média e grande) |
| Critério de aceite verificável em cada tarefa | Caixas de seleção ou "dado/quando/então" em cada tarefa; tarefa sem critério = falhou | Essencial |
| Fora de escopo escrito | Seção presente e não vazia | Essencial |
| Métrica de sucesso com linha de base | Campo preenchido com número e fonte; "não sei" vira tarefa de medir | Recomendado (essencial em produto novo) |
| Validação com pessoas reais | Resumos de entrevistas ou resultado de teste; pergunta guiada "quantas pessoas reais falaram com você?" | Recomendado (essencial em produto novo) |
| Impactos cruzados marcados | Caixas de 05, 10, 11, 12, 13 marcadas ou "não se aplica" com motivo | Essencial |
| Revisão independente da especificação | Registro de revisão por outra sessão ou agente | Recomendado (essencial em sensível) |
| Tamanho da especificação | Até 300 linhas e ~12 KB por arquivo | Recomendado |

## 6. O que o fundador decide

- **Qual problema atacar e para quem.** Recomendação: o problema mais frequente e mais caro do lado difícil do mercado.
- **O que fica de fora.** Recomendação: tudo o que não é necessário para medir a métrica de sucesso.
- **Apetite (quanto tempo e dinheiro vale).** Recomendação: o menor ciclo que gera um resultado medível; nada acima de duas semanas sem uma entrega intermediária.
- **Seguir, mudar ou parar** depois do teste barato. Recomendação: parar quando a hipótese mais arriscada cai; mudar quando o problema existe mas a solução não encaixa.

## 7. Erros de amador que isto evita

- Construir a solução que o fundador imaginou sem confirmar o problema com quem paga.
- Perguntar "você usaria?" e acreditar no "sim".
- Começar a codar sem saber quando termina; "quase pronto" eterno.
- Escopo que cresce em silêncio até a entrega nunca sair.
- Marketplace lançado nos dois lados ao mesmo tempo, sem oferta suficiente, e cliente que pede e ninguém atende.
- Medir curtidas e cadastros em vez de uso que se repete.
- Decisão de produto tomada numa conversa e perdida no dia seguinte.

## 8. Fontes

- [V] GitHub Blog, *Spec-driven development with AI*: https://github.blog/news-insights/product-news/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
- [V] Scrum Guide (Definição de Pronto): https://scrumguides.org/scrum-guide.html
- [V] Basecamp, Shape Up, apetite e disjuntor: https://basecamp.com/shapeup/1.2-chapter-03 e https://basecamp.com/shapeup/2.2-chapter-08
- [V] a16z, glossário de marketplace (liquidez, taxa de atendimento): https://a16z.com/the-marketplace-glossary/
- [V/F] Andrew Chen, *The Cold Start Problem* (rede atômica, lado difícil), via autor e resumos: https://andrewchen.com/solve-a-hard-problem-cold-start-problem/
- [F] Resumo do *Mom Test*: https://mtlynch.io/book-reports/the-mom-test/
- [F] Pesquisa de Sean Ellis, origem e ressalvas: https://justinjackson.ca/product-market-fit-survey e https://learningloop.io/plays/product-market-fit-survey
- [F] AARRR, Dave McClure (2007): https://www.productplan.com/glossary/aarrr-framework
- [F] RICE, ICE e MoSCoW, riscos: https://www.productlift.dev/blog/product-prioritization-framework-comparison/
- [F] Vonage, critério de "pronto para codar": https://developer.vonage.com/en/blog/beyond-vibe-coding-best-practices-2026
