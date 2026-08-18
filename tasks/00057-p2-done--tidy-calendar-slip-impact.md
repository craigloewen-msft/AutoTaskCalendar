# Make Calendar slip-impact rows compact and conditional

## Diagnosis

The Calendar task sidebar is fixed at 320px, while each `.task-item` currently places the task title, schedule/deadline badge, full `+1 day → …` control, and any recurring-task action on one non-wrapping line. Because `.task-row-meta` cannot shrink, the slip control takes space from the task title and makes the row look horizontally squashed.

Calendar also renders every non-null cached forecast, including forecasts with no downstream movement or newly missed deadline, as a `safe` chip. That creates visual weight without giving the user an impact to inspect.

## Implementation

Update `webinterface/src/views/Calendar.vue` only for the product behavior:

1. Add one visibility predicate for the slip affordance. Render it only when the task has a valid scheduled-date baseline, forecast data, and a meaningful downstream impact (`movedCount > 0` or `newlyLateCount > 0`). Missing forecasts, unscheduled tasks, and zero-count forecasts must leave no chip, label, or empty placeholder.
2. Move the visible slip control out of the title/status line and into its own wrapping row within the task card. Keep the existing deadline-gap badge and recurring quick-complete action on the compact primary row, and preserve the chip's click isolation, keyboard behavior, accessible label, selected state, and risk styling.
3. Adjust the task-card CSS so the slip row has enough horizontal room at desktop/sidebar widths and continues to wrap cleanly at the existing mobile breakpoints. Do not widen or compress the main calendar unnecessarily.
4. If a selected forecast becomes non-visible after task data refreshes, clear the selection so an orphaned expanded panel cannot remain open.

No scheduler, API, schema, or forecast-calculation changes are required.

## Regression coverage

Update the existing one-day-slip scenario in `tests/ui/calendar.spec.js` rather than adding a parallel test:

- keep asserting that the first capacity task's positive impact is visible, opens the cascade, remains keyboard-accessible, and survives reload;
- assert that the final capacity task and isolated task have no slip-impact control because their forecasts contain zero downstream impact;
- retain the read-only schedule/database assertions;
- keep the existing task-sidebar screenshot attachment and inspect it to confirm the positive chip has its own usable row and no longer squeezes the title.

## Documentation

Update `docs/TASK_SLIP_FORECAST.md` to explain that Calendar displays an at-a-glance control only for a cached forecast with downstream movement or newly missed deadlines. No control means the task lacks a valid cached scheduled forecast or the one-day simulation has no downstream impact; it must not be described as an on-screen `safe` chip.

## Verification

1. Run the focused Calendar slip-forecast Playwright test while iterating.
2. Inspect the task-sidebar and expanded-cascade screenshot attachments at desktop width.
3. Run the full `npm test` suite during finalization.

## Acceptance criteria

- A visible slip-impact control no longer competes horizontally with the task title and ordinary task status.
- Tasks with no valid scheduled baseline, no forecast, or a zero-count forecast render no slip-impact UI or blank spacing.
- Forecasts that move downstream work remain inspectable even when they do not newly miss a deadline.
- Positive deadline-risk chips retain their current semantics, accessibility, expanded cascade, highlighting, and read-only behavior.
- The focused regression and full test suite pass.
