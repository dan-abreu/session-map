# 08 — Documentação

Garante que qualquer pessoa, ou qualquer agente de IA, entenda e mantenha o que foi feito daqui a seis meses: por que foi feito assim, como rodar, como voltar, e como o cliente usa. Um conjunto pequeno e vivo vence um grande e abandonado [inferência da pesquisa de base, apoiada em Diátaxis, C4 e arc42].

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

Em toda ideia, na medida do que mudou: uma regra nova muda o arquivo de instruções; uma rota nova muda a referência de API (gerada); uma decisão cara gera um ADR; uma funcionalidade que o cliente vê gera ajuda para o cliente. E, em rotina, o vigia de documentação confere tudo contra o código.

## 2. O que é feito, passo a passo

### 2.1 Um propósito por documento

1. **Tipos do Diátaxis**, um por página: tutorial (aprender fazendo), guia prático (resolver uma tarefa), referência (consulta exata) e explicação (entender o porquê). Página que mistura tipos é candidata a divisão [V diataxis.fr, via resumos].
2. **Doc só nasce com gatilho de atualização.** Documento sem evento que o mantenha vivo envelhece e engana; não é criado [C, regra do projeto].
3. **Vivos × constitucionais.** Vivos mudam a cada versão (ideia do produto, tecnologia, CHANGELOG, registro técnico); constitucionais mudam raramente por desenho (README, SECURITY, CONTRIBUTING, LICENSE, arquitetura geral, versionamento). Dormir é correto para os constitucionais [C].
4. **Um fato, um dono:** o resto aponta para ele com link; nada copiado em dois lugares [C].

### 2.2 O conjunto mínimo de um projeto

5. **README** com o que é, para quem, como rodar e como testar, do clone ao funcionamento; o selo OpenSSF exige que diga o que o software faz, como obter e como contribuir [V bestpractices.dev].
6. **"Do clone ao funcionamento" testado** de verdade em pasta descartável, seguindo só o que está escrito; meta de convenção de ~15 minutos [C].
7. **Arquitetura em uma página** (contexto e partes), mais uma página por parte com "onde está no código" e "o que falta" [V C4; V arc42].
8. **Registros de decisão** (ADR) numerados e imutáveis (etapa 02).
9. **Glossário do domínio:** os termos do negócio como o código os usa; evita que pessoas e IA errem o vocabulário [C].
10. **Runbooks** de operação (etapa 07).
11. **Referência de API gerada do código** (OpenAPI ou Swagger), nunca escrita à mão; em produção, exposta só quando configurado [V critério OpenSSF de documentar a interface externa].
12. **Documentação do banco:** esquema e relações gerados do esquema real.
13. **Configuração:** tabela de variáveis de ambiente (só nomes e para que servem) e interruptores [C].
14. **Arquivos comunitários** que se aplicam ao perfil: LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, modelos de issue e de PR, CODEOWNERS; procurados na raiz, em `.github/` e em `docs/` [V GitHub, perfil da comunidade].
15. **Lugar certo para cada arquivo:** raiz só para os comunitários curtos e o arquivo de instruções; processo do GitHub em `.github/`; documentos longos em `docs/` [C, convenção do GitHub].

### 2.3 Documentação para quem usa o produto

16. **Central de ajuda** com guias práticos curtos para as tarefas do cliente (como pedir, como pagar, como cancelar, como falar com o suporte), em linguagem do cliente, com imagens da versão atual [C].
17. **Perguntas frequentes** alimentadas pelas perguntas reais que chegam ao atendimento (etapa 11): toda pergunta que aparece três vezes vira artigo [C].
18. **Textos legais** (política de privacidade, termos de uso) linkados da ajuda e do rodapé (etapas 05 e 12).

### 2.4 Documentação para agentes de IA

19. **Arquivo de instruções curto** (CLAUDE.md ou AGENTS.md) com o que é o projeto, comandos de verificação, regras invioláveis e armadilhas conhecidas; alvo abaixo de 200 linhas, porque arquivo maior consome contexto e reduz a aderência [V Claude Code, memória; V agents.md].
20. **Regras longas por caminho** (carregadas só quando a tarefa toca aqueles arquivos), em vez de tudo sempre carregado [V Claude Code, memória].
21. **A mesma correção repetida em sessões diferentes vira regra** no arquivo de instruções [V Claude Code, boas práticas].
22. **Nada de segredo** em arquivos de instruções, memória ou skills [C].

### 2.5 Tamanho e divisão

23. **Limiares de tamanho** (heurísticas configuráveis; medir linhas e KB, ignorar blocos de código gerados):

   | Tipo | Aviso | Forte |
   |---|---|---|
   | Instruções de agente | > 150 linhas | > 200 (fonte oficial) |
   | Memória ou índice sempre carregado | > 150 linhas | > 200 linhas ou 25 KB (cortado em silêncio) |
   | SKILL.md | > 400 | > 500 (fonte oficial) |
   | Parte de arquitetura ou guia | > 300 | > 500; sumário obrigatório acima de 100 |
   | README | > 200 | > 400 (vira índice) |
   | Plano ou brief | > 300 | > 500 |
   | Registro ou lista | > 400 | > 800 |
   | CHANGELOG | arquivar por ano ou versão maior | idem |

   O "300 linhas" vem do padrão `max-lines` do ESLint, emprestado de código; não há regra oficial de tamanho para documentação [V eslint.org; V Claude Code; V guia de skills; C para o resto].
