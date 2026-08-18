# One-day Task Slip Forecast

Use the one-day slip forecast on Calendar to see whether postponing one scheduled task consumes capacity that later deadlines need. The forecast is a read-only simulation of the last generated schedule, not a change to the task or calendar.

## Read the indicators

Run **Schedule Tasks** first. Every scheduled, non-backlog task in the sidebar then has two adjacent indicators:

- The small number is the civil-calendar gap between its scheduled day and due day. Its tooltip explicitly says this is **not spare capacity**.
- The **`+1 day → …`** chip reports the downstream effect of waiting one day:
  - **`safe`** means no currently on-time task newly misses its deadline. It is deliberately low-contrast until hovered or focused.
  - **`N late`** means that many currently on-time tasks would newly miss deadlines.

A failed or unavailable forecast never appears as `safe`. Calendar displays a quiet retry status and leaves normal task and calendar actions available.

Select a chip to open **What if?**. The panel lists each moved task as `current day → forecast day`, marks newly late rows, and highlights the selected, moved, and newly late tasks in the sidebar. Select the close button or the same chip again to dismiss it.

## Understand the assumption

For a task scheduled at a particular wall time, “slip one day” means:

1. Work scheduled before that task stays fixed, as if it was completed.
2. The selected task and the remaining queue do not begin until the same local wall time on the next civil date.
3. The scheduler reflows that queue around saved working days, working hours, task eligibility, deadlines, priority, dependencies, chunking, recurrence behavior, and non-task calendar conflicts.

The queue in this preview is the scheduled, non-backlog work in Calendar’s visible 14-day window. Farther-future tasks are intentionally outside both the chip’s claim and its calculation.

The forecast intentionally leaves the skipped capacity empty. Moving another task into the abandoned slot would model reprioritization, not the cost of waiting, and would hide the cascade this indicator is designed to reveal.

“Tomorrow” uses the user’s saved IANA timezone and civil-date arithmetic. It does not add 24 hours or invent an offset, so daylight-saving boundaries retain the same intended wall time.

## How deadline risk is counted

A task is on time when its final task event completes on or before its civil due date. A **newly missed deadline** is a task that is on time in the generated baseline but either:

- completes after its due date in the forecast; or
- cannot be placed within the scheduler’s 60-day horizon.

Existing late work may move later and appears in the cascade, but it is not counted as newly late. Chunked tasks use the end of their final chunk for deadline comparison.

The panel reports:

- **tasks move later** — affected tasks whose first placement changes or disappears;
- **newly miss deadlines** — the subset that crosses from on time to late/unplaceable.

## Data flow

**Schedule Tasks** owns the calculation lifecycle. After persisting the real schedule, the server calculates one-day simulations for up to 100 scheduled, non-backlog tasks in Calendar’s 14-day sidebar window and writes each nullable `slipForecast` beside that task’s `scheduledDate`.

Calendar receives the forecast through the normal `GET /api/getUserTasks` payload. There is no forecast endpoint, collection, synchronization query, or calculation during a reload: a non-null object renders a chip, while `null` renders nothing.

`scheduledDate`, generated task events, and `slipForecast` are one snapshot of the last **Schedule Tasks** run. Editing tasks, preferences, or calendar events does not update or clear only one part of that snapshot; the next scheduling run replaces all three together.

## Scheduling reuse and read-only guarantee

`controllers/schedulePlanner.js` is the pure placement engine. It receives tasks, conflicts, user work settings, a start instant, and a horizon, then returns placements without accessing MongoDB.

`controllers/scheduling.js` uses that same engine for the real schedule and its suffix simulations. `generateTaskEvents()` expands recurrence, replaces generated placements, persists `scheduledDate`, calculates the visible-window simulations, and caches their summaries as one scheduling operation.

Opening, closing, or reloading a forecast only reads the task object already in Calendar. It does not write data or invoke the planner.

This means a preview can become historical after an input edit, exactly like the visible generated schedule beside it. Press **Schedule Tasks** whenever you want both refreshed against current inputs.

## Limits

- A forecast requires a generated schedule. Backlog and currently unscheduled tasks have no chip.
- **Schedule Tasks** calculates chips for the current 14-day sidebar window; run it again to refresh the schedule or bring a later window into the cache.
- It evaluates one chosen task at a time; it does not combine several hypothetical delays.
- It assumes earlier scheduled tasks are completed and the later queue retains normal scheduler ordering. It does not predict interruptions, partial manual progress, or future calendar changes that are not recorded yet.
- The simulation uses the same 60-day placement horizon as normal scheduling.

## Verify the exact weekly-capacity example

`tests/ui/calendar.spec.js` has one scenario with ten four-hour tasks, all starting Monday and due Friday, against five eight-hour workdays. The generated baseline places two tasks per weekday. Letting the first task slip leaves Monday’s capacity unused, moves all ten tasks, and pushes the final two from Friday to the following Monday.

Two buffered follow-ups start the next Tuesday. They keep their exact baseline slots when the risky Monday task slips, do not appear in that cascade, and show subtle `safe` chips for their own one-day previews.

The test asserts **`+1 day → 2 late`**, all ten cascade rows, both unchanged buffered tasks, nullable forecast data surviving a page reload, and no changes to the baseline schedule or forecast timestamps while previewing.
