# 13 — Financeiro

Responde, com números do próprio negócio, se cada ideia se paga: quanto custa conquistar e atender um cliente, quanto ele deixa de margem, quando o caixa acaba e qual preço sustenta tudo isso. Inclui impostos no nível que um fundador precisa entender para conversar com o contador, e o controle do gasto variável com IA e infraestrutura.

> **Não é orientação contábil.** Alíquotas, faixas e regras mudam (a reforma tributária está em transição). O sistema faz contas e simulações para o fundador levar ao contador; a decisão e o enquadramento são do contador.

## Sumário

1. Quando entra
2. Economia por unidade
3. Preço
4. Caixa, ponto de equilíbrio e fôlego
5. Impostos em linguagem simples
6. Controle de custos de IA e infraestrutura
7. Rotina financeira
8. Quem faz
9. Entregas e portões
10. O que o fundador decide
11. Erros de amador que isto evita
12. Fontes

## 1. Quando entra

Antes de definir preço, antes de gastar com aquisição, em toda ideia que muda custo por cliente (IA, mensagens pagas, taxa de pagamento) e todo mês, no fechamento.

## 2. Economia por unidade

1. **Definir a unidade** do negócio: pedido atendido, cliente ativo por mês, assinatura [C].
2. **Receita por unidade.** Em marketplace, separar o valor total transacionado (GMV) da receita: a receita é a parte que fica com a plataforma, e a taxa de comissão (*take rate*) é receita dividida pelo GMV; tratar GMV como receita é erro comum [V a16z].
3. **Custos variáveis por unidade:** IA (tokens por pedido), mensagens de WhatsApp por pedido (cobradas por mensagem entregue, por categoria e país), taxa do meio de pagamento, imposto sobre a receita, suporte por pedido, estornos e reembolsos (etapa 07 mede cada um) [V Meta, preços; C].
4. **Margem de contribuição** por unidade = receita − custos variáveis. Margem negativa por unidade não se resolve com volume [C].
5. **Margem bruta** do negócio. Referência de mercado para software por assinatura gira em torno de 75% ou mais, com mediana relatada perto de 77% em 2025 e caindo por causa do custo de computação e IA; em estágio inicial, 50% a 65% é comum [F Benchmarkit e consultorias, via fontes secundárias]. Produto com IA no caminho do cliente precisa medir isso desde o início.
6. **Custo de aquisição de cliente (CAC)** por canal: tudo o que se gastou para conquistar clientes no período (mídia, ferramentas, comissões, horas de vendas) dividido pelos clientes novos daquele canal. Esquecer salários e ferramentas subestima o CAC [C; F alerta de consultorias].
7. **Valor do cliente ao longo da vida (LTV)** calculado com a margem, não com a receita: margem por período × tempo médio de permanência (que vem da retenção da etapa 11) [C].
8. **Referências de David Skok** (*SaaS Metrics 2.0*): os melhores negócios têm LTV acima de 3 vezes o CAC e recuperam o CAC em menos de 12 meses (os líderes em 5 a 7); o próprio autor diz que "são só orientações" e que às vezes faz sentido quebrá-las [V forEntrepreneurs].
9. **Tempo de retorno do CAC** = CAC ÷ (receita mensal por cliente × margem bruta) [F fórmula usada por investidores, via consultorias].

## 3. Preço

10. **Preço pelo valor, não pelo custo:** o teto é o valor que o cliente percebe comparado à alternativa (etapa 10); o piso é o custo variável mais a parte dos custos fixos; o preço fica entre os dois [C].
11. **Pesquisa de sensibilidade de Van Westendorp** (quatro perguntas: caro demais, caro, justo, barato demais) para achar a faixa aceitável; mede percepção, não disposição real a pagar, então é confirmada com teste de comportamento (pré-venda, beta pago, teste A/B real) [F fornecedores de pesquisa; método de 1976].
12. **Estrutura simples** no começo: um ou dois planos ou uma comissão clara; desconto só com motivo e prazo [C] (skills `pm-product-strategy:pricing`, `pricing-strategy`, `monetization-strategy`).
13. **Comissão de marketplace** equilibrada entre os dois lados: alta demais empurra cliente e prestador a negociar por fora (etapa 11) [C].
14. **Mudança de preço** comunicada com antecedência, com o porquê, e respeitando o que foi contratado (etapa 12) [C].

## 4. Caixa, ponto de equilíbrio e fôlego

