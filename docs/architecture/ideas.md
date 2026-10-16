# Ideas and requests

Every request and idea the owner has given for session-map, in his own words, with the date, what it means, how to check it is done, the item it became in another part, and where it stands. It exists so the owner can confirm in the tool that nothing he asked for was lost, changed or forgotten.

The ideas already done or discarded (ticked) live in [Ideas and requests — closed](ideas-closed.md); this file keeps what is new, accepted, in progress or later.

## Index

- The picture of the project: id16
- The model, the orchestration and other AIs: id22, id97, id99, id23, id24, id25, id26, id28, id73, id93, id122, id123, id124, id127, id128, id129, id130, id131, id132, id133, id134, id135, id136, id137, id138, id139, id140
- Following the work live: id33, id92
- Files, terminal and the first use of a repository: id41, id42
- The Flow: id45, id46, id47, id48, id49, id50, id120
- Clarity and polish: id56, id121, id126
- Reading every detail: id57, id58, id59, id60, id61
- Everything up to date and professional: id62, id63, id64, id70, id71, id72, id86, id125
- What it costs: id98, id105, id106, id107, id108, id109, id110, id111, id112, id113, id114, id115, id116
- This registry: id65, id66, id67
- Economy, context and skills: id100, id101, id102, id103, id104, id145
- Engine and economy: id154, id155, id156, id158

## How it works

Each item is one request. When the owner asked for the same thing more than once, or refined it later, the item keeps every date and quote. Dates are the owner's local time (UTC−3). Quotes are kept word for word in Portuguese; a quote that named a person or another of his projects is paraphrased in square brackets. Every item has five lines: Asked, What it means, How to confirm it is done, Where it went (the item codes in the other parts) and Status.

Status is one of: new (not yet looked at), accepted (an item exists and is planned), in progress, done (with the release it shipped in, or "on main" when it is merged but not yet released), later (kept, not committed) or discarded (with the reason). A ticked box means nothing is left to do here: the request is done, or it was replaced and the reason is written. The work itself is tracked in the item it went to; this file only follows the request.

## Where in the code

Nothing here is code. The registry is this file, read by the map like every part:

- `docs/architecture/ideas.md`

## Rules that must not break

- A request is never deleted: one the owner reversed or replaced stays, ticked, with status discarded and the reason.
- Every item says where it went; "not yet an item" is allowed only until the item is created.
- No personal data: no names of people, no paths, addresses or links of the owner, no names of his other projects.
- A new request from the owner is added here the same day, next to the item it creates in its part.

## What's missing

### Seeing my requests


### The picture of the project

- [x] Lines inside a part, showing what is tied to what `id16`
  - Asked: 2026-10-09 06:12 — "Dentro das próprias celulas tem as linhas mostrando uma coisa ligada na outra?"; 2026-10-09 06:14 — "Sim"
  - What it means: inside one part, its components (screens, routes, modules, files) and the real links between them, not only links between parts.
  - How to confirm it is done: a double click on a part opens its inner view with components and labeled arrows taken from the code; a component lights while a chat edits one of its files.
  - Where it went: `fl09`, `mm15`, the middle level in `mm34` (it was part of `mm24`).
  - Status: done on 2026-10-16 except two parked tails (`mm15`, `mm34`; parked in the triage of 2026-10-16). Before: accepted.

### The model, the orchestration and other AIs

- [x] Other AIs through their APIs, with Claude as conductor (the Arsenal) `id22`
  - Asked: 2026-10-09 08:27 — "tem como colocar para colocar APIs de outras IA, assim voce fica como orquestrador e usa outras IAs naquilo que elas são boas, assim o projeto acaba ficando mais barato"; 2026-10-09 08:31 — "porque tem IA´s que são boas com videos, outras com outras coisas assim por diante, o programa com o arsenal completo, e com os repositorios corretos e skills corretas, teriamos um negocio legal para ajudar a fazer um projeto e rodar uma empresa"; 2026-10-09 08:44 — "sim"; 2026-10-10 — "quero que faça agora com urgencia, a questão de colocar as API de outras IA de deixar bem organizado, como falamos no plano"; 2026-10-10 — "acho que voce não entendeu bem, quero que use todas as IA que tiver API ao mesmo tempo e voce orquestrando e nao eu escolhendo quais voce vai usar"; 2026-10-10 — "eu quero que voce seja o orquestrador, essas IA vão entrar para voce como sub agentes para as tarefas, você ver a atividade, toma a melhor decisão e encimanha as IA para fazer os trabalhos"; 2026-10-10 — "quero que entenda como um orquestrador, que você vai ter essas IA, vai ter os modelos do claude e o nivel do claude,você tem que sozinho entender o nivel que deve ser feito e tomar as melhores decisões e saber onde usar as IA´s contando com voce e modelos."
  - What it means: Claude conducts and calls the AI that is best for each job (video, image, voice, bulk text, code) with the right repositories and skills already chosen; session-map is the panel showing each business area, what is being done, by which AI and at what cost.
  - How to confirm it is done: with a second provider's key set, a bulk task is sent to it, its cost shows next to the Claude cost, and the result is reviewed by Claude before it is accepted.
  - Where it went: `or11`, `or12`, `sb07`, `mm19`; the routing research in `or05`; `or14`, `or16`, `or04`, `or15`, `or19`.
  - Status: done on 2026-10-16 except `mm19` (parked in the triage of 2026-10-16). Before: in progress. Done by 2026-10-10: keys, providers, one daily cap (US$ 5), the dispatcher over every AI with a key (`or14`), the arsenal tools in every chat (`or11`, first piece), the bench (`or12`), the panel by real use (`or16`), the conductor that knows the whole arsenal with Fable (`or04`, in progress). Left: the teams really using the other AIs (`or19`), watching versions and growing the bench (`or15`), budgets and priority (`or07`, `or08`), the other AIs working on files (step 4 of `id93`).
- [ ] **in progress:** Finish the orchestration plan, then keep refining it without forgetting anything `id97`
  - Asked: 2026-10-11 — "quero finalizar o plano que traçamos e depois vamos refinando sem esquecer acrescentando isso em solicitacoes para nao esquecee"
  - What it means: close what is left of the plan traced on 2026-10-10 (quality and economy with Claude as the conductor of every AI), and keep every refinement written here and in its part so none is lost between conversations.
  - How to confirm it is done: `or04`, `or07`, `or08`, `or15` and `or19` are ticked in Orchestration; the owner's open decisions (`op08`, `op09`) are answered; the panel shows the other AIs doing real work with Claude's accept/refuse.
  - Where it went: `or04`, `or07`, `or08`, `or15`, `or19`; the owner's part in `op08`, `op09`.
  - Status: in progress (recorded on 2026-10-11).
- [x] Never think the chat is working when it stopped: "Esperando você" with the reason `id99`
  - Asked: 2026-10-11 — "está parado novamente pedindo minha ação, preciso que quando não tiver nada em atividade, o chat vá para o esperando você e me dê um norte porque parou, pensei que estivesse trabalhando"
  - What it means: a chat with nothing running moves to "Esperando você" at once with one plain line on why it stopped; and a restart of session-map asked by another chat no longer kills a team working in the background (it waits, or the team resumes by itself).
  - How to confirm it is done: start a long team in a chat and ask a restart from another: the team keeps going (or resumes alone) and the first chat never looks idle while working; when it really stops, it shows in "Esperando você" with the reason.
  - Where it went: `pc25`, `sv16`.
  - Status: done on 2026-10-14 (`sv16` by Gemini on 2026-10-13; `pc25` built by `pc34`: the state line above the box never goes dark and says why it waits).
