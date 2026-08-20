# Show where the selected tasks land in a multi-slot What if?

Selecting several slots for the blocked-slot forecast under-reports the damage. With five slots selected the panel lists only the two downstream tasks, even though seven tasks move. The five tasks the user explicitly asked about — the ones that move furthest and are most likely to go late — are computed correctly and then silently dropped before rendering.

## Reproduction

Run the real planner (`controllers/schedulePlanner.js`) over seven 4-hour tasks, all eligible Monday and due Friday, so the baseline packs two per day. Block the first five baseline slots the way `simulateBlockedSlots()` does and diff against the baseline:

```
  SELECTED  task1  2026-01-05 -> 2026-01-07   MOVED  [HIDDEN from panel]
  SELECTED  task2  2026-01-05 -> 2026-01-08   MOVED  [HIDDEN from panel]
  SELECTED  task3  2026-01-06 -> 2026-01-08   MOVED  [HIDDEN from panel]
  SELECTED  task4  2026-01-06 -> 2026-01-09   MOVED  [HIDDEN from panel]
  SELECTED  task5  2026-01-07 -> 2026-01-09   MOVED  [HIDDEN from panel]
  downstrm  task6  2026-01-07 -> 2026-01-12   MOVED  [shown in panel]
  downstrm  task7  2026-01-08 -> 2026-01-12   MOVED  [shown in panel]

  Tasks that actually move : 7
  Rows the panel renders   : 2
```

Seven tasks move; the panel shows two. That is exactly the reported symptom.

## Root cause

`simulateBlockedSlots()` in `controllers/scheduling.js` excludes every selected task from the result:

```js
const affected = context.baselineTaskIds
    .filter((id) => !selectedIds.has(id) && context.taskById.has(id))
```

The premise-exclusion rule is right for the cached single-task chip. That chip answers "if I lose *this* slot, who else gets hurt?", so the selected task's own move is the question, not the answer, and the user is already looking at its row.

Task 00063 carried the rule into the multi-slot path unchanged — its acceptance criteria say selected tasks are "excluded from downstream totals **and cascade rows**". At premise size one that hides one row the user does not need. At premise size five it hides most of the answer: the replan pushes all five selected tasks days later and, in the repro above, every one of them past its deadline, none of which is visible or counted anywhere. The summary then reads "2 downstream tasks move later", which the user reasonably reads as "only 2 tasks affected".

The scheduling math is correct — `simulateBlockedSlots()` already knows where each selected task lands. This is a reporting bug.

## Approach

Keep the premise/downstream distinction, which `docs/TASK_SLIP_FORECAST.md` justifies at length and the existing specs pin down. Stop throwing the premise outcomes away.

### 1. Return the premise outcomes (`controllers/scheduling.js`)

`simulateBlockedSlots()` gains a `selectedImpacts` array: the same `serializeImpact()` rows, built for the selected ids, in the caller's selection order.

Leave `affected`, `movedCount`, and `newlyLateCount` exactly as they are — downstream-only. The documented contract, the cached chip, and the `9 downstream / 1 newly late` and `4 moved / 0 late` assertions in `tests/ui/calendar.spec.js` must not shift.

A selected task has no baseline row to diff against only if it was not scheduled, and the endpoint already filters those out, so every selected id yields a row.

### 2. Render a selected-slots section (`webinterface/src/views/Calendar.vue`)

Above the existing cascade, add a section listing each selected task as `current day → forecast day`, reusing the cascade row markup, marking **Late** rows and **Unscheduled** where a premise cannot be placed at all. Give it its own summary line (`5 selected tasks move later`) so it reads as a distinct answer rather than merging into the downstream count.

- Render it whenever a forecast is active, including the single-slot panel, so both sizes tell the same story and the panel never contradicts itself.
- `selectedImpactForTask()` should consult `selectedImpacts` as well, so a premise that goes late picks up `forecast-newly-late-task` in the sidebar instead of only the neutral `forecast-selected-task`.
- Reuse the existing title truncation and hover tooltip.

No change to selection, staleness, the add/remove chips, or the close behaviour.

## Verify

The multi-slot path has no automated coverage today — `docs/TASK_SLIP_FORECAST.md` says so explicitly — so this ships the regression test and closes that gap.

**`tests/api/scheduling.spec.js`** — on seeded `slipuser`, a multi-id `POST /api/analyzeBlockedSlots` returns a `selectedImpacts` row for every id sent, each with the baseline and forecast placement, and `affected` still contains none of them. A one-id request still matches that task's cached chip exactly.

**`tests/ui/calendar.spec.js`** — open a forecast, add several slots, **Analyze**, and assert every selected task appears with its forecast day, that the downstream cascade is unchanged, and that selected-plus-downstream accounts for every task that moves. Assert the panel still writes nothing.

Guard the existing behaviour: the single-slot `slipuser` and `boundaryuser` specs must pass untouched.

While iterating: `npm test -- -g "blocked slot"`, then `npm test -- tests/api`. Full `npm test` before commit.

## Documentation

Update `docs/TASK_SLIP_FORECAST.md`. These statements are now wrong and must be corrected rather than deleted, since the totals really do stay downstream-only:

- "The selected task is highlighted separately and is not a cascade row."
- "Every selected task is a premise, so all of them are highlighted and none of them appear as cascade rows."

Replace with: selected tasks appear in their own section with their own placements, and remain excluded from the downstream moved and newly-late totals. Note that a selected task can itself become late, and that this is shown but not counted as downstream damage.

## Acceptance criteria

- Selecting five slots and analyzing shows all five selected tasks with their new placements, plus the two downstream rows — seven visible movements for the repro above.
- Selected tasks that cross their deadline are marked **Late** in the panel and highlighted in the sidebar.
- `movedCount` and `newlyLateCount` remain downstream-only; the cached single-task chip is byte-for-byte unchanged.
- The single-slot panel shows the same selected-slot information, so the two premise sizes agree.
- Analysis still writes nothing and still honours only the caller's own scheduled tasks.
- New multi-slot API and UI specs pass, the existing single-slot specs pass untouched, and the full suite is green.
