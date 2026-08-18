# Require an explicit project choice and recommend projects for new tasks

## Goal

Every task created through the product UI must begin with a deliberate project decision: an existing project or **Unassigned**. Make that decision quick by offering a lightweight, private recommendation learned from the user's existing project-linked tasks.

This is a creation-time workflow only. It does not add completion gates or change existing-task behavior.

## Product decisions

- Keep `TaskDetail.projectRef` unchanged. A real project is stored as its ObjectId; **Unassigned** is stored as `null`.
- Do not add a project-selection state, fake Unassigned project, schema migration, or legacy-task handling.
- Enforce the decision in user-facing creation forms, not as a new database invariant. Existing API callers and old tasks remain compatible.
- A recommendation is an offer, not a silent assignment. It satisfies the gate only after the user clicks **Use this project** or chooses an option themselves.
- Existing-task editing, completion, chunk completion, project reassignment, and recurring-task behavior remain unchanged.

## Creation workflows

### Shared task editor

For a new task, replace the current preselected `— none —` value with a transient UI placeholder:

```text
Project*
[ Choose a project or Unassigned…                         ▾ ]

Suggested: Engineer → Ship v2 → Migration plan   [Use this project]
```

The select contains **Unassigned** plus the existing grouped project options. The placeholder is not a valid submission value. Choosing Unassigned converts to `projectRef: null` in the existing request shape; choosing a project sends its id.

Keep this state entirely in the new-task draft so `null` can continue to mean Unassigned in persisted data. Existing tasks open exactly as they do today and are not subjected to a new gate.

Request a recommendation automatically one second after the user stops typing meaningful title text, with cancellation/stale-response protection. Do not call on every keystroke. Show at most one compact suggestion; weak text uses the history fallback, while unavailable or ambiguous evidence leaves the ordinary selector available. Manual selection always wins and stops recommendation UI from changing the choice.

If Add task is pressed while the placeholder remains selected, keep the editor open, focus the Project field, and show `Choose a project or Unassigned.` The frontend must not post `/api/createTask` until the choice is explicit.

### Other creation surfaces

Cover every user-facing route that creates a task:

- Weekly Plan quick tasks already have their containing project and need no new control.
- A follow-up created from an existing task inherits that task's `projectRef`, including `null`.
- A standalone follow-up must offer the same project/Unassigned decision before it can be created. Reuse the recommendation service for its title rather than creating a second algorithm.

Seed factories, tests, and direct API clients are not user-facing creation forms and remain free to create `projectRef: null` records.

## Recommendation technology

Implement a small per-user sparse text model in Node.js. Do not add an LLM, embedding service, GPU dependency, Python service, or network call.

Use a hybrid score:

1. **TF-IDF nearest exemplars** preserve uncommon names and phrases from prior tasks.
2. **Per-project TF-IDF centroids** capture broader project vocabulary.
3. Project title, description, goal, and role text provide a low-weight cold-start document for projects with little task history.

Build features from a title-weighted combination of task title and notes using Unicode normalization, word tokens, and hashed character 3–5-grams. Character grams are important for names, identifiers, spelling variation, and partial matches. Score with cosine similarity and combine exemplar and centroid evidence.

Training rules:

- Use only the authenticated user's tasks with a non-null, still-owned `projectRef`.
- Ignore all null-project tasks because null does not distinguish deliberate Unassigned from old missing choices.
- Collapse recurring occurrences by series/project so a daily series cannot dominate its project.
- Balance retained exemplars across projects and cap their number; project centroids summarize the broader bounded history.
- Rank only candidate project ids currently available in the caller's loaded Compass picker. Intersect those ids with projects owned by the authenticated user before scoring or returning anything.
- Use a top-score and top-versus-runner-up margin to avoid ambiguous suggestions. When text evidence is weak, fall back to the most frequently used available project, breaking ties by recency; do not describe the score as a probability.

Keep feature extraction and scoring as pure functions where practical so the model can be tested deterministically.

## API

Add an authenticated endpoint such as:

```http
POST /api/recommendTaskProject
```

```json
{
  "title": "Call Priya about the migration rehearsal",
  "notes": "",
  "candidateProjectIds": ["...", "..."]
}
```

Return either no recommendation or one owned candidate:

```json
{
  "success": true,
  "recommendation": {
    "projectId": "...",
    "confidence": "high",
    "evidenceCount": 3
  }
}
```

