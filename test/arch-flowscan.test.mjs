import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFile, scanHooks, scanManifest, scanPackageJson } from '../server/arch/flowscan.mjs';

const js = (text, path = 'server/x.mjs') => scanFile({ path, type: 'js', text });
const of = (scan, type) => scan.signals.filter((s) => s.type === type);

test('a literal command run by execFile is a command signal; a comment or a variable is not', () => {
  const text = "import { execFile } from 'node:child_process';\n\nexecFile('git', ['status'], () => {});\n// execFile('gh', [])\nspawn(bin, []);\n";
  const cmds = of(js(text), 'command');
  assert.deepEqual(cmds.map((s) => [s.value, s.line]), [['git', 3]]);
});

test('a command line run through a shell (exec, execSync, a template) counts by its first word', () => {
  const text = [
    "import cp, { exec, execSync } from 'node:child_process';",
    "const sha = execSync('git rev-parse HEAD');",
    "exec('gh pr list', cb);",
    'cp.execSync(`git log -1 ${x}`);',
    "execFile('C:/Program Files/Git/bin/git.exe', ['status']);",
    'execSync(`${bin} status`);',
    'execSync(`gh${x} list`);',
    "execSync('lsof -i :3000');",
  ].join('\n');
  const cmds = of(js(text), 'command').map((s) => [s.value, s.line]);
  assert.deepEqual(cmds, [['git', 2], ['gh', 3], ['git', 4], ['git', 5]]);
});

test('a local alias of execFile and a launcher handed to a helper both count', () => {
  const text = [
    "import { execFile, spawn } from 'node:child_process';",
    "import { promisify } from 'node:util';",
    'const run = promisify(execFile);',
    "await run('git', ['ls-files']);",
    'function newTerminal(cwd, { spawner = spawn } = {}) {',
    "  return detach(spawner, 'powershell.exe', [], cwd);",
    '}',
  ].join('\n');
  const cmds = of(js(text), 'command').map((s) => [s.value, s.line]);
  assert.deepEqual(cmds, [['git', 4], ['powershell', 6]]);
});

test('an argv list and a {file, args} command are commands; a word compared in code is not', () => {
  const text = [
    "newTerminal(cwd, ['claude', '--resume', id]);",
    "if (who === 'claude') x();",
    "const cmd = { file: 'osascript', args: ['-e', SCRIPT] };",
    "const exe = win ? 'claude.exe' : 'claude';",
  ].join('\n');
  const cmds = of(js(text), 'command').map((s) => [s.value, s.line]);
  assert.deepEqual(cmds, [['claude', 1], ['osascript', 3], ['claude', 4]]);
});

test('what the file is about travels with its commands: toast or terminal', () => {
  const toast = js("export function toastCommand() { return { file: 'powershell.exe', args: ['-c', 'x'] }; }");
  assert.deepEqual(of(toast, 'command')[0].tags, ['toast']);
  const term = js("export function newTerminal(spawner) { return detach(spawner, 'powershell.exe', []); }");
  assert.deepEqual(of(term, 'command')[0].tags, ['terminal']);
});

test('hosts: a catalog API kept in a constant counts when the constant is used; any other host only at a call', () => {
  const text = [
    "const API = 'https://api.github.com';",
    'export const search = () => fetch(`${API}/search`);',
    "const NS = 'http://www.w3.org/2000/svg';",
    "const LOCAL = 'http://127.0.0.1:4001';",
    "const unused = 'https://api.openai.com';",
    "const link = 'https://claude.ai/code/x';",
    "await fetch('https://api.example.com/v1/x');",
    "await fetch('http://localhost/x');",
  ].join('\n');
  const hosts = of(js(text), 'host').map((s) => [s.value, s.line]);
  assert.deepEqual(hosts, [['api.github.com', 1], ['api.example.com', 7]]);
});

test('a vscode:// link and the ~/.claude folder are literal signals; session-map\'s own storage keeps its next name', () => {
  const text = [
    "import { homedir } from 'node:os';",
    'const url = `vscode://file/${p}`;',
    "const dir = join(homedir(), '.claude');",
    "const mine = join(homedir(), '.claude', 'session-map');",
    "const project = join(root, '.claude', 'settings.json');",
  ].join('\n');
  const lits = of(js(text), 'literal').map((s) => [s.value, s.line, s.next ?? null]);
  assert.deepEqual(lits, [['vscode-url', 2, null], ['claude-home', 3, null], ['claude-home', 4, 'session-map']]);
});

