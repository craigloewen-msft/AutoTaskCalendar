# Fix duplicate scheduling of recurring tasks (and the port collision that hid it)

A weekly-on-Monday task is scheduled multiple times on the same day and across several
days in production. This task fixes that, and first fixes the dev-environment defect that
made the bug impossible to reproduce reliably.

## What I found while investigating

### 1. Why the "one instance per branch" promise is false (blocker, fix first)

`AGENTS.md` promises each branch gets its own ports and database so several agents can run
at once. Two independent defects break that:

**a. The port derivation is a hash into far too small a space.** `instance.js`
`hashToOffset()` returns `(hash % 49) + 1`, so every branch on the host is squeezed into 49
port blocks. My branch `task-pending-dfa1a905` and the concurrently-running
`task-00047-weekly-plan` both land on **offset 3** — `api=3030`, `web=8110`,
`inspect=9259`. Measured: 200 synthetic `task-pending-*` names collided on 44 of 49
offsets, worst bucket 9 deep. With birthday-collision odds in a 49-slot space this is the
normal case, not bad luck.

**b. Nothing ever checks the port is actually free.** The derivation is a pure function of
the branch name with no knowledge of what is already running, and no participant verifies
its assumption:

- `scripts/dev.js` prints the derived ports as fact and spawns the children.
- `app.js` calls `app.listen(hostPort, ...)` with **no `error` handler**, so a losing race
  is an unhandled `EADDRINUSE` crash rather than a diagnosis.
- `webinterface/vue.config.js` takes `AUTOTASKCALENDAR_WEB_PORT` on faith.

That combination is what burned this investigation. My worktree has no `node_modules` and
no `dist`, so it was never serving anything; `:3030` was **another agent's server backed by
another agent's database** (`autotaskcalendar_task_00047_weekly_plan`, not
`autotaskcalendar_task_pending_dfa1a905`). I reproduced against it, read its data, and
wrote three test users into it — all while believing I was driving my own stack. Proof it
was the other branch: the bundle served from `:3030` contains `WeeklyPlan` markers that
exist only on that branch.

**Fix — `npm run dev` allocates the block, then tells you how to connect.**

- Move port selection into `scripts/dev.js`: start at the hashed offset as a *preference*,
  then scan upward for the first block whose api/web/inspect ports all actually bind. The
  env plumbing to pass the result to the children already exists
  (`AUTOTASKCALENDAR_API_PORT` and friends), so this is a change to how the numbers are
  chosen, not to how they travel.
- Wrap allocation in the same `flock` pattern `scripts/dev-db.sh` already uses, so two
  agents running `npm run dev` at the same moment cannot both claim one block through the
  probe-then-spawn window.
- Print the chosen ports once, unambiguously, at startup — that banner is how the agent
  learns where to connect, so it must state what was actually bound, not what was hoped
  for. Note when the block differs from the hashed default.
- Give `app.js` an `error` handler on `listen` that reports the port, the instance name,
  and the remedy instead of an unhandled throw.
- Apply the same allocator in `scripts/test.js`; the test instance name is hashed the same
  way, so two agents running the suite concurrently collide identically.

**Careful:** `buildDbName()` currently appends the runtime port offset when truncating a
long name. If the offset becomes dynamic, a long-named branch's database name would move
with its port and an agent would silently get an empty database on restart. Derive that
suffix from a hash of the instance name instead, so **the database stays pinned to the
branch while only the ports float**.

One spec, per the "any behaviour change ships with a spec" rule: two stacks started with
colliding instance names bind different ports and keep their own databases.

### 2. The recurrence generator itself is sound for this rule

Run directly against my worktree's code, a weekly `byWeekday:[1]` rule over a 60-day
horizon produced exactly 8 dates, all Mondays, all unique. Expansion dedup on
`(seriesRef, occurrenceDate)` also held: 3 consecutive scheduling runs left 8 occurrences
with 0 duplicates, one calendar event per Monday.

So the defect is **not** in `occurrenceDatesBetween`, and the duplicates the user sees are
almost certainly duplicate **events**, not duplicate occurrences. Caveat: those runs went
through the colliding stack, so they get redone once the environment is trustworthy.

### 3. Leading hypothesis: concurrent scheduling runs, with no mutual exclusion

`generateTaskEvents` is a long read-modify-write with no lock:

```
expandRecurrences()                                  // awaits, creates occurrences
EventDetails.deleteMany({type: task, task-chunk})    // wipes previous output
buildSchedulingContext()                             // awaits, several queries
while (pendingTasks) { ... await createTaskEvent() } // inserts one at a time
```

