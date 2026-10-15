# Design system

One place decides what the app looks like: `webinterface/src/style/`. This manual covers the
tokens, the scales, and how to style a new component without inventing another grey.

## The three files

| File | What it is | When you touch it |
|---|---|---|
| `style/_tokens.scss` | Sass variables: every colour, size, radius, shadow and duration. No CSS output. | Changing the palette or adding a scale step. |
| `style/darkVariables.scss` | Maps tokens onto Bootstrap's Sass variables. Loaded **before** Bootstrap. | Restyling a Bootstrap component globally. |
| `style/base.scss` | Publishes tokens as CSS custom properties on `:root`, plus element defaults and button/form overrides. Loaded **after** Bootstrap. | Adding a global rule or a new token. |

`style/darkStyle.scss` imports them in that order and is the app's only stylesheet entry point.

> **Bootstrap is compiled from our tokens.** `main.js` deliberately does *not* import
> `bootstrap/dist/css/bootstrap.css` — that prebuilt file is the stock light theme. Importing it
> ships a second, conflicting copy of Bootstrap. `tests/ui/theme.spec.js` fails if it comes back.

## Using tokens

Component `<style scoped>` blocks cannot see Sass variables, so read tokens through the CSS
custom properties `base.scss` publishes:

```css
.my-panel {
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  color: var(--text-secondary);
  box-shadow: var(--elev-1);
}
```

Use the Sass variable form (`$surface-1`) only inside `style/*.scss`, which has them imported.

**A custom property must be published in `base.scss` before a component uses it.** An undefined
`var()` makes the whole declaration invalid — which, on a `background-clip: text` heading, means
text that silently disappears.

## The scales

### Surfaces

Depth is a step on one ramp, never an ad-hoc white alpha.

| Token | Use |
|---|---|
| `--surface-0` | Page background. |
| `--surface-1` | Cards, panels, the resting surface of a page section. |
| `--surface-2` | Raised: inputs, list rows, row hover on `--surface-1`. |
| `--surface-3` | Highest: dropdowns, popovers, active or hovered rows. |

Borders pair with them: `--border-subtle` inside a surface, `--border` for a normal edge,
`--border-strong` for emphasis and hover.

### Text

`--text-primary` (headings, values) · `--text-secondary` (body) · `--text-muted` (labels,
metadata) · `--text-faint` (placeholders, disabled).

### Accent

`--accent` is the solid indigo used by controls, with `--accent-600` / `--accent-700` for hover
and active and `--accent-300` / `--accent-100` for text on dark. `--accent-soft` and
`--accent-softer` are tinted backgrounds.

`--brand-gradient` (indigo → violet) is reserved for the brand wordmark and hero titles. **Do not
put it on buttons.**

### Status

Each status is a trio — solid fill, readable text, tinted background:
`--success` / `--success-text` / `--success-soft`, and the same for `warning`, `danger`, `info`.
On a dark surface, a status message wants `-soft` background with `-text` foreground.

### Space, radius, elevation, motion

- Space: `--space-1` (4px) … `--space-8` (64px).
- Radius: `--radius-xs` 4 · `--radius-sm` 6 · `--radius-md` 10 · `--radius-lg` 14 ·
  `--radius-xl` 20 · `--radius-pill`. Controls use `sm`, cards use `lg`.
- Elevation: `--elev-1` … `--elev-4`. A resting card is `elev-1`; a drawer or modal is `elev-3`/`4`.
- Motion: `--motion-fast` 120ms · `--motion` 180ms · `--motion-slow` 300ms, with `--ease`.

## Rules

**Hover changes colour, not geometry.** Transition `background-color`, `border-color`, `color`
and `box-shadow`. Do not `transform: translateY()` on hover: in a dense toolbar or table every
button jumps under the pointer. Transition those properties by name rather than using
`transition: all`.

**Never remove a focus indicator.** `base.scss` gives everything a `:focus-visible` outline. If a
control needs a different one, replace it — `outline: none` with a `box-shadow` ring is fine;
`outline: none` alone is not.

**Respect reduced motion.** `base.scss` has a global `prefers-reduced-motion` block. Anything
animated by JavaScript must check it too.

**Keep `data-test` attributes and accessible names.** The Playwright UI specs find elements by
`data-test`, by role and by accessible name. Restyling must not rename them.

## Native controls

`base.scss` sets `color-scheme: dark` on `html`. Without it the browser renders native widgets —
`<input type="time">` pickers, scrollbars, autofill — as light-on-dark and effectively invisible.

Bare `<input type="checkbox">` without Bootstrap's `.form-check-input` is themed with
`accent-color`, so it still matches.

`components/DateField.vue` themes `@vuepic/vue-datepicker` by driving its `--dp-*` variables from
our tokens. That block must stay **global, not scoped**, and keyed on `.dp--theme-dark`: the menu
teleports to `<body>`, outside the component's scope. See `docs/DATE_PICKER.md`.

## Adding a component

1. Lay it out with `--space-*`.
2. Pick the surface one step above its parent; border with `--border-subtle`.
3. Text: `--text-primary` for the thing itself, `--text-muted` for metadata.
4. Radius `--radius-md`/`lg`, shadow `--elev-1` at rest.
5. Hover: move to the next surface and/or `--border-strong`. Nothing shifts position.
6. Leave focus alone.

If a value you want is not in the scale, add it to `_tokens.scss` and publish it in `base.scss`
rather than hardcoding it in the component.
