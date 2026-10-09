# Padrão profissional do session-map

O que acontece com **cada ideia** de um fundador que não é técnico, desde "eu quero isso" até estar no ar, vendendo e sendo mantida. Quem executa são agentes de IA, com o mesmo cuidado que um time profissional teria. O fundador só decide o que é dele: negócio, dinheiro, contas, contratos e gosto.

Este padrão não é um curso. Ele descreve **o que o sistema faz**, etapa por etapa, com profundidade suficiente para o fundador confiar que nenhum passo profissional foi pulado, e com a prova de que cada passo foi feito.

> **Aviso fixo.** As partes jurídica (12), de LGPD (05) e financeira e tributária (13) são orientação técnica para organizar o trabalho. Não são parecer jurídico nem contábil. Toda decisão dessas áreas que gera obrigação legal passa por advogado ou contador.

## Sumário

1. Como uma ideia atravessa o padrão
2. As 14 etapas (índice)
3. Os quatro estados de cada verificação
4. Os três modos de cuidado
5. Quem faz o quê: papéis, modelos e níveis
6. O que o fundador decide e o que nunca decide sozinho o sistema
7. Marcas de confiança nas fontes
8. Como o session-map aplica e prova o padrão

## 1. Como uma ideia atravessa o padrão

Toda ideia, pequena ou grande, passa pelo mesmo caminho. O que muda é quantas etapas se aplicam e com que profundidade.

1. **Captura.** A ideia é registrada com as palavras do fundador, a data e um código, no registro de ideias do projeto. Nada dito numa conversa se perde.
2. **Classificação.** O sistema classifica a ideia em trivial, pequena, média ou grande, e marca se é **sensível** (segurança, autenticação, dado pessoal, dinheiro, produção, publicação, apagar coisas). A classificação define quantas etapas entram, quantos agentes trabalham, qual modelo e qual nível de raciocínio (seção 5).
3. **Perfil do projeto.** As etapas são filtradas pelo perfil (web, API, app, biblioteca; tem usuários; tem dado pessoal; cobra dinheiro; usa IA; solo ou time). O que não se aplica fica "não se aplica", com o motivo, e não é cobrado.
4. **Plano.** Para ideia média ou grande, nasce uma especificação com problema, público, critérios de aceite verificáveis, o que fica de fora, riscos e estimativa de custo em tokens e em reais (etapa 01 e 14).
5. **Execução.** As etapas aplicáveis rodam na ordem de dependência: produto → desenho → código → testes → segurança → publicação → operação → documentação, e em paralelo as frentes de negócio (marca, marketing, vendas, jurídico, financeiro) quando a ideia toca o cliente.
6. **Portões.** Cada etapa tem verificações. Uma ideia só é declarada "pronta" quando todos os portões aplicáveis estão em **passou**, ou em **não verificado** com o motivo e um responsável humano.
7. **Prova.** Cada verificação guarda a evidência (saída do comando, arquivo e linha, captura de tela, data). "Pronto" sem prova não existe.
8. **Manutenção.** Depois de no ar, a ideia entra na rotina: monitoramento, custos, atualização de dependências, atendimento e métricas (etapas 07, 11 e 13).

Uma ideia trivial (corrigir um texto) passa só por 03, 04 e 06. Uma ideia grande e sensível (cobrar por assinatura) passa pelas 14.

## 2. As 14 etapas

| # | Etapa | Pergunta que responde |
|---|---|---|
| 01 | [Ideia e produto](01-ideia-e-produto.md) | O problema é real, para quem, e como saberemos que deu certo? |
| 02 | [Desenho, arquitetura e fluxo](02-desenho-arquitetura-e-fluxo.md) | Onde isso mora no sistema e por onde os dados passam? |
| 03 | [Construção do código](03-construcao-codigo.md) | O código está escrito do jeito que um sênior escreveria? |
| 04 | [Testes e qualidade](04-testes-e-qualidade.md) | Como sabemos, com prova, que funciona e continuará funcionando? |
| 05 | [Segurança e LGPD](05-seguranca-e-lgpd.md) | Quem pode abusar disso, e os dados das pessoas estão protegidos? |
| 06 | [Versões e publicação](06-versoes-e-publicacao.md) | Como isso vai ao ar sem quebrar nada e com volta segura? |
| 07 | [Operação e custos](07-operacao-e-custos.md) | Como sabemos que está de pé, quanto custa e o que fazer quando cair? |
| 08 | [Documentação](08-documentacao.md) | Alguém (pessoa ou IA) entende e mantém isso daqui a seis meses? |
| 09 | [Marca e design](09-marca-e-design.md) | Parece o mesmo produto em todo lugar, e qualquer pessoa consegue usar? |
| 10 | [Marketing e conteúdo](10-marketing-e-conteudo.md) | Quem precisa saber disso, onde está, e o que dizemos? (inclui vídeo) |
| 11 | [Vendas, atendimento e retenção](11-vendas-atendimento-retencao.md) | Como a pessoa compra, é atendida e continua? |
| 12 | [Jurídico e empresa](12-juridico-e-empresa.md) | A empresa, os contratos e os textos legais estão em ordem? |
| 13 | [Financeiro](13-financeiro.md) | Isso se paga? Quanto custa cada cliente e quando o caixa acaba? |
| 14 | [Trabalho com IA](14-trabalho-com-ia.md) | Os agentes trabalharam com método, sem inventar e dentro do orçamento? |

