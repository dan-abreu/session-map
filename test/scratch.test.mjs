import test from 'node:test';
import assert from 'node:assert/strict';
import { projectsRootsOf, scratchWhy } from '../server/scratch.mjs';

const TMP = 'C:\\Users\\danie\\AppData\\Local\\Temp';
const here = () => true;
const why = (root, exists = here) => scratchWhy(root, { exists, tmp: TMP });

test('the folders from the owner\'s own PC that nobody keeps as projects are told apart (id161)', () => {
  // A helper's worktree and a test run's copy: the folder is gone.
  assert.equal(why('C:\\dev\\session-map\\.claude\\worktrees\\agent-a9d14d87c50ea85db', () => false), 'gone');
  assert.equal(why(`${TMP}\\claude\\C--dev-session-map\\3fc1\\scratchpad\\real-run-DnTWYL\\.session-map-runs\\coder-20261015224639`, () => false), 'gone');
  // The system's temp folder and everything in it, short names included.
  assert.equal(why(`${TMP}\\pc26\\work`), 'temp');
  assert.equal(why('C:/Users/danie/AppData/Local/Temp/claude/C--dev-session-map/3fc1/scratchpad/dsh-trial'), 'temp');
  // A hidden tool folder (.claude, .dev) and the DeepSeek Harness's own workspace.
  assert.equal(why('C:/dev/session-map/.dev/sandbox-real'), 'tool');
  assert.equal(why('C:\\Users\\danie\\.claude\\projects\\C--Users-danie\\memory'), 'tool');
  assert.equal(why('C:\\Users\\danie\\OneDrive\\Documentos\\deepseek-harness\\default-workspace'), 'tool');
});

test('a project the owner keeps is never put away: his repositories, his home folder, a name that only looks like a tool', () => {
  assert.equal(why('C:/dev/session-map'), null);
  assert.equal(why('C:/dev/cverino'), null);
  assert.equal(why('C:\\dev\\dnd_mmorpg'), null);
  assert.equal(why('C:\\Users\\danie'), null);
  // A folder merely starting like the temp one is not inside it.
  assert.equal(why(`${TMP}-keep\\site`), null);
  assert.equal(why('C:/dev/my.project/app'), null);
});

test('with a folder named for his projects, what sits outside it is put away, his home folder first (id163)', () => {
  const within = ['C:/dev'];
  const outside = (root, exists = here) => scratchWhy(root, { exists, tmp: TMP, within });
  assert.equal(outside('C:\\Users\\danie'), 'outside');
  assert.equal(outside('D:/work/shop'), 'outside');
  assert.equal(outside('c:/dev-old/site'), 'outside', 'a name that only starts like it is not inside it');
  assert.equal(outside('C:/dev'), null);
  assert.equal(outside('c:\\DEV\\cverino'), null, 'case and slashes do not matter');
  assert.equal(outside('C:/dev/session-map/.dev/sandbox-real'), 'tool', 'a tool folder says what it is even inside it');
  assert.equal(outside('C:/dev/gone', () => false), 'gone');
  // Without the setting nothing is outside: it is anywhere, as it always was.
  assert.equal(why('C:\\Users\\danie'), null);
  assert.deepEqual(projectsRootsOf({ projectsRoot: 'C:/dev' }), ['C:/dev']);
  assert.deepEqual(projectsRootsOf({ projectsRoot: ['C:/dev', ' ', 7, 'D:/code'] }), ['C:/dev', 'D:/code']);
  assert.deepEqual(projectsRootsOf({}), []);
  assert.deepEqual(projectsRootsOf(null), []);
});
