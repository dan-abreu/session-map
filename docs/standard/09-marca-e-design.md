# 09 — Marca e design

Faz o produto parecer o mesmo em todo lugar (app, site, WhatsApp, vídeo, nota fiscal) e ser fácil para qualquer pessoa usar, inclusive quem tem baixa visão, celular antigo ou pouca familiaridade com tecnologia. Marca é decisão de gosto do fundador; o sistema prepara as opções, protege a consistência e verifica a acessibilidade.

## Sumário

1. Quando entra
2. Marca: o que é feito
3. Sistema de design: o que é feito
4. Experiência de uso: o que é feito
5. Quem faz
6. Entregas
7. Portões
8. O que o fundador decide
9. Erros de amador que isto evita
10. Fontes

## 1. Quando entra

A marca, uma vez no começo e em revisões raras. O sistema de design, quando nasce a primeira tela e sempre que uma tela nova precisa de algo que ele não tem. A experiência de uso, em toda ideia que muda o que o cliente vê.

## 2. Marca: o que é feito

1. **Partir do posicionamento** (etapa 10): para quem, contra quais alternativas, qual valor. A marca expressa o posicionamento; não o substitui [C].
2. **Personalidade e tom de voz** em 3 a 5 traços com "é / não é" (por exemplo, "próximo, não íntimo"; "direto, não seco"), exemplos de frases certas e erradas e um glossário de palavras proibidas ou preferidas [C].
3. **Nome:** lista curta de candidatos avaliada por pronúncia, grafia ao ouvir, significado em português e em gírias regionais, disponibilidade de domínio (registro.br para `.com.br`), de perfis nas redes e **busca de anterioridade no INPI** nas classes do negócio (por exemplo, 9 para software como produto, 42 para serviço de software, 35 para intermediação e publicidade) [V INPI, guia básico de marcas; classes a confirmar com o advogado ou agente de propriedade industrial].
4. **Registro da marca no INPI** antes de investir pesado em divulgação (etapa 12): desde 20/09/2025 a taxa é única na entrada e cobre a concessão e os primeiros 10 anos; há desconto para ME, EPP e MEI; especificação pré-aprovada custa metade da livre [F blogs de contabilidade; conferir a tabela oficial do INPI no dia].
5. **Logotipo** com versões: principal, horizontal, só símbolo, monocromática, negativa (fundo escuro), tamanho mínimo, área de respiro; ícone de app e favicon legíveis em 16 × 16 px; arquivos vetoriais (SVG) e exportações em PNG [C].
6. **Paleta de cores** com papel de cada cor (primária, de ação, de alerta, neutros), cada combinação de texto e fundo conferida para contraste de pelo menos 4,5:1 (3:1 para texto grande) [V W3C, WCAG 2.2].
7. **Tipografia** com licença que permite uso comercial e embutir no app (fontes com licença OFL, por exemplo), pesos definidos e tamanhos mínimos legíveis no celular [C].
8. **Imagens e ilustrações:** regras de foto (pessoas reais da região, luz natural, sem banco de imagem genérico), de ícones (um só estilo) e de uso de IA [C].
9. **Imagens geradas por IA** só de fornecedor cuja licença permite uso comercial; várias licenças abertas proíbem (FLUX dev, Qwen-Image, RMBG); marca d'água invisível do fornecedor não é removida; logotipo feito com IA passa pela busca no INPI como qualquer outro [V/F Arsenal de IAs, seção de imagem].
10. **Manual de marca** de uma a três páginas com tudo acima e exemplos de aplicação: perfil das redes, assinatura de e-mail, mensagem de WhatsApp, cartão, uniforme, adesivo [C].
11. **Kit de marca nas ferramentas** (por exemplo, o kit de marca do Canva, que o Claude acessa por conector) para que toda peça nasça com as cores, fontes e logotipo certos [F Canva].

## 3. Sistema de design: o que é feito

12. **Fichas de design (design tokens)** como fonte única de cor, tipografia, espaçamento, raio, sombra e movimento, no formato estável do grupo da W3C (versão 2025.10, primeira estável, publicada em 28/10/2025; não é norma W3C oficial) e convertidas para CSS e app com Style Dictionary [V W3C Design Tokens Community Group].
13. **Componentes** reutilizáveis (botão, campo, cartão, aviso, lista, modal) com todos os estados: normal, foco, pressionado, desabilitado, carregando, erro, vazio [C].
14. **Catálogo vivo de componentes** (Storybook ou página de demonstração) com cada estado visível; uma tela nova só usa componente do catálogo ou cria um novo nele [C].
15. **Fonte única de textos** da interface: nada de texto solto em cada tela; facilita revisão, tradução e tom de voz [C].
16. **Tema claro e escuro** quando o público usa, a partir das mesmas fichas [C].
17. **Movimento com propósito** e respeito a "reduzir movimento" do sistema operacional [C, WCAG].
18. **Registro do sistema de design** (DESIGN.md ou equivalente) gerado do que foi entregue, não das intenções [C, skill `impeccable`].

## 4. Experiência de uso: o que é feito