Two overlapping runs interleave: both wipe, then both insert events for the same
occurrences. The result is the same task appearing several times on one day and repeated
across days — exactly the reported symptom. The code already concedes this race at
`controllers/scheduling.js:292-295` ("a concurrent run can prune this occurrence mid-loop",
using `updateOne` instead of `save()` to dodge a throw) — worked around locally, never
eliminated.

How it gets triggered in production:

- `scheduleTasks()` in `Calendar.vue:752` has no in-flight guard and the button is never
  disabled, so a double-click fires two overlapping runs.
- `createTask` and `editTask` each call `expandRecurrences` (`routes/tasks.js:155`, `:285`),
  which can land mid-run of a scheduling pass. "Create a recurring task, then press
  Schedule Tasks" — the exact reported sequence — is this interleaving.

### 4. Second candidate: chunked tasks are re-queued forever

`scheduleTaskChunk` never splices the task out of `pendingTasks` and never sets
`scheduledDate`, unlike `scheduleFullTask`. It legitimately emits one event per slot per
day, which on its own *looks* like "the same task, many times, over multiple days".

Related latent defect: `createTask` coerces `breakUpTask` to false when
`breakUpTaskChunkDuration` is missing (`routes/tasks.js:86-88`), but **`editTask` has no
such guard**. A task edited into `breakUpTask: true` with a null/0 chunk duration gives
`getChunkDuration() === 0`, so `numChunks = Math.floor(availableTime / 0) = Infinity` and
`totalChunkTime = NaN` — a runaway event generator. Worth confirming whether the
production task was chunked.

## Plan

1. **Fix port allocation** (section 1), then confirm the stack I am driving is mine: the
   startup banner names my branch and my database, and the data I create appears there.
2. **Add a reproduction account to the seed**, as requested. Extend `seed/dataset.js` with
   a third user `recurruser` / `testpassword` carrying a deliberately small, readable set:
   a handful of generic one-off tasks plus one weekly-on-Monday series. Small enough that
   duplicates are obvious by eye, unlike `testuser`'s 517 occurrences. Document it in
   `docs/SEEDING.md` beside the existing credentials table.
3. **Reproduce for real** in the browser: seed, log in as `recurruser`, add the
   weekly-Monday task through the modal, press Schedule Tasks — including a double-press
   and a create-then-schedule race — and capture the duplicate events.
4. **Confirm which hypothesis** is responsible before changing behaviour, by counting
   `EventDetails` per `taskRef` per day and checking whether the duplicates carry
   `type: 'task'` (points to the race) or `'task-chunk'` (points to chunking).
5. **Fix it.** Expected shape, pending step 4:
   - Serialise scheduling per user. A `findOneAndUpdate` lease document keyed on the user
     is enough and works across processes — an in-process flag would not, since prod may
     run multiple instances. A late run either waits for the lease or is rejected.
   - Give `scheduleTasks()` an in-flight guard and disable the button while it runs, so the
     obvious trigger disappears from the UI as well as the server.
   - Apply `createTask`'s `breakUpTask`/chunk-duration guard in `editTask` too, and make
     `getChunkDuration()` defensive so a 0 chunk duration can never yield `Infinity`.
6. **Specs** — any behaviour change ships with one:
   - Two concurrent `/api/scheduletasks` calls leave exactly one event per occurrence.
   - Create-recurring-then-schedule produces exactly one event per Monday occurrence.
   - A weekly Monday series yields events only on Mondays, one per occurrence date.
   - `editTask` cannot produce a chunked task with no chunk duration.
7. **Docs** — record the locking rule in `docs/RECURRING_TASKS.md` (or a new
   `docs/SCHEDULING.md` if that is the better home), and in `docs/DEV_DATABASE.md` state
   that ports are allocated at startup and the banner is the source of truth.

## Notes / risks

- `controllers/scheduling.js` is flagged in `AGENTS.md` as the highest-risk code. The lock
  goes around the existing algorithm; the placement logic is not otherwise touched.
- Dynamic ports mean the URL can change between runs. That is the point — but anything
  holding a stale URL (a bookmark, an open browser tab, a hardcoded test base URL) needs to
  read the banner. `AUTOTASKCALENDAR_API_PORT` and friends still pin ports explicitly when
  a human wants them fixed.
- Two smaller inconsistencies noticed in passing, to be handled separately unless they turn
  out to be implicated:
  - `docs/RECURRING_TASKS.md` says an occurrence gets `dueDate` = **end** of its day, but
    `expandSeries` sets `dueDate = date` (start of day). Affects deadline ordering.
  - `matchesDayFilter` comments that `moment().day()` is local "matching the scheduler's
    local weekday logic", but it is called on a UTC marker; and `isOnInterval` uses
    locale-dependent `startOf('week')`. Harmless at `interval: 1`, can shift the phase for
    fortnightly rules.
- Full `npm run verify` before commit; `npm run test:api` while iterating.
