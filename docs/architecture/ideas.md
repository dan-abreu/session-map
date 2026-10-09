# Ideas and requests

Every request and idea the owner has given for session-map, in his own words, with the date, what it means, how to check it is done, the item it became in another part, and where it stands. It exists so the owner can confirm in the tool that nothing he asked for was lost, changed or forgotten.

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

### The first evening: a map of every chat

- [x] A visual map of everything being worked on at once `id01`
  - Asked: 2026-10-08 20:52 — "eu preciso de um mapa visual mental de tudo que está sendo feito ao mesmo tempo, vai linkando apertando nos pontinhos e vendo o que esta sendo feito, porque estou com muitos chats abertos e acabo que me perco no que está sendo feito, tem uma pagina web com o que está sendo feito, mas não achei suficiente, é bom criar uma skill como se fosse a monday, ou treller, da uma pesquisada se ja tem skills e repositorios prontos assim fica facil ver o que falta e as ramificações das coisas"; 2026-10-09 00:18 — "Isso que esta sendo criado ja existe?"
  - What it means: one page that shows every open conversation of every project, the area of the project each one works on, what is left and what branches off; points that open on a click; a board in columns like Monday or Trello; and a check first of whether a ready-made skill or repository already does it.
  - How to confirm it is done: with chats running in two projects, each chat shows on a box of its own project; the Board tab lists the items in to do / in progress / done columns; a click on a box shows its chats and its open items.
  - Where it went: `mm01`, `mm02`, `am01`, `sb01`.
  - Status: done (released in v0.1.0 as the brain view and rebuilt as the mind map in v0.2.0).
- [x] A plugin anyone can install, published on GitHub `id02`
  - Asked: 2026-10-08 20:55 — "eu quero isso como uma skill para usar em outros projetos"; 2026-10-08 20:55 — "podemos até publicar no github a parte assim as pessoas podem usar"
  - What it means: a Claude Code plugin in its own public repository with a license, installable in any project, not tied to one project.
  - How to confirm it is done: on a clean machine the two install commands of the README install it and `/session-map:map` prints the links; the repository is public and has a LICENSE.
  - Where it went: `pt01`; more plugin directories `pt02`.
  - Status: done (released in v0.1.0).
- [x] See what everything costs `id03`
  - Asked: 2026-10-08 21:00 — "lá era bom ter controle do valor das coisas, também poder fechar e abrir chat, mas seguindo aquela logica, para facilitar na hora que está fazendo as coisas"
  - What it means: the cost of each chat (helpers and workflow agents included), summed per part and per project and by period, visible while working.
  - How to confirm it is done: the Costs tab lists the chats from the most expensive with totals for today, 7 and 30 days, and a chat's header shows what it has cost so far.
  - Where it went: `sb04`; next steps `sb05` (savings report) and `or07` (monthly budget per project).
  - Status: done (released in v0.1.0).
- [x] Open and close chats from the map `id04`
  - Asked: 2026-10-08 21:00 — "também poder fechar e abrir chat, mas seguindo aquela logica"
  - What it means: buttons on a chat to open it where it runs (VS Code or a terminal), start a new one on the same point, close one that is stopped and archive it.
  - How to confirm it is done: Open on a VS Code chat focuses its tab; Close is disabled while the chat works; Archive hides it and "Show archived" brings it back; each action leaves a line in the action log.
  - Where it went: `sv06`.
  - Status: done (released in v0.1.0).
- [x] A big memory of every conversation that Claude does not read on its own `id05`
  - Asked: 2026-10-08 21:08 — "quero que fique salvo as memorias de cada conversa, mas que o claude nao leia tudo, mas fique la como se fosse uma grande memoria de conversas que eu possa usar para saber o que foi feito"; 2026-10-09 12:53 — "como fazemos com essas conversas aqui? ficam onde lá? se eu quiser manter ela ?"; 2026-10-09 12:55 — "tem que manter como memoria como conversamos antes aqui depois apaga"
  - What it means: a faithful copy of every conversation, kept outside the folders Claude Code cleans after 30 days, searchable on the page; Claude reads it only when asked, through `/session-map:history`, and never loads it into a chat by itself.
  - How to confirm it is done: a conversation older than Claude Code's cleanup still opens in History; no hook or skill puts the archive into a new chat; `/session-map:history` answers with at most 5 short matches.
  - Where it went: `rd05`; reading it exactly as Claude Code shows it `mm22`.
  - Status: done (released in v0.1.0).
