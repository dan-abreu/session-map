# Around the map: a calmer shell, one inbox, a quieter chat (id91 → mm47, mm48, mm49, pc18, pc19)

Approved by the owner on 2026-10-11 ("é, gostei") after seeing the pictures in `C:\dev\session-map\.dev\redesign\mock\D\` (D-mapa.png, D-menus.png, D-chat.png, D-chat-menu.png, D-celular.png). Those pictures are the visual contract; the critique of the old screens is in `C:\dev\session-map\.dev\redesign\before\`.

## The owner's words

"não quero que mude o mapa, eu quero que mude ao redor, tem muita informação na tela e as opções de trabalhar estão muito espalhadas … o chat, as opções do chat, as opções do mapa, aquela tela ali em cima" — "minimalista, moderna, intuitiva, organizada, autodidata, bem polida".

## Direction contract

- **THESIS:** the map is the product; everything around it collapses into three calm places — one bar, one inbox, one chat — and every way to work lives in exactly one menu.
- **FIRST VIEWPORT:** a slim top bar, the inbox on the left led by what needs you, one quiet line of map options, and the map with most of the screen. One amber count, nowhere repeated.
- **VISITOR PATH:** see the amber count → the inbox says in one line what each waiting chat needs → open it → answer with a quick-reply button or a sentence → back to the map.
- **SIGNATURE INTERACTION:** quick replies: when Claude ends with a question, its options become buttons under the reply.
- **CROSS-SURFACE REACH:** the same tokens, words and counts in the top bar, inbox, map header, chat and phone layout.
- **HONEST RISK:** moving controls into menus can hide them; every menu item keeps its words, and nothing an everyday user needs "always" goes behind more than one click.

## Rules

- **The map is not changed**: its canvas, boxes, chips, lines, levels and behaviour stay byte-for-byte as they are (`mindmap.js`, the `.mm-*` styles). Only the controls around it move (zoom group restyle allowed).
- **Every function survives** (the keep-list in the critique): nothing is deleted, only moved. Look-only mode, phone layout, keyboard use, help "?", tour, technical-words switch, PT/EN all keep working.
- **One fact, one number**: the waiting count shown in the top bar is the same number as the inbox's "Precisa de você" group, computed in one place.
- Tokens only (`style.css` `:root`), AA contrast in light and dark, reduced motion respected, 390 px phone with nothing cut. Fix the broken light `--shadow-sm` / `--shadow-md` (they reference themselves today).
- Plain Brazilian Portuguese and English for every new string, in every language block of `i18n.js`.

## What changes

### Top bar (`mm47`)
One row: mark + project switcher; nav **Início · Mapa · Conversas · ⋯ (Mais)** — Rota and Ideias leave the bar until they exist (they stay reachable inside Mais only if they already have a page; otherwise hidden); right: one amber pill **"N precisam de você"** that contains the bell (alerts) and opens the waiting list, the "?" help menu, and the person's menu (language PT/EN, theme if any, settings). The **Now ("Agora") strip is removed from the page**: its content is the inbox's Precisa de você / Trabalhando groups.

### Map header and menus (`mm48`)
One row above the map: left, quiet "project · X de Y feitos · N trabalhando"; right, "Buscar no mapa" and one **"Vista ▾"** menu: O que mudou (Tudo / Hoje / 7 dias…, the existing ranges), Mostrar arquivos, Mostrar relações (toggles), Exportar o mapa ▸ (.md, FreeMind, XMind), and "Manter o mapa em dia sozinho" with "isso gasta" (the old "Sempre em dia" toggle). Removed from the toolbar: Novo chat, Orquestrador, Nova ideia, Ao vivo, "Esperando você aqui" — their functions move to the **"Novo ▾"** menu (Nova conversa · Nova ideia · Orquestrador do projeto) at the top of the inbox, the inbox groups and the amber pill.

### Inbox (`mm49`)
The conversation list becomes an inbox: header "Conversas" + **"Novo ▾"**; search with a small "Este projeto ▾ / Todos" scope inside the field; groups replace the five state chips: **Precisa de você · N** (each row: title, part, time, and one line of what is needed, from the waiting signal), **Trabalhando · N** (current step; the orchestrator first, its activity chats indented under it), **Recentes** (finished, quiet), **Cortadas** (only when there are any, with Continuar), **Arquivadas · N** collapsed at the bottom. Cost and ⋯ appear on hover/focus. "Todos os projetos" keeps grouping by project.

### Chat (`pc18`)
- One header line: state dot, title, part chip, ⋯, ×. The ⋯ menu holds: Sobre esta parte (the old folded info with its tabs, opening in place), Procurar nesta conversa (Ctrl F, the old find bar and "Ir para"), Renomear ou mover, Arquivar, Abrir num terminal, Apagar, Nova conversa.
- Tool activity of a turn folds into one row "Fez N passos · leu A arquivos, mudou B ▸" (expands to the existing rows); thinking rows fold into it too.
- **Quick replies:** when the last Claude reply ends with a question offering explicit options (a numbered or lettered list, or "X ou Y?" alternatives), show them as buttons under the reply; clicking sends that option's text. A line "Ou responda com suas palavras" under them. Never invent options that are not in the text.
- While a turn runs: a slim line "Trabalhando · <current step> [Parar]" above the composer (replaces the separate status line and the old Stop placement).
- Composer: text box with the key hints inside it as quiet text ("Enter envia · @ arquivo · / comando"), attach, the compact run button, Enviar. No separate hints line.

### Run menu (`pc19`)
Three ways only, one sentence each: **Autônomo** (faz tudo até o fim e lista as decisões; só para se passar do limite do mês), **Automático** (pergunta antes de trabalho grande), **Manual** (você escolhe o modelo — choosing it shows the model and level pickers inline). A quiet line "Modelo · nível · US$ X nesta conversa". A link **"Limite do mês e permissões…"** opens a small **Configurações** sheet (reachable also from the person's menu) holding: the monthly limit (same value as the Home card), "pode reforçar sozinho", the permission mode, "usar este modo em todo Claude deste PC", and "Jeitos avançados" (Maestro, Ultracode, Igual ao meu Claude).

## Testing
- Existing tests keep passing; update the ones that assert removed DOM (toolbar buttons, Now strip, state chips, header layers) to assert the new place of the same function.
- New tests: one waiting count shared by pill and inbox; Vista and Novo menus hold every moved function; inbox grouping (including orchestrator nesting and archived collapse); chat ⋯ holds the moved actions; quick-reply detection (positive and negative cases) and that a click sends the option text; run menu shows three ways and Configurações holds the moved settings; i18n keys in every block.
- Screenshots of the built screens (desktop 1440×900 and phone 390×844, light and dark) compared against the D pictures.
