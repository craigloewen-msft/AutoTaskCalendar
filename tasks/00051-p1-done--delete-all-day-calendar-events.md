# Restore deletion controls for all-day calendar events

## Problem

All-day events are now rendered in a custom “All day” row instead of by DayPilot. This avoids timezone distortion, but it bypasses DayPilot’s built-in event delete control and `onEventDeleted` handler. The event remains in `EventDetails`, so it also continues to block time when tasks are scheduled.

## Requirements

- Every event in the custom all-day row shall show an `×` delete button.
- The button shall have an event-specific accessible name such as `Delete event: Holiday` and a delete tooltip.
- Clicking the button shall call the existing authenticated `/api/deleteEvent` endpoint with that event’s ID.
- After a successful response, the deleted event shall disappear from the all-day row without a page reload. Because the endpoint removes the `EventDetails` document, the event shall no longer participate in subsequent task scheduling.
- If deletion fails, the event shall remain visible and the error shall be logged consistently with timed-event deletion.
- Timed-event deletion behavior shall remain unchanged.

## Implementation

1. Update `webinterface/src/views/Calendar.vue` to render an accessible delete button inside each `.all-day-event` item.
2. Add a method that uses `/api/deleteEvent`, removes only the successfully deleted event from `allDayEvents`, and preserves it on API/network failure.
3. Style the event chip and compact `×` control so the control is visible at the top of the calendar and supports hover/focus states.
4. Reuse the existing backend deletion endpoint; no schema or scheduling changes are needed because scheduling already reads current `EventDetails` records.

## Verification

Per the revised scope, do not add or change automated tests for this fix. Run the existing lint and full test suites during finalization.

## Scope note

This restores the same local deletion semantics used by timed events. A future Google Calendar sync can re-import an externally owned event that still exists in Google; changing the remote event or maintaining a sync exclusion list is outside this regression fix.
