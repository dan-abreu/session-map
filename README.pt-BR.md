# session-map

[English](README.md)

Plugin do Claude Code que transforma todas as conversas da sua máquina num cérebro vivo no navegador. Cada projeto é um corpo: **órgãos** e **tecidos** reúnem **células** (as áreas do trabalho), cada célula tem um **núcleo** pequeno (o que foi decidido, o que falta) e os **neurônios** são as suas conversas. Os ramos aparecem como trabalho em andamento, e ao lado do cérebro há quadro, custos e histórico com busca.

![A tela do cérebro](docs/screenshot-brain.png)
![A tela do quadro](docs/screenshot-board.png)

Os prints vêm do `--demo`, que usa dados inventados.

## Instalar

```text
/plugin marketplace add dan-abreu/session-map
/plugin install session-map@session-map
```

**Requisitos:** Claude Code e Node.js 20 ou mais novo no `PATH`. O instalador nativo do Claude Code não traz o Node; sem ele, o servidor, o hook que arquiva as conversas encerradas e os três comandos não rodam.

## Comandos

| Comando | O que faz |
|---|---|
| `/session-map:map` | Liga o servidor local se não estiver no ar e mostra os links (este PC e a rede local). `--local` tira o link de rede, `--port N` troca a porta (padrão 4001). |
| `/session-map:board` | A conversa atual escreve um cartão curto sobre si (área, ramo, fazendo agora, o que falta, o que espera por você) que o mapa lê. |
| `/session-map:history` | Busca no histórico arquivado e responde com resultados curtos. |

Sem o plugin: `node server/main.mjs [--lan] [--port 4001]`, ou `--demo` para dados de exemplo.

## No celular

`/session-map:map` mostra um link com `?k=<token>`. Abra uma vez e o navegador guarda o token num cookie. O token fica em `~/.claude/session-map/token`; toda escrita e todo acesso de fora do `127.0.0.1` exige o token, então trate o link de rede como uma senha. A página só escuta em todas as interfaces com `--lan`. Fora de casa, ponha os dois aparelhos no [Tailscale](https://tailscale.com) e use o link `100.x` que ele mostra. Não exponha a porta na internet.

## Conversar pela página

Para conversas que rodam neste PC, ligue **Enable Remote Control for all sessions** no `/config`: a página passa a oferecer um botão que continua aquela conversa pelo claude.ai ou pelo app do Claude. A página também inicia e conduz conversas próprias com o seu `claude` CLI.

> **Segurança:** uma conversa iniciada pela página pode editar arquivos e rodar comandos neste PC, como qualquer sessão do Claude Code. Quem tem o seu token consegue conduzi-la. Mantenha o token privado e a página fora da internet aberta.

## Custos são estimativas

Custo é o equivalente em preço de API dos tokens do seu histórico local. Não é a fatura da sua assinatura.

## Formatos internos podem mudar

O plugin lê arquivos locais do Claude Code (sessões, transcrições, skills). Esses formatos não são contrato público e podem mudar; tudo que depende deles mora em `server/sources/claude.mjs`, então uma quebra se conserta num arquivo só.

## Privacidade

O servidor lê `~/.claude` (ou `CLAUDE_CONFIG_DIR`) e grava só em `~/.claude/session-map/`: token, configuração, arquivo morto, notas e logs. Dados saem da sua máquina em dois casos.

**Organização por IA, ligada por padrão.** O mapa dá nome e agrupa o seu trabalho com o seu próprio `claude` CLI (`claude -p`, modelo `haiku`), então isso vai para a Anthropic como qualquer prompt do Claude Code. Cada chamada envia um resumo de uma conversa, nunca a transcrição: o título, até 8 prompts seus cortados em 160 caracteres, até 30 caminhos de arquivo, até 10 assuntos de commit, o nome do ramo e os nomes e propósitos das unidades atuais do projeto. Na primeira vez que um projeto aparece, as 60 conversas mais recentes são lidas de uma vez, fora do limite de 30 chamadas por hora; a página mostra o custo estimado dessa primeira organização. Toda chamada conta nos limites da sua assinatura ou no seu gasto de API. Para desligar, ponha isto em `~/.claude/session-map/config.json`:

```json
{ "ai": { "enabled": false } }
```

O mapa passa a agrupar as conversas pelos arquivos que elas mexem e pelos cartões do `/session-map:board`.

**Aba Descobrir.** Pede à API do GitHub repositórios públicos de plugins, e consulta os marketplaces que você já adicionou, só quando você abre a aba. Se `GITHUB_TOKEN` estiver definido, ou se `gh auth token` responder, esse token vai para o GitHub junto com essas consultas, para uma busca mais ampla e um limite de consultas maior.

O link de rede (`--lan`) é HTTP simples: numa rede em que você não confia, use o Tailscale ou `--local`.

## Configuração

As configurações da máquina ficam em `~/.claude/session-map/config.json`. Toda chave é opcional:

```json
{
  "ai": { "enabled": true, "model": "haiku", "maxCallsPerHour": 30, "bootstrapLimit": 60 },
  "budget": { "monthlyUSD": 100 },
  "currency": { "code": "BRL", "rate": 5.4 },
  "projects": {
    "c:/dev/loja": { "roadmap": "docs/ROTEIRO.md", "decisions": { "heading": "Decisões", "pendingWhen": "pendente" }, "autoFetchMinutes": 15 }
  }
}
```

- `ai`: a organização por IA (veja Privacidade). `"ai": { "enabled": false }` desliga.
- `budget.monthlyUSD`: mostra quanto do orçamento mensal o custo estimado já usou.
- `currency`: mostra os custos em outra moeda, na cotação que você informar (1 USD = `rate`).
- `projects`: configurações por projeto, com a pasta do projeto em minúsculas e com `/` como chave. As mesmas chaves podem ficar em `<projeto>/.claude/session-map.json`; a entrada daqui vence.
  - `roadmap`: um arquivo Markdown, relativo ao projeto, cujas linhas `[x]`/`[ ]` (ou ✅/⬜) viram marcos. `decisions` lê, sob o título chamado `heading`, as linhas que contêm `pendingWhen` como decisões esperando por você.
  - `autoFetchMinutes`: roda `git fetch` nesse intervalo, para os ramos enviados de outras máquinas aparecerem. Desligado por padrão.
  - `ai`: `{ "enabled": false }` aqui desliga a IA só naquele projeto.


## Licença

MIT. Veja [LICENSE](LICENSE).
