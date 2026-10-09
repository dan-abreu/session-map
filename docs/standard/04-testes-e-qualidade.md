# 04 — Testes e qualidade

Prova, com evidência que qualquer pessoa pode repetir, que a ideia funciona hoje e continuará funcionando amanhã. Cobre testes automáticos, uso real do sistema, acessibilidade, desempenho, texto e, quando o produto usa IA, a qualidade das respostas da IA.

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

Em toda mudança de comportamento. A profundidade cresce com o risco: texto muda só a revisão de texto; regra de dinheiro ganha teste de mutação; fluxo crítico ganha teste de ponta a ponta e roteiro manual.

## 2. O que é feito, passo a passo

### 2.1 Estratégia de testes por camada

1. **Camadas misturadas.** Muitos testes baratos na base (unitários da lógica pura), testes de integração nas fronteiras (rota com banco simulado ou real de teste, adaptador com simulador do fornecedor) e poucos de ponta a ponta no topo. Pirâmide e troféu concordam no essencial: evitar o "cone de sorvete" de muitos testes de tela, lentos e frágeis [V Martin Fowler; V Kent C. Dodds].
2. **Pergunta útil**, mais que proporção: o fluxo crítico tem teste de ponta a ponta e verificação rápida depois de publicar? [inferência da pesquisa de base].
3. **Cada teste com três casos mínimos:** o caminho feliz, os casos de borda listados na especificação (vazio, zero, limite, repetido, concorrente) e o erro principal.
4. **Testes que falham se a lógica quebrar.** Teste que passa com a função apagada não vale. Verificado por mutação nas regras críticas (passo 9).
5. **Dados de teste** criados pelo próprio teste, sem depender de ordem nem de dados reais de clientes; nunca usar cópia do banco de produção em máquina sem proteção.

### 2.2 Portões automáticos

6. **CI em toda mudança** rodando testes, tipos, lint e build, e marcado como verificação obrigatória para o merge; o portão só vale se bloquear [V GitHub, branch protegida].
7. **Cobertura do código novo**, não meta retroativa: faixas do Google de 60% aceitável, 75% louvável, 90% exemplar, com o aviso de que não há número ideal e de que a meta pode virar caixa de seleção [V Google Testing Blog].
8. **Testes instáveis medidos.** O Google achou instabilidade em cerca de 16% dos testes, mais frequente quanto maior o teste; tentativas automáticas escondem o problema. Teste instável vira item com dono, não "roda de novo" [V Google Testing Blog 2016 e 2017; V Playwright].
9. **Teste de mutação** (Stryker) nas regras de dinheiro, permissão e cálculo: o sistema introduz defeitos de propósito e mede quantos os testes pegam [V Stryker].
10. **Ordem aleatória e paralelo:** a suíte passa embaralhada, revelando dependência escondida entre testes [C].
11. **Suíte pesada sem travar a máquina:** rodar por pacote com número de processos limitado quando a suíte satura o computador [C].

### 2.3 Usar o sistema de verdade

12. **Nada é pronto sem ser exercitado.** Funcionalidade com tela ou rota é aberta e usada: subir o sistema, clicar no fluxo ou chamar a rota, conferir o resultado no banco e nos registros. Testes verdes não bastam [C, regra do projeto].
13. **Ponta a ponta do fluxo crítico** com Playwright (Apache-2.0): navegador real, inclusive tamanho de celular; gravação de rastro para entender falhas [V Playwright].
14. **Roteiro manual dos 5 fluxos críticos** executado antes de cada publicação, com a data da última execução registrada [C].
15. **Teste exploratório** com o papel do usuário mais impaciente: desistir no meio, voltar, recarregar, clicar duas vezes, internet lenta, telefone com fonte grande.
16. **Teste de fumaça depois de publicar:** a página inicial abre, o login funciona, `/health` responde (detalhe na etapa 06) [C].

### 2.4 Qualidade que o cliente sente

