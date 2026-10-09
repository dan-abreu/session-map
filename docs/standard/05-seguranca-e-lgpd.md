# 05 — Segurança e LGPD

Pensa como um golpista antes que um golpista pense, e trata os dados das pessoas como algo emprestado, com prazo e finalidade. Junta segurança da aplicação, da cadeia de suprimentos, das contas, da IA e a privacidade exigida pela LGPD.

> **Orientação técnica, não é parecer jurídico.** Os itens de LGPD citam a norma para organizar o trabalho; a base legal, os textos publicados e o enquadramento da empresa passam por advogado. O sistema nunca diz "em conformidade".

## Sumário

1. Quando entra
2. Segurança da aplicação
3. Cadeia de suprimentos, CI e contas
4. Segurança de IA no produto e nos agentes
5. LGPD passo a passo
6. Incidente
7. Quem faz
8. Entregas e portões
9. O que o fundador decide
10. Erros de amador que isto evita
11. Fontes

## 1. Quando entra

Em toda ideia marcada como sensível (autenticação, permissão, dado pessoal, dinheiro, integração externa, IA com ferramentas, publicação) e, em revisão periódica, no projeto inteiro. Vocabulário: OWASP Top 10:2025 como mapa de riscos, ASVS 5.0 nível 1 como lista mínima antes de lançar e nível 2 para autenticação e acesso quando há dado pessoal ou dinheiro [V OWASP; V SoftwareMill sobre ASVS 5.0; o uso do nível 2 é inferência da pesquisa].

## 2. Segurança da aplicação

1. **Modelo de ameaças de uma página** (diagrama de fluxo de dados + STRIDE nas setas que cruzam fronteiras de confiança), feito na etapa 02 e revisto aqui com o papel de golpista: como alguém usaria isto para enganar um cliente, um prestador ou o próprio negócio (conta falsa, avaliação falsa, pedido fantasma, desvio de pagamento, contato fora da plataforma).
2. **Controle de acesso no servidor por papel e por dono do objeto.** Rotas com identificador sempre filtram pelo dono; testes de acesso cruzado (usuário A tenta ler e alterar o objeto de B) para cada rota. É o risco nº 1 do Top 10:2025 e só teste prova; a ferramenta marca "parcial" quando não acha o teste [V OWASP].
3. **Autenticação:** senha com hash forte (argon2 ou bcrypt), limite de tentativas e bloqueio temporário, dois fatores no painel administrativo, cookies `HttpOnly`, `Secure` e `SameSite`, tokens com validade curta e **audiência separada por superfície** (o token do painel não vale no app) [C, mapeado ao ASVS].
4. **Validação de entrada na fronteira** por esquema; consultas parametrizadas; nada de `eval`; HTML de usuário sempre escapado [C].
5. **Limite de requisições** global e estrito nas rotas de login e nas rotas caras (IA, mensagens pagas); a defesa real de login é o bloqueio por tentativas no banco [V OWASP LLM, consumo ilimitado].
6. **Webhook** recebido só com assinatura verificada sobre o **corpo bruto** da requisição; sem isso qualquer um se passa pelo provedor [C].
7. **Cabeçalhos de segurança, CORS restrito, HTTPS** em tudo [C].
8. **Registros sem dado pessoal nem segredo** (mascaramento de telefone, e-mail e documento); o rastreador de erros também limpa antes de enviar [C].
9. **Menor privilégio:** usuário do banco do aplicativo sem permissão de alterar estrutura, chaves com escopo, token do CI mínimo [C].
10. **Registro de auditoria persistente** (tabela no banco, não log comum) de toda ação administrativa: quem, o quê, quando, antes e depois [C].
11. **Abuso de negócio:** limites que um golpista testaria (cupons, avaliações, cancelamentos, pedidos em massa, troca de contato) com alerta para padrão estranho.

## 3. Cadeia de suprimentos, CI e contas

