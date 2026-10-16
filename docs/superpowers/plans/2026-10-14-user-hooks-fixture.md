# The guard's workflow fixture plan

The plan named by the guard's own tests: a valid plan for a 10-agent workflow that only counts agents.

## File Structure

- `test/user-hooks.test.mjs` — the guard's workflow checks.

### Task 1: the workflow runs within the limit

Files: `server/chat/guard.mjs`, `test/user-hooks.test.mjs`.

Test: `node --test test/user-hooks.test.mjs` green.
