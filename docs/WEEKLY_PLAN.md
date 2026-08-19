# Weekly Plan

Weekly Plan is the beginning-of-week workflow for turning Compass direction into tasks, and
the rest-of-week workflow for reviewing how that week is actually going. Open `/weekly-plan`,
review each active **Role → Goal → Project** branch, create the tasks you intend to do, and
commit to them.

The page has **two modes over one hierarchy**, and only the calendar moves between them:

```mermaid
flowchart LR
  A["Plan mode<br/>build the week"] -->|"Commit to this week"| B["Review mode<br/>progress vs commitment"]
  B -->|"add more work"| B
  B -->|"next Monday arrives"| A
```

There is no save, no close, no archive, and no "mark week done". **The only thing that ends a
week is time.** When the Monday boundary passes in your saved timezone there is no commitment
for the new week, so the page is back in Plan mode. Last week's record stays in the database
exactly as it was.

---

## The two sources of truth

Weekly Plan reads two different things and must not confuse them:

| | What it answers | Where it lives |
| --- | --- | --- |
| **The task** | What is true *now* — title, dates, duration, completion | `taskInfo` |
| **The commitment** | What you *said you would do* on Monday | `weeklyPlanInfo` |

The commitment is a **snapshot**. It is what makes the review honest: a task you promised and
then deleted still appears, because deleting the task does not un-promise the work. If the
page rendered only live tasks, a week could be "cleaned up" into looking successful.

Status is **derived, never stored** — the same rule Compass uses for active/ended. Completing
a task on Calendar is therefore immediately correct here, with nothing to keep in sync.

---

## Plan mode

Before this week has a commitment:

1. Read each role's description and its goals.
2. Review each started project and the tasks already due this week.
3. Open **Other active tasks** to avoid duplicating work due outside the week.
4. Open **Completed last week** for context from the previous Monday–Sunday.
5. Add the concrete tasks that should be due this week.
6. Uncheck anything you do not actually intend to commit to.
7. Choose **Commit to this week**.

Every in-week project task is checked by default. Unchecking excludes it from the commitment
and changes nothing about the task itself.

Committing records the snapshot and switches the page to Review mode without a reload.

## Review mode

Each project that had committed work shows a progress block above its live tasks:

```text
     Migration plan                        3 of 5 done · 2h of 3h 30m
       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░
       ✓ Draft migration plan              done Tue
       ● Write the cutover runbook         due Fri · 45m
       ↷ Book the maintenance window       moved to Apr 24
       ✗ Old spike task                    removed
       ─────────────────────────────────────────────────
       added since commit    [Update commitment]
       + Handle the rollback question      Thu · 30m
```

| Status | Meaning | Derived from |
| --- | --- | --- |
| `open` | Still due this week and not finished | live task inside the week |
| `done` | Completed | `completed` is true |
| `moved` | Due date now outside Monday–Sunday | live plan date outside the week |
| `removed` | The task no longer exists | no live task for `taskRef` |

A committed item is shown even when the live task is gone from the page entirely. A committed
task whose due date moved outside the week is reported once, as `moved` — it is deliberately
kept out of the project's **Other active tasks** list so the same work is never counted twice.

**Added since commit** lists this week's project-linked tasks that are not in the snapshot.
**Update commitment** folds them in; each item records its own `addedAt`, so the review can
always distinguish the original promise from work added later.

Quick add stays available in both modes. Adding a task after committing is normal.

### Amending is additive

Re-committing **only ever adds**. Existing items are kept exactly as snapshotted, and
re-sending an already-committed id is a no-op that neither duplicates the item nor rewrites
its `addedAt`. This is deliberate: a commitment is a promise, so amending the plan must not
be a way to quietly delete a promise you did not keep.

`committedAt` is preserved across amendments; `amendedAt` records the most recent change.

### Previous-week recap

When a plan exists for the previous Monday–Sunday, Review mode opens with a one-line recap:
**Last week: committed 7, finished 5, 2 slipped**. Expanding it shows the same status list,
read-only. When no previous plan exists the band is absent rather than showing zeros.

This is distinct from the per-project **Completed last week** disclosure, which answers a
different question: what actually got finished, whether or not it was planned.

---

## The layout

One column, capped at 1100px, with depth carried by rhythm and colour rather than nested
boxes:

- **Roles are sections**, introduced by their derived colour bar. Separation is spacing and a
  hairline rule, not a raised panel.
- **Goals are labelled dividers**, not containers.
- **Projects are the only panels**, and they are uniform — identical width, padding, and
  radius, so a column of them reads as one rhythm. This is the level you act on.
- **Tasks are dense rows** with right-aligned tabular due day and duration, so they line up
  vertically down the whole page.
- The header is a **sticky week bar** carrying the range, totals, a seven-segment Mon–Sun load
  strip, and the primary action.
- **Quick add is collapsed** to `+ Add a task` per project and expands in place.

Do not reintroduce a multi-column `auto-fit` grid. Role cards sized independently produce a
ragged staggered page whose column heights depend on how many goals each role happens to have.

The quick-add form uses seven day chips for the due date, backed by a visually hidden native
`type="date"` input that remains the accessible source of truth and enforces the week range.

---

## What counts as this week

