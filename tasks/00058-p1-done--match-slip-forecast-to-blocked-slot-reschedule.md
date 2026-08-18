# Make the task-slip forecast match a blocked-slot reschedule

## Diagnosis

The current forecast does not model the requested scenario. For a selected task it fixes earlier work, leaves all capacity from the task's original start unused, waits until the same wall time on the next civil day, and only then replans a candidate-window suffix. In the seeded packed week this discards a full day of usable capacity and reports two newly late tasks.

The behavioral oracle must instead be exactly this hypothetical operation:

1. Keep the selected task incomplete.
2. Replace its generated task slot with an ordinary blocking calendar event covering the same start and end.
3. Remove the generated task events, as normal scheduling does.
4. Run **Schedule Tasks** again over the normal task set and calendar conflicts.
5. Compare that result with the baseline schedule to identify moved work and tasks that newly finish after their due dates.

For the existing seeded example, blocking the first Monday task's 10:00–13:30 slot still leaves Monday 13:30–17:00 available. The selected task moves into that slot, each later task shifts by one slot, and only the final Friday task moves to the following Monday. The correct downstream result is therefore one newly late task, not two.

## Scheduling change

Update the forecast orchestration in `controllers/scheduling.js` while continuing to use the shared pure planner in `controllers/schedulePlanner.js`:

1. Build in-memory calendar conflicts from the selected task's persisted generated placement. For a chunked selected task, block each generated chunk so the hypothetical means none of its allocated work was completed. Do not persist these synthetic conflicts.
2. Replan the complete normal scheduling task set from the same scheduling-run start instant and with the same horizon, user working settings, recurrence behavior, and non-task calendar events as a real immediate rerun. Do not delay `currentTime` until tomorrow, freeze a special prefix, or restrict planner input to the forecast-candidate suffix.
3. Compare each baseline task's first and final placement with the hypothetical plan. Deadline status continues to use the final placement's civil date in the user's saved timezone; an unplaceable task is late. Treat a task as moved when its first or final placement changes or it becomes unplaceable, so chunked completion movement cannot be missed.
4. Preserve the existing downstream presentation contract: the selected task drives the simulation and is highlighted separately, but is not included in downstream `movedCount`, `newlyLateCount`, or cascade rows.
5. Keep the existing cap on which scheduled tasks receive a cached forecast, but do not let that cache-candidate cap change the planner's task queue. Keep forecast calculation non-destructive and keep `scheduledDate`, generated events, and cached forecasts as one scheduling snapshot.
6. Remove the obsolete same-wall-time-next-day forecast path. Continue to use temporal helpers for schedule starts, horizons, and civil due-date comparisons; do not introduce offset or millisecond-based calendar arithmetic.

## Calendar wording

Update `webinterface/src/views/Calendar.vue` so the UI describes the calculation it actually performs rather than claiming that the queue restarts tomorrow:

- replace literal `+1 day` / “slip one day” wording with concise missed/blocked-slot wording;
- explain that another event occupies the selected task's planned time and then all incomplete tasks are scheduled again;
- retain the downstream moved/newly-late summary, cascade, accessibility, keyboard behavior, visual states, and “nothing is saved” guarantee.

Update `docs/TASK_SLIP_FORECAST.md` to define the blocked-slot oracle, full normal replanning input, chunk behavior, deadline comparison, selected-task exclusion, cache lifecycle, and read-only preview behavior. Remove statements that intentionally leave the abandoned capacity empty or restart the queue tomorrow.

## Exact regression scenario

Edit the existing mixed-capacity Calendar test in `tests/ui/calendar.spec.js`; do not rely on a second approximate planner-only test.

The test must exercise and compare both sides of the requested scenario:

1. Generate the seeded `slipuser` baseline schedule and capture the first task's cached forecast and generated slot.
2. Assert the preview predicts nine downstream tasks moving and exactly one newly late task. The final Friday task moves to recovery Monday; the other Friday task remains on Friday and on time.
3. Through the normal authenticated event API, create a real calendar event with exactly the selected task event's baseline start and end.
4. Press the Calendar page's **Schedule Tasks** button again.
5. Read the resulting generated task events and prove they do not overlap the blocker.
6. Compare the previously cached hypothetical result with the actual rerun: downstream task ids, first placement timestamps, final completion/deadline states, and the newly-late id set must agree. Also prove the selected task itself was rescheduled but remained excluded from downstream totals.
7. Retain the existing checks that merely opening/reloading a preview does not mutate tasks or events, zero-impact forecasts do not render controls, and the forecast panel remains keyboard accessible.

This makes the requested user operation—not an independently invented expected count—the regression oracle.

## Verification

- Run the focused mixed-capacity Calendar Playwright test while iterating.
- Inspect its forecast screenshots after updating the wording and expected result.
- Run the full `npm test` suite only during finalization.

## Acceptance criteria

- A forecast is observationally equivalent to occupying the selected task's generated slot(s) with calendar event(s) and immediately running normal scheduling again.
- The seeded packed-week forecast reports one newly late downstream task, matching the real blocker-and-rerun result.
- Forecast planning includes the same task queue and scheduling inputs as the real run; the forecast-candidate window only controls which tasks receive cached previews.
- Chunked tasks are evaluated by final completion as well as first placement.
- The UI and documentation no longer describe a next-day restart that the implementation does not perform.
- Preview interaction remains non-destructive, and the focused regression plus full suite pass.