- [ ] A detailed, categorized list of AIs `id23`
  - Asked: 2026-10-09 11:45 — "faz uma lista minunciosa de IAs e categoriza"; 2026-10-09 11:55 — "é bom"; 2026-10-10 — "voce pode da uma pesquisada a qualidade de cada IA e colocar elas no lugar certo mesmo, assim voce faz com mais certeza"
  - What it means: every relevant AI by category (text and code, image, video, voice, transcription, web search, document reading, vector search, browser automation, workflows, gateways), with what it is good for, price, API, open weights and privacy notes, from official price pages where possible.
  - How to confirm it is done: the "Which AI for each task" section in the tool lists each category with at least one choice, its price, the source and the date the price was checked.
  - Where it went: `mm19` (the research itself was done on 2026-10-09 and kept in the maintainers' notes).
  - Status: later (owner's choice on 2026-10-10, `op06`).
- [ ] Discover kept up to date in full, and for every AI `id24`
  - Asked: 2026-10-09 11:42 — "como está sendo essa busca de repositorios e skills no github?"; 2026-10-09 11:43 — "sim, e quero saber como ela é atualizada na integra"; 2026-10-09 11:44 — "tem que ser para todas as IA, porque vamos trabalhar com outra IA também, como falamos antes para voce orquestrar e outra IA fazer"
  - What it means: Discover refreshes itself in the background and pages past 50 results per topic; it also lists what works with Codex, Gemini, Cursor and any MCP client, with a "Works with" filter; and it recommends what fits the open project.
  - How to confirm it is done: without pressing Update, the catalog date moves forward daily; a topic with more than 50 repositories shows them all; the "Works with: Gemini" filter shows only entries that declare it.
  - Where it went: `mm20`, `mm18`, `mm17`.
  - Status: later.
- [x] An impeccable senior conductor, not a cheap one `id25`
  - Asked: 2026-10-09 13:53 — "agora ele tem que ser um orquestrador impecavel, para nao gastar atoa, colocar as IAs no lugar certo no nivel certo, assim nenhum projeto vai estourar limites de tokens porque está trabalhando com sseion mao"; 2026-10-09 13:54 — "nao economico, mas sim impecavel, senior, orquestrador, inteligente"; 2026-10-10 — "eu quero que essa engenharia seja perfeita mesmo, para da alta qualidade e economia, para não ser algo que vá atrapalhar mais do que ajudar, então a engenharia do session-map tem que ser perfeita para isso, para fazer os projetos até de alta complexidade, com qualidade altissa nivel industrial e profissional e uma economia no bolso máxima, assim vou conseguir garantir um produto de qualidade e baixo custo"
  - What it means: quality first and saving as a consequence: understand, look at the architecture and Flow, break down and order the work, pick the model the task needs, ask for a second opinion, call nothing done without proof, learn from mistakes per kind of task, route by kind, keep context lean, a monthly budget, a priority queue, and watch the plan's weekly limit.
  - How to confirm it is done: a test request shows the plan, the model picked per step with its reason, a review step and the proof before "done"; a project past 80% of its budget gets an alert; a weekly-limit warning in a history holds the non-urgent work.
  - Where it went: `or04`, `or05`, `or06`, `or07`, `or08`, `wa09`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: accepted.
- [ ] A board of roles: think like a CEO `id26`
  - Asked: 2026-10-09 13:55 — "estrategista, marketeiro, financeiro, todos os termos que voce possa pesquisar e entender como um CEO, que vai definir todas as coisas, pensando em dinheiro, pensando em projeto, pensando em entrega, pensando em tudo emsmo"
  - What it means: the orchestration chat weighs each relevant proposal as CEO, Product, Marketing, Finance, Operations, Technology and Legal would (value, cost to build and run, return, timing, positioning, legal risk) and ends with a recommendation; decisions on money, accounts and business priority stay with the owner.
  - How to confirm it is done: a proposal put to the orchestration chat comes back with one paragraph per applicable role and a recommendation, and a money decision waits for the owner's one-click confirmation.
  - Where it went: `or09`, `or10`.
  - Status: later (owner's choice on 2026-10-10, `op06`).
- [ ] Earn some money with it `id28`
  - Asked: 2026-10-09 00:35 — "Da pra ganhar um dinheirinho com isso?"; 2026-10-09 00:40 — "Não, só tô pensando alto"
  - What it means: a possible paid team plan in the cloud (a map shared between machines), or the Arsenal as a product; nothing of it goes into v0.x.
  - How to confirm it is done: a strategy decision is written (audience, first slice, how it earns) and an interest list exists after the launch.
  - Where it went: `sv05`, `or11`.
  - Status: later (thinking aloud).
- [x] Trained agents: the orchestrator calls the right specialist, held rigid by the engine, for every AI `id152`
  - Asked: 2026-10-15 12:55 — "eu percebi que agora no cerebro, como estão separados os agentes, podemos explorar essa area, quero ter agentes treinados, tipo arquitetura, o orquestrador vai chamar aquele agente, é para código o orquestrador vai chamar aquele agente, então vai acabar que é para deixar os agentes mais organizados e aptos a fazem as coisas melhor e com mais qualidade, colocando rigidez, mas não através de documentos lidos, mas motor. da pra fazer isso? e esses agentes têm que servir para todas as IA, o que me diz, como podemos fazer isso?"
  - O que significa: cada especialidade vira um agente definido no motor (arquitetura, código, teste, tela, depuração, revisão, documentação, busca): um catálogo onde cada papel tem sua função (a linha do Cérebro), seu modelo e nível (já da política), as ferramentas que pode usar, as skills que pode abrir e a porta de saída (contrato, testes, revisão). O orquestrador chama o papel pela etiqueta de tipo; a rigidez é do motor, nunca de um documento lido; e o mesmo papel serve a qualquer IA com chave.
  - Como conferir: o Cérebro mostra os agentes um por um (motor, modelo, nível e portas); um agente `[code]` que não passa os testes não entrega; um `[money]` sem o dono não age; o mesmo papel roda em qualquer IA e responde no mesmo contrato.
  - Onde foi: `or55` (o plano: `docs/superpowers/plans/2026-10-15-specialist-agents.md`).
  - Situação: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (o item `or55` aberto e construído em 2026-10-15: catálogo, motor, guarda e a seção no Cérebro, com testes verdes).
- [x] Train the specialists to senior level, researched first `id149`
  - Asked: 2026-10-15 13:20 — "mas eu quero que você deixei ele bem treinados mesmo, nivel senior. Prefiro que até pesquise antes para treina-los"
  - O que significa: os 9 especialistas do catálogo (`or55`) ganham o treino de nível sênior — mas primeiro a pesquisa: as melhores práticas de engenharia de agentes (Anthropic e fontes de 2026) vão para as notas no repositório, e daí sai o que cada papel ganha: um método de trabalho sênior fixo (do catálogo), portas de entrada na guarda (o brief vago é negado, como a porta do dinheiro) e o método visível no Cérebro — rigidez sempre pelo motor, nunca por leitura solta.
  - Como conferir: as notas de pesquisa existem com as fontes; o dono aprova o que entra; cada papel mostra seu método no Cérebro e um brief sem o ingrediente sênior é negado na hora.
  - Onde foi: `or56` (o plano: `docs/superpowers/plans/2026-10-15-senior-training.md`).
  - Situação: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (construído em 2026-10-15: os nove métodos sênior no catálogo, a linha do papel com o método, as quatro portas de entrada na guarda e o método no Cérebro — 56 testes verdes nas suítes tocadas).
- [x] The agents economical by law: everything motor, reading little before working `id150`
  - Asked: 2026-10-15 13:36 — "eu quero que os agentes sejam econômicos, então tem que ser tudo motor, porque se eles forem ler meio mundo de coisa antes de trabalhar vai me sair é caro"
  - O que significa: a economia dos agentes vira lei no motor, não conselho — mas sem capar a capacidade: o brief é limitado **por papel** (os trabalhadores ficam com o limite enxuto; o revisor, o planejador e o arquiteto levam mais, porque o trabalho deles é carregar contexto), o agente não relê o mapa nem as regras **exceto o arquiteto e o planejador, cujo trabalho é o mapa** (o maestro leu uma vez; o brief leva o capítulo, `or23`/`or32`), e não lê arquivo grande inteiro — fatia com offset/limit ou usa o índice (`id101`). A guarda passa a enxergar a ferramenta Read para segurar essas portas; brief ilegível falha aberto.
  - Como conferir: um brief acima do limite do papel é negado antes de nascer; dentro do agente, ler `docs/architecture`/`docs/standard`/`CLAUDE.md` ou um arquivo inteiro acima de 64 KB é negado na hora (o arquiteto e o planejador leem o mapa e os padrões); o maestro continua lendo livremente; os testes da guarda provam cada porta e cada exceção.
  - Onde foi: `or57` (o plano: `docs/superpowers/plans/2026-10-15-agents-economy.md`).
  - Situação: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (construído em 2026-10-15: o limite do brief, as portas de leitura e o matcher com Read — 45 testes verdes nas suítes da guarda).
- [x] All the engines: the ones of the AIs and the ones the program still misses — the whole plan of this conversation, nothing left behind `id151`
  - Asked: 2026-10-15 14:52 — "então vamos fazer os motores"; 2026-10-15 14:56 — "vamos fazer todos os motores das IA e o motores do programa que falta, vamos completar esse plano que tem nessa conversa sem deixar nada pra traz"
  - O que significa: duas frentes, uma por vez: (A) os motores internos que faltam — a porta de saída por papel no OK do motor (o turnCheck lê os papéis que trabalharam no turno e cobra a prova de cada um: plano para o planejador, testes para quem escreve código), o maestro alinhado aos papéis (o bloco curto dos nove papéis no prompt do condutor) e o gasto por agente/papel no painel (agregação mecânica do extrato, sem IA); (B) os motores das outras IAs (etapa 4 do `id93`) — o executor que faz o mesmo papel rodar em DeepSeek, OpenAI e Gemini editando arquivos numa cópia isolada, com detecção dos CLIs oficiais, as mesmas portas do papel aplicadas pelo programa antes e depois, e o Cérebro mostrando qual motor edita arquivos hoje.
  - Como conferir: o OK do motor mostra os papéis que trabalharam e o que falta para cada um; o condutor escreve briefs que passam de primeira; o painel mostra quanto cada papel gastou; um agente roda em outra IA numa cópia isolada, passa pelas mesmas portas e o resultado volta com testes e revisão.
  - Onde foi: `or58`, `or59`, `or60` (internos), `or61`, `or62` (as outras IAs) e `or63` (o gatilho no arsenal) — o plano mestre: `docs/superpowers/plans/2026-10-15-motores-completos.md`.
  - Situação: feito (construído em 2026-10-15: o OK do motor lê os papéis, o maestro conhece os nove especialistas, o painel soma o gasto por papel, o executor roda o papel em outra IA numa cópia isolada com as mesmas portas, o Cérebro diz qual motor edita arquivos hoje, e o maestro ganhou o gatilho run_other_ai/merge_other_ai — 182 testes verdes nas suítes tocadas).

### Following the work live

- [ ] **in progress:** Every conversation exactly as Claude Code shows it, with times, and its origin clear `id33`
  - Asked: 2026-10-09 12:55 — "agora falo, as conversas no claude e conversas no vscode, vão aparecer como lá? tem que ser auto explicativo, saber de onde veio"; 2026-10-09 14:34 — "não to achando esse chat aqui no session"; 2026-10-09 14:36 — "eu quero os chats la identico a esse, todos igual mesmo, com o horario com tudo"; 2026-10-09 14:39 — "não quer completar logo tudo por aqui, porque la, ta faltando muita coisa, não da pra saber quando o chat é o claude ou vs, nao ta seperado os chats, tem muita coisa que precisa ser feita, mas não está acabada, mas pelo menos por la eu consigo acompanhar o que está sendo feito correto?"
  - What it means: every message of every conversation with the same formatting as Claude Code, the time of each message, Claude's steps, questions and answers, images, helpers and costs; each conversation's origin (VS Code, terminal, map, claude.ai) shown with a badge; the same chat screen and composer as Claude Code.
  - How to confirm it is done: open a long VS Code conversation on the page and compare side by side with Claude Code: same messages in the same order, same times, same formatting; its row carries the "VS Code" badge.
  - Where it went: `mm22`, `mm23`, `mm04`, `mm33`; claude.ai conversations `rd04`.
  - Status: in progress (`mm22`, reading every conversation like Claude Code with the full composer, and `mm33`, the list that shows at a glance where each chat comes from and what it is doing, are released in v0.2.3; `mm23` is open; `rd04` waits for the owner's OK).
- [x] After a crash or a restart, the conversations that were working are easy to bring back; delete or archive conversations; the list split by state `id82`
  - Asked: 2026-10-10 — "seria bom fica explicito as conversas que estavam trabalhando, quando o servidor cair ou pc reiniciar, fica facil voltar o serviço, pode ficar no painel, também ter a opçao de deletar as conversas ou arquivar elas, e também separar as converas pelas opções de \"esperando você\", essas coisas eu nao sei todas"; 2026-10-10 — "Sim, pode reforçar."
  - What it means: when the server falls or the PC restarts, a panel lists the conversations that were working at that moment, from any origin, with Continue on each and Continue all; a conversation can be archived (hidden, comes back) or deleted from session-map (asks for confirmation; the conversation file itself stays on the PC, so Claude Code still has it); the conversation list can be filtered by state: Working, Waiting for you, Cut off, Finished, Archived.
  - How to confirm it is done: restart the server while two chats work: on opening the map, the panel shows both with Continue; Continue all brings both back; archive one and it leaves the list and comes back in Archived; delete one, confirm, and it is gone from the map; a click on "Waiting for you" shows only those.
  - Where it went: `mm43`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (`mm43` built on 2026-10-10 with a reinforced team: the Cut off panel with Continue and Continue all, Delete from session-map with confirmation next to Archive, the state filters with counts; waiting for the next version; deleting the conversation file on the PC too was not chosen and stays out).

### Files, terminal and the first use of a repository

- [ ] Create and edit files and folders, and a terminal inside the page `id41`
  - Asked: 2026-10-09 00:22 — "Criar arquivos também? Criar pastas, usar também os terminais"
  - What it means: create, rename, delete and save files and folders from the page, and a real terminal inside the page; until then, a chat creates files with Allow / Deny.
  - How to confirm it is done: a file created on the page exists on disk; the in-page terminal runs a command in the project folder; both need the key.
  - Where it went: `mm12`, `mm13`.
  - Status: later (the terminal needs a native module, which breaks the no-npm rule; decide before starting).
- [ ] Build the map and the Flow by itself for a repository that has none `id42`
  - Asked: 2026-10-09 13:45 — "e quando a pessoa adiciona o repo dela e não tem mapa e nem fluxo voce criar minunsosamente o mapa e o fluxo do zero mesmo, deixa tudo organizado como padrão do programa"; 2026-10-09 13:45 — "sem pedir permissão mesmo, já cria, depois se a pessoa não gosta ela retira o que voce acha?"
  - What it means: the middle path decided: it builds a complete architecture and Flow without asking, as a draft in session-map's own storage; a big "Save to project" writes them; a switch saves automatically; Redo and Erase are there.
  - How to confirm it is done: adding a repository with no map produces a draft map and Flow with nothing written in the repository; Save to project writes the folder; Erase removes the draft.
  - Where it went: `bi01`, `bi02`, `bi03`, `bi04`.
  - Status: later (owner's choice on 2026-10-10, `op06`).

### The Flow

- [x] Export and import in any format, with the AI filling the Flow in `id45`
  - Asked: 2026-10-09 10:12 — "tem outros formatos ou mmd é o mais usando?"; 2026-10-09 12:54 — "ai eu exporto no formato que eu quero ou importo quando eu quiser, mas depois que a IA ela ler o formato ela mesmo preenche sozinha o FLOW"
  - What it means: export as SVG, PNG, Markdown, draw.io and PlantUML beside `.mmd`; import draw.io, PlantUML, Graphviz, Excalidraw, or an image or PDF of a drawing, which the AI turns into the Flow and matches to the parts.
  - How to confirm it is done: each export opens in its own tool; importing a draw.io file and a photo of a sketch both reach the import preview with each box matched to a part or marked new.
  - Where it went: `fl06`, `fl13`, `fl14`.
  - Status: done on 2026-10-16 except `fl14`, the import from other drawing tools (parked in the triage of 2026-10-16). Before: accepted.
- [ ] A fluid Flow: the AI builds it from the project, it opens without a key and keeps itself current `id46`
  - Asked: 2026-10-09 12:33 — "eu nao entendi como resolve isso aqui, era pra ser fluido, tem o projeto a IA ela constroi o fluxo grama e depois transforma em mmd ou qualquer formato que a pessoa queira exporta"; 2026-10-09 12:54 — "e também em flow para ver como está o diagrama do trabalho, isso tem que ser automatico"; 2026-10-09 13:00 — "ainda nao vejo o flow funcionando"
  - What it means: the Flow opens on this PC without asking for the key; a project with an architecture but no diagram shows an automatic draft at once, with "Improve with the AI" and "Save to project"; the diagram then updates itself.
  - How to confirm it is done: from `127.0.0.1` the Flow tab draws with no key; a project without a diagram shows the "automatic draft" label at once; adding a part makes its box appear within the next batch.
  - Where it went: `fl04`, `fl05`, `fl11`.
  - Status: accepted.
- [ ] Everything updates by itself, also when changed outside session-map `id47`
  - Asked: 2026-10-09 12:41 — "e como é atualização das coisas? a IA ela vai vasculhando novamente? vamos dizer que foi atualizando e nao pelo programa mas atualizou direto pelo vscode ou por outra area?"; 2026-10-09 12:44 — "e como é atualizado o fluxo?"; 2026-10-09 12:46 — "vamos fazer isso, vamos fazer atualizar sozinho, assim vamos automatizar tudo para quem é vibe code e nao sabe trabalhar mas isso ajuda muito"
  - What it means: a change made anywhere (VS Code, terminal, another tool) is picked up by itself: only the changed files are read again (by hash), the map, Flow and documents follow, and each automatic change can be undone.
  - How to confirm it is done: edit a file in VS Code with session-map closed, start it: only that file is read again and the boxes and docs that depend on it are updated or flagged; Undo reverts an automatic Flow batch.
  - Where it went: `fl11`, `wa10`, `fd06`, `bi05`.
  - Status: accepted.
- [ ] A detailed Flow, not a thin one `id48`
  - Asked: 2026-10-09 13:09 — "achei o fluxo bem magro, acho que tinha que ser mais minuncioso"; 2026-10-09 13:17 — "sim"; 2026-10-10 04:50 — "o fluxo nao ta bem feito"
  - What it means: one model behind every view; level 1 with actors and outside services and labeled arrows; level 2 inside each part; level 3 with numbered end-to-end journeys; declared and detected kept apart.
  - How to confirm it is done: level 1 shows the actors and outside services with a label on every arrow; a double click opens a part's inner flow; the Journeys tab shows 3 to 6 numbered journeys, each step tied to a part.
  - Asked: 2026-10-10 — "preciso que comece a trabalhar dentro da aba fluxo para deixar o fluxo como pedi"
  - Where it went: `fl07`, `fl08`, `fl09`, `fl10`.
  - Status: in progress (`fl08`, `fl09` and `fl10` released in v0.3.0; `fl07` done without the AI, the AI wording is left).
- [ ] Golden rule: map, Flow and architecture move together `id49`
  - Asked: 2026-10-09 13:43 — "outra coisa o que for adicionado no mapa vira fluxo se for função e se for adicionado no fluxo vira arquitetura automaticamente. também pedidos, `quero isso assim assassado` se é fluxo vira fluxo, mas vira também arquitetura, nada de criar coisas sem criar arquitetura e fluxo"
  - What it means: a new feature or part in the map gives a box and arrows in the Flow; a new box in the Flow gives a part in the architecture; a request in any chat does both; a small task is only an item; new code outside the map is flagged or added.
  - How to confirm it is done: invariant tests pass (no part without a box, no box without a part except actors and outside services); asking a chat for a new feature changes both the part files and the diagram in the same turn.
  - Where it went: `fl12`, `pt04`, `wa10`.
  - Status: accepted.
- [x] Architecture and Flow at industry level, using what open source already does well `id50`
  - Asked: 2026-10-09 15:30 — "tem algum repositorio que podemos aproveitar para colocar isso no nosso programa?"; 2026-10-09 16:17 — "outra coisa acho que o programa até está indo muito bem mas esquecemos do foco que a arquitetura e o fluxo também tem que ser muito bem feito, se for preciso procura repositorio que faça isso"
  - What it means: the research found no open project that builds a verified C4 model from code; the plan copies the method of the best ones (facts from a parser, AI only enriching, every fact marked extracted or inferred with its file and line, incremental update by hash) and calls a few tools as options.
  - How to confirm it is done: the architecture-core pipeline is built and every node and arrow in the model carries its origin and evidence.
  - Where it went: `fd03`, `fd02`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: accepted.

### Clarity and polish

- [x] A readable chat: formatting and an input box that grows `id56`
  - Asked: 2026-10-09 16:04 — "nossa chat nao pega formatação nenhuma de nada ta cru, e também a onde escreve ele não vai crescendo de acordo com o que vai digitando ele é grande de mais e acaba que tem muita informação no chat e fica pouca coisa para a parte do dialogo a gente podia reever como melhorar e refinar isso"
  - What it means: replies rendered as markdown like Claude Code (headings, lists, tables, code with copy, links); the input starts at one line and grows to about 40% of the panel; a compact header; controls that fold away, so most of the height is dialogue.
  - How to confirm it is done: a reply with a table and a code block renders both; the empty input is one line high and grows while typing, then scrolls; the header takes one line.
  - Where it went: `mm08`, `mm22`, `mm23`.
  - Status: done on 2026-10-14 (markdown replies, the growing input and the folding controls released in v0.2.3; the header keeps the box tabs on their own line since `pc34` — the one-line try hid them on the owner's screen; the model and the mode stay in the composer's bar instead of a second header line).
- [x] Repaginar o chat da página: organizar, padronizar, completar as opções e limpar o visual `id121`
  - Asked: 2026-10-14 — "eu quero da uma repaginada no chat do session-map, ele está muito desorganizado, não está padronizado, falta muitas opções, falta muita coisa e está tudo muito bagunçado e visualmente mais bagunçado ainda"
  - What it means: the page chat gets one coherent design: every control follows the same standard (buttons, menus, chips, state lines), the controls that are stacked or repeated get one clear place each, the options a professional chat needs are filled in, and the visual noise goes so the dialogue is the center.
  - How to confirm it is done: opening a page chat, every control reads in the same style and size, nothing is stacked or duplicated, the missing options (actions on messages, context, history) are there, and the chat looks clean, like the big AI chats.
  - Where it went: `pc34`.
  - Status: done on 2026-10-14 (`pc34`); waiting for the owner to try it after the next restart of session-map.
- [x] **in progress:** The chat according to the brain: the pre-brain options out of the engine and of the composer, rebuilt lean `id146`
  - Asked: 2026-10-15 10:50 — "agora precisamos ajeitar o chat de acordo com o cerebro, como já existe o cerebro agora, ta cheio de opções ali, eu não quero sair criando coisas por cima de coisas, quero um código enxuto, o chat"; 2026-10-15 11:20 — "por mim a gente poderia tirar tudo isso, e refazer do zero e tirar também do motor esse monte de opções que foi criado antes do cerebro"
  - What it means: the Cérebro routes every AI function (or39–or42), so the options the chat kept from before it — the ways menu, the model and reasoning chips, the Ultracode door, the context and permissions sections — leave the composer, and the engine pieces they moved (the ways, the per-chat model choice) are removed; the chat's bottom is rebuilt lean on the brain's line.
  - How to confirm it is done: the composer shows the box, the attach, the hints, the cost chip, the brain's line and Send — no ways menu, no model chips, no duplicated context or permissions; the engine no longer parses or runs the removed ways; the tests pass.
  - Where it went: `pc35`, `or48`.
  - Status: done (built on 2026-10-15; the full suite passes for everything this change touches — 4537 of 4556, the 17 left belong to other items in flight).

### Reading every detail

- [ ] **in progress:** Read everything, every detail of the program `id57`
  - Asked: 2026-10-09 13:47 — "´ótimo, mas não gostei do que a IA leu" [of one of the owner's projects] "achei que ela não foi minunciosa em tudo, tem que puxar tudo mesmo"; 2026-10-09 13:47 — "tem que ler tudo mesmo, cada detalhe, cada centimetro do programa"
  - What it means: every file read in full and recorded in a read ledger, with "100% read" or the list of what is missing, more rounds until closed, and later only what changed; the shallow first map of that project redone with this method.
  - How to confirm it is done: the report of a study says "100% read" with the per-file ledger; a file left out on purpose is listed with the reason; a second study reads only the changed files.
  - Where it went: `bi04`, `bi05`, `bi06`, `fd01`.
  - Status: in progress (part of the foundation delivery started on 2026-10-10).
- [ ] A perfectionist inspector that sees even the wrong commas `id58`
  - Asked: 2026-10-09 13:49 — [not only about that project, but the program] "ele tem que ser minuncioso, tem que ser detalhista, perfeccionista, tem que ser ver tudo, até as viruglas erradas, precisamos disso"; 2026-10-09 13:50 — "tem que ser um detalhista sem deixar passar nada, a pessoa chata que ver tudo, perfeccionista ao extremo"
  - What it means: an inspection of every file for text, code, defects, security, tests, documentation and UI problems, each finding an item with file and line, weight and "what · why · how to fix"; rounds until one finds nothing; grave findings checked twice; session-map inspected before each release.
  - How to confirm it is done: on a test repository with planted mistakes (a wrong comma, an unused function, a secret, a broken link), every one becomes an item with its file and line; the report lists what was checked.
  - Where it went: `bi07`, `bi08`, `bi09`, `bi10`.
  - Status: later (parked in the triage of 2026-10-16: the inspector `bi07` to `bi10` waits). Before: accepted.
- [ ] Understand the programs first: an exhaustive foundation before new features `id59`
  - Asked: 2026-10-09 14:54 — "acho que arquitetura montada ficou muito generica, não detalhou bem tudo o que tem no programa, por isso está acontecendo, como tudo deve ser documentado então acaba que ele documentou por cima e nao minunciosamente detalhes e também a mesma coisa com session, como vou fazer para uma ferramente sair reamente trabalhavel nivel de industria dessa forma?"; 2026-10-09 14:58 — "claro que a prioridade é entender os programas, como vai orquestrar em cima de algo inefieciente?"; 2026-10-10 04:53 — "preciso da fundação primeiro mas voce fica me entregando pedacos dela"; 2026-10-10 04:54 — "preciso de tudo e nao so uma parte"
  - What it means: after the polish package, new features freeze and the foundation comes first: exact facts from the code by deterministic extractors, the AI only explaining and grouping, coverage measured; then the maps are redone and measured; only then the orchestration chat.
  - How to confirm it is done: the Foundation part's items are ticked and the redone maps show their measured coverage before `or01` starts.
  - Where it went: `fd01`, `fd02`, `fd03`, `fd04`, `fd05`, `fd06`, `fd07`, `fd08`, `fd09`, `fd10`, `fd11`, `fd12`, `fd13`, `fd14`, `fd15`, `op02` (the whole foundation in one delivery, not in pieces).
  - Status: in progress (the whole foundation approved by the owner on 2026-10-10 as one delivery, with the project box showing the whole repository, id77).
- [x] A census letter by letter, number by number `id60`
  - Asked: 2026-10-09 15:01 — "o que deve ser feito é se nao tiver documentação para tal coisa e ele enxergar e criar a documentação, mas sim fazer um vasculho completo, letra por letra, numero por numero de cada arquivo, computar isso e deixar isso organizado, programa tem 1000 letras, 100 linhas, 10 arquivos, 2 pastas, assim vamos ter certeza que ele não deixou passar nada,"
  - What it means: a count without AI of characters, words and lines of every file, summed per folder, part and total; the AI's reading checked against the same counts; every file with an owner; missing documentation written from the code.
  - How to confirm it is done: see `fd01`.
  - Where it went: `fd01`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [x] Stop the AI from hallucinating when it reads `id61`
  - Asked: 2026-10-09 15:51 — "essa questão de leitura de dados é bem forte, uma IA em leitura alucina muito como fazer para ela não fazer isso, realmente entregar o que é proposto?"
  - What it means: seven rules: facts only from deterministic tools; a closed vocabulary of ids; a file-and-line citation checked for every claim; reading with the text present; two readers and an adversarial check on important points; visible badges (confirmed, AI interpretation, not found); accuracy measured on repositories with an answer key.
  - How to confirm it is done: see `fd04`.
  - Where it went: `fd04`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).

### Everything up to date and professional

- [x] Nothing outdated, anywhere, in real time `id62`
  - Asked: 2026-10-09 16:28 — "percebi que o readme esta defasado, mesmo depois das atualizações, imagens e etc. Agora nao quero que foque apenas no readme, mas sim em tudo, nada pode ficar desafasado o que esse programa precisa é deixar tudo atualizado na integra em tempo real, organizado sem deixar passar nada e não esquecer de nada"
  - What it means: session-map refuses to publish a release with stale screenshots, mismatched versions, a missing changelog section, a README that cites what does not exist, broken links or unticked done items; and for any project a watcher flags documentation that no longer matches the code.
  - How to confirm it is done: see `fd05` and `fd06`.
  - Where it went: `fd05`, `fd06`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [x] "Tudo em dia?" must really mean everything `id63`
  - Asked: 2026-10-09 16:29 — "mas nesse teu tudo em dia o que voce está colocando?, tudo mesmo?"
  - What it means: an official checklist of eight groups, each line marked confirmed, warning or not verified, proving what was checked.
  - How to confirm it is done: see `fd07`.
  - Where it went: `fd07`, `fd24`.
  - Status: done on 2026-10-16 (`fd24`: the refresh round now runs the blocks, so the checklist is filled for every project it reads; a real round on this repository gives 5 confirmed, about 20 warnings and the rest not verified, each with its reason).
- [x] Everything a professional repository needs, and versions in sight `id64`
  - Asked: 2026-10-09 16:30 — "tudo o que um repositorio profissional precisa, eu nao sou profissional, além disso eu nao sei as versoes dos programas que estou trabalhando nao esta bem aparente, não foque em apenas em algo que eu digo, pegue a ideia por completo"; 2026-10-09 16:31 — "mas voce pesquisou para falar isso pra mim é só isso mesmo?"
  - What it means: a repository health score from a researched checklist of 91 items in 8 categories; the version of each project's code (and of what runs live, when configured) always in sight; a Projects home page with all of it.
  - How to confirm it is done: see `fd08`, `fd09` and `fd10`.
  - Where it went: `fd08`, `fd09`, `fd10`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [x] Docs kept at a professional size, with exact pointers to the code `id70`
  - Asked: 2026-10-09 ~17:20 — paraphrased (the exact words were not recorded): keep the documents at a professional size and point to the exact place in the code.
  - What it means: session-map warns when a document grows past a researched size, offers to split it by topic without losing a line, and points to code by path and symbol, with the line worked out when it is opened.
  - How to confirm it is done: see `fd13`.
  - Where it went: `fd13`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [x] The rules apply to everything in the program, and tips never touch the person's repository unless accepted `id71`
  - Asked: 2026-10-09 ~17:30 — paraphrased (the exact words were not recorded): the rules must apply to everything in the program; tips must not touch the person's repository unless accepted, and must be automatic for people who do not know.
  - What it means: one care mode per project (Automatic, Suggest, Look only) that governs every feature that writes; in Suggest nothing is written without an OK, in Automatic everything is done and logged with Undo.
  - How to confirm it is done: see `fd14`.
  - Where it went: `fd14`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [x] Every idea executed at a professional level, without the owner having to learn it all `id72`
  - Asked: 2026-10-09 ~18:30 — paraphrased (the exact words were not recorded): he does not want to learn everything; he wants his ideas executed at a professional level, not an amateur one, and felt the earlier summaries were shallow.
  - What it means: a deep specification of what happens to every idea, from "I want this" to live, selling and maintained, in 14 stages (product, design, code, tests, security and LGPD, release, operation and costs, documentation, brand, marketing and video, sales and support, legal, finance, work with AI), each with its steps, roles, models, tools, checks, the owner's decisions and sources; session-map walks every idea through it and proves each step.
  - How to confirm it is done: see `fd15`.
  - Where it went: `fd15`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (part of the foundation delivery started on 2026-10-10).
- [ ] Open session-map like a program: one click, without VS Code `id86`
  - Asked: 2026-10-10 20:05 — "se fizesse .exe desse programa não ficaria melhor?"; 2026-10-10 20:12 — "podia ser em pwa né? como é web, mas ai quando clica ja abre tudo? porque toda vez tenho que entrar no vscode pra abrir o programa"; 2026-10-10 20:21 — "adciona isso como solicitação para ver mais tarde"
  - What it means: the map turns on by itself when the owner logs in to Windows, hidden, with a watcher that turns it back on when it falls or freezes; the page becomes an installable app (PWA: icon in the Start menu and taskbar, its own window) that shows "the map is turning on…" until the server answers. Not an .exe: an unsigned .exe is blocked by Windows and antivirus, signing costs about US$ 200–400 a year, and updates would stop coming with the plugin.
  - How to confirm it is done: after a restart of the PC, a click on the "Session Map" icon opens the map without opening VS Code; killing the server brings it back within a minute; `session-map uninstall-startup` undoes it all.
  - Where it went: `pt07`.
  - Status: later (the owner asked to look at it later).

- [x] Professional logs of everything, easy for other AIs to read `id125`
  - Asked: 2026-10-14 18:34 — "acho que precisamos de um logs. logs de tudo, de forma profissional, assim fica facil outras IA acessar registros, porque por mais que voce esqueça de fazer algo o log vai identificar o que foi feito, no programa e no programa dos outros"
  - What it means: session-map keeps a professional, machine-readable record of everything: its own events in one JSONL log with a documented schema (one file per day, pruned after 30 days, secrets masked) and one record per project of what happened there, so any AI can read what was done — in this program and in the programs of others — even when the AI that did it forgot to say.
  - How to confirm it is done: the logs folder holds one file per day for the program and one per project, every line valid against `logs/schema.json` and no secret in any file; `GET /api/logs` and `GET /api/logs/projects/<id>` answer with the newest lines behind the key.
  - Where it went: `sv19`, `wa11`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-14 (`sv19`, `wa11`: the program's daily log and the per-project records, with the read routes behind the key); the file sink turns on with the next restart of session-map; waiting for the owner to try it.

### What it costs

- [x] A detailed statement of every cent spent, like a bank statement, for compliance `id98`
  - Asked: 2026-10-11 18:10 — "quero com urgencia, urgencia mesmo,valores detalhados como se fosse um extrato de cada coisinha que é feita, preciso saber de tudo, valor que gasta na entrada, valor que gasta na saida, cada chat, preciso de um extrato bem organizado, como se fosse um compliance, acabei de colocar 100 dolares e sumiu, quero saber, agente tal leu 1000 palavras ou arquivo gastou x de tal conversa , tal dia, tal hora, detalhados em custos, mas quero que veja os preço reais, você tem acesso tem isso disponivel na internet e também para você"; 2026-10-11 18:55 — "tu ta doido macho eu quero isso no programa"
  - What it means: a statement with one line per reply of every chat and every agent: day and hour, which chat, who answered, what it read (words, files) and did, tokens and dollars spent on input and on output, at the real prices checked online; sums by day, chat and agent; and where the credit that vanished went.
  - How to confirm it is done: in session-map, Costs tab, section "Detailed statement" (or Documents/Extrato-Claude/extrato.html and extrato-detalhado.csv): each reply has its own line with date, hour, chat, agent, input and output in tokens and dollars; the page shows the account's own extra-usage counter and the hours the limits were hit.
  - Asked again: 2026-10-11 19:30 — "não achei simples, achei completo, bem complexo mesmo, é uma contabilidade, tudo tem que ser bem guiado se tenho 1000 dolares de gasto eu abro aqueles 1000 dolares de gasto e vou destrinchando ele de acordo com cada saida que foi feita, tem que ser vamos dizer essa conversa aqui me custou quanto o chat, quantos arquivos e que arquivos ela criou esse arquivo teve quantas linhas, foi gasto quanto por cada coisa que foi usado, se a conversa gastou 20 dolares do perido de tal dia a até tal dia, foi 10 dolares, mas criou tais coisas, sub agentes trabalhando, agentes, tudo isso mas com uma linha organizada"
  - Asked again: 2026-10-11 20:10 — "você colocou também além das conversas os agentes independetes do programa consultando, relendo verificando, mostrar quantas linhas leu, custo das atividades que fez, os documentos que leu, sei que é complexo, mas preciso do que é complexo visivel de forma pratica e facil"
  - Asked again: 2026-10-11 20:15 — "eu te peço uma contabilidade tu me da uma redação, rapaz pesquisa antes, como faz contabilidade de IA"
  - Where it went: `sb08`, `sb09`, `sb10`, `sb11`, `sb12`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-11, the last layout (`sb12`) as AI cost tools keep their books; its server part waits for the next restart of session-map (another chat asked for none until its teams finish); waiting for the owner to try it.

- [x] Agents re-read everything, every skill gets opened and everything runs on Claude high: refine it to spend little with high quality `id105`
  - Asked: 2026-10-13 — "os agentes estão lendo tudo de uma vez, cada agente ele reler tudo de novo para cumprir a tarefa, também acontece que tem um snow ball no programa, voce ta acionando todas as skills os agentes fazem a mesma coisa, reler tudo antes de começar a trabalhar, precisamos refinar"; and "voce não esta classificando corretamente as IA, todas estão trabalhando com o claude nivel HIGH ... nao falou pra mim que as skill instaladas estão fazendo um gasto gigante ... Eu quero que voce tenha o poder de dizer e tomar decisoes de forma critica pensando no melhor para o projeto e não apenas concordando com as minhas ideias"
  - What it means: measure where the tokens really go, remove what makes the snowball (rules that open every skill, Opus by default, too many agents per workflow, every agent starting from zero) and speak up with numbers instead of agreeing.
  - How to confirm it is done: a week later, the share of Opus agents, the agents per workflow and the skills opened per agent are clearly lower, with the tests still passing and the reviews still holding.
  - Where it went: `or23`, `or24`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or23`, `or24` measured: the waste section on the Costs tab); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] Economy by the engine, not by asking: an OK at the end of each task, a book index for skills, plugins and long conversations, planning by itself `id106`
  - Asked: 2026-10-13 — "quero como sistema, na engrenagem, da OK, na finalização das tarefas, Fazer o conceito de um livro que vem o indice, com capitulos e subcapitulos, para as skills e plugins"; "quando eu falo planejar voce ja sabe ... ou quando estamos conversando poderia ser automaticamente um planejamento"; "em conversas longas o proprio sistema criar um sistema igual de livro, assim não precisa ler a conversa toda ... ler apenas o que for necessario"
  - What it means: the savings rules live in session-map's engine (settings and hooks it hands each chat), not in text the AI may ignore; skills, plugins and long conversations are read through an index and only the needed chapter; planning talk opens in plan mode by itself.
  - How to confirm it is done: a chat with an Opus agent for ordinary code is stopped by the engine; a long chat goes on from its index; a new chat lists only skill names plus the few that fit; a planning message opens in plan mode; each finished request shows OK or what is missing.
  - Where it went: `or25`, `or26`, `pc26`, `pc27`, `pc28`, `pc29`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or25`, `or26`, `pc26`, `pc27`, `pc28`, `pc29`); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] An AI that agrees or disagrees on data, in the engine, whichever AI it is `id107`
  - Asked: 2026-10-13 — "voce pode concorda comigo ou discorda, veja ai por favor, quero que na engrenagem, eu não quero uma IA que concorda, não importa qual, quero uma IA consciente que concorde e discorde baseada em dados"
  - What it means: every AI session-map talks to (Claude in any way a chat runs, and the outside AIs when they judge) takes a stance from the facts and shows them, instead of agreeing to please.
  - How to confirm it is done: start a chat in any way and bring an idea the numbers contradict: the answer says it disagrees, with the numbers; ask an outside AI for a review: the request it receives starts with the same rule.
  - Where it went: `or27`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or27`); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] Cheap layers first: exact skeletons of the code, a local model for heavy reading, the paid model only for decisions `id108`
  - Asked: 2026-10-13 — four images from the owner's research with his brother: Ollama making "Interface Skeletons" (imports, types, signatures, no bodies), semantic changelogs in JSON, extraction of variables and dependencies; "AST determinístico + Ollama cirúrgico"; model cascading (cheap or local models read and sort, the frontier model only decides and writes the hard code). And: "tem mais uma imagem, mas voce colocou limitador de imagens nao sei por qual motivo, quero colocar mais uma imagem".
  - What it means: structure comes from exact readers (free, no mistakes), summaries of long text from the cheapest model that is good enough, and the paid model gets the skeleton plus the exact lines, never the whole repository.
  - Verdicts with data: skeletons yes, but from the Foundation, not from a model (measured 88 to 94% smaller); changelogs yes, but from the facts before and after, without AI; variables and dependencies already read (names and versions), the code's own `process.env` is new; a local model only as an optional, measured provider; ten images per message.
  - How to confirm it is done: an agent answers about a file by reading its skeleton and a few lines; the turn's OK lists what changed; a message takes ten images.
  - Where it went: `fd17`, `or26`, `or28`, `pc30`.
  - Status: done on 2026-10-16 except `or28`, the local model (parked in the triage of 2026-10-16: this PC has 1.7 GB of free RAM). Before: built on main on 2026-10-13 (`fd17`, `pc30`, `or26`); `or28` (a local model) left for later: Ollama is not installed and the PC had 1.7 GB of RAM free; waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] The entry is not Opus at high: plan first with the cheapest that is good enough, then build with the right model per task, by law in the engine `id109`
  - Asked: 2026-10-13 — "tem um problema a entrada, que nivel é? Qual modelo de IA, que nivel da IA ... a OPUS e Fable com certeza iria pensar melhor que o sonnet, mas as vezes nao por apenas está conversando, e o que deve exitir de lei na engrenagem antes de começar sair fazendo qualquer coisa é traçar um plano com a mais barata organizar a ideia e depois construir usando as IA e modelos de acordo com a tarefa ... estava jogando tudo no nivel HIGH e usando opus, e voce ainda me dizia que estava usando o modelo mais fraco, mas por traz os agentes eram sempre os mais caros"
  - What it means: the engine, not the AI, picks the model and effort of each phase: talk cheap, plan with a mid model and a short strong review when it matters, build per task; and it shows the person which model and level each phase really used.
  - How to confirm it is done: a new chat that only talks runs on Sonnet at low and says so; a large request gets a written plan before any code, with each task's model; the statement shows the real model of the chat and of every agent.
  - Where it went: `or29`, `or30` (with `pc27`, `pc28`, `or25`).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or29`, `or30`: Sonnet at medium planned 8/8); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] A thinking brain at the entry and the exit: the cheapest model weighs each message, asks a little when needed, and hands it to a stronger model only when the work is big `id110`
  - Asked: 2026-10-13 — "poxa a gente nao consegue colocar a entrada e saida como um cerebro pensante? tipo, recebi essa mensagem, é uma mensagem barata, nossa recebi essa mensagem é um projeto grande preciso dar mais atenção, podemos fazer começnado com o mais barato, ele faz umas perguntas para ter ideia do nivel da conversa e dali mudar para a IA mais e modelo mais desenvolvido?"
  - What it means: a router before every turn: free rules, then a cheap model when unsure, a couple of questions only for big unclear work, then the right model; it also steps down when the talk gets small.
  - How to confirm it is done: "oi, tudo bem?" runs on the cheapest and says so; "quero um sistema de pagamentos" asks one or two questions, then plans on a stronger model; the page shows the model of each turn and why.
  - Where it went: `or31` (with `or29`, `or30`).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or31`); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] The book system for skills, plugins, agents and long conversations: see what is installed and used, read a thing once for all agents, and a conversation that keeps its own short chapters `id111`
  - Asked: 2026-10-13 — "eu gostaria de saber quais skills e plugins instalados por repositorios, quais estão sendo usadas no momento que pode ser nos balões, um metodo de que uma skill ja foi lida, nem todos os agente precisam ler novamente ... aqui ta acontecendo que os 150 agentes vao ler novamente as mesma atividade isso gera um snowball sem tamanho e também o indice nas conversas, a conversa vai passando dos limites, vai se criando indices, com capitulos mais curtos dentro da propria conversa diminuindo o custo da conversa, teria como isso tudo acontecer?"
  - What it means: the balloons show the skills and plugins of each project and what each chat and agent opened; the conductor reads once and hands chapters, agents never re-read by default; a long conversation shrinks itself into chapters.
  - How to confirm it is done: a balloon lists its skills with their weight; a workflow of ten agents shows the skill opened once, by the conductor; a long chat shows its chapters and its cost per turn going down after a chapter closes.
  - Where it went: `mm52`, `or32`, `pc28`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`mm52`, `or32`, `pc28`); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] The balloons and the items' status made by a mechanism of the program, not by an AI that can forget `id112`
  - Asked: 2026-10-13 — "questões de balões criações não era para depender da IA, você pode errar isso deveria ser mecanismo do programa, eu nao sei falar os termos mas deveria ser um robo, um sistema alguma coisa assim, não simplesmente um arquivo .md"
  - What it means: what is being worked on and what is built is read from the facts (live chats and agents, branches, commits), so the map is right even when an AI forgets to write the mark.
  - How to confirm it is done: start an agent on an item without touching the plan file: its balloon shows "working now" within a minute; merge a feat commit naming an item: it shows "built, not ticked".
  - Where it went: `sb13`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`sb13`); waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] The balloons, the files and the flow are made by a robot in a correct order, whatever is created `id113`
  - Asked: 2026-10-13 — "mesma coisa para os balões e arquivos, tem que ser um robo, não importa se cria novos balões, também serve para o fluxo e nao importa o que é criado, mas tem que seguir uma ordem correta"
  - What it means: nothing on the map is hand-written by an AI any more: a robot writes requests, items, codes, new parts and flow links in a fixed order and refuses what breaks it; the AI only says what the words mean.
  - How to confirm it is done: ask for something new in a chat: the request, its item with the next code, the part and the flow change appear in that order without the AI editing a file; an AI that tries to edit a plan file by hand is stopped and pointed to the robot.
  - Where it went: `am04` (with `sb13`, `or26`).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`am04`): map edits in page chats go through the clerk; waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] A robot and one well-made document decide which model and level runs, not the AI's choice `id114`
  - Asked: 2026-10-13 — "precisamos criar um robo, um documento alguma coisa que não depende apenas de voce fazer a escolha do liga e desliga, porque voce soube o que era, mas no documento já tem um padrao, e estão seguindo esse padrao e esse documento esta mal feito de mais, voce não fez com profissionalismo"
  - What it means: the model and effort of every agent and every phase come from one policy file with its evidence, applied by the engine; the AI only declares the kind of task.
  - How to confirm it is done: an agent started as "[code] ..." with opus/high runs as Sonnet medium anyway; one without a kind is refused; the policy page shows the same table the engine uses, with where each row's number came from.
  - Where it went: `or33`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or33`): the guard sets each agent's model from the policy; waiting for the owner to try it after the restart of session-map on 2026-10-13.

- [x] Rules in code, central, not in CLAUDE.md, which fails `id115`
  - Asked: 2026-10-13 — "não tem uma forma ou arquivo ou documento para criar isso de forma mais centrealizada baseada em codigopara nao depender so do claud md, porque eu trabalho com claude.md a um tempo e falha muito, nao podemos ter falhas"
  - What it means: what must never fail is enforced by code and settings every session obeys (defaults, hooks, the policy file); CLAUDE.md keeps only how to talk to the owner.
  - How to confirm it is done: a new terminal chat starts on Sonnet medium; an agent asked for Opus on ordinary code runs on Sonnet in any session; a long terminal chat is summarized at 100k.
  - Where it went: `or34` (with `or33`).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or34`): user defaults Sonnet medium, compaction at 100k, the guard and the book installed for every session on this PC; for other PCs, with the next plugin release; waiting for the owner to try it after the restart of session-map on 2026-10-13.
- [ ] **in progress:** Smart orchestrator, cheap answerer `id116`
  - Asked: 2026-10-14 — "eu pedi uma IA mais barata para conversa e me responder, mas está sendo infelizmente muito ruim, pensa pouco, preciso da IA que conversa comigo seja inteligente, mas não quero a mesma IA fazendo tudo, o orquestrador que recebe as minhas mensagens é uma, a mais correta e o que responde seja a mais barata, tem como ser assim?"
  - What it means: Two roles, two models: the one that receives and understands each message is the most correct; the one that writes the reply is the cheapest that still does it well. Today talk is Sonnet at low (server/ai/policy.json:30), so one cheap model does both and thinks little.
  - How to confirm it is done: On the owner's real messages the reply is judged better than Sonnet low alone, the cost per message stays under the agreed ceiling, and the run line says which model understood and which answered.
  - Where it went: `or35`.
  - Status: new.

- [x] The same options for DeepSeek, GPT, Claude and Gemini, and the work never stops for lack of credit `id122`
  - Asked: 2026-10-14 — "gostaria que o deepseek, gpt, claude e gemini, tenha as mesmas opções"; "porque assim eu posso escolher qual grupo eu posso trabalhar, como trabalhar, porque muita das vezes eu não tenho credito no deepseek ou credito no claude e fazer o trabalho parar porque não tenho token suficiente e não poder realocar os serviços, quero trabalhar pelos meus chats la dentro do session"; "quero que façamos o que conversamos acima, preciso do maximo de economia e qualidade maxima no programa, mas fazendo que a IA pense de forma correta"
  - What it means: the four engines interchangeable in the arsenal with the same options; working groups the owner picks; and when one engine runs out of credit, the dispatcher re-routes by itself to the next one in line (balance read from the API where it exists, quota errors, a pre-flight cost check), so the work never stops for lack of tokens — it waits for the owner only when the whole level is empty.
  - How to confirm it is done: with DeepSeek empty, a bulk job goes to Gemini or GPT by itself and the map shows who did it; the owner's group choice re-orders the AIs per kind of work; the DeepSeek sessions open in session-map like Claude's (delivered by the other conversation on 2026-10-14).
  - Where it went: `or36`, `or37`; the DeepSeek sessions in the map: the other conversation's delivery of 2026-10-14 (`server/sources/deepseek.mjs`).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-14 (`or36`, the engine: quota pauses with a cooldown, pre-flight against the balance, the four working groups, wired into the ask tool and the background runner; `or37`, the worker's exit contract with status and confidence, the cap of two climbs per task and the checker of another family for dubious bulk answers; 107 tests green). Left for new items: the group selector and the "sem crédito" badge on the page, the daily balance refresh, per-project groups; waiting for the owner to try it after the next restart of session-map.
- [x] The list of what only Claude does, and a choice for it in the map `id123`
  - Asked: 2026-10-14 — "tem varias coisas que só o claude faz ainda, varias funções, preciso que deixei isso também a escolha e a vista no session, porque tipo, se eu estou sem o claude agora, o livro não está sendo atualizado"; "Mas eu não sei tudo sobre o que o claude fez que só ele faz, tem como fazer esse levantamento?"
  - What it means: an inventory of every function that depends on Claude alone (the chat engine, the brain, the book, hooks, skills, costs, subagents, permissions), what each engine already has, and what it takes to turn each one into a choice visible in the map — so the program keeps working (book, costs, triage) without Claude.
  - How to confirm it is done: the levantamento exists (`.dev/execucao/levantamento-claude-only.md`) and the feasible items get their own items, one by one: the book from the DeepSeek log, the DeepSeek price table, the brain by API.
  - Where it went: `or38`; each remaining fix becomes its own item as the DeepSeek Harness exposes the pieces (CLI, hooks).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (the levantamento is written; `or38` built the three fixes that do not wait: the book from the DeepSeek log, the DeepSeek cost, and the per-function engine choice with its selectors in the Other AIs dialog; the rest — chat engine, hooks, MCP, permissions — waits on the DeepSeek Harness).
- [x] The Cérebro tab: every AI function in sight, with its engine, level and order chosen there `id124`
  - Asked: 2026-10-14 — "tem como fazer uma aba tipo do brain do programa (use termos mais profissionais), apontando tudo e tudo como funciona e eu escolher onde cada IA vai ser chamada e posso escolher o nivel dela, assim os chats vão andar naquela ordem e colocando explicando em um quadro o nivel de cada IA, valor dela, para que serve para qual mais aptidão ela tem"; "posso escolher qual IA vai trabalhar nas funções exatas, mas tem que colocar realmente todas as funções que precisa de IA"; "me da ideias de como melhorar e também fazer o desenho para eu ver como ficaria"
  - What it means: a new tab, the program's brain panel: the model matrix (level, price, aptitudes, measured results, balance per AI), the routing of EVERY function that uses AI (engine + reasoning level + order, editable), the order a chat walks, and the automatic rules — all mechanical, decided by scripts, never by a prompt.
  - How to confirm it is done: the tab lists every AI function with its engine and level selectors; a change is saved in the config and the chats walk the new order; each model card shows its price, its aptitudes and its measured numbers.
  - Where it went: the design in `.dev/prints/brain-tab-mockup.html` (2026-10-14); the build in `or39`, `or40`, `or41`, `or42`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-14 (`or39`: the tab with the matrix, the 16 AI functions with engine/model/level selectors saved in the config, the chat's order and the rules; `or40`: the agents and teams rows plus the configuration chat; `or41`: each engine's own reasoning levels, verified against the makers' docs and real calls, applied to each API; `or42`: the guard reads the Cérebro's choices for every agent). Left for new items: the Simulate button, the per-project choices, the brain's Haiku call by API; waiting for the owner to try it after the next restart of session-map.

- [ ] **in progress:** The page speaks with technical words and terms by default `id126`
  - Asked: 2026-10-14 18:47 — "pois muda essa regra, eu quero uma regra usando palavras tecnicas e termos tecnicos"; "me manda que vou colocar em outro chat para vascular o programa e resolver isso"
  - What it means: the plain-language rule is inverted **as engine, not as a document**: `terms` is a config key (`technical` by default), the state delivers it and the page translator obeys it — the AI never reads a rule to know how to speak. The simple words become the optional mode. The remaining work is content: fill the technical dictionary for every key (`.dev/execucao/regra-termos-tecnicos.md` is the spec).
  - How to confirm it is done: the page says "agente" (not "ajudante") by default in both languages, the vocabulary test reflects the new rule and the full suite is green.
  - Where it went: the engine part is built (`terms` in `server/config.mjs`, `state.terms` in `server/collect.mjs`, `applyTermsDefault` in `server/web/app.js`); the rule document is the spec for the vocabulary sweep (`.dev/execucao/regra-termos-tecnicos.md`), which goes to the chat the owner chooses: `mm64`.
  - Status: in progress (the engine half is built and verified in the live state; the dictionary sweep is handed over and parked as `mm64`).
- [x] The fine-tooth comb: the complete list of what is engine and what is still reading `id127`
  - Asked: 2026-10-14 19:00 — "o que mais deveria ser motor e é leitura, agora me preocupei"; "faz um pente fino e me mostra uma lista completa do programa e não apenas siso"
  - What it means: one complete list of every behavior rule of the program, classified: motor (code, hooks, config or tests enforce it) or leitura (only prose an AI must read at work time), with the proof for each and, for the reading ones, what would make them motor.
  - How to confirm it is done: the list exists (`.dev/execucao/pente-fino-motor-vs-leitura.md`), every "Rules that must not break" of the 15 parts is classified with proof, and the remaining reading-only rules have their own items.
  - Where it went: the audit document (`.dev/execucao/pente-fino-motor-vs-leitura.md`); the engine-side gaps became `or43` (built: the money gate, the registry rules and the vendored audit); what remains is the Bootstrap part's own backlog (`bi01`–`bi03`, `bi05`, `bi07`).
  - Status: done on 2026-10-16 except `bi01`, `bi03` and `bi07` (parked in the triage of 2026-10-16). Before: in progress (the complete list is final — 68 rules, 64 motor; the four leftovers all carry `bi*` items in the Bootstrap part).
- [x] The blueprint of the program, down to the last outlet `id128`
  - Asked: 2026-10-14 19:27 — "acho que o fluxo não mostra todas as funções desenhadas do sistema, o que cada botão deveria fazer e se está funcionando se precisa arrumar, um desenho completo do programa mostrando cada função até uma, mas não perdendo o fluxo geral"; "é como se fosse a planta baixa de um projeto arquitetonico que mostra até onde tem institor, você consegue me ajudar assim, mostrando cada milimetro do projeto, um desenho visual do programa"
  - What it means: two mechanical drawings of the program: (1) the blueprint of the engine (each part is a room with its files, functions, installations and health from the tests) and (2) the map of the interface (each area of the page — Início, Biblioteca, Descobrir, Mapa, Fluxo, Solicitações, Conversas, Mudanças… — with its screens, sections, buttons and boxes, down to the last one, with the page's real texts). Both generated by scripts from the code, never by an AI's opinion.
  - How to confirm it is done: both drawings exist (`.dev/prints/planta-baixa-session-map.html` and `.dev/prints/mapa-da-interface.html`), every area and every part is present with its inner items, and each regenerates with one command.
  - Where it went: `op10` (the blueprint of the engine) and `op11` (the map of the interface); the living version in the page is the Flow part's work (`id120`).
  - Status: feito (2026-10-14: 14 cômodos clicáveis com o inventário completo de arquivos, funções, testes, rotas/ganchos/ferramentas e os itens abertos da arquitetura de cada parte; 307 arquivos, 1607 funções; a saúde vem da última suíte completa).
- [x] The drawing lives in the system: a new level inside the Flow tab `id130`
  - Asked: 2026-10-14 19:54 — "quero ver dentro do fluxo isso e nao por fora, tem que ser sistema"
  - What it means: the drawings stop being files outside the program: the Flow tab gains a new level, "The program", that draws the interface map (the 13 areas with their screens, sections and buttons, from the page's own texts) and the blueprint of the engine, served by the server from the code itself — a living drawing inside the system, regenerated by the engine, never a hand-made picture.
  - How to confirm it is done: inside the Fluxo, the level "O programa" opens the tree of the 13 areas with their inner items; the data comes from `GET /api/census/ui`; the external files become just exports of the same census.
  - Where it went: `mm57` (the page), the census module (`server/census.mjs`), the route (`server/censusroute.mjs`) and the view (`server/web/programview.js`).
  - Status: feito (2026-10-14: o nível "O programa" dentro do Fluxo serve a árvore das 13 áreas — 1096 itens — do próprio sistema, verificado ao vivo em `GET /api/census/ui`).
- [x] Delivery discipline has a motor; the skills hold the bridge until it covers everything `id131`
  - Asked: 2026-10-14 20:15 — "percebi que voce é muito acelerado, tem como fazermos uma engrenagem para voce se ater aos detalhes"; "tem que haver um motor, se ainda não houver as skills devem ser usadas"
  - What it means: no "done" without mechanical proof. The motor: the ritual of delivery (`ritual-de-entrega` in `~/.dsh/skills`), the live-proof script (`node .dev/execucao/prova-viva.mjs` — the running server's routes and served files checked, never assumed), the existing gates (tests, release gate, `id129` architecture-first). The bridge until the motors cover everything: the installed skills are used — architecture, board, grilling before medium+ work, and the superpowers plugin for plans before builds.
  - How to confirm it is done: every delivery in this front runs `prova-viva` green before the "pronto"; the superpowers skills are installed and activated; the ritual names all three motors.
  - Where it went: `op12`; the skill in `~/.dsh/skills/ritual-de-entrega`; the plugin in `~/.claude/plugins/superpowers`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (o motor está de pé — o ritual com a prova viva mecânica verde 6/6; a superpowers já estava instalada e ligada pelo diretório oficial; o clone à mão foi removido; a ativação por projeto existe na página, `rd09`/`mm52`).
- [x] A button that turns the downloaded skills on and off `id132`
  - Asked: 2026-10-14 20:16 — "tem que ter m botão que liga e desliga as skills que baixar de repositorios do git"
  - What it means: a one-click switch per skill/plugin downloaded from a git repository, per project. The button exists (the plugin switch `rd09`, one click per plugin with a confirmation, saved into the user's settings; the project's list with on/off is `mm52`) — the fine-tooth found the superpowers already installed and on, and removed a redundant hand-made clone. What remains: confirm the button in the page's own view and leave the toggling to the owner.
  - How to confirm it is done: the live project list shows each plugin with its switch; the owner flips one and the next chat obeys.
  - Where it went: `op13` (the verification and the cleanup).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (waiting for the owner to see the switch in the page).
- [x] Superpowers as an engine, not a skill `id133`
  - Asked: 2026-10-14 20:26 — "tem como pegar o superpower virar um motor dentro do session, sem precisar ser skill?"
  - What it means: the 15 disciplines of the superpowers collection become session-map engines — robots that apply the rule, never a text an AI reads per task. The mapping (`.dev/execucao/superpowers-no-motor.md`) shows 11 already motor, 2 motor parcial and 2 reading. The owner's decision (2026-10-14 20:26): superpowers is the refined method and stays as skills; the engine does not copy it crudely — it is only the door that checks the refined artifact was used (`or44`: the plan under `docs/superpowers/plans/` for 3+ agent workflows, and the `[review]` agent for code workflows).
  - How to confirm it is done: the two doors exist with their tests, the mapping is complete, and no superpowers discipline is left as reading-only.
  - Where it went: `op14` (the mapping); `or44` (the plans engine and the two doors).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (o motor de planos e as duas portas construídos e testados — 34 verdes, prova viva 6/6; resta a visão de planos na página quando o dono pedir).
- [x] Ponytail inside the system, not as a skill `id134`
  - Asked: 2026-10-14 20:38 — "quero ponytail também também já dentro do sistema, é uma skill quero ela sendo parte do sistema e não uma skill"
  - What it means: the ponytail discipline (the lazy senior dev: the ladder of "does it need to exist", the shortcut comments, the review, the intensity levels) becomes part of the program's engine. Much of it already is the program's DNA (the ladder's frugality is zero-npm and the policy; the reviews are the checker and the doors; the levels are the Cérebro's efforts; the "say what you skipped" is the worker's contract). The missing piece is built: the debt ledger — the engine harvests the `shortcut:`/`ponytail:` comments from the code into a living book, so "later" never becomes "never".
  - How to confirm it is done: `GET /api/census/debt` answers with every deferred comment (file, line, text), the level "O programa" shows the "Dívidas" section, and a new shortcut comment appears there without anyone re-running anything.
  - Where it went: `or45` (the harvest and the ledger, mais a linha "skipped" no contrato) and the mapping in `.dev/execucao/superpowers-no-motor.md`.
  - Status: feito (2026-10-14: o caderno colheu 45 dívidas reais na primeira rodada, a seção "Dívidas" desenha no nível "O programa", a linha "skipped" entrou no contrato; 38 testes verdes, prova viva 7/7).
- [x] Ponytail and superpowers installed and used as part of the engine `id135`
  - Asked: 2026-10-14 20:44 — "quero que baixe e instale o ponytail e o superpower e use como parte motor do session-map"
  - What it means: both plugins installed through the official channels, appearing in the program's plugin list with their on/off switch, and their disciplines running as the engine parts already built (the doors, the plans, the debt ledger, the contract's skipped line) — the skills ride along for the chats that name them.
  - How to confirm it is done: the live plugin list shows `ponytail@ponytail` and `superpowers@anthropic-plugin-directory` with their switches; the engine pieces answer (debt, doors, contract).
  - Where it went: `op15` (the install and the check).
  - Status: feito (2026-10-14: ponytail instalado pelo canal oficial e ligado; superpowers já instalada e ligada; ambos na lista viva do projeto com o interruptor; os motores `or44`/`or45` seguram as disciplinas).
- [x] The skills' engine: they run, and Discover has the airplane-mode switch `id136`
  - Asked: 2026-10-14 20:56 — "agora quero um motor para as skills instaladas, elas rodarem, ai colocar em descobrir poder ligar e desligar as skill igual é em celular que colocar em modo avião e o motor conseguir fazer isso"
  - What it means: (1) the installed skills run — the engine that picks and hands them to the chats (the focus, `or22`, with the guard's rule that an agent opens only what its brief names); (2) an airplane mode, like the phone's: one switch that turns every installed skill and plugin off for the chats (the program's own plugin never falls — it is the plane), and Discover shows the switch plus each installed plugin's own on/off.
  - How to confirm it is done: flipping the Discover switch off makes new chats open with the skills off (all name-only, plugins disabled except session-map) and on restores; the state carries it and the switch survives restarts.
  - Where it went: `mm58` (the page and the switch), the guard's `chatSkillSettings` (the engine honor), the config key and the route.
  - Status: feito (2026-10-14: o interruptor vive no Descobrir, o estado carrega `skillsAirplane`, a guarda obedece — toda skill name-only e todo plugin desligado, menos o do programa — e a prova viva fechou 8/8 com o campo no ar).
- [x] The professional terms become the program's language `id137`
  - Asked: 2026-10-14 21:20 — "poxa tu usa os termos igual eu falo, tem um termo melhor pros codigos não?"; 21:26 — "claro" (rebatizar também a página)
  - What it means: the glossary (`.dev/execucao/glossario-profissional.md`) pairs each plain word with the industry term — engine, quality gates, retry ladder, structured output contract, live verification, definition of done, technical debt ledger, kill-switch, static census, control plane, agent, reasoning effort — and from now on the replies, the documents and the page speak them. The internal code names do not change.
  - How to confirm it is done: the Discover switch reads "Kill-switch de skills", the level "O programa" reads "Technical debt ledger", and the replies use the glossary.
  - Where it went: the glossary document; the page texts (`mm58`'s strings, both languages).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (os textos da página renomeados em 2026-10-14; o uso contínuo é o DoD das respostas).
- [x] Discover separates installed skills from installed plugins, catalog below `id138`
  - Asked: 2026-10-14 21:34 — "eu quero que fique separados Skill e plugin instaldos, de forma também com termos profissionais e embaixo skills a instalar e etc"
  - What it means: the Discover page groups in the professional terms: the kill-switch on top, then "Installed skills" (each with its command and state), then "Installed plugins" (each with its switch), and below the heading "Catalog — available to install" the items from GitHub.
  - How to confirm it is done: the three groups are visible in Discover, with the professional names in both languages.
  - Where it went: `mm59` (the Discover layout and texts).
  - Status: feito (2026-10-14: os três grupos separados com os nomes profissionais, servidos e com 30 testes verdes).
- [x] Per-skill switches: the owner picks which skill runs `id139`
  - Asked: 2026-10-14 21:39 — "eu quero é por skill e não todas, eu poder escolher a skill que quero que aconteça quando está ligada e quando eu não quero eu desligo"
  - What it means: the choice is per skill, not all-or-nothing: each installed skill gets its own switch in Discover (on/off); the ones off never load in the chats, whatever the focus picks — a machine-wide list `skills.off` in the config, honored by the guard. The global kill-switch stays as the emergency button.
  - How to confirm it is done: turning a skill off in Discover makes the next chats open with it name-only, and on restores it; the state carries the list and it survives restarts.
  - Where it went: `mm60` (the page), the guard's `chatSkillSettings` (`skillsOff`), the config key and the route.
  - Status: feito (2026-10-14: cada skill instalada tem o seu interruptor no Descobrir; desligar uma skill grava em `skills.off` e a guarda a mantém name-only mesmo quando o foco a escolheria; provado ao vivo — OFF/ON 200 — e prova viva 8/8).
- [x] Ponytail and superpowers absorbed into the program; every other skill runs automatically when on `id140`
  - Asked: 2026-10-14 21:55 — "o superpower e ponytail eu nao quero como skill ou plugin quero como parte do programa motor, que nao desliga e liga quando quer, mas as outras, quando estiverem ligadas, nao precisam ser chamadas apenas quando falar ou mandar uma chamada, quando estao ligadas o motor faz automaticamente. Ja superpower e ponytail eu quero aproveitar que e open source e fazer realmente parte do meu programa"
  - What it means: (1) the two open-source disciplines stop being skills or plugins — their content is vendored into the program (with license and source, audited like the other vendored files), their rules join the engine's own prompt, and their gates/ledger/contract stay as the always-on motors; (2) for every other skill, "on" means automatic: the engine loads it in the chats without waiting for a call, "off" means it never loads — the switches become what they always meant.
  - How to confirm it is done: the two plugins are uninstalled, their vendored copies live in `server/disciplines/` with the audit, the guard loads every on skill automatically, and the suites stay green.
  - Where it went: `or46` (the absorption and the automatic activation).
  - Status: feito (2026-10-14: os dois plugins desinstalados — a lista viva não os mostra mais —, os DOIS REPOSITÓRIOS vendidos inteiros em `server/disciplines/` — 383 arquivos, só as imagens de fora — com licença e auditoria, e toda skill ligada carregando automática nos chats; 57 verdes, prova viva 8/8).
- [x] The parked content becomes motor: the wiring plan and the live review `id141`
  - Asked: 2026-10-15 03:00 — "tudo tem que o maximo de motor possivel e o minimo de leitura possivel, entao pegamos 2 repositorios e eu nao sei como voce casou ele no programa ou apenas jogou os arquivos... consegue usar essas skills agora no momento"
  - What it means: the honest inventory (what is wired vs parked), a superpowers-format plan for wiring the parked ~85% (`docs/superpowers/plans/2026-10-15-wire-the-disciplines.md`, 4 tasks), and a live ponytail review of the day's engine work — used in this very chat, with the findings fixed at once (the census read every view file twice; the debt harvest walked the whole repository on every poll — both fixed on 2026-10-15).
  - How to confirm it is done: the plan's four tasks become items (`or47`), the review's findings carry fixes with tests, and the disciplines are demonstrably used in the conversation itself.
  - Where it went: the plan document; `or47` (the four wiring tasks).
  - Status: feito (2026-10-15: as quatro tarefas construídas com testes — níveis casados, medidas no painel, audit como motor com o primeiro relatório de 52 achados, e a revisão completa como forma padrão do tipo `[review]`).
- [x] The three as one body: the full fusion `id142`
  - Asked: 2026-10-15 03:33 — "quero sim, quero juntar os 3 como se fossem um"
  - What it means: session-map, ponytail and superpowers as one body at every joint that can be welded: the intensity levels married to the efforts (lite/full/ultra ↔ low/medium/high/xhigh/max), the vendored measurements feeding the bench, the audit as a recurring engine run with ranked reports, and the full senior-dev review as the `[review]` kind's default shape. The remaining parked content stays the reference library — by design, so no chat ever reads it as a cost.
  - How to confirm it is done: the four joints exist with tests (29 green in the affected suites), the Cérebro shows the ponytail names and numbers, the audit runner writes ranked reports, and the review kind asks with the vendored shape.
  - Where it went: `or47` (built: `server/ai/ponytail-levels.mjs`, `server/bench/ponytail.mjs`, `server/audit.mjs`, `server/ai/contract.mjs` `REVIEW_SCHEMA`, `server/ai/ask.mjs`); a certidão da fusão em `.dev/execucao/fusao-dos-tres-corpos.md` (o método, as 9 juntas, a prova da autossuficiência).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: em andamento (as quatro juntas soldadas e testadas; o dono vê os nomes e números no Cérebro após o reinício).
- [x] Refine the Cérebro tab with the best open-source ideas `id143`
  - Asked: 2026-10-15 08:45 — "quero refinar a aba cerebro, tem alguma skill repositorio ou repositorios no github que a gente possa pegar e ajudar a melhorar isso?"
  - What it means: research the open-source ecosystem for what genuinely improves the control plane (model routing tables, cost dashboards, budgets, observability), shortlist the candidates with license and what each would bring, and absorb only what becomes law — the program stays zero-dependency.
  - How to confirm it is done: the shortlist exists with the owner's pick, and the chosen pieces are absorbed (vendored + audited + wired) or refused with the reason.
  - Where it went: the research (this item); each absorbed piece gets its own item.
  - Status: feito (2026-10-15: pesquisa feita, candidatos avaliados e reprovados — as bibliotecas ficam na prateleira até uma lei delas ser escolhida; as skills candidatas foram removidas por poucas estrelas, `id144`).
- [x] Test as a skill first; only what proves itself becomes standard `id144`
  - Asked: 2026-10-15 08:52 — "eu quero que coloque apenas como skill inicialmente para testarmos, se funcionar ai colocamos como padrão, os que nao funcionarem bem retiramos"
  - What it means: the adoption method for outside ideas: they enter as skills (installed, switchable, automatic when on — the `id140` rule), are tested in real chats, and only the ones that prove themselves are absorbed into the engine (vendored + audited + wired, like the ponytail and the superpowers); the ones that fail are turned off or removed. The libraries found (RouteLLM, ai-model-router, LiteLLM…) are frameworks, not skills — they stay on the shelf until a piece of them is chosen to become a law; the skill-form candidates installed for testing are the skills-janitor and the fable-method.
  - How to confirm it is done: the test candidates are installed and on, the owner uses them in real chats, and each one ends either promoted (with its own item) or removed (with the reason).
  - Where it went: the installed test skills; each promotion or removal gets its own item.
  - Status: descartado (2026-10-15: os candidatos instalados — skills-janitor e fable-method — foram reprovados pelo dono antes do teste, por poucas estrelas, e removidos junto com os mercados; o método fica registrado para os próximos candidatos: só entra skill com comunidade provada).
  - Status: em andamento (as quatro juntas soldadas e testadas; o dono vê os nomes e números no Cérebro após o reinício).
- [x] Nothing is done without being projected in the architecture first `id129`
  - Asked: 2026-10-14 19:33 — "virou documento dentro da arquitutura isso tem que ser fundamental nada é feito sem ser projetado primeiro na arquitetura"
  - What it means: the fundamental rule of the program, written into the architecture's own constitution (docs/architecture/README.md "How to keep this true") and held by a motor: every request becomes an item first, every piece of work starts as an item in its part, and every file of the program must be covered by a mention in the architecture — code that was never projected cannot exist (`test/architecture-first.test.mjs`).
  - How to confirm it is done: the rule is written in the README, the test is green, and from now on any work that starts without its item is visible as an unprojected file failing the suite.
  - Where it went: the rule in the README; the motor in `test/architecture-first.test.mjs`; the item `am07`.
  - Status: done on 2026-10-16 (the rule is in the README and the test is green on the working tree; confirmed with `am07`). Before: in progress.

### This registry

- [x] Confirm in the tool that every request was captured precisely `id65`
  - Asked: 2026-10-09 16:36 — "mas como isso vai ficar bem especifico? voce está desenhando tudo isso da maneira correta? sao muitas coisas que estou falando com voce, porque sao coisas do meu dia a dia, eu quero confirmar na ferramenta que está sendo criada e eu muito meticuloso, gosto de perfeccionimos"
  - What it means: this part: one item per request with the owner's words, dates, meaning, a check, the destination item and the status; and, in the tool, a tab to review it, plus a check that no request in a conversation was left without an item.
  - How to confirm it is done: every request the owner made in the conversations up to 2026-10-09 has an item here pointing to a real code; the "requests that did not become an item" line of `fd07` reads zero.
  - Where it went: this part; the tab `mm27`; the conversations check in `fd07`.
  - Status: done on 2026-10-16 (the Requests tab lists every request with its work and, since `mm27`, reviews them one by one; "Tudo em dia?" line g8 reads zero: no open request is without an item). Before: in progress.
- [ ] An Ideas area to review ideas, see whether they were done, keep or delete them `id66`
  - Asked: 2026-10-09 16:38 — "precisamos de uma area de ideias, assim podemos rever elas e ver se foram executadas então, assim podemos apagar ou manter de acordo com o fluxo do programa"
  - What it means: an Ideas tab with each idea's life (new, accepted, in progress, done, later, discarded), a review mode (keep, later, discard), filters, ideas marked done by the watcher with the proof, and reminders for ideas left untouched.
  - How to confirm it is done: see `mm27`.
  - Where it went: `mm27`; the filters and the reminder are `mm63`.
  - Status: in progress (the review with Keep, Later, Discard and Close is built, `mm27`; the filters by date and part and the reminder are parked as `mm63`). Before: accepted.
- [x] The map is built from the code files, not from the markdown docs `id67`
  - Asked: 2026-10-09 16:45 — "percebi que ta pegando so os arquivos md para editar, mas não é isso, é os arquivos com codigos"
  - What it means: the model comes from the code files (census, extractors, import graph); the architecture markdown becomes an output generated and checked against the code, with file:line evidence.
  - How to confirm it is done: every box lists the code files it owns; a doc sentence without evidence in the code is flagged; see `fd12`.
  - Where it went: `fd12`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: accepted.
- [x] Every file mapped, and the program keeps mapping and drawing the Flow on its own `id80`
  - Asked: 2026-10-10 — "tem muitos arquivos sem mapeamento e fizemos um upgrade para mapear novamente o sistema, veja se está tudo correto para o mapa ficar de maneira correta, e isso deveria ser automatico, sempre o programa mapeando e fazer o fluxo automaticamente"
  - What it means: check why so many files have no part on the map and fix it; then the program itself, without anyone editing the markdown, gives every new file its part and keeps "Where in the code" and the Flow in step with the code.
  - How to confirm it is done: the map shows almost every file with an owner part; a new file or test lands in its part by itself; after a change the Flow and "Where in the code" match the code.
  - Where it went: `fd16`, with `fd01`, `fd12` and `fd14`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress (the check and the first step done on 2026-10-10).
- [ ] **in progress:** The app is fast and light, like a high-end app `id84`
  - Asked: 2026-10-10 — "estamos com um problema serio, o session ele está lento de mais, porque faz muitos serviços ao mesmo tempo, acaba que demora para abrir, demora para atualizar, demora para quase tudo, até para abrir os chats ele demora, precisamos que trabalhe com velocidade, seja leve e funcione bem como um app de alto padrao"
  - What it means: the page stops downloading and redrawing everything every 5 seconds (today 1.9 MB per poll, the whole screen redrawn even when nothing changed); the server stops running many heavy jobs (git, re-reading every project) at the same time; opening a chat, a project or the page answers at once.
  - How to confirm it is done: the page opens in under 1 second, a poll with no change sends almost nothing and redraws nothing, a chat opens in under half a second, and the PC's CPU stays low with the map open.
  - Where it went: `sv09`, `sv10`, `mm44`, `pc15`.
  - Status: in progress (reinforced way approved on 2026-10-10).
- [ ] The projects come alive as a small city (or office) whose people are the agents `id92`
  - Asked: 2026-10-11 — "estava pensando em uma ideia, para ficar visualmente legal, criar vida aos projeto, como se estivesse dentro de um escritorio ou como se fosse uma cidade, estilo citiesskyline, que os agentes ou sub agente são a população, não sei se daria para usar com outras pessoas, que usam o programa a cidade ir crescendo, com os carrinho, igual cities skyline mas em qualidade grafica bem menor"
  - What it means: a playful, simple-graphics view where each project is a place (a neighbourhood or an office), the agents and subagents working right now are the people walking and the cars driving, and the city grows as the project grows; maybe later shared with other people who use session-map.
  - How to confirm it is done: to be defined once the design is agreed (brainstorming started on 2026-10-11).
  - Where it went: not yet; first the design.
  - Status: later (parked in the review of 2026-10-16: on 2026-10-11 the owner only wanted to think it through and check if it is viable: "eu não quero fazer ainda nada"). Before: new.
- [ ] **in progress:** A complete, professional chat, like Claude's, Copilot's, ChatGPT's, Gemini's and Cursor's, choosing the other AIs freely `id93`
  - Asked: 2026-10-11 — "não gostei do chat, precisamos dele mais completo igual é o chat do claud, chat do copillot, chat do gpt, chat do gemini, chat do curse, aqui ta muito limitado e o programa acaba que se torna muito limitado, eu tenho varias APIS de outras IAs e nao tenho como ordenar as que eu quero usar sem travas alem de outras coisas as opções ter termos mais profissionais do que termos do jeito que está o chat tem que sem bem profissional mesmo"; 2026-10-11 — "C, quero que as pessoas tenham independencia também de escolher qual IA quer para orquestrar, me ajuda deixar bem profissional esse chat e toda a engrenagem"; 2026-10-11 — "jeito 1, mas acho que ja da pra usar a nova cada do programa ne?"; 2026-10-11 — "acho que ultra code quem decide é o orquestrador, dependendo da atividade … tem que ser bem mais organizado o que é orquestrador o que é automatico o que é o nivel das ias e modelos, porque estamos fazendo para pessoas que trabalham manualmente e pessoas que trabalham sem entender … teve uma vez que estourei tudo, porque a IA fica nivel alto o tempo todo ou ultra code … quero bem organizado, quero com termos profissionais, mas facil entendimento"; 2026-10-11 — "eu queria que visse a fundo mesmo, desse uma pesquisada como poderiamos encaixar as coisas de uma maneira de facil entendimento, organizada, limpa, com termos corretos, quando tiver duvida abre um pequeno dialogo falando o que aquela ferramente faz quando para o mouse em cima, mas com textos profissionais e nao alto tipo \"para quem entende\" o programa nao fica profissional"; 2026-10-11 — "pode segiur"; 2026-10-11 — "eu gostei muito de tudo, mas acho que na questão dos niveis, poderia ter o automatico, porque eu quero que o programa consiga entender no automatico o nivel de tudo, fazendo as coisas em alta qualidade e o maximo de economia, sempre quem usa vibe coding quer isso, então é bom ter os niveis mas ter o nivel automático também para pessoas leigas"; 2026-10-11 — "no automatico até isso pode ser usando sozinho, mas a IA tem quer ser muito meticulosa para fazer isso sozinha, sem alucinacoes, mas acoes que realmente precisam desse nivel de qualidade"; 2026-10-11 — "também que a IA entenda o contexto do chat e refaça os titulos automaticamente"
  - What it means: the page chat gets the features people expect from the big AI chats, the owner picks and orders the AIs he wants to use (his keys) without the automatic limits deciding for him, and the chat's options use professional terms.
  - How to confirm it is done: the owner uses the chat for a day as he uses Claude's or Cursor's, picks any of his AIs for a conversation, and does not miss a feature or a term.
  - Where it went: step 1 `pc20`, `pc21`, `pc22`, `pc23`, `pc24`; steps 2–4 come next.
  - Decided: 2026-10-11 — both: talk directly with the AI one chooses, and keep Claude (or any AI the person picks) as the orchestrator with the person setting the order of the AIs and turning the automatic rules off.
  - Decided: 2026-10-11 — four steps in this order: 1) a professional chat (model picker, edit and resend, regenerate, code blocks, context, usage meter, history, professional terms); 2) talk directly with GPT, Gemini and DeepSeek through the owner's keys; 3) the owner's own rules for the AIs (order, on/off, optional daily cap and privacy rules, with warnings); 4) the other AIs working on files and orchestrating through each company's official agent (Codex, Gemini CLI; DeepSeek through Claude Code's engine) — "jeito 1".
  - Status: in progress (step 1, the professional chat, started on 2026-10-11 after the new look went live; on 2026-10-14 `pc34` delivered `pc20`, `pc21`, `pc23` and the cost half of `pc22` — `pc22`'s context meter and `pc24` are left).
- [x] Choose, when creating a project, only on this computer or also on GitHub `id96`
  - Asked: 2026-10-11 — "serviu, mas é bom deixar a opção para criar na pasta e no github junto ou só no pc"
  - What it means: the New project window (`id95`) gets a choice: only the folder on this computer, or the folder plus a GitHub repository (private unless the person ticks public), created with the GitHub login already on the computer, with a first save sent there.
  - How to confirm it is done: create a project choosing "on the computer and on GitHub": the folder exists, the repository shows on github.com under your account, private, with a README; choosing "only on the computer" nothing goes to GitHub.
  - Where it went: `sv15`, `mm51`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-11 (`sv15`, `mm51` done and tested; checked on the running session-map); waiting for the owner to try it.


### Economy, context and skills

- [ ] The skills are spending tokens like water; hand each task only the skill it needs `id100`
  - Asked: 2026-10-13 — "a gente pega as skills de repositorios no github e sinto que essas skills fazem os tokens correrem igual agua"; 2026-10-13 — "teria como fazer uma forma de eu ter as skills e a engrenagem jogar exatamente o que precisa para aquela skill, assim evitaria gastos de tokens atoa e usaria a skill correta no momento correto da maneira correta"
  - What it means: the always-on list of skill names and descriptions is a real token cost (with hundreds installed) and it multiplies with every agent. session-map should keep the list small (off the unused ones) and deliver only the relevant skill at the right moment.
  - How to confirm it is done: the page shows how many skills are installed and which are on; turning one off removes it from every new chat; a chat on a part carries only the skills that part uses.
  - Where it went: `rd09`, `or22`.
  - Status: in progress: a chat opened on a part gets only the skills that fit (`or22`) and each project shows its plugins (`rd09`), built on 2026-10-13; the per-task skill choice and the one-press off are missing.

- [x] The project as a book with an index: read the index, then only the exact point, never the whole file `id101`
  - Asked: 2026-10-13 — "colocar as coisas como se fosse um livro com indices, então a IA vai gerar alguma coisa vai fazer alguma coisa, ao inves de ir la ler o arquivo completo de tudo, ela ler o indice, dentro do indice de um livro tem os capitulos de sub capitulos, assim iria ao ponto central para ler alguma coisa se fosse preciso de uma forma mais barata"
  - What it means: the architecture map is the book's index (layers → parts → items) and the Foundation builds the deterministic index of the code (file → function → line), so the AI reads the index and only the exact point it needs.
  - How to confirm it is done: a chat reads the architecture README and the facts of the part it was opened on, never the whole repository; every claim points to a file and line.
  - Where it went: `fd01`–`fd16` (the Foundation).
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: accepted (already planned; nothing new beyond the Foundation).

- [x] A rule read once serves every agent: read in full once, then a cheap cache read for the other 500 `id102`
  - Asked: 2026-10-13 — "se quando um agente já leu a regra serve para todos os agentes, assim a regra é lida só uma vez mesmo tendo 500 agentes fazendo o serviço, assim é lido 1 vez"
  - What it means: the fixed block (rules, CLAUDE.md, architecture) stays small and byte-identical across agents, so prompt caching reads it in full once and every other agent pays only the cache read (about 1 to 2% of a full read).
  - How to confirm it is done: the shared prefix is identical across the agents of one project; the cost shows the cheap cache read after the first full read.
  - Where it went: `sv17`; the life of the cache is `sv18` (parked).
  - Status: done on 2026-10-16. Measured: when another agent of the same model started in the five minutes before, 74 % of the agents found the shared start in the cache; the start is identical, and what is lost is the cache expiring after five minutes between agents (`node scripts/cache-share.mjs`).

- [x] A monthly spending cap by default, so the project never runs with no brake `id103`
  - Asked: 2026-10-13 — the owner asked for maximum economy and to close the leak (a single chat reached thousands of dollars); session-map proposed a default monthly cap the owner can change, and the owner approved.
  - What it means: a default monthly limit (a number the owner can change on the page) that pauses new spending past it, instead of running until the credits end.
  - How to confirm it is done: a project with no budget set still has the default limit; past it the Autonomous way stops and asks.
  - Where it went: `or20`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or20`, a default of US$ 30 a month the owner can change).

