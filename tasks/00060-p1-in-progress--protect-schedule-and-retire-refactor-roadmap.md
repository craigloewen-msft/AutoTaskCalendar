# Protect the last good schedule and retire the refactor roadmap

## Decision

Delete the refactor roadmap after one final, narrowly scoped correctness fix.

One remaining finding clears the bar for action because it is a concrete data-loss path rather than architectural cleanup:

- `POST /api/editTask` can persist non-finite, zero, or negative task/chunk durations because edit-time values are not validated server-side.
- A chunked task whose duration cannot fit in one slot and whose chunk duration is zero produces an invalid placement in `scheduleTaskChunk`.
- `generateTaskEvents` deletes the user's current generated events and clears scheduling output before planning and validating the replacement. When replacement persistence rejects the invalid placement, the request fails after the last good schedule has already been erased.

The other roadmap bullets do not meet the same standard: recurrence concurrency did not reproduce under six simultaneous scheduling calls and a unique index needs data cleanup/migration care; transaction support is unconfirmed; legacy `repeat` removal needs a production-data inventory; and the operational/dependency notes are optional maintenance rather than compelling product risks.

## Implementation

1. Validate scheduler-critical task values on both create and edit:
   - task duration must be a finite number greater than zero;
   - when chunking is enabled, chunk duration must be a finite number greater than zero;
   - reject invalid input with the existing `{ success: false }` API convention instead of silently storing or normalizing it.
2. Compute and validate a complete replacement plan before clearing the current generated schedule:
   - load only genuine calendar conflicts while planning so the previous generated projection does not block its replacement;
   - reject invalid placements, dependency cycles, or an abnormal planner-limit result before destructive writes;
   - leave the last good generated events and task scheduling output untouched when planning or validation fails.
3. Keep publication narrow. Do not introduce transaction infrastructure, locks, generation-version schemas, or a general scheduler rewrite.
4. Delete `docs/REFACTOR_OVERVIEW.md` and remove its live index entry from `AGENTS.md`.
5. Leave references in completed `tasks/*-done--*.md` files unchanged; those are historical records, not active documentation.

## Specs

Add focused API coverage proving that:

- create and edit reject representative invalid duration/chunk values;
- if invalid stored scheduling input is encountered, scheduling reports failure while preserving the prior generated events and scheduled task output;
- successful scheduling remains idempotent and continues to replace generated work without treating the old generated projection as a calendar conflict.

Prefer extending the existing task and scheduling specs rather than creating broad duplicate coverage.

## Verification

- Run the focused task and scheduling API specs while iterating.
- Run the full test suite once during finalization.

## Acceptance criteria

- Invalid scheduler-critical task values cannot enter through create or edit APIs.
- Planning and validation complete before the current generated projection is cleared.
- A planning/validation failure preserves the user's last good schedule.
- Successful scheduling behavior remains unchanged.
- The refactor roadmap and its active `AGENTS.md` reference are gone.
- No speculative architecture or unrelated roadmap work is added.
