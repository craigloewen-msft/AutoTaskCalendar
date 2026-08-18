# Blocked-slot Task Reschedule Forecast

Use the blocked-slot forecast on Calendar to answer: **what would happen if this task were not done in its planned time, another event occupied that time, and I ran Schedule Tasks again?** The forecast is a read-only simulation of the last generated schedule.

## Read the indicators

Run **Schedule Tasks** first. Each task shows its normal schedule/deadline status on the primary row. The small number is the civil-calendar gap between its scheduled day and due day; its tooltip explicitly says this is **not spare capacity**.

When a valid cached forecast moves downstream work, a **`slot blocked → …`** control appears on a separate row. The selected task is the premise, so its own move or missed deadline is not counted:

- **`safe`** means downstream work moves, but no currently on-time downstream task newly misses its deadline.
- **`N late`** means that many currently on-time downstream tasks would newly miss deadlines.

No control is shown when the task has no valid scheduled date, has no cached forecast, or has no downstream movement or deadline impact. This absence does not claim that an unavailable calculation is safe.

Select a visible control to open **What if?**. The panel lists each moved downstream task as `current day → forecast day`, marks newly late rows, and highlights the selected, moved, and newly late tasks in the sidebar. The selected task is highlighted separately and is not a cascade row. Select the close button or the same control again to dismiss it.

## Understand the assumption

For a scheduled task, the simulation performs the in-memory equivalent of these user actions:

1. Keep the selected task incomplete.
2. Add ordinary calendar events that exactly cover all of the selected task's generated placements. A chunked task blocks every generated chunk.
3. Remove generated task events and run the normal scheduler again over every incomplete task.
4. Compare the hypothetical placements with the saved baseline schedule.

This is not a blanket one-day delay. Capacity before and after the blocked slot remains available, and the scheduler may move the selected task or another eligible task into it. The hypothetical rerun uses the normal task queue, saved working days and hours, task eligibility, deadlines, priority, dependencies, chunking, recurrence behavior, calendar conflicts, timezone, and 60-day horizon.

Only synthetic conflicts and planner results exist during the calculation. The forecast does not create a calendar event or replace the visible generated schedule.

## How movement and deadline risk are counted

A task is on time when its final task event completes on or before its civil due date. For downstream work only, a **newly missed deadline** is a task that is on time in the generated baseline but either:

- completes after its due date in the hypothetical rerun; or
- cannot be placed within the scheduler's horizon.

A task is moved when its first placement or final completion changes, or when it becomes unplaceable. Comparing both ends ensures a chunked task is reported when a later chunk moves even if its first chunk does not.

Existing late work may move later and appears in the cascade, but it is not counted as newly late. Due dates and completion days are compared as civil dates in the user's saved IANA timezone.

The panel reports:

- **downstream tasks move later** — non-selected tasks whose placement changes or disappears;
- **newly miss deadlines** — the subset that crosses from on time to late or unplaceable.

The selected task remains in the scheduler queue and consumes capacity in its new placement. Its own movement and deadline state are excluded from both totals because they are the premise rather than a downstream effect. A single isolated task therefore has no visible control when blocking its slot harms no other task.

## Data flow

**Schedule Tasks** owns the calculation lifecycle. After persisting the real schedule, the server calculates simulations for up to 100 scheduled, non-backlog tasks in Calendar's 21-day sidebar window and writes each nullable `slipForecast` beside that task's `scheduledDate`.

The candidate window controls which tasks receive a cached forecast; it does not truncate the planner queue. Every simulation replans the complete normal set of incomplete regular and backlog tasks.

Calendar receives the forecast through the normal `GET /api/getUserTasks` payload. There is no forecast endpoint, collection, synchronization query, or calculation during a reload. Calendar only reads the current blocked-slot forecast version, so older cached semantics stay hidden until **Schedule Tasks** refreshes them. A current non-null object renders a control only when it has downstream impact; missing and zero-impact results render nothing.

`scheduledDate`, generated task events, and `slipForecast` are one snapshot of the last **Schedule Tasks** run. Editing tasks, preferences, or calendar events does not update or selectively clear one part of that snapshot; the next scheduling run replaces all three together.

## Scheduling reuse and read-only guarantee

`controllers/schedulePlanner.js` is the pure placement engine. It receives tasks, conflicts, user work settings, a start instant, and a horizon, then returns placements without accessing MongoDB.

`controllers/scheduling.js` uses that same engine for the real schedule and blocked-slot simulations. `generateTaskEvents()` expands recurrence, replaces generated placements, persists `scheduledDate`, calculates the visible-window simulations, and caches their summaries as one scheduling operation. The planner reuses immutable task metadata such as eligibility and recurrence expiry across those simulations.

Opening, closing, or reloading a forecast only reads the task object already in Calendar. It does not write data or invoke the planner. Press **Schedule Tasks** whenever inputs change and you want both the visible schedule and forecasts refreshed.

## Limits

- A forecast requires a generated schedule. Backlog and currently unscheduled tasks have no control.
- **Schedule Tasks** calculates forecasts for the current 21-day sidebar window; run it again to refresh the schedule or bring a later window into the cache.
- It evaluates one selected task at a time and does not combine several hypothetical missed slots.
- It models the selected task as wholly uncompleted. It does not predict partial manual progress or future calendar changes beyond the synthetic blocker.
- The simulation uses the same 60-day placement horizon as normal scheduling.

## Verify the exact mixed-capacity example

The shared `slipuser` seed has ten 3½-hour tasks, all starting Monday and due Friday, plus a fixed 09:00–10:00 event each weekday. Events and tasks consume all 40 working hours exactly, and the generated baseline places two tasks per weekday after each event.

Blocking the first task's Monday 10:00–13:30 placement leaves Monday 13:30–17:00 available. The selected task moves there, each later task shifts one slot, and the final Friday task moves to the following Monday. The forecast therefore reports nine downstream tasks moving and **one** newly late task.

`tests/ui/calendar.spec.js` creates an actual calendar event over that exact slot, runs **Schedule Tasks** again, and compares the real generated placements and newly-late set with the cached forecast. It also verifies that merely opening and reloading the preview changes no task or event data.
