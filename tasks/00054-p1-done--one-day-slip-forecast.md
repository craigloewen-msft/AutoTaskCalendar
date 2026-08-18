# Visualize the cascade from letting a task slip one day

## Outcome

Add a non-destructive **one-day slip forecast** to the Calendar task sidebar. It must answer the misleading situation where a task scheduled Monday and due Friday appears to have several safe days, even though the remaining week is already at capacity.

The forecast augments the existing scheduled-date/deadline badge; it does not change task dates, complete work, or reschedule the persisted calendar.

## Product contract

### Meaning of “slip one day”

For a scheduled task:

1. Keep task work scheduled before the selected task fixed, as though it was completed as planned.
2. Treat the selected task and the remaining scheduled queue as not started until the same local wall time on the next civil day.
3. Reflow that remaining work with the real scheduler rules: saved timezone, working days and hours, calendar conflicts, task eligibility, priority, dependencies, and chunking.
4. Count a newly missed deadline when work that completes on or before its civil due date in the current schedule would complete after that date—or become unplaceable—under the forecast.

This deliberately models the capacity lost by waiting. Merely making the selected task ineligible while allowing every later task to fill its abandoned slot would hide the cascade the feature exists to expose.

Use calendar/timezone helpers for the next-day wall time; never add a numeric UTC offset or fixed 24-hour duration.

### Scope and safety

- Forecast only tasks with a generated schedule. Backlog and currently unscheduled tasks keep their existing treatment.
- Use the last generated schedule as the baseline, so the indicator appears after **Schedule Tasks** has produced task events.
- The preview is read-only. It must not update `scheduledDate`, task records, task events, calendar events, recurrence records, or user settings.
- Existing already-late work may be shown as later, but the headline count distinguishes deadlines newly missed because of this slip.
- A forecast failure is non-blocking: Calendar and task editing continue to work, with the forecast affordance omitted or a quiet retry state rather than false “safe” output.

## Visualization

Place the feature in `webinterface/src/views/Calendar.vue`, beside the existing bare days-before-deadline badge that currently makes Monday-to-Friday work look safe.

### At a glance

For each scheduled, non-backlog task with forecast data, show a compact keyboard-accessible `+1 day` impact chip:

- risk state, such as **`+1 day → 2 late`**, in warning/red styling when deadlines would newly be missed;
- safe state, such as **`+1 day → safe`**, in subdued styling when no new deadline is missed;
- an accessible label naming the task and explaining the result.

Clarify the existing numeric date-gap badge with accessible text/title so it reads as days scheduled before the deadline, not spare capacity.

### Expanded cascade

Selecting an impact chip opens a prominent, dismissible **What if?** panel without opening the task editor. The panel must:

- name the selected task;
- summarize how many tasks move later and how many newly miss deadlines;
- state the one-day assumption and that no changes are saved;
- visually mark the selected task, downstream moved tasks, and newly late tasks in the sidebar;
- show each affected task’s current and forecast day (for example, `Mon → Tue` and `Fri → Mon · late`) so the cascade can be scanned rather than inferred from a count;
- remain usable with keyboard controls and at narrow widths.

Click handling on the chip must not trigger the task row’s existing editor action.

## Scheduling implementation

Extract the placement loop in `controllers/scheduling.js` into a side-effect-free planning path (a focused planner module is acceptable). Both persisted scheduling and forecasting must use the same placement logic rather than maintaining a second approximate capacity algorithm.

The planner should accept tasks, non-task calendar events, user working settings, a start instant, and any already-finished prefix; it should return task/chunk placements and completion/scheduled dates. The existing scheduling orchestration remains responsible for recurrence expansion, deleting/replacing generated task events, and persisting `scheduledDate`.

After the real schedule is persisted, calculate forecasts for up to 100 scheduled, non-backlog tasks in Calendar’s visible 14-day window. Store each result in the task’s nullable `slipForecast` scheduler-output field beside `scheduledDate`.

The normal authenticated `GET /api/getUserTasks` payload carries the result. Calendar renders a non-null forecast and does nothing for `null`; there is no forecast endpoint, collection, or page-load simulation.

Treat `scheduledDate`, generated task events, and `slipForecast` as one snapshot. Input edits do not selectively clear forecast fields; the next **Schedule Tasks** run replaces all scheduler outputs together. Compare civil due dates in the user’s saved timezone.

Preserve current scheduler invariants and behavior: working windows, conflict avoidance, dependency order, chunk totals, recurrence handling, unschedulable behavior, and idempotence.

## One Playwright test and screenshots

Add exactly **one** test to `tests/ui/calendar.spec.js` for the complete user-visible contract.

The test will:

1. Seed an isolated UTC user with Monday–Friday, 09:00–17:00 working hours and no tasks/events.
2. Create exactly ten project-linked, four-hour tasks, all starting on the next Monday and all due that Friday. Give them deterministic priorities/titles so they consume exactly five workdays in a stable order.
3. Set the browser clock to that Monday, open Weekly Plan, and assert the exact scenario is visible as `10 tasks · 40h` due that week.
4. Go to Calendar and generate the baseline schedule: two tasks per day, Monday through Friday, all on time.
5. Assert the first Monday task’s at-a-glance chip reports that a one-day slip causes two newly late tasks.
6. Open the chip and assert the expanded forecast shows all ten tasks moving and the final two moving beyond Friday, with the selected/moved/late visual states.
7. Add two buffered follow-ups that keep their slots, stay absent from the risky cascade, and show subtle safe chips.
8. Verify through the database that opening and reloading forecasts do not change baseline `scheduledDate`, `slipForecast` timestamps, or generated task events.
9. Attach two screenshots to the passing Playwright result: the at-a-glance risk/safe chips and the expanded cascade panel. Inspect and report them without committing documentation images.

Do not add a parallel API test. Existing scheduling specs plus this end-to-end UI test cover the shared planner and read-only forecast contract.

## Documentation

Add `docs/TASK_SLIP_FORECAST.md` as the end-to-end manual covering the forecast definition, visual states, endpoint, scheduling reuse, timezone/deadline semantics, read-only guarantee, and limitations. Link it from the Calendar/scheduling context in the existing docs index or relevant manuals.

## Acceptance criteria

- A green “scheduled several days before due” badge can no longer be mistaken for capacity slack when a one-day delay would make downstream work late.
- In the ten-task Monday-to-Friday scenario, the first task visibly reports **2 newly late deadlines** and the expanded preview shows the cascade through all ten tasks.
- Safe tasks receive a distinct non-alarming result; failed/missing forecasts are never presented as safe.
- Forecast and actual scheduling use the same placement engine.
- Previewing has zero persistent side effects.
- Exactly one new Playwright test is added, it passes, and it produces two viewable screenshots.
- Focused verification and the full `npm test` suite pass before final delivery.
