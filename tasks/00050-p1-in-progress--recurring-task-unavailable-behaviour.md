# Choose how recurring tasks handle an unavailable occurrence day

## Goal

Let each recurring series choose what happens when an occurrence cannot fit on the civil day it belongs to:

1. **Skip that occurrence** — default. It may use a valid slot on its occurrence day, but it is never carried into a later day.
2. **Schedule at the next available time** — opt-in. Keep the occurrence eligible until the scheduler can place it in a later valid slot.

This applies when a day is fully blocked, is not a configured working day, or has no remaining slot large enough for the task. One-off tasks keep their current best-effort scheduling behavior.

## Current behavior and problems

Recurring occurrences have a stable `occurrenceDate`, while `scheduledDate` records their actual placement. The scheduler currently has only a lower bound: it will not place an occurrence before `occurrenceDate`, but it can place it on any later day.

The current result is inconsistent:

- During one scheduling run, a blocked occurrence carries forward to a later day.
- On a later run, `expandRecurrences()` deletes past incomplete occurrences before scheduling, so the same occurrence can instead disappear.
- Generated task events are deleted before rebuilding, but old `scheduledDate` values are not cleared. An occurrence that becomes unschedulable can therefore still look scheduled in the sidebar.
- The UI says non-working-day occurrences will not be scheduled even though the backend can currently carry them forward.

This work will replace that mixed behavior with an explicit, deterministic per-series policy.

## Product behavior

### Stored rule

Add an enum to the template's existing recurrence rule:

```js
recurrence.unavailableBehavior // 'skip' | 'next-available'
```

- Missing or omitted values resolve to `'skip'`.
- New rules created in the UI explicitly start as `'skip'`.
- Existing rule documents and promoted legacy `repeat` strings also resolve to `'skip'`; no migration script is required.
- Invalid values are rejected by the recurrence API validation rather than silently retained.
- The option belongs to the series rule, so editing it from any materialized occurrence continues to update the whole series.

### Skip that occurrence — default

- Continue materializing the occurrence on its rule date. Skipping placement must not alter recurrence generation or its `(seriesRef, occurrenceDate)` identity.
- The occurrence is eligible only during its own day in the user's IANA timezone and only within normal working hours and free calendar slots.
- If it cannot be placed, create no generated task event on a later day and leave `scheduledDate` null. It can appear as `Unscheduled` for that day.
- On a subsequent run after its day has passed, remove the incomplete occurrence through the existing missed-occurrence cleanup. Completed history remains immutable.
- For breakable tasks, chunks may use valid slots on the occurrence day, but no remaining work may spill into another day.

### Schedule at the next available time — opt-in

- Keep `occurrenceDate`, `startDate`, and `dueDate` anchored to the intended occurrence day.
- Allow only `scheduledDate` and generated event placement to move later; never schedule the occurrence early.
- Do not prune a past incomplete occurrence merely because its occurrence day passed. Retain it across scheduler reruns until it can be scheduled, completed, its rule changes, or its series is removed/completed.
- Later occurrences remain independent, so an opted-in daily series can intentionally accumulate multiple pending occurrences.
- Continue respecting working days, working hours, dependencies, chunking, existing events, and task ordering.

### Scheduling horizon

The scheduler only loads calendar events through its 60-day horizon. It must not claim a “next available” slot beyond that known calendar window. Stop placement at the loaded boundary and leave still-pending deferred work for a later run as the rolling horizon advances.

## User interface

Extend `webinterface/src/components/RepeatEditor.vue` with a visible radio group whenever recurrence is enabled:

**If this task cannot fit on its occurrence day**

- **Skip that occurrence** — selected by default
- **Schedule it at the next available time**

Keep the choice in the recurrence object so the shared `TaskEditor` automatically sends it on create and edit and displays it when an occurrence is reopened through `seriesRecurrence`.

Update the non-working-weekday warning to match the selected policy:

- skip: those occurrences will be skipped rather than moved later;
- next available: those occurrences will be scheduled at a later available time.

Preserve the policy when changing recurrence frequency and include the default in the UI recurrence helper's blank rule shape. The existing plain-English frequency summary does not need to repeat the scheduling-policy text because the radio group remains visible directly beside it.

## Implementation plan

### Model, validation, and API round trips

