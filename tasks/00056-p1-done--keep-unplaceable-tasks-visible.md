# Keep unscheduled tasks visible in Calendar

## Goal

Make sure an active task does not appear to disappear from the Calendar sidebar when scheduling pushes it later or cannot assign it a time.

## Root cause

`Calendar.vue` applies its 14-day sidebar cutoff to every dated task. That cutoff exists to avoid showing many future recurring occurrences, but it also hides ordinary one-off tasks that calendar pressure pushes beyond day 14.

Tasks with no `scheduledDate` already remain in the API response and are grouped as **Unscheduled**, but that group currently sorts to the bottom and its rows have no clear status.

## Small fix

Change only `webinterface/src/views/Calendar.vue`:

1. Apply the 14-day cutoff only to dated recurring occurrences. Always keep active one-off tasks in the sidebar, even when scheduled farther out.
2. Sort the existing **Unscheduled** group before dated groups so tasks with no assigned time are immediately visible.
3. Show a concise **NEEDS TIME** badge on those task rows instead of the current empty deadline value.
4. Keep backlog, completed-task, and recurrence scheduling behavior unchanged.

No backend, schema, scheduling algorithm, API, or documentation changes are needed.

## Focused regression

Add one Calendar UI spec covering the display rules directly:

- an ordinary task scheduled beyond 14 days remains visible;
- a task with no `scheduledDate` appears in the leading **Unscheduled** group with **NEEDS TIME**;
- a dated recurring occurrence beyond 14 days remains hidden, preserving the original volume limit.

Run that focused spec while iterating, then run the full test suite during finalization.

## Acceptance criteria

- Active one-off tasks remain visible whether they are unplaced or scheduled more than 14 days away.
- Unplaced tasks are clearly identified near the top of the task list and remain editable.
- The recurring-occurrence window and all scheduling behavior remain unchanged.
- The focused regression and full test suite pass.