test('imports keep their names and lines; type-only imports are skipped; default and namespace imports work', () => {
  const text = [
    "import { a, b as c } from './x.mjs';",
    "import type { T } from './t';",
    "import def from './d.mjs';",
    "import * as ns from './n.mjs';",
    "const r = require('./r.cjs');",
  ].join('\n');
  const { imports } = scanFile({ path: 'src/m.ts', type: 'ts', text });
  assert.deepEqual(imports, [
    { spec: './x.mjs', line: 1, names: ['a', 'b'] },
    { spec: './d.mjs', line: 3, names: ['default'] },
    { spec: './n.mjs', line: 4, names: ['*'] },
    { spec: './r.cjs', line: 5, names: [] },
  ]);
});

test('listen, a page literal and 0.0.0.0 are signals', () => {
  const text = "const rel = path === '/' ? 'index.html' : path;\nconst host = lan ? '0.0.0.0' : '127.0.0.1';\napp.listen(port, host);\n";
  const s = js(text);
  assert.deepEqual(of(s, 'html').map((x) => x.line), [1]);
  assert.deepEqual(of(s, 'bind-all').map((x) => x.line), [2]);
  assert.deepEqual(of(s, 'listen').map((x) => x.line), [3]);
});

test('sdk imports, env reads and Next.js screens come from the js extractor', () => {
  const s = scanFile({ path: 'apps/admin/pages/dashboard.tsx', type: 'tsx', text: "import Stripe from 'stripe';\nconst k = process.env.STRIPE_KEY;\nexport default function Dashboard() { return null; }\n", workspace: { dir: 'apps/admin', name: 'admin', deps: ['next', 'stripe'] } });
  assert.deepEqual(of(s, 'sdk').map((x) => [x.value, x.line]), [['stripe', 1]]);
  assert.deepEqual(of(s, 'env').map((x) => [x.value, x.line]), [['STRIPE_KEY', 2]]);
  assert.deepEqual(of(s, 'screen').map((x) => [x.app, x.route, x.line]), [['admin', '/dashboard', 3]]);
});

test('package.json: bin in both forms with its line, the package name and its dependencies', () => {
  const obj = scanPackageJson('{\n  "name": "session-map",\n  "bin": {\n    "session-map": "server/cli.mjs"\n  },\n  "dependencies": { "stripe": "^1" }\n}\n');
  assert.equal(obj.name, 'session-map');
  assert.deepEqual(obj.bin, [{ file: 'server/cli.mjs', line: 4 }]);
  assert.deepEqual(obj.deps, [{ name: 'stripe', line: 6 }]);
  const str = scanPackageJson('{\n  "name": "x",\n  "bin": "./cli.js"\n}');
  assert.deepEqual(str.bin, [{ file: 'cli.js', line: 3 }]);
});

test('hooks.json: the script a hook runs, inside the plugin root', () => {
  const text = '{\n  "hooks": {\n    "SessionEnd": [\n      {\n        "hooks": [\n          { "type": "command", "command": "node \\"${CLAUDE_PLUGIN_ROOT}/scripts/archive-hook.mjs\\"" }\n        ]\n      }\n    ]\n  }\n}\n';
  assert.deepEqual(scanHooks(text), [{ file: 'scripts/archive-hook.mjs', line: 6 }]);
});

test('pubspec and composer dependencies are read as names with their lines', () => {
  const pub = scanManifest('apps/customer/pubspec.yaml', 'name: customer\ndependencies:\n  flutter:\n    sdk: flutter\n  firebase_core: ^2.0.0\ndev_dependencies:\n  test: any\n');
  assert.deepEqual(pub.deps, [{ name: 'flutter', line: 3 }, { name: 'firebase_core', line: 5 }]);
  const comp = scanManifest('backend/composer.json', '{\n  "require": {\n    "php": "^8.2",\n    "aws/aws-sdk-php": "^3"\n  }\n}');
  assert.deepEqual(comp.deps, [{ name: 'php', line: 3 }, { name: 'aws/aws-sdk-php', line: 4 }]);
});

test('broken JSON gives nothing and does not throw', () => {
  assert.deepEqual(scanPackageJson('{ nope'), { name: null, bin: [], deps: [] });
  assert.deepEqual(scanHooks('{ nope'), []);
  assert.deepEqual(scanManifest('composer.json', '{ nope').deps, []);
});

test('a comparison with "vscode://" is not a link, and the flags only the Claude CLI takes show it is run', () => {
  const s = js("if (v.startsWith('vscode://')) x();\nconst args = ['-p', '--output-format', 'stream-json', '--permission-prompt-tool', tool];\n");
  assert.deepEqual(of(s, 'literal').map((x) => [x.value, x.line]), [['claude-cli', 2]]);
});

test('a list of those flags as data (no value after them) is not a command line', () => {
  const s = js("const FLAGS = new Set(['--permission-prompt-tool', '--append-system-prompt']);\n");
  assert.deepEqual(of(s, 'literal'), []);
});
