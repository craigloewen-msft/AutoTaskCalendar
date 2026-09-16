# Task completion

There are three ways a task gets marked done. All of them end at
`POST /api/completeTask` (or `/api/completeTaskChunk`) in `routes/tasks.js`, which calls
`completeTask()` in `controllers/taskController.js` and returns the refreshed list of active
tasks as `taskList`.

**There is no un-complete endpoint.** Once a task is completed the only recovery is recreating
it by hand. Every completion affordance in the UI is designed around that fact.

## 1. Inline button on the task row (the fast path)

In the calendar sidebar (`webinterface/src/views/Calendar.vue`) every task row carries a small
green `✓` button at the right-hand end of its meta row.

It is deliberately two-step:

| State | Looks like | What a click does |
| --- | --- | --- |
| Resting | invisible until the row is hovered or focused, then a faint outlined circle | arms the button |
| Armed | solid green `✓ Confirm` pill | completes the task |

Arming disarms again after **4 seconds**, on `Escape`, on blur, when another task's button is
armed, or when the task editor opens. So an accidental completion needs two deliberate clicks
on the same 30 px target inside a four-second window.

The button is always focusable, is shown whenever it has focus (keyboard users never hunt for
it), and renders at resting opacity permanently on coarse pointers (`@media (hover: none)`),
where there is no hover to reveal it.

Relevant members on the component: `armedCompleteTaskId`, `armCompletion()`,
`disarmCompletion()`, `toggleQuickComplete()`, `quickCompleteTask()`. Errors surface in the
`quick-complete-error` paragraph above the list; on success the component refreshes the task
list, the calendar events, and the slip forecasts.

Clicking anywhere else on the row still opens the editor — the button uses `@click.stop`.

## 2. "Complete" in the task editor

`webinterface/src/components/TaskEditor.vue` has a `Complete` button in its footer. Same
endpoint. It also handles the case the inline button cannot: when the editor was opened from a
`task-chunk` calendar event, it posts `/api/completeTaskChunk` with that chunk's duration,
completing only part of the task and shrinking the remainder.

## 3. "Follow up"

Also in the editor: `POST /api/setFollowUp` completes the task *and* creates a successor N days
out, inheriting the project. Use it for things that recur irregularly.

## Recurring tasks

Completing an occurrence of a repeating series does not end the series; the next occurrence is
materialised by `controllers/recurrence.js`. See `docs/RECURRING_TASKS.md`.

## Testing

API coverage lives in `tests/api/tasks.spec.js` (plain completion, event cleanup, incremental
chunk completion) and `tests/api/recurrence.spec.js`. The suite is API-only — there is no
Playwright browser project — so the arm/confirm interaction itself is verified by hand, not by
a spec. If a UI project is added later, the hooks are the `data-test="quick-complete-<taskId>"`
attribute and the `armed` class.
