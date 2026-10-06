# Date fields and the date picker

Every date a user types in this app goes through one component:
`webinterface/src/components/DateField.vue`. There is deliberately no second way to enter
a date, so the control looks and behaves the same on every screen and in every browser.

---

## Why it exists

Date fields used to be bare `<input type="date">`. That leaves the picker entirely to the
browser: Chrome draws a small calendar icon, Firefox offers nothing to click, and mobile
Safari shows a spinner. The same form looked and behaved differently depending on where it
was opened.

`DateField` wraps [`@vuepic/vue-datepicker`](https://vue3datepicker.com) so there is one
calendar everywhere. The library is used rather than a hand-written calendar because
keyboard navigation, ARIA roles, focus handling and mobile behaviour are all things worth
not reimplementing. `bootstrap-vue-next` has no datepicker of its own — it was dropped in
the Bootstrap 5 rewrite — so a dependency was the only way to avoid writing one.

---

## Using it

```vue
<label for="task-due-date">Due date*</label>
<DateField id="task-due-date" v-model="draft.dueDate" required />
```

```js
import DateField from "./DateField.vue";
export default { components: { DateField } };
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `modelValue` | `String` | The date as `YYYY-MM-DD`, or `""` when empty. Use `v-model`. |
| `id` | `String` | Applied to the real input, so `<label for="...">` works. |
| `minDate` / `maxDate` | `String` | `YYYY-MM-DD` bounds; days outside are not selectable. |
| `disabled` | `Boolean` | Greys the field and blocks the calendar. |
| `required` | `Boolean` | Marks the input required and hides the clear button. |

It emits `update:modelValue` with a `YYYY-MM-DD` string, or `""` when cleared — never
`null` and never a `Date`.

### The value is always a civil date

The picker is configured with `model-type="yyyy-MM-dd"`, so the bound value is a plain
calendar date with no time and no timezone — exactly the format the API already exchanges.
This matters: a date here is a *day on a calendar*, not an instant. Never convert one with
a numeric offset or by adding milliseconds; see the temporal helpers in `utils/temporal.js`
and the note in `AGENTS.md`.

The field displays `09 Mar 2027` but stores `2027-03-09`. Typing is still allowed, and both
the display format and plain `YYYY-MM-DD` are accepted.

---

## Where it is used

| File | Fields |
| --- | --- |
| `components/CompassEditorDrawer.vue` | role/goal/project start and end dates |
| `components/TaskEditor.vue` | task start and due dates |
| `components/RepeatEditor.vue` | recurrence "ends on" date |
| `views/User.vue` | completed-task export range |

**One deliberate exception.** `components/WeeklyProjectCard.vue` keeps a bare
`<input type="date">`, but it is `visually-hidden`: the day-chip row is the real control and
the input exists only as its accessible source of truth. A calendar popover on an invisible
field would do nothing, so it stays as it is.

---

## Styling

The wrapper passes `form-control date-input` through to the real input, so the field sits
with ordinary Bootstrap controls. The calendar is dark-themed by overriding the library's
CSS variables (`--dp-background-color` and friends) in `DateField.vue`. Change them there
and every picker in the app follows; there are no per-screen date styles left.

The menu is rendered with `teleport="body"`, so it is never clipped by a drawer or modal
with `overflow: hidden`.

---

## Gotchas

- **The library's named export.** It is `import { VueDatePicker } from "@vuepic/vue-datepicker"`.
  There is no default export; importing one gives `undefined` and the component silently
  renders nothing at all, with no console error.
- **v14 moved several props.** Time is switched off with `:time-config="{ enableTimePicker: false }"`
  (not `enable-time-picker`), and the display format is `:formats="{ input: '...' }"`
  (not `format`). Older examples online use the v10 names, which are ignored silently —
  the symptom is a field that still shows `, 00:00`.
- **CSS class names changed too**, from `dp__*` to `dp--*`. Tests target `.dp--menu` and
  `.dp--cell-inner`.

---

## Tests

`tests/ui/date-picker.spec.js` covers the picker through the Compass drawer: opening the
calendar, clicking a day, the value reaching the API as `YYYY-MM-DD`, typing a date, Escape
closing the menu, and the end-date field staying disabled while an item is still active.

These are browser specs, so they run under the `ui` Playwright project:

```bash
npm test -- --project=ui
```

The `ui` project needs a real browser; if it is missing, install it once with
`npx playwright install chromium`. The specs read the built frontend the API serves from
`dist/`, so run `npm run build` after changing anything under `webinterface/src`,
otherwise you are testing the previous bundle.
