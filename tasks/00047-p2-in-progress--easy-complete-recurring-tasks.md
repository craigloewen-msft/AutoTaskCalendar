# Easy completion for recurring tasks on the calendar

## Goal

Let users complete a recurring task directly from the main calendar page without opening its edit modal. Keep the shortcut small, accessible, and unavailable on ordinary tasks.

## UX

- Add a compact check-mark button to the right side of each recurring task row in the calendar sidebar.
- Treat both materialized occurrences (`seriesRef`) and legacy repeating tasks (`repeat`) as recurring; reuse the same predicate for the existing recurring icon.
- Label the control for assistive technology (for example, `Complete recurring task: Team standup`) and provide a `Complete this occurrence` tooltip.
- Stop click propagation so pressing the check does not open the task modal.
- Complete immediately without confirmation; this is the deliberately low-friction action.
- While the request is running, disable the control and show a subtle pending state to prevent duplicate submissions.
- On success, remove only the completed occurrence from the sidebar and refresh the visible calendar events. Other occurrences in the series remain.
- On failure, retain the task and show a small inline error near the task list.
- Style the button as a subdued circular/outline control that becomes clearer on row hover or keyboard focus. Preserve a usable touch target and visible focus state.

## Implementation

### Frontend — `webinterface/src/views/Calendar.vue`

1. Add an `isRecurringTask(task)` helper and use it for both the existing repeat icon and the new quick-complete control.
2. Add the button beside the task's existing date/backlog metadata with `type="button"`, an accessible task-specific label, tooltip, and `@click.stop` handler.
3. Track in-flight task IDs and a quick-completion error in component state.
4. Add a dedicated quick-complete method that calls the existing `POST /api/completeTask` endpoint, validates the `{ success }` response, adopts the returned active task list, and reloads the current week's events.
5. Keep modal/chunk completion behavior separate: the sidebar shortcut always completes the whole recurring occurrence, not one scheduled chunk.
6. Add scoped styles for compact layout, hover/focus visibility, disabled state, and inline errors.

### Backend — `controllers/taskController.js`

When `completeTask()` successfully completes a task, delete its derived `task`/`task-chunk` event records for the same user and `taskRef`. Generated task events are projections rebuilt by the scheduler; removing them prevents a completed occurrence from remaining visibly scheduled after the frontend refreshes the calendar. Do not touch unrelated or Google/calendar events.

No new endpoint or schema change is needed. Existing recurrence semantics already mark only the selected occurrence complete and preserve the rest of the series.

## Tests

### UI — `tests/ui/calendar.spec.js`

Add coverage proving that:

1. A recurring occurrence has the accessible quick-complete button while a non-recurring task does not.
2. Clicking the shortcut does not open the edit modal.
3. The selected occurrence leaves the active sidebar while other occurrences in the same series remain.

### API — `tests/api/tasks.spec.js`

Add coverage proving that full task completion removes generated events linked to that task while leaving unrelated events untouched.

Run the focused calendar UI/API specs while iterating, then run `npm run verify` once during finalization.

## Acceptance criteria

- Recurring tasks can be completed from the calendar sidebar in one click.
- The shortcut is never rendered for non-recurring tasks.
- One click completes only the selected occurrence, not its series or sibling occurrences.
- The click never opens the edit modal and duplicate clicks are prevented while pending.
- The completed row and its generated calendar block disappear without a page reload.
- Failures are visible and do not optimistically remove the task.
- Keyboard and screen-reader users can identify and activate the control.
- Focused tests and the full verification suite pass.
