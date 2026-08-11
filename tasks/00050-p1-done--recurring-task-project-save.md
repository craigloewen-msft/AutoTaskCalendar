# Persist project changes made through a recurring calendar task

## Problem

On Calendar, opening a materialised recurring-task occurrence, selecting a project, and clicking **Save changes** reports success but does not leave that occurrence assigned to the project.

The frontend already sends `projectRef` through the shared `TaskEditor`. The series-aware `/api/editTask` route correctly redirects an occurrence edit to its hidden series template. The persistence gap is in recurrence expansion:

- `projectRef` is not included among the fields inherited from a template by its occurrences;
- expansion keeps existing pending occurrences by identity but does not refresh any inherited fields on those survivors;
- consequently the template receives the selected project while the occurrences returned to Calendar and Weekly Plan remain unaligned;
- newly created recurring tasks also lose a selected project when their occurrences are first materialised.

This affects other template-owned edits too: the documented “edits apply to the whole series” behavior updates the template, but existing pending occurrences can keep stale title, notes, duration, chunking, priority, or dependencies. Completed occurrences must remain immutable history.

## Outcome

A project selected while editing any occurrence is saved on the series and immediately reflected by every pending occurrence. Reopening the task, reloading Calendar, and viewing project-grouped task data all show the saved project. New occurrences inherit it as well.

## Completed

Recurring-series edits now synchronize all template-owned fields—title, notes, duration,
chunking, priority, dependencies, and project—onto every pending occurrence immediately.
Completed occurrences remain immutable, and occurrence identity plus scheduler placement are
preserved. Normal expansion leaves existing occurrence fields alone so partial chunk progress
survives scheduling. Test changes developed for this task were removed at the user's request.
After rebasing onto `main`, the pre-existing `npm test` suite passes all 196 tests.

## Implementation

1. Update recurrence inheritance in `controllers/recurrence.js`:
   - add `projectRef` to the template-owned inherited fields;
   - when expanding a series, refresh all surviving **incomplete** occurrences from the current template-owned fields while preserving `_id`, `seriesRef`, `occurrenceDate`, completion state, and scheduling placement;
   - continue using the same inherited field set for newly materialised occurrences;
   - never rewrite completed occurrences.
2. Make `routes/tasks.js` run series expansion/synchronization after every series edit, including an occurrence edit whose API payload omits `recurrence`, rather than only when the recurrence rule is explicitly posted. Keep ordinary task edits on their existing path.
3. Do not add a schema or migration. Existing series repair themselves on edit or the next normal expansion/scheduling pass.
4. Update `docs/RECURRING_TASKS.md` to state that project alignment is inherited, pending occurrences are refreshed after a series edit, and completed occurrence history is not rewritten.

No frontend behavior change should be necessary unless implementation testing shows that the shared editor is not posting the selected `projectRef`; its current request construction already does so.

## Acceptance criteria

- Saving a project from an existing recurring occurrence succeeds and survives a page reload.
- The hidden series template stores the selected `projectRef`.
- Every pending occurrence in that series reflects the selected project immediately and future occurrences inherit it.
- Clearing or changing the project propagates by the same rules.
- Completed occurrences remain unchanged as historical records.
- Other series-owned edits consistently refresh pending occurrences without changing occurrence identity or scheduling state.
- Invalid or cross-user projects remain rejected by the existing ownership validation.
- The pre-existing `npm test` suite passes during finalization.
