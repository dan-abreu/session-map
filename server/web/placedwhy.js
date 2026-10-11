// Why a chat sits on the part and the branch it does (sb03): the server keeps the rule that won and what shows it
// (partWhy, workCellWhy); these say it in plain words. Pure: the page passes its translator and its list joiner.

const PART = {
  code: 'chat.why.code', files: 'chat.why.files', page: 'chat.why.page', ai: 'chat.why.ai',
  owner: 'chat.why.owner', project: 'chat.why.project', none: 'chat.why.none',
};
const BRANCH = {
  card: 'chat.branchWhy.card', branch: 'chat.branchWhy.branch', cwd: 'chat.branchWhy.cwd', guess: 'chat.branchWhy.guess',
};

// An old server sends only partSource: the rule is the same word, without its evidence.
export function placedWhy(chat, t, list) {
  const why = chat.partWhy ?? { rule: chat.partSource ?? 'none' };
  if (why.rule === 'code') return why.codes?.length ? t(PART.code, { codes: list(why.codes) }) : t('chat.why.codeAny');
  if (why.rule === 'files') return why.files?.length ? t(PART.files, { files: list(why.files) }) : t('chat.why.filesAny');
  if (why.rule === 'owner' && why.none) return t('chat.why.ownerNone');
  return t(PART[why.rule] ?? PART.none);
}

export function branchWhy(chat, t) {
  const why = chat.workCellWhy ?? { rule: chat.workCellSource };
  if (why.rule === 'card') return why.front ? t(BRANCH.card, { front: why.front }) : t('chat.branchWhy.cardAny');
  if (why.rule === 'branch') return why.branch ? t(BRANCH.branch, { branch: why.branch }) : t('chat.branchWhy.branchAny');
  return t(BRANCH[why.rule] ?? BRANCH.cwd);
}
