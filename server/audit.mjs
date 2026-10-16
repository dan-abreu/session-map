// The audit as an engine run (id142, or47, task 3): the vendored ponytail-audit method, mechanically ranked — the
// failing tests first (the program cannot release), then the deferred markers (later never comes). The runner writes
// .dev/execucao/audit-<date>.md from the last suite run and the debt harvest; this pure part is the tested ranking.
export function rankAudit({ failing = [], debts = [] }) {
  const findings = [];
  for (const f of failing) {
    findings.push({ rank: 'must', what: `a suite is failing: ${f}`, fix: 'read the failing assertions and fix the code or the test', skip: 'the program cannot release while it fails' });
  }
  for (const d of debts) {
    findings.push({ rank: 'should', what: `deferred: ${d.text}`, where: `${d.file}:${d.line}`, fix: 'revisit the limit the marker names', skip: 'later never comes' });
  }
  return findings;
}
