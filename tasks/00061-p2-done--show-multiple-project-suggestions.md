# Show every strong project suggestion, not just one

## Goal

When a new task's title matches several projects well, offer all of them instead of picking
one or abstaining. Today `recommendTaskProject` returns a single project and deliberately
returns nothing when the top two scores are within `MIN_MARGIN` — the exact case where the
user wants to see both options.

This is a creation-time assistance change only. The task schema, `projectRef`
representation, the explicit project/Unassigned gate, scheduling, and existing-task editing
are unchanged.

## Product decisions

- Show **up to 3** suggestions.
- A project qualifies when it clears **both** bars:
  - absolute: `score >= MIN_SCORE` (0.16, unchanged); and
  - relative: `score >= bestScore * 0.75`.

  A clear winner therefore still appears alone, while near-ties all appear.
- **Remove the tie abstention.** `MIN_MARGIN` goes away: ambiguity is surfaced to the user
  rather than hidden. Abstention remains only when nothing clears `MIN_SCORE` and there is
  no history fallback.
- The weak-text history fallback stays **single** (`confidence: 'likely'`), as today.
- Suggestions remain offers. Nothing is auto-selected; the user clicks one or uses the
  selector. Manual selection still cancels in-flight requests and beats stale responses.

## Service — `controllers/projectRecommendation.js`

Replace `MIN_MARGIN` with:

```js
const MAX_RECOMMENDATIONS = 3;
const RELATIVE_BAND = 0.75; // Keep near-ties; drop clearly weaker candidates.
```

`scoreProjects` already returns a deterministic descending list (score, then `projectId`
tie-break) — keep it. In `recommendTaskProject`:

1. Take `scored[0]` as `best`. If `best.score >= MIN_SCORE`, return every candidate with
   `score >= MIN_SCORE && score >= best.score * RELATIVE_BAND`, truncated to
   `MAX_RECOMMENDATIONS`, each as `{ projectId, confidence: 'high', evidenceCount }`.
2. Otherwise use `historyFallback` and return a single `'likely'` entry.
3. Otherwise return nothing.

Determinism matters: identical scores must always yield the same order, so keep the
`projectId.localeCompare` tie-break and introduce no randomness or time dependence.

## API — `POST /api/recommendTaskProject`

Add `recommendations` as the primary field and keep `recommendation` as its first entry (or
`null`) so the change is additive for any other caller:

```json
{
  "success": true,
  "recommendations": [
    { "projectId": "...", "confidence": "high", "evidenceCount": 3 },
    { "projectId": "...", "confidence": "high", "evidenceCount": 2 }
  ],
  "recommendation": { "projectId": "...", "confidence": "high", "evidenceCount": 3 }
}
```

An abstention returns `"recommendations": []` with `"recommendation": null`. Input bounds
(240 title chars, 2,000 notes chars, 500 candidate ids) and tenant/candidate filtering are
unchanged; only the response shape changes in `routes/tasks.js`.

## UI

Both surfaces render the same row and behave identically:

- `webinterface/src/components/TaskEditor.vue` (new-task project field)
- `webinterface/src/views/Calendar.vue` (standalone follow-up modal)

```text
Project*
[ Choose a project or Unassigned…                         ▾ ]
Suggested: [ Engineer → Migration plan ] [ Engineer → Hiring plan ]
```

- Each suggestion is its own button. Its text is the resolved `group → project` path the
  components already build, with a `title`/aria label of `Use <path>`. This replaces the
  single `Use this project` button.
- Clicking a suggestion sets `projectRef`, marks the choice made, clears the row, and
  cancels pending recommendation work — the same effects as `useRecommendation` today.
- Keep `data-test="project-recommendation"` and `data-test="followup-project-recommendation"`
  on the container; add `data-test="project-recommendation-option"` to each button.
- Replace the single `recommendation`/`recommendationLabel` state with a list, dropping any
  entry whose `projectId` does not resolve to a visible project group and hiding the row
  when none resolve. Read `recommendations` from the response, falling back to
  `[recommendation]` when only the legacy field is present.
- Recommendation failure still leaves the ordinary required selector usable.

## Verification

`tests/api/projectRecommendations.spec.js`:

- two projects with comparably strong evidence for one title return **both**, ordered by
  score;
- update the existing tied-twins case: identical twin projects now return both entries
  instead of `null` — this is the behaviour being fixed;
- a clear winner returns exactly one entry, with a weaker above-`MIN_SCORE` competitor
  excluded by the relative band;
- more than three qualifying projects truncate to three;
- weak text still returns a single `'likely'` history fallback;
- no evidence returns `recommendations: []` and `recommendation: null`;
- keep existing coverage for null-task exclusion, recurring dedup, tenant isolation,
  malformed candidates, cache clearing, and input bounds.

`tests/ui/calendar.spec.js`:

- update the mocked route to return two `recommendations`; assert both buttons render, the
  selector still shows the placeholder, and clicking the **second** suggestion selects that
  project;
- a single-suggestion response still renders one clickable suggestion;
- follow-up modal coverage mirrors this.

Iterate with `npm test -- tests/api/projectRecommendations.spec.js` and
`npm test -- -g "recommendation"`; run the full suite before finishing.

## Docs

Update `docs/PROJECT_RECOMMENDATIONS.md`:

- **Recommendation interaction** — show the multi-suggestion row and delete the claim that
  an ambiguous strong match produces no suggestion.
- **API** — document `recommendations`, the retained `recommendation` compatibility field,
  and the empty-array abstention.
- **Hybrid ranking** — describe the absolute + relative band and the three-suggestion cap in
  place of the margin rule.
- **Testing** — refresh the covered-behaviour list.

## Acceptance criteria

- Several comparably strong projects are all offered, up to three, ordered deterministically.
- A clear winner is still offered alone; weak text still yields one `likely` fallback; no
  evidence still yields nothing.
- No suggestion is ever auto-applied and the explicit project/Unassigned gate is unchanged.
- The task editor and the standalone follow-up modal behave identically.
- A recommendation outage still degrades to the plain selector.
- Docs updated and the full test suite passes.
