# Refactor roadmap

## Verdict

Keep AutoTaskCalendar as a single-deployable modular monolith. There are real security and
data-integrity risks worth fixing, but the old five-phase program was too large to be useful:
3,773 lines of plans, speculative file trees, and mandatory sequencing turned risk reduction into
process.

This roadmap keeps the valuable findings and drops the architecture campaign. Work on one concrete
risk at a time. Structural cleanup is worthwhile when it makes that work safer; it is not a goal by
itself.

## Shipped

- Task `00055` secured account and Google integration boundaries: one server-side browser session,
  actor-scoped account reads, invalidating logout, protected provider credentials, and session-bound
  one-use OAuth state with focused security specs.

## Do first: prevent incorrect or partially published data

- Make Google sync return truthful failures and bound token refresh and retry.
- Validate scheduler-critical values and calculate a complete schedule before replacing the last
  good projection.
- Enforce one recurrence occurrence per series and date, including under concurrent expansion.
- Add atomicity only at demonstrated multi-document failure boundaries. Confirm production MongoDB
  transaction support before designing shared transaction or migration machinery.
- Remove the legacy `repeat` field only after inventorying real stored data and writing the small
  migration that data requires.

**Why this is worth doing:** failures in these paths can lose, duplicate, or misreport user data.
Handle them as separate tasks rather than one database-hardening phase.

## Improve structure while changing behavior

- When changing a feature, extract the affected workflow from a large route or page if that makes the
  change easier to test and review.
- Prefer pure scheduling and recurrence rules where this protects high-risk behavior.
- Do not reorganize every controller or Vue page merely to match a proposed directory tree.

The codebase has large files and mixed responsibilities, but a standalone backend or frontend
reorganization would mostly be busywork. Refactor the area being changed and stop when the concrete
risk or feature is addressed.

## Take small delivery wins independently

- Prefer lockfile-respecting clean installs in CI.
- Add readiness and a minimal artifact/deployment smoke when production deployment is next changed.
- Remove or reclassify a dependency only after proving it is unused.

These are useful operational improvements. They do not depend on security, data, backend, or
frontend phases and should not block product work.

## Non-goals

- No microservices, event bus, framework rewrite, database migration, TypeScript conversion, or
  visual redesign under the label of refactoring.
- No mandatory phase order or all-or-nothing program.
- No architecture work without a named defect, feature need, operational risk, or measurable
  maintenance problem.
- No preservation of known defects merely because tests currently describe them.

## How to use this roadmap

1. Turn one bullet into its own approved task.
2. Name the concrete risk or invariant and the smallest useful outcome.
3. For behavior changes, add the focused spec that would catch the defect without duplicating the
   broader suite.
4. Keep the change independently reviewable and releasable; do not attach unrelated cleanup.
5. Mark the bullet shipped or remove it when declined. Do not grow this file back into implementation
   manuals.

Git history and completed task `00052` retain the original audit details if they are ever needed. The
active documentation should support decisions, not serve as an archive of hypothetical work.
