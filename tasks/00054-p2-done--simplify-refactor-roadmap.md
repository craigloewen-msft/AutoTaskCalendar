# Replace the refactor program with a short, risk-driven roadmap

## Verdict

Keep a refactor roadmap, but delete the current five-phase program.

The audit found real problems, so deleting every trace would hide useful warnings:

- Google OAuth uses a user ID as `state`, the callback is not bound to the initiating login, credentials are stored in plaintext, and provider details are logged.
- The app runs both Passport sessions and a browser-stored JWT, while `/api/user/:username` trusts a path-selected account.
- The process starts listening without waiting for MongoDB, and Google sync can recursively retry or report success after an internal failure.
- Scheduling, recurrence, and destructive multi-document writes have data-loss or duplication risks.
- Large route and Vue files make related changes harder to review.

Those findings justify targeted work. They do **not** justify 3,773 lines of future manuals, a mandatory five-phase sequence, speculative target file trees, hundreds of requirements, or production ceremony based on deployment facts the repository does not know. The architecture-only backend/frontend phases would be busywork if done as standalone campaigns.

## Documentation changes

1. Replace `docs/REFACTOR_OVERVIEW.md` with a short roadmap (target: about 60-100 lines) containing only:
   - the verdict above;
   - priorities and the risk each priority reduces;
   - explicit non-goals;
   - a lightweight rule for approving and completing one item at a time.
2. Delete:
   - `docs/REFACTOR_PHASE_1.md`
   - `docs/REFACTOR_PHASE_2.md`
   - `docs/REFACTOR_PHASE_3.md`
   - `docs/REFACTOR_PHASE_4.md`
   - `docs/REFACTOR_PHASE_5.md`
3. Update `AGENTS.md` so it describes the remaining file as a small risk-driven roadmap, not an approved architecture program.

Git history and completed task `00052` remain available if an old audit detail is ever needed; the active docs should optimize for decisions, not archival completeness.

## Replacement roadmap

### Do first: close concrete security and trust-boundary defects

- Bind Google OAuth to the initiating authenticated user with unpredictable, expiring, one-use state; stop logging OAuth URLs, codes, tokens, and provider bodies.
- Protect stored Google credentials or disable the integration until they can be protected.
- Use one browser authentication lifecycle, scope account reads to the authenticated actor, and make logout invalidate that lifecycle.
- Add focused tests for OAuth replay/account binding, cross-account reads, and logout.

These are worth doing because they reduce account crossover and credential exposure, not because they produce cleaner folders.

### Do next: prevent incorrect or partially published data

- Make Google sync return truthful failures and bound token refresh/retry.
- Validate scheduler-critical values and calculate a complete schedule before replacing the last good projection.
- Enforce one recurrence occurrence per series/date and test concurrent expansion.
- Add atomicity only at demonstrated multi-document failure boundaries. Confirm production MongoDB transaction support before designing a general transaction or migration framework.
- Remove the legacy `repeat` field only when real stored data has been inventoried and a small migration is needed.

These items are worth doing where a failure can lose, duplicate, or misreport user data. They should be separate tasks rather than one database-hardening phase.

### Improve structure only while changing behavior

- When a feature is being changed, extract the affected workflow from a large route/page into one focused module or component.
- Do not reorganize every backend controller or Vue page merely to match a proposed directory tree.
- Prefer pure scheduler/recurrence rules where this makes high-risk behavior easier to test.

This retains the useful modular-monolith direction without funding a no-user-value rewrite.

### Take small delivery wins independently

- Prefer lockfile-respecting clean installs in CI.
- Add readiness and a minimal artifact/deployment smoke when production deployment work is next touched.
- Remove or reclassify a dependency only after proving it is unused.

These do not need to wait for security, data, backend, or frontend phases.

### Explicit non-goals

- No microservices, event bus, framework rewrite, database migration, TypeScript conversion, or visual redesign as “refactoring.”
- No mandatory phase order.
- No architecture work without a named defect, feature need, operational risk, or measurable maintenance problem.

### Execution rule

Each roadmap bullet becomes its own approved task. The task states one concrete risk/invariant, ships the smallest focused spec for behavior changes, and is independently releasable. Mark the bullet shipped or remove it when declined; do not grow this document back into implementation manuals.

## Acceptance

- The active refactor documentation is one concise roadmap and the five phase manuals are gone.
- The roadmap clearly distinguishes urgent risk reduction from opportunistic cleanup.
- It does not claim unimplemented behavior has shipped or require unrelated work as a prerequisite.
- All active links and the `AGENTS.md` docs index are correct.
- This is documentation-only; no product code, behavior, packages, schemas, or CI workflow changes are included, and the test suite does not need to run.
