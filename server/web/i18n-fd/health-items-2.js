// Health item texts, part 2 (fd08): hygiene, product, management and extras (43 items). Each item has three texts per
// language: what it is, why it matters, what to do. Merged into the dictionaries by the block integration (B4-T24).
// Nothing here is legal text: the items about privacy and terms only send the owner to proper guidance.
const ITEMS = {
  'hygiene.ci': [
    ['An automatic check runs on every change (continuous integration).', 'Without it, a broken change can reach the project and nobody notices until something fails.', 'Set up an automatic check that installs the project and runs its tests every time a change is sent to the online copy.'],
    ['Uma verificação automática roda a cada mudança (integração contínua).', 'Sem ela, uma mudança quebrada entra no projeto e ninguém percebe até algo falhar.', 'Configure uma verificação automática que instala o projeto e roda os testes toda vez que uma mudança é enviada para a cópia online.'],
  ],
  'hygiene.tests': [
    ['The project has automated tests and a way to run them.', 'Tests are the safety net: they tell you right away when a change breaks something that worked.', 'Add a test folder and a "test" command, then write a first test for the most important behavior.'],
    ['O projeto tem testes automáticos e um jeito de rodá-los.', 'Os testes são a rede de proteção: avisam na hora quando uma mudança quebra algo que funcionava.', 'Crie uma pasta de testes e um comando "test", e escreva um primeiro teste para o comportamento mais importante.'],
  ],
  'hygiene.lint': [
    ['A linter reads the code and points out likely mistakes and style problems.', 'It catches small errors before they become bugs and keeps the code readable for everyone.', 'Set up the linter of your language (ESLint, Biome, ruff, phpcs or the Dart analyzer) and add a "lint" command.'],
    ['Um verificador de código lê os arquivos e aponta erros prováveis e problemas de estilo.', 'Ele pega erros pequenos antes de virarem defeitos e mantém o código legível para todos.', 'Configure o verificador da sua linguagem (ESLint, Biome, ruff, phpcs ou o analisador do Dart) e crie um comando "lint".'],
  ],
  'hygiene.formatter': [
    ['A formatter rewrites the code in one single style.', 'Everyone writes the same way, so changes show only what really changed and not spacing.', 'Set up a formatter (Prettier, Biome, dart format or pint) and add a command to run it.'],
    ['Um formatador reescreve o código em um único estilo.', 'Todos escrevem do mesmo jeito, e as mudanças mostram só o que mudou de verdade, sem brigas de espaçamento.', 'Configure um formatador (Prettier, Biome, dart format ou pint) e crie um comando para rodá-lo.'],
  ],
  'hygiene.typecheck': [
    ['A type check proves that values are used the way the code declared.', 'It finds whole families of mistakes without running the program.', 'Turn on strict mode in tsconfig, or run the analyzer of your language (PHP or Dart) as a command.'],
    ['A checagem de tipos confere se os valores são usados como o código declarou.', 'Ela acha famílias inteiras de erros sem precisar rodar o programa.', 'Ligue o modo estrito no tsconfig, ou rode o analisador da sua linguagem (PHP ou Dart) como um comando.'],
  ],
  'hygiene.build': [
    ['There is one command that builds the project from the sources.', 'If the build is not repeatable, nobody can be sure that what runs is what was written.', 'Add a "build" command and run it in the automatic check too.'],
    ['Existe um comando que monta o projeto a partir dos arquivos de origem.', 'Se a montagem não se repete igual, ninguém garante que o que roda é o que foi escrito.', 'Crie um comando "build" e rode-o também na verificação automática.'],
  ],
  'hygiene.coverage': [
    ['Test coverage measures how much of the code the tests actually run.', 'It shows the parts that nobody tests, where bugs hide longest.', 'Turn on coverage in your test tool (c8, nyc or the coverage option of vitest) and look at the report now and then.'],
    ['A cobertura de testes mede quanto do código os testes realmente executam.', 'Ela mostra as partes que ninguém testa, onde os defeitos ficam escondidos por mais tempo.', 'Ligue a cobertura na sua ferramenta de testes (c8, nyc ou a opção de cobertura do vitest) e olhe o relatório de vez em quando.'],
  ],
  'hygiene.hooks': [
    ['Automatic steps run quick checks just before a change is saved.', 'Mistakes are stopped on your own computer, before they reach the shared project.', 'Add a tool for automatic steps (such as husky or lefthook) that runs the checker and the formatter when a change is saved.'],
    ['Passos automáticos rodam verificações rápidas logo antes de uma mudança ser salva.', 'Os erros são barrados no seu computador, antes de chegarem ao projeto compartilhado.', 'Adicione uma ferramenta de passos automáticos (como husky ou lefthook) que rode o verificador e o formatador quando uma mudança for salva.'],
  ],
  'hygiene.commitlint': [
    ['A rule checks that change messages follow a standard format.', 'Clear messages make the history readable and let the next version number be worked out automatically.', 'Add a check for the messages of saved changes (the commitlint tool) with the conventional format.'],
    ['Uma regra confere se as mensagens de mudança seguem um formato padrão.', 'Mensagens claras deixam o histórico legível e permitem calcular o próximo número de versão automaticamente.', 'Adicione uma verificação das mensagens das mudanças salvas (a ferramenta commitlint) com o formato convencional.'],
  ],
  'hygiene.editorconfig': [
    ['An .editorconfig file tells every editor the same basic settings.', 'Indentation and line endings stay equal no matter who edits or which editor they use.', 'Create a draft .editorconfig with "root = true" and the indentation your project already uses.'],
    ['Um arquivo .editorconfig passa as mesmas configurações básicas para todo editor.', 'A indentação e o fim de linha ficam iguais, não importa quem edita nem qual editor usa.', 'Crie um rascunho de .editorconfig com "root = true" e a indentação que o projeto já usa.'],
  ],
  'hygiene.gitignore': [
    ['The ignore list names what the version history must never save: generated files, packages, secrets.', 'Without it, heavy or private files end up in the history, and removing them later is hard.', 'Create a draft .gitignore with the usual patterns for your stack, and add your own local files to it.'],
    ['A lista de ignorados diz o que o histórico de versões nunca deve guardar: arquivos gerados, pacotes, segredos.', 'Sem ele, arquivos pesados ou privados entram no histórico, e tirá-los depois é difícil.', 'Crie um rascunho de .gitignore com os padrões usuais da sua pilha e acrescente seus arquivos locais.'],
  ],
  'hygiene.gitattributes': [
    ['A file sets how the version history treats line endings and file types.', 'It avoids files that look fully changed only because a different system saved them.', 'Add a .gitattributes with "* text=auto" and the exceptions for binary files.'],
    ['Um arquivo define como o histórico de versões trata fim de linha e tipos de arquivo.', 'Evita arquivos que parecem totalmente alterados só porque outro sistema os salvou.', 'Adicione um .gitattributes com "* text=auto" e as exceções para arquivos binários.'],
  ],
  'hygiene.env_example': [
    ['An example file (.env.example) lists the settings the program reads, with no real values.', 'A new person can start the project without guessing, and real secrets stay out of the project.', 'Create a draft .env.example with the names the code reads and an empty or fake value for each.'],
    ['Um arquivo de exemplo (.env.example) lista as configurações que o programa lê, sem valores reais.', 'Uma pessoa nova consegue iniciar o projeto sem adivinhar, e os segredos de verdade ficam fora do projeto.', 'Crie um rascunho de .env.example com os nomes que o código lê e um valor vazio ou falso para cada um.'],
  ],
  'hygiene.config_doc': [
    ['The settings listed in the example file are explained in a document.', 'A name alone does not say what it does, what values are accepted or whether it is required.', 'Add to the project’s front page or to a docs page a table with each setting name, what it does and an example.'],
    ['As configurações do arquivo de exemplo estão explicadas em um documento.', 'O nome sozinho não diz o que a configuração faz, quais valores aceita nem se é obrigatória.', 'Coloque na página de apresentação do projeto ou numa página de docs uma tabela com o nome de cada configuração, o que ela faz e um exemplo.'],
  ],
  'hygiene.lockfile': [
    ['A lock file records the exact version of every package in use.', 'Without it, two installs on different days can bring different versions and different bugs.', 'Run the install of your package manager and save the lock file it creates (such as package-lock, pnpm-lock or composer.lock).'],
    ['Um arquivo de travas guarda a versão exata de cada pacote em uso.', 'Sem ele, duas instalações em dias diferentes podem trazer versões e defeitos diferentes.', 'Rode a instalação do seu gerenciador de pacotes e guarde o arquivo de travas que ele cria (como package-lock, pnpm-lock ou composer.lock).'],
  ],
  'hygiene.runtime_pin': [
    ['The project states which version of the runtime (Node, PHP, Dart) it needs.', 'A different version on another machine can break things that work on yours.', 'Add a .nvmrc or .node-version file, or the "engines" field, with the version you really use.'],
    ['O projeto declara qual versão do ambiente de execução (Node, PHP, Dart) ele exige.', 'Uma versão diferente em outra máquina pode quebrar o que funciona na sua.', 'Adicione um arquivo .nvmrc ou .node-version, ou o campo "engines", com a versão que você realmente usa.'],
  ],
  'hygiene.devcontainer': [
    ['A dev container describes a ready-made work environment.', 'Anyone can open the project and start working with the same tools, with no setup by hand.', 'Add a file that describes a ready-made working environment, with the image and the tools the project needs. This one is optional.'],
    ['Um contêiner de desenvolvimento descreve um ambiente de trabalho já pronto.', 'Qualquer pessoa abre o projeto e começa a trabalhar com as mesmas ferramentas, sem montar nada à mão.', 'Adicione um arquivo que descreva um ambiente de trabalho pronto, com a imagem e as ferramentas do projeto. Este item é opcional.'],
  ],
  'hygiene.license_check': [
    ['A tool or table checks the licenses of the packages the project depends on.', 'A package with an incompatible license can create legal trouble for your project.', 'Run a license checker (license-checker, licensee) and keep the result, or keep a table of the licenses in use.'],
    ['Uma ferramenta ou tabela confere as licenças dos pacotes dos quais o projeto depende.', 'Um pacote com licença incompatível pode criar problemas legais para o seu projeto.', 'Rode um verificador de licenças (license-checker, licensee) e guarde o resultado, ou mantenha uma tabela das licenças em uso.'],
  ],
  'product.privacy': [
    ['A privacy notice tells users which personal data you collect and why.', 'Laws such as LGPD and GDPR require it, and users trust a product that is open about their data.', 'Do not copy a template: look for professional guidance (a lawyer or a privacy specialist) and publish the text they approve.'],
    ['Um aviso de privacidade diz aos usuários quais dados pessoais você coleta e por quê.', 'Leis como a LGPD e a GDPR exigem isso, e o usuário confia mais num produto transparente com seus dados.', 'Não copie um modelo: procure orientação profissional (advogado ou especialista em privacidade) e publique o texto que ele aprovar.'],
  ],
  'product.terms': [
    ['The terms of use set the rules between you and the people who use the product.', 'They define what is allowed, what you are responsible for and what happens when something goes wrong.', 'Do not copy a template: look for professional guidance (a lawyer) and publish the text they approve.'],
    ['Os termos de uso definem as regras entre você e quem usa o produto.', 'Eles dizem o que é permitido, pelo que você responde e o que acontece quando algo dá errado.', 'Não copie um modelo: procure orientação profissional (advogado) e publique o texto que ele aprovar.'],
  ],
  'product.accessibility': [
    ['The product states and tests its accessibility (use by people with disabilities).', 'Many people cannot use a screen that was never checked, and the law requires it in many places.', 'Add an ACCESSIBILITY file, or mention on the project’s front page the standard you follow (WCAG) and the tools you test with.'],
    ['O produto declara e testa sua acessibilidade (uso por pessoas com deficiência).', 'Muita gente não consegue usar uma tela que nunca foi conferida, e a lei exige isso em muitos lugares.', 'Crie um arquivo ACCESSIBILITY, ou cite na página de apresentação do projeto o padrão que você segue (WCAG) e as ferramentas com que testa.'],
  ],
  'product.i18n': [
    ['The product can show its texts in more than one language.', 'It opens the product to more people and keeps texts out of the code, where they are hard to change.', 'Move the screen texts to translation files (a locales or i18n folder) and add the languages you need.'],
    ['O produto consegue mostrar seus textos em mais de um idioma.', 'Isso abre o produto para mais gente e tira os textos de dentro do código, onde são difíceis de mudar.', 'Mova os textos das telas para arquivos de tradução (uma pasta locales ou i18n) e acrescente os idiomas de que precisa.'],
  ],
  'product.observability': [
    ['The product records logs, metrics or errors while it runs.', 'Without it, you only learn about a failure when a user complains, and you cannot find the cause.', 'Add a logger and an error report tool (pino, winston, Sentry, OpenTelemetry), taking care not to log personal data.'],
    ['O produto registra logs, métricas ou erros enquanto funciona.', 'Sem isso, você só descobre uma falha quando um usuário reclama, e não consegue achar a causa.', 'Adicione um registrador de logs e uma ferramenta de relatório de erros (pino, winston, Sentry, OpenTelemetry), sem gravar dados pessoais.'],
  ],
  'product.incident_response': [
    ['There is a written plan for what to do when something serious breaks.', 'In a crisis nobody thinks clearly, and a plan already written saves time and avoids panic.', 'Write a short document (INCIDENT.md or runbooks/incident.md) with who to call, how to stop the damage and how to tell users.'],
    ['Existe um plano escrito para quando algo grave quebra.', 'Em uma crise ninguém pensa com clareza, e um plano já escrito poupa tempo e evita pânico.', 'Escreva um documento curto (INCIDENT.md ou runbooks/incident.md) com quem chamar, como conter o estrago e como avisar os usuários.'],
  ],
  'product.backup': [
    ['The way to back up and restore the data is documented.', 'A backup nobody ever restored is only a hope: it may fail exactly when you need it.', 'Document where the backup is kept, how often it runs and how to restore it, then test the restore once and note the date.'],
    ['Está documentado como fazer cópia de segurança e como restaurar os dados.', 'Uma cópia que ninguém nunca restaurou é só uma esperança: pode falhar justo quando você precisar.', 'Documente onde a cópia fica, com que frequência roda e como restaurar, teste a restauração uma vez e anote a data.'],
  ],
  'product.status_page': [
    ['Users can see whether the product is working, on a status page.', 'It answers "is it down?" without a flood of messages, and builds trust.', 'Publish a status page, or a STATUS file, and link it on the project’s front page.'],
    ['Os usuários conseguem ver se o produto está funcionando, numa página de status.', 'Ela responde "caiu?" sem uma enxurrada de mensagens, e cria confiança.', 'Publique uma página de status, ou um arquivo STATUS, e coloque o link na página de apresentação do projeto.'],
  ],
  'product.support_channel': [
    ['Users know where to ask for help.', 'Without a channel, questions and complaints end up in the wrong place or are never sent.', 'Add a SUPPORT file, or list a contact (e-mail or forum) on the project’s front page.'],
    ['Os usuários sabem onde pedir ajuda.', 'Sem um canal, dúvidas e reclamações vão parar no lugar errado ou nunca são enviadas.', 'Crie um arquivo SUPPORT, ou liste um contato (e-mail ou fórum) na página de apresentação do projeto.'],
  ],
  'management.labels': [
    ['The project online has labels such as "bug" and "good first issue".', 'Labels sort the work, and the "good first issue" one helps newcomers find where to start.', 'On the project’s page online, create at least the labels "bug" and "good first issue".'],
    ['O projeto online tem etiquetas como "bug" e "good first issue".', 'As etiquetas organizam o trabalho, e a "good first issue" ajuda quem chega a achar por onde começar.', 'Na página do projeto online, crie pelo menos as etiquetas "bug" e "good first issue".'],
  ],
  'management.milestones': [
    ['The project online has milestones: goals that group issues toward a delivery.', 'They show what is planned for the next version and how far along it is.', 'Create a milestone for the next version and attach the open issues to it.'],
    ['O projeto online tem marcos: metas que agrupam tarefas rumo a uma entrega.', 'Eles mostram o que está planejado para a próxima versão e quanto já andou.', 'Crie um marco para a próxima versão e ligue a ele as tarefas abertas.'],
  ],
  'management.projects': [
    ['The project online has a board that organizes the work.', 'A board shows at a glance what is waiting, in progress and done.', 'Create a board on the site where the project lives online and add your open issues to it.'],
    ['O projeto online tem um quadro que organiza o trabalho.', 'O quadro mostra de relance o que está esperando, em andamento e pronto.', 'Crie um quadro no site onde o projeto fica online e coloque nele as tarefas abertas.'],
  ],
  'management.triage': [
    ['A document explains how new issues are sorted and answered.', 'Contributors know what to expect, and nothing stays forgotten at the bottom of the list.', 'Describe in SUPPORT, CONTRIBUTING or GOVERNANCE how triage works and how long it takes.'],
    ['Um documento explica como as novas tarefas são separadas e respondidas.', 'Quem colabora sabe o que esperar, e nada fica esquecido no fim da lista.', 'Descreva no SUPPORT, no CONTRIBUTING ou no GOVERNANCE como funciona a triagem e quanto tempo leva.'],
  ],
  'management.response_time': [
    ['A document states how fast you answer questions and reports.', 'People wait with less worry when they know the usual time, mainly for security reports.', 'Write the target time in SECURITY or SUPPORT, for example "we answer within 5 days".'],
    ['Um documento diz em quanto tempo você responde dúvidas e relatos.', 'As pessoas esperam com menos aflição quando conhecem o prazo usual, principalmente em relatos de segurança.', 'Escreva o prazo no SECURITY ou no SUPPORT, por exemplo "respondemos em até 5 dias".'],
  ],
  'management.maintainers': [
    ['A file names the people who take care of the project.', 'It says who decides and who to ask, and keeps the project from depending on a single unnamed person.', 'Add a MAINTAINERS file or fill CODEOWNERS with the owners. Having two people is even better.'],
    ['Um arquivo nomeia as pessoas que cuidam do projeto.', 'Ele diz quem decide e a quem perguntar, e evita que o projeto dependa de uma única pessoa sem nome.', 'Crie um arquivo MAINTAINERS ou preencha o CODEOWNERS com os responsáveis. Ter duas pessoas é ainda melhor.'],
  ],
  'management.stale_policy': [
    ['There is a rule for closing issues that stay inactive for a long time.', 'Old abandoned issues hide the ones that matter and make the project look neglected.', 'Add the "stale" automatic action, or write in a document when an inactive issue is closed.'],
    ['Existe uma regra para fechar tarefas paradas por muito tempo.', 'Tarefas antigas e abandonadas escondem as que importam e dão ao projeto cara de largado.', 'Adicione a ação "stale" num fluxo automático, ou escreva num documento quando uma tarefa parada é fechada.'],
  ],
  'extras.agents_md': [
    ['A file written for AI coding helpers explains the project to them.', 'Assistants that read it follow your commands and rules instead of guessing.', 'In the main folder of the project, create a file for AI helpers with how to build, how to test and the rules of the project.'],
    ['Um arquivo escrito para ajudantes de código com IA explica o projeto a eles.', 'Os assistentes que o leem seguem seus comandos e regras em vez de adivinhar.', 'Na pasta principal do projeto, crie um arquivo para ajudantes de IA com como montar, como testar e as regras do projeto.'],
  ],
  'extras.claude_md': [
    ['A CLAUDE.md file gives Claude Code the instructions of the project.', 'Claude starts every session already knowing your commands, your style and what not to touch.', 'Create CLAUDE.md at the root with the commands, the structure and the rules you want followed.'],
    ['Um arquivo CLAUDE.md dá ao Claude Code as instruções do projeto.', 'O Claude começa cada sessão já sabendo seus comandos, seu estilo e o que não deve mexer.', 'Crie o CLAUDE.md na raiz com os comandos, a estrutura e as regras que você quer ver seguidas.'],
  ],
  'extras.ai_policy': [
    ['The contribution guide says how AI-written code is accepted.', 'It sets clear expectations about review, honesty and who answers for the change.', 'Add a section about AI to CONTRIBUTING: what is allowed and that the author must review and understand the code.'],
    ['O guia de contribuição diz como código escrito por IA é aceito.', 'Ele deixa claro o que se espera de revisão, de honestidade e de quem responde pela mudança.', 'Acrescente ao CONTRIBUTING uma seção sobre IA: o que é permitido e que o autor deve revisar e entender o código.'],
  ],
  'extras.llms_txt': [
    ['An llms.txt file gives AI tools a short guide to your site.', 'AI search and assistants can understand what the product is without reading every page.', 'Create llms.txt at the root (or in public/) with a short description and links to the main pages.'],
    ['Um arquivo llms.txt dá às ferramentas de IA um guia curto do seu site.', 'Buscadores e assistentes de IA entendem o que é o produto sem ler cada página.', 'Crie o llms.txt na raiz (ou em public/) com uma descrição curta e links para as páginas principais.'],
  ],
  'extras.repo_meta': [
    ['The project’s page online has a description, topics and a home page link.', 'It is the first thing people see, and topics help them find the project.', 'On the project’s page online, fill in the description, add at least one topic and the home page address.'],
    ['A página do projeto online tem descrição, tópicos e o link da página inicial.', 'É a primeira coisa que as pessoas veem, e os tópicos ajudam a achar o projeto.', 'Na página do projeto online, preencha a descrição, acrescente pelo menos um tópico e o endereço da página inicial.'],
  ],
  'extras.social_image': [
    ['The project online has a social preview image.', 'It is the picture shown when the link is shared in chats and social networks.', 'In the settings of the project online, upload an image of about 1280 by 640 pixels. The program cannot check this one by itself.'],
    ['O projeto online tem uma imagem de pré-visualização social.', 'É a figura mostrada quando o link é compartilhado em conversas e redes sociais.', 'Nas configurações do projeto online, envie uma imagem de cerca de 1280 por 640 pixels. O programa não consegue conferir este item sozinho.'],
  ],
  'extras.badges': [
    ['The project’s front page shows badges: small seals with the status of tests, version or license.', 'They tell a visitor in one glance that the project is alive and cared for.', 'Add at least two badges (for example from shields.io) to the top of the project’s front page.'],
    ['A página de apresentação do projeto mostra selos: pequenas etiquetas com o estado dos testes, a versão ou a licença.', 'Eles dizem ao visitante, num relance, que o projeto está vivo e bem cuidado.', 'Coloque pelo menos dois selos (por exemplo do shields.io) no topo da página de apresentação do projeto.'],
  ],
  'extras.openssf_badge': [
    ['The project has earned the OpenSSF best practices badge.', 'It is an outside seal that the project follows recognized security practices.', 'Fill in the free OpenSSF best practices questionnaire for the project and show the badge.'],
    ['O projeto conquistou o selo de boas práticas da OpenSSF.', 'É um selo de fora que atesta que o projeto segue práticas de segurança reconhecidas.', 'Responda o questionário gratuito de boas práticas da OpenSSF para o projeto e mostre o selo.'],
  ],
  'extras.spdx_headers': [
    ['Source files carry a short license line (SPDX) at the top.', 'The license travels with each file when someone copies it alone.', 'Add a line like "SPDX-License-Identifier: MIT" to the first lines of at least 80% of the code files.'],
    ['Os arquivos de código trazem uma linha curta de licença (SPDX) no topo.', 'A licença acompanha cada arquivo quando alguém o copia sozinho.', 'Acrescente uma linha como "SPDX-License-Identifier: MIT" nas primeiras linhas de pelo menos 80% dos arquivos de código.'],
  ],
};