12. **Segredos fora do código e do histórico**, varredura contínua com gitleaks (em repositório privado a proteção de push do GitHub é paga, então o gancho de pré-commit é o substituto) [V GitHub; V secundária AppSecSanta].
13. **Dependências vulneráveis** conhecidas (OSV-Scanner ou `npm audit`), robô de atualização (Dependabot ou Renovate), lockfile; cadeia de suprimentos é o 3º risco do Top 10:2025 [V].
14. **CI endurecido:** `permissions:` mínimas, ações fixadas por SHA, sem `pull_request_target` inseguro nem injeção por `${{ github.event.* }}` [V StepSecurity, terceiro; V Scorecard].
15. **Análise estática** com Semgrep ou CodeQL no CI (skills `static-analysis:semgrep`, `static-analysis:codeql`) [C].
16. **Padrões inseguros** (segredo de reserva no código, credencial padrão, modo que falha aberto, criptografia fraca, depuração ligada) varridos com a skill `insecure-defaults:audit`.
17. **Nota do OpenSSF Scorecard** em repositório público; é heurística, com falsos positivos e negativos [V Scorecard].
18. **`SECURITY.md`** com canal de reporte privado e prazo de resposta; reporte privado de vulnerabilidade ligado no GitHub [C].
19. **Contas críticas com dois fatores** (GitHub, hospedagem, domínio, e-mail, pagamento, Meta, gerenciador de senhas), preferindo chave de acesso ou aplicativo autenticador a SMS; gerenciador de senhas; domínio de e-mail com SPF, DKIM e DMARC; registro do domínio com bloqueio de transferência [C; Google exige SPF, DKIM e DMARC de quem envia em volume, V].
20. **Revisão trimestral de acessos** e chaves antigas; plano de acesso de emergência para o fundador solo (quem assume se ele sumir) [C].

## 4. Segurança de IA no produto e nos agentes

21. **Mapear que dados vão ao provedor de IA** e mascarar o que der; nunca enviar dado de cliente por plano gratuito que treina com o conteúdo [V OWASP LLM02; V Google, plano gratuito do Gemini].
22. **Saída da IA é entrada não confiável:** nunca executar, renderizar como HTML ou usar em SQL sem validar; resposta estruturada validada por esquema [V OWASP LLM05].
23. **Injeção de instrução** não tem correção completa conhecida; a defesa é limitar o dano: conteúdo de usuário, página ou documento nunca é instrução; ações que mudam estado (enviar, pagar, apagar, ler dados de outro cliente) exigem confirmação humana ou autorização fora do modelo [V OWASP LLM01 e LLM06].
24. **Menor privilégio para a IA:** só os dados do cliente da conversa; ferramentas mínimas; credenciais separadas [V OWASP LLM06].
25. **Sem segredo nem regra sensível no prompt** (o vazamento do prompt é esperado) [V OWASP LLM07].
26. **Teto de custo e abuso:** limite por usuário e por dia, `max_tokens`, orçamento no provedor, interruptor de emergência [V OWASP LLM10].
27. **Agentes de código no repositório:** lista estreita de comandos permitidos, sem pular permissões fora de sandbox, sem segredos de produção ao alcance, servidores MCP só de fontes conhecidas e com versão fixa, regras que não podem falhar como ganchos (o texto é conselho, o gancho é garantia), e conteúdo de README, issues e dependências tratado como possível injeção [V Claude Code, segurança; CSA, não revisado por pares].

## 5. LGPD passo a passo

