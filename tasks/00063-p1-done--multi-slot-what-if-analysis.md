# Analyze several blocked slots together in one What if?

Extend the blocked-slot forecast so a user can select **several** scheduled tasks and ask what happens if *all* of those slots are lost at once. The answer must equal what they would see by placing ordinary calendar events over exactly those slots and pressing **Schedule Tasks** again — the same oracle the single-task feature already holds itself to.

## Why this is not just adding up the existing chips

Cascades interact. On the seeded `slipuser` week (ten 3½-hour Friday-due tasks, a fixed 09:00–10:00 meeting each weekday, exactly 40 hours of work in 40 hours of capacity):

| Blocked | Downstream moved | Newly late |
| --- | --- | --- |
| Task 01 alone | 9 | 1 (task 10) |
| Task 03 alone | 7 | 1 (task 10) |
| **Tasks 01 + 03 together** | **8** | **2 (tasks 09 and 10)** |

Losing two slots destroys seven hours in a week with zero slack, so a second task crosses the Friday deadline that neither single forecast predicts. Reading two chips and taking the union gives the wrong answer. This is the behaviour to build and the regression to lock down.

## Approach

A combined forecast cannot be precomputed — there is one result per *subset* of tasks — so unlike the cached single-task forecast this is calculated on demand, and stays read-only.

### 1. Extract one simulation oracle (`controllers/scheduling.js`)

`calculateBlockedSlotForecasts()` already does exactly the right thing for one task: build synthetic `calendar` conflicts covering the selected task's generated placements, replan the full normal task queue with the real non-task events, and diff against the baseline. Split it so both callers share one code path:

- `loadForecastContext(user, scheduleStart)` — loads tasks, baseline task events, non-task conflicts, and the series-behaviour map once.
- `simulateBlockedSlots(context, selectedTaskIds, user)` — blocks **every** placement of **every** selected task, replans once, and returns `{ selectedTaskIds, movedCount, newlyLateCount, affected }`.

The existing cache loop calls it once per task with a single id; the new endpoint calls it once with the whole set. Keep reusing `planTaskPlacements()` — no second scheduling engine, no new placement rules, and all selected tasks stay in the queue and are excluded from downstream totals exactly as the one-task premise is today.

The per-run `taskTemporalCache` is shared across simulations today; keep that, and keep the `setImmediate` yield in the cache loop so a 100-task scheduling run still does not block the event loop.

### 2. Anchor the rerun to the schedule it is comparing against

The simulation must start from the instant the baseline schedule was generated, or capacity between then and now differs and the diff is meaningless. Today that instant is passed in-process and never stored, which is fine for the cached path but not for an endpoint called minutes or hours later.

Persist it: add `lastScheduleRunAt` to the user, written by `generateTaskEvents()` alongside the schedule it describes. When it is missing, the endpoint fails honestly ("Run Schedule Tasks first") rather than returning a confidently skewed answer.

### 3. `POST /api/analyzeBlockedSlots` (`routes/tasks.js`)

Authenticated like its neighbours, takes `{ taskIds: [...] }`, returns the summary above.

- Ignores ids that are not the caller's, are unscheduled, or are unknown — a task id alone must never reach another tenant's data.
- Rejects an empty selection and caps the selection (10) so one request cannot block a slot per task in the database.
- Writes nothing. No new collection, no cached field, no schedule mutation.

### 4. Selection and results in the sidebar (`webinterface/src/views/Calendar.vue`)

Keep the current one-click chip untouched — it is the fast path and the user likes it. Add multi-select beside it:

- A **Compare slots** toggle above the task list turns on a checkbox per task with a valid scheduled date. Off by default, so the normal sidebar is unchanged.
- A sticky bar shows `N slots selected`, **Analyze together**, and **Clear**.
- The result reuses the existing `.slip-forecast-panel` with a plural heading ("if these 2 slots are lost"), the same moved/newly-late summary, the same `current day → forecast day` cascade with **Late** markers, and the same sidebar highlighting — with every selected task highlighted as a premise.
- Changing the selection after analyzing discards the stale result and asks for **Analyze together** again, so the panel never describes a selection that is no longer on screen.
- Loading and failure states are explicit; a failed analysis says so instead of showing an empty cascade.

Calendar-grid clicks keep meaning "edit this task" — selection lives only in the sidebar. Worth a second opinion, but overloading grid clicks would break an existing gesture.

## Verify

Per `docs/TESTING.md`, two focused specs rather than parallel coverage of the same rule.

**`tests/ui/calendar.spec.js` — the oracle the feature is judged by.** On seeded `slipuser`: schedule, select tasks 01 and 03, analyze, and assert 8 moved / 2 newly late including task 09 — the row neither single chip predicts. Then create two *real* calendar events over exactly those two baseline slots, press **Schedule Tasks**, and prove the real rerun agrees on the moved id set, each task's forecast start/end, and the newly-late set. Also assert no generated event overlaps either blocker and that analyzing changed no task or event data.

**`tests/api/scheduling.spec.js` — the contract.** A one-id request through the endpoint returns exactly the cached `slipForecast` for that task (single and multi paths cannot drift), foreign and unknown ids are ignored, an empty selection is refused, and a request before any scheduling run fails cleanly.

While iterating: `npm test -- -g "blocked slots"`. Full `npm test` only at the end.

## Screenshots for review

Drive the real dev stack in a browser and capture, at desktop width:

1. The sidebar with **Compare slots** on and two tasks checked.
2. The combined **What if?** panel showing 8 moved / 2 newly late with both **Late** rows.
3. The single-task panel for task 01 beside it, showing 1 late — the visual proof the combination is worse than either part.
4. The real calendar after blocking both slots and rescheduling, matching the forecast.

## Documentation

Update `docs/TASK_SLIP_FORECAST.md`: the multi-slot selection flow, why combined impact is not the union of individual forecasts (with the table above), the on-demand-vs-cached distinction and why `lastScheduleRunAt` anchors it, the selection cap, and the read-only guarantee. Remove the current "evaluates one selected task at a time" limit.

## Acceptance criteria

- Selecting several scheduled tasks and analyzing them returns the same moved set, per-task placements, and newly-late set as blocking exactly those slots with real events and rescheduling.
- Seeded tasks 01 + 03 report 8 downstream moved and 2 newly late, proving combined impact exceeds the union of the individual forecasts.
- A single-task analysis through the endpoint matches that task's cached chip exactly.
- Selected tasks are premises: highlighted, excluded from downstream totals and cascade rows.
- Analyzing writes nothing; ids belonging to other users are never honoured.
- The existing single-click chip and panel behave exactly as they do today.
- Focused specs and the full suite pass, and the screenshots above are attached for review.
