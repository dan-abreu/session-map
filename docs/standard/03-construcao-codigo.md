# 03 — Construção do código

Escreve o código como um engenheiro sênior escreveria: o mínimo que resolve, no lugar certo, com teste antes, em passos pequenos, revisado por quem não escreveu e sem nada que denuncie "foi uma IA". O fundador não lê código; por isso cada regra aqui vira uma verificação automática que diz "passou" ou "falhou".

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

Em toda ideia que muda código, de uma linha a um sistema novo, depois da especificação (etapa 01) e do desenho (etapa 02) quando eles se aplicam.

## 2. O que é feito, passo a passo

### 2.1 Preparar o terreno

1. **Área de trabalho isolada.** Cada frente roda numa branch curta e, com agentes em paralelo, numa *worktree* própria, para duas sessões nunca editarem a mesma pasta [V Claude Code, boas práticas].
2. **Estado limpo conferido:** testes, tipos e lint verdes antes de começar. Se já estavam vermelhos, isso é registrado e não é atribuído à ideia nova.
3. **Contexto mínimo.** O agente recebe só a especificação, o desenho e os arquivos da parte afetada, mais as regras do projeto; não a conversa inteira.

### 2.2 A escada da economia (antes de escrever)

4. Para cada pedaço, parar no primeiro degrau que resolve [C, regra de economia do projeto]:
   1. Isso precisa existir? Necessidade especulativa não é feita.
   2. Já existe no projeto (componente, função, tipo, texto)? Reusar.
   3. A biblioteca padrão faz? Usar.
   4. A plataforma faz (HTML e CSS antes de JavaScript, restrição no banco antes de código)? Usar.
   5. Uma dependência já instalada resolve? Usar. Nunca adicionar dependência para o que poucas linhas fazem.
   6. Cabe em uma linha? Uma linha.
   7. Só então, o mínimo de código que funciona.
5. **Bug é causa raiz.** Antes de corrigir, procurar todos os chamadores da função; uma guarda na função compartilhada vence uma correção por chamador.

### 2.3 Escrever com teste primeiro

6. **Teste antes do código** para toda lógica não trivial (ramo, laço, conversão, dinheiro, permissão): escrever o teste, vê-lo falhar pelo motivo certo, escrever o mínimo para passar, refatorar com o teste verde (skill `superpowers:test-driven-development`).
7. **Verificação executável nomeada** no arquivo de instruções (um comando para testes, um para tipos, um para lint), para o agente se corrigir sozinho; sem ela, o humano vira o laço de verificação [V Claude Code].
8. **Passos pequenos e commits frequentes** durante a sessão, cada um com um ponto de retorno [V Claude Code; V Google, mudanças pequenas].

### 2.4 Regras de escrita

9. **Código de gente, não de IA.** Sem comentários óbvios, sem try/catch em volta de tudo, sem abstração "para o futuro", sem nomes genéricos (`data`, `result`, `temp`), sem funções com oito parâmetros opcionais, sem TODO sem dono [C, regra de estilo do projeto].
10. **Comentário só para o porquê:** decisão não óbvia, armadilha futura, referência externa (ADR, issue).
11. **Nomes:** idioma do domínio para conceitos do negócio e inglês para termos técnicos, sem misturar dentro do mesmo nome; verbo para função, substantivo para dado.
12. **Tipos estritos.** Nada de `any` espalhado; `unknown` com verificação na fronteira; esquema de validação na entrada e tipo derivado no resto; uniões literais em vez de `enum` quando o projeto adota essa regra.
13. **Erros:** resultado tipado para erro esperado; exceção só para bug; nunca engolir erro sem ação (tentar de novo, alternativa, registrar com contexto).
14. **Registros (logs)** pelo registrador do projeto (nunca `console.log` em produção), com identificador da requisição e **sem dado pessoal cru** (telefone, e-mail e documento mascarados) — detalhe na etapa 07.
15. **Uma responsabilidade por arquivo; pasta por capacidade** (tudo de "proposta" junto), não por tipo.
16. **Tamanho como cheiro, não lei:** arquivo acima de ~400 linhas e função acima de ~50 pedem a pergunta "tem duas coisas aqui?" [C; o ESLint usa 300 e 50 como padrão de `max-lines` e `max-lines-per-function`, V].
17. **Complexidade** alertada só no código novo; limiar padrão 15 de complexidade cognitiva, empírico e ajustável [V Sonar].

