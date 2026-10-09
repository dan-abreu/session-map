# 06 — Versões e publicação

Leva a ideia ao ar sem quebrar o que já funciona, com um número de versão que diz o que mudou, um registro em linguagem simples e um caminho de volta testado. Publicar é ação sensível: pede confirmação do fundador em qualquer modo de cuidado.

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

Toda vez que uma ou mais ideias prontas vão ao ar. Cada publicação fecha um propósito identificável; não amontoa funcionalidades soltas [C, cadência de sub-versões].

## 2. O que é feito, passo a passo

### 2.1 Montar a versão

1. **Versão semântica** `MAIOR.MENOR.CORREÇÃO`: correção sobe o último número, funcionalidade compatível sobe o do meio, quebra de compatibilidade sobe o primeiro [V semver.org, conhecimento estável]. O sistema sugere o próximo número pelo tipo dos commits (`feat` → menor, `fix` → correção, `!` ou `BREAKING CHANGE` → maior).
2. **Uma só versão em todo lugar:** manifesto do pacote, arquivo `VERSION`, manifesto do plugin ou app, CHANGELOG, README e a etiqueta (tag) git batem.
3. **CHANGELOG no formato Keep a Changelog** (Adicionado, Alterado, Corrigido, Removido, Segurança, e "Ainda não publicado"), escrito para o cliente entender, não para o desenvolvedor [V keepachangelog.com, conhecimento estável].
4. **Histórico do CHANGELOG não é reescrito.** Entrada antiga errada recebe nota no lugar ("previsto, adiado para vX.Y.Z") [C, regra do projeto].
5. **Registro técnico longo** (decisões, arquivos, números, próximo passo) separado do CHANGELOG, para quem mantém [C].
6. **README atualizado:** cita só funcionalidades que existem; imagens de tela regeradas a partir do modo de demonstração na mesma versão; nenhuma imagem mais velha que a tela que mostra [C, trava de publicação da fundação].
7. **Notas da versão** (release notes) no GitHub ou na loja, ligadas à etiqueta [V critério do selo OpenSSF].

### 2.2 Antes de publicar

8. **Todos os portões das etapas 03, 04 e 05 verdes** para as ideias da versão, ou "não verificado" com dono e data.
9. **CI verde na versão exata que vai subir;** a plataforma de hospedagem configurada para esperar o CI ("Wait for CI") [V Railway].
10. **Ambiente de prévia por mudança** quando a plataforma oferece, para olhar a versão antes de ela chegar ao cliente [V Railway, ambientes de PR].
11. **Migração de banco revisada:** passos destrutivos em duas versões (expandir, migrar, contrair) e **backup feito antes** de migrar com dados reais [V secundária DEV Community; V Railway].
12. **Interruptores (feature flags)** separam "subir o código" de "ligar para o cliente": cada um com dono, data de remoção e teto de quantidade; integração de custo variável (IA, mensagens) ganha interruptor de emergência [V Martin Fowler].
13. **Ordem de publicação** pensada: banco antes do código que precisa da coluna; servidor antes do app que chama a rota nova.
14. **Variáveis de ambiente novas** conferidas em todos os ambientes, lidas e validadas na partida (o sistema não sobe com configuração faltando), e declaradas na ferramenta de build quando ela filtra variáveis [V 12factor.net; C para o detalhe da ferramenta].
15. **Comunicação preparada** quando o cliente sente a mudança: aviso no produto, mensagem, nota de ajuda, roteiro para o atendimento (etapas 10 e 11).

### 2.3 Publicar

16. **Commit principal** com mensagem convencional e corpo explicando as decisões; **etiqueta** `vX.Y.Z` nesse commit; CHANGELOG escrito antes da etiqueta [C, regra do projeto].
17. **Enviar** (push) só depois da confirmação do fundador; a confirmação mostra o que vai ao ar, o risco e o plano de volta.
18. **Implantação com verificação de saúde:** a versão nova só recebe tráfego quando `/health` responde 200; até lá a antiga continua servindo [V Railway].
19. **Lançamento gradual** quando o risco é alto: ligar o interruptor para uma parte dos clientes, observar, ampliar.

### 2.4 Depois de publicar

20. **Teste de fumaça** automático: página inicial abre, login funciona, `/health` responde, um fluxo crítico de ponta a ponta [C].
21. **Observar por uma janela definida** (por exemplo, 30 minutos e de novo no dia seguinte): taxa de erro, latência, custo de IA, reclamações; comparar com antes.
22. **Confirmar o que está no ar:** a versão do código e a versão rodando batem (rota de versão quando existir) e aparecem no topo do projeto no session-map.
23. **Fechamento:** a entrega só é declarada pronta depois de exercitada em produção; custos estimados × reais comparados; a linha de progresso do projeto atualizada.