19. **Jornada antes da tela:** o caminho do cliente de ponta a ponta, onde ele hesita, desiste ou precisa de ajuda; o designer veste o papel do cliente impaciente e do prestador ocupado [C].
20. **Rascunho → protótipo → teste:** rascunho de baixa fidelidade para decidir a estrutura; protótipo clicável para testar; só então a tela final. Testes qualitativos curtos com cerca de 5 pessoas reais do público, repetidos a cada versão, encontram a maior parte dos problemas; mais pessoas num só teste rendem pouco, e o melhor é fazer vários testes pequenos. A regra vale para teste qualitativo, não para medir números [V Nielsen Norman Group].
21. **Primeiro uso (onboarding)** com o menor número de passos até o primeiro valor ("pedido feito"), pedindo dado só quando for necessário [C].
22. **Estados de cada tela:** vazio que ensina o próximo passo, carregando com indicação de progresso, erro que diz o que aconteceu e como resolver, sem permissão, sem internet [C].
23. **Textos de interface (microcopy):** verbo no botão ("Pedir orçamento", não "Enviar"), mensagens de erro sem culpar o usuário, nada prometido que o sistema não faz [C].
24. **Formulários:** campo com rótulo visível, tipo de teclado certo no celular (`type="tel"`, `inputmode="numeric"`), validação ao sair do campo, erro ao lado do campo [C; recursos nativos da plataforma antes de JavaScript].
25. **Acessibilidade desde o desenho:** ordem de foco, alvos de toque de pelo menos 24 × 24 px, informação nunca só por cor, texto alternativo em imagens, leitura por leitor de tela (etapa 04) [V W3C, WCAG 2.2].
26. **Celular primeiro** e conexões lentas: imagens otimizadas, nada pesado no carregamento inicial, Core Web Vitals na meta (etapa 04) [V web.dev].
27. **Revisão de design** da tela pronta contra o protótipo aprovado e contra a barra de qualidade escolhida, com lista ordenada de correções [C, skill `impeccable`].

## 5. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Personalidade, tom, nome (opções) | Designer de marca + marketing | Opus, alto | `pm-product-strategy:product-vision`, busca INPI e registro.br |
| Logotipo, paleta, peças | Designer de marca | Sonnet, alto | conector do Canva (kit de marca), geradores de imagem com licença comercial (Arsenal) |
| Fichas e componentes | Designer de produto + desenvolvedor | Sonnet, alto | Style Dictionary, Storybook, Penpot ou Figma |
| Jornada, protótipo, telas | Designer de produto | Sonnet ou Opus, alto | skill `impeccable:impeccable` (desenhar, criticar, auditar, polir) |
| Teste com usuários | Pesquisador de usuários | Sonnet, médio | `pm-market-research:customer-journey-map`, roteiro de teste |
| Revisão final de design | Revisor de design | Opus, alto | agente `impeccable-finish-reviewer` |

## 6. Entregas

- Manual de marca (personalidade, tom, logotipo, cores, tipos, imagens, exemplos).
- Arquivos do logotipo em todas as versões e tamanhos; favicon e ícone de app.
- Resultado da busca de anterioridade e protocolo do pedido no INPI (etapa 12).
- Fichas de design e catálogo de componentes com todos os estados.
- Fonte única de textos da interface.
- Jornada, protótipo, notas dos testes com usuários e telas finais.
- Relatório de revisão de design e de acessibilidade.

## 7. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Contraste de todas as combinações de texto e fundo | Cálculo sobre as fichas de cor; axe nas telas | Essencial |
| Cores, fontes e espaçamentos só das fichas | Busca por valores soltos (hexadecimais, px) fora das fichas | Recomendado |
| Componente com todos os estados no catálogo | Catálogo × lista de estados | Recomendado |
| Toda tela com estados vazio, carregando e erro | Inspeção das telas e testes | Essencial em tela nova |
| Textos da interface na fonte única | Busca de texto solto nos componentes | Recomendado |
| Licença comercial de fontes e imagens | Registro da origem e licença de cada ativo | Essencial |
| Busca de anterioridade da marca feita | Relatório datado | Essencial antes de lançar |
| Teste com usuários reais na jornada principal | Notas datadas | Recomendado (essencial em produto novo) |
| Alvos de toque e foco visível | axe + revisão manual | Essencial |

## 8. O que o fundador decide

- **Nome, logotipo, cores e tom de voz** (gosto). Recomendação: duas ou três opções completas lado a lado, aplicadas em peças reais (tela, perfil, mensagem), não soltas.
- **Registrar a marca e em quais classes.** Recomendação: registrar antes de investir em divulgação, com orientação de especialista na escolha das classes.
- **Aprovar o protótipo** antes da tela final. Recomendação: aprovar só depois de ver alguém do público usando.

## 9. Erros de amador que isto evita

- Logotipo ilegível no tamanho de um ícone de celular.
- Descobrir depois do lançamento que o nome já é marca registrada de outro.
- Cinco tons de azul diferentes no mesmo app.
- Texto cinza claro sobre branco que metade dos clientes não consegue ler.
- Tela linda que trava no celular de entrada com internet ruim.
- Imagem de IA usada em anúncio com licença que proíbe uso comercial.

## 10. Fontes

- [V] W3C, Design Tokens Format Module 2025.10: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/ ; anúncio: https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- [V] W3C, WCAG 2.2 (contraste e alvos de toque): https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- [V] web.dev, Core Web Vitals: https://web.dev/articles/defining-core-web-vitals-thresholds
- [V] Nielsen Norman Group, testar com 5 usuários: https://nngroup.com/articles/why-you-only-need-to-test-with-5-users/
- [V] INPI, guia básico de marcas: https://www.gov.br/inpi/pt-br/servicos/marcas/arquivos/guia-basico/Guiabsicodemarcas.pdf
- [F] Taxas do INPI desde 09/2025 (conferir na tabela oficial): https://contaja.com.br/blog/quanto-custa-registrar-uma-marca/
- [V/F] Arsenal de IAs por categoria, seção de imagem e licenças (pesquisa interna, 2026-10-09).
- Ferramentas: Style Dictionary https://github.com/style-dictionary/style-dictionary ; Storybook https://storybook.js.org ; Penpot https://penpot.app (licenças conferidas na adoção).