17. **Acessibilidade automática** com axe (`@axe-core/playwright` ou `jest-axe`) e **revisão manual com teclado e leitor de tela**. O fabricante do axe afirma que a automação pega cerca de 57% dos problemas, estudo próprio sem replicação; por isso "axe verde" é exibido como "sem falhas automáticas; falta revisão manual", nunca como "acessível" [V axe-core; F Deque].
18. **WCAG 2.2 nível AA:** contraste de texto de pelo menos 4,5:1 (3:1 para texto grande), alvos de toque de pelo menos 24 × 24 px, foco visível e não escondido por cabeçalho fixo [V W3C].
19. **Core Web Vitals** no site público, no percentil 75: LCP até 2,5 s, INP até 200 ms, CLS até 0,1, medidos com Lighthouse CI no laboratório e com dados de campo quando houver [V web.dev].
20. **Responsivo e multinavegador:** celular, tablet e computador; os navegadores do público (Chrome no Android domina no Brasil, conferir com a analítica do produto) [C].
21. **Estados de tela:** vazio, carregando, erro, sem permissão, sem internet; cada um com texto que diz o que aconteceu e o que fazer [C].
22. **Inspeção minuciosa do texto e da interface** com a persona "a pessoa chata que vê tudo": ortografia, vírgula, acento, idioma misturado, nome inconsistente, texto cortado, botão sem rótulo, desalinhamento; achados graves passam por segunda conferência antes de aparecer; o inspetor nunca declara "limpo" sem listar o que conferiu e repete rodadas até uma sem achados [C, princípio do produto].
23. **Textos de interface** nunca prometem o que o sistema não faz e usam a fonte única de textos do projeto quando existir.

### 2.5 Carga e resiliência

24. **Teste de carga** antes de campanha ou lançamento (k6 ou Artillery): encontra o ponto de quebra e o custo por usuário sob carga [C].
25. **Falha de fornecedor simulada:** o que acontece quando o WhatsApp, o pagamento ou a IA não respondem; o produto mostra uma mensagem útil e não perde o pedido.

### 2.6 Quando o produto usa IA

26. **Critérios de sucesso mensuráveis** definidos antes de montar a avaliação (por exemplo, "classifica a categoria certa em 90% dos casos do conjunto de teste") [V Anthropic, critérios de sucesso].
27. **Conjunto fixo de casos** (*golden dataset*) com respostas esperadas, incluindo golpes, pedidos perigosos, gírias e regionalismos do público, rodado a cada mudança de instrução (prompt) ou de modelo, com nota mínima como portão [V Anthropic, avaliações de agentes].
28. **Avaliação por avaliador independente** quando a resposta é aberta: outro modelo ou rubrica escrita, com amostra conferida por humano.
29. **Regressão de custo:** o mesmo conjunto mede tokens por caso; uma mudança que dobra o custo sem ganho é barrada.

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Testes unitários e de integração | Desenvolvedor | Sonnet, médio | `superpowers:test-driven-development` |
| Ponta a ponta e roteiro manual | Engenheiro de qualidade | Sonnet, alto | Playwright, skill `run` para subir e usar o sistema |
| Mutação e casos críticos | Engenheiro de qualidade sênior | Opus, alto | Stryker |
| Acessibilidade e Web Vitals | Designer de produto + qualidade | Sonnet, alto | axe-core, Lighthouse CI, skill `impeccable:impeccable` (auditoria) |
| Inspeção de texto e interface | Inspetor "pessoa chata" | Sonnet, alto; graves revistos por Opus | captura de tela, leitura linha a linha |
| Avaliação de IA | Engenheiro de IA | Opus, alto (montagem); Haiku ou Sonnet para rodar | conjunto de casos, rubrica |
| Verificação final antes de declarar pronto | Maestro | Opus, alto | `superpowers:verification-before-completion` |

## 4. Entregas

