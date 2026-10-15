# Style guide

The web UI has one dark theme. Every colour, radius, shadow and font comes from a design
token, so the look changes in one file and every screen follows.

## Where the theme lives

| File | What it holds |
| --- | --- |
| `webinterface/src/style/theme.scss` | The `--atc-*` CSS custom properties on `:root`. **The source of truth.** |
| `webinterface/src/style/darkVariables.scss` | Bootstrap Sass variables, set to the same values so stock Bootstrap components match. |
| `webinterface/src/style/darkStyle.scss` | The single Bootstrap build: variables, Bootstrap, fixes, tokens, base. Imported once from `main.js`. |
| `webinterface/src/style/darkFixes.scss` | The few overrides Sass variables can't express (tinted alerts, close button). |
| `webinterface/src/style/base.scss` | Global element styles: buttons, forms, modals, links, scrollbars, auth card, footer. |
| `App.vue` `<style>` | The app shell only: sticky navbar, brand mark, nav pills. |

Do not import `bootstrap/dist/css/bootstrap.css`. A second, unthemed Bootstrap would override
the themed one, and `tests/ui/theme.spec.js` fails if it comes back.

## The tokens

**Surfaces**, from the page up. Each level is a little lighter than the one below.

| Token | Use for |
| --- | --- |
| `--atc-bg` | The page background. Nothing else. |
| `--atc-surface` | Panels, cards, modals, sidebars. |
| `--atc-surface-2` | Rows and controls sitting on a surface (task rows, secondary buttons). |
| `--atc-surface-3` | Hover state of `surface-2`, chips, skeletons. |
| `--atc-hover` | A translucent hover wash for anything transparent. |
| `--atc-border` / `--atc-border-strong` | Hairlines; use strong for hovered or interactive edges. |

**Text:** `--atc-text` for content, `--atc-text-muted` for labels and secondary lines,
`--atc-text-subtle` for timestamps and hints. Do not add more greys.

**Accent:** `--atc-accent` (solid fills, primary buttons), `--atc-accent-hover`,
`--atc-accent-text` (links and accent-coloured text on dark), `--atc-accent-soft` (tinted
backgrounds), `--atc-accent-border`.

**Status:** `--atc-success`, `--atc-warning`, `--atc-danger`, each with a `-text` variant
for readable text and a `-soft` variant for tinted backgrounds.

**Shape and motion:** `--atc-radius-sm` (6px: buttons, inputs), `--atc-radius` (10px: rows,
menus), `--atc-radius-lg` (14px: panels, modals), `--atc-radius-pill`; `--atc-shadow-sm`,
`--atc-shadow`, `--atc-shadow-lg`; `--atc-focus-ring`; `--atc-transition` (120ms).

**Type:** `--atc-font` (Inter if installed, then the system UI font) and `--atc-font-mono`.
No web fonts are downloaded.

## Rules

1. **No raw colours in components.** Write `color: var(--atc-text-muted)`, not `#9aa3b2`.
   If no token fits, add one to `theme.scss`, and to `darkVariables.scss` if Bootstrap needs it.
   Translucent tints of a token's hue (`rgba(99, 102, 241, 0.12)`) are fine for one-off washes.
2. **No gradients on buttons or text.** Fill with solid colours. Hover changes colour, never position:
   no `translateY` lifts.
3. **Flat by default.** Panels use a `--atc-border` hairline. Save `--atc-shadow-lg` for
   things that float: modals, dropdowns, the task editor.
4. **Icons are inline SVG** using `stroke="currentColor"`, so they take the text colour. No
   emoji or Unicode glyphs as UI icons.
5. **Left-align content panels.** `#app` centres text globally (many views rely on it), so
   new panels, editors and forms set `text-align: left`.

## Colours that are deliberately not tokens

- **Role colours** in `webinterface/src/utils/roleColors.js`. They are derived from a role's
  position, and users recognise them, so leave them alone.
- **Calendar event fills** in `Calendar.vue` `loadCalendarEvents()`. DayPilot takes a literal
  `backColor`, so the values sit there: slate `#3a4560` for external events, indigo `#4f46e5` for
  scheduled task blocks.
- **The date picker** maps its own `--dp-*` variables onto tokens in `DateField.vue`; see
  `docs/DATE_PICKER.md`.
- **The slip-forecast panel** in `Calendar.vue` keeps its amber and red warning palette.

## Checking a change

```bash
npm run dev                                  # http://localhost:8080, log in as local-testuser
npm test -- tests/ui/theme.spec.js           # tokens, single Bootstrap build, navbar, 390px fit
```

Check Calendar, Weekly Plan, Compass and the task editor at desktop width and at 390px.
Those screens use the most surfaces and status colours.
