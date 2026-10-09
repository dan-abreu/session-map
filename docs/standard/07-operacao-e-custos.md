# 07 — Operação e custos

Mantém o produto de pé depois de publicado: saber que caiu antes do cliente, recuperar dados de verdade, agir às 3 da manhã com um roteiro, e saber quanto cada cliente custa para não ter surpresa na fatura. Regra de partida: pergunta operacional sem dono na tabela de observabilidade é sistema cego [C, lei do projeto].

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

Desde a primeira versão com usuário real, e em toda ideia que cria um serviço, uma fila, uma integração paga ou um gasto variável. Depois, como rotina (diária, semanal, mensal e trimestral).

## 2. O que é feito, passo a passo

### 2.1 Enxergar o sistema (observabilidade)

1. **Cada pergunta operacional tem um dono:**

   | Pergunta | Onde se responde |
   |---|---|
   | O que aconteceu nesta requisição? | Registros estruturados (JSON, nível, identificador da requisição) |
   | O sistema está saudável no geral? | Métricas (taxa de erro, latência, filas, custo) |
   | Quem mudou o quê, quando, antes e depois? | Registro de auditoria no banco |
   | Qual foi a pilha e o contexto do erro? | Rastreador de erros (por exemplo, Sentry), ligado só com a chave configurada |
   | Qual passo foi o gargalo? | Identificador da requisição propagado; traços com OpenTelemetry quando maduro |

2. **Registros estruturados** com o registrador do projeto, sem dado pessoal cru (mascaramento de telefone, e-mail e documento) [V 12factor.net; C].
3. **Rastreador de erros** em todos os apps, com limpeza de dados pessoais antes do envio [C].
4. **Verificação de saúde** (`/health`) que testa as dependências essenciais (banco, fila) e responde rápido [V Railway].
5. **Monitor externo de disponibilidade** que acessa o produto de fora, a cada poucos minutos [C].
6. **Alertas poucos e acionáveis**, que chegam no celular: cada alerta diz o que está errado e qual runbook abrir; alerta que ninguém age é apagado, porque alerta demais vira clique automático [C; V Claude Code sobre fadiga de aprovação]. O OWASP Top 10:2025 trata "falhas de registro **e alerta**" como risco: não basta registrar [V].
7. **Painel mínimo do negócio** ao lado do técnico: pedidos por hora, taxa de atendimento, erros vistos pelo cliente, custo do dia.
8. **Avançado:** metas de nível de serviço (SLO) e alerta por taxa de consumo do orçamento de erro, quando houver volume [V SRE Workbook].

### 2.2 Não perder dados

9. **Backup automático do banco e dos arquivos**, criptografado, com retenção definida, e uma **cópia fora do mesmo ponto de falha** (outro provedor ou conta) [C]. Na Railway há três camadas (cópias do volume, recuperação em ponto no tempo e `pg_dump` portátil), recomendadas juntas em produção [V Railway].
10. **Ensaio de restauração trimestral** em ambiente limpo, com contagem de registros conferida e a data anotada no runbook. Backup não testado não existe; há relatos de restauração confusa na comunidade, o que reforça o ensaio [V Railway; relatos conflitantes].
11. **Ambientes separados** (desenvolvimento, teste, produção) e dados reais nunca em máquina sem proteção [C].

### 2.3 Agir quando algo dá errado

12. **Runbooks curtos** para: site fora, publicação ruim (voltar versão), banco cheio ou lento, segredo vazado (revogar, trocar, auditar), fornecedor fora (WhatsApp, pagamento, IA), conta invadida, incidente com dado pessoal (prazo de 3 dias úteis, etapa 05). Cada um com: sinais, primeiros 5 minutos, como confirmar que resolveu, quem avisar [C].
13. **Plantão de fundador solo:** quem recebe o alerta, em que horário, e o que fica para o dia seguinte; acesso de emergência guardado para uma segunda pessoa de confiança [C].
14. **Página de status** quando há clientes pagantes: estado público do serviço e avisos de manutenção [C].
15. **Pós-incidente sem culpa:** linha do tempo, causa raiz, o que vai mudar no sistema (não em quem); cada ação vira item com dono [V Google SRE Book].

### 2.4 Manter atualizado

16. **Rotina semanal de dependências:** aplicar as atualizações do robô em lotes pequenos, com testes verdes.
17. **Fim de suporte de runtime e frameworks** monitorado (Node, framework web, banco), com aviso antes do fim (candidata: API pública do endoflife.date, a confirmar) [C].
18. **Domínio, DNS e certificado** com dono, renovação automática e lembrete 60 dias antes do vencimento; e-mail do domínio com SPF, DKIM e DMARC [C].
19. **Revisão trimestral de acessos e chaves** (etapa 05).

### 2.5 Custos (FinOps de bolso)

20. **Inventário de tudo que cobra:** hospedagem, banco, domínio, e-mail, WhatsApp (cobrado por mensagem entregue, por categoria e país, desde 01/07/2025), pagamento (taxa por transação), IA, monitoramento, ferramentas; com dono, plano, valor, data de cobrança e cartão usado [V Meta, preços da plataforma WhatsApp; C].
21. **Limite duro de gasto em cada provedor** que permite (orçamento com bloqueio), e alerta em 80% e 100% do orçamento mensal [C].
22. **Custo de IA medido por chamada:** modelo, tokens de entrada e saída, custo e função de negócio, num adaptador central; o token é a unidade de custo da IA, separando entrada e saída [V FinOps Foundation, FinOps for AI].
23. **Custo por unidade de negócio:** por pedido atendido, por cliente ativo, por mensagem; alimenta a margem da etapa 13.
24. **Alavancas de custo de IA** aplicadas por padrão: modelo mais barato que resolve, cache de prompt para contexto repetido, lote (batch) para trabalho que pode esperar, `max_tokens` e limite por usuário, resumo de conversa longa (detalhe e preços na etapa 14 e no Arsenal) [V Anthropic, preços].
25. **Revisão mensal de custos:** o que subiu, por quê, o que cortar (planos parados, ambientes esquecidos, logs guardados demais).