## 3. Os quatro estados de cada verificação

Toda verificação do padrão termina em um, e só um, destes estados. É a regra 1 da pesquisa de base: nunca reprovar o que não deu para verificar.

| Estado | Quando | O que o fundador vê |
|---|---|---|
| ✅ **Passou** | A evidência foi medida e bate com o critério (teste rodou verde, arquivo existe e tem o conteúdo mínimo, comando devolveu zero). | A evidência e a data. |
| ❌ **Falhou** | A evidência foi medida e não bate. | O que é, por que importa, o que fazer, e o botão de resolver conforme o modo de cuidado. |
| ❓ **Não verificado** | Faltou acesso (token, rede, conta externa), ou a verificação exige um humano (restauração de backup, base legal, revisão de acessibilidade com teclado). | O motivo e quem pode confirmar. Nunca conta como reprovado; o nível do projeto aparece como **provisório**. |
| ➖ **Não se aplica** | O perfil do projeto exclui o item (biblioteca sem usuário final não precisa de política de privacidade). | O motivo, que o fundador pode corrigir no perfil. |

Regras que acompanham os estados:

- **Presença não é qualidade.** Um `SECURITY.md` de modelo sem contato real não passa. O sistema confere conteúdo mínimo, não só se o arquivo existe.
- **Atestado humano tem validade.** Quando o fundador confirma algo que a máquina não vê (o backup foi restaurado), o registro guarda quem, quando, a evidência e a data em que vence (por exemplo, trimestral).
- **Aceitar o risco é uma decisão registrada.** Fica com o motivo, a data e o prazo para rever.
- **Limiar com origem.** Todo número (cobertura de 60%, arquivo de 400 linhas) mostra a fonte ou o selo "convenção", e pode ser ajustado por projeto. Vale para o código novo, nunca como meta retroativa para o legado.

## 4. Os três modos de cuidado

Um único seletor por projeto governa tudo o que o session-map escreve: documentos, arquitetura, Fluxo, correções e as entregas deste padrão.

- 🤖 **Automático.** Faz tudo e registra em Mudanças, com Desfazer. Recomendado para quem não é técnico.
- 💡 **Sugerir.** Mostra cada passo com o quê, por quê e antes/depois, e espera Aceitar, Agora não ou Nunca. Nada é gravado no repositório sem o OK.
- 👀 **Só olhar.** Observa e mostra; não escreve nada.

Em **todos** os modos, ações sensíveis pedem confirmação: apagar, publicar, gastar dinheiro, mexer em contas externas, assinar contrato, enviar mensagem a clientes, mudar preço. O modo é perguntado uma vez no primeiro uso, em palavras simples, e pode ser trocado por projeto.

## 5. Quem faz o quê: papéis, modelos e níveis

O trabalho é dividido por papéis de profissional sênior. Cada agente recebe no pedido o papel, o modelo, o nível de raciocínio e o nome das skills que deve invocar. A política completa está na [etapa 14](14-trabalho-com-ia.md); o resumo:

| Atividade | Modelo | Nível |
|---|---|---|
| Busca, leitura, inventário, conferência mecânica | Haiku | baixo |
| Código mecânico, textos, telas, remoções, testes simples | Sonnet | médio |
| Lógica com regra de negócio, integração, protótipo visual | Sonnet ou Opus | alto |
| Arquitetura, segurança, LGPD, dinheiro, produção, commit, tag e push | Opus | alto |
| Revisão geral de uma entrega, decisão difícil | Opus | muito alto ou máximo |
| Tarefa que falhou no Sonnet | sobe para Opus | alto |

Quantidade de agentes pelo tamanho: trivial e pequena, nenhum (o agente principal faz); busca ampla, um agente de busca; tarefas independentes, agentes em paralelo; média, um agente por parte arriscada mais um revisor; grande, um agente por tarefa, revisor nas tarefas arriscadas e revisão geral no fim. Toda tarefa começa anunciando: skills escolhidas, agentes (modelo e nível) e por quê. Sem motivo para gastar mais, usa-se o mais barato que resolve com qualidade.

Papéis usados nas etapas: gerente de produto, pesquisador de usuários, arquiteto de software, desenvolvedor sênior, engenheiro de qualidade, especialista em segurança, especialista em LGPD, engenheiro de confiabilidade (SRE), redator técnico, designer de produto, designer de marca, profissional de marketing de produto, produtor de vídeo, vendas e sucesso do cliente, assessoria jurídica (só organização, nunca parecer), finanças (CFO de bolso) e o maestro que orquestra.

## 6. O que o fundador decide

