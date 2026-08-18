# Count only due-date crossings as late in blocked-slot forecasts

## Confirmed diagnosis

The blocked-slot planner already compares the final completion day of a placed task with its civil due date. The false warning comes from the other branch: `finishesAfterDue()` in `controllers/scheduling.js` returns `true` when the hypothetical plan has no placement for a task. An on-time baseline task that becomes unplaced is therefore serialized as `newlyLate`, even though it was not scheduled past its due date.

The Calendar end-to-end oracle repeats the same assumption in its local `isLate()` helper (`!summary` means late). That lets forecast and actual rescheduling agree with each other while both use the wrong definition.

The required definition is:

- a task is late only when its hypothetical final completion has a civil date after its civil due date;
- moving to another time or day on or before the due date is not late;
- having no hypothetical placement is an unscheduled/unplaced impact, not a late task;
- the selected task remains excluded from downstream counts.

## Reproduce first with a shared inspectable dataset

Add a small dedicated blocked-slot boundary scenario to the shared seed data, exposed through stable fields and documented with development credentials. Keep it separate from `slipuser`'s existing packed-week true-late scenario so both calendars remain easy to inspect.

Use a UTC account with Monday–Friday 09:00–17:00 working hours and the next complete workweek:

1. One 360-minute selected task, eligible Monday and due Friday.
2. Five 120-minute downstream tasks with the same eligibility and due date, ordered after the selected task.
3. One ordinary calendar event beginning Wednesday morning and extending beyond the 60-day scheduling horizon, making Monday and Tuesday the only available capacity for this focused scenario.

The generated baseline exactly fills Monday and Tuesday: the selected task plus one downstream task on Monday, then four downstream tasks on Tuesday. Blocking the selected Monday 09:00–15:00 slot causes one downstream task to stay put, the selected task and one downstream task to use Tuesday, and the final three downstream tasks to become unplaced.

Before changing production code, add the focused regression with the correct expectation and run it against the current implementation. It must fail by reproducing the current **`slot blocked → 3 late`** result even though:

- every task that still has a hypothetical placement completes by Friday; and
- the remaining three tasks have no placement rather than a completion after Friday.

Record that failing result in the implementation summary so the reproduction is explicit rather than inferred after the fix.

## Correct the late predicate

In `controllers/scheduling.js`:

1. Replace or rename the current deadline predicate so it returns `true` only when both a forecast placement and a valid civil due date exist and the final completion day in the user's saved IANA timezone is after that due date.
2. Compute `newlyLate` from the baseline and hypothetical placed-task deadline states using that predicate.
3. Keep a missing hypothetical placement as `moved: true` and `unscheduled: true`, so it remains in the downstream cascade and `movedCount`, but never include it in `newlyLateCount` merely because it is absent.
4. Preserve final-chunk completion handling, civil-date/timezone helpers, selected-task exclusion, full-queue replanning, forecast caching, and the non-destructive blocked-slot simulation.

Do not classify movement by elapsed days or by whether a task changed slots. A task may move several calendar days and remain on time when its final completion is still on or before its due date.

## Verify with the same data

Finish the focused Calendar regression by exercising both the forecast and the real user operation on the new seed scenario:

1. Generate the baseline schedule and capture the selected task's cached forecast and exact generated slot.
2. Assert the fixed forecast reports downstream movement but zero late tasks. Its three missing placements must render as **Unscheduled** without a **Late** marker; placed downstream work on or before Friday must also remain non-late.
3. Create an ordinary event over the captured selected slot through the authenticated event API.
4. Run **Schedule Tasks** again.
5. Compare the captured forecast with the actual rerun: moved task ids, forecast placements, and the three unplaced ids must agree.
6. Independently derive the actual late set only from tasks with final placements after their due dates. Assert that set is empty and matches the forecast's newly-late set.

Update the existing test oracle so a missing placement is not itself late. Retain the existing `slipuser` packed-week assertion where the final Friday-due task really completes on recovery Monday and is correctly counted as one late task. Together the two shared scenarios protect both sides of the definition.

## Wording and documentation

Update `docs/TASK_SLIP_FORECAST.md` to remove the rule that an unplaceable task automatically counts as newly late. State that unplaced downstream work remains visible as moved/Unscheduled, while only a forecast completion after the due date receives **Late** and contributes to the headline count.

Update `docs/SEEDING.md` and `docs/TEST_CREDENTIALS.md` with the small reproduction account, its exact two-day baseline, and the expected blocked-slot outcome. If needed, tighten Calendar summary or accessibility wording so it describes tasks scheduled past their due dates rather than implying that every unplaced task is already late.

## Verification

- Run the new focused regression before the fix and confirm it fails with the reproduced count of three.
- Run the same regression after the fix and confirm forecast data, Calendar rendering, and actual blocker/reschedule behavior agree.
- Run the existing mixed-capacity blocked-slot test to retain the genuine one-late positive control.
- Run the full `npm test` suite only during finalization.

## Acceptance criteria

- Only a final hypothetical completion on a civil day after the task's due date is classified as late.
- Moving to another slot or day on or before the due date never counts as late.
- A task with no hypothetical placement is reported as moved and Unscheduled, but not late.
- The new shared dataset reproduces the old `3 late` false positive before the code change.
- With that same dataset after the fix, the cached forecast and an actual blocked-slot reschedule agree on placements, unplaced tasks, and an empty late set.
- The existing packed-week scenario still reports exactly one task whose completion genuinely crosses its due date.
- Focused regressions and the full test suite pass.

## Implementation result

The new boundary regression failed before the production fix with `Expected: 0, Received: 3`; the forecast panel marked three unplaced follow-ups as late. After changing the deadline predicate, the same dataset reports four moved, three Unscheduled, and zero late. Creating the real blocking event and rescheduling produces the same placements and unplaced set as the cached forecast.

The existing packed-week scenario remains the positive control: a task that actually moves from its Friday due date to recovery Monday is still counted as one late task. The focused controls and full 74-test suite pass. Screenshots were captured for the incorrect forecast, baseline schedule, fixed forecast, and actual post-block reschedule calendar.