- [x] The skills installed in each project `id06`
  - Asked: 2026-10-08 21:08 — "e também quero saber as skills que estão instaladas naquele projeto"
  - What it means: per project, the user, project and plugin skills with their origin, on or off, and the command that calls each.
  - How to confirm it is done: the project's Skills panel lists the same skills Claude Code offers in that folder, and Copy puts the right command on the clipboard.
  - Where it went: `rd06`.
  - Status: done (released in v0.1.0).
- [x] Start new chats and write from the page, without going back to VS Code `id07`
  - Asked: 2026-10-08 21:08 — "se possivel também poder abrir novo chats e escrever por la, assim não preciso ficar voltando pro vscode toda hora"
  - What it means: start and continue Claude conversations from the page (also from the phone), with Claude's permission questions answered there.
  - How to confirm it is done: start a chat on a box, send a message, answer an Allow / Deny card, close the sheet and reopen it: the conversation is there and goes on.
  - Where it went: `pc01`, `pc04`.
  - Status: done (released in v0.1.0; kept across closing and restarts since v0.1.3).
- [x] Search GitHub for skills and repositories, by stars, purpose and type `id08`
  - Asked: 2026-10-08 23:43 — "Consegue colocar também um buscador de repositórios no github separar eles por estrelas, eu acho que é por estrelas, pra que cada um serve e separar por tipo, assim quando a pessoa usar esse programa que estamos fazendo, pode selecionar skills sem precisar ficar fazendo buscas, acho que ajudaria bastante."
  - What it means: a ready catalog of repositories with skills and plugins, sorted by stars, with what each is for, its type (skill, plugin, marketplace, MCP server, agent, hook) and category, a mark when already installed, and an install that always asks first.
  - How to confirm it is done: the Discover tab opens with the catalog sorted by stars; the type and category filters narrow it; an installed plugin carries the "installed" mark; Install shows the stars, license and third-party warning before it runs.
  - Where it went: `rd08`.
  - Status: done (released in v0.1.0).
- [x] See it on the phone `id09`
  - Asked: 2026-10-08 23:49 — "Eu to no celular, da pra ver pelo celular?"
  - What it means: the same map on a phone, through a link with a key, readable on a small screen.
  - How to confirm it is done: the network link printed by `/session-map:map` opens on the phone on the same network; the map shows as an indented list under 720 px; without the key nothing loads from outside the PC.
  - Where it went: `mm01`, `sv01`; HTTPS without Tailscale `sv02`.
  - Status: done (released in v0.1.0).
- [x] Who did what: commits, pushes, merges, and a team that sees where each one works `id10`
  - Asked: 2026-10-08 23:57 — "Da pra colocar quem fez commit push essas coisas todas? Assim sabe quem fez alguma coisa? Porque da pra saber quem mudou o que naquele negocio ou ta focado apenas em conversas?"; 2026-10-09 00:01 — "A questão não é apenas conversas, mas códigos, arquivos criados, é uma organização visual bem feita alem das conversas e etc, assim uma equipe que esteja trabalhando sabe onde está trabalhando, sabe quando deu merge" [then: one person's commit and another person's commit each make their own piece, and the pieces join when merged]; 2026-10-09 00:08 — "Mas quando um trabalho está sendo por mais de uma pessoa, pequenas células vão ser criadas e quando da merge vai pra celula que é aquele corpo."
  - What it means: an activity feed per part and per branch (commits with the git author and the AI co-author, pushes, tags, merges, and the chat that made each one); every branch ahead of main shown on the parts it touches with its owner; its join into main recorded.
  - How to confirm it is done: a commit made in a chat shows in that part's Activity with its git author and a link to the chat; a branch by a second git author shows that person's initials on the part; after the merge the event "joined main" appears.
  - Where it went: `rd07`; branches on parts `sb01`; branch clash `wa07`.
  - Status: done (released in v0.1.0; drawn on the parts since v0.2.0).
