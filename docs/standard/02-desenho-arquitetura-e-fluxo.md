# 02 — Desenho, arquitetura e fluxo

Decide onde a ideia mora no sistema, por onde os dados passam, o que muda no banco e quais decisões caras precisam ficar registradas. Tudo é desenhado a partir do código real, nunca da memória da IA, e cada caixa e cada seta apontam para arquivos que existem.

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

Em toda ideia média ou grande, e em qualquer ideia que crie uma tela, rota, tabela, fila, integração externa ou papel de usuário novo. Ideia pequena só confere que não quebra uma regra de arquitetura.

## 2. O que é feito, passo a passo

### 2.1 Ler o que existe, com fatos

1. **Fatos antes de opinião.** Inventário determinístico do que a ideia toca: arquivos, rotas, telas, tabelas, filas, variáveis de ambiente (só nomes) e integrações, cada um com arquivo e linha. A IA recebe a lista; não a descobre de memória (regras de anti-alucinação da fundação, etapa 14).
2. **Grafo real de dependências** quando o projeto é JavaScript ou TypeScript: dependency-cruiser (MIT) mostra quem importa quem e permite regras "proibido" (por exemplo, a camada de regras puras não pode importar o banco) [V repositório do projeto].
3. **Regras de arquitetura do projeto** lidas do arquivo de instruções e dos registros de decisão (por exemplo, arquitetura em camadas onde a dependência só desce; lógica de negócio pura, sem acesso a rede ou banco; fornecedores externos só por adaptadores).

### 2.2 Desenhar em níveis (zoom)

4. **Contexto (nível 1):** quem usa (atores) e os sistemas de fora (WhatsApp, pagamentos, e-mail, IA), 5 a 10 caixas. A ideia nova aparece como seta nova ou ator novo.
5. **Partes (nível 2, contêineres):** apps, serviços, banco, filas; setas com rótulo em linguagem simples ("envia pedido") e a tecnologia.
6. **Detalhe da parte (nível 3, componentes):** módulos que mudam, só da parte afetada.
7. **Jornadas:** 3 a 6 fluxos de ponta a ponta afetados ("cliente pede serviço"), com passos numerados, cada passo apontando para uma parte do mapa.
8. Um **modelo único** gera todas as vistas; o diagrama nunca é o dado. Vocabulário do C4 (sistema, contêiner, componente, relação, vista dinâmica) como formato; Mermaid só para desenhar [V c4model.com; pesquisa de arquitetura e fluxo].
9. Cada nó e seta leva a origem: **extraído do código**, **inferido pela IA** ou **ambíguo**, com arquivo e linha. Inferência sem citação que resolva é descartada.

### 2.3 Decidir o desenho

10. **Onde a lógica mora.** Regra de negócio em código puro e testável; rotas e telas só orquestram (carregam dados, chamam a regra, gravam, disparam o adaptador). Erro esperado como resultado tipado; exceção só para bug.
11. **Estados como união discriminada** (cada estado com seus dados), não como várias marcações verdadeiro/falso: o compilador obriga a tratar cada caso [C, regra de estilo].
12. **Modelo de dados.** Tabelas e colunas novas, quem é dono de cada dado, o que é nulo e por quê, índices para as consultas que vão existir, e **marcação dos campos pessoais** (alimenta o inventário de dados da etapa 05).
13. **Mudança de banco segura.** Mudança destrutiva (apagar ou renomear coluna) segue "expandir, migrar, contrair" em releases separadas, porque reverter o aplicativo não desfaz a migração; só o último passo é irreversível [V fonte secundária DEV Community; V Railway sobre rollback].
14. **Contratos de fronteira.** Toda entrada externa (rota, webhook, variável de ambiente, resposta de IA) validada por esquema na fronteira; o interior confia no tipo derivado [C].
15. **Integrações externas.** Cada fornecedor atrás de um contrato e de um simulador determinístico para testes; tempo limite, novas tentativas com espera crescente, idempotência (a mesma mensagem recebida duas vezes não cria dois pedidos) e o que acontece quando o fornecedor cai [C].
16. **Permissões e papéis.** Quem pode ver e fazer o quê, por papel **e por dono do objeto** (um cliente nunca acessa o pedido de outro só trocando o número na URL). Falha de controle de acesso é o risco nº 1 do OWASP Top 10:2025 [V].
17. **Modelo de ameaças de uma página** para ideia sensível: diagrama de fluxo de dados e a lente STRIDE (falsificação, adulteração, repúdio, vazamento, negação de serviço, elevação de privilégio) em cada seta que cruza uma fronteira de confiança; "pense como um golpista" (detalhe na etapa 05) [V Threat Modeling Manifesto, via memória, conferir].
18. **Custo de operar** estimado: chamadas de IA por pedido, mensagens de WhatsApp por fluxo, armazenamento, para a etapa 13 saber o custo por cliente antes de construir.
19. **Escala honesta.** Atalho com teto conhecido (lista em memória, varredura completa) é aceito com um comentário dizendo o teto e quando evoluir [C, regra de economia].

### 2.4 Registrar as decisões caras

