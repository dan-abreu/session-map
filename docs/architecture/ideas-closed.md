# Ideas and requests — closed

Requests that are finished: done (with the release it shipped in, or "on main") or discarded (with the reason). Each stays here ticked, with its code, so the owner can still confirm that nothing he asked for was lost. The open ones are in [Ideas and requests](ideas.md).

## Index

- The first evening: a map of every chat: id01, id02, id03, id04, id05, id06, id07, id08, id09, id10, id11, id12
- The picture of the project: id13, id14, id15, id17, id18, id19
- The model, the orchestration and other AIs: id20, id21
- Following the work live: id29, id31, id32, id34, id35, id36, id37, id38, id39
- Files, terminal and the first use of a repository: id40
- The Flow: id43, id44
- This registry: id68, id69

## How it works

Same item format and status words as in [Ideas and requests](ideas.md). An item moves here when its box is ticked there; its `idNN` code never changes. Dates are the owner's local time (UTC−3).

## Where in the code

Nothing here is code. The closed registry is this file, read by the map like every part:

- `docs/architecture/ideas-closed.md`

## Rules that must not break

- A request is never deleted: it moves between the two files, ticked, with its status and reason.
- No personal data: no names of people, no paths, addresses or links of the owner, no names of his other projects.

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
  - Status: done (switching and closing since v0.1.2; surviving a restart released in v0.2.3).

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

### Following the work live

- [x] Follow live what is being done, in full, from a link `id29`
  - Asked: 2026-10-09 10:39 — "me manda o link ai do que está sendo feito na web pra eu ficar acompanhando acho legal"; 2026-10-09 10:54 — "já está pronto?"; 2026-10-09 10:56 — "é bom ver na integra o que está sendo feito no mapa, assim a gente sabe que ponta está sendo trabalhada"; 2026-10-09 12:14 — "me manda a atualizacao do que está sendo feito, para eu mostrar aqui"; 2026-10-09 12:14 — "eu quero na integra o que está sendo feito"; 2026-10-09 13:06 — "manda o link novo"
  - What it means: a Live view with every conversation working now in every project, its way down the map to the item, its latest steps, its workflows and helper agents with their model; on the map the path to the box being worked lights up with the latest step under it.
  - How to confirm it is done: with a chat editing a file, Live lists it with that step within 5 seconds and the map lights the path from the project to its box; Show on map centers that box.
  - Where it went: `mm29`, `mm09`.
  - Status: done (released in v0.2.2).
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
  - Status: done (the list released in v0.2.2; grouping by project, move and rename released in v0.2.3).
- [x] Know when the AI is working, finished or stopped `id34`
  - Asked: 2026-10-09 12:18 — "parou de fazer as coisas?"; 2026-10-09 12:28 — "já fez tudo?"; 2026-10-09 12:35 — [I asked for the map of one of my projects and it seemed to stop halfway]; 2026-10-09 12:35 — "não da pra saber quando a IA ta trabalhando ou não, se eu quero trabalhar em varios projetos ao mesmo tempo"
  - What it means: every page chat shows one clear state (working, finished with its final summary, interrupted, waiting for permission), with a notice when it finishes; a finished chat never looks stuck.
  - How to confirm it is done: a chat that ends shows "finished" and its summary, and a notice appears; killing its process shows "interrupted" with Continue.
  - Where it went: `pc05`, `pc06`.
  - Status: done (released in v0.2.3).
- [x] Notifications for work running at the same time in different repositories `id35`
  - Asked: 2026-10-09 12:36 — "precisamos de notificação dos trabalhos sendo feitos aos mesmo tempo que pode ser de repositorios diferentes"
  - What it means: every Claude session on the PC watched, whatever the project or tool; finished, waiting for you, error and branch clash become browser notifications, a desktop toast and, if switched on, a phone alert; preferences per project; similar alerts grouped.
  - How to confirm it is done: a VS Code chat in another repository finishes and a desktop toast names its project; a click opens session-map on it; turning a project's alerts off silences only that project.
  - Where it went: `wa01`, `wa02`, `wa03`, `wa04`, `wa05`.
  - Status: done (released in v0.2.3).
- [x] A fixed strip on top with what is being done and where, across repositories `id36`
  - Asked: 2026-10-09 12:37 — "pode ter um painel acima metindo o que está sendo feito e onde está sendo feito"; 2026-10-09 12:38 — "mas é no topo fixo, mesmo que mude o repositorio ela acompanha os outros repositorios"
  - What it means: a "Now" strip fixed on top of every tab, never filtered by the chosen project, with one card per running job in any repository (where, last step, how long, model, helpers) and waiting ones first; badges per project in the picker.
  - How to confirm it is done: the strip's content is the same whichever project is selected; a card's click switches project and opens the point and its chat; the picker shows a pulsing dot on a project with work running.
  - Where it went: `mm09`, `mm10`.
  - Status: done (released in v0.2.3).
