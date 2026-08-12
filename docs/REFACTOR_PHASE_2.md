# Refactor Phase 2: data integrity and atomic projections

> **Status: future implementation manual.** Phase 2 has not shipped. Implement it only after
> separate approval, one test-first slice at a time.

## Purpose

Phase 2 makes stored data and multi-document writes trustworthy without changing the product
into multiple services or replacing MongoDB by default. It adds enforcement at the HTTP,
domain, Mongoose, and database boundaries; makes migrations and indexes explicit; removes the
legacy task `repeat` field completely after migrating it; and prevents concurrent recurrence or
scheduler runs from exposing duplicate, partial, or empty projections.

The user value is direct:

- malformed tasks cannot hang or corrupt the scheduler;
- scheduling failure leaves the last good calendar projection visible;
- recurrence expansion cannot create the same occurrence twice;
- deleting work cannot leave generated events or dependency references behind;
- Google events from different source calendars cannot overwrite one another; and
- operators can deploy, inspect, resume, and roll back data changes deliberately.

This phase preserves the existing modular-monolith deployment, recurrence rules, civil-date and
timezone semantics, completed occurrence history, Compass delete semantics, and current user
workflows.

## Prerequisites and fixed decisions

Before implementation begins:

1. Phase 0 and this plan must be approved. Do not combine Phase 2 with Phases 3-5.
2. Phase 1's startup/readiness and structured error/logging foundation should be deployed. If it
   is not, Phase 2 must add only the minimal startup gate and structured data-integrity events
   named here; it must not absorb the rest of Phase 1.