28. **Inventário de dados pessoais** gerado do esquema do banco (nome, telefone, e-mail, CPF, endereço, localização, foto, voz, mensagens): de quem, para quê, onde fica, com quem é compartilhado, por quanto tempo. O fundador valida a tabela [C].
29. **Base legal por finalidade** (art. 7º: consentimento, execução de contrato, legítimo interesse, obrigação legal, entre outras); dado sensível (saúde, biometria, religião, origem racial) tem regras mais estritas (art. 11) [C, conferir no texto da Lei 13.709/2018].
30. **Minimização:** coletar só o necessário; evitar CPF se telefone basta; separar identificadores; pseudonimizar o que for para análise [C].
31. **Política de privacidade** publicada, linkada no site, no app e na primeira mensagem do canal de atendimento, em linguagem simples: quem é o controlador, finalidades, compartilhamento, retenção, direitos e contato. Rascunho com marcadores claros; o texto final passa por advogado; o sistema nunca inventa contato nem texto jurídico [C].
32. **Consentimento**, quando for a base: específico, registrado (quem, quando, versão do texto), revogável tão fácil quanto foi dado, sem caixa pré-marcada [C].
33. **Direitos do titular** (confirmação, acesso, correção, eliminação, portabilidade, revogação; art. 18) com canal e rotina: rota de exportar e de excluir a conta. Prazos do art. 19 para confirmação e acesso: em formato simplificado, imediatamente; em declaração clara e completa (origem, critérios, finalidade), em até 15 dias contados do requerimento. O sistema registra cada pedido com data e conta o prazo [V texto do art. 19 via fontes secundárias; uma minuta da ANPD previa dispensar o pequeno porte da declaração completa, aprovação não confirmada, NV].
34. **Encarregado ou canal:** agente de pequeno porte (ME, EPP, startup) pode ter canal de comunicação em vez de indicar encarregado, desde que não faça tratamento de alto risco; a resolução não dispensa bases legais, princípios nem segurança [V Res. CD/ANPD 2/2022, via Mayer Brown e Migalhas].
35. **Operadores e contratos:** lista de fornecedores que tratam dados em nome do negócio (nuvem, banco, WhatsApp, pagamento, e-mail, IA, analítica), cada um com contrato de tratamento e país de processamento confirmados [C].
36. **Transferência internacional:** usar nuvem ou IA fora do Brasil é transferência; exige base legal e um mecanismo (país adequado, cláusulas-padrão da ANPD, entre outros); o prazo de adequação às cláusulas-padrão terminou em 23/08/2025 [V Res. CD/ANPD 19/2024, via Mayer Brown e Demarest].
37. **Retenção e eliminação:** prazo por tipo de dado, rotina que apaga ou anonimiza, backups com expiração. Atenção ao conflito aparente: o Marco Civil obriga o provedor de aplicação pessoa jurídica a guardar **registros de acesso** por 6 meses, em sigilo (art. 15); isso é obrigação legal e convive com a minimização [V Lei 12.965/2014, via fontes secundárias].
38. **Cookies e rastreadores:** cookie necessário não pede consentimento; cookie de publicidade pede; banner com aceitar, rejeitar e gerenciar no mesmo nível [V Guia orientativo da ANPD de 2022, via Lefosse e Mattos Filho; detalhes do banner NV]. Analítica sem cookie reduz o problema (etapa 10).
39. **Crianças e adolescentes:** se o produto é dirigido a menores ou de acesso provável por eles, valem a LGPD (art. 14) e o ECA Digital (Lei 15.211/2025), em vigor desde 17/03/2026: proteção por padrão, aferição de idade que não seja só autodeclaração, supervisão parental, restrição de publicidade; multas de até R$ 50 milhões por infração [V/F escritórios Demarest e Machado Meyer, Canaltech; texto oficial NV].
40. **Decisões automatizadas sobre pessoas** (ranquear prestadores, aprovar ou recusar): direito de pedir revisão (art. 20) e explicação dos critérios [C].
41. **Aviso de que a pessoa fala com IA** e do que acontece com a conversa [C].
42. **Relatório de impacto (RIPD)** quando o tratamento é de alto risco (dado sensível, larga escala, menores, decisão automatizada) [C].
43. **WhatsApp:** só API oficial; antes de mandar mensagem ativa, o cliente deu o número e o opt-in, e o pedido de opt-in diz claramente que a pessoa aceita receber mensagens e de qual empresa; mensagem fora da janela de 24 horas só por modelo aprovado; descadastro por categoria honrado; nunca colar conversas reais em ferramenta ou IA sem base legal [V Meta, documentação de opt-in; política sujeita a mudança].

## 6. Incidente

44. **Plano de uma página:** quem decide, como conter (revogar chaves, tirar do ar), como avaliar o risco, modelo de aviso e contatos dos fornecedores.
45. **Prazo legal:** comunicar à ANPD e aos titulares em **3 dias úteis** o incidente que possa gerar risco ou dano relevante, contados do conhecimento de que atingiu dados pessoais; complemento em até 20 dias úteis; registro de todos os incidentes [V Res. CD/ANPD 15/2024, via Mattos Filho e Lefosse]. O prazo em dobro para pequeno porte aparece em uma fonte e **não está confirmado** [NV].
46. **Pós-incidente sem culpa:** o que falhou no sistema, não quem (etapa 07).

## 7. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Modelo de ameaças, abuso de negócio | Analista de confiança e segurança | Opus, alto | `audit-context-building:audit-context`, `sharp-edges:sharp-edges` |
| Revisão de segurança do diff | Especialista em segurança | Opus, alto | `differential-review:diff-review`, `security-review` |
| Varreduras automáticas | Automação | sem modelo; Sonnet, médio para traduzir | gitleaks, OSV-Scanner, Semgrep, CodeQL, Scorecard, `insecure-defaults:audit`, `supply-chain-risk-auditor` |
| Inventário, bases legais, política (rascunho) | Especialista em LGPD | Opus, alto | leitura do esquema; perguntas guiadas |
| Segunda conferência de achado grave | Revisor adversarial | Opus, muito alto | outra sessão |

