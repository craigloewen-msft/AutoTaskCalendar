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
- A blocked-slot chip when a forecast exists for that task (`docs/TASK_SLIP_FORECAST.md`).

This week's unfinished intentions get their own collapsible group below the dated ones; they
are never scheduled, so they carry an `INTENTION` badge instead of a day gap. See
`docs/INTENTIONS.md`.

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

Covered by `tests/ui/calendar-project-labels.spec.js`.