- [x] Study the ideas of ECC and say which ones session-map should borrow `id145`
  - Asked: 2026-10-15 — "o que esse repositorio faz"; 2026-10-15 — "para colocar no session-map seria interessante?"; 2026-10-15 — "bora estudar as ideias do ECC"
  - What it means: study the ECC repository (memory and session persistence, continuous learning with instincts and learned skills, context controls, hook profiles, skills delivery, AgentShield, token economy) and compare each idea with session-map's engines; write the notes in the repository and propose what is worth borrowing — nothing is installed and no code changes without the owner's OK.
  - How to confirm it is done: the owner reads the notes and the list of ideas worth borrowing; each idea he approves becomes a new item in its part before any code.
  - Where it went: `op16`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress: the study and the comparison were written on 2026-10-15 (`op16`); waiting for the owner to read the notes and choose the ideas to adopt.

- [x] Study every way the program spends tokens, inputs and outputs, item by item `id147`
  - Asked: 2026-10-15 — "quero que estude comigo primeiro todos os meios de como é gastos os tokens nas entradas e saidas, quero tudo bem pontuado, para ver o que podemos fazer."
  - What it means: one complete, itemized map of every token spend of the program — the chat's fixed context and history, the agent briefs, the engine's own AI calls (brain, background, reviews, checkers), the outside AIs' calls, the skills loaded, the book and the summaries — separated by input and output, with the real sizes, prices and cache behavior, and the levers that would cut each one.
  - How to confirm it is done: the owner reads the study (the notes in `research_notes/Gasto de tokens/`) with every spend itemized and can pick, one by one, which lever to pull — each chosen lever becomes its own item before any code changes.
  - Where it went: `op17`; the levers became `or49`, `or50`, `or51` (in progress), `or54` (waits), `or52`, `or53` (parked), `pc36` (waits for the `or35` bench), `op18` (the owner's skill review); the chat-model decision stays in the `or35` bench.
  - Status: feito (2026-10-15: o dono leu o estudo com as seções 12–13 de pesquisa externa por provedor e aprovou o plano — "vamos fazer").

### The Flow as the whole picture of the program

- [x] The Flow as the program's complete mechanical picture, with the AI kept to its part `id120`
  - Asked: 2026-10-14 13:09 — "tem algumas coisas que só os agentes do claude faz, eu quero deixar o programa mais mecanico e a IA ficar com a parte dela, porque tem muitas coisas que precisa de IA, eu sou leigo então tem coisas que eu quero no app, mas não sei bem como explicar, tem varias funções aqui, que não está sendo mapeado no fluxo, o fluxo ele deveria ser uma aba que mostra o funcionamento completo do programa com todas as camadas e funcoes e para que serve cada função como aquela função funciona de onde vem, quem é responsavel por aquela função se é um script, um bot só a IA"; 2026-10-14 13:57 — "voê pode deixar mais refinado né?"
  - What it means: the Flow tab becomes the complete, mechanical picture of the program — every layer and function, what each one is for, where it comes from and who is responsible (a script, a bot or the AI) — worked out by the program itself; the AI keeps only what really needs an AI.
  - How to confirm it is done: every function of the program appears in the Flow with its part, its purpose and its owner; a function no part claims shows as "no box" instead of disappearing; the census runs without an AI and counts zero function orphans; the page filters by script · bot · AI.
  - Where it went: `fl16`, `fl17`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress: the census and the Functions level are built on main (2026-10-14); the parts claimed the 17 orphaned modules; the other things only Claude's agents do (writing the requests, the flow auto-updates `fl11`, the golden rule `fl12`) are the next mechanical steps.

- [x] The conductor stops when the item is done, instead of keeping on and spawning more agents `id104`
  - Asked: 2026-10-13 — the owner saw one request become hundreds of agents; the orchestrator should finish, mark the item done and stop.
  - What it means: when the work is finished and the item ticked `[x]`, the conductor summarizes and ends, instead of starting more work.
  - How to confirm it is done: a finished item ends the turn; a request that should be small does not grow into many agents.
  - Where it went: `or21`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: built on main on 2026-10-13 (`or21`).

- [x] Every map AI that a motor can do becomes a motor: the relation sentences, the keyword placement and the watcher's version and count fixes `id153`
  - Asked: 2026-10-15 14:40 — "hoje o que é por IA, que poderia ser por motor no programa?"; 2026-10-15 14:55 — "isso me reduziria custos?"; 2026-10-15 15:03 — "então vamos fazer esses motores"
  - What it means: the real ledger (10 to 14/out) showed the map's own background calls are the cheap ones (330 relation-why calls = US$ 0,07 of the US$ 1,12), so the motors cut the calls, not the money — the law of maximum motor still stands. Three motors: the relation sentence comes out of templates (the reasons are already structured facts), the placer gains a keyword step before the AI, and the watcher's version and count corrections become a deterministic edit under the same judge.
  - How to confirm it is done: relation-why writes its sentences with zero AI calls; a chat whose words name one part is placed by the motor; a version or count fix costs US$ 0 and the judge still checks it.
  - Where it went: `sb16`, `sb17`, `fd23`.
  - Status: feito (2026-10-15: os três motores construídos e testados — `sb16`, `sb17`, `fd23`; prova viva 8/8).

### Engine and economy

- [x] The program open to every AI, and the DeepSeek work checked `id154`
  - Asked: 2026-10-15 16:09 — "eu mexi em bastante coisa com o deepseek, mudei muita coisas mesmo, quero que verifique e não quero que bloqueei IA nenhuma para mexer nas coisas, quero o programa aberto, porque fiquei sem credito e deu maior dificuldade de trabalhar com outra IA, porque voce deixou tudo orquestrado só pra voce"
  - What it means: Verificar o trabalho grande feito com o DeepSeek (testes, defeitos) e deixar o programa aberto: nenhuma regra de trabalho do guarda trava uma IA; só ficam a proteção do histórico (push forçado) e o OK do dono para dinheiro.
  - How to confirm it is done: A bateria completa de testes passa; um agente sem etiqueta, um workflow grande ou uma edição do mapa não são mais negados; "guard": {"strict": true} no config.json traz de volta as regras rígidas.
  - Where it went: `or64`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: new.
- [x] The standard for every AI, and the Cérebro drives the chat `id155`
  - Asked: 2026-10-15 16:29 — "coloca que o padrão do session-map é para todas as IA e ela pode mexer em tudo, agora o chat vai ser baseado no cerebro, o cerebro agora vai ditar o que vai acontecer, da uma olhada, lá eu consigo colocar cada IA que quero que trabalhe no lugar certo, e quero saber se esse motor está realmente funcionando"
  - What it means: O padrão vale para qualquer IA (entrada AGENTS.md) e todas podem mexer em tudo; o Cérebro manda: a IA escolhida em cada linha é a que trabalha de verdade nessa função, e o motor é medido linha por linha.
  - How to confirm it is done: Uma linha do Cérebro com outra IA (ex.: DeepSeek no Cérebro de entrada ou no risco) faz essa IA trabalhar ali, mostrado por teste; a aba não oferece uma IA numa linha que ela não pode rodar; AGENTS.md existe na raiz.
  - Where it went: `or66`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: new.
- [ ] **in progress · important:** The whole program works, with everything that was built switched on `id156`
  - Asked: 2026-10-15 17:12 — "o que o surigo tem haver com isso? session-map é uma coisa nao vai mexer em coisa errada. Segundo quero fazer o programa funcionar, parece que ta um programa com varias partes, mas estão desligadas, preciso do programa funcional com tudo o que foi criado"
  - Asked: 2026-10-15 17:55 — "eu criei os agentes abaixo, mas ficou bagunçado com os agentes de cima, está bem confuso isso"
  - Asked: 2026-10-15 18:18 — "eu queria repaginar essa area do cerebro, mas de acordo com o que existe realmente no sistema, para eu nao ficar confuso, que tem na tela mas não roda no sistema, e tem muita informação, quero algo clean"
  - Asked: 2026-10-15 18:30 — "livros (titulos e resumos) só tem o claude"
  - Asked: 2026-10-15 19:47 — "sabe me dizer se os IA, modelos e nivel de raciocinio está funcionando de verdade no cerebro?"
  - What it means: Nada do que foi construído pode ficar só nos testes: cada parte do programa tem de ser chamada de verdade quando a pessoa fala com o chat. O que não puder ligar (falta um programa, uma chave) aparece dito com franqueza, linha por linha.
  - How to confirm it is done: Uma tarefa de código dada a uma linha do Cérebro que nomeia o DeepSeek roda de verdade no DeepSeek Harness (numa cópia isolada, com a resposta e o commit de volta); o chat sabe a tabela do Cérebro; a aba mostra quais linhas executam e quais só aconselham; a bateria completa passa.
  - Where it went: `or67`.
  - Status: in progress.
- [x] The chat's bottom bar shows only what is really needed, from what the program already has `id157`
  - Asked: 2026-10-15 — "quero refinar ali o rodapé do chat, ter informações realmente necessarias de acordo com o que já temos no programa"
  - What it means: A barra do rodapé do chat deixa de repetir o que não ajuda e passa a mostrar o que o programa já sabe e a pessoa precisa ver: quanto da memória da conversa já foi usada (com aviso perto do limite), o custo, e o modelo e nível que rodam. As dicas de teclas ficam (decisão dele).
  - How to confirm it is done: O rodapé mostra «48k / 200k» (amarelo perto de 70 %, vermelho perto de 90 %) ao lado do custo; a linha do cérebro diz só «Sonnet · baixo», com o motivo no balãozinho; uma conversa de outro motor não mostra o medidor; os testes passam.
  - Where it went: `pc37`.
  - Status: done on 2026-10-15.
- [x] Specialist agents that are really trained, organized, and the same for every AI `id158`
  - Asked: 2026-10-15 — "Eu queria deixar mais agentes treinados, porem mais organizados, poderia pesquisar como poderiamos fazer isso da melhor forma, porque ta muito generico"; then — "quero fazer tudo de uma vez, mas não usamos apenas o claude, usamos outras IA também, então tem que ser algo que sirva para todos e um metodo funcional e profissional. Seja um senior"
  - O que significa: medido em 2026-10-15, 29 de 33 agentes dos chats foram o genérico e 28 de 33 sem etiqueta de tipo: os nove papéis do catálogo quase nunca chegavam ao trabalho, e o treino deles eram 3 a 6 frases de engenharia geral. A pesquisa (Anthropic) mostra que dividir construtores por tipo de trabalho perde fidelidade a cada passagem, e que um agente dono de uma parte do código, com os testes dela, funciona. Então: um especialista por parte do mapa de arquitetura (o mapa que o dono já mantém é a fonte: o que a parte possui, as regras que não podem quebrar, os testes que a provam), combinado com o papel do tipo da tarefa; escrito uma vez, sem nome de empresa, e desenhado em cada formato nativo (Claude Code, Gemini CLI, Codex) e no corpo do pedido para DeepSeek e as IAs só de API. O "treino" é prova: um teste A/B (com ficha × sem ficha) em casos tirados dos próprios commits de correção, rodado em cada IA, com teto em dólares.
  - How to confirm it is done: `node scripts/sync-agents.mjs --check` limpo; um agente por parte do mapa em `.claude/agents`, `.gemini/agents` e `.codex/agents`; o executor das outras IAs leva a ficha no pedido; o relatório de uso mostra a fatia de agentes genéricos caindo (hoje 88 %); o A/B roda com teto e liga o especialista só onde ele vence o genérico.
  - Where it went: `or68`.
  - Result of the first A/B (2026-10-15, $2.04): the card helps on all four AIs (+0.09 to +0.17 of the localization score); details in `or68`.
  - Status: done on 2026-10-16 (every item it became is ticked; closed in the triage of 2026-10-16). Before: in progress.
- [x] A "Logs" tab in the map that a layperson can read, in plain language `id159`
  - Asked: 2026-10-16 — "eu sou leigo então meu entendimento seria fazer logs em outra aba, mas voce pode ser setico e não querer fazer você tem essa autoridade, por eu ser leigo preciso realmente de um direcinomento profissional"
  - What it means: Measured on 2026-10-16: the program's log had 95 lines in two days, 81 of them routine (listening, restarting, action) and 14 warnings of only two kinds (OpenAI price lookup http-403 ×10, DeepSeek answer cut ×4). A tab that shows the raw lines would bury those two problems. So the tab shows problems first, grouped and said in plain words ("falhou 10 vezes, a última há 3 h"), then a quiet list of what the program did, per project, and the raw lines only on a click for whoever wants them.
  - How to confirm it is done: the tab opens; the two recurring warnings above show as two grouped rows in plain Portuguese with count and last time; picking a project shows its record (`logs/projects/<id>.jsonl`); the raw JSON line opens on a click; no secret appears; the page tests pass.
  - Where it went: `mm61`.
  - Status: done on 2026-10-16 (`mm61`: the tab reads the program's log and the projects' records; checked on a separate copy of the program with the real log, on a computer and on a phone width).
