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

Tudo fica na sua máquina. O servidor lê `~/.claude` (ou `CLAUDE_CONFIG_DIR`) e grava só em `~/.claude/session-map/`: token, configuração, arquivo morto, notas e logs. Nada é enviado para fora, exceto a aba Descobrir, que pede ao GitHub repositórios públicos de plugins, e os recursos de IA que você ligar, que rodam pelo seu próprio `claude` CLI.

## Licença

MIT. Veja [LICENSE](LICENSE).