### 2.5 Dependências e segredos

18. **Dependência nova é decisão.** Conferir que o pacote existe, tem idade, mantenedores e licença compatível; modelos de IA inventam nomes de pacote que atacantes registram ("pacote alucinado") [V TechRepublic, números de modelos antigos]. Lockfile sempre versionado; instalação congelada no CI.
19. **Auditoria de cadeia de suprimentos** antes de adotar pacote ou ferramenta nova (skill `supply-chain-risk-auditor`).
20. **Nenhum segredo no código nem no histórico.** Configuração e segredos no ambiente; `.env.example` com os nomes e sem valores; varredura com gitleaks em gancho de pré-commit e no CI. Chave vazada é revogada, não só apagada do commit [V GitHub, push protection].
21. **Prefixo público** (`NEXT_PUBLIC_`, `VITE_`) nunca leva segredo.

### 2.6 Integrar

22. **Branches curtas, integração ao menos diária** (desenvolvimento em tronco único) [V trunkbaseddevelopment.com].
23. **Mudança pequena:** cerca de 100 linhas é razoável, 1.000 é grande demais; o alerta do sistema começa em ~400 linhas ou 15 arquivos, ajustável [V Google; limiar é heurística].
24. **Mensagens de commit no padrão Conventional Commits** (`feat:`, `fix:`, `docs:`), com corpo explicando decisões, e rodapé de coautoria da IA (`Co-Authored-By` ou `Assisted-by`) para rastrear o que a IA escreveu [V conventionalcommits.org; V kernel.org].
25. **Ganchos nunca pulados.** Se o gancho de pré-commit reclamou, o problema é real; `--no-verify` é proibido.
26. **Revisão independente do diff** por outra sessão ou agente que não escreveu o código, antes do merge, com foco em correção, segurança e simplificação (skills `superpowers:requesting-code-review`, `code-review`, `simplify`; `differential-review` quando toca segurança) [V Claude Code].
27. **Branch principal protegida:** CI como verificação obrigatória e sem *force-push*, inclusive para agentes [V GitHub, branch protegida].

### 2.7 Saúde do código ao longo do tempo

28. **Código morto e TODO sem dono** apontados (knip para JavaScript e TypeScript).
29. **Duplicação** medida (jscpd); a tendência importa mais que o número, porque a IA tende a colar em vez de reaproveitar [V GitClear via DevClass, correlação, dados de clientes da empresa].
30. **Pontos quentes:** os 10 arquivos que mais mudam **e** são mais complexos, cruzando `git log` com tamanho e complexidade; é onde refatorar primeiro [V CodeScene, aproximação nossa].

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Código mecânico, telas, remoções | Desenvolvedor | Sonnet, médio | `superpowers:test-driven-development`, `superpowers:executing-plans` |
| Regra de negócio, integração | Desenvolvedor sênior | Sonnet ou Opus, alto | idem + `superpowers:systematic-debugging` para bug |
| Dinheiro, autenticação, dados pessoais | Desenvolvedor sênior | Opus, alto | idem + `differential-review` |
| Plano grande com várias tarefas | Maestro | Opus, alto | `superpowers:subagent-driven-development` (um agente por tarefa) |
| Revisão do diff | Revisor independente | Opus, alto | `superpowers:requesting-code-review`, `code-review`, `simplify` |
| Lint, tipos, formatação, segredos | Automação | sem modelo | linter e checagem de tipos do projeto, formatador, gitleaks, knip, jscpd |
| Tarefa que falhou no Sonnet | Desenvolvedor sênior | sobe para Opus, alto | idem |

