# Default Weekly Plan quick tasks to Friday

## Goal

Change the Weekly Plan quick-task due-date default from Sunday to Friday of the displayed Monday–Sunday week.

## Implementation

- Derive Friday with calendar-date arithmetic from the week’s Monday (`startDate + 4 days`) using the existing temporal helper.
- Use that Friday default when quick-task forms are initialized, when the saved timezone/week rolls over, and when a form resets after a successful task creation.
- Keep the selectable and validated weekly range Monday through Sunday; only the default changes.
- Update `docs/WEEKLY_PLAN.md` to describe the Friday default.

## Verification

- Update the Weekly Plan Playwright spec to expect Friday on initial load.
- Verify a successful quick add resets the due date to Friday.
- Run the focused Weekly Plan UI spec, then the full test suite during finalization.