### 2.5 Voltar atrás

24. **Reversão em segundos** restaurando a imagem anterior na plataforma; saber onde fica o botão e por quanto tempo a imagem antiga é guardada (na Railway, de 24 horas no plano gratuito a 360 horas no Enterprise) [V Railway].
25. **Reverter o aplicativo não desfaz a migração;** por isso a migração destrutiva vem separada (passo 11).
26. **Reversão ensaiada:** o caminho de volta é testado de verdade pelo menos uma vez por trimestre e registrado no runbook com a data [C].
27. **Critério de volta escrito antes:** "se a taxa de erro passar de X ou o fluxo crítico falhar, volta sem discutir".

### 2.6 Aplicativo em loja (quando houver)

28. Publicação em faixa de teste interno e depois produção gradual; declaração de privacidade e de dados coletados na loja coerente com a política; versão e número de build consistentes; texto e imagens da loja atualizados (etapa 10) [C; regras de cada loja conferidas no dia].

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Versão, CHANGELOG, registros | Redator técnico | Sonnet, médio | Conventional Commits, Keep a Changelog |
| Trava de publicação (consistência) | Automação | sem modelo | verificação de versões, links, imagens, funcionalidades citadas |
| Migração e plano de volta | Engenheiro de confiabilidade | Opus, alto | runbook do projeto |
| Commit, etiqueta, envio | Maestro | Opus, alto | `superpowers:finishing-a-development-branch`, `superpowers:verification-before-completion` |
| Fumaça e observação | Engenheiro de qualidade | Sonnet, médio | Playwright, consulta aos registros e métricas |

## 4. Entregas

- Versão nova consistente em todos os arquivos, com etiqueta git.
- CHANGELOG, registro técnico, README e imagens atualizados.
- Notas da versão.
- Plano de publicação: ordem, interruptores, critério de volta, janela de observação.
- Relatório pós-publicação: fumaça, métricas antes e depois, custo estimado × real.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Mesma versão em todos os arquivos | Leitura dos manifestos, CHANGELOG, README e etiqueta | Essencial |
| Seção do CHANGELOG presente para a versão | Leitura do arquivo | Essencial |
| README cita só o que existe; links resolvem | Mapa funcionalidade ↔ código; lychee | Essencial |
| Imagens do README da mesma versão | Data das imagens × última mudança da tela | Recomendado |
| CI verde no commit publicado | API do CI; sem token = não verificado | Essencial |
| Verificação de saúde configurada | Rota no código + configuração da plataforma | Essencial (web) |
| Migração destrutiva separada e backup antes | Leitura das migrações + atestado do backup | Essencial com dados reais |
| Interruptores com dono e data | Lista de interruptores; vencidos = aviso | Recomendado |
| Teste de fumaça pós-publicação verde | Saída do teste | Essencial (web) |
| Reversão ensaiada no trimestre | Runbook com data | Essencial (web) |
| Confirmação do fundador para publicar | Registro da confirmação | Essencial |

A trava recusa a publicação quando qualquer verificação essencial falha.

## 6. O que o fundador decide

- **Publicar agora ou esperar.** Recomendação: publicar fora do horário de pico do cliente e nunca na véspera de ficar fora do ar.
- **Lançamento gradual ou para todos.** Recomendação: gradual quando mexe em dinheiro, login ou no fluxo principal.
- **Avisar os clientes e como.** Recomendação: avisar quando muda algo que o cliente vê ou paga.

## 7. Erros de amador que isto evita

- Versão 1.2 no site, 1.3 no código e 1.1 na loja.
- Publicar sexta à noite sem saber como voltar.
- Descobrir que reverter o app não traz de volta a coluna apagada.
- README mostrando uma tela que não existe mais.
- "Subiu" sem ninguém conferir se a página abre.
- Interruptor esquecido ligado há um ano, que ninguém sabe para que serve.

## 8. Fontes

- [V] Semantic Versioning: https://semver.org ; Keep a Changelog: https://keepachangelog.com ; Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/
- [V] Railway, esperar o CI e ambientes de PR: https://docs.railway.com/guides/ship-on-merge-pr-canaries ; reversão: https://docs.railway.com/guides/roll-back-bad-deploy
- [V] Martin Fowler, interruptores: https://martinfowler.com/articles/feature-toggles.html
- [V] The Twelve-Factor App: https://12factor.net/
- [V secundária] Expandir e contrair: https://dev.to/jp_fontenele4321/the-expand-and-contract-pattern-for-zero-downtime-migrations-445m
- [V] Selo OpenSSF (notas da versão): https://www.bestpractices.dev/en/criteria/0