24. **Divisão por assunto, nunca por contagem:** cortar só em títulos de segundo nível, nunca dentro de bloco de código ou tabela; cada pedaço vira um arquivo com o nome do título; o original vira índice; todos os links internos reescritos, e se algum quebrar nada é gravado. Arquivo que só cresce no fim (CHANGELOG, diário) é arquivado, não dividido [C, regra da fundação].
25. **Apontar o código por caminho e símbolo** (`arquivo#nome`), nunca por número de linha fixo; número de linha só em citação datada com o SHA do commit [C].

### 2.6 Manter em dia

26. **Vigia de documentação:** documento que cita algo que não existe mais; código novo sem documentação (a IA escreve no padrão, marcado "escrito a partir do código"); arquitetura, Fluxo, README e CHANGELOG que discordam entre si; versões e números desencontrados; imagens mais velhas que a tela [C, fundação].
27. **Frescor:** data da última mudança do documento × data da última mudança do código que ele descreve; caminhos citados que já não existem [C, sem padrão publicado].
28. **Verificação de links e formato no CI** (lychee, markdownlint, Vale) introduzida quando o projeto já passa, tratando falha como erro [V Lorna Jane].
29. **Decisões das conversas** que não chegaram aos documentos são propostas como ADR ou linha de instruções [C].
30. **Documentar em quatro lugares a cada versão** quando o projeto adota essa regra: arquivo de versão, CHANGELOG, registro técnico e README [C, regra do projeto].

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Documentos técnicos e ajuda ao cliente | Redator técnico | Sonnet, médio | Diátaxis; capturas do modo demonstração |
| Arquitetura e ADR | Arquiteto | Opus, alto | `openspec-*`, modelo de arquitetura do session-map |
| Referência de API e banco | Automação | sem modelo | gerador OpenAPI do framework; leitor do esquema |
| Vigia, links, tamanho | Automação + Haiku, baixo | — | lychee, markdownlint, Vale, censo do session-map |
| Arquivo de instruções e regras | Maestro | Opus, alto | `claude-mem:*` quando instalado, skill `init` |

## 4. Entregas

- README que leva do clone ao funcionamento, testado.
- Páginas de arquitetura atualizadas com "onde está no código" e "o que falta".
- ADRs, glossário, runbooks, tabela de configuração.
- Referência de API e do banco geradas.
- Artigos de ajuda e perguntas frequentes para o cliente.
- Arquivo de instruções do agente dentro do tamanho.
- Relatório do vigia: o que estava defasado e o que foi atualizado.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| README responde o quê, para quem, como rodar e testar | Seções e bloco de comandos | Essencial |
| Do clone ao funcionamento funciona | Execução dos comandos em pasta descartável | Essencial |
| Arquitetura cobre todo o código | Arquivos sem parte dona = falhou | Recomendado (essencial no session-map) |
| Referência de API gerada e batendo com as rotas | Diff rotas × especificação | Recomendado |
| Nenhum documento cita o que não existe | Caminhos e símbolos citados resolvem | Essencial |
| Links internos válidos | lychee | Recomendado |
| Arquivo de instruções do agente dentro do limite e com comandos válidos | Contagem; comandos citados existem | Essencial (com agentes) |
| Documentos dentro dos limiares de tamanho | Contagem de linhas e KB | Recomendado |
| Ajuda ao cliente para cada funcionalidade que ele vê | Mapa funcionalidade ↔ artigo | Recomendado (essencial com clientes pagantes) |
| Imagens da versão atual | Data da imagem × última mudança da tela | Recomendado |

## 6. O que o fundador decide

- **Tom da ajuda ao cliente.** Recomendação: o mesmo tom de voz da marca (etapa 09), frases curtas, segunda pessoa.
- **O que é público e o que é interno.** Recomendação: arquitetura e runbooks internos; ajuda, política e termos públicos.

## 7. Erros de amador que isto evita

- README que ensina um comando que não existe mais.
- Documentação gigante que ninguém lê, e a IA ignorando metade das regras porque o arquivo de instruções tem 800 linhas.
- Decisão importante perdida numa conversa.
- Cliente sem saber como cancelar e reclamando no lugar errado.
- Link quebrado e imagem de tela antiga passando a impressão de abandono.

## 8. Fontes

- [V] Diátaxis: https://diataxis.fr/ ; C4: https://c4model.com/ ; arc42: https://arc42.org/overview ; ADR: https://adr.github.io/
- [V] Selo OpenSSF, critérios: https://www.bestpractices.dev/en/criteria/0
- [V] Claude Code, memória e tamanho do CLAUDE.md: https://code.claude.com/docs/en/memory ; boas práticas: https://code.claude.com/docs/en/best-practices
- [V] Boas práticas de skills: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ; AGENTS.md: https://agents.md/
- [V] ESLint `max-lines`: https://eslint.org/docs/latest/rules/max-lines
- [V] Verificação de links em docs como código: https://lornajane.net/posts/2024/checking-links-in-docs-as-code-projects
- [V] GitHub, perfil da comunidade: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories
- Pesquisa interna: tamanho de documentos e checklist de repositório profissional (2026-10-09).
