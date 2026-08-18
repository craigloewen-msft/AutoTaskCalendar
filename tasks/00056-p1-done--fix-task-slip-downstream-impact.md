# Fix one-day slip forecasts to report downstream impact only

## Diagnosis

The cached one-day forecast currently includes the selected task in both the simulated suffix and the serialized `affected` list. Keeping it in the suffix is necessary: its postponed work must consume future capacity before later work is placed. Including it in `affected` is the bug.

When a task is scheduled on its due date, postponing it makes that same task late. `serializeImpact()` marks it `newlyLate`, and `calculateOneDaySlipForecasts()` includes that row in `newlyLateCount`. Consequently, an isolated task with no work behind it reports `+1 day → 1 late`, even though it harms no downstream task.

The selected task is the premise of the forecast, not one of its downstream effects. The existing date-gap badge already communicates the selected task's own deadline relationship.

## Seeded capacity calendar

Add a dedicated `slipuser` / `testpassword` scenario to the shared seed dataset so developers and the UI test exercise the same inspectable calendar:

- UTC, Monday–Friday, 09:00–17:00 working settings.
- In the next complete Monday–Friday week, create one fixed 09:00–10:00 calendar event per day.
- Create ten deterministic 210-minute tasks, all eligible Monday and due Friday. Two tasks fill each day's remaining seven hours, so the five events plus 35 task-hours consume all 40 working hours exactly.
- In the following otherwise-empty week, create one isolated 60-minute task that is eligible and due on Friday. This reproduces the false `1 late` result without any downstream work.
- Give the capacity tasks a small Compass project so Weekly Plan can continue proving their exact weekly workload.
- Return the scenario's users, tasks, events, dates, and project through stable seed fields; document the account and calendar in `docs/SEEDING.md` and `docs/TEST_CREDENTIALS.md`.

This shape proves that any additional positive-duration task or working-hours event would overflow the first week, while the next week has ample recovery capacity.

## Forecast correction

In `controllers/scheduling.js`:

1. Continue including the selected task in the suffix passed to `planTaskPlacements()` so its delayed work drives the real cascade.
2. Exclude the selected task's id when building downstream `affected` impacts.
3. Derive `movedCount` and `newlyLateCount` only from those downstream impacts.
4. Preserve calendar conflicts, task ordering, chunk completion semantics, recurrence behavior, timezone-safe next-day calculation, forecast caching, and the read-only schedule snapshot contract.

The expected semantics are:

- A selected task becoming late by itself does not produce `N late`.
- A later queued task crossing its deadline does produce `N late`.
- Existing late downstream work remains excluded from the newly-late count.
- The selected task can still be highlighted separately in Calendar, but it is not a cascade row or headline count.

Update `docs/TASK_SLIP_FORECAST.md` to explicitly define the chip and expanded panel as downstream impact, excluding the selected task itself.

## Update the single task-late UI test

Replace the inline ten-task/two-buffer fixture in the existing Calendar deadline-cascade Playwright test; do not add a parallel forecast test.

Use the shared `slipuser` calendar and assert:

1. Weekly Plan shows the ten Friday-due tasks and their exact 35 task-hours.
2. The generated baseline avoids all five fixed events, places exactly two capacity tasks on each weekday, keeps every capacity task on time, and places the isolated task on the following Friday.
3. The first Monday task reports `+1 day → 2 late`.
4. Its panel reports nine downstream tasks moving, omits the selected task from the cascade, and shows the final two Friday tasks moving to the following Monday and newly missing Friday's deadline.
5. The final task in the packed week reports `+1 day → safe` because only that selected task becomes late and the isolated later task is unchanged.
6. The isolated following-Friday task also reports `+1 day → safe`, directly regressing the reported one-task bug.
7. Opening and reloading the preview leaves task scheduled dates, forecast timestamps, generated task events, and fixed calendar events unchanged.
8. Existing screenshot attachments continue to capture the at-a-glance chips and expanded cascade.

## Verification

- Run the focused Calendar deadline-cascade test while iterating.
- Run the full `npm test` suite only during finalization.
- Inspect the two Playwright screenshot attachments and report the result.

## Acceptance criteria

- The shared seed exposes a full mixed task/event week followed by a spacious week under documented credentials.
- An isolated selected task cannot count itself as `1 late`.
- Risk chips count only later tasks whose deadlines are newly harmed by the selected slip.
- The packed-week cascade remains planner-driven and reports the two genuine downstream deadline misses.
- No forecast interaction mutates the persisted schedule or calendar.
- The updated single UI regression and full suite pass.