3. Obtain production topology, MongoDB version, data size, index size, backup, restore, RPO, RTO,
   and deployment-process facts listed under [Unresolved deployment questions](#unresolved-deployment-questions).
4. Take representative `explain("executionStats")` baselines for the queries listed under
   [Index manifest](#index-manifest), plus p50/p95 durations from production if available.
5. Run the read-only integrity audit on a restored production snapshot. Semantic repairs must not
   be guessed during deployment.
6. Prove backup restoration into an isolated database before the first destructive migration.
7. Prove every application environment can use MongoDB transactions. The current local/test
   `mongo:7` container is standalone and does **not** meet this prerequisite.

The following decisions are already fixed by approved Phase 0:

- Keep one web application, one API process boundary, and one primary database: no microservices,
  event bus, or distributed scheduler.
- Harden MongoDB first. PostgreSQL is considered only at the explicit decision gate below.
- Do not replace Moment, Mongoose, Vue, Express, or the existing temporal representation as part
  of this phase.
- Migrate all remaining legacy recurrence data and then remove the `repeat` field, compatibility
  request names, runtime fallback, seed fixtures, tests, and active documentation. A permanent
  fallback is not acceptable.
- Each slice must be independently testable and deployable. Destructive contract changes follow,
  rather than precede, compatible data migration.

## Scope

### In scope

- Strict request schemas and cross-field/domain validation for task, recurrence, completion,
  event, working-preference, and Compass writes.
- Mongoose and MongoDB collection validation for durable field and state invariants.
- Named, versioned, checksummed, resumable migrations and a read-only integrity audit.
- Query-driven compound, partial, and unique indexes with an explicit deployment mechanism.
- Complete migration and removal of the legacy task `repeat` field and `taskRepeat` alias.
- A database-backed, lease-based per-user planning lock with fencing tokens.
- A transaction capability/topology gate and bounded transaction retries.
- Unique recurrence identity, atomic per-series materialization, and upserts.
- In-memory schedule calculation followed by one atomic projection commit.
- A total deterministic scheduler comparator and meaningful progress detection.
- Transactional task/series cleanup, Compass cascades, follow-up creation, and completion cleanup.
- Orphan auditing and explicit repair policies.
- Google source-calendar identity and all-or-nothing local sync application.
- Concurrency, transaction-abort, duplicate, and injected-failure tests.
- Rollout, telemetry, backup, rollback, and a MongoDB-versus-PostgreSQL decision record.

### Out of scope

- Authentication, OAuth nonce/token security, HTTP status policy, centralized error handling, and
  provider retry semantics owned by Phase 1. Phase 2 may consume those boundaries.
- Broad route/use-case decomposition owned by Phase 3. New Phase 2 modules are narrow data
  boundaries, not a general backend rewrite.
- Vue transport/store/page decomposition owned by Phase 4. Only callers that send removed or
  server-owned fields are adjusted here.
- Linting, dependency cleanup, build changes, and CI trigger changes owned by Phase 5. Adding a
  focused validation dependency and migration scripts is allowed.
- New recurrence frequencies, scheduling policy, visual redesign, task-instance editing, account
  deletion, or changing completed-history meaning.
- PostgreSQL implementation. This phase produces evidence and a decision; a database migration
  would require its own approved program.
- Replacing civil-date markers, IANA timezones, all-day event semantics, or advancing dates with
  numeric offsets/milliseconds.

## Requirements

### Validation and storage

- **REQ-RF2-001:** The implementation shall preserve the current temporal, tenant-isolation,
  recurrence-history, scheduling, and Compass cascade behavior except for defects explicitly
  corrected by this plan.
- **REQ-RF2-002:** When any body, path, or query input reaches a route, the system shall validate
  an explicit allowlist, JSON types, bounds, nullability, and unknown fields before performing a
  database read or write.
- **REQ-RF2-003:** When valid individual fields form an invalid state, the domain validator shall
  reject the state, including invalid task-kind, date, chunk, recurrence, ownership, and
  reference combinations.
- **REQ-RF2-004:** When an application or migration writes through Mongoose, schema validation
  shall enforce the same single-document invariants; update operations shall not silently bypass
  validators.
- **REQ-RF2-005:** Once legacy rows pass the audit, MongoDB collection validators shall reject
  malformed durable types and forbidden legacy fields even if a write bypasses the HTTP API.
- **REQ-RF2-006:** When a request names a task, project, parent, dependency, series, or event, the
  write shall verify that every referenced document exists and belongs to the same user in the
  transaction that commits the write.

### Migrations and indexes

- **REQ-RF2-007:** When the data shape or index manifest changes, an immutable, versioned,
  checksummed migration shall apply and verify the change exactly once; interrupted batch work
  shall resume without repeating destructive effects.
- **REQ-RF2-008:** When application startup observes an unsupported topology, failed migration,
  schema version outside the release's compatibility range, or missing required index, readiness
  shall fail and writes shall remain disabled; startup shall never auto-run a migration.
- **REQ-RF2-009:** Every production index shall have a stable name, an owning query, a duplicate
  and size preflight, and before/after query-plan evidence. The migration shall not use
  `syncIndexes()` to drop unlisted indexes implicitly.
- **REQ-RF2-010:** Before the occurrence identity index becomes unique, the migration shall detect
  every duplicate key. It shall repair only unambiguous pending duplicates and shall stop with a
  report rather than discard ambiguous completed history.

### Complete legacy recurrence removal

- **REQ-RF2-011:** When an incomplete, non-backlog legacy task contains a supported `repeat` value
  and no modern rule, the migration shall create the equivalent canonical recurrence rule using
  interval `1`, empty day filters, no end, and `whenUnschedulableBehavior: "skip"`.
- **REQ-RF2-012:** When both recurrence representations exist, a valid modern `recurrence` shall be
  authoritative; a conflict or invalid value shall be reported before the legacy field is unset.
- **REQ-RF2-013:** After migration verification, zero task documents shall contain the `repeat`
  path, and no schema, API, runtime query/fallback, frontend caller, seed, active test, or active
  manual shall read, accept, write, or describe that legacy field or the `taskRepeat` alias.
- **REQ-RF2-014:** If a client sends `repeat` or `taskRepeat` after the contract release, request
  validation shall reject the request; the server shall not silently translate it.

### Concurrency, transactions, recurrence, and scheduling

- **REQ-RF2-015:** Before transactional Phase 2 behavior is enabled, every environment shall prove
  replica-set or sharded-transaction support with a commit/abort smoke test; there shall be no
  non-transactional production fallback.
- **REQ-RF2-016:** When operations for one user can alter scheduling inputs, recurrence
  materialization, cascades, sync cache, or schedule output, they shall serialize through one
  database-backed per-user planning lease. Operations for different users shall remain
  concurrent.
- **REQ-RF2-017:** If a lease expires or is stolen, its fencing token shall prevent the stale owner
  from committing. Lock acquisition shall have a bounded wait and return a retryable busy result
  without writes.
- **REQ-RF2-018:** When MongoDB labels a transaction failure transient or its commit result
  unknown, the transaction boundary shall retry a bounded, idempotent unit and resolve commit
  identity; all other failures shall abort without a partial result.
- **REQ-RF2-019:** While an occurrence belongs to a live series, it shall have exactly one identity
  `(userRef, seriesRef, occurrenceDate)`. Creation shall use `$setOnInsert` upserts protected by a
  unique partial index, not a read-then-`insertMany` decision. When completed history is detached
  during series deletion or repair, its `_id` and `occurrenceDate` remain its immutable historical
  identity while `seriesRef` becomes null deliberately.
- **REQ-RF2-020:** A series create/edit/removal and its pending occurrence materialization shall be
  one transaction. Completed occurrences shall not be removed or have authored/completion fields
  rewritten; the only permitted series-lifecycle change is deliberate `seriesRef` detachment under
  REQ-RF2-019 and REQ-RF2-026.
- **REQ-RF2-021:** The scheduler shall calculate and validate a complete proposed projection in
  memory before deleting or changing the current projection.
- **REQ-RF2-022:** When the proposed projection is valid and the input revision is unchanged, one
  transaction shall replace generated task events, update all affected `scheduledDate` values,
  and record the projection revision. Any calculation, guard, write, or commit failure shall leave
  the previous committed projection intact.
- **REQ-RF2-023:** Scheduler candidate selection shall use one exported total comparator with
  explicit handling for backlog/null due dates and a stable ObjectId tiebreaker; it shall not
  depend on incidental MongoDB or array order.
- **REQ-RF2-024:** A scheduler iteration shall count as progress only when time, event position,
  pending work, scheduled work, expiry, or remaining chunk duration advances monotonically. A
  no-progress or hard-iteration limit shall fail the run and shall never publish a partial
  projection.
- **REQ-RF2-025:** Every application-controlled mutation of scheduling input shall increment a
  per-user planning revision in the same transaction. The last committed projection revision
  shall make stale projections observable.

### Cascades, sync, operations, and decision gate

- **REQ-RF2-026:** When a task or pending series occurrence is deleted, the same transaction shall
  remove its generated task events and pull its ID from same-user `dependsOn` arrays. Series
  deletion shall preserve completed occurrence documents without leaving a dangling `seriesRef`.
- **REQ-RF2-027:** When Compass cascade is confirmed, unlinking tasks and deleting projects, goals,
  and roles shall commit atomically; a failure at any stage shall leave the original subtree and
  links intact.
- **REQ-RF2-028:** The integrity audit shall detect missing and cross-user series, dependency,
  project, Compass-parent, event-task, and Google-source references, and shall apply only the
  documented repair policy.
- **REQ-RF2-029:** A Google event shall be identified by
  `(userRef, sourceCalendarId, externalEventID)`. The same provider event ID in two calendars shall
  produce two local records, while repeated sync of one source shall update one record.
- **REQ-RF2-030:** If any selected calendar fetch, transformation, lease, transaction, or commit
  fails, Google sync shall not prune or partially replace the previously committed local cache.
- **REQ-RF2-031:** Migration, lock, recurrence, schedule, cascade, orphan, sync, transaction, and
  query-plan operations shall emit the bounded metrics and structured events defined below,
  without user text, OAuth credentials, or provider payloads.
- **REQ-RF2-032:** Before destructive migration, the operator shall record and verify a restorable
  backup. After destructive migration, rollback shall use the compatibility matrix and snapshot
  restore rather than an invented lossy down-migration.
- **REQ-RF2-033:** Before Phase 2 is accepted, concurrency and injected-failure tests shall prove
  uniqueness and all-or-nothing behavior at every multi-document boundary.
- **REQ-RF2-034:** If MongoDB cannot satisfy the topology, transaction-duration, query, reporting,
  or integrity thresholds at the decision gate, implementation shall stop and produce a
  PostgreSQL ADR/task rather than weaken these requirements.

## Validation contract

### Boundary design

Add declarative request schemas under `validation/` using Ajv with `coerceTypes: false`,
`removeAdditional: false`, and `allErrors: true`. Use the existing temporal helpers for civil-date,
instant, wall-time, and IANA-timezone refinements; do not trust generic JavaScript date coercion.
Each route validates only its transport shape, including ObjectId path/body values and bounded
pagination/date query values, then calls a shared domain validator for merged create/edit state and
reference ownership. Read schemas include event-week dates, completion windows, Compass archive
level/limit/skip/windows, and any future filter before it reaches Mongoose.

Use these policies:

- JSON numbers must already be finite numbers; strings such as `"30"`, `NaN`, and infinities are
  invalid. The Vue callers already submit numbers.
- Create schemas require their complete authored state. Edit schemas are patches, but validation
  runs again on the merged persisted state.
- Unknown keys are rejected. First change `TaskEditor.vue` to send `{ _id, ...fields() }` rather
  than spreading the server response into edits.
- Server-owned fields (`userRef`, `completed`, `completedDate`, `scheduledDate`, `seriesRef`,
  `occurrenceDate`, event `type`/`taskRef`, and response-only `seriesRecurrence`) are never authored
  through general create/edit APIs.
- Keep the post-Phase-1 error envelope and status policy. If Phase 1 is not yet deployed, preserve
  the current `{ success: false, log }` compatibility while centralizing validation messages.
- Use stable machine error codes in logs/metrics. User messages may remain concise and field based.

### Exact field rules

These are implementation defaults, not permission for callers to rely on Mongoose coercion:

| Area | Required durable rules |
|---|---|
| Text | Trim titles; require 1-500 Unicode characters. Notes/descriptions are strings up to 10,000 characters. Do not alter HTML-looking text. |
| Task duration | Integer minutes `1..525600`. The migration must report existing zero/negative/non-numeric values rather than invent work duration. |
| Chunking | `breakUpTask` is boolean. If false, chunk duration is null. If true, chunk duration is an integer `1..duration`. Completion `chunkDuration` is an integer `1..remaining duration` and is allowed only for a chunked, incomplete task. |
| Priority/sort | Priority is an integer `0..1000000`, default `100`. Compass `sortOrder` is an integer `-1000000..1000000`, default `0`; do not use `Number(x) || 0`. |
| Dates | Authored task/Compass dates use strict `YYYY-MM-DD`; events use offset/Z instants. A non-backlog task requires due and start dates with due on/after start. A backlog has no due date and no recurrence. Compass end is on/after start. |
| Recurrence | Frequency is `daily`, `weekly`, `monthly`, or `yearly`; interval is integer `1..366`; weekdays are unique integers `0..6`; month days are unique `1..31` or `-1`; `endsAfter` is integer `1..1000000`; `endsOn` and `endsAfter` are mutually exclusive; end date cannot precede series start. Inapplicable day filters are rejected rather than silently retained. |
| Task kinds | Template: recurrence present, no `seriesRef`/`occurrenceDate`, not backlog, not scheduled. Occurrence: recurrence null, both `seriesRef` and `occurrenceDate` present, not backlog. Plain task: recurrence null and both occurrence identity fields null. |
| Completion | `completed` is a required boolean after normalization. Completed date is an instant present iff completed. General edit cannot change either field. Completion and chunk endpoints own the transition. |
| References | ObjectIds must parse, be unique within arrays, and be same-user. Cap dependencies at 100. Reject self-dependency and cycles against the transaction snapshot. Project/parent refs must exist and belong to the user. |
| Events | User events require title, valid start/end instants, and end after start. `calendar` events have no task/provider identity. Generated `task`/`task-chunk` events require a same-user task. Google events require both source identity fields. |
| Working preferences | Reuse the current valid IANA zone and `HH:mm` parsing; minute values are integers `0..1439`, end is after start, and working days are a non-empty unique subset of the seven named weekdays. |
| Google selection | `selectedCalendars` is a unique array of at most 100 non-empty strings, each at most 1,024 characters. Calendar IDs are opaque; never parse them as email addresses. |

Mirror single-document rules in `models/index.js`: explicit `required`, `enum`, `min`, `max`,
`validate`, defaults, and `strict: "throw"`. Always pass `{ runValidators: true, context: "query" }`
through a focused update helper. Cross-document and merged-state rules remain in the domain
validator because Mongoose path validators cannot enforce them reliably.

After the audit is clean, apply named MongoDB `collMod` validators from
`models/collectionValidators.js` in `validationLevel: "strict"` and `validationAction: "error"`.
Roll them out first as `moderate`/`warn` in the compatible release. The contract validator must reject
presence of the legacy `repeat` property through explicit JSON Schema property/allowlist logic;
`missing` is not a BSON type.

## Proposed files and boundaries

Do not move unrelated feature logic in this phase. Add the smallest boundaries needed to make
data writes explicit:

| File/boundary | Future responsibility |
|---|---|
| `validation/requestSchemas.js` | Compiled HTTP schemas and stable field errors. |
| `validation/taskState.js` | Merged task-kind, recurrence, date, chunk, and dependency rules. |
| `validation/eventState.js` | User/generated/Google event state rules. |
| `validation/compassState.js` | Compass merged-state and parent rules. |
| `models/index.js` | Mongoose field definitions only; remove `repeat`; declare planning-state/lease/migration models or export focused model files if the change stays reviewable. |
| `models/indexManifest.js` | Stable index names, definitions, and owning query labels. No implicit index deletion. |
| `models/collectionValidators.js` | Versioned MongoDB validator definitions. |
| `persistence/transaction.js` | Session options, bounded retry, commit identity, and failure-injection hook. |
| `persistence/userPlanningLease.js` | Database lease acquisition, renewal, fencing assertion, release, and contention metrics. |
| `persistence/planningState.js` | Input/projection revisions and stale-state reads. |
| `persistence/recurrenceProjection.js` | Transaction-aware occurrence queries, bulk upserts, stale cleanup, and counts. |
| `persistence/scheduleProjection.js` | Atomic generated-event/`scheduledDate` replacement. |
| `migrations/runner.js` | Ordered checksums, global migration lease, plan/dry-run/apply/verify, and resumable checkpoints. |
| `migrations/0001-integrity-baseline.js` | Normalize lossless booleans/nulls, report semantic violations, and apply unambiguous orphan repairs. |
| `migrations/0002-remove-legacy-repeat.js` | Convert supported legacy templates, verify recurrence, unset every legacy path, and materialize affected series. |
| `migrations/0003-google-source-identity.js` | Stage source-aware identity and retire source-less cache only after successful replacement. |
| `migrations/0004-indexes-and-validators.js` | Build/verify named indexes and promote collection validators. |
| `scripts/migrate.js` | Operator CLI: `--plan`, `--dry-run`, `--to`, `--verify`, and explicit apply. |
| `scripts/audit-integrity.js` | Read-only counts and redacted IDs for invalid states, duplicates, and orphans. |
| `controllers/recurrence.js` | Keep pure recurrence validation/generation; delegate persistence; delete all legacy helpers. |
| `controllers/scheduling.js` | Pure comparator and projection calculation; no writes while calculating. |
| `controllers/taskController.js` | Completion orchestration through lease/transaction; remove legacy clone path. |
| `controllers/eventController.js` | Source-aware sync staging and transactional cache application. |
| `controllers/compassController.js` | Existing feature boundary, now using transactional cascade helper. |
| `routes/tasks.js`, `routes/events.js`, `routes/compass.js`, `routes/auth.js` | Validate transport, acquire/call one operation, translate the result. No direct multi-document sequence. |
| `scripts/db.js`, `instance.js`, `tests/fixtures/db.js` | Single-node replica-set local/test topology and transaction capability checks. |
| `app.js` | Readiness gate for topology, migration compatibility, validators, and required indexes. Never apply migrations. |

`utils/temporalMigration.js` and `temporalDataVersion` remain a separate, already-deployed
per-user semantic migration until the production audit proves all accounts are current. Serialize
that login-time path through the same per-user lease so it cannot overlap Phase 2 writes. Do not
reinterpret historical civil dates merely to move code into the new global runner. Record a
separate retirement decision once all users are current.

## MongoDB topology and transaction gate

### Required topology

Transactions require a replica set or sharded cluster. For local and test use, change the shared
container to one MongoDB 7 single-node replica set with a stable replica-set name, initiate it
idempotently, wait for primary state, and include the replica-set option in every connection URL.
Preserve per-branch database-name isolation. Document and test conversion of the existing named
Docker volume; never delete it automatically when enabling the replica set.

For every environment, the gate must check:

1. `hello` reports a writable primary and a replica-set name (or supported mongos topology).
2. Logical sessions are available and the configured MongoDB/Mongoose versions support
   transactions.
3. A smoke transaction can insert a marker and abort it, then insert/commit another marker and
   remove it.
4. Read concern `snapshot`, write concern `majority`, and the chosen transaction timeout are
   accepted.
5. The application principal can read index/validator metadata and perform normal transactions;
   the migration principal separately has `createIndex`/`collMod` privileges.

If any check fails, readiness is false. Do not catch the error and execute today's delete/rebuild
sequence.

### Transaction boundary

`persistence/transaction.js` owns one session per attempt and uses MongoDB's transaction labels.
Retry the entire idempotent callback at most three times with jitter for
`TransientTransactionError`. Resolve `UnknownTransactionCommitResult` using the operation's stable
ID and committed planning/projection metadata before retrying commit. Never retry validation,
duplicate-history, lease-loss, or permanent provider errors.

Keep transactions short: external Google calls and schedule calculation occur before the write
transaction. No network call occurs inside a transaction. Measure read/write counts, bytes, and
duration against production-like data; the MongoDB-versus-PostgreSQL gate applies if a user's
atomic unit cannot fit safely within deployment limits.

## Per-user concurrency and revisions

Create one persistent planning-state/lease document keyed by user ID with `ownerToken`, monotonic
`fence`, `leaseUntil`, revisions, and timestamps. The unique `_id` is the lock. Never TTL-delete or
recreate this row: preserving the fence counter prevents a stale owner from matching a reused fence.
Acquisition atomically creates the first row, renews for the same owner, or takes an expired lease
while incrementing `fence`. A heartbeat extends long calculations. Release clears lease ownership
but preserves the fence and filters on owner/fence, so one request cannot release another's lease.

Use one planning lease for all writes that can race scheduler input/output:

- task/series create, edit, complete, chunk complete, delete, and follow-up;
- recurrence materialization and schedule runs;
- user working-time/day/timezone changes;
- user event create/edit/delete and Google cache application; and
- all Compass parent/project relationship mutations, including task linking and destructive
  cascades, so a child or link cannot commit against a concurrently deleted parent.

A local in-process queue may reduce duplicate requests, but the database lease is authoritative
across tabs, workers, and API replicas. Default acquisition should wait briefly (for example two
seconds), then return a retryable busy response with no write. Lease duration and heartbeat are
configuration, not hard-coded assumptions.

Store one planning-state row per user with `inputRevision`, `projectionRevision`, last operation
ID, and timestamps. Every committed scheduling-input mutation increments `inputRevision`. The
scheduler captures it before calculation and its commit transaction verifies it is unchanged and
that the lease fence still belongs to the caller. On success it sets `projectionRevision` to the
captured input revision. A later event/task mutation naturally makes the projection observably
stale; it does not rewrite history or pretend an automatic schedule run occurred.

## Versioned migration mechanism

The runner uses a `schema_migrations` collection with immutable version/name/checksum, state,
started/completed timestamps, application version, checkpoint, counts, and redacted failure code.
A separate singleton lease prevents two operators from applying migrations. A changed checksum
for an applied version is fatal: add a new migration instead.

Each migration implements:

1. `preflight()` — read-only topology, backup marker, disk/headroom, duplicates, invalid rows,
   compatibility, and expected-count checks;
2. `up()` — idempotent bounded batches with a stable ordering and checkpoint;
3. `verify()` — independent queries proving postconditions; and
4. optional `cleanup()` only for temporary migration metadata, never user data.

`--plan` prints pending versions and compatibility. `--dry-run` runs preflight/audit only.
`--verify` performs no writes. Applying requires an explicit confirmation containing the database
name and backup ID. The application reports required/current versions in readiness but never runs
`up()` during a web request or startup.

Do not add generic down migrations for destructive transforms. Roll forward when safe; restore a
verified snapshot when the old representation is required.

### Integrity baseline and repair policy

The audit groups counts by user and emits redacted document IDs to a protected report. It must
cover validation violations, duplicate occurrence keys, and every relationship below.

| Finding | Automatic policy after backup | Reason |
|---|---|---|
| Pending occurrence with missing/wrong-user template | Delete the occurrence and its generated events. | It is a recreatable projection and cannot be authorized safely. |
| Completed occurrence with missing/wrong-user template | Set `seriesRef` to null; preserve all authored/completion fields. | History is permanent; a dangling relationship is not. |
| Missing/wrong-user task `projectRef` | Set it to null. | Compass deletion already defines unlinking as safe. |
| Missing/wrong-user `dependsOn` entry | Pull only that ID. | A nonexistent prerequisite cannot become complete; preserve the task. |
| Generated task event with missing/wrong-user task | Delete it. | It is a recreatable schedule projection. |
| `taskRef` on user-authored/Google event | Unset it after reporting. | Those event kinds do not belong to task projection. |
| Goal with missing/wrong-user role; project with missing/wrong-user goal | Stop for operator decision. | Strategic records are authored data; there is no safe parent to invent. |
| Duplicate pending occurrence identities only | Keep the oldest `_id` only if every authored/progress field is equal; delete duplicate generated events and rebuild projection. Otherwise stop. | Avoid choosing between divergent progress values. |
| One completed plus pending duplicates | Preserve the completed row and remove pending projections after reporting. | Completed history is authoritative for that identity. |
| Two or more completed duplicates | Stop for operator decision. | Never discard or rewrite ambiguous history automatically. |
| Invalid duration/date/recurrence or conflicting legacy fields | Stop with field-level counts. | No safe business value can be inferred. |

Every repair runs under the affected user's lease and transaction. Re-run the read-only audit and
require zero unresolved findings before strict validators and unique indexes are promoted.

## Total legacy `repeat` migration and removal

The word “repeat” remains valid in user-facing prose and component labels. This section removes
the obsolete **database/request field**, not recurrence as a feature.

### Classify and migrate

Migration `0002` scans task documents in stable `_id` batches while writes are quiesced or all
running instances are on the compatible release. When not globally quiesced, each user's batch
acquires that user's planning lease before changing data:

1. If `repeat` is missing, do nothing.
2. If it is null on a plain task or occurrence, unset the path.
3. If a valid `recurrence.freq` already exists, validate the modern rule, treat it as
   authoritative, report a conflicting non-null legacy value, then unset only after conflicts are
   resolved.
4. If an incomplete non-backlog, non-occurrence task has only `daily`, `weekly`, `monthly`, or
   `yearly`, write the canonical rule from REQ-RF2-011, clear `scheduledDate`, and unset `repeat` in
   one transaction.
5. If a completed historical task has only a legacy value, unset it without turning history into
   a live template.
6. If a backlog, occurrence, unsupported value, malformed rule, or ambiguous completed template
   has a non-null value, stop and report it.
7. For each promoted template, atomically materialize its pending horizon and invalidate its
   schedule projection. Completed tasks and occurrences are not cloned or changed.

Verify `countDocuments({ repeat: { $exists: true } }) === 0`, validate every modern rule, then
promote the MongoDB validator that rejects any `repeat` property.

### Contract removal checklist

The contract release must do all of the following in one reviewed slice:

- delete `repeat` from `TaskDetail` in `models/index.js`;
- delete `taskRepeat`/`repeat` request destructuring and compatibility logic in `routes/tasks.js`;
- delete `normaliseLegacyRepeat`, the fallback branch of `effectiveRule`, legacy template queries,
  promotion writes, and occurrence `repeat: null` writes in `controllers/recurrence.js`;
- make recurrence helpers accept a rule, not a task that might have two representations;
- delete the completion cloning path and no-longer-needed `mongoose`/Moment imports from
  `controllers/taskController.js`;
- remove `repeat` projections from `controllers/scheduling.js` and `taskController.js`;
- replace `Calendar.vue`'s `task.repeat` recurring badge fallback with `seriesRef`/modern response
  state;
- keep `RepeatEditor.vue`, `#task-repeat`, and plain-English “repeat” labels unless separately
  redesigned; they are not legacy storage fields;
- remove legacy defaults/fixtures from `seed/factories.js` and `seed/dataset.js`; express all live
  series with `recurrence` and stop putting recurrence metadata on completed plain tasks;
- replace the legacy-compatibility spec in `tests/api/recurrence.spec.js` with migration and
  post-contract rejection tests;
- rewrite the legacy sections in `docs/RECURRING_TASKS.md` and `docs/SEEDING.md`, plus semantic
  field references in README, comments, and active manuals; and
- run a repository grep for `taskRepeat`, `.repeat`, `repeat:`, and Mongo `repeat` paths, manually
  excluding JavaScript/CSS repetition, Playwright's `--repeat-each`, UI IDs/classes, and immutable
  completed task-history files under `tasks/`.

Do not deploy the contract release while an older API instance can still write the field.

## Index manifest

Put exact definitions and names in `models/indexManifest.js`; migrations create or drop indexes by
those names only. The list below is the initial required manifest, subject to preflight evidence
rather than speculative additions:

| Name | Collection and keys | Options / owning operation |
|---|---|---|
| `task_occurrence_identity_uq` | `taskInfo`: `{ userRef: 1, seriesRef: 1, occurrenceDate: 1 }` | Unique partial index where seriesRef is ObjectId and occurrenceDate is Date; upsert identity. |
| `task_series_pending` | `taskInfo`: `{ userRef: 1, seriesRef: 1, completed: 1, occurrenceDate: 1 }` | Materialize, synchronize, prune, and series cascade. |
| `task_active_due` | `taskInfo`: `{ userRef: 1, completed: 1, isBacklog: 1, dueDate: 1, priority: 1, _id: 1 }` | Partial modern non-template active due tasks; scheduler/list. |
| `task_active_backlog` | `taskInfo`: `{ userRef: 1, completed: 1, isBacklog: 1, startDate: 1, priority: 1, _id: 1 }` | Partial modern non-template backlog tasks. |
| `task_dependencies` | `taskInfo`: `{ userRef: 1, dependsOn: 1 }` | Reverse cleanup on task/series deletion. |
| `task_live_templates` | `taskInfo`: `{ userRef: 1, completed: 1, "recurrence.freq": 1, _id: 1 }` | Active recurrence-template scan and completed-series cleanup. |
| `task_completion_project` | `taskInfo`: `{ userRef: 1, completed: 1, completedDate: -1, projectRef: 1 }` | Keep/rename the existing equivalent; project completion history. |
| `event_user_window` | `eventInfo`: `{ userRef: 1, startDate: 1, endDate: 1 }` | Calendar week overlap read; compare both range-order alternatives with explain. |
| `event_user_type_window` | `eventInfo`: `{ userRef: 1, type: 1, startDate: 1, endDate: 1 }` | Scheduler busy inputs and sync cache windows. |
| `event_generated_cleanup` | `eventInfo`: `{ userRef: 1, type: 1, taskRef: 1 }` | Completion/cascade and atomic projection replacement. |
| `event_google_identity_uq` | `eventInfo`: `{ userRef: 1, sourceCalendarId: 1, externalEventID: 1 }` | Unique partial index for `type: "google"` with both identity strings. |
| `role_live_order` | `roleInfo`: `{ userRef: 1, sortOrder: 1, startDate: 1 }` | Live Compass tree. |
| `goal_parent_order` | `goalInfo`: `{ userRef: 1, roleRef: 1, sortOrder: 1, startDate: 1 }` | Populated goals by owned parent. |
| `project_parent_order` | `projectInfo`: `{ userRef: 1, goalRef: 1, sortOrder: 1, startDate: 1 }` | Populated projects by owned parent. |
| `role_archive_end`, `goal_archive_end`, `project_archive_end` | matching Compass collection: `{ userRef: 1, endDate: -1 }` | Counts and paged archive; create each explicit name. |

Normalize missing `completed`/`isBacklog` booleans and recurrence nullability before using partial
filters. Use exact partial filters `{ completed: false, isBacklog: false, recurrence: null }` for
`task_active_due`, `{ completed: false, isBacklog: true, recurrence: null }` for
`task_active_backlog`, BSON ObjectId/Date predicates for occurrence identity, and
`{ type: "google", sourceCalendarId: { $type: "string" }, externalEventID: { $type: "string" } }`
for Google identity. Inspect existing plugin-created username indexes and avoid creating an
equivalent duplicate. For every index, save pre/post `keysExamined`, `docsExamined`, returned count,
sort stage, duration,
size, and build duration. Test both key orders for two-range overlap queries; retain the one that
wins representative workloads. Small test fixtures may legitimately choose `COLLSCAN`, so index
acceptance uses a production-like fixture or a hint plus plan assertions, not the seed alone.

Build non-unique indexes in the compatible release. Build unique indexes only after duplicate
verification. Set application `autoIndex: false` outside explicitly disposable tests; the migration
runner, not web startup or Mongoose model compilation, owns index deployment. Confirm disk and
memory headroom and managed-service index-build behavior. Rollback drops only the named new index
when the previous release cannot tolerate it; otherwise leave useful indexes in place.

## Recurrence materialization

Keep `occurrenceDatesBetween()` pure and preserve all existing date/DST cases. Replace the current
read/delete/`insertMany` sequence with `materializeSeries(template, rule, window, { session,
synchronizePending })`:

1. Generate and validate the wanted canonical dates outside persistence.
2. In the transaction, re-read the owned template and current rule.
3. Query existing identities and completed status for that series.
4. Delete only stale pending occurrences and their generated events; pull deleted occurrence IDs
   from dependencies.
5. Bulk `updateOne(..., { upsert: true })` each wanted identity. Put identity and initial inherited
   fields in `$setOnInsert`. On an explicit series edit, put authored inherited fields in `$set`
   only for pending rows. Normal expansion never overwrites partial chunk progress.
6. Preserve existing `_id`s and every completed occurrence unchanged.
7. Verify affected counts, bump the planning revision, and commit with the current fence.

The unique partial index is the last defense if a caller bypasses the lease. Duplicate-key errors
are not treated as successful materialization: abort, emit the identity conflict, re-read, and retry
only if the state is already exactly equivalent.

Series deletion keeps completed rows but sets their `seriesRef` to null in the same transaction
before deleting the template. This retains history without pretending the deleted template still
exists. Removing recurrence from a template applies the same rule to completed occurrences, while
pending occurrences and their generated events are deleted.

## Atomic schedule projection

Split `generateTaskEvents()` into three stages:

1. **Prepare under the user lease:** materialize recurrence, capture input revision, and load owned
   tasks plus only user/calendar/Google busy events through explicit indexed queries.
2. **Calculate without writes:** a pure scheduling function returns generated event values,
   `{ taskId, scheduledDate }` updates, unscheduled reason counts, and diagnostics. It validates
   positive durations, finite times, horizon bounds, no overlap, dependency order, and total
   scheduled minutes before returning.
3. **Commit once:** a short transaction verifies fence and input revision; nulls `scheduledDate`
   for all active non-template tasks; bulk-sets the proposed dates; deletes old generated
   `task`/`task-chunk` events; inserts the complete proposed set; records operation ID and
   `projectionRevision`; then commits.

Do not persist events from inside the scheduling loop. Event `_id` churn may remain an internal
implementation detail, but user/calendar/Google event IDs and rows are never part of replacement.
Use an operation ID so an unknown commit result can be resolved from planning state.

If preparation/materialization changes recurrence but calculation then fails, the prior schedule
projection remains committed and its revision is visibly stale. If the projection transaction
fails after any delete/update/insert statement, MongoDB abort restores every old generated event
and `scheduledDate` value.

### Explicit comparator

Export and unit-test one `compareSchedulableTasks(a, b)` with this ascending key tuple:

1. work class: due-dated non-backlog before backlog;
2. effective date: `dueDate` for normal/occurrence work, `startDate` for backlog, missing as positive
   infinity only where the validated kind permits it;
3. priority, defaulting to `100` only for pre-migration reads;
4. start date, then occurrence date, each missing as positive infinity; and
5. `_id.toString()` as the stable final tiebreaker.

Lower priority numbers win only after effective dates tie, matching the current editor text.
`findBestTaskForSlot` scans all eligible full and chunk candidates and compares them with this
function; it no longer assumes MongoDB/concatenation order or calls `.getTime()` on nullable due
dates. If the same task is both candidates and fits fully, schedule it fully. If full and chunk
candidates compare equal, prefer full placement to avoid unnecessary fragmentation.

### Explicit progress

At the start and end of every loop step, compare a monotonic progress snapshot containing:

- `currentTime` milliseconds;
- `eventIndex`;
- pending-task count and scheduled-task count;
- expired occurrence count;
- generated event count; and
- per-task remaining chunk minutes (or a stable aggregate plus changed task ID).

Progress means time/event position increases, a pending task leaves, a task becomes scheduled, an
occurrence expires, an event is validly emitted, or positive remaining duration decreases. Time
must never move backward and chunk duration must never be zero. Reset `noProgressCount` on any such
change, including non-working-day and overlap branches. If a step changes none, increment it and
record the branch reason. Exceeding either guard throws a typed calculation error with redacted
counts; the route must not return success and the projection commit must not run.

## Cascades and orphan prevention

Do not use Mongoose pre/post delete middleware for correctness: `deleteMany` and bulk migrations
can bypass document hooks. Use explicit transaction-aware operations.

### Task lifecycle

- Plain-task delete: delete the owned task, delete same-user generated events for its ID, pull the
  ID from all same-user dependencies, and bump revision in one transaction.
- Series delete through a template or occurrence: identify the owned template in-transaction;
  delete pending occurrences/events; pull template and deleted occurrence IDs from dependencies;
  set completed occurrences' `seriesRef` to null; delete the template; bump revision.
- Completion: atomically mark complete with completion instant and remove only generated events
  for that task. Occurrence history and template remain. Concurrent duplicate completion is
  idempotent and does not rewrite the first completion instant.
- Chunk completion: use a conditional update on the expected incomplete task and sufficient
  remaining duration. The final chunk and generated-event cleanup share the completion transaction.
- Follow-up: completion of the source and creation of the new plain task commit together; no
  completed source without its requested follow-up.

### Compass lifecycle

Re-read the owned subtree inside the transaction. With `cascade: false`, the child-exists check and
refusal use that snapshot. With confirmed cascade, unlink all same-user tasks (including templates
and pending occurrences), delete projects, goals, and role in child-to-parent order, and commit
once. Completed task records survive with `projectRef: null`, preserving the existing documented
contract.

Run the orphan audit after every migration and as a scheduled/read-only operational check. It must
alert on nonzero findings; it must not mutate production outside an explicitly invoked migration.

## Google sync identity and atomic cache application

Add `sourceCalendarId` as an opaque required field on Google event rows. Fetch every selected
calendar outside the planning lease and attach the exact requested calendar ID before flattening.
Only after **all** selected calendars fetch and transform successfully may the operation acquire the
lease and apply a cache transaction.

Within that transaction:

1. re-read `selectedCalendars` and the captured input revision; abort/retry if either changed while
   provider data was fetched;
2. bulk-upsert by `(userRef, sourceCalendarId, externalEventID)` using `$setOnInsert` for identity;
3. update transformed temporal/title/notes fields and a stable `syncOperationId`;
4. delete Google rows for that user not seen in the fully successful operation, including rows
   from deselected calendars, according to the documented bounded cache window;
5. increment planning revision and commit.

A per-calendar fetch failure, malformed provider event, 401 exhaustion, lease timeout, or write
failure leaves the old cache untouched. Phase 1 owns bounded authentication retry and truthful HTTP
failure; Phase 2 ensures the data operation is all-or-nothing.

Existing Google rows do not contain enough information to infer their source calendar. The
compatible schema and partial unique index therefore permit source-aware rows while old cache rows
remain readable. On the first fully successful all-calendar sync for a user, upsert the source-aware
rows and remove that user's source-less cache in the same transaction, so readers never observe both
representations. For connected users that cannot complete a resync during
rollout, keep the prior cache and block contract completion; do not guess from organizer email.
For disconnected/deselected accounts, retire source-less cache only after backup and an explicit
operator decision, then mark the schedule projection stale.

## Test-first implementation slices

Keep current characterization specs green. Add the smallest tests below **before** each behavior
change; do not add skipped tests. Use application-level failure hooks passed to persistence
functions so tests can throw between transaction statements without enabling unsafe server
failpoints in production.

### Slice 1 — topology and migration runner

Files: `scripts/db.js`, `instance.js`, `tests/fixtures/db.js`, migration modules, and a new
`tests/api/migrations.spec.js`.

1. Start/upgrade the test container as a single-node replica set and prove commit plus abort.
2. Test plan/dry-run/apply/verify, immutable checksum rejection, exclusive migration lease, and an
   interrupted checkpoint resuming exactly once.
3. Test readiness failure for standalone topology, behind/ahead schema version, failed migration,
   and missing required unique index.
4. Keep `tests/api/dev-database.spec.js` isolation/concurrent-start behavior green.

### Slice 2 — request, domain, Mongoose, and collection validation

Files: `validation/`, `models/index.js`, relevant routes/controllers, `TaskEditor.vue`, and focused
cases in existing API specs.

1. Add one table-driven task test covering non-number/zero/fractional/too-large duration, invalid
   priority, invalid chunk relation, unknown/server-owned keys, due-before-start, and invalid
   recurrence cross-fields on create and merged edit.
2. Add atomic chunk tests for over-completion and two simultaneous final-chunk requests.
3. Make the normal seed valid under the new schema (including replacing the zero-duration default
   fixture); construct hostile invalid rows only inside pre-validator migration tests.
4. Add representative event, working-preference, and Compass numeric/unknown-key tests.
5. Directly prove Mongoose and MongoDB validators reject malformed bypass writes after legacy
   migration; migration sessions use an explicit controlled validation mode only while repairing.
6. Preserve strict date/DST specs and HTML-looking/Unicode text behavior.

### Slice 3 — audit, repairs, indexes, and query plans

Files: audit/migrations, manifest, models, and `tests/api/data-integrity.spec.js`.

1. Seed each orphan class and prove only the documented automatic action occurs.
2. Seed divergent pending and duplicate completed occurrences and prove preflight stops without
   deleting history.
3. Build indexes twice idempotently; verify options and names. Test unique identity and Google
   identity enforcement.
4. Run representative scheduler, task-list, event-window, completion, Compass-parent, and archive
   explains against a scaled fixture; save before/after statistics and reject unbounded regression.

### Slice 4 — complete legacy removal

Files: migration `0002`, recurrence/task/scheduling runtime, frontend fallback, seed, tests, and
active docs.

1. Construct legacy-only, modern-only, both-equal, both-conflicting, completed, null, invalid,
   backlog, and occurrence rows directly before strict validators are enabled.
2. Prove exact canonical conversion, completed-history preservation, idempotent resume, conflict
   stop, immediate materialization, and zero remaining BSON paths.
3. Replace the current “legacy repeat strings still expand” spec with migration behavior and API
   rejection for both removed names.
4. Run the semantic grep checklist and prove seed output contains no legacy path.

### Slice 5 — per-user lock and recurrence upserts

Files: lease/planning state, recurrence persistence, task series operations, and
`tests/api/recurrence.spec.js`.

1. Issue `Promise.all` schedule/create/edit expansion requests for one user; assert one occurrence
   per identity, stable surviving IDs, synchronized pending fields, and untouched completed rows.
2. Hold one user's lease while expanding another user and prove the second proceeds.
3. Force lease expiry/reacquisition and prove the stale fence cannot commit or release the new
   lease.
4. Inject failure after stale deletion and after an upsert; assert the series edit, occurrences,
   generated events, dependencies, and revision all roll back.
5. Retain generator date, DST, immediate visibility, edit/delete, idempotence, and history specs.

### Slice 6 — pure scheduler and atomic projection

Files: scheduler, projection persistence, route orchestration, and
`tests/api/scheduling.spec.js`.

1. Unit-test comparator permutations: equal dates/priorities, backlog/null due dates, occurrence
   ties, full-versus-chunk tie, missing pre-migration values, and ObjectId stability.
2. Unit-test progress for overlap, non-working day, outside-hours advance, chunk reduction,
   expiry, true no-progress, time regression, and zero chunk rejection.
3. Calculate a projection and inject failures before commit, after clearing dates, after deleting
   old events, after inserting some events, and at commit; each failure must expose the exact old
   event IDs/dates and return failure.
4. Launch many simultaneous schedule requests for one user; assert one successful serialized
   result or explicit busy responses, no mixed generations, no duplicates/overlap, and equal input
   and projection revisions for the winner.
5. Mutate another user's schedule concurrently and prove no global serialization.
6. Keep all existing scheduler invariants, recurrence weekday/DST behavior, far-horizon conflicts,
   completed exclusion, and idempotence green.

### Slice 7 — cascades and failure injection

Files: task, Compass, recurrence, transaction helpers, and existing task/Compass specs.

1. Delete a task depended on by multiple same/other-user tasks and prove same-user pull,
   cross-user isolation, generated cleanup, and authored calendar-event preservation.
2. Delete a series with pending/completed occurrences; prove pending events/dependencies disappear,
   completed rows remain with null `seriesRef`, and no orphan remains.
3. Inject failure at every task/series/follow-up/Compass cascade stage and compare the complete
   before/after database snapshot for equality.
4. Race dependency/project creation against deletion under the same user lease and prove no new
   dangling reference can commit.

### Slice 8 — sync identity and failure handling

Files: event model/controller/persistence and `tests/api/events.spec.js` with a fake Google adapter.

1. Return the same `eventData.id` from two calendar IDs and assert two local rows; resync one and
   assert only its row updates.
2. Prove all-day/timezone transformations remain unchanged.
3. Fail the second selected-calendar fetch and assert no upsert or prune occurs.
4. Inject failure after upsert and before prune/commit and assert old cache identity and contents.
5. Prove deselection prunes only after a complete successful sync and source-less migration cache
   is removed only in the successful replacement transaction.

### Slice 9 — rollout rehearsal

On a restored, anonymized production snapshot:

1. Record audit and query baselines, backup ID, document/index sizes, and migration estimates.
2. Rehearse topology conversion if applicable, compatible release, migrations, materialization,
   source-aware resync, contract release, and verification.
3. Kill the migration mid-batch and the app mid-transaction; prove resume and recovery.
4. Restore the pre-migration backup into a second isolated database and run the old release's smoke
   tests.
5. Run focused API specs while iterating, then the complete `npm test` suite once at finalization.

## Compatibility, rollout, backup, and rollback

### Release sequence

Use an expand/migrate/contract deployment. Do not do this as one rolling binary change.

1. **Inventory:** run audit and migration plan; resolve semantic violations and duplicate history.
2. **Backup:** quiesce writes or take a managed point-in-time snapshot; record cluster time, database,
   app version, migration version, collection counts, and backup ID. Verify restore in isolation.
3. **Topology:** enable/prove replica-set or sharded transactions in local, test, staging, and
   production. Run existing tests before data migration.
4. **Compatible release:** deploy validators in warn/moderate mode, modern-write/legacy-read
   recurrence code, migration runner, locks, revisions, transaction paths, source-aware sync, and
   non-unique indexes. It may accept old recurrence request names only long enough to translate
   them immediately to `recurrence`; it must stop writing legacy fields.
5. **Drain old instances:** no pre-compatible process may remain. Enable maintenance/read-only mode
   for migration if rolling deployment cannot guarantee this.
6. **Migrate:** apply integrity repairs, recurrence conversion, source identity, unique indexes,
   and strict validators. Materialize affected series and rebuild stale schedule projections per
   user under leases. A source-aware Google replacement must succeed before removing that user's
   old cache.
7. **Verify:** run zero-count/orphan/duplicate checks, index and validator inspection, projection
   revision checks, sampled user journeys, and focused tests.
8. **Contract release:** remove all legacy code/API/seed/test/docs support and reject removed fields.
   Keep maintenance until contract startup/readiness passes.
9. **Soak:** watch the metrics below for at least one normal recurrence horizon advance, scheduled
   run cycle, and calendar sync cycle appropriate to actual usage before expiring the backup.

### Compatibility matrix

| State | Compatible release | Contract release | Current pre-Phase-2 release |
|---|---|---|---|
| Before migrations | Yes | No | Yes |
| Modern writes, legacy reads | Yes | No | Yes, but must be drained before migration because it can write legacy fields/non-atomically |
| Legacy paths absent; indexes/validators strict | Yes | Yes | Read-mostly may work, but writes are forbidden because they bypass leases/revisions and may recreate legacy data |
| Restored pre-migration snapshot | Yes | No until rerun | Yes |

After strict migration, application rollback means the compatible Phase 2 release, not today's
non-transactional release. If that release cannot restore service, keep writes disabled and restore
the verified snapshot. Advanced recurrence cannot be losslessly converted to a legacy string, so no
down migration may pretend otherwise.

### Backup procedure

Prefer the managed provider's consistent point-in-time snapshot. For self-hosted MongoDB, quiesce
application writes and use the provider-supported `mongodump`/filesystem snapshot procedure for the
actual replica-set topology; include migration and planning collections. Record command, URI target
(redacted), cluster time, checksums, and tool/server versions in the deployment runbook. A backup is
not accepted until `mongorestore` into a differently named isolated database succeeds and collection
counts, sampled recurrence identities, indexes, validators, and old-release smoke tests match.

Do not use the normal seed/wipe scripts for migration rehearsal or restore verification.

### Failure handling and rollback triggers

Stop rollout and keep writes disabled on any of these:

- topology/transaction/readiness failure;
- migration checksum mismatch, unresolved validation issue, duplicate completed history, or count
  mismatch;
- lease fencing failure or repeated transient-transaction exhaustion;
- recurrence duplicate-key conflict after equivalent-state re-read;
- projection partial-visibility evidence, invariant failure, or no-progress guard;
- nonzero new orphan count;
- Google partial prune or unexplained source-less rows; or
- query-plan regression beyond the approved threshold.

Before the contract release, fix forward or redeploy the compatible release. After a destructive
migration, restore the backup if correctness cannot be proven by a bounded forward repair. Restoring
requires stopping every writer, restoring all owned collections plus migration/planning metadata,
verifying, and deploying a release compatible with the restored version. Never restore one related
collection in isolation.

## Observability

Use Phase 1 structured logging/metrics. User IDs may be one-way hashed/correlated; never log task
text, notes, calendar titles, provider bodies, tokens, or full external IDs.

Emit at least:

| Area | Metrics/events |
|---|---|
| Migration | version/checksum, state, batch scanned/changed/skipped, checkpoint, duration, violations by code, verify counts, backup ID reference. |
| Readiness | topology kind, transaction smoke result, current/required migration range, missing/wrong indexes and validators. |
| Lease | acquire/wait/busy/renew/release/expired/stolen, wait duration, fence mismatch; aggregate by operation kind. |
| Transaction | attempts, duration, commit/abort, transient retry, unknown-commit resolution, permanent failure code. |
| Recurrence | templates scanned, wanted/matched/upserted/pruned, completed preserved, duplicate conflicts, duration. |
| Scheduler | run/operation ID, captured revision, input task/busy-event counts, proposed event count/minutes, unscheduled reasons, iterations, no-progress branch, calculation/commit duration, stale projection age. |
| Cascade/orphans | documents unlinked/deleted/preserved/pulled by kind, audit findings by class, rollback code. |
| Sync | selected/fetched calendars, fetched/upserted/pruned counts per opaque source hash, source-less count, all-or-nothing failure stage. |
| Queries/indexes | sampled duration, returned/docs/keys examined, chosen index, in-memory sort, slow-query count. |

Alert on any fence violation, ambiguous commit, projection invariant failure, completed duplicate,
new cross-user orphan, partial-sync attempt, migration failure, or readiness downgrade. Alert on
sustained lock contention, transaction retries, stale projection age, query regression, or
source-less Google rows above zero after rollout.

## MongoDB-versus-PostgreSQL decision gate

MongoDB remains the default only after measured hardening. Run this gate twice: before enabling
transactional production writes, and after the soak period. Store evidence in a dated ADR; do not
base the choice on preference.

### Evidence to collect

- **Topology/operations:** transaction support in every environment, failover behavior, transaction
  limits/duration, managed-service support, backup restore time, RPO/RTO, migration privileges,
  index build behavior, and operational ownership.
- **Query behavior:** production-like p50/p95/p99, documents/keys examined, memory sorts, index size,
  and growth for task list, scheduling horizon, event overlap, recurrence, completion, and Compass
  archive queries.
- **Integrity complexity:** transaction retries/aborts, lock contention, orphan findings, duplicate
  attempts, repair frequency, and code needed to emulate relationships.
- **Reporting needs:** approved near-term cross-project/role time reports, ad-hoc joins/aggregates,
  recurrence history analysis, retention, and consistency requirements.
- **Migration cost:** schema mapping, temporal semantics, ObjectId/API compatibility, Google cache,
  recurrence history, dual-write risk, downtime, team skills, and hosting cost.

### Decision

Stay on MongoDB when all deployment targets pass the transaction gate, atomic units remain safely
inside measured limits, indexed queries meet the approved SLO with bounded growth, restore meets
RPO/RTO, and integrity/orphan telemetry remains exceptional.

Stop Phase 2 rollout and open a PostgreSQL ADR/task when **any hard blocker** is true:

- a required deployment target cannot provide supported MongoDB transactions;
- projection/materialization transactions exceed safe service limits under representative data;
- required queries cannot meet the SLO without unacceptable scans/index cost;
- approved reporting now requires relational joins/constraints that dominate the workload; or
- recurring orphan/repair incidents show that application-enforced references are not operationally
  reliable.

A soft preference, familiarity, or hypothetical future report is not enough. Conversely, do not
retain MongoDB by adding non-atomic fallback behavior. A PostgreSQL decision starts a separate
approved migration with dual-read/write and rollback design; it is not implemented inside Phase 2.

## Acceptance criteria

Phase 2 is ready for review only when all of the following are demonstrated with artifacts:

- REQ-RF2-001 through REQ-RF2-034 are linked to implementation commits and passing tests.
- Request, merged-state, Mongoose, and strict MongoDB validators enforce the documented contracts;
  the integrity audit reports zero unresolved violations.
- Migration plan/dry-run/apply/resume/verify and checksum/lease failures are tested on fresh and
  legacy databases; startup/readiness accepts only the intended migration range.
- A verified backup and isolated restore record exists, with measured restore time against RTO.
- `countDocuments({ repeat: { $exists: true } })` is zero, removed request names are rejected, and
  semantic repository grep finds no legacy field support in schema, API, runtime, frontend, seed,
  active tests, or active manuals.
- All named required indexes and strict validators match the manifest. Duplicate indexes are
  absent; occurrence and Google identity indexes reject duplicate keys; before/after plans meet
  the approved query threshold.
- Local, test, staging, and production topology gates prove real commit/abort transactions; no
  non-transactional fallback exists.
- Concurrent same-user recurrence/schedule runs produce one coherent result, stable occurrence
  identities, and explicit busy/serialized responses. Different users proceed concurrently.
- Every injected recurrence, projection, cascade, follow-up, and sync failure leaves the complete
  prior committed state visible; no partial or empty schedule/cache is observed.
- Completed occurrence history remains unchanged through expansion/edit and survives series
  deletion as non-dangling history.
- Task/series deletes clean generated events and dependency IDs; Compass cascade is atomic; the
  post-suite orphan audit is zero.
- Two calendars with the same external event ID remain distinct, repeated sync is idempotent, and
  failed/partial fetches never prune the old cache.
- Comparator cases are deterministic, nullable dates cannot throw, progress branches reset the
  guard correctly, and guard failure does not commit a projection.
- Existing recurrence generator/history, scheduler invariant, task ownership/completion, event
  temporal transform, Compass cascade/tenant, timezone/DST, Calendar, and Weekly Plan specs remain
  green.
- The staged rollout and rollback rehearsal succeeds on a production-like restored snapshot, and
  observability shows no critical alert through the agreed soak.
- The full `npm test` suite passes at finalization.
- A dated MongoDB-versus-PostgreSQL ADR records evidence, thresholds, decision, owner, and review
  date. It does not claim a PostgreSQL migration shipped.

## Unresolved deployment questions

These require operator/user facts and must be answered before implementation or rollout; they are
not excuses to leave code behavior ambiguous:

1. What MongoDB product, exact version, topology, region layout, and connection options run in
   production? Is it a replica set or sharded cluster, and can staging match it?
2. Can the current shared local Docker volume be restarted and initiated as a single-node replica
   set in place, or is a dump/restore maintenance step preferred?
3. How many API processes can write one database today, and are rolling or blue/green deployments
   used? Can old writers be fully drained before contract migration?
4. What maintenance/read-only mechanism is available, and what downtime window is acceptable for
   audit repair, unique indexes, strict validators, and projection rebuild?
5. What are the required RPO/RTO, backup retention, snapshot mechanism, restore owner, and last
   measured restore duration?
6. What are production collection/document/index sizes, largest tasks/events per user, largest
   recurrence series count, sync calendar count, and expected 12-month growth?
7. Does the production principal support transactions and metadata reads, and can a separate
   migration principal create indexes and run `collMod`?
8. Are there external API clients beyond the shipped Vue application? If so, who owns their
   migration from `repeat`/`taskRepeat` and broad edit payloads, and what is the announced cutoff?
9. How many accounts remain below `TEMPORAL_DATA_VERSION`, and is a trustworthy IANA timezone known
   for each? Do not bulk reinterpret those accounts without this answer.
10. How many Google-connected users and source-less cached events exist, and can a controlled full
    all-calendar resync be completed during rollout? What is the operator action for revoked tokens?
11. What query latency/error SLO, transaction-duration ceiling, lock wait, stale-projection age,
    and alert thresholds should be approved for the decision gate?
12. Which near-term reporting requirements are actually approved, and do they require relational
    joins/constraints rather than bounded MongoDB aggregates?
13. Who approves manual resolution of invalid durations, divergent pending duplicates, duplicate
    completed history, and orphaned Compass children?
14. What soak duration covers a normal schedule, recurrence horizon, and Google sync cycle for the
    real deployment?

Until these answers, this document is an implementation plan only and makes no claim that Phase 2
behavior, migrations, indexes, or topology are deployed.