15. **Separar o dinheiro da empresa do pessoal**; o fundador recebe pró-labore (e, quando houver lucro apurado, distribuição) definido com o contador [C]. No Simples, o sócio recolhe 11% de INSS sobre o pró-labore, fora do DAS, até o teto do INSS (em 2026, R$ 8.475,55, o que limita a contribuição a cerca de R$ 932 por mês); nos Anexos III e V a contribuição patronal já está dentro do DAS, e no Anexo IV ela é paga à parte (uma fonte diverge sobre o Anexo V) [F contabilidades; conferir com o contador].
16. **Fluxo de caixa** das próximas 13 semanas, atualizado toda semana: entradas esperadas (com prazo real de recebimento do meio de pagamento), saídas comprometidas (fornecedores, impostos, pró-labore) e saldo [C].
17. **Ponto de equilíbrio** = custos fixos mensais ÷ margem de contribuição por unidade: quantos pedidos ou clientes por mês pagam a operação [C].
18. **Queima e fôlego:** quanto o caixa diminui por mês e quantos meses faltam até zerar; alerta quando o fôlego cai abaixo de um limiar decidido pelo fundador (por exemplo, 6 meses) [C].
19. **Cenários:** pessimista, provável e otimista para os próximos 12 meses, com as hipóteses escritas (crescimento, retenção, CAC, custo de IA) [C].
20. **Reserva para impostos e imprevistos** separada no caixa [C].

## 5. Impostos em linguagem simples

21. **Simples Nacional para software:** atividades de desenvolvimento costumam cair no Anexo V (começa em 15,5%) ou no Anexo III (começa em 6%), conforme o **Fator R**: se a folha dos últimos 12 meses (salários, pró-labore, 13º, FGTS e contribuição patronal) for 28% ou mais da receita bruta do mesmo período, vale o Anexo III; abaixo disso, o Anexo V. O cálculo é mensal e o anexo pode mudar de um mês para outro (Resolução CGSN 140/2018, art. 26) [F contabilidades; conferir na LC 123/2006 e na Receita]. Um fundador sem folha relevante tende a ficar no Anexo V; o pró-labore muda essa conta, e o contador simula.
22. **Reforma tributária:** em 2026, fase de teste com CBS de 0,9% e IBS de 0,1% destacados para as empresas do regime regular, compensáveis e sem aumento real na maioria dos casos; empresas do Simples estão dispensadas em 2026 e terão, a partir de 2027, a escolha de recolher IBS e CBS dentro ou fora do Simples; a alíquota cheia de referência estimada em 2026 gira em torno de 28% combinada, com crédito amplo sobre compras (nuvem, licenças, mídia); o prazo de opção para 2027 era 30 de setembro, a conferir com o contador [F contabilidades e consultorias; portal oficial da reforma a conferir].
23. **Nota fiscal de serviço** emitida em toda venda; a NFS-e de padrão nacional é obrigatória para os municípios desde 01/01/2026 e a data para cada empresa depende do município e do regime (etapa 12); sistemas que emitem notas precisam acompanhar o leiaute novo [V/F Fenacon; conferir com o contador e o provedor de emissão].
24. **Taxas de quem fica no meio** entram no custo variável: meio de pagamento (Pix, cartão, Pix Automático tarifado para quem recebe) e lojas de aplicativo. Na Apple, o programa de pequenas empresas cobra 15% em vez de 30% até US$ 1 milhão por ano; no Google Play, 15% até US$ 1 milhão por ano, com estrutura dividida em taxa de serviço e de cobrança desde 2026 em alguns mercados [F guias de terceiros; páginas oficiais das lojas a conferir no dia].
25. **Incentivos:** a Lei do Bem exige lucro real, então em geral não alcança quem está no Simples; o enquadramento como startup (LC 182/2021) abre instrumentos de investimento, não desconto automático de imposto [F escritórios; inferência a confirmar].

## 6. Controle de custos de IA e infraestrutura

26. **Orçamento mensal** por provedor e por projeto, com alerta em 80% e pausa educada do não urgente em 100% (etapa 07) [C].
27. **Custo por chamada registrado** (modelo, tokens de entrada e saída, função de negócio), somado por pedido e por cliente; o token é a unidade de custo [V FinOps Foundation].
28. **Escolha do modelo pelo trabalho:** a diferença entre o modelo mais caro e o mais barato chega a 100 vezes; trabalho braçal em modelo barato, decisões em modelo forte (etapa 14) [V Anthropic, preços; V/F Arsenal].
29. **Alavancas:** cache de prompt para contexto repetido (leitura de cache a uma fração do preço normal), lote com desconto para o que pode esperar, limite de tokens por resposta e por usuário, resumo de conversas longas [V Anthropic, preços].
30. **Preços conferidos no dia de orçar:** os de IA mudam em meses (aumentos anunciados e cancelados, promoções que vencem, ferramentas encerradas) [V/F Arsenal].
31. **Infraestrutura:** revisão mensal de planos e ambientes esquecidos; custo por cliente acompanhado quando o volume cresce [C].

## 7. Rotina financeira

32. **Semanal:** fluxo de caixa de 13 semanas e custo de IA da semana.
33. **Mensal:** fechamento com o contador, margem de contribuição, margem bruta, CAC por canal, retenção, ponto de equilíbrio e fôlego; comparação estimado × real das entregas do mês.
34. **Trimestral:** revisão de preço, de comissão e de fornecedores; cenários atualizados.