const en = {};
const ptBR = {};
for (const [id, [e, p]] of Object.entries(ITEMS)) {
  ['what', 'why', 'todo'].forEach((part, i) => {
    en[`health.item.${id}.${part}`] = e[i];
    ptBR[`health.item.${id}.${part}`] = p[i];
  });
}

// Technical originals of the texts above that were put in plain words (shown with "Technical details").
const TECH = {
  en: {
    'health.item.extras.agents_md.what': 'An AGENTS.md file explains the project to AI coding assistants.',
    'health.item.extras.agents_md.todo': 'Create AGENTS.md at the root with how to build, how to test and the rules of the project.',
    'health.item.extras.badges.what': 'The README shows badges: small seals with the status of tests, version or license.',
    'health.item.extras.badges.todo': 'Add at least two badges (for example shields.io) to the top of the README.',
    'health.item.extras.repo_meta.what': 'The repository page has a description, topics and a home page link.',
    'health.item.extras.repo_meta.todo': 'On the repository page, fill the description, add at least one topic and the home page address.',
    'health.item.extras.social_image.what': 'The repository has a social preview image.',
    'health.item.extras.social_image.todo': 'In the repository settings, upload an image of about 1280 by 640 pixels. The program cannot check this one by itself.',
    'health.item.hygiene.ci.todo': 'Add a workflow file (for example in .github/workflows) that installs the project and runs its tests on every push.',
    'health.item.hygiene.commitlint.todo': 'Add a commitlint configuration (commitlint.config.js) with the conventional format.',
    'health.item.hygiene.config_doc.todo': 'Add to the README or to a docs page a table with each setting name, what it does and an example.',
    'health.item.hygiene.devcontainer.todo': 'Add .devcontainer/devcontainer.json with the image and the tools the project needs. This one is optional.',
    'health.item.hygiene.env_example.why': 'A new person can start the project without guessing, and real secrets stay out of the repository.',
    'health.item.hygiene.gitattributes.what': 'A .gitattributes file sets how git treats line endings and file types.',
    'health.item.hygiene.gitignore.what': 'The .gitignore file lists what git must never save: generated files, packages, secrets.',
    'health.item.hygiene.hooks.what': 'Git hooks run quick checks before a change is saved.',
    'health.item.hygiene.hooks.todo': 'Add a hook tool (husky, lefthook, pre-commit or lint-staged) that runs the linter and the formatter on commit.',
    'health.item.hygiene.lockfile.todo': 'Run the install of your package manager and save the lock file it creates (package-lock.json, pnpm-lock.yaml, composer.lock...).',
    'health.item.management.labels.what': 'The repository has labels such as "bug" and "good first issue".',
    'health.item.management.labels.todo': 'On the repository page, create at least the labels "bug" and "good first issue".',
    'health.item.management.milestones.what': 'The repository has milestones: goals that group issues toward a delivery.',
    'health.item.management.projects.what': 'The repository has a project board that organizes the work.',
    'health.item.management.projects.todo': 'Create a project on the repository host and add your open issues to it.',
    'health.item.management.stale_policy.todo': 'Add the "stale" workflow action, or write in a document when an inactive issue is closed.',
    'health.item.product.accessibility.todo': 'Add an ACCESSIBILITY.md, or mention in the README the standard you follow (WCAG) and the tools you test with.',
    'health.item.product.status_page.todo': 'Publish a status page, or a STATUS file, and link it in the README.',
    'health.item.product.support_channel.todo': 'Add a SUPPORT.md, or list a contact (e-mail or forum) in the README.',
  },
  'pt-BR': {
    'health.item.extras.agents_md.what': 'Um arquivo AGENTS.md explica o projeto para assistentes de código com IA.',
    'health.item.extras.agents_md.todo': 'Crie o AGENTS.md na raiz com como montar, como testar e as regras do projeto.',
    'health.item.extras.badges.what': 'O README mostra selos: pequenas etiquetas com o estado dos testes, a versão ou a licença.',
    'health.item.extras.badges.todo': 'Coloque pelo menos dois selos (por exemplo do shields.io) no topo do README.',
    'health.item.extras.repo_meta.what': 'A página do repositório tem descrição, tópicos e o link da página inicial.',
    'health.item.extras.repo_meta.todo': 'Na página do repositório, preencha a descrição, acrescente pelo menos um tópico e o endereço da página inicial.',
    'health.item.extras.social_image.what': 'O repositório tem uma imagem de pré-visualização social.',
    'health.item.extras.social_image.todo': 'Nas configurações do repositório, envie uma imagem de cerca de 1280 por 640 pixels. O programa não consegue conferir este item sozinho.',
    'health.item.hygiene.ci.todo': 'Crie um arquivo de fluxo (por exemplo em .github/workflows) que instala o projeto e roda os testes a cada envio.',
    'health.item.hygiene.commitlint.todo': 'Adicione uma configuração do commitlint (commitlint.config.js) com o formato convencional.',
    'health.item.hygiene.config_doc.todo': 'Coloque no README ou numa página de docs uma tabela com o nome de cada configuração, o que ela faz e um exemplo.',
    'health.item.hygiene.devcontainer.todo': 'Adicione .devcontainer/devcontainer.json com a imagem e as ferramentas do projeto. Este item é opcional.',
    'health.item.hygiene.env_example.why': 'Uma pessoa nova consegue iniciar o projeto sem adivinhar, e os segredos de verdade ficam fora do repositório.',
    'health.item.hygiene.gitattributes.what': 'Um arquivo .gitattributes define como o git trata fim de linha e tipos de arquivo.',
    'health.item.hygiene.gitignore.what': 'O arquivo .gitignore lista o que o git nunca deve guardar: arquivos gerados, pacotes, segredos.',
    'health.item.hygiene.hooks.what': 'Ganchos do git rodam verificações rápidas antes de uma mudança ser gravada.',
    'health.item.hygiene.hooks.todo': 'Adicione uma ferramenta de ganchos (husky, lefthook, pre-commit ou lint-staged) que rode o verificador e o formatador no commit.',
    'health.item.hygiene.lockfile.todo': 'Rode a instalação do seu gerenciador de pacotes e guarde o arquivo de travas que ele cria (package-lock.json, pnpm-lock.yaml, composer.lock...).',
    'health.item.management.labels.what': 'O repositório tem etiquetas como "bug" e "good first issue".',
    'health.item.management.labels.todo': 'Na página do repositório, crie pelo menos as etiquetas "bug" e "good first issue".',
    'health.item.management.milestones.what': 'O repositório tem marcos: metas que agrupam tarefas rumo a uma entrega.',
    'health.item.management.projects.what': 'O repositório tem um quadro de projeto que organiza o trabalho.',
    'health.item.management.projects.todo': 'Crie um projeto no site do repositório e coloque nele as tarefas abertas.',
    'health.item.management.stale_policy.todo': 'Adicione a ação "stale" num workflow, ou escreva num documento quando uma tarefa parada é fechada.',
    'health.item.product.accessibility.todo': 'Crie um ACCESSIBILITY.md, ou cite no README o padrão que você segue (WCAG) e as ferramentas com que testa.',
    'health.item.product.status_page.todo': 'Publique uma página de status, ou um arquivo STATUS, e coloque o link no README.',
    'health.item.product.support_channel.todo': 'Crie um SUPPORT.md, ou liste um contato (e-mail ou fórum) no README.',
  },
};

export default { en, 'pt-BR': ptBR, tech: TECH };
