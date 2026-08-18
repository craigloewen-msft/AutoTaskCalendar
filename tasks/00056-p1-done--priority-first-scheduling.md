# Enforce priority-first task scheduling

## Problem

A low-priority recurring occurrence using `whenUnschedulableBehavior: 'skip'` can be scheduled before a much higher-priority task and consume the capacity that task needs to meet its deadline.

The recurrence layer is not losing priority: `expandSeries()` copies `priority` from the series template onto every occurrence. The inversion happens after expansion:

- `loadSchedulingTasks()` in `controllers/scheduling.js` sorts regular work by `dueDate` first and `priority` second.
- `findBestTaskForSlot()` in `controllers/schedulePlanner.js` takes the first full candidate and first chunkable candidate from that deadline-first queue, then compares those candidates by due date before priority.
- The task editor accurately describes the current but unwanted behavior: “Lower numbers are scheduled first when due dates match.”

This gives a skip-policy occurrence extra precedence merely because its generated due date is its occurrence day. The `skip` policy should limit how long an occurrence remains eligible; it should not let low-priority recurring work displace higher-priority work.

## Confirmed reproduction

The current planner was run locally with deterministic production-shaped input:

- UTC user working Monday through Wednesday, 09:00–12:00;
- priority `200` daily recurring skip occurrence, 60 minutes, occurring/due Monday;
- priority `1` one-off task, 180 minutes, starting Monday and due Tuesday;
- Tuesday 09:00–12:00 blocked by a calendar event.

The actual `planTaskPlacements()` loop, loaded from `controllers/schedulePlanner.js`, produced:

```text
Low-priority daily skip: Monday 09:00–10:00
Priority-1 task:          Wednesday 09:00–12:00 (late)
```

The isolated review worktree did not have npm dependencies installed, so only the missing date-library imports were replaced with UTC-equivalent stubs; the real planner selection and placement code executed unchanged. The first implementation step must reproduce the same failure through the real API and isolated MongoDB test stack before scheduler code is changed.

## Required behavior

1. Lower numeric values are higher priority.
2. Priority is the primary ordering rule for simultaneously eligible tasks competing for usable capacity.
3. Due date is a tie-breaker between tasks at the same priority, not a way for a lower-priority recurring occurrence to jump the queue.
4. Recurring skip occurrences use the same priority ordering as other tasks. Their special rule remains only that they expire at the end of their occurrence day when no valid placement is found.
5. Existing hard constraints remain intact: start-date eligibility, dependencies, working windows, calendar conflicts, chunk limits, backlog treatment, occurrence expiry, and the 60-day horizon.
6. Full and chunkable candidates use one deterministic, null-safe ordering rule. A missing due date must not compare ahead of a real deadline or cause `.getTime()` errors.

For the reproduced scenario, the priority-1 task must occupy Monday 09:00–12:00 and finish on time. Monday’s priority-200 recurring occurrence must remain unscheduled and expire under its `skip` policy.

## Implementation plan

### 1. Capture the regression before changing behavior

Update one existing recurring scheduling test rather than adding a new test, keeping the suite’s test count unchanged. Use `tests/api/recurrence.spec.js`’s existing “scheduling a recurring series” case (or the existing dense recurring scheduler case if it yields a cleaner diff).

Create isolated test data from the next future Monday so recurrence expansion uses the real server clock safely:

- clear that test tenant’s task and event data;
- set UTC, Monday–Wednesday, 09:00–12:00 working time;
- create the priority-200 daily skip series;
- create the priority-1 three-hour one-off task due Tuesday;
- block all of Tuesday with a calendar event;
- invoke `/api/scheduletasks`;
- assert the current implementation puts the recurring occurrence first and makes the priority-1 task late, proving the bug before any production change.

Then change those assertions to the required behavior as part of the fix: priority-1 task Monday and on time; Monday skip occurrence has no task event and no `scheduledDate`.

### 2. Centralize scheduler ordering

In `controllers/schedulePlanner.js`, add one explicit task/candidate comparator that:

- orders non-backlog schedulable work according to numeric priority ascending;
- uses due date ascending as the next key, with missing dates sorted last;
- provides a deterministic final tie-breaker;
- is used consistently when choosing between full and chunkable feasible candidates.

Scan the eligible candidates needed to find the comparator-best placement instead of relying on the first record returned by MongoDB. Preserve full placement when the chosen task can finish in the slot; otherwise use its valid chunk placement.

Review fragmented-slot behavior while implementing so an opportunistic low-priority skip occurrence cannot consume capacity that an eligible higher-priority task can use. Do not introduce starvation from a permanently unschedulable long task; preserve the existing ability to make progress on other work when a task cannot use any valid slot.

### 3. Align scheduling input and user-facing semantics

- Change the regular scheduling query in `controllers/scheduling.js` to priority-first, due-date-second ordering so persisted scheduling and forecast inputs begin in the same deterministic order.
- Keep backlog behavior explicit and preserve its existing lower scheduling class unless the comparator requires an equivalent explicit key.
- Update `TaskEditor.vue` help text to say that lower numbers schedule first and due dates break priority ties.
- Update `docs/RECURRING_TASKS.md` where it currently says occurrence due dates drive deadline ordering; explain that occurrences inherit priority and their occurrence date is the tie-break deadline/expiry boundary, not automatic precedence over higher-priority work.
- Do not edit historical completed task briefs merely to rewrite their old design record.

### 4. Verify

Iterate narrowly, then run the full suite only during finalization:

```bash
npm test -- tests/api/recurrence.spec.js -g "<updated recurring scheduling test>"
npm test -- tests/api/recurrence.spec.js
npm test -- tests/api/scheduling.spec.js
npm test
```

Also inspect the generated task events and occurrence `scheduledDate` values in the regression scenario to confirm the higher-priority task is on time and the displaced skip occurrence remains null.

## Acceptance criteria

- The existing recurring-task spec first demonstrates the reported inversion against the old scheduler and passes with corrected expectations after the fix; no new test case is added.
- In the deterministic capacity scenario, priority `1` work is scheduled before priority `200` recurring work and no longer becomes late.
- The lower-priority Monday skip occurrence is not moved to a later day; it has no generated event and `scheduledDate` remains null.
- For eligible tasks competing for the same usable capacity, lower numeric priority wins regardless of differing due dates.
- Equal-priority tasks remain deadline ordered and deterministic.
- Full/chunk arbitration uses the same priority semantics and safely handles tasks without due dates.
- Dependencies, working hours/days, conflicts, recurrence policies, chunk totals, idempotence, and horizon bounds continue to pass.
- The task editor and recurring-task manual describe the implemented priority-first rule.
- The full `npm test` suite passes.