### 2.6 Métricas de entrega como tendência

26. **Frequência de publicação, tempo de entrega, taxa de falha de mudança, tempo de recuperação e retrabalho** (as cinco métricas atuais do DORA) calculadas do git e das publicações, mostradas como tendência, nunca como meta [V dora.dev]. O relatório DORA 2025 resume a IA como amplificador: sobe a vazão e ainda sobe a instabilidade [V/F resumo; PDF oficial não lido].

## 3. Quem faz

| Passo | Papel | Modelo e nível | Skills e ferramentas |
|---|---|---|---|
| Observabilidade, alertas, saúde | Engenheiro de confiabilidade | Sonnet, alto | registrador do projeto, rastreador de erros, monitor externo |
| Backup e ensaio de restauração | Engenheiro de confiabilidade | Opus, alto (produção) | ferramentas da plataforma, `pg_dump` |
| Runbooks e pós-incidente | Engenheiro de confiabilidade + redator | Sonnet, médio | modelos de runbook |
| Diagnóstico de incidente | Desenvolvedor sênior | Opus, alto | `superpowers:systematic-debugging` |
| Inventário e revisão de custos | Finanças | Sonnet, médio; leitura de faturas com Haiku, baixo | aba Custos do session-map, painéis dos provedores |
| Atualização de dependências | Desenvolvedor | Sonnet, médio | Dependabot ou Renovate, `supply-chain-risk-auditor` |

## 4. Entregas

- Tabela de observabilidade preenchida (pergunta → onde se responde).
- Monitor externo e alertas configurados, com o runbook ligado a cada alerta.
- Política de backup e registro dos ensaios de restauração.
- Pasta de runbooks e pasta de pós-incidentes.
- Inventário de custos com limites e alertas; relatório mensal.
- Painel de métricas de entrega como tendência.

## 5. Portões

| Verificação | Como é detectada | Sev. |
|---|---|---|
| Registros estruturados com identificador de requisição | Dependência e configuração do registrador; `console.log` em massa = falhou | Essencial (web) |
| Rastreador de erros nos apps | SDK e nome da chave no `.env.example` | Essencial (web) |
| Verificação de saúde | Rota no código e na configuração da plataforma | Essencial (web) |
| Monitor externo e alerta no celular | Atestado datado (conta externa) | Essencial (web) |
| Backup ligado e cópia fora do mesmo ponto | Configuração (atestado) + script de cópia | Essencial com dados |
| Ensaio de restauração nos últimos 90 dias | Runbook com data | Essencial com dados |
| Runbooks dos cenários principais | Pasta `docs/runbooks/` com os arquivos | Essencial (web) |
| Inventário de custos com limite por provedor | Lista de SDKs pagos × inventário; limites atestados | Essencial |
| Custo de IA registrado por chamada | Adaptador central com registro de uso | Recomendado (essencial no caminho do cliente) |
| Domínio e certificado com renovação | Atestado + verificação da data do certificado | Essencial (web) |
| Runtime e framework com suporte | Versões × datas de fim de suporte | Recomendado |

## 6. O que o fundador decide

- **Orçamento mensal por provedor** e o que fazer ao bater 100%. Recomendação: pausar o não urgente e avisar; nunca cortar o fluxo crítico sem decisão.
- **Quem é a pessoa de emergência** com acesso guardado. Recomendação: alguém de confiança, com instruções seladas.
- **Horário de plantão.** Recomendação: alerta crítico a qualquer hora; o resto no horário comercial.
- **Contratar plano pago** de monitor, backup ou suporte. Recomendação: pagar backup fora do provedor antes de qualquer outra ferramenta.

## 7. Erros de amador que isto evita

- Saber que o site caiu pela reclamação do cliente.
- Ter backup e descobrir no dia do problema que ele não restaura.
- Cem alertas por dia, todos ignorados.
- Fatura de IA dez vezes maior por causa de um laço ou de um abuso.
- Domínio vencido derrubando site e e-mail.
- Cartão vencido suspendendo um fornecedor crítico sem aviso.

## 8. Fontes

- [V] The Twelve-Factor App: https://12factor.net/
- [V] Railway, backups e restauração: https://docs.railway.com/guides/postgres-backups-restores ; reversão e saúde: https://docs.railway.com/guides/roll-back-bad-deploy
- [V] Google SRE Book, pós-incidente sem culpa: https://sre.google/sre-book/postmortem-culture/ ; SRE Workbook, alertas por SLO: https://sre.google/workbook/alerting-on-slos/
- [V] DORA, métricas: https://dora.dev/guides/dora-metrics/
- [V] FinOps Foundation, FinOps for AI: https://finops.org/?p=17411
- [V] Meta, preços da plataforma WhatsApp: https://developers.facebook.com/docs/whatsapp/pricing
- [V] Anthropic, preços (cache, lote): https://platform.claude.com/docs/en/about-claude/pricing
- [V] OWASP Top 10:2025 (A09, registro e alerta): https://owasp.org/Top10/2025/es/0x00_2025-Introduction/
- [V] OpenTelemetry, estado por linguagem: https://opentelemetry.io/status/
