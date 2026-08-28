# AGENTS.md

AutoTaskCalendar: task manager that auto-schedules tasks onto a calendar.
Express + Mongoose (MongoDB) backend, Vue 3 (vue-cli) frontend in `webinterface/`.

## Start here

Requires `node` and `docker`; the scripts start MongoDB themselves.

```bash
npm install         # this project and webinterface/
npm run seed        # optional: local-testuser / testpassword
npm run dev         # database, API, and web UI
```

Nothing needs to be exported and there are no database commands. Every stack uses fixed
ports (API 3000, web 8080) and **one shared database** at
`mongodb://127.0.0.1:27017/autotaskcalendar`, which the IDE raises from
`.kingdom/services.toml`; outside the IDE the scripts start the container themselves.
Agents do not collide because each is network-isolated, and tests do not collide because
each seeds its own namespace. See `docs/SHARED_DATABASE.md`.

Only when you're done your changes and are doing finalization should you run the test suite as it takes a long time.

## Coding style

Keep all comments short and concise, usually just 1 or 2 sentences max.

## The database

One MongoDB, one database, shared by every agent — declared in `.kingdom/services.toml` and
reached at `localhost:27017`. **Never start, stop, or remove that container**: other agents
are using it. Isolation is by seed namespace, and `runSeed()` refuses to run without one.
Read `docs/SHARED_DATABASE.md` before writing anything that touches the database directly.

## Verify

`npm test` must pass — it builds the frontend if `dist/` is stale, installs the Playwright
browser if missing, and runs twelve isolated Playwright workers against the shared database,
each in its own seed namespace. **Any behaviour change ships with a spec.**

While iterating, stay narrow: `npm test -- tests/api` (~1 min) or `npm test -- -g "<name>"`
(seconds). Save the full run for just before you commit.

See `docs/TESTING.md` to run/write/debug tests and `docs/SEEDING.md` for the seeded
dataset.

## Layout

- `app.js` — Express setup, session/passport wiring, route mounting.
- `instance.js` — fixed ports and the shared database URL. Single source of truth.
- `.kingdom/services.toml` — the shared MongoDB the IDE raises for every agent.
- `routes/` — HTTP endpoints; `controllers/` — business logic.
- `controllers/scheduling.js` — the task-scheduling algorithm. Highest-risk code.
- `controllers/recurrence.js` — recurrence rules and occurrence expansion. See `docs/RECURRING_TASKS.md`.
- `models/index.js` — all Mongoose schemas. Import these; never redefine.
- `middleware/auth.js` — JWT `authenticateToken`. `utils/helpers.js` — `returnFailure()`;
  `utils/temporal.js` owns date/time parsing and timezone boundaries.
- `webinterface/src/` — Vue app (`views/`, `components/`, `store.js`).
- `seed/` — the fake-data factories and dataset; `scripts/seed.js` is the CLI.
- `tests/` — Playwright specs (`api/`, `ui/`) and shared `fixtures/`.
- `scripts/` — `dev.js` (dev stack), `db.js` (MongoDB container), `test.js` (test stack).
- `docs/` — one file per broad concept, each a standalone instruction manual.
  `docs/COMPASS.md` covers roles/goals/projects; `docs/WEEKLY_PLAN.md` covers the weekly
  commit-and-review workflow; `docs/TASK_SLIP_FORECAST.md` covers blocked-slot reschedule previews;
  `docs/ADMIN.md` covers the admin dashboard and how a user is made an admin;
  `docs/REFACTOR_OVERVIEW.md` is the small risk-driven refactor roadmap;
  `docs/SHARED_DATABASE.md` covers the one shared database and seed namespaces.

## Documenting your work

Any broad concept (a subsystem, a workflow, an integration) gets its own file in `docs/`,
written as an instruction manual someone can follow end to end. Keep this file as the
short index and put the depth in `docs/`. See `docs/TEST_CREDENTIALS.md` for the format.

## Gotchas

- `config.js` (gitignored) overrides `defaultconfig.js`; production reads env vars instead.
- API errors return HTTP 200 with `{success: false}` via `returnFailure()`.
- Distinguish instants, civil dates, and wall times; use the temporal helpers and feature manuals.
- Never implement timezone conversion with numeric offsets or advance calendar days by milliseconds.
- Keep code comments to one or two sentences.
