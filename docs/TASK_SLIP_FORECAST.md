# One-day Task Slip Forecast

Use the one-day slip forecast on Calendar to see whether postponing one scheduled task consumes capacity that later deadlines need. The forecast is a read-only simulation of the last generated schedule, not a change to the task or calendar.

## Read the indicators

Run **Schedule Tasks** first. Each task shows its normal schedule/deadline status on the primary row. The small number is the civil-calendar gap between its scheduled day and due day; its tooltip explicitly says this is **not spare capacity**.

When a valid cached forecast moves downstream work, a **`+1 day → …`** control appears on a separate row. The selected task is the premise, so its own move or missed deadline is not counted:

- **`safe`** means downstream work moves, but no currently on-time downstream task newly misses its deadline. It is deliberately low-contrast until hovered or focused.
- **`N late`** means that many currently on-time downstream tasks would newly miss deadlines.

No control is shown when the task has no valid scheduled date, has no cached forecast, or has no downstream movement or deadline impact. This absence does not claim that an unavailable calculation is safe.

Select a visible control to open **What if?**. The panel lists each moved downstream task as `current day → forecast day`, marks newly late rows, and highlights the selected, moved, and newly late tasks in the sidebar. The selected task is highlighted separately and is not a cascade row. Select the close button or the same control again to dismiss it.

## Understand the assumption

For a task scheduled at a particular wall time, “slip one day” means:

1. Work scheduled before that task stays fixed, as if it was completed.
2. The selected task and the remaining queue do not begin until the same local wall time on the next civil date.
3. The scheduler reflows that queue around saved working days, working hours, task eligibility, deadlines, priority, dependencies, chunking, recurrence behavior, and non-task calendar conflicts.

The queue in this preview is the scheduled, non-backlog work in Calendar’s visible 21-day window. Farther-future tasks are intentionally outside both the chip’s claim and its calculation.

The forecast intentionally leaves the skipped capacity empty. Moving another task into the abandoned slot would model reprioritization, not the cost of waiting, and would hide the cascade this indicator is designed to reveal.

“Tomorrow” uses the user’s saved IANA timezone and civil-date arithmetic. It does not add 24 hours or invent an offset, so daylight-saving boundaries retain the same intended wall time.

## How deadline risk is counted

A task is on time when its final task event completes on or before its civil due date. For downstream work only, a **newly missed deadline** is a task that is on time in the generated baseline but either:

- completes after its due date in the forecast; or
- cannot be placed within the scheduler’s 60-day horizon.

Existing late work may move later and appears in the cascade, but it is not counted as newly late. Chunked tasks use the end of their final chunk for deadline comparison.

The panel reports:

- **downstream tasks move later** — later tasks whose first placement changes or disappears;
- **newly miss deadlines** — the subset that crosses from on time to late/unplaceable.

The selected task still consumes capacity in the simulation, but its own move and deadline state
are excluded from both totals. A single isolated task therefore has no visible slip control:
postponing it may make that task late, but it does not harm anything behind it.

## Data flow

**Schedule Tasks** owns the calculation lifecycle. After persisting the real schedule, the server calculates one-day simulations for up to 100 scheduled, non-backlog tasks in Calendar’s 21-day sidebar window and writes each nullable `slipForecast` beside that task’s `scheduledDate`.

Calendar receives the forecast through the normal `GET /api/getUserTasks` payload. There is no forecast endpoint, collection, synchronization query, or calculation during a reload. A non-null object renders a control only when it has downstream impact; `null` and zero-impact results render nothing.

`scheduledDate`, generated task events, and `slipForecast` are one snapshot of the last **Schedule Tasks** run. Editing tasks, preferences, or calendar events does not update or clear only one part of that snapshot; the next scheduling run replaces all three together.

## Scheduling reuse and read-only guarantee

`controllers/schedulePlanner.js` is the pure placement engine. It receives tasks, conflicts, user work settings, a start instant, and a horizon, then returns placements without accessing MongoDB.

`controllers/scheduling.js` uses that same engine for the real schedule and its suffix simulations. `generateTaskEvents()` expands recurrence, replaces generated placements, persists `scheduledDate`, calculates the visible-window simulations, and caches their summaries as one scheduling operation.

Opening, closing, or reloading a forecast only reads the task object already in Calendar. It does not write data or invoke the planner.

This means a preview can become historical after an input edit, exactly like the visible generated schedule beside it. Press **Schedule Tasks** whenever you want both refreshed against current inputs.

## Limits

- A forecast requires a generated schedule. Backlog and currently unscheduled tasks have no chip.
- **Schedule Tasks** calculates forecasts for the current 21-day sidebar window; run it again to refresh the schedule or bring a later window into the cache.
- It evaluates one chosen task at a time; it does not combine several hypothetical delays.
- It assumes earlier scheduled tasks are completed and the later queue retains normal scheduler ordering. It does not predict interruptions, partial manual progress, or future calendar changes that are not recorded yet.
- The simulation uses the same 60-day placement horizon as normal scheduling.

## Verify the exact weekly-capacity example

The shared `slipuser` seed has ten 3½-hour tasks, all starting Monday and due Friday, plus a fixed 09:00–10:00 event each weekday. Events and tasks consume all 40 working hours exactly, and the generated baseline places two tasks per weekday after each event. Letting the first task slip moves all nine downstream tasks and pushes the final two from Friday to the following Monday.

The next week is otherwise empty and ends with one isolated Friday task. That task and the final capacity task show no slip control because neither has downstream impact when selected.

`tests/ui/calendar.spec.js` asserts **`+1 day → 2 late`**, all nine downstream cascade rows, omission of both zero-impact self-only cases, nullable forecast data surviving a page reload, and no changes to task or fixed calendar events while previewing.
