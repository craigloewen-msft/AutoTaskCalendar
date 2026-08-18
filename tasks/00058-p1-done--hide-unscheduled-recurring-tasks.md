# Hide unscheduled recurring tasks from the Calendar alert list

## Goal

Keep recurring occurrences without an assigned time out of the Calendar sidebar's leading **Unscheduled / NEEDS TIME** group. An unplaced recurring occurrence is acceptable and should not be presented with the same urgency as an ordinary task that still needs scheduling.

## Root cause

`Calendar.vue` currently keeps every task without a valid `scheduledDate` in the sidebar. This intentionally preserves one-off work that the scheduler could not place, but it also includes generated recurring occurrences, even though recurring work already has separate skip/next-available behavior.

## Implementation

1. Change the Calendar sidebar filter so a task identified as recurring by the existing `isRecurringTask()` helper is omitted when its `scheduledDate` is missing or invalid.
2. Preserve current behavior for:
   - ordinary unscheduled tasks, including their leading **Unscheduled** group and **NEEDS TIME** badge;
   - scheduled recurring occurrences inside the 21-day sidebar window;
   - recurring occurrences beyond that window, which remain hidden;
   - backlog tasks and all scheduler/API behavior.
3. Update `docs/RECURRING_TASKS.md` to state that only scheduled recurring occurrences appear in the sidebar.

This is a presentation-only fix in `webinterface/src/views/Calendar.vue`; no backend query, recurrence expansion, schema, or scheduling changes are needed.

## Regression coverage

Extend `tests/ui/calendar.spec.js` to prove that:

- an ordinary unscheduled task remains visible with **NEEDS TIME**;
- an unscheduled recurring occurrence is absent from the sidebar;
- scheduled recurring occurrences retain their existing visibility and window behavior.

Update the recurring-task creation scenario so it reflects the new contract: a newly materialized occurrence is hidden while unplaced, then appears as recurring after scheduling assigns it a time.

Run the focused Calendar UI specs while iterating, then run the full test suite during finalization.

## Acceptance criteria

- No recurring task or occurrence without a valid scheduled time appears in the **Unscheduled / NEEDS TIME** list.
- Ordinary tasks that genuinely need scheduling remain prominent and editable there.
- Scheduled recurring occurrences continue to appear normally within the sidebar window.
- The focused regressions and full test suite pass.