- [x] Find out on first install what there is and organize it alone `id11`
  - Asked: 2026-10-09 00:45 — "Quando instala a ia faz uma busca geral e organiza o mapa tarefas etc sozinha?"
  - What it means: on install, copy every history that still exists, read git, specs and roadmaps, and place every conversation without the owner doing anything.
  - How to confirm it is done: on a fresh install the first page already lists the last 31 days of conversations of every project, each placed on a part or under "Not placed on the map".
  - Where it went: `sb01`, `rd05`; building a full map and Flow for a repository with none is `id42`.
  - Status: done (released in v0.1.0).
- [x] Switching project must not mix two projects `id12`
  - Asked: 2026-10-09 06:42 — [the map mixed pieces of one of the owner's projects into another one]
  - What it means: after picking another project, nothing of the previous project stays on screen, and an open conversation of the previous project is never sent to the new one's folder.
  - How to confirm it is done: open a chat in project A, switch to project B: the sheet closes, only B's boxes show, and the chat of A keeps running on the PC.
  - Where it went: fixed in v0.1.2; the project on every row `mm04`; moving a conversation to the right project `mm21`.
  - Status: done (released in v0.1.2).

### The picture of the project

- [x] A living tree, brain and cells that grow with each conversation `id13`
  - Asked: 2026-10-08 21:54 — "vai ficar igual uma arvore? que cada conversa de acordo vai aumentando e ramificando visualmente? era ali que eu queria que houvesse o chat, que eu abro o ponto onde tem que ser feito, ele já da continuidade naquela area, é como se fosse um storm brain ou um cerebro que vai acompanhando e varios neuronios, assim o projeto vai criando corpo. como se fosse uma celula e cada celula tem um nucleo e isso ja colocasse cada coisa em seu lugar" [as is done in another of the owner's projects]; 2026-10-08 23:52 — "As celulas não vão se conectando as que tem algum tipo de ligação sobre o assunto?"; 2026-10-08 23:54 — "A célula vai aumentando de acordo com o tempo?"; 2026-10-09 00:11 — "Prefiro sua versão, se eu não gostar vamos mudando, minha versão ficou muito simples"
  - What it means: the project drawn as a body of cells with nuclei, conversations as neurons, cells linked by subject, growing over a timeline, small work cells joining the body on merge.
  - How to confirm it is done: nothing to confirm; the view was removed in v0.2.0 (the changelog lists the cells view, the timeline bar and units as removed).
  - Where it went: removed in v0.2.0; what survived is in `id15` (relations, working dot, what changed, branch clash) and `id14` (chat on a point).
  - Status: discarded (the owner replaced it with the mind map on 2026-10-09 08:10: "bora mudar esse negocio de celular que eu nao gostei").
- [x] The mind map as the project's architecture, growing with each request, with the chat beside it `id14`
  - Asked: 2026-10-08 21:54 — "era ali que eu queria que houvesse o chat, que eu abro o ponto onde tem que ser feito, ele já da continuidade naquela area"; 2026-10-09 08:10 — "eu quero assim esse mapa mental" [a link to a picture of a horizontal mind map] "e igual está aqui no link também, porque o que acontece, pra cada problema eu vou lá escrevo para IA o que precisa ser feito, assim vai ser organizando e o que eu quiser de coisas novas vai sendo colocado na arquitetura do projeto e aumentando o mapa mental, mas em cada parte do mapa mental eu posso ja falar com a IA o que precisa ser feio, eu clico e o chat pode ficar do lado sobre aquele ponto do mapa mental"
  - What it means: the map is read from the project's architecture folder (layers, parts, items); a request written in a chat becomes an item in the right part; a click on a box opens a chat beside the map about that point, already carrying its context.
  - How to confirm it is done: ask for something new in a part's chat: a new item appears in that part's file and on the map without a reload; starting it marks it in progress; finishing ticks it.
  - Where it went: `am01`, `am02`, `mm01`, `pc01`.
  - Status: done (released in v0.2.0).
- [x] Keep what the cells showed, inside the mind map `id15`
  - Asked: 2026-10-09 08:46 — "a minha decisão de apagar as celular e redes neurarais achou bom? porque eu vi aqui que da pra ver que tem umas coisas que o que eu pedi nao vai oferecer"; 2026-10-09 08:48 — "sim pode colocar logo"
  - What it means: a pulsing dot where a chat works (and on the boxes above it), the initials of who has a branch there, dotted relations between parts with their reason, "What changed" lighting the boxes with activity, and a red badge when two branches touch the same file.
  - How to confirm it is done: with a chat running, its box and the boxes above pulse; "Show relations" draws lines and a tap shows the reason; "What changed: today" lights only boxes with activity today; two branches editing one file put a red badge on the part.
  - Where it went: `mm01`, `sb02`; relations you can read `mm05`.
  - Status: done (released in v0.2.0).
- [ ] Lines inside a part, showing what is tied to what `id16`
  - Asked: 2026-10-09 06:12 — "Dentro das próprias celulas tem as linhas mostrando uma coisa ligada na outra?"; 2026-10-09 06:14 — "Sim"
  - What it means: inside one part, its components (screens, routes, modules, files) and the real links between them, not only links between parts.
  - How to confirm it is done: a double click on a part opens its inner view with components and labeled arrows taken from the code; a component lights while a chat edits one of its files.
  - Where it went: `fl09`, `mm15`, the middle level of `mm24`.
  - Status: accepted.
- [x] A "New idea" chat that puts the idea in the right place `id17`
  - Asked: 2026-10-09 08:20 — "sim aprovo, e também lá pode colocar um chat do que eu quero de ideias nova, a IA ajuda a colocar a ideia no lugar correto"
  - What it means: a button that opens a chat on the whole project; the AI reads the architecture, proposes the part (or a new part) and the group, shows the line it will add and writes only after the owner's OK.
  - How to confirm it is done: New idea → describe an idea → the chat names the part and group and shows the exact line; the file changes only after OK.
  - Where it went: `pc02`; later absorbed by the orchestration chat `or01`.
  - Status: done (released in v0.2.0).
- [x] Choose the permission mode: per conversation or for every Claude on this PC `id18`
  - Asked: 2026-10-09 06:46 — "eu abro a conversa com o claude sobre uma celula quando volto a conversa ja se apagou ele fica pedindo toda hora para liberar os comando não tem como deixar ele ir automatico?"; 2026-10-09 08:25 — "coloca as 2 opções, fica a criterio do usuario"
  - What it means: a page conversation stays after the sheet closes; it runs in the owner's own permission mode; the mode can be changed per conversation, or written once for every Claude on the PC (VS Code and terminal too) with a backup and undo; the bypass mode is never used.
  - How to confirm it is done: close and reopen the sheet and the conversation is there; with "Edits on their own" an edit runs without asking; "Use on this whole PC" writes `permissions.defaultMode`, keeps a backup and Undo restores the old value; a bypass value is refused.
  - Where it went: `pc04`.
  - Status: done (released in v0.1.3 and v0.2.0).
- [x] A chat keeps working when I switch project or close the sheet `id19`
  - Asked: 2026-10-09 11:12 — "se eu sair de um projeto a outro vai fechar o chat ele para de trabalhar?"
  - What it means: closing the sheet or switching project never stops a running chat; a server restart does not kill it either, or it offers to continue.
  - How to confirm it is done: start a long task, switch project and come back: it went on; restart the server mid-task: it continues, or says it was cut off and offers Continue.
  - Where it went: `pc06`.
  - Status: done (switching and closing since v0.1.2; surviving a restart on main, ships in the release after v0.2.2).

### The model, the orchestration and other AIs

- [x] A rule: the right skills, agents, model and level before any action `id20`
  - Asked: 2026-10-08 23:27 — "Mas usa as skill tem o superpower ta usando ele pra fazer isso?"; 2026-10-08 23:29 — "Tem varias skills aqui ja, não sei você esta usando elas, Eu queria uma regra para colocar antes de fazer qualquer coisa no claude md e deixa isso bem explicito, Usar as skills necessárias, usar os agentes necessários de acordo com o nivel da atividade, usar o modelo correto e o nivel do modelo correto dependendo do que está sendo proposto"
  - What it means: before acting, classify the task (trivial, small, medium, large, sensitive), open the skills that apply, pick agents by size and set the model and effort explicitly, and say what was chosen.
  - How to confirm it is done: the rule is in the owner's own Claude instructions; in session-map, an Automatic page chat sizes each request by that rule and its header says what it chose and why.
  - Where it went: the rule itself lives in the owner's Claude instructions, outside this repository; in session-map it is `pc07`.
  - Status: done (rule written on 2026-10-08; the Automatic way released in v0.2.2).
- [x] Automatic and manual choice of model, effort and ultracode `id21`
  - Asked: 2026-10-08 23:43 — "se eu colocar o claude no ultra code e mesmo a atividade não precisa e você ter ordens para não usar no ultra code ainda vai usar? Ou você consegue orquestra cada agente e o nivel dele?"; 2026-10-09 11:18 — "e como sabe o nivel do modelo da IA?"; 2026-10-09 11:21 — "mas tem o ultra code também que é mais caro"; 2026-10-09 11:22 — "eu quero isso em automatico e quero isso manual, porque depende muito de quem esteja usando, por exemplo eu nao sei quando usar um ultra code eu nao sei usar os niveis"
  - What it means: the chat header shows the model and effort that really run and the cost; Automatic (default) answers small requests directly, hands medium ones to helpers with an explicit model and effort, and for large or sensitive ones explains, estimates and waits for Yes before the reinforced (ultracode-like) way; Manual offers Maestro, Ultracode (after a cost warning), a fixed model and level, and Same as my Claude, each with when to use it.
  - How to confirm it is done: a new page chat is Automatic; a sensitive request shows the plain explanation, an estimate and Yes / No, and waits under "Waiting for you"; switching to Manual › Fixed › Haiku low makes the header show Haiku and low.
  - Where it went: `pc07`.
  - Status: done (released in v0.2.2).
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

- [x] Follow live what is being done, in full, from a link `id29`
  - Asked: 2026-10-09 10:39 — "me manda o link ai do que está sendo feito na web pra eu ficar acompanhando acho legal"; 2026-10-09 10:54 — "já está pronto?"; 2026-10-09 10:56 — "é bom ver na integra o que está sendo feito no mapa, assim a gente sabe que ponta está sendo trabalhada"; 2026-10-09 12:14 — "me manda a atualizacao do que está sendo feito, para eu mostrar aqui"; 2026-10-09 12:14 — "eu quero na integra o que está sendo feito"; 2026-10-09 13:06 — "manda o link novo"
  - What it means: a Live view with every conversation working now in every project, its way down the map to the item, its latest steps, its workflows and helper agents with their model; on the map the path to the box being worked lights up with the latest step under it.
  - How to confirm it is done: with a chat editing a file, Live lists it with that step within 5 seconds and the map lights the path from the project to its box; Show on map centers that box.
  - Where it went: `mm29`, `mm09`.
  - Status: done (released in v0.2.2).
- [ ] A look-only link to show someone else `id30`
  - Asked: 2026-10-09 10:53 — [can I send it to a family member to see how it is going? is there a link]
  - What it means: a second key that shows the live map with no chat and no buttons, safe to give to another person.
  - How to confirm it is done: opening the look-only link shows the map and Live, while every write and chat button is absent and a write request with that key is refused.
  - Where it went: `sv04`.
  - Status: later.
- [x] Drag the chat as wide as I want `id31`
  - Asked: 2026-10-09 10:55 — "coloca pra puxar mais o chat, eu decido até onde o chat vai, tem gente que tem uma tela de pc maior outros menores"
  - What it means: a handle on the chat sheet's edge to make it wider or narrower (mouse and keyboard), remembered, with a double click to reset.
  - How to confirm it is done: drag the edge: the sheet follows and keeps the width after a reload; arrow keys move it; a double click restores the default; the same in the Flow workshop.
  - Where it went: `pc08`.
  - Status: done (released in v0.2.1).
- [x] Find every conversation easily, grouped by project, like Claude's own list `id32`
  - Asked: 2026-10-09 11:26 — "eu sai de uma conversa ao qual eu estava fazendo uma coisa la, agora nao to achando mais, nao fica claro as conversas que estavam sendo feitas, tipo aqui no claude eu consigo ver as conversas eu estou"; 2026-10-09 11:27 — "tem que ser mais visualmente facil de achar as coisas, deixar os historicos de conversa por projetos abertas, assim clica e ja vai para aquele balão ou area que está sendo feito"; 2026-10-09 13:20 — "eu queria essa conversa la e todas as conversas, tipo depois que instala as conversas ficam, mas tinha que ser algo patrodonizado onde as pessoas ja se acostumaram a trabalhar então a verificação ficaria facil tipo, tu colocou todos os projetos, mas nao falou de que projeto era aquele chat, fica dificil acompanhar as coisas assim, tem que ser tudo bem organizado com excelencia"; 2026-10-09 13:21 — "gostei"
  - What it means: a conversation list beside the map, grouped by project like the project folders of Claude or ChatGPT, every row with its project, place on the map, age, cost and origin; a click opens the map down to its box and opens the conversation; a wrongly placed conversation can be moved and renamed.
  - How to confirm it is done: in "All projects" no row lacks its project; a click on a row centers its box with a pulse and opens the chat; moving a conversation to another part keeps it there after the next read.
  - Where it went: `mm28`, `mm04`, `mm21`.
  - Status: done (the list released in v0.2.2; grouping by project, move and rename on main, ship in the release after v0.2.2).
- [ ] **in progress:** Every conversation exactly as Claude Code shows it, with times, and its origin clear `id33`
  - Asked: 2026-10-09 12:55 — "agora falo, as conversas no claude e conversas no vscode, vão aparecer como lá? tem que ser auto explicativo, saber de onde veio"; 2026-10-09 14:34 — "não to achando esse chat aqui no session"; 2026-10-09 14:36 — "eu quero os chats la identico a esse, todos igual mesmo, com o horario com tudo"; 2026-10-09 14:39 — "não quer completar logo tudo por aqui, porque la, ta faltando muita coisa, não da pra saber quando o chat é o claude ou vs, nao ta seperado os chats, tem muita coisa que precisa ser feita, mas não está acabada, mas pelo menos por la eu consigo acompanhar o que está sendo feito correto?"
  - What it means: every message of every conversation with the same formatting as Claude Code, the time of each message, Claude's steps, questions and answers, images, helpers and costs; each conversation's origin (VS Code, terminal, map, claude.ai) shown with a badge; the same chat screen and composer as Claude Code.
  - How to confirm it is done: open a long VS Code conversation on the page and compare side by side with Claude Code: same messages in the same order, same times, same formatting; its row carries the "VS Code" badge.
  - Where it went: `mm22`, `mm23`, `mm04`; claude.ai conversations `rd04`.
  - Status: in progress (`mm22`, reading every conversation like Claude Code with the full composer, is done on main; `mm23` is open; `rd04` waits for the owner's OK).
- [x] Know when the AI is working, finished or stopped `id34`
  - Asked: 2026-10-09 12:18 — "parou de fazer as coisas?"; 2026-10-09 12:28 — "já fez tudo?"; 2026-10-09 12:35 — [I asked for the map of one of my projects and it seemed to stop halfway]; 2026-10-09 12:35 — "não da pra saber quando a IA ta trabalhando ou não, se eu quero trabalhar em varios projetos ao mesmo tempo"
  - What it means: every page chat shows one clear state (working, finished with its final summary, interrupted, waiting for permission), with a notice when it finishes; a finished chat never looks stuck.
  - How to confirm it is done: a chat that ends shows "finished" and its summary, and a notice appears; killing its process shows "interrupted" with Continue.
  - Where it went: `pc05`, `pc06`.
  - Status: done (on main, ships in the release after v0.2.2).
- [x] Notifications for work running at the same time in different repositories `id35`
  - Asked: 2026-10-09 12:36 — "precisamos de notificação dos trabalhos sendo feitos aos mesmo tempo que pode ser de repositorios diferentes"
  - What it means: every Claude session on the PC watched, whatever the project or tool; finished, waiting for you, error and branch clash become browser notifications, a desktop toast and, if switched on, a phone alert; preferences per project; similar alerts grouped.
  - How to confirm it is done: a VS Code chat in another repository finishes and a desktop toast names its project; a click opens session-map on it; turning a project's alerts off silences only that project.
  - Where it went: `wa01`, `wa02`, `wa03`, `wa04`, `wa05`.
  - Status: done (on main, ships in the release after v0.2.2).
- [x] A fixed strip on top with what is being done and where, across repositories `id36`
  - Asked: 2026-10-09 12:37 — "pode ter um painel acima metindo o que está sendo feito e onde está sendo feito"; 2026-10-09 12:38 — "mas é no topo fixo, mesmo que mude o repositorio ela acompanha os outros repositorios"
  - What it means: a "Now" strip fixed on top of every tab, never filtered by the chosen project, with one card per running job in any repository (where, last step, how long, model, helpers) and waiting ones first; badges per project in the picker.
  - How to confirm it is done: the strip's content is the same whichever project is selected; a card's click switches project and opens the point and its chat; the picker shows a pulsing dot on a project with work running.
  - Where it went: `mm09`, `mm10`.
  - Status: done (on main, ships in the release after v0.2.2).
- [ ] Show where the work really happens, file by file, even from another chat `id37`
  - Asked: 2026-10-09 14:52 — "acho que as bolhas ficaram muito genericas ou ficam pontuais de mais, tipo não da pra falar que só aquilo é tudo e que aquilo realmente é tudo, ficou complexo, é como se a IA fosse mexer em uma coisa só mas mexe em mais coisas"; 2026-10-09 16:07 — "voce esta trabalhando no session map e eu nao to vendo onde"; 2026-10-09 16:08 — "eu quero isso pega real onde está sendo feito os trabalhos, mesmo em um chat diferente"
  - What it means: a conversation lights every part and project whose files it really edits (its own edits, its helpers' and its workflows'), in proportion, live as it edits; a middle level of components between a part and its items; an item that spans parts shows in each.
  - How to confirm it is done: a chat opened in project A that edits files of project B appears in both ("born in A · working in B"), and the parts it edited light in proportion to the files edited; Live lights the part of the file in its last step.
  - Where it went: `mm24`.
  - Status: accepted.
- [ ] Files, lines and share of the program in every box `id38`
  - Asked: 2026-10-09 16:15 — "era bom para cada balão que é colocado, ter a quatidade de arquivos que é daquele balão, quantidade de linhas, as contagens que já estamos fazendo para o programa mais colocando nos blões assim fica facil saber porque aquele balao é aquilo mesmo na arquitetura"
  - What it means: each box shows its number of files, lines and its share of the whole program, summed up the tree; a Files panel lists them by folder; the root shows how many files have no box.
  - How to confirm it is done: the root's file count equals the census total; each layer's count equals the sum of its parts; the "files with no box" number matches the census list of unowned files.
  - Where it went: `mm25`; exact numbers from `fd01`.
  - Status: accepted.
- [ ] Walk through the files of a box `id39`
  - Asked: 2026-10-09 16:17 — "e tem como percorrer nos arquivos? seria muito bom"
  - What it means: a file tree per box like VS Code's explorer, the code colored with line numbers and search, jumps to the files it uses and that use it, and Open in VS Code at the line.
  - How to confirm it is done: open a part, expand its tree, open a file: line numbers and colors show; search finds a word; "used by" lists the files that import it; Open in VS Code lands on that line.
  - Where it went: `mm26`; files as dots in a part `mm15`.
  - Status: accepted.

### Files, terminal and the first use of a repository

- [x] Open files and terminals from the map, and a text view for people who use only the terminal `id40`
  - Asked: 2026-10-09 00:22 — "Pelas celulas da pra acessar os arquivos e mexer neles? De uma forma organizada? Criar arquivos também? Criar pastas, usar também os terminais, tem gente que usa so terminal"
  - What it means: a part's files listed with new and changed ones marked, opened read-only with the branch's changes, Open in VS Code and Open terminal in this folder; and `node server/cli.mjs` printing the map as text.
  - How to confirm it is done: tapping a file opens it read-only (never `.git` or `.env`); Open terminal opens a shell in that folder; `node server/cli.mjs --watch` prints the tree and redraws.
  - Where it went: `sv07`, `pt06`.
  - Status: done (released in v0.1.0).
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

- [x] A Flow tab that maps how the system is connected, with mermaid import and export `id43`
  - Asked: 2026-10-09 10:07 — "é bom colocar também para fazer igual mermaid que pega o sistema como ele é ligado, tipo o mapeamento do programa funcionalidades e etc?"; 2026-10-09 10:11 — "mas é bom uma aba diferente e aceitar também o modelo de importa e exporta o mermaid"
  - What it means: a tab of its own drawing the architecture's diagram, boxes tied to parts and colored by status; export as mermaid and import one back with a preview, never deleting a part.
  - How to confirm it is done: the Flow tab draws the README diagram; Download gives a `.mmd`; importing that same file shows "nothing changes"; a new box in an imported file creates a skeleton part after confirmation.
  - Where it went: `fl01`, `fl02`.
  - Status: done (released in v0.2.1).
- [x] A chat in the Flow that builds the drawing live, with manual tools too `id44`
  - Asked: 2026-10-09 10:14 — "era bom um chat nessa area que vai montado com a IA a pessoa vai conversando e vai vendo ao vivo a IA montando pra ele dando ferramentas se ele quiser montar sozinho"
  - What it means: a shared draft per project; a side chat redraws it with every reply; tools add boxes, arrows and layers, rename, move and remove, with a text editor and undo; nothing reaches the project until Apply.
  - How to confirm it is done: ask the workshop chat for a new box: the drawing changes at once; add an arrow by hand and undo it; the README is unchanged until Apply.
  - Where it went: `fl03`.
  - Status: done (released in v0.2.1).
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
- [ ] Information separated by kind, and a polished, beautiful program `id55`
  - Asked: 2026-10-09 13:39 — "acabamento também colocar mas um pouco separada as conversas iterns e etc para entender o que realmente de onde sao aqueles dados, aparece tudo junto, com uma linha separando, é complexo de mais, certo que pessoas do mundo de code entender na hora que ver mas pessoas que nunca mexeram é muita informação e visulamente não ter algo mais organizado fazendo a pessoa entender que aquilo é aquilo mesmo"; 2026-10-09 13:40 — "em tudo, algo mais poligo e bonito visualmente"
  - What it means: panels split into blocks by kind (tasks, chats, lines of work, what changed, files), each with its color, icon and where its data comes from; one visual system for the whole program written in `DESIGN.md`; screenshots approved by the owner before publishing.
  - How to confirm it is done: a part's panel shows separate blocks with their own title and "comes from"; `DESIGN.md` exists with tokens and components; the owner approved the screenshots of the release.
  - Where it went: `mm07`, `mm08`.
  - Status: accepted.
- [ ] **in progress:** A readable chat: formatting and an input box that grows `id56`
  - Asked: 2026-10-09 16:04 — "nossa chat nao pega formatação nenhuma de nada ta cru, e também a onde escreve ele não vai crescendo de acordo com o que vai digitando ele é grande de mais e acaba que tem muita informação no chat e fica pouca coisa para a parte do dialogo a gente podia reever como melhorar e refinar isso"
  - What it means: replies rendered as markdown like Claude Code (headings, lists, tables, code with copy, links); the input starts at one line and grows to about 40% of the panel; a compact header; controls that fold away, so most of the height is dialogue.
  - How to confirm it is done: a reply with a table and a code block renders both; the empty input is one line high and grows while typing, then scrolls; the header takes one line.
  - Where it went: `mm08`, `mm22`.
  - Status: in progress (markdown replies are done on main with `mm22`; the growing input box, compact header and folding controls are open in `mm08`).

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
- [ ] See where the work is happening: what is being created, edited and deleted `id68`
  - Asked: 2026-10-09 16:46 — "quero ver onde eles estão mexendo o que estão criando, o que estão apagando, quero isso, saber tudo mesmo do programa"
  - What it means: a live Changes tab with every file touched (created, edited, deleted, renamed), who touched it, where in the map, lines added and removed, the before/after diff, and whether it is saved, committed or released.
  - How to confirm it is done: while a chat or workflow edits a file, the file shows up in Changes within seconds with its diff and its box lights up; a deleted file keeps its previous content; see `mm30`.
  - Where it went: `mm30`.
  - Status: accepted.
- [ ] See where each workflow is working and which request started it, several places at once `id69`
  - Asked: 2026-10-09 16:47 — "quero ver onde os workflow estão trabalhando onde pedi, porque sei que pode ser em varios locais ao mesmo tempo"
  - What it means: a tree request → workflow → agents → live footprint, one colour per workflow with a dot per active agent on the boxes it touches (several projects at once), and tracing both ways between a request and the files, commits and release it produced.
  - How to confirm it is done: with a workflow running, every active agent shows as a dot on the right box with its last step, and clicking a changed file shows the request that caused it; see `mm31`.
  - Where it went: `mm31`.
  - Status: accepted.