## 8. Entregas e portões

Entregas: modelo de ameaças, relatório das varreduras com cada achado traduzido, testes de acesso cruzado, inventário de dados validado, mapa de fornecedores e países, rascunho de política e textos de consentimento, plano de incidente, registro de incidentes.

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Nenhum segredo no repositório e no histórico | gitleaks | Essencial |
| Sem vulnerabilidade conhecida alta ou crítica sem plano | OSV-Scanner | Essencial |
| Robô de atualização configurado | `dependabot.yml` ou `renovate.json` | Essencial |
| CI com permissões mínimas e sem padrão perigoso | Leitura dos workflows | Essencial |
| Teste de acesso cruzado em cada rota com identificador | Testes presentes; ausência = parcial | Essencial (web) |
| Limite de requisições em login e rotas caras | Configuração no código | Essencial |
| Webhook com assinatura sobre o corpo bruto | Leitura dos handlers | Essencial |
| Registros sem dado pessoal | Busca e mascaramento no registrador | Essencial |
| Dois fatores nas contas críticas | API do GitHub; o resto é atestado datado | Essencial |
| Inventário de dados e bases legais validados | Tabela com validação do fundador e data | Essencial com dado pessoal |
| Política publicada e linkada | Rota e link no rodapé; conteúdo mínimo | Essencial com usuários |
| Rota de exportar e excluir conta | Código | Essencial com dado pessoal |
| Fornecedores com contrato e país | Lista de SDKs × atestado | Essencial |
| Plano de incidente com o prazo de 3 dias úteis | Documento presente | Essencial |
| Aviso "não é parecer jurídico" em toda tela de LGPD | Texto presente | Essencial |

## 9. O que o fundador decide

- **Base legal de cada finalidade e o texto final da política.** Recomendação: rascunho do sistema revisado por advogado antes de publicar.
- **Contratar fornecedor que trata dados fora do Brasil.** Recomendação: só com contrato de tratamento e cláusulas-padrão; preferir região no Brasil quando houver.
- **Aceitar um risco conhecido.** Recomendação: só com prazo e dono.
- **Comunicar um incidente.** O sistema prepara tudo; a decisão e o envio são do fundador, dentro do prazo.

## 10. Erros de amador que isto evita

- Cliente que lê o pedido de outro trocando um número na URL.
- Chave de API exposta num repositório "privado" que um dia vira público.
- Telefone e conversa de cliente em log, em ferramenta de erro ou em IA gratuita.
- Política de privacidade copiada de outro site, com finalidades que não existem.
- Descobrir o prazo de 3 dias úteis depois do incidente.
- Conta do domínio sem dois fatores, tomada por um golpista.

## 11. Fontes

- [V] OWASP Top 10:2025: https://owasp.org/Top10/2025/es/0x00_2025-Introduction/ ; cobertura: https://www.theregister.com/2025/11/11/new_owasp_top_ten_broken/
- [V] ASVS 5.0: https://softwaremill.com/whats-new-in-asvs-5-0/ ; OWASP LLM Top 10 2025: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- [V] OpenSSF Scorecard: https://github.com/ossf/scorecard ; Claude Code, segurança: https://code.claude.com/docs/en/security
- [V] Lei 13.709/2018 (LGPD): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- [V] Res. 15/2024: https://www.mattosfilho.com.br/unico/regulamento-incidente-seguranca/ ; Res. 2/2022: https://www.migalhas.com.br/depeso/367429/resolucao-cd-anpd-2-22-um-diferenciado-olhar-da-lgpd-para-as-startups ; Res. 19/2024: https://www.demarest.com.br/anpd-aprova-o-regulamento-de-transferencia-internacional-de-dados/
- [V] Guia de cookies da ANPD: https://lefosse.com/noticias/anpd-publica-guia-orientativo-sobre-o-uso-de-cookies
- [V/F] ECA Digital: https://www.demarest.com.br/eca-digital-entrada-em-vigor-em-17-de-marco-de-2026/ ; https://www.machadomeyer.com.br/images/ebooks/Factsheet_ECA_Digital.pdf
- [V] Marco Civil, art. 15: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
- [V/F] LGPD art. 19, prazos: https://www.legjur.com/legislacao/art/LEI_00137092018-19 ; comentário: https://confidata.com.br/blog/9-direitos-titulares-lgpd
- [V] Meta, opt-in no WhatsApp: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