- Testes no repositório, junto do código que testam.
- Saída de cada portão (testes, cobertura do código novo, acessibilidade, Web Vitals) com data.
- Registro de uso real: comandos, capturas de tela ou gravação do fluxo, e o que foi conferido.
- Roteiro manual dos fluxos críticos com a data da última execução.
- Lista de achados da inspeção, por gravidade, com o que foi corrigido.
- Para IA: conjunto de casos, nota obtida e custo por caso.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| CI roda testes, tipos, lint e build e é obrigatório | Arquivos de workflow e lista de verificações obrigatórias (API) | Essencial |
| Todos os testes verdes | Saída dos comandos | Essencial |
| Fluxo crítico com teste de ponta a ponta | Teste presente e verde para cada fluxo marcado como crítico | Recomendado (essencial em produto com usuários) |
| Exercitado de verdade | Registro de uso real anexado à entrega | Essencial em tela ou rota |
| Cobertura do código novo no limiar escolhido | Relatório de cobertura do diff | Recomendado |
| Sem teste instável conhecido sem dono | Histórico do mesmo commit passando e falhando; `.only` e `.skip` | Essencial se existir |
| Mutação nas regras críticas acima do limiar | Relatório do Stryker | Avançado (recomendado em dinheiro) |
| Acessibilidade: axe sem falhas e revisão manual datada | Relatório do axe + roteiro manual com data | Essencial em tela |
| Web Vitals dentro das metas | Lighthouse CI; dados de campo quando houver | Recomendado em site público |
| Inspeção sem achado grave aberto | Lista da inspeção | Essencial |
| Avaliação de IA acima da nota mínima | Relatório do conjunto de casos | Essencial em produto com IA |
| Teste de carga antes de campanha | Relatório datado | Avançado (recomendado antes de lançamento) |

## 6. O que o fundador decide

- **Quais são os fluxos críticos** (os que, se quebrarem, param o negócio). Recomendação: pedir, pagar, receber, entrar na conta, falar com o suporte.
- **Nota mínima da IA** e o que fazer abaixo dela. Recomendação: abaixo da nota, a IA passa o caso a um humano.
- **Lançar com um item "não verificado"** (por exemplo, revisão com leitor de tela ainda não feita). Recomendação: só com data marcada para fechar.

## 7. Erros de amador que isto evita

- "Os testes passaram" sem ninguém ter aberto a tela.
- Teste que passa mesmo com a lógica apagada.
- Rodar de novo o teste que falha às vezes até ele passar.
- Selo de "acessível" porque uma ferramenta automática não achou nada.
- Site lento no celular do cliente e rápido só no computador do desenvolvedor.
- Trocar o modelo de IA e descobrir pelo cliente que as respostas pioraram.
- Erro de português na tela de pagamento.

## 8. Fontes

- [V] Martin Fowler, pirâmide prática: https://martinfowler.com/articles/practical-test-pyramid.html ; Kent C. Dodds, troféu: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- [V] Google Testing Blog, cobertura: https://testing.googleblog.com/2020/08/code-coverage-best-practices.html ; instabilidade: https://testing.googleblog.com/2016/05/ e https://testing.googleblog.com/2017/04/
- [V] Playwright, rastro: https://playwright.dev/docs/trace-viewer-intro
- [V] Stryker: https://stryker-mutator.io/blog/announcing-100-mode/
- [V] axe-core: https://github.com/dequelabs/axe-core ; [F] Deque, 57%: https://devops.com/deque-study-shows-its-automated-testing-identifies-57-percent-of-digital-accessibility-issues-surpassing-accepted-industry-benchmarks/
- [V] W3C, novidades da WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ ; contraste mínimo: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- [V] web.dev, limiares de Core Web Vitals: https://web.dev/articles/defining-core-web-vitals-thresholds
- [V] Anthropic, critérios de sucesso: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests.md ; avaliações de agentes: https://anthropic.com/engineering/demystifying-evals-for-ai-agents
- [V] GitHub, verificações obrigatórias: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
