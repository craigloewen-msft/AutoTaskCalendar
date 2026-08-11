# Default new Compass projects to today's start date

## Goal

When a user opens the Compass drawer to create a project, prefill **Start date** with today's civil date in the user's configured timezone. The field remains editable and clearable, so users can still create a parked “Someday” project by removing the date.

## Implementation

- Update `webinterface/src/components/CompassEditorDrawer.vue` so all newly created Compass items—including projects—use the existing `dateOnlyInTimeZone` helper for their initial start date.
- Preserve existing edit behavior: projects already saved without a start date must still open with a blank field.
- Preserve API behavior and the “Leave blank to park this as a someday project” workflow.

## Verification

- Add a regression case to `tests/ui/compass.spec.js` that opens a new project drawer and asserts that `#compass-start` contains today’s date.
- Exercise a non-UTC user/browser so the test confirms the default follows the user’s configured timezone rather than relying on UTC.
- Run the focused Compass UI spec while iterating, then run the full `npm test` suite during finalization.

## Expected files

- `webinterface/src/components/CompassEditorDrawer.vue`
- `tests/ui/compass.spec.js`
