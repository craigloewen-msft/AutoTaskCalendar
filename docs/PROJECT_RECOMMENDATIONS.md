# Project recommendations for new tasks

This manual explains the creation-time project decision, the local recommendation model, its API, cache behavior, and how to maintain it.

## User workflow

Every general-purpose task creation form requires one explicit choice:

- an existing Compass project; or
- **Unassigned**, stored as `projectRef: null`.

The task schema and API representation have not changed. The form uses a temporary empty-string placeholder only while a new task is being drafted. That placeholder cannot be submitted and is never persisted.

The rule applies to user-facing creation paths:

- Calendar's shared task editor requires Project or Unassigned.
- A standalone follow-up requires Project or Unassigned.
- A follow-up created from an existing task inherits that task's `projectRef`.
- Weekly Plan already creates each quick task within the project whose card contains the form.

Existing tasks are unaffected. There is no legacy migration and no completion or editing gate.

## Recommendation interaction

After the user stops typing a meaningful title for one second, the client automatically calls the recommendation API. A result appears beneath the selector:

```text
Project*
[ Choose a project or Unassigned…                         ▾ ]
Suggested: Engineer → Ship v2 → Migration plan   [Use this project]
```

The suggestion is not a default value. The user must click **Use this project** or make a manual selection. Manual selection cancels outstanding recommendation work, and stale responses cannot overwrite it.

Strong text matches use the sparse model. When text evidence is weak, the service offers the most frequently used available project, breaking ties by recent use, as a `likely` fallback so the helper normally remains useful. A genuinely ambiguous strong match, unavailable history, or recommendation failure produces no suggestion. Manual project selection and Unassigned always remain usable.

## API

`POST /api/recommendTaskProject` is session-authenticated.

```json
{
  "title": "Call Priyanka about the migration rehearsal",
  "notes": "",
  "candidateProjectIds": ["...", "..."]
}
```

The candidate ids come from the Compass picker already visible to the client. The service limits the list, drops malformed ids, and intersects it with the authenticated user's project model. It never reveals whether a foreign id exists.

A strong match returns one candidate:

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

An abstention is successful and returns `"recommendation": null`. Scores are similarities, not calibrated probabilities, so the response exposes a confidence band rather than a percentage. The client derives the readable Role → Goal → Project path from its existing Compass data.

Input is bounded to 240 title characters, 2,000 notes characters, and 500 candidate ids.

## Model

The model is private to one user and runs inside the Node.js process. It makes no external request and requires no downloaded model, GPU, Python process, or third-party ML package.

### Features

Text is Unicode-normalized, lowercased, and represented as hashed sparse TF-IDF features in 32,768 slots. Features include:

- title-weighted words and adjacent word pairs;
- lower-weight notes;
- character 3–5-grams for names, identifiers, partial matches, and spelling variation.

Feature hashing bounds vocabulary memory. Cosine similarity compares sparse normalized vectors.

### Hybrid ranking

The score combines:

1. the closest retained historical task examples, which preserve uncommon names and phrases;
2. a centroid summarizing the vocabulary of each project; and
3. low-weight project, goal, and role metadata for cold start.

A strong text result must clear an absolute threshold and lead the runner-up. Weak text falls back to the most frequently used available project, breaking ties by recent use; a strong tie still abstains instead of inventing a winner.

### Training rules

MongoDB tasks and Compass records are the durable training source:

- only project-linked tasks owned by the user are included;
- null-project tasks are ignored because null may be either deliberate or historical;
- projects must still exist and belong to the user;
- recurring documents are collapsed by series/project so repeated occurrences cannot dominate;
- retained examples are balanced across projects;
- reads are capped at 500 projects, 3,000 task records, 256 total exemplars, and 32 exemplars per project.

A project centroid summarizes all bounded task samples read for that project even when only some individual examples are retained.

## Cache and restart behavior

The model cache is disposable. Existing task/project records are the source of truth, so a manual or accepted project choice is learned through the ordinary `projectRef` already saved on the task.

The process-wide cache:

- is keyed by user id;
- is capped at approximately 64 MB;
- evicts least-recently-used models to remain under the cap;
- evicts entries idle for 30 minutes;
- coalesces concurrent cold builds for one user;
- uses a generation counter so a cache clear during a build cannot publish stale data.

Each model contains a 128 KB IDF array plus bounded sparse centroids and examples. Normal accounts should remain around 0.5–2 MB including JavaScript overhead; conservative estimated sizes drive the process-wide cap.

After restart the cache is empty. The first recommendation for an account rebuilds from MongoDB and later requests reuse it. No learned choice is lost.

Derived model blobs are deliberately not persisted in v1. Persistence would duplicate source data and require model-version and stale-cache handling. Add versioned Mongo snapshots only if production measurement shows that cold builds repeatedly exceed the latency target; snapshots must remain optional caches, never authoritative data.

## Clearing stale cached models

Clear only the affected user's model after mutations that alter recommendation training data:

- task create, edit, delete, or reassignment;
- standalone or derived follow-up creation.

Completion does not change recommendation text or assignment and needs no cache clear.

`clearProjectRecommendationCache(user._id)` removes only that user's disposable cached model after task text or assignment data changes. It increments a generation counter so an older build already in flight cannot repopulate stale data. The next request lazily rebuilds from MongoDB; no learned task data is deleted.

Call it once, after all writes in a task create/edit/delete or reassignment operation succeed. Compass hierarchy metadata changes do not clear the cache; its existing behavior remains independent of this feature.

## Performance and failure behavior

The service bounds database reads, candidates, source text, sparse vector sizes, projects, and retained examples. The cache's estimated byte count includes a conservative allowance for JavaScript containers.

Recommendation is optional assistance. An internal failure returns the application's normal unsuccessful response, and clients silently retain the required manual selector. A recommendation outage must never prevent choosing a project or Unassigned.

Use focused synthetic performance tests to catch large regressions, but do not make tight wall-clock assertions. Host and database contention vary. Investigate persisting a versioned cache only after measuring representative production-sized accounts.

## Testing

`tests/api/projectRecommendations.spec.js` covers:

- rare-name and broader-vocabulary learning;
- metadata cold start;
- metadata and recent-history fallbacks plus tied abstention;
- null-task exclusion and recurring-series deduplication;
- tenant isolation and malformed candidates;
- stale-cache clearing after task mutations;
- deterministic input and memory bounds.

Calendar UI coverage verifies the explicit new-task choice, Unassigned persistence, recommendation confirmation, standalone follow-up choice, and existing edit/completion behavior. Weekly Plan remains covered by its project-scoped creation specs.
