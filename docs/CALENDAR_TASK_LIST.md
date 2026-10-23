# The calendar task list

The sidebar on the left of `/calendar` is the day-by-day reading of your open work. This
manual covers what a row shows and where each part comes from. It lives in
`webinterface/src/views/Calendar.vue`.

## What a row shows

Tasks are grouped by scheduled date (plus an `Unscheduled` group), and within a date sorted
by scheduled time. Each row is:

- **Title**, preceded by a `↻` icon for a task in a repeating series and a `🔗` icon when it
  has dependencies.
- **Row meta**, on the right: a `BACKLOG` or `NEEDS TIME` badge, or the day gap between the
  deadline and the scheduled date; then the quick-complete button (see
  `docs/TASK_COMPLETION.md`).
- **Project name**, on a second line, muted and truncated to one line.
- **Occurrence date**, `↻ for Fri 23 Oct`, when a recurring occurrence was scheduled on a
  different day from the one it belongs to. Without it, a Friday task listed under Tuesday
  reads as Tuesday's work.
- A blocked-slot chip when a forecast exists for that task (`docs/TASK_SLIP_FORECAST.md`).

This week's unfinished intentions get their own collapsible group below the dated ones; they
are never scheduled, so they carry an `INTENTION` badge instead of a day gap. See
`docs/INTENTIONS.md`.

Below that, a collapsed **Repeating tasks** drawer lists one row per series: its rule, where
its next occurrence landed, and its last completion. Unplaced recurring occurrences are kept
out of the dated groups, so the drawer is where they show. See `docs/RECURRING_TASKS.md`.

The quick-complete button on a recurring occurrence says so when it would complete the
occurrence **before its day** ("Complete the Fri 23 Oct occurrence of … early"), since that
week's slot is then gone for good.

## The project name

The point of the label is that a title does not have to repeat its project. "Update deck" is
enough when the row underneath it says `Perf pass`.

It is assembled entirely on the client from two things the calendar already loads:

1. `projectRef` on each task. `/api/getUserTasks` returns whole task documents, so the id is
   already there — nothing was added to the API for this.
2. `/api/getCompass`, already fetched for the task editor's project picker. `projectTitleById`
   flattens `roles → goals → projects` into an id→title map, **and merges `endedProjects`**
   from the same response. That second part matters: an open task can point at a finished
   project, which the live roles tree no longer contains, and without it that row would be
   silently blank.

`projectLabelFor(task)` returns the title, or `null`. Nothing renders when:

- the task is **Unassigned** (`projectRef: null`) — a chip on every stray task would be noise,
  not information; or
- the Compass request failed. That request is already caught and ignored so it can never block
  the calendar, which leaves the map empty and the labels absent. The rest of the sidebar is
  unaffected.

The label is display-only. No stored field changed, so scheduling, recurrence, the slip
forecast, intentions, weekly plan, export and calendar sync are untouched by it.

## Adding to a row

Rows are rendered twice — once in the dated groups, once in the intentions group. Anything
added to one must be added to the other or it silently vanishes for personal work. Keep new
elements out of `.task-primary-row`'s flex line unless they should compete with the title for
width, and give each a `data-test` attribute keyed by task id so specs can target one row.

Covered by `tests/ui/calendar-project-labels.spec.js` and
`tests/ui/calendar-recurring-series.spec.js`.

## Drag-to-create gutter

The week view sets DayPilot's `columnMarginRight: 14`, so events stop 14px short of each day
column's right edge. Drag in that strip to create a new event over or beside a busy slot.
Covered by `tests/ui/calendar-drag-gutter.spec.js`.
