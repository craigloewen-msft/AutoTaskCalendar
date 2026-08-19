# Weekly Plan UX walkthrough with screenshots

Produce a visual, end-to-end walkthrough of the Weekly Plan feature in a real browser so the
flow can be reviewed as a user experiences it. This is an exploration/documentation task, not
a behaviour change — but any defect found along the way gets written down.

## Why

`docs/WEEKLY_PLAN.md` describes Plan mode, Review mode, and additive amendment in prose.
Nobody has looked at the whole arc as a sequence of screens. Screenshots make the gaps in
wording, affordance, and progress feedback obvious.

## Setup

- Start the stack with `npm run dev` (it starts MongoDB itself and prints the chosen ports).
  The current host's Mongo container did not become ready within the 90s startup budget on a
  first attempt, so allow a retry / check `docker logs autotaskcalendar-mongo`.
- Seed with `npm run seed` and sign in as `testuser` / `testpassword`.
- Weekly Plan needs Compass data (role → goal → project) to be interesting; verify the seeded
  user has active roles and started projects, and extend the seed locally if not.

## Walkthrough to capture

1. **Plan mode, empty week** — `/weekly-plan` before any commitment. Show the role → goal →
   project hierarchy, the in-week task checkboxes, *Other active tasks*, and *Completed last
   week*.
2. **Adding tasks** — use quick add to create two or three concrete tasks under different
   projects. Capture the add interaction and the updated hierarchy.
3. **Unchecking** — exclude one in-week task from the commitment; capture the checkbox state.
4. **Commit** — press *Commit to this week*; capture the immediate transition to Review mode
   (no reload).
5. **Mid-week review** — complete one task (Calendar) and move another's due date outside the
   week, then return to `/weekly-plan`. Capture the per-project progress block showing
   `done` / `open` / `moved`, and delete a task to show `removed`.
6. **Update the commitment** — quick-add a new task, capture the *added since commit* section,
   press *Update commitment*, and capture the amended snapshot.

Save screenshots in order with descriptive filenames so the sequence reads as a story.

## Deliverables

- An ordered set of screenshots covering the six stages above.
- Written commentary on each stage: what the user sees, what is unclear or surprising.
- A short list of concrete UX/wording issues found, each specific enough to become its own
  task. No fixes in this task.
- If any observed behaviour contradicts `docs/WEEKLY_PLAN.md`, note which is wrong (the doc or
  the code) rather than silently changing either.

## Out of scope

- Changing Weekly Plan behaviour, styling, or copy.
- Modifying the scheduling algorithm or the seed dataset beyond what is needed to make the
  walkthrough representative.