The client already has the Compass hierarchy and derives the display path from `projectId`; do not duplicate hierarchy payloads. Reject or discard malformed and foreign candidate ids without leaking whether they exist. Apply modest title/notes length limits before feature extraction.

Recommendation failure must never block manual project selection or task creation. The UI quietly falls back to the normal required selector.

## Cache, memory, and restart behavior

MongoDB task/project data is the durable learning source. The in-memory model is only a disposable acceleration cache, so an accepted or manual choice is learned permanently through the task's existing `projectRef`.

Use a process-wide, size-bounded LRU cache keyed by user id:

- hard limit: approximately 64 MB for all cached users;
- idle/TTL eviction so rarely active accounts do not remain resident;
- bounded history and exemplar counts per user;
- fixed-size feature hashing and compact typed arrays where suitable;
- clear only the affected user's cached model after task mutations that change text or assignment.

A representative bounded model can use a 32,768-slot `Float32Array` for IDF (128 KB), sparse project centroids, and at most several hundred compact exemplar vectors. The raw numeric payload should normally be well under 1 MB per user; allowing for JavaScript object and indexing overhead, target roughly **0.5–2 MB for a normal account** and enforce a low-single-digit-MB per-user ceiling. The 64 MB LRU then bounds total process exposure regardless of account count.

After a server restart the cache is empty. The first recommendation for a user lazily rebuilds their model from MongoDB; subsequent requests use the cache. Coalesce concurrent rebuilds for the same user so one cold request cannot trigger duplicate work. No learned information is lost on restart.

Do not persist derived model blobs in v1. They would duplicate source data and add model-version, cache-clearing, and stale-cache failure modes. Instrument or benchmark cold build time; only add a versioned Mongo snapshot later if real accounts exceed the target (for example, a cold build repeatedly above 200 ms). A stored snapshot would remain an optional cache, never the source of truth.

## Likely implementation areas

- Add a focused recommendation controller/service and authenticated route.
- Update `webinterface/src/components/TaskEditor.vue` for the new-task-only decision sentinel, validation, recommendation request, and one-click acceptance.
- Update the Calendar follow-up flow to inherit or explicitly choose a project as described above.
- Invalidate the affected user cache from existing task/project mutation chokepoints without changing their behavior.
- Keep Weekly Plan's project-scoped quick-create flow unchanged.
- Add `docs/PROJECT_RECOMMENDATIONS.md` as the end-to-end manual and revise `docs/COMPASS.md` where it currently says project assignment is optional and unaligned work is never required.

## Verification

Add behavior-focused coverage for:

### API/model

- a rare person's name learned from project-linked history recommends the expected owned project;
- broader vocabulary can recommend through a project centroid;
- new-project metadata provides a cold-start signal;
- weak or tied evidence abstains;
- null-project examples are ignored;
- recurring occurrences do not multiply their influence;
- foreign tasks/projects never affect or appear in a recommendation;
- malformed candidate ids are safe;
- a relevant task mutation clears the cached user model and the next result reflects the change;
- bounded inputs remain deterministic and complete within the intended cold/warm latency budget.

### UI

- a new TaskEditor task cannot be submitted while the placeholder is selected;
- choosing Unassigned posts `projectRef: null` and creates the task;
- choosing an existing project posts its id;
- a returned suggestion is visible but is not selected until **Use this project** is clicked;
- a weak-text fallback is offered, while a failed recommendation leaves manual creation usable;
- editing an existing task has no new decision gate;
- a standalone follow-up requires a choice, while a follow-up from a task inherits its project;
- Weekly Plan quick creation remains project-scoped and unchanged.

Run focused API and Calendar/Weekly Plan specs while iterating. Run the full test suite only during finalization.

## Acceptance criteria

- Every task created from a user-facing UI carries either an explicitly selected project id or an explicitly selected `null` Unassigned choice.
- The persisted schema and `projectRef` API representation remain unchanged.
- The app offers a useful one-click project recommendation from private historical data and abstains when evidence is weak.
- Recommendation work performs no external calls, has bounded CPU/input/memory behavior, and degrades to the ordinary selector on failure.
- Restarting the server loses only the acceleration cache; recommendations rebuild from MongoDB without losing learned choices.
- Existing task, completion, chunk, recurrence, scheduling, and project-update behavior is unchanged.
- Focused regressions and the final full test suite pass.