20. **Registro de decisão de arquitetura (ADR)** para cada decisão cara de desfazer: contexto, opções, decisão, consequências; uma por arquivo, datada, **imutável**; para mudar, nova decisão que substitui a antiga. Não escrever para decisões pequenas ou temporárias [V adr.github.io; V boas práticas de Joel Parker Henderson].
21. **Decisões ditas em conversa** ("vamos usar X em vez de Y porque…") são mineradas das transcrições e propostas como ADR ou linha no arquivo de instruções; é o diferencial do session-map [C, inferência da pesquisa de base].

### 2.5 Conferir o desenho contra o código

22. Toda parte e caixa citada aponta para caminhos que existem; todo arquivo novo previsto tem uma parte dona. Arquivo sem dono aparece em vermelho.
23. O documento de arquitetura aponta o código por **caminho e símbolo** (`arquivo#nome`), nunca por número de linha fixo, que envelhece.
24. Revisão do desenho por um segundo agente que não o escreveu (arquiteto contraditor), com foco em: acoplamento, ponto único de falha, dado pessoal, custo e reversibilidade.

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Inventário e grafo | Leitor de código | Haiku, baixo | censo do session-map, dependency-cruiser (opcional) |
| Desenho, modelo de dados, decisões | Arquiteto de software | Opus, alto | `superpowers:brainstorming`, `openspec-propose` (desenho) |
| Modelo de ameaças | Especialista em segurança | Opus, alto | `audit-context-building:audit-context` em código existente |
| Diagramas a partir do modelo | Redator técnico | Sonnet, médio | Mermaid como renderizador; LikeC4 como exportação opcional |
| Revisão do desenho | Arquiteto revisor | Opus, muito alto | outra sessão |

## 4. Entregas

- Trecho do modelo (partes, relações, jornadas) com origem e evidência por item.
- Vistas: contexto, partes, detalhe da parte afetada, jornadas afetadas.
- Desenho técnico na especificação: onde a lógica mora, estados, contratos, integrações, papéis.
- Plano de migração de banco (com expandir, migrar, contrair quando destrutiva).
- ADRs novas, numeradas.
- Modelo de ameaças de uma página (ideia sensível).
- Estimativa de custo de operar por unidade (pedido, cliente, mensagem).

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Nenhuma regra de importação violada | dependency-cruiser com regras "proibido", ou leitura dos imports pelo censo | Essencial |
| Toda caixa e seta com evidência que resolve | Conferidor abre arquivo e símbolo; sem prova = removida | Essencial |
| Todo arquivo novo com parte dona | Censo × partes; órfão = falhou | Essencial |
| Migração destrutiva em duas releases | `DROP` ou `RENAME` na mesma release do código que deixa de usar a coluna = falhou | Essencial com dados reais |
| Autorização por dono do objeto prevista | Rotas com identificador sem filtro por dono; teste de acesso cruzado planejado | Essencial (web) |
| ADR para decisão cara | Decisão marcada como cara sem ADR; decisão dita em conversa sem registro | Recomendado (essencial em time) |
| Modelo de ameaças em ideia sensível | Arquivo presente e datado | Recomendado |
| Custo de operar estimado | Campo na especificação | Recomendado (essencial com IA ou mensagens pagas) |

## 6. O que o fundador decide

- **Trocar um fornecedor ou abrir conta nova** (pagamento, mensagens, IA). Recomendação: o que já está em uso, salvo motivo forte; nunca plano gratuito que treina com dados de cliente.
- **Aceitar um limite conhecido** (por exemplo, atender só uma cidade no começo). Recomendação: aceitar, com o teto escrito e o gatilho para evoluir.
- **Dados que o produto vai guardar.** Recomendação: o mínimo necessário para a finalidade; em dúvida, não guardar.

As escolhas técnicas (biblioteca, padrão, estrutura de pastas) o sistema decide sozinho e registra.

## 7. Erros de amador que isto evita

- Lógica de negócio espalhada nas telas e rotas, impossível de testar.
- Diagrama bonito que não corresponde ao código, ou que a IA inventou.
- Apagar uma coluna no mesmo dia em que o código para de usá-la e não conseguir voltar atrás.
- Cliente que vê o pedido de outro trocando um número na URL.
- Fornecedor externo que cai e derruba o produto inteiro, ou que cobra duas vezes porque a mesma mensagem chegou duas vezes.
- A mesma discussão de arquitetura refeita a cada mês porque ninguém registrou o porquê.

## 8. Fontes

- [V] Modelo C4: https://c4model.com/ ; arc42: https://arc42.org/overview
- [V] ADR: https://adr.github.io/ ; boas práticas: https://github.com/joelparkerhenderson/architecture-decision-record
- [V] OWASP Top 10:2025, introdução: https://owasp.org/Top10/2025/es/0x00_2025-Introduction/
- [V] Railway, rollback não desfaz o banco: https://docs.railway.com/guides/roll-back-bad-deploy
- [V secundária] Expandir e contrair: https://dev.to/jp_fontenele4321/the-expand-and-contract-pattern-for-zero-downtime-migrations-445m
- [V] dependency-cruiser: https://github.com/sverweij/dependency-cruiser ; LikeC4: https://github.com/likec4/likec4
- [V, conferir] Threat Modeling Manifesto: https://www.threatmodelingmanifesto.org/
- Pesquisa interna: repositórios de arquitetura e fluxo, fluxo em programas grandes (2026-10-09).
