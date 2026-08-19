# AGENTS.md

AutoTaskCalendar: task manager that auto-schedules tasks onto a calendar.
Express + Mongoose (MongoDB) backend, Vue 3 (vue-cli) frontend in `webinterface/`.

## Start here

Requires `node` and `docker`; the scripts start MongoDB themselves.

```bash
npm install         # this project and webinterface/
npm run seed        # optional: testuser / testpassword
npm run dev         # database, API, and web UI
```

Nothing needs to be exported and there are no database commands — `dev`, `test`, and
`seed` each start the container themselves. Ports are probed at startup and each git
branch gets its own database, so several agents can run at once without colliding.
`npm run dev` prints the ports and database name it chose. Set `AUTOTASKCALENDAR_INSTANCE`
to run two stacks on one branch.

Only when you're done your changes and are doing finalization should you run the test suite as it takes a long time.

## Coding style

Keep all comments short and concise, usually just 1 or 2 sentences max.

## The database

One shared `autotaskcalendar-mongo` Docker container serves the whole host; instances are
isolated by database name. `scripts/db.js` owns it — it starts the daemon if needed,
creates the container if missing, and publishes on the first free port. To inspect or
reset it, use Docker directly (`docker logs autotaskcalendar-mongo`,
`docker rm -f autotaskcalendar-mongo`).

## Verify

`npm test` must pass — it builds the frontend if `dist/` is stale, installs the Playwright
browser if missing, and runs twelve isolated Playwright workers against one test database,
so it never disturbs your dev stack. **Any behaviour change ships with a spec.**

While iterating, stay narrow: `npm test -- tests/api` (~1 min) or `npm test -- -g "<name>"`
(seconds). Save the full run for just before you commit.

See `docs/TESTING.md` to run/write/debug tests and `docs/SEEDING.md` for the seeded
dataset.

## Layout

- `app.js` — Express setup, session/passport wiring, route mounting.
- `instance.js` — per-instance ports/DB names. Single source of truth.
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
  `docs/REFACTOR_OVERVIEW.md` is the small risk-driven refactor roadmap.

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
