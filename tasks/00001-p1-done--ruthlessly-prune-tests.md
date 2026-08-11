# Ruthlessly prune the test suite

## Objective

Reduce the Playwright suite from 195 tests (155 API, 40 UI) to no more than 53 focused tests. Delete roughly 142 tests (at least 72%) without changing application behavior.

The remaining suite should be a small risk-based safety net, not an endpoint-by-endpoint catalog. Prefer deleting tests outright over disguising the count by combining unrelated cases into oversized tests.

## Pruning rules

Keep a test only when it protects at least one of these:

- a primary user journey;
- cross-tenant access control or authentication boundaries;
- scheduler invariants, because scheduling is the highest-risk subsystem;
- recurrence identity, idempotence, and completed-history preservation;
- civil-date, instant, timezone, DST, or migration correctness;
- destructive lifecycle behavior that could lose user data.

Delete tests that are primarily:

- duplicate coverage at API and UI layers;
- one validation permutation among many equivalent permutations;
- routine CRUD already exercised by a broader lifecycle;
- payload-shape or implementation-detail assertions;
- visual labels, badges, summaries, disabled states, and minor error-state behavior;
- empty-state or trivial negative-path checks;
- repetitions of authentication or tenant checks on every endpoint;
- historical regressions whose underlying invariant is already covered more directly.

## Target inventory

| File | Current | Target | Retained scope |
| --- | ---: | ---: | --- |
| `tests/api/auth.spec.js` | 9 | 3 | account/login lifecycle, one auth boundary, working-preference validation/update |
| `tests/api/temporal.spec.js` | 8 | 3 | strict parsing contract, DST/week boundaries, idempotent legacy migration |
| `tests/api/compass.spec.js` | 36 | 7 | hierarchy, lifecycle/cascade, representative validation, tenancy, counts/window, task alignment, archive |
| `tests/api/dev-database.spec.js` | 10 | 3 | deterministic bounded instance resolution, concurrent port isolation, real database/container isolation |
| `tests/api/scheduling.spec.js` | 17 | 6 | core placement invariants, dependencies, idempotence/calendar preservation, hostile horizon, far-future conflicts, recurring placement |
| `tests/api/recurrence.spec.js` | 39 | 8 | rule families and DST, validation, expansion/idempotence, completion history, edit/delete pruning, legacy compatibility, immediate visibility, scheduled weekdays |
| `tests/api/events.spec.js` | 10 | 3 | CRUD lifecycle, exact week/tenant scope, Google timed and all-day conversion |
| `tests/api/tasks.spec.js` | 26 | 8 | scoped listing, lifecycle/date stability, representative validation/backlog, dependencies, completion cleanup, chunks, project completion window, follow-up/data-preserving behavior |
| `tests/ui/login.spec.js` | 4 | 2 | login journey and protected-route guard |
| `tests/ui/calendar.spec.js` | 15 | 4 | task lifecycle, scheduling render, recurring-task interaction, one timezone/all-day rendering contract |
| `tests/ui/compass.spec.js` | 10 | 2 | hierarchy/archive rendering and one create/link workflow |
| `tests/ui/weeklyPlan.spec.js` | 10 | 3 | weekly review, quick task/edit workflow, timezone/mobile usability |
| `tests/ui/user.spec.js` | 1 | 1 | working-preference round trip into calendar behavior |
| **Total** | **195** | **53 maximum** | **Delete at least 142 tests** |

Targets are ceilings, not quotas. Delete more when a retained test naturally covers the same contract without becoming difficult to understand.

## Implementation approach

1. Trim each spec to the target risk-based scenarios.
2. Where several assertions use exactly the same setup and describe one coherent invariant, keep them in one readable test. Do not merge unrelated behavior merely to lower the count.
3. Remove dead imports, helpers, fixtures, comments, and setup left behind by deleted tests.
4. Keep test data deterministic and assertions behavioral; do not pin scheduler timestamps.
5. Update `docs/TESTING.md` so its scheduler guarantees and examples match the smaller suite. Document the risk-based policy to prevent test-count regrowth.
6. Do not alter application source code or behavior as part of this task.

## Verification

- Use Playwright test listing to confirm no more than 53 tests remain.
- Run focused specs while pruning.
- Run `npm test` once at finalization and require a fully green suite.
- Review the final diff to ensure it consists only of test/documentation simplification and contains no skipped tests (`test.skip`, `test.fixme`) standing in for deletion.

## Acceptance criteria

- The suite contains at most 53 tests and at least 142 tests have been removed.
- No application source behavior changes.
- The remaining tests cover the retained scopes in the table.
- No disabled/skipped tests are used to satisfy the count.
- Obsolete test utilities and imports are removed.
- `docs/TESTING.md` describes the lean testing policy accurately.
- The full test suite passes.