## 8. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Economia por unidade, cenários, ponto de equilíbrio | Finanças (CFO de bolso) | Opus, alto (dinheiro) | planilha ou `anthropic-skills:xlsx`; `pm-product-strategy:business-model` |
| Preço e pesquisa de preço | Finanças + marketing de produto | Opus, alto | `pm-product-strategy:pricing`, `pricing-strategy`, `monetization-strategy` |
| Simulação de impostos para o contador | Finanças | Opus, alto | tabelas oficiais conferidas no dia |
| Leitura de faturas e custo de IA | Operações | Haiku, baixo; Sonnet, médio para análise | aba Custos do session-map |
| Painel financeiro | Analista | Sonnet, médio | skill `dataviz` |

## 9. Entregas e portões

Entregas: planilha de economia por unidade (receita, custos variáveis, margem, CAC por canal, LTV, retorno), estudo de preço com hipóteses e teste, fluxo de caixa de 13 semanas, ponto de equilíbrio e fôlego, cenários, simulação de impostos para o contador, orçamento de IA e infraestrutura, painel financeiro mensal.

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Margem de contribuição por unidade calculada e positiva | Planilha com fontes de cada custo | Essencial antes de escalar aquisição |
| GMV e receita separados | Painel e relatórios | Essencial em marketplace |
| CAC por canal com custos completos | Planilha × gastos | Recomendado |
| Custo de IA por pedido medido | Registro de uso por chamada | Essencial com IA no caminho do cliente |
| Fluxo de caixa atualizado na semana | Data da última atualização | Essencial |
| Fôlego acima do limiar decidido | Cálculo de queima | Essencial |
| Orçamento com alerta em cada provedor | Atestado + inventário da etapa 07 | Essencial |
| Simulação de impostos revisada pelo contador | Atestado datado | Essencial antes de definir preço |
| Aviso "não é orientação contábil" | Texto em toda entrega | Essencial |

## 10. O que o fundador decide

- **Preço e comissão.** Recomendação: o sistema mostra três opções com margem, ponto de equilíbrio e reação esperada; começar pelo preço que valida margem positiva e ajustar com dados.
- **Quanto investir em aquisição.** Recomendação: só depois da margem positiva por unidade, com teto mensal e CAC alvo.
- **Pró-labore e reserva.** Recomendação: decidido com o contador, considerando o Fator R.
- **Limiar de fôlego** que dispara o alerta. Recomendação: 6 meses.

## 11. Erros de amador que isto evita

- Comemorar o valor transacionado como se fosse receita.
- Vender cada pedido com prejuízo e "ganhar na escala".
- Descobrir no fim do mês que a IA comeu a margem.
- Calcular o custo de aquisição só com mídia e achar que está barato.
- Misturar conta pessoal e da empresa.
- Ficar no anexo mais caro do Simples por não saber do Fator R.
- Descobrir o fim do caixa com um mês de antecedência.

## 12. Fontes

- [V] David Skok, *SaaS Metrics 2.0*: https://www.forentrepreneurs.com/saas-metrics-2/
- [V] a16z, métricas de marketplace (GMV e comissão): https://future.a16z.com/marketplace-metrics
- [F] Margem bruta de software: https://www.cloudzero.com/blog/saas-gross-margin-benchmarks/ ; tempo de retorno do CAC: https://saashero.net/strategy/saas-cac-payback-period/
- [F] Van Westendorp: https://www.koji.so/docs/van-westendorp-price-sensitivity-meter
- [F] Fator R e anexos III e V: https://agilize.com.br/artigos/?p=4180 ; LC 123/2006: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
- [F] Reforma tributária em 2026 e Simples: https://www.contabeis.com.br/noticias/73889/reforma-tributaria-2026-veja-o-que-muda-na-fase-de-transicao/ ; https://www.meucontadoronline.com.br/blog/reforma-tributaria-em-2026/
- [F] Lei do Bem e startups: https://www.pwc.com.br/pt/consultoria-tributaria-societaria/incentivos-fiscais/lei-bem.html
- [V] FinOps for AI: https://finops.org/?p=17411 ; Anthropic, preços: https://platform.claude.com/docs/en/about-claude/pricing
- [V] Meta, preços do WhatsApp: https://developers.facebook.com/docs/whatsapp/pricing
- [F] INSS sobre pró-labore no Simples: https://artigos.agilize.com.br/pro-labore-inss-simples-nacional/
- [F] Taxas das lojas de aplicativo: https://www.revenuecat.com/blog/engineering/small-business-program.md ; https://splitmetrics.com/blog/google-play-apple-app-store-fees/
- [V/F] NFS-e nacional: https://fenacon.org.br/reforma-tributaria/nota-fiscal-de-servico-eletronica-nfs-e-sera-obrigatoria-a-partir-de-janeiro-de-2026/
