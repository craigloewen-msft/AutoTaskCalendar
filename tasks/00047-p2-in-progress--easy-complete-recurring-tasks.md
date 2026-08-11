# Easy completion for recurring tasks on the calendar

## Goal

Let users complete one recurring occurrence directly from the Calendar task sidebar without opening its editor. Keep the change small, subtle, accessible, and limited to recurring tasks.

## Recovered state

This task file is the earlier plan the user remembered. The current tree contains the recurrence model and completion behavior it expected, but none of its quick-complete UI or matching tests survived.

What already exists:

- Recurring occurrences are independent task documents identified by `seriesRef`.
- `POST /api/completeTask` completes only the selected occurrence and returns the updated active task list.
- The shared task editor can already complete tasks and refresh the Calendar state.
- The Calendar sidebar already marks materialized occurrences with a recurrence icon.

Loose ends to finish:

- The sidebar has no one-click completion control or pending/error state.
- Its recurrence icon recognizes `seriesRef` but not an unpromoted legacy `repeat` task.
- Completion leaves generated `task` and `task-chunk` events behind, so a refreshed calendar can still show a completed task block.
- No UI or API specs cover this shortcut and projection cleanup.

No new endpoint, schema, migration, or broad documentation is needed.

## UX

- Add a compact check-mark button at the right of each recurring task row in the Calendar sidebar.
- Treat both materialized occurrences (`seriesRef`) and legacy repeating tasks (`repeat`) as recurring, using one predicate for the existing icon and the new action.
- Give the button a task-specific accessible label such as `Complete recurring task: Team standup` and the tooltip `Complete this occurrence`.
- Stop click propagation so the action never opens the task editor.
- Complete immediately without confirmation; this is intentionally low friction.
- Disable the selected control and show a subtle pending state while its request is active.
- On success, adopt the returned task list and refresh the visible calendar events. The selected occurrence disappears while sibling occurrences remain.
- On failure, retain the task and show a small inline alert near the task list.
- Use a subdued outline/circular style that becomes clearer on row hover or keyboard focus while retaining a visible focus state and usable touch target.

## Implementation

### Calendar sidebar — `webinterface/src/views/Calendar.vue`

1. Add `isRecurringTask(task)` and use it for the recurrence icon and quick-complete button.
2. Add the button with `type="button"`, accessible label, tooltip, disabled/pending state, and `@click.stop`.
3. Track in-flight task IDs and one sidebar completion error.
4. Add a dedicated method that calls `POST /api/completeTask`, validates `{ success }`, replaces `taskList` with the response, and awaits the current week's event reload.
5. Keep the existing editor/chunk flow separate: this shortcut always completes the whole selected occurrence.
6. Add only the small layout, interaction, disabled, focus, and error styles the control needs.

### Projection cleanup — `controllers/taskController.js`

After a task is successfully marked complete, delete generated event projections matching all of:

- the same `userRef`;
- the completed task's `_id` as `taskRef` (never its `seriesRef`);
- `type` in `task` or `task-chunk`.

Run this shared cleanup before the occurrence-specific early return so it also applies to ordinary full completion, final chunk completion, and completion while creating a follow-up. Do not delete unrelated manual, Google, or other users' events.

Keep new code comments to exceptional, non-obvious cases only; prefer clear names and tests.

## Behavioral specs

### UI — `tests/ui/calendar.spec.js`

Add focused coverage proving that:

1. A recurring occurrence has the accessible quick-complete button and an ordinary task does not.
2. Clicking the button does not open the task editor.
3. Only the selected occurrence leaves the sidebar; another occurrence in the series remains.
4. The control is disabled while completion is pending, and a failed request keeps the row and exposes the inline error.

Use a small deterministic fixture rather than adding more seed data.

### API — `tests/api/tasks.spec.js`

Add coverage that creates linked `task` and `task-chunk` projections plus unrelated event sentinels, completes the task, and proves only the linked generated projections are removed.

## Final verification

Do not run tests during implementation. After the code, specs, and self-review are fully complete, run the required full suite once with:

```bash
npm test
```

If that final run exposes a defect, fix it and rerun the necessary verification before declaring the work complete.

## Acceptance criteria

- A recurring task occurrence can be completed from the Calendar sidebar in one click.
- The shortcut is never rendered for an ordinary task.
- The click never opens the editor, and duplicate submissions are blocked while pending.
- Only the selected occurrence completes; its series and sibling occurrences remain.
- The completed row and its generated calendar blocks disappear without a page reload.
- Failures remain visible without removing the task.
- Keyboard and screen-reader users can identify, focus, and activate the control.
- No unrelated calendar events are removed.
- The full test suite passes at finalization.