## 4. Entregas

- Código e testes na branch, em commits pequenos com mensagens convencionais e rodapé de coautoria.
- Saída dos comandos de verificação (testes, tipos, lint) anexada como evidência.
- Relatório da revisão independente com os achados e o que foi corrigido.
- Lista de dependências novas com a auditoria de cada uma.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Testes, tipos e lint verdes | Saída dos comandos com código de retorno zero | Essencial |
| Teste novo junto de cada mudança de comportamento | Commits que tocam código sem tocar testes | Recomendado (essencial em lógica crítica) |
| Nenhum segredo nos arquivos e no histórico | gitleaks no diff e no histórico | Essencial |
| `.env` fora do git; `.env.example` com todos os nomes usados | `git ls-files`; cruzamento de `process.env.*` com o exemplo | Essencial |
| Dependência nova existe, tem licença e passou na auditoria | Diff do manifesto × registro de pacotes; relatório da auditoria | Essencial |
| Lockfile versionado e instalação congelada | Arquivo presente; flag no CI | Essencial |
| Mudança pequena | `git diff --shortstat` acima do limiar = aviso | Recomendado |
| Conventional Commits e rodapé de coautoria | Expressão regular nos commits da branch | Recomendado |
| Revisão independente antes do merge | Registro de revisão por outra sessão ou pessoa | Essencial em sensível |
| Branch principal protegida com CI obrigatório | API do GitHub; sem token = não verificado | Essencial |
| Sem `console.log` em produção, sem dado pessoal em log | Busca no diff; uso do registrador com mascaramento | Essencial |
| Complexidade e tamanho no código novo | Lint de complexidade; contagem de linhas | Recomendado |

## 6. O que o fundador decide

Nada técnico. O fundador só é chamado se a construção revelar que a especificação não fecha (por exemplo, uma regra de negócio ambígua: "o cliente pode cancelar depois de aceitar?"). Nesse caso recebe uma pergunta objetiva, com a recomendação e o impacto de cada resposta.

## 7. Erros de amador que isto evita

- Código que "funciona" mas ninguém entende em seis meses.
- Pacote inventado pela IA instalado sem conferir, abrindo a porta a um atacante.
- Chave de API commitada e "apagada" sem ser revogada.
- Uma correção que conserta o caso do ticket e deixa três irmãos quebrados.
- Uma montanha de mudanças sem commit, impossível de revisar ou desfazer.
- Agente que mesmo errado aprova o próprio trabalho.
- Pular o gancho de verificação "só desta vez".

## 8. Fontes

- [V] Claude Code, boas práticas: https://code.claude.com/docs/en/best-practices
- [V] Google, mudanças pequenas: https://google.github.io/eng-practices/review/developer/small-cls.html
- [V] Trunk Based Development: https://trunkbaseddevelopment.com/
- [V] GitHub, branch protegida: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- [V] GitHub, push protection: https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection
- [V] Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/ ; kernel.org, assistentes de código: https://kernel.org/doc/html/next/process/coding-assistants.html
- [V] Sonar, limiar 15: https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103 ; ESLint `max-lines`: https://eslint.org/docs/latest/rules/max-lines
- [V/F] GitClear via DevClass: https://devclass.com/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/
- [V] CodeScene, saúde do código: https://codescene.cs.lth.se/docs/guides/technical/code-health.html
- [V] Pacotes alucinados: https://www.techrepublic.com/article/news-slopsquatting-vibe-coding-ai-cybersecurity-risk/
- Ferramentas: gitleaks https://github.com/gitleaks/gitleaks ; knip https://github.com/webpro-nl/knip ; jscpd https://github.com/kucherenko/jscpd (licenças conferidas na adoção).
