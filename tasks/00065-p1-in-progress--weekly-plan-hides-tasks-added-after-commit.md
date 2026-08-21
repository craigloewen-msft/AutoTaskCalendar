# Weekly Plan renders nothing for a project with no committed work

A task created mid-week with a project never appears on Weekly Plan. It is not "missing"
from any query - the page loads it, counts it in the panel header, and then renders zero
rows for it. Two `v-if`s in `WeeklyProjectCard.vue` each assume the other one covers this
week's live tasks, so in Review mode a project with an empty commitment displays an empty
body.

## Reproduction

It is Friday. The week was committed on Monday. A task is created on Calendar and assigned
to a project (the suggestion row is irrelevant - it just sets `projectRef`).

Replaying the exact render decision from `WeeklyPlan.vue` (`tasksForProject`,
`addedTasksForProject`) and `WeeklyProjectCard.vue` (`showWeekList`, the `v-if` chain,
`summaryLabel`) for a task due Fri 2026-01-09 in project `beta`:

```text
A. Plan mode (week not committed)
  panel header : "1 task(s) - 45m"
  panel rows   : - this week: Handle the rollback question
  visible? YES

B. Review mode, project ALREADY had committed work
  panel header : "1/1 done"
  panel rows   : - committed: Earlier beta task [done]
                 - added since commit: Handle the rollback question
  visible? YES

C. Review mode, project had NO committed work        <-- reported bug
  panel header : "1 task(s) - 45m"
  panel rows   : (none - panel body is empty)
  visible? >>> NO <<<

D. Review mode after an EMPTY commit                 <-- every project, all week
  panel header : "1 task(s) - 45m"
  panel rows   : (none - panel body is empty)
  visible? >>> NO <<<
```

The header still reports `1 task - 45m` while the body is empty: the panel contradicts
itself, which confirms the data is present and only the rendering drops it.

Nothing else on the page catches the task either. It has a `projectRef` inside the active
Compass under a started project, so it is not in **Unaligned**, **Outside active Compass**,
or **Someday**. It is due this week, so it is excluded from **Other active tasks**. It is
not in the snapshot, so it is not a committed row. The task is in `taskList` and in no
rendered list anywhere - exactly "I even searched the source and don't see it".

## Root cause

`webinterface/src/components/WeeklyProjectCard.vue`:

```vue
<WeeklyCommitmentProgress v-if="committedItems.length" :added="addedTasks" ... />

<ul v-if="showWeekList && weekTasks.length"> ... this week's live tasks ... </ul>
```

```js
// After committing, the progress block already lists this week's work.
showWeekList() { return !this.committed; },
```

The live list steps aside for the progress block, and the progress block only exists when
the project has committed items. "Added since commit" - the one list designed to hold a
task created after Monday - lives *inside* the block that was never rendered. When
`committedItems.length === 0` both branches are false and the project's in-week tasks have
no home.

The comment on `showWeekList` is the whole bug: "the progress block already lists this
week's work" is true only for a project that has a commitment.

This contradicts `docs/WEEKLY_PLAN.md`, which states without qualification that **Added
since commit** "lists this week's project-linked tasks that are not in the snapshot". The
documented contract is right; the implementation drops a case.

### Why it is easy to hit and hard to see

- **Case C** needs only one project that had nothing due this week on Monday. Committing
  the week is enough; the project silently stops rendering new work until next Monday.
- **Case D** is worse: pressing **Commit to this week** while nothing is selected creates a
  plan with `items: []`, and *every* project panel goes blank for the rest of the week.
- There is no error, no empty state, and no console warning. `Nothing planned for this week
  yet.` is also suppressed, because its `v-else-if` is gated on `showWeekList` too. The
  panel just ends after its header.

## Fix

Keep the documented design - an out-of-snapshot task belongs in **Added since commit**,
with its **Update commitment** button - and stop gating that list on the snapshot being
non-empty.

### 1. `webinterface/src/components/WeeklyProjectCard.vue`

Render the progress block when there is anything to report:

```vue
<WeeklyCommitmentProgress v-if="committedItems.length || addedTasks.length" ... />
```

Correct `showWeekList` and its comment so the live list is the fallback whenever no
progress block was rendered, rather than whenever the week is uncommitted. That also
restores `Nothing planned for this week yet.` for a genuinely empty committed project.

### 2. `webinterface/src/components/WeeklyCommitmentProgress.vue`

Tolerate an empty `items` array: skip the `Committed` head, the score, the progress bar,
and the committed list when there is nothing committed, so the block never reads
`0 of 0 done - 0m of 0m`. The **Added since commit** section and its **Update commitment**
button render as they do today.

### 3. Make the header stop lying

`summaryLabel` falls through to the live-task branch in Review mode when the project has no
committed items, so it reads `1 task - 45m` next to panels reading `0/3 done`. In committed
mode report the commitment when one exists and the added count otherwise, so the header and
the body always agree. `roleSummary()` in `WeeklyPlan.vue` has the same gap - it returns
`nothing committed` for a role whose projects hold only added-since-commit work.

Leave the week bar totals and the day-load strip alone: in Review mode those measure the
commitment, which is the documented contract.

### Out of scope

No server change. `commitWeeklyPlan` creating an empty plan is legitimate ("I commit to
nothing this week"), and with this fix the week stays fully usable afterwards. Scheduling,
recurrence, and the commit/amend semantics are untouched.

## Verification

The fix is pure client-side rendering, and per `docs/TESTING.md` the Vue front end has no
automated coverage since the flaky `tests/ui` suite was removed, so this ships with a
recorded manual walkthrough rather than a spec:

1. `npm run seed && npm run dev`, log in, open `/weekly-plan`.
2. Uncheck every task, press **Commit to this week** (creates the empty plan - case D).
3. On `/calendar`, add a task due today and give it a project via the suggestion row.
4. Return to `/weekly-plan`: the task appears under **Added since commit** in its project,
   with **Update commitment**; the panel header matches the body.
5. Press **Update commitment**: the task moves into the committed list as `open`.
6. Repeat with a project that already had committed work (case B) to confirm no regression,
   and with an uncommitted week (case A) to confirm the plain week list still renders.

`npm test` must still pass before commit - the API suite should be untouched by this.

If you would rather have an automated guard, say so and I will extract the panel's
visibility rule into a small pure module and pin cases A-D from a spec; that is a slightly
larger change than the `v-if` fix itself, which is why it is not the default here.

## Docs

`docs/WEEKLY_PLAN.md` already describes the correct behaviour. Add one sentence to the
Review mode section making it explicit that a project with no committed work still shows
its added-since-commit tasks, so the next reader does not reintroduce the shortcut.
