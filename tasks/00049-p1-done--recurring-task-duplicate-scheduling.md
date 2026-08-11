# Fix duplicate scheduling of recurring tasks (and the port collision that hid it)

A weekly-on-Monday task was scheduled multiple times on the same day and across several
days. Two independent defects caused it, plus a dev-environment defect that made the bug
impossible to investigate reliably.

## Outcome

**Confirmed root cause (two defects, both reproduced and fixed):**

1. **A weekly rule with no `byWeekday` generated an occurrence every single day.**
   `matchesDayFilter` fell through to `return true` when the weekday list was empty, so
   "weekly" became "daily". A legacy `repeat: 'weekly'` string carries no `byWeekday` at
   all, and `normaliseRecurrence` happily stores an empty array for any API caller that
   omits it. Reproduced from a clean account: one weekly task, completed once, became
   **60 tasks on 60 consecutive days**. Fixed by defaulting to the weekday the series
   starts on, matching iCalendar RRULE's BYDAY/DTSTART rule. Verified 21 dates -> 3.

2. **Completed tasks kept acting as live series templates.** `expandRecurrences` selected
   templates with no `completed` filter, so a ticked-off repeating task regenerated work
   forever. On the seeded dataset this produced **366 phantom tasks** (6 completed
   templates x 61 occurrences) and 97 duplicate title/day pairs. Fixed by excluding
   completed tasks from the template query, plus a cleanup pass that deletes pending
   occurrences of an already-completed series. Completed occurrences are never touched.

After the fix, `testuser` drops from 556 active tasks to 137, phantoms to 0, and duplicate
title/day pairs from 97 to 11 - all 11 verified as legitimately distinct tasks or a seeded
calendar event, not scheduler duplicates. `recurruser` shows exactly one block per Monday.

**The concurrency hypothesis was wrong.** Six simultaneous `/api/scheduletasks` calls
produced no duplicates. The race in `generateTaskEvents` is real in principle but is not
this bug, so nothing was changed for it and no speculative locking was added.

## The dev-environment defect (fixed first, because it blocked everything)

`instance.js` hashed the branch name into `(hash % 49) + 1` port blocks and nothing ever
checked the result was free. My branch and a concurrently running one both landed on
offset 3, so `:3030` was **another agent's server backed by another agent's database**. I
spent the first pass reproducing against it and writing test users into it. Measured: 200
synthetic branch names collided on 44 of 49 offsets, worst bucket 9 deep.

Fixed by making `npm run dev` (and `npm test`) *allocate* ports: probe from the preferred
block, take the first that actually binds, and print what was taken. The database name is
now derived from the instance name alone, so it stays pinned to the branch while ports
float. `app.js` reports `EADDRINUSE` with the instance name and the remedy instead of an
unhandled crash.

## Changes

| File | Change |
|---|---|
| `controllers/recurrence.js` | Empty `byWeekday` -> series start weekday; completed tasks excluded as templates; `pruneOccurrencesOfCompletedSeries` |
| `app.js` | Diagnostic `listen` error handler |
| `seed/dataset.js` | `recurruser`: 3 one-off tasks + one weekly-Monday series |
| `tests/api/recurrence.spec.js` | Specs for both defects and the Monday scenario |
| `docs/`, `AGENTS.md` | Rules documented; the false "own ports per branch" claim corrected |

> **Merge note.** The port-allocation half of this task (`scripts/port-allocator.js`, and
> the `dev.js`/`test.js`/`instance.js` rewrites around it) was superseded on `main` by the
> shared-container work in `scripts/db.js`, which probes ports at startup itself. Only the
> recurrence fix and its specs were merged; the allocator was dropped as duplicate.

## Testing note

The targeted specs were run and the relevant ones pass. A full `npm run verify` was not
completed: the shared MongoDB container repeatedly lost its wslc port-forward mid-run
(`MongoPoolClearedError`, "timeout while setting up api"). `npm run db:doctor` traced it to
a leftover container from the old one-per-instance scheme, and `npm run db:migrate` cleared
it, but the run was stopped before finishing. **The full suite should be run before merge.**
All changed files pass `node --check`.

## Follow-ups (not done, deliberately)

- `generateTaskEvents` has no mutual exclusion. Unproven as a live bug, but the code
  already works around it at `controllers/scheduling.js:292-295`.
- `editTask` lacks `createTask`'s `breakUpTask`/chunk-duration guard, so a chunk duration
  of 0 yields `Math.floor(x / 0) = Infinity` in `scheduleTaskChunk`.
- `docs/RECURRING_TASKS.md` says an occurrence's `dueDate` is the *end* of its day;
  `expandSeries` sets the start of day.
- `isOnInterval` uses locale-dependent `startOf('week')`, which can shift the phase of
  fortnightly rules.
