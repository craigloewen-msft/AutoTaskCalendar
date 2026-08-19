# Weekly Plan UX walkthrough

A screen-by-screen record of one full Weekly Plan cycle for `testuser` on the seeded dataset:
plan the week, commit, live through mid-week change, amend. Screenshots are in
`docs/screenshots/weekly-plan-walkthrough/`, numbered in the order they were taken.

This is an observation log, not a specification. Where it disagrees with
`docs/WEEKLY_PLAN.md`, the manual is the contract and the discrepancy is called out below.

## How this walkthrough was reproduced

1. `npm install` (and `webinterface/`) — a fresh worktree has no `node_modules`, and
   `scripts/db.js` pings Mongo with a script that `require`s `mongodb`, so a missing install
   surfaces as the misleading `MongoDB did not become ready within 90s`.
2. `npm run seed`, then `npm run dev`.
3. The seed already contains a commitment for the current week, so Plan mode is not reachable
   for `testuser` out of the box. The current week's `weeklyPlanInfo` document was deleted
   directly to get back to Plan mode.
4. Signed in as `testuser` / `testpassword` and opened `/#/weekly-plan`.

## Stage 1 — Plan mode

`01-plan-mode-top.png`, `02-plan-mode-other-active-expanded.png`

The header reads **WEEK OF · Mon, Aug 17 – Sun, Aug 23**, with `12 tasks` / `12h 45m selected`
and a day strip, above a primary **Commit to this week · 12 tasks** button. Below it the
role → goal → project hierarchy renders in full: `ENGINEER` with its description and a
`7 tasks · 7h 15m` roll-up, then `Ship v2 by June`, then the `Migration plan` project with its
five in-week tasks, each showing due day and duration and each pre-checked.

Each project also carries collapsed `Other active tasks · N` and
`✓ 6 tasks completed last week · Aug 10 – Aug 16` disclosures, plus a `+ Add a task` trigger.
Roles with no in-week work (`FATHER`, `HEALTH`) still render, showing `nothing planned` on
their projects — useful, because an empty role is exactly the thing worth noticing on Monday.

The hierarchy ends with `Someday · 1 parked projects` and `Unaligned tasks · 14 due this week`,
the latter being everything with a due date in the week but no project.

## Stage 2 — Adding tasks

`03-quick-add-form-filled.png`, `04-quick-add-second-project.png`

`+ Add a task` expands an inline form inside the project it belongs to: title, minutes
(defaulting to 30), and a Mon–Sun day chip row, with Cancel / Add task. Because the form is
scoped to a project, there is no project picker to get wrong.

Added *Dry-run the migration on staging* (Wed, 90m) under **Migration plan** and
*Long run, 10km* (Fri, 75m) under **Training block**. Both appeared immediately in their
project, checked, and the header counters moved (`12 tasks` → `13` → `14`).

## Stage 3 — Unchecking

`05-unchecked-task-excluded.png`

Unchecking *Research the migration* drops the selected total from `14h 15m` to `14h` and the
button label to `Commit to this week · 13 tasks`. The task itself stays visible and unchanged;
only the commitment shrinks, exactly as the manual describes.

## Stage 4 — Commit

`06-ready-to-commit.png`, `07-review-mode-just-committed.png`

Pressing **Commit to this week · 13 tasks** switches the page in place — no reload, no
confirmation. The header becomes **COMMITTED WEEK** with `0 of 13 done` / `0m of 14h`, and the
primary button becomes **Update commitment**. Every project that received committed work grows
a `COMMITTED` block with its own `0 of 5 done · 0m of 4h 15m` line and one `●` row per item.

## Stage 5 — Mid-week review

`08-edit-task-move-due-date.png`, `09-midweek-review-all-statuses.png`,
`10-midweek-header-progress.png`

From the Calendar page: completed *Handle the rollback question*, moved *Write the cutover
runbook* from Thu Aug 20 to Thu Aug 27, and deleted *Publish the migration plan*.

Returning to `/weekly-plan` shows all four derived statuses in one project block:

```text
Migration plan                        1 of 5 done · 30m of 4h 15m
  ●  Dry-run the migration on staging   due Wed, Aug 19 · 1h 30m
  ✓  Handle the rollback question       done Wed
  ↷  Write the cutover runbook          moved to Thu, Aug 27
  ●  Draft the migration plan           due Sat, Aug 22 · 1h
  ✗  Publish the migration plan         removed
```

The deleted task is still listed as a broken promise, which is the point of the snapshot. The
header tracks it: `1 of 13 done · 30m of 14h`. No refresh or sync step was needed anywhere —
completing on Calendar was already correct here.

## Stage 6 — Update the commitment

`11-added-since-commit.png`, `12-commitment-amended.png`, `13-final-amended-header.png`

Quick-adding *Write the rollback postmortem* (Thu, 45m) after committing puts it under
**ADDED SINCE COMMIT**, alongside *Research the migration* (the task excluded in stage 3), each
prefixed `+`, with an `Update commitment` button and a transient `Task added since commit.`
toast.

Pressing **Update commitment** folds both in: the project goes from `1 of 5 done · 4h 15m` to
`1 of 7 done · 6h 30m`, the two rows move up into the committed list as `●`, and the
**ADDED SINCE COMMIT** section disappears. The already-snapshotted rows — including the
`✗ removed` one — are untouched, confirming that amendment is additive only.

---

## Issues found

Each of these is small and independent enough to become its own task. Nothing was fixed here.

1. **An excluded task returns as "added since commit" the instant you commit.** Unchecking
   *Research the migration* and committing produced a review screen that immediately proposes
   re-adding it. Deliberate exclusion and "work that appeared later" are different things, and
   the page cannot tell them apart. This makes the stage-3 checkbox feel pointless.
2. **`Other active tasks · 2` recounts a moved task without saying so.** After *Write the
   cutover runbook* moved to Aug 27, the count under Migration plan went from 1 to 2, so the
   same task is both `↷ moved` in the commitment and an anonymous entry in a collapsed
   disclosure. It reads as two separate pieces of work.
3. **Delete uses a native `window.confirm`.** The browser-modal confirm on the task editor is
   out of keeping with the app's own dialogs and blocks the page. It is also the one place in
   this walkthrough that could not be driven without special handling.
4. **Login drops its `next` parameter.** Visiting `/#/weekly-plan` while signed out redirects to
   `/#/login?next=/weekly-plan`, but signing in lands on `/#/user/testuser` and the intended
   destination is discarded.
5. **`Commit to this week` has no confirmation and no visible undo.** It is the single
   irreversible-feeling action on the page — the manual states re-committing can never remove
   an item — yet it is a one-click primary button. Worth at least a sentence of in-page
   consequence copy.
6. **A missing `node_modules` reports as a MongoDB timeout.** `scripts/db.js` pings via a
   subprocess that requires `mongodb`; when the module is absent the ping fails silently for 90
   seconds and the user is told to inspect Docker logs that show a perfectly healthy database.
   Distinguishing "ping script could not run" from "database not answering" would save real
   time in a fresh worktree.

## Agreement with `docs/WEEKLY_PLAN.md`

No contradictions were observed. Plan/Review modes, the four derived statuses, the snapshot
surviving deletion, additive amendment, and quick add in both modes all behaved as documented.
The manual does not currently mention that an unchecked task reappears under **added since
commit** (issue 1); whichever way that is resolved, the manual should say so explicitly.
