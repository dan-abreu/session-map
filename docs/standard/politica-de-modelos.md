# Política de modelos

> Este arquivo é gerado a partir de `server/ai/policy.json`. Não edite à mão: mude o arquivo de política e rode `node server/ai/policy.mjs --write`; um teste falha se este texto ficar diferente.

Esta é a tabela única que decide qual modelo de IA e qual nível de raciocínio cada tipo de tarefa recebe. A IA só diz de que tipo é a tarefa (a etiqueta no começo da descrição, como `[code]`); o robô do session-map escolhe o modelo e o nível a partir daqui.

## Tipos de tarefa

| Tipo | Modelo | Nível | Por quê | De onde vem |
|---|---|---|---|---|
| busca (`search`) | Haiku | baixo | achar e ler não pede julgamento | regra: não pede julgamento |
| leitura (`read`) | Haiku | baixo | ler e listar não pede julgamento | regra: não pede julgamento |
| trabalho em lote (`bulk`) | Haiku | baixo | muitos itens pequenos e mecânicos | regra: não pede julgamento |
| texto curto (`text`) | Haiku | baixo | textos curtos e rótulos | regra: não pede julgamento |
| commit (`commit`) | Haiku | baixo | a mensagem do commit sai de uma mudança já conhecida | regra: não pede julgamento |
| documentação (`docs`) | Sonnet | baixo | a documentação segue o que o código já diz | regra: só registra fatos já conhecidos |
| código (`code`) | Sonnet | médio | o Sonnet em nível médio acertou o código em todos os casos medidos | medido em 2026-10-10: code 22/22 |
| teste (`test`) | Sonnet | médio | teste é código com objetivo conhecido | medido em 2026-10-10: code 22/22 |
| tela (`screen`) | Sonnet | médio | tela é código mais bom gosto, e o Sonnet em nível médio dá conta dos dois | medido em 2026-10-10: code 22/22 |
| depuração (`debug`) | Sonnet | médio | achar um defeito é ler código com um teste na mão | medido em 2026-10-10: code 22/22 |
| plano (`plan`) | Sonnet | médio | o Sonnet em nível médio planejou todos os casos; o Opus em nível alto errou um e custou 2,5 vezes mais | medido em 2026-10-13: plan 8/8 (or30) |
| revisão (`review`) | Sonnet | médio | o Sonnet em nível médio achou todos os defeitos plantados | medido em 2026-10-10: review 20/20 |
| arquitetura (`architecture`) | Opus | alto | uma estrutura errada é a mais cara de desfazer | regra: risco alto |
| segurança (`security`) | Opus | alto | uma brecha esquecida é paga pelos usuários | regra: risco alto |
| dinheiro (`money`) | Opus | alto | um erro aqui perde dinheiro de verdade | regra: risco alto |
| dado pessoal (`personal-data`) | Opus | alto | um erro aqui fere a lei de proteção de dados (LGPD) | regra: risco alto |

## Escada de falhas

Cada falha de verdade sobe um degrau, nunca mais de um por vez. O nível máximo nunca é usado sozinho. O Fable só entra depois que um degrau do Opus falhou.

1. Haiku, nível baixo
2. Sonnet, nível médio
3. Sonnet, nível alto
4. Opus, nível alto
5. Opus, nível altíssimo
6. Fable, nível alto

## A conversa

A conversa com a pessoa roda em **Opus, nível alto** e nunca troca de modelo sozinha: a conversa recebe a pessoa e decide; nunca troca de modelo sozinha. Só a pessoa muda esse nível, na aba Cérebro (a linha Conversa) ou numa linha desta tabela. O trabalho pesado vai para tarefas com o modelo do tipo delas, acima.

## Fases da conversa

O cérebro de entrada pesa cada mensagem só para saber de que fase ela é; a fase dá o tom do turno (planejar antes de construir), não o modelo.

| Fase | O que é |
|---|---|
| trivial | um cumprimento ou um comando curto |
| conversa | uma pergunta ou uma opinião, sem trabalho a fazer |
| plano | uma ideia, ou um pedido médio ou grande que ninguém aprovou ainda |
| construção | um sinal verde, ou uma mudança pequena e concreta |

## Limites

- No máximo 10 agentes por fluxo de trabalho.
