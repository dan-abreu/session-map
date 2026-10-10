# Ideas and requests

Every request and idea the owner has given for session-map, in his own words, with the date, what it means, how to check it is done, the item it became in another part, and where it stands. It exists so the owner can confirm in the tool that nothing he asked for was lost, changed or forgotten.

The ideas already done or discarded (ticked) live in [Ideas and requests — closed](ideas-closed.md); this file keeps what is new, accepted, in progress or later.

## Index

- The picture of the project: id16
- The model, the orchestration and other AIs: id22, id23, id24, id25, id26, id27, id28
- Following the work live: id30, id33
- Files, terminal and the first use of a repository: id41, id42
- The Flow: id45, id46, id47, id48, id49, id50
- Clarity and polish: id51, id52, id53, id54, id55, id56
- Reading every detail: id57, id58, id59, id60, id61
- Everything up to date and professional: id62, id63, id64, id70, id71, id72
- This registry: id65, id66, id67

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

### The picture of the project

- [ ] Lines inside a part, showing what is tied to what `id16`
  - Asked: 2026-10-09 06:12 — "Dentro das próprias celulas tem as linhas mostrando uma coisa ligada na outra?"; 2026-10-09 06:14 — "Sim"
  - What it means: inside one part, its components (screens, routes, modules, files) and the real links between them, not only links between parts.
  - How to confirm it is done: a double click on a part opens its inner view with components and labeled arrows taken from the code; a component lights while a chat edits one of its files.
  - Where it went: `fl09`, `mm15`, the middle level in `mm34` (it was part of `mm24`).
  - Status: accepted.

### The model, the orchestration and other AIs

- [ ] Other AIs through their APIs, with Claude as conductor (the Arsenal) `id22`
  - Asked: 2026-10-09 08:27 — "tem como colocar para colocar APIs de outras IA, assim voce fica como orquestrador e usa outras IAs naquilo que elas são boas, assim o projeto acaba ficando mais barato"; 2026-10-09 08:31 — "porque tem IA´s que são boas com videos, outras com outras coisas assim por diante, o programa com o arsenal completo, e com os repositorios corretos e skills corretas, teriamos um negocio legal para ajudar a fazer um projeto e rodar uma empresa"; 2026-10-09 08:44 — "sim"
  - What it means: Claude conducts and calls the AI that is best for each job (video, image, voice, bulk text, code) with the right repositories and skills already chosen; session-map is the panel showing each business area, what is being done, by which AI and at what cost.
  - How to confirm it is done: with a second provider's key set, a bulk task is sent to it, its cost shows next to the Claude cost, and the result is reviewed by Claude before it is accepted.
  - Where it went: `or11`, `or12`, `sb07`, `mm19`.
  - Status: later (a strategy talk was agreed for after v0.2).