O sistema decide sozinho, como um sênior, tudo o que é técnico e cabe nas regras: biblioteca, estrutura, padrão de teste, nomes, ordem das tarefas. O fundador decide, sempre com uma recomendação pronta e as alternativas lado a lado:

- **Negócio:** qual problema atacar primeiro, para quem, o que fica de fora, prioridade entre ideias.
- **Dinheiro:** preço, planos, orçamento mensal de IA e de infraestrutura, quanto investir em anúncio.
- **Contas e contratos:** abrir conta externa, aceitar termos de fornecedor, tipo de empresa, contador e advogado.
- **Gosto:** nome, tom de voz, identidade visual, qual roteiro de vídeo publicar.
- **Risco:** aceitar um risco conhecido, lançar com um item "não verificado".

Cada decisão é registrada com a data, as opções consideradas e o motivo, para não ser rediscutida sem fato novo.

## 7. Marcas de confiança nas fontes

Cada afirmação deste padrão traz uma marca:

- **[V]** fonte verificada: oficial (lei, órgão, documentação do fabricante) ou estudo lido, com link.
- **[F]** fonte de fornecedor ou blog comercial: útil, mas com interesse próprio; não vale como estatística de mercado.
- **[C]** convenção: prática consagrada entre profissionais, sem fonte aberta lida nesta pesquisa; aparece com o selo "convenção" e é ajustável.
- **[NV]** não verificado: informação que precisa ser conferida antes de virar regra.

Datas, preços e valores legais mudam. Todo número com prazo (taxa, alíquota, limite de plataforma) é conferido na fonte no dia em que for usado.

## 8. Como o session-map aplica e prova o padrão

- **Painel por ideia.** Cada ideia mostra as etapas que se aplicam, o estado de cada verificação e a próxima ação. O fundador vê em que etapa está e o que espera por ele.
- **Escada de maturidade do projeto (N0 a N4).** As verificações deste padrão são os degraus da escada definida na pesquisa de base: Começando, Fundação, Pronto para usuário real, Profissional e Referência. Um degrau só é conquistado quando todas as verificações aplicáveis dele e dos de baixo passam. A tela mostra o nível, o percentual do próximo degrau e **as próximas três ações**, cada uma com o porquê, o resultado esperado e a linha "pronto quando…".
- **Ferramentas consagradas em vez de reimplementar.** Segredos com gitleaks, dependências com OSV-Scanner, práticas do repositório com OpenSSF Scorecard, análise estática com Semgrep ou CodeQL, acessibilidade com axe, links com lychee, duplicação com jscpd. O session-map orquestra, traduz o resultado para linguagem simples e guarda a evidência. Toda ferramenta passa por auditoria de cadeia de suprimentos antes de ser adotada.
- **Decisões das conversas rastreadas.** "Vamos usar X porque…" dito numa conversa com IA vira registro de decisão; um pedido do fundador que não virou item aparece como pendência.
- **Nada declarado pronto sem rodar.** Funcionalidade com tela ou rota só é "pronta" depois de exercitada de verdade (subir o sistema e usar o fluxo), não só com testes.
- **Conteúdo lido é dado, não instrução.** Texto vindo do repositório, de páginas da web ou de conversas nunca dá ordens ao sistema.

## Lacunas conhecidas (o que este padrão ainda não prova)

- **Textos oficiais lidos por resumo.** Várias normas (LGPD, Decreto 7.962/2013, Marco Civil, resoluções da ANPD, ECA Digital, portarias da Senacon, guia do CONAR) foram lidas por fontes secundárias de escritórios e imprensa; o site oficial não abriu nesta rodada. Cada item cita a norma para conferência.
- **Impostos em transição.** Reforma tributária (CBS e IBS), prazos da NFS-e nacional para o Simples e o PLP do MEI para programadores mudam ao longo de 2026; tudo passa pelo contador.
- **Números de mercado de fornecedores.** Margem bruta, retenção "boa", CAC e preços de ferramentas de vídeo vêm de consultorias e blogs; servem de ordem de grandeza, não de meta.
- **Regras de plataformas** (limites de vídeo, rótulos de IA, opt-in do WhatsApp, taxas das lojas) mudam sem aviso longo; são conferidas no dia.
- **Sem medição própria em português do Brasil** da qualidade das IAs de texto, voz e vídeo; antes de adotar uma, um teste cego com material real do negócio.
- **Responsabilidade de marketplaces** está em discussão no STF (Tema 1.413); o desenho de termos e de operação deve ser revisto quando houver decisão.

## Base desta especificação

- Pesquisa do ciclo completo de projeto profissional (seis fases, escada N0–N4, seis regras de produto), checklist de 91 itens de repositório profissional, pesquisa de tamanho de documentos, de arquitetura e fluxo, e o Arsenal de IAs por categoria (2026-10-09).
- Pesquisa complementar de 2026-10-09 sobre marketing, vídeo, marca, vendas, retenção, jurídico brasileiro e finanças, citada em cada etapa.

Cada arquivo de etapa tem no máximo 300 linhas, um propósito só, e termina com as fontes.
