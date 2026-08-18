# Use priority to break same-day scheduling ties

## Problem

A low-priority recurring occurrence using `whenUnschedulableBehavior: 'skip'` could be
scheduled before a higher-priority task that was due on the same civil day. The recurring
occurrence consumed the only slot large enough for the other task, making the higher-priority
work late.

The recurrence layer preserved priority correctly. The inversion came from comparing raw
`dueDate` instants:

- generated occurrences use a canonical UTC-midnight marker for their due day;
- older one-off tasks can retain a later time on that same day;
- raw MongoDB and JavaScript date ordering therefore treated the occurrence as having an
  earlier deadline even though both tasks showed the same due date to the user;
- priority never got a chance to break the apparent tie.

## Reproduction

The existing recurring scheduling spec was updated without increasing the test count. Its
isolated UTC account has:

- Monday–Wednesday working days, 09:00–12:00;
- a priority `200` daily skip occurrence due Monday at its canonical midnight marker;
- a priority `1` three-hour one-off task due Monday with a retained `23:59:59.999` time;
- only one three-hour Monday working window.

The original planner selects the recurring occurrence first. That leaves only two Monday
hours, so the priority-1 task moves to Tuesday and becomes late.

## Final scheduling rule

1. Tasks with earlier **civil due dates** schedule first.
2. Priority is a tie-breaker for tasks due on the same civil day; lower numbers win.
3. When civil due date and priority both tie, a task that can finish in the current slot wins
   over starting a chunk.
4. Task ID is the final deterministic tie-breaker.
5. Dated work remains ahead of backlog work. Backlog keeps its historical start-date ordering.
6. Start eligibility, dependencies, working windows, calendar conflicts, chunk limits,
   recurrence expiry, and the scheduling horizon remain hard constraints.

The planner scans all currently feasible tasks instead of relying on the first full and first
chunkable record returned from MongoDB. It normalizes each regular task's `dueDate` to its
canonical civil date before comparing, so midnight recurrence markers and legacy times on the
same visible day tie correctly.

The database query remains due-date-first and priority-second. Its raw order is only an input
optimization; the planner applies the authoritative civil-day comparison when selecting work.

## Result

In the reproduced Monday contention:

```text
Priority-1 same-day task: Monday 09:00–12:00
Priority-200 daily skip:  no event; scheduledDate remains null
```

The skip policy still means “do not move this occurrence later.” It does not grant recurring
work extra precedence.

## Files

| File | Change |
|---|---|
| `controllers/schedulePlanner.js` | Scan feasible candidates; compare civil due day, then priority, full placement, and ID |
| `tests/api/recurrence.spec.js` | Reproduce same-day raw-timestamp inversion in the existing recurring scheduling test |
| `webinterface/src/components/TaskEditor.vue` | Keep the documented same-due-date priority semantics |
| `docs/RECURRING_TASKS.md` | Explain civil deadline comparison and recurrence priority behavior |

## Acceptance criteria

- A lower-priority recurring occurrence cannot beat higher-priority work due on the same civil
  day merely because its stored timestamp is earlier.
- An actually earlier civil due date still outranks a later deadline regardless of priority.
- Equal-day priority applies consistently across full and chunkable candidates.
- A displaced skip occurrence is not moved later and keeps `scheduledDate: null`.
- Backlog and all existing scheduler constraints retain their behavior.
- The existing recurrence test covers the production-shaped case; no test was added.
- The full `npm test` suite passes.