- Add the enum/default to `RecurrenceRule` in `models/index.js`.
- In `controllers/recurrence.js`, centralize valid values and the missing-value fallback, validate incoming values, include the field in `normaliseRecurrence()`, and default promoted legacy rules to skip.
- Ensure `effectiveRule()` and occurrence-facing serialization apply the read-time default for older documents that lack the field.
- Keep create/edit transport unchanged: `routes/tasks.js` already validates and normalizes `recurrence`, and `controllers/taskController.js` already attaches the template rule as `seriesRecurrence`.

### Expansion and missed-occurrence cleanup

- Keep `occurrenceDatesBetween()` pure and availability-agnostic.
- In `expandRecurrences()`, identify active templates using `'next-available'` and exempt only their incomplete occurrences from the global past-date prune.
- Continue pruning past skip-policy occurrences, occurrences of completed/deleted series, and stale future occurrences after rule edits. Never prune completed occurrences.
- Switching from next-available to skip should prune already-past incomplete work on the next expansion; switching to next-available affects retained/current and future work but does not recreate occurrences already removed as past misses.

### Scheduler

- Load each occurrence's template policy into the scheduling context without copying the recurrence rule onto occurrence documents.
- Add a timezone-aware upper bound for skip-policy occurrences based on the start of the day after `occurrenceDate`. Do not compare raw timestamps or numeric timezone offsets.
- Remove expired skip-policy occurrences from the in-memory pending queue so they cannot trip the scheduler's no-progress guard. Do not apply this bound to one-off tasks or next-available occurrences.
- Before rebuilding task events, reset `scheduledDate` for incomplete schedulable tasks. Successful placements set it again; skipped or otherwise unscheduled tasks remain null.
- Bound the scheduling loop by the same horizon through which existing calendar events were loaded.

### Documentation

Update `docs/RECURRING_TASKS.md` to document:

- the new rule field and default;
- skip versus next-available placement;
- conditional pruning of past incomplete occurrences;
- stable occurrence identity versus deferred placement;
- non-working-day and full-day behavior;
- the scheduling horizon behavior.

Also correct the nearby stale claim that occurrence `dueDate` is the end of day; the implementation and existing tests use a canonical civil-date marker.

## Tests

### API and recurrence tests

Extend `tests/api/recurrence.spec.js` to prove:

- both enum values validate and an unknown value is rejected;
- omitted values, old stored rules, and promoted legacy `repeat` strings resolve to skip;
- create/edit persistence and `seriesRecurrence` serialization preserve the selected value;
- editing through an occurrence changes the template policy without changing occurrence identity;
- past incomplete skip occurrences are pruned, while next-available occurrences survive reruns;
- completed occurrence history remains untouched under both policies.

### Scheduler tests

Add focused scenarios to `tests/api/scheduling.spec.js` using a future occurrence date and a calendar event that blocks that whole local day:

1. Schedule the series before the blocker, add the blocker, and rerun. With the omitted/default policy, the target occurrence gets no event that day or later, and its stale `scheduledDate` is cleared.
2. With `'next-available'`, the same target occurrence keeps its identity and is placed in the next valid slot after the blocked day.
3. A retained past next-available occurrence behaves the same on a later scheduler run instead of being pruned.
4. Sibling occurrences still schedule independently, and neither policy permits early, non-working-time, overlapping, or beyond-horizon placement.
5. A skip-policy breakable occurrence never emits chunks after its occurrence day.

Use timezone-aware temporal helpers to create boundaries so these specs remain stable across DST and non-UTC users.

### UI tests

Extend `tests/ui/calendar.spec.js` to prove:

- enabling recurrence selects **Skip that occurrence** by default;
- selecting **Schedule it at the next available time** survives save and reopening a materialized occurrence;
- the non-working-day warning changes with the selected behavior;
- the choice remains available through the shared Calendar/Weekly Plan task editor.

Run focused recurrence, scheduling, and calendar UI specs while iterating, then run `npm test` once during finalization.

## Acceptance criteria

- Every recurring series exposes the two requested behaviors in its editor.
- Skip is the default for new, existing-without-a-value, and legacy recurring tasks.
- A default-policy occurrence never generates work after its own civil day.
- A next-available occurrence may move later but never earlier, and it survives scheduler reruns consistently.
- Blocking a day after an earlier schedule removes or moves the generated block correctly; no stale `scheduledDate` remains.
- Occurrence identity and completed history remain stable.
- One-off scheduling behavior is unchanged.
- Calendar availability is never assumed beyond the loaded scheduling horizon.
- API, UI, and documentation agree on the behavior, and the full test suite passes.
