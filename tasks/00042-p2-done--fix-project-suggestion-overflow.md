# Fix project suggestion overflow in the task editor

## Problem

In the new-task modal, the "Suggested:" row (`webinterface/src/components/ProjectSuggestions.vue`)
renders each recommendation as a button labelled `Role → Goal → Project`. The style rule
`.project-suggestions button { flex: 0 0 auto; }` prevents the button from shrinking, and
Bootstrap's `.btn` sets `white-space: nowrap`, so a long role/goal/project name pushes the
button past the modal's bounds.

## Fix

In `ProjectSuggestions.vue`:

- Let the suggestion buttons shrink and wrap instead of forcing their intrinsic width:
  `flex: 0 1 auto; max-width: 100%; white-space: normal; text-align: left; overflow-wrap: anywhere;`
- Keep the container `flex-wrap: wrap` so multiple suggestions stack cleanly, and make the
  `Suggested:` label `flex: 0 0 auto` so it stays on one line.
- Stack vertically when the row is narrow (buttons take full width) so a wrapped label still
  reads as one chip rather than a ragged inline blob.
- Consider rendering the label as segments (`group.label` muted, project title emphasised) only if
  it does not complicate the existing `data-test` hooks — visual polish is optional, no-overflow is required.

No JS/behaviour change is needed; the `options` computed label stays the same so existing specs
that match on the label text keep passing.

## Verification

- Add a UI spec (or extend an existing suggestion spec) that creates a Compass role/goal/project with
  very long names, opens the new-task modal, types a title, waits for
  `[data-test="project-recommendation-option"]`, and asserts the option's bounding box stays within the
  modal's bounding box.
- `npm test -- tests/ui/compass.spec.js` (or whichever spec covers suggestions) while iterating; full
  `npm test` before finishing.
- Manual check at a narrow viewport that the row still looks tidy.