A task belongs to the week when its civil plan date is inclusively between the current Monday
and Sunday. For an ordinary task that is `dueDate`; for a generated recurrence occurrence the
server uses `occurrenceDate` and the client uses its scheduled date.

The range is based on the user's persisted IANA timezone, not the browser's. The client first
derives today's strict `YYYY-MM-DD` date in that zone and then performs calendar-date
arithmetic.

`mondayWeekBounds()` exists in both temporal modules:

- `utils/temporal.js` returns civil bounds plus timezone-aware instants for the server.
- `webinterface/src/utils/temporal.js` returns civil bounds for the page.

| Field | Meaning |
| --- | --- |
| `startDate` | Monday, inclusive |
| `endDate` | Sunday, inclusive |
| `nextStartDate` | Following Monday, useful as an exclusive upper bound |

The backend's older `localWeekBounds()` keeps Sunday as its default because
`GET /api/getUserEvents/:date` and the Calendar week rely on that contract.

Never compare these dates by inventing UTC offsets or advance them with fixed milliseconds.

---

## Data model

One document per user per week, in `weeklyPlanInfo`, keyed on the Monday civil marker:

```js
WeeklyPlanDetail {
  userRef, weekStart, weekEnd, timeZone, committedAt, amendedAt,
  items: [{ taskRef, projectRef, title, duration, dueDate, seriesRef, addedAt }]
}
```

`WeeklyPlanDetail.index({ userRef: 1, weekStart: 1 }, { unique: true })` enforces one plan per
week. `weekStart`, `weekEnd`, and each item's `dueDate` are civil-date markers written through
`parseDateOnly()` and serialised back with `dateOnlyFromMarker()`, exactly like task dates.

No status field exists, and `taskInfo` gained no new field. Deleting a task never touches a
plan document.

---

## Endpoints

House conventions apply: mounted under `/api`, `authenticateSession`, failures are HTTP 200
with `{ success: false, log }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/getWeeklyPlans?from=&to=` | Plans in a bounded Monday range, items resolved to a live status. |
| POST | `/api/commitWeeklyPlan` | `{ weekStart, taskIds }` — create or additively amend the current week. |

Both return the same `plans` shape, so the client applies one reducer to a read and to a
commit response.

`getWeeklyPlans` requires both bounds, requires each to be a Monday, and refuses a range wider
than 8 weeks — bounded like `getProjectCompletions`, because plans accumulate forever. The page
asks for the previous and current Monday in one call.

`commitWeeklyPlan` accepts **only the current week's Monday** for the caller's saved timezone.
Committing a past or future week is refused, which is what removes the need for week
navigation and makes last week's record permanent. Every new `taskId` must belong to the
caller and be due inside the week; anything else is refused with a clear `log` rather than
silently omitted. Omitting `taskIds` snapshots every project-linked task currently in the week.

The page also reads:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/getCompass` | Live roles with goals and projects. |
| `GET /api/getUserTasks` | Incomplete tasks and materialised occurrences. |
| `GET /api/getProjectCompletions` | Previous-week completion history. |

and writes through `POST /api/createTask` and `POST /api/setTaskProject`.

A Compass or task read failure is shown with a full-page retry. A plan read failure gets its
own inline retry and **must not present a committed week as uncommitted**. A completion-history
failure is likewise non-blocking.

---

## Relationship to scheduling

Committing records intent. It does not reschedule, reprioritise, reserve capacity, rewrite
task dates, or run the scheduler. After creation a task behaves exactly like one created on
Calendar. Compass scheduling influence remains a separate, higher-risk feature.

---

## Work on Weekly Plan

| File | Role |
| --- | --- |
| `webinterface/src/views/WeeklyPlan.vue` | The page. Owns all state and every mutation. |
| `webinterface/src/components/WeeklyProjectCard.vue` | One project panel. Presentation only; emits events. |
| `webinterface/src/components/WeeklyCommitmentProgress.vue` | Committed items, progress bar, added-since list. |
| `webinterface/src/components/TaskEditor.vue` | The shared editor, used by Calendar too. |
| `controllers/weeklyPlanController.js` | Commit and status derivation. |
| `routes/weeklyPlan.js` | The two endpoints. |

Page state stays local rather than expanding the auth-focused Vuex store. Quick-task form
state is keyed by project id so one draft cannot clear another; the child components never
mutate the form prop, they emit `update-field`.

The client sends **only additions** when committing. It never re-sends already-committed ids,
because a `removed` item has no live task and a `moved` item would fail the in-week check.

Tests:

- `tests/api/weeklyPlan.spec.js` — two specs covering what is unique to commitments: status
  derivation from the live task (including ownership), and additive amendment.
- `tests/ui/weeklyPlan.spec.js` — hierarchy review, quick creation, commit and review, folding
  in later work, the previous-week recap, plan-read failure, narrow screens, saved timezone.
- `tests/api/temporal.spec.js` — Monday bounds across DST and year boundaries.
- `tests/api/tasks.spec.js` — the bounded completion-history query.

Run a focused check while iterating:

```bash
npm test -- --project=ui tests/ui/weeklyPlan.spec.js
npm test -- tests/api/weeklyPlan.spec.js
```

Run `npm test` before shipping.
