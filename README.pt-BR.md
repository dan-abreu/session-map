# session-map

[![test](https://github.com/dan-abreu/session-map/actions/workflows/test.yml/badge.svg)](https://github.com/dan-abreu/session-map/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/dan-abreu/session-map)](https://github.com/dan-abreu/session-map/releases)
[![licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

[English](README.md)

Plugin do Claude Code que desenha a **arquitetura do seu projeto como um mapa mental** e pendura cada conversa, ramo e commit do Claude na parte a que pertence. Camadas abrem em partes, partes em grupos e itens; cada item é uma linha de markdown puro no seu repositório. Você vê o que está pronto, o que está em andamento, o que espera por você, quanto custa, e abre uma conversa em qualquer caixa, ou joga uma ideia nova e deixa a IA pôr no lugar certo.

![O mapa mental](docs/images/mind-map-desktop.png)

| Quadro | No celular |
|---|---|
| ![O quadro](docs/images/board-desktop.png) | ![O mapa no celular](docs/images/mind-map-phone.png) |

Os prints vêm do `--demo`, que usa dados inventados (a tela fica em inglês porque os textos do projeto de exemplo são em inglês).

## Instalar

```text
/plugin marketplace add dan-abreu/session-map
/plugin install session-map@session-map
```

**Requisitos:** Claude Code e Node.js 20 ou mais novo no `PATH`. O instalador nativo do Claude Code não traz o Node; sem ele, o servidor, o hook que arquiva as conversas encerradas e os comandos não rodam.

## Primeiros passos

1. Rode `/session-map:map` e abra o link que ele mostra.
2. Escolha um projeto. Se ele já tem pasta de arquitetura, o mapa a mostra na hora. Se não tem, uma faixa oferece criar uma: uma conversa estuda o repositório, propõe as partes e não escreve nada até você dizer OK.
3. Clique numa caixa para ver as conversas, os ramos e os arquivos dela, e conversar exatamente sobre aquele ponto. **Nova ideia** abre uma conversa sobre o projeto inteiro: ela propõe a parte e o grupo, mostra a linha que escreveria e só grava depois do seu OK.

## Mapa de arquitetura

O mapa lê markdown puro, então funciona com ou sem o Claude, e o seu time lê no GitHub. Onde ele procura: a pasta da configuração `architecture`, senão a primeira que existir entre `docs/arquitetura`, `docs/architecture`, `docs/arch` (primeiro a árvore de trabalho, depois o ramo principal).

- `README.md` da pasta: as camadas, num bloco mermaid com `subgraph` ou em títulos `##` que listam as partes.
- Um arquivo por parte: título, parágrafo de abertura, "Onde está no código" (caminhos entre crases, que penduram conversas e ramos na parte) e **O que falta**, a lista de tarefas:

```markdown
### Entrar

- [ ] **em andamento · Ana e Claude · etapa 2 do roteiro:** Mostrar o erro embaixo do campo `lg07`
- [ ] **com a Ana · bloqueia:** Escolher o texto do e-mail de recuperação `lg08`
- [x] **Claude:** Travar a conta depois de 5 tentativas `lg06`
```

Os nomes de seção em português e em inglês funcionam. A skill `architecture` ensina isso a toda conversa, inclusive no VS Code: pedido novo vira item, começar marca em andamento e terminar marca como feito. Veja [docs/architecture](docs/architecture/README.md) com este repositório mapeado do mesmo jeito.

## Comandos

| Comando | O que faz |
|---|---|
| `/session-map:map` | Liga o servidor local se não estiver no ar e mostra os links (este PC e a rede local). `--local` tira o link de rede, `--port N` troca a porta (padrão 4001). |
| `/session-map:board` | A conversa atual escreve um cartão curto sobre si (área, ramo, fazendo agora, o que falta, o que espera por você) que o mapa lê. |
| `/session-map:history` | Busca no histórico arquivado e responde com resultados curtos. |
| `/session-map:architecture` | Ensina a qualquer conversa a convenção do mapa de arquitetura: onde fica, como abrir um item, marcar em andamento e fechar, e como criar o mapa (pedindo antes) num projeto que não tem. |

Sem o plugin: `node server/main.mjs [--lan] [--port 4001]`, ou `--demo` para dados de exemplo.

**Só terminal?** `node server/cli.mjs` (ou `session-map` com o pacote ligado) mostra o mapa em texto: camadas e partes com ● trabalhando / ○ quieto / ! esperando / ✓ tudo feito, depois a lista "Esperando você" e os custos. Ele pergunta ao servidor que estiver rodando e, se não houver, lê o seu histórico direto, com a IA desligada. `--project <nome>` filtra, `--watch` redesenha a cada 5 segundos, `--json` imprime o estado.

## Arquivos

Abra uma parte, um item ou um ramo e a seção **Arquivos** lista os arquivos, com os novos e alterados marcados. Tocar num deles abre só para leitura (até 1 MB, só texto, nunca `.git`, nunca arquivos `.env`) com as linhas que o ramo mudou em destaque. **Abrir no VS Code** abre o arquivo neste PC, **Abrir terminal nesta pasta** abre um terminal ali, e **VS Code no celular** aparece quando você define `tunnelUrl`. Ler arquivos exige o token, como o chat.

## No celular

`/session-map:map` mostra um link com `?k=<token>`. Abra uma vez e o navegador guarda o token num cookie. O token fica em `~/.claude/session-map/token`; toda escrita e todo acesso de fora do `127.0.0.1` exige o token, então trate o link de rede como uma senha. A página só escuta em todas as interfaces com `--lan`. Fora de casa, ponha os dois aparelhos no [Tailscale](https://tailscale.com) e use o link `100.x` que ele mostra. Não exponha a porta na internet.

## Conversar pela página

Para conversas que rodam neste PC, ligue **Enable Remote Control for all sessions** no `/config`: a página passa a oferecer um botão que continua aquela conversa pelo claude.ai ou pelo app do Claude. A página também inicia e conduz conversas próprias com o seu `claude` CLI.

**As conversas ficam.** Uma conversa iniciada numa caixa do mapa aparece na conversa daquela caixa (a usada por último primeiro), e o mapa a mostra naquela parte. Fechar a folha não a interrompe; tocar nela de novo mostra o histórico e continua a conversa (`claude --resume`), mesmo depois de o servidor reiniciar. Recarregar a página reabre a conversa que estava aberta.

**Permissões.** Uma conversa da página roda no modo de permissão do seu próprio Claude Code: `permissions.defaultMode` de `~/.claude/settings.json`, depois o `.claude/settings.json` do projeto, depois o `.claude/settings.local.json` (o arquivo mais específico vence, como no Claude Code). Sem nada definido, é o `default`, que pergunta antes de toda ferramenta que ainda não esteja liberada. O seletor no cabeçalho da conversa muda isso só para aquela conversa: **Igual ao Claude**, **Perguntar sempre** (`default`), **Só edições automáticas** (`acceptEdits`) ou **Automático** (`auto`); a escolha fica guardada por conversa e vale para uma conversa em andamento a partir do próximo passo. O que o modo ainda perguntar aparece na folha com **Permitir** / **Negar** (sem resposta em 25 s, nega), e **Sempre nesta conversa** fica lembrado para aquela conversa, também depois de retomá-la. O `bypassPermissions` nunca é usado: se as suas configurações disserem isso, a página roda a conversa em `auto` e avisa.

**Todo Claude deste PC.** Ao lado do seletor, **Usar em todo este PC** faz do modo escolhido o padrão do seu próprio Claude Code. Depois que você confirma, o servidor grava `permissions.defaultMode` (`default`, `acceptEdits` ou `auto`, nunca `bypassPermissions`) em `~/.claude/settings.json` e não mexe nas outras chaves. O VS Code e o terminal também leem esse arquivo, então o modo vale para toda conversa nova deste PC. Antes da primeira troca, uma cópia do arquivo fica em `settings.json.session-map-bak`, ao lado dele, e **Desfazer a última troca** devolve o valor de antes.

> **Segurança:** uma conversa iniciada pela página pode editar arquivos e rodar comandos neste PC, como qualquer sessão do Claude Code, e em `acceptEdits` ou `auto` faz parte disso sem perguntar. Quem tem o seu token consegue conduzi-la, escolher o modo dela e trocar para `auto` o modo de todo Claude deste PC. Mantenha o token privado e a página fora da internet aberta.

## Custos são estimativas

Custo é o equivalente em preço de API dos tokens do seu histórico local. Não é a fatura da sua assinatura.

## Formatos internos podem mudar

O plugin lê arquivos locais do Claude Code (sessões, transcrições, skills). Esses formatos não são contrato público e podem mudar; tudo que depende deles mora em `server/sources/claude.mjs`, então uma quebra se conserta num arquivo só.

## Privacidade

O servidor lê `~/.claude` (ou `CLAUDE_CONFIG_DIR`) e grava em `~/.claude/session-map/` (token, configuração, arquivo morto, notas e logs) e, só quando você confirma na página, `permissions.defaultMode` em `~/.claude/settings.json`. A pasta de arquitetura de um projeto é escrita pelas conversas, pelo seu `claude` CLI e no seu modo de permissão, não pelo servidor. Dados saem da sua máquina em dois casos.

**Organização por IA, ligada por padrão.** O mapa coloca no lugar as conversas que o código não conseguiu colocar com o seu próprio `claude` CLI (`claude -p`, modelo `haiku`), então isso vai para a Anthropic como qualquer prompt do Claude Code. Só as conversas que nenhum código de item e nenhum arquivo editado conseguiu colocar vão para a IA, uma vez cada. Uma chamada envia um resumo de uma conversa, nunca a transcrição: o título, até 8 prompts seus cortados em 160 caracteres, até 30 caminhos de arquivo, até 10 assuntos de commit, o nome do ramo e o nome, a camada, o propósito e as pastas de cada parte da arquitetura do projeto. No máximo 30 chamadas por hora. Toda chamada conta nos limites da sua assinatura ou no seu gasto de API. Para desligar, ponha isto em `~/.claude/session-map/config.json`:

```json
{ "ai": { "enabled": false } }
```

O mapa passa a colocar as conversas pelos códigos de item que elas citam, pelos arquivos que elas mexem e pelos cartões do `/session-map:board`.

**Aba Descobrir.** Pede à API do GitHub repositórios públicos de plugins, e consulta os marketplaces que você já adicionou, só quando você abre a aba. Se `GITHUB_TOKEN` estiver definido, ou se `gh auth token` responder, esse token vai para o GitHub junto com essas consultas, para uma busca mais ampla e um limite de consultas maior.

O link de rede (`--lan`) é HTTP simples: numa rede em que você não confia, use o Tailscale ou `--local`.

## Configuração

As configurações da máquina ficam em `~/.claude/session-map/config.json`. Toda chave é opcional:

```json
{
  "ai": { "enabled": true, "model": "haiku", "maxCallsPerHour": 30 },
  "budget": { "monthlyUSD": 100 },
  "currency": { "code": "BRL", "rate": 5.4 },
  "tunnelUrl": "https://vscode.dev/tunnel/meu-pc",
  "projects": {
    "c:/dev/loja": { "roadmap": "docs/ROTEIRO.md", "decisions": { "heading": "Decisões", "pendingWhen": "pendente" }, "autoFetchMinutes": 15 }
  }
}
```

- `ai`: a organização por IA (veja Privacidade). `"ai": { "enabled": false }` desliga.
- `budget.monthlyUSD`: mostra quanto do orçamento mensal o custo estimado já usou.
- `currency`: mostra os custos em outra moeda, na cotação que você informar (1 USD = `rate`).
- `tunnelUrl`: o link do seu [VS Code Remote Tunnel](https://code.visualstudio.com/docs/remote/tunnels) (só https); ele cria o botão **VS Code no celular** ao lado dos arquivos.
- `projects`: configurações por projeto, com a pasta do projeto em minúsculas e com `/` como chave. As mesmas chaves podem ficar em `<projeto>/.claude/session-map.json`; a entrada daqui vence.
  - `roadmap`: um arquivo Markdown, relativo ao projeto, cujas linhas `[x]`/`[ ]` (ou ✅/⬜) viram marcos. `decisions` lê, sob o título chamado `heading`, as linhas que contêm `pendingWhen` como decisões esperando por você.
  - `autoFetchMinutes`: roda `git fetch` nesse intervalo, para os ramos enviados de outras máquinas aparecerem. Desligado por padrão.
  - `ai`: `{ "enabled": false }` aqui desliga a IA só naquele projeto.


## Contribuir

Issues e pull requests são bem-vindos: veja o [CONTRIBUTING.md](CONTRIBUTING.md). Para relatar uma vulnerabilidade, veja o [SECURITY.md](SECURITY.md).

## Licença

MIT. Veja [LICENSE](LICENSE).