- [ ] A detailed, categorized list of AIs `id23`
  - Asked: 2026-10-09 11:45 — "faz uma lista minunciosa de IAs e categoriza"; 2026-10-09 11:55 — "é bom"
  - What it means: every relevant AI by category (text and code, image, video, voice, transcription, web search, document reading, vector search, browser automation, workflows, gateways), with what it is good for, price, API, open weights and privacy notes, from official price pages where possible.
  - How to confirm it is done: the "Which AI for each task" section in the tool lists each category with at least one choice, its price, the source and the date the price was checked.
  - Where it went: `mm19` (the research itself was done on 2026-10-09 and kept in the maintainers' notes).
  - Status: accepted.
- [ ] Discover kept up to date in full, and for every AI `id24`
  - Asked: 2026-10-09 11:42 — "como está sendo essa busca de repositorios e skills no github?"; 2026-10-09 11:43 — "sim, e quero saber como ela é atualizada na integra"; 2026-10-09 11:44 — "tem que ser para todas as IA, porque vamos trabalhar com outra IA também, como falamos antes para voce orquestrar e outra IA fazer"
  - What it means: Discover refreshes itself in the background and pages past 50 results per topic; it also lists what works with Codex, Gemini, Cursor and any MCP client, with a "Works with" filter; and it recommends what fits the open project.
  - How to confirm it is done: without pressing Update, the catalog date moves forward daily; a topic with more than 50 repositories shows them all; the "Works with: Gemini" filter shows only entries that declare it.
  - Where it went: `mm20`, `mm18`, `mm17`.
  - Status: later.
- [ ] An impeccable senior conductor, not a cheap one `id25`
  - Asked: 2026-10-09 13:53 — "agora ele tem que ser um orquestrador impecavel, para nao gastar atoa, colocar as IAs no lugar certo no nivel certo, assim nenhum projeto vai estourar limites de tokens porque está trabalhando com sseion mao"; 2026-10-09 13:54 — "nao economico, mas sim impecavel, senior, orquestrador, inteligente"
  - What it means: quality first and saving as a consequence: understand, look at the architecture and Flow, break down and order the work, pick the model the task needs, ask for a second opinion, call nothing done without proof, learn from mistakes per kind of task, route by kind, keep context lean, a monthly budget, a priority queue, and watch the plan's weekly limit.
  - How to confirm it is done: a test request shows the plan, the model picked per step with its reason, a review step and the proof before "done"; a project past 80% of its budget gets an alert; a weekly-limit warning in a history holds the non-urgent work.
  - Where it went: `or04`, `or05`, `or06`, `or07`, `or08`, `wa09`.
  - Status: accepted.
- [ ] A board of roles: think like a CEO `id26`
  - Asked: 2026-10-09 13:55 — "estrategista, marketeiro, financeiro, todos os termos que voce possa pesquisar e entender como um CEO, que vai definir todas as coisas, pensando em dinheiro, pensando em projeto, pensando em entrega, pensando em tudo emsmo"
  - What it means: the orchestration chat weighs each relevant proposal as CEO, Product, Marketing, Finance, Operations, Technology and Legal would (value, cost to build and run, return, timing, positioning, legal risk) and ends with a recommendation; decisions on money, accounts and business priority stay with the owner.
  - How to confirm it is done: a proposal put to the orchestration chat comes back with one paragraph per applicable role and a recommendation, and a money decision waits for the owner's one-click confirmation.
  - Where it went: `or09`, `or10`.
  - Status: accepted.
- [ ] A general project chat, an orchestration chat and activity chats, and doing the work through session-map `id27`
  - Asked: 2026-10-09 12:53 — "é bom já usar o nosso programa pra ir fazendo as coisas o que acha? assim fica facil eu acompanhar e gastar menos token"; 2026-10-09 12:57 — "vamos trabalhar por la ou continuar aqui?"; 2026-10-09 12:58 — "podemos sim só me avisa quando for por la"; 2026-10-09 12:59 — "era bom o chat geral para ir colocando a conversa do projeto como estamos fazendo e abrir chat especificos, tipo um chat de orquestração e um chat de atividades"
  - What it means: one orchestration chat per project, pinned on top, where the owner says what he wants; it opens focused activity chats on items (after a confirmation), hears back from each and keeps itself short; the owner follows everything from session-map instead of one long chat.
  - How to confirm it is done: the project's list shows the orchestration chat pinned; asking it for two items starts two activity chats on those items after one confirmation; when they finish, each posts its result in the orchestration thread and ticks its item.
  - Where it went: `or01`, `or02`, `or03`.
  - Status: accepted.
- [ ] Earn some money with it `id28`
  - Asked: 2026-10-09 00:35 — "Da pra ganhar um dinheirinho com isso?"; 2026-10-09 00:40 — "Não, só tô pensando alto"
  - What it means: a possible paid team plan in the cloud (a map shared between machines), or the Arsenal as a product; nothing of it goes into v0.x.
  - How to confirm it is done: a strategy decision is written (audience, first slice, how it earns) and an interest list exists after the launch.
  - Where it went: `sv05`, `or11`.
  - Status: later (thinking aloud).

### Following the work live

- [ ] A look-only link to show someone else `id30`
  - Asked: 2026-10-09 10:53 — [can I send it to a family member to see how it is going? is there a link]
  - What it means: a second key that shows the live map with no chat and no buttons, safe to give to another person.
  - How to confirm it is done: opening the look-only link shows the map and Live, while every write and chat button is absent and a write request with that key is refused.
  - Where it went: `sv04`.
  - Status: later.
- [ ] **in progress:** Every conversation exactly as Claude Code shows it, with times, and its origin clear `id33`
  - Asked: 2026-10-09 12:55 — "agora falo, as conversas no claude e conversas no vscode, vão aparecer como lá? tem que ser auto explicativo, saber de onde veio"; 2026-10-09 14:34 — "não to achando esse chat aqui no session"; 2026-10-09 14:36 — "eu quero os chats la identico a esse, todos igual mesmo, com o horario com tudo"; 2026-10-09 14:39 — "não quer completar logo tudo por aqui, porque la, ta faltando muita coisa, não da pra saber quando o chat é o claude ou vs, nao ta seperado os chats, tem muita coisa que precisa ser feita, mas não está acabada, mas pelo menos por la eu consigo acompanhar o que está sendo feito correto?"
  - What it means: every message of every conversation with the same formatting as Claude Code, the time of each message, Claude's steps, questions and answers, images, helpers and costs; each conversation's origin (VS Code, terminal, map, claude.ai) shown with a badge; the same chat screen and composer as Claude Code.
  - How to confirm it is done: open a long VS Code conversation on the page and compare side by side with Claude Code: same messages in the same order, same times, same formatting; its row carries the "VS Code" badge.
  - Where it went: `mm22`, `mm23`, `mm04`, `mm33`; claude.ai conversations `rd04`.
  - Status: in progress (`mm22`, reading every conversation like Claude Code with the full composer, and `mm33`, the list that shows at a glance where each chat comes from and what it is doing, are released in v0.2.3; `mm23` is open; `rd04` waits for the owner's OK).

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
  - Status: accepted.

### The Flow

- [ ] Export and import in any format, with the AI filling the Flow in `id45`
  - Asked: 2026-10-09 10:12 — "tem outros formatos ou mmd é o mais usando?"; 2026-10-09 12:54 — "ai eu exporto no formato que eu quero ou importo quando eu quiser, mas depois que a IA ela ler o formato ela mesmo preenche sozinha o FLOW"
  - What it means: export as SVG, PNG, Markdown, draw.io and PlantUML beside `.mmd`; import draw.io, PlantUML, Graphviz, Excalidraw, or an image or PDF of a drawing, which the AI turns into the Flow and matches to the parts.
  - How to confirm it is done: each export opens in its own tool; importing a draw.io file and a photo of a sketch both reach the import preview with each box matched to a part or marked new.
  - Where it went: `fl06`, `fl13`, `fl14`.
  - Status: accepted.
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
  - Asked: 2026-10-09 13:09 — "achei o fluxo bem magro, acho que tinha que ser mais minuncioso"; 2026-10-09 13:17 — "sim"
  - What it means: one model behind every view; level 1 with actors and outside services and labeled arrows; level 2 inside each part; level 3 with numbered end-to-end journeys; declared and detected kept apart.
  - How to confirm it is done: level 1 shows the actors and outside services with a label on every arrow; a double click opens a part's inner flow; the Journeys tab shows 3 to 6 numbered journeys, each step tied to a part.
  - Where it went: `fl07`, `fl08`, `fl09`, `fl10`.
  - Status: accepted.
- [ ] Golden rule: map, Flow and architecture move together `id49`
  - Asked: 2026-10-09 13:43 — "outra coisa o que for adicionado no mapa vira fluxo se for função e se for adicionado no fluxo vira arquitetura automaticamente. também pedidos, `quero isso assim assassado` se é fluxo vira fluxo, mas vira também arquitetura, nada de criar coisas sem criar arquitetura e fluxo"
  - What it means: a new feature or part in the map gives a box and arrows in the Flow; a new box in the Flow gives a part in the architecture; a request in any chat does both; a small task is only an item; new code outside the map is flagged or added.
  - How to confirm it is done: invariant tests pass (no part without a box, no box without a part except actors and outside services); asking a chat for a new feature changes both the part files and the diagram in the same turn.
  - Where it went: `fl12`, `pt04`, `wa10`.
  - Status: accepted.
- [ ] Architecture and Flow at industry level, using what open source already does well `id50`
  - Asked: 2026-10-09 15:30 — "tem algum repositorio que podemos aproveitar para colocar isso no nosso programa?"; 2026-10-09 16:17 — "outra coisa acho que o programa até está indo muito bem mas esquecemos do foco que a arquitetura e o fluxo também tem que ser muito bem feito, se for preciso procura repositorio que faça isso"
  - What it means: the research found no open project that builds a verified C4 model from code; the plan copies the method of the best ones (facts from a parser, AI only enriching, every fact marked extracted or inferred with its file and line, incremental update by hash) and calls a few tools as options.
  - How to confirm it is done: the architecture-core pipeline is built and every node and arrow in the model carries its origin and evidence.
  - Where it went: `fd03`, `fd02`.
  - Status: accepted.

### Clarity and polish

- [ ] Understood at a glance, like for a child, in the whole program `id51`
  - Asked: 2026-10-09 12:56 — "mas tem que ser visivelmente facil de entender o programa como se fosse pra crianca, auto explicativo, bateu o olho entendeu"; 2026-10-09 12:57 — "falo sobre todo o programa e nao apenas isso"
  - What it means: plain words in every screen, message, skill reply, terminal view and README, with icon plus text, a "?" per area, empty screens that say what to do, a five-step welcome tour and a "technical details" mode.
  - How to confirm it is done: a reviewer with a lay persona looks at screenshots of every screen and answers "I understand it in 5 seconds" for each; no raw error code reaches the screen.
  - Where it went: `mm11`, `pt03`, `pt05`.
  - Status: accepted.
- [ ] Relations you can zoom, select and read `id52`
  - Asked: 2026-10-09 13:31 — "a questão das relações, o zoom ficou pouco, não da para selecionar exatamente a linha que voce quer verificar e ficou pobre as informações"
  - What it means: a wider zoom with buttons and pinch; a wide click area on every line; a sorted Relations list; a panel with both parts, strength, every reason with evidence, since when, and actions.
  - How to confirm it is done: a line can be clicked anywhere within about 16 px; the panel lists each reason with a link to its evidence; "ignore" hides it for that project only.
  - Where it went: `mm05`.
  - Status: accepted.
- [ ] Every sign says why it happens and what to do `id53`
  - Asked: 2026-10-09 13:32 — "e nao tem o porque vai da conflito, não tem o porque as informações aparecerem mas elas não tem um porque aquilo ta acontecendo e o que deve ser feito para resolver"
  - What it means: every sign anywhere has three parts (what it is, why it is happening, what to do now) and a button that does it; a branch clash names the branches, owners, shared files and the advice.
  - How to confirm it is done: a test fails if any kind of sign has one of the three fields empty; the clash panel shows the shared files and a "Resolve with the AI" button.
  - Where it went: `wa06`, `wa07`, `wa08`.
  - Status: accepted.
- [ ] A date range like a bank statement `id54`
  - Asked: 2026-10-09 13:36 — "também a data só tem, tudo, hoje, 7, 30, é bom colocar além delas a data que eu escolher por calendario inicio e fim"; 2026-10-09 13:37 — "escolher data igual de banco para pedir extrato"; 2026-10-09 13:37 — "sim concordo"
  - What it means: Today, 7, 15, 30, 60, 90 days, This month, Last month and Custom with From and To and a two-month calendar, remembered per project, applied to What changed, History, Costs and Activity.
  - How to confirm it is done: pick 3 to 9 of a month: the button reads that range, and What changed, History and Costs show only that period; the range is still there after a reload.
  - Where it went: `mm06`.
  - Status: accepted.
- [ ] **in progress:** Information separated by kind, and a polished, beautiful program `id55`
  - Asked: 2026-10-09 13:39 — "acabamento também colocar mas um pouco separada as conversas iterns e etc para entender o que realmente de onde sao aqueles dados, aparece tudo junto, com uma linha separando, é complexo de mais, certo que pessoas do mundo de code entender na hora que ver mas pessoas que nunca mexeram é muita informação e visulamente não ter algo mais organizado fazendo a pessoa entender que aquilo é aquilo mesmo"; 2026-10-09 13:40 — "em tudo, algo mais poligo e bonito visualmente"
  - What it means: panels split into blocks by kind (tasks, chats, lines of work, what changed, files), each with its color, icon and where its data comes from; one visual system for the whole program written in `DESIGN.md`; screenshots approved by the owner before publishing.
  - How to confirm it is done: a part's panel shows separate blocks with their own title and "comes from"; `DESIGN.md` exists with tokens and components; the owner approved the screenshots of the release.
  - Where it went: `mm07`, `mm08`, `mm33`.
  - Status: in progress (`mm07`, `mm08` and the conversation list's obvious divisions `mm33` are released in v0.2.3, with the screenshots approved by the owner).
- [ ] **in progress:** A readable chat: formatting and an input box that grows `id56`
  - Asked: 2026-10-09 16:04 — "nossa chat nao pega formatação nenhuma de nada ta cru, e também a onde escreve ele não vai crescendo de acordo com o que vai digitando ele é grande de mais e acaba que tem muita informação no chat e fica pouca coisa para a parte do dialogo a gente podia reever como melhorar e refinar isso"
  - What it means: replies rendered as markdown like Claude Code (headings, lists, tables, code with copy, links); the input starts at one line and grows to about 40% of the panel; a compact header; controls that fold away, so most of the height is dialogue.
  - How to confirm it is done: a reply with a table and a code block renders both; the empty input is one line high and grows while typing, then scrolls; the header takes one line.
  - Where it went: `mm08`, `mm22`, `mm23`.
  - Status: in progress (markdown replies, the growing input box and the folding controls are released in v0.2.3 with `mm22` and `mm08`; the header shipped as two short lines, and the one-line header is open in `mm23`).

### Reading every detail

- [ ] Read everything, every detail of the program `id57`
  - Asked: 2026-10-09 13:47 — "´ótimo, mas não gostei do que a IA leu" [of one of the owner's projects] "achei que ela não foi minunciosa em tudo, tem que puxar tudo mesmo"; 2026-10-09 13:47 — "tem que ler tudo mesmo, cada detalhe, cada centimetro do programa"
  - What it means: every file read in full and recorded in a read ledger, with "100% read" or the list of what is missing, more rounds until closed, and later only what changed; the shallow first map of that project redone with this method.
  - How to confirm it is done: the report of a study says "100% read" with the per-file ledger; a file left out on purpose is listed with the reason; a second study reads only the changed files.
  - Where it went: `bi04`, `bi05`, `bi06`, `fd01`.
  - Status: accepted.
- [ ] A perfectionist inspector that sees even the wrong commas `id58`
  - Asked: 2026-10-09 13:49 — [not only about that project, but the program] "ele tem que ser minuncioso, tem que ser detalhista, perfeccionista, tem que ser ver tudo, até as viruglas erradas, precisamos disso"; 2026-10-09 13:50 — "tem que ser um detalhista sem deixar passar nada, a pessoa chata que ver tudo, perfeccionista ao extremo"
  - What it means: an inspection of every file for text, code, defects, security, tests, documentation and UI problems, each finding an item with file and line, weight and "what · why · how to fix"; rounds until one finds nothing; grave findings checked twice; session-map inspected before each release.
  - How to confirm it is done: on a test repository with planted mistakes (a wrong comma, an unused function, a secret, a broken link), every one becomes an item with its file and line; the report lists what was checked.
  - Where it went: `bi07`, `bi08`, `bi09`, `bi10`.
  - Status: accepted.
- [ ] Understand the programs first: an exhaustive foundation before new features `id59`
  - Asked: 2026-10-09 14:54 — "acho que arquitetura montada ficou muito generica, não detalhou bem tudo o que tem no programa, por isso está acontecendo, como tudo deve ser documentado então acaba que ele documentou por cima e nao minunciosamente detalhes e também a mesma coisa com session, como vou fazer para uma ferramente sair reamente trabalhavel nivel de industria dessa forma?"; 2026-10-09 14:58 — "claro que a prioridade é entender os programas, como vai orquestrar em cima de algo inefieciente?"
  - What it means: after the polish package, new features freeze and the foundation comes first: exact facts from the code by deterministic extractors, the AI only explaining and grouping, coverage measured; then the maps are redone and measured; only then the orchestration chat.
  - How to confirm it is done: the Foundation part's items are ticked and the redone maps show their measured coverage before `or01` starts.
  - Where it went: `fd01`, `fd02`, `fd11`.
  - Status: accepted.
- [ ] A census letter by letter, number by number `id60`
  - Asked: 2026-10-09 15:01 — "o que deve ser feito é se nao tiver documentação para tal coisa e ele enxergar e criar a documentação, mas sim fazer um vasculho completo, letra por letra, numero por numero de cada arquivo, computar isso e deixar isso organizado, programa tem 1000 letras, 100 linhas, 10 arquivos, 2 pastas, assim vamos ter certeza que ele não deixou passar nada,"
  - What it means: a count without AI of characters, words and lines of every file, summed per folder, part and total; the AI's reading checked against the same counts; every file with an owner; missing documentation written from the code.
  - How to confirm it is done: see `fd01`.
  - Where it went: `fd01`.
  - Status: accepted.
- [ ] Stop the AI from hallucinating when it reads `id61`
  - Asked: 2026-10-09 15:51 — "essa questão de leitura de dados é bem forte, uma IA em leitura alucina muito como fazer para ela não fazer isso, realmente entregar o que é proposto?"
  - What it means: seven rules: facts only from deterministic tools; a closed vocabulary of ids; a file-and-line citation checked for every claim; reading with the text present; two readers and an adversarial check on important points; visible badges (confirmed, AI interpretation, not found); accuracy measured on repositories with an answer key.
  - How to confirm it is done: see `fd04`.
  - Where it went: `fd04`.
  - Status: accepted.

### Everything up to date and professional

- [ ] Nothing outdated, anywhere, in real time `id62`
  - Asked: 2026-10-09 16:28 — "percebi que o readme esta defasado, mesmo depois das atualizações, imagens e etc. Agora nao quero que foque apenas no readme, mas sim em tudo, nada pode ficar desafasado o que esse programa precisa é deixar tudo atualizado na integra em tempo real, organizado sem deixar passar nada e não esquecer de nada"
  - What it means: session-map refuses to publish a release with stale screenshots, mismatched versions, a missing changelog section, a README that cites what does not exist, broken links or unticked done items; and for any project a watcher flags documentation that no longer matches the code.
  - How to confirm it is done: see `fd05` and `fd06`.
  - Where it went: `fd05`, `fd06`.
  - Status: accepted.
- [ ] "Tudo em dia?" must really mean everything `id63`
  - Asked: 2026-10-09 16:29 — "mas nesse teu tudo em dia o que voce está colocando?, tudo mesmo?"
  - What it means: an official checklist of eight groups, each line marked confirmed, warning or not verified, proving what was checked.
  - How to confirm it is done: see `fd07`.
  - Where it went: `fd07`.
  - Status: accepted.
- [ ] Everything a professional repository needs, and versions in sight `id64`
  - Asked: 2026-10-09 16:30 — "tudo o que um repositorio profissional precisa, eu nao sou profissional, além disso eu nao sei as versoes dos programas que estou trabalhando nao esta bem aparente, não foque em apenas em algo que eu digo, pegue a ideia por completo"; 2026-10-09 16:31 — "mas voce pesquisou para falar isso pra mim é só isso mesmo?"
  - What it means: a repository health score from a researched checklist of 91 items in 8 categories; the version of each project's code (and of what runs live, when configured) always in sight; a Projects home page with all of it.
  - How to confirm it is done: see `fd08`, `fd09` and `fd10`.
  - Where it went: `fd08`, `fd09`, `fd10`.
  - Status: accepted.
- [ ] Docs kept at a professional size, with exact pointers to the code `id70`
  - Asked: 2026-10-09 ~17:20 — paraphrased (the exact words were not recorded): keep the documents at a professional size and point to the exact place in the code.
  - What it means: session-map warns when a document grows past a researched size, offers to split it by topic without losing a line, and points to code by path and symbol, with the line worked out when it is opened.
  - How to confirm it is done: see `fd13`.
  - Where it went: `fd13`.
  - Status: accepted.
- [ ] The rules apply to everything in the program, and tips never touch the person's repository unless accepted `id71`
  - Asked: 2026-10-09 ~17:30 — paraphrased (the exact words were not recorded): the rules must apply to everything in the program; tips must not touch the person's repository unless accepted, and must be automatic for people who do not know.
  - What it means: one care mode per project (Automatic, Suggest, Look only) that governs every feature that writes; in Suggest nothing is written without an OK, in Automatic everything is done and logged with Undo.
  - How to confirm it is done: see `fd14`.
  - Where it went: `fd14`.
  - Status: accepted.
- [ ] Every idea executed at a professional level, without the owner having to learn it all `id72`
  - Asked: 2026-10-09 ~18:30 — paraphrased (the exact words were not recorded): he does not want to learn everything; he wants his ideas executed at a professional level, not an amateur one, and felt the earlier summaries were shallow.
  - What it means: a deep specification of what happens to every idea, from "I want this" to live, selling and maintained, in 14 stages (product, design, code, tests, security and LGPD, release, operation and costs, documentation, brand, marketing and video, sales and support, legal, finance, work with AI), each with its steps, roles, models, tools, checks, the owner's decisions and sources; session-map walks every idea through it and proves each step.
  - How to confirm it is done: see `fd15`.
  - Where it went: `fd15`.
  - Status: accepted.

### This registry

- [ ] **in progress:** Confirm in the tool that every request was captured precisely `id65`
  - Asked: 2026-10-09 16:36 — "mas como isso vai ficar bem especifico? voce está desenhando tudo isso da maneira correta? sao muitas coisas que estou falando com voce, porque sao coisas do meu dia a dia, eu quero confirmar na ferramenta que está sendo criada e eu muito meticuloso, gosto de perfeccionimos"
  - What it means: this part: one item per request with the owner's words, dates, meaning, a check, the destination item and the status; and, in the tool, a tab to review it, plus a check that no request in a conversation was left without an item.
  - How to confirm it is done: every request the owner made in the conversations up to 2026-10-09 has an item here pointing to a real code; the "requests that did not become an item" line of `fd07` reads zero.
  - Where it went: this part; the tab `mm27`; the conversations check in `fd07`.
  - Status: in progress (this registry written on 2026-10-09; the tab is `mm27`).
- [ ] An Ideas area to review ideas, see whether they were done, keep or delete them `id66`
  - Asked: 2026-10-09 16:38 — "precisamos de uma area de ideias, assim podemos rever elas e ver se foram executadas então, assim podemos apagar ou manter de acordo com o fluxo do programa"
  - What it means: an Ideas tab with each idea's life (new, accepted, in progress, done, later, discarded), a review mode (keep, later, discard), filters, ideas marked done by the watcher with the proof, and reminders for ideas left untouched.
  - How to confirm it is done: see `mm27`.
  - Where it went: `mm27`.
  - Status: accepted.
- [ ] The map is built from the code files, not from the markdown docs `id67`
  - Asked: 2026-10-09 16:45 — "percebi que ta pegando so os arquivos md para editar, mas não é isso, é os arquivos com codigos"
  - What it means: the model comes from the code files (census, extractors, import graph); the architecture markdown becomes an output generated and checked against the code, with file:line evidence.
  - How to confirm it is done: every box lists the code files it owns; a doc sentence without evidence in the code is flagged; see `fd12`.
  - Where it went: `fd12`.
  - Status: accepted.