- [x] Show where the work really happens, file by file, even from another chat `id37`
  - Asked: 2026-10-09 14:52 — "acho que as bolhas ficaram muito genericas ou ficam pontuais de mais, tipo não da pra falar que só aquilo é tudo e que aquilo realmente é tudo, ficou complexo, é como se a IA fosse mexer em uma coisa só mas mexe em mais coisas"; 2026-10-09 16:07 — "voce esta trabalhando no session map e eu nao to vendo onde"; 2026-10-09 16:08 — "eu quero isso pega real onde está sendo feito os trabalhos, mesmo em um chat diferente"
  - What it means: a conversation lights every part and project whose files it really edits (its own edits, its helpers' and its workflows'), in proportion, live as it edits; a middle level of components between a part and its items; an item that spans parts shows in each.
  - How to confirm it is done: a chat opened in project A that edits files of project B appears in both ("born in A · working in B"), and the parts it edited light in proportion to the files edited; Live lights the part of the file in its last step.
  - Where it went: `mm24`; what is left in `mm34`.
  - Status: done (released in v0.2.3): listed in every project it edits, "born in A · working in B", its parts with their share, Live on the part of its latest file. "Will touch" and the middle level go on in `mm34`.
- [x] Files, lines and share of the program in every box `id38`
  - Asked: 2026-10-09 16:15 — "era bom para cada balão que é colocado, ter a quatidade de arquivos que é daquele balão, quantidade de linhas, as contagens que já estamos fazendo para o programa mais colocando nos blões assim fica facil saber porque aquele balao é aquilo mesmo na arquitetura"
  - What it means: each box shows its number of files, lines and its share of the whole program, summed up the tree; a Files panel lists them by folder; the root shows how many files have no box.
  - How to confirm it is done: the root's file count equals the census total; each layer's count equals the sum of its parts; the "files with no box" number matches the census list of unowned files.
  - Where it went: `mm25`; what changed in the period in `mm34`; exact numbers from `fd01`.
  - Status: done (released in v0.2.3): files, lines and share in every box, summed upward, and the files with no box on the root, counted by session-map itself; the census (`fd01`) refines the numbers.
- [x] Walk through the files of a box `id39`
  - Asked: 2026-10-09 16:17 — "e tem como percorrer nos arquivos? seria muito bom"
  - What it means: a file tree per box like VS Code's explorer, the code colored with line numbers and search, jumps to the files it uses and that use it, and Open in VS Code at the line.
  - How to confirm it is done: open a part, expand its tree, open a file: line numbers and colors show; search finds a word; "used by" lists the files that import it; Open in VS Code lands on that line.
  - Where it went: `mm26`; what is left in `mm36`; files as dots in a part `mm15`.
  - Status: done (released in v0.2.3): a folder tree per box like the editor's, the code in colors with line numbers, search in the file, the files it uses and that use it (JavaScript, TypeScript, CSS and HTML), and Open in VS Code at the picked line. Other languages in the graph go on in `mm36`.

### Files, terminal and the first use of a repository

- [x] Open files and terminals from the map, and a text view for people who use only the terminal `id40`
  - Asked: 2026-10-09 00:22 — "Pelas celulas da pra acessar os arquivos e mexer neles? De uma forma organizada? Criar arquivos também? Criar pastas, usar também os terminais, tem gente que usa so terminal"
  - What it means: a part's files listed with new and changed ones marked, opened read-only with the branch's changes, Open in VS Code and Open terminal in this folder; and `node server/cli.mjs` printing the map as text.
  - How to confirm it is done: tapping a file opens it read-only (never `.git` or `.env`); Open terminal opens a shell in that folder; `node server/cli.mjs --watch` prints the tree and redraws.
  - Where it went: `sv07`, `pt06`.
  - Status: done (released in v0.1.0).

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

### This registry

- [x] See where the work is happening: what is being created, edited and deleted `id68`
  - Asked: 2026-10-09 16:46 — "quero ver onde eles estão mexendo o que estão criando, o que estão apagando, quero isso, saber tudo mesmo do programa"
  - What it means: a live Changes tab with every file touched (created, edited, deleted, renamed), who touched it, where in the map, lines added and removed, the before/after diff, and whether it is saved, committed or released.
  - How to confirm it is done: while a chat or workflow edits a file, the file shows up in Changes within seconds with its diff and its box lights up; a deleted file keeps its previous content (the last version a pass of the server saw, masked); see `mm30`.
  - Where it went: `mm30`; what is left in `mm35`.
  - Status: done (released in v0.2.3): the Changes tab lists every file created, edited, removed or renamed by the conversations, their helpers and workflow agents, and what the folder holds not saved yet, with who, where, lines, before and after, and saved → released; the boxes light with "+N files +M lines now". Edits made by a command (a script, a formatter) still read "outside the conversations": `mm35`.
- [x] See where each workflow is working and which request started it, several places at once `id69`
  - Asked: 2026-10-09 16:47 — "quero ver onde os workflow estão trabalhando onde pedi, porque sei que pode ser em varios locais ao mesmo tempo"
  - What it means: a tree request → workflow → agents → live footprint, one colour per workflow with a dot per active agent on the boxes it touches (several projects at once), and tracing both ways between a request and the files, commits and release it produced.
  - How to confirm it is done: with a workflow running, every active agent shows as a dot on the right box with its last step, and clicking a changed file shows the request that caused it; see `mm31`.
  - Where it went: `mm31`; what is left in `mm37`.
  - Status: done (released in v0.2.3): each team of helpers shows as a tree from what was asked to every helper with its state, model and place; each team has its own colour with a dot per helper at work on the boxes it touches, in any project; the conversation's panel lists the files, saved changes and version of each helper, and a changed file in Changes shows the request that led to it. A page chat's map point as the request, single helpers and team colours on the Now cards go on in `mm37`.
