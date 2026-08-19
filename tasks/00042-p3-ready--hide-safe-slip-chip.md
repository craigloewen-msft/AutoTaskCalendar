# Hide the "slot blocked → safe" chip until hovered

Cosmetic tweak on the calendar page (`webinterface/src/views/Calendar.vue`).

## Current behaviour

The slip-forecast chip renders `slot blocked → safe` at `opacity: 0.62` all the time,
becoming fully opaque when the surrounding `.task-item` is hovered. The risk variant
(`N late`) stays visible — that stays unchanged.

## Change

In the `<style>` block:

- `.slip-impact-chip.safe` → `opacity: 0` so the safe chip is invisible by default
  (still laid out and hoverable, so the reveal target exists).
- Replace the `.task-item:hover .slip-impact-chip.safe` reveal rule with
  `.slip-impact-chip.safe:hover` (keep `:focus-visible` and
  `[aria-expanded="true"]` so keyboard users and the open panel still show it).
- Add a short `transition: opacity 0.15s ease` for a clean fade.

No template/JS changes; text content and `data-test` hooks stay identical.

## Verify

- `npm test -- tests/ui/calendar.spec.js` — existing specs assert chip text and
  click behaviour; `toHaveText` works on opacity-0 elements, but confirm no spec
  relies on visibility. If Playwright's actionability check trips on a click,
  the spec already hovers/clicks the chip directly, which triggers the reveal.
- Manual check: safe chips invisible until hovered, risk chips unchanged.
