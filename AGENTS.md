# AGENTS.md

AutoTaskCalendar: task manager that auto-schedules tasks onto a calendar.
Express + Mongoose (MongoDB) backend, Vue 3 (vue-cli) frontend in `webinterface/`.

## Start here

```bash
npm install && (cd webinterface && npm install)
npx playwright install chromium   # once, for the test suite
npm run seed        # optional: testuser / testpassword
npm run dev         # starts mongo, API, and web UI
```

Nothing needs to be exported. Each git branch automatically gets its own MongoDB database
and session cookie, and `npm run dev` allocates a free block of ports at startup, so
several agents can run at once without colliding.

**Read the ports off the `npm run dev` banner** — it prints the web/api/debugger ports and
the database it actually bound. Branch names hash into only 49 port blocks, so the
preferred block is often already taken and the allocator moves on; computing the URL from
the branch name will send you to another agent's stack. `npm run db:status` prints the same
information. Override the instance name with `AUTOTASKCALENDAR_INSTANCE` if you need two
stacks on one branch.

Only when you're done your changes and are doing finalization should you run the test suite as it takes a long time.

## Coding style

Keep all comments short and concise, usually just 1 or 2 sentences max.

## Containers: `wslc`, not docker

MongoDB runs in **one shared** `wslc` container for the whole host; instances are isolated
by database name, not by container (`scripts/dev-db.sh` replaces compose):
`npm run db:up | db:down | db:reset | db:status | db:logs`.
`db:down` drops *your* database and leaves the shared server up for everyone else.
`npm run db:doctor` checks the one container and flags leftovers from the old
one-container-per-instance scheme; `npm run db:migrate` removes those. See
`docs/DEV_DATABASE.md`.

## Verify

`npm run verify` (build + full suite) must pass. The suite is Playwright, covering the API
and the UI, and it runs against its own isolated database so it never disturbs your dev
stack. **Any behaviour change ships with a spec.**

While iterating, stay narrow: `npm run test:api` (~1 min) or `npm test -- -g "<name>"`
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
- `scripts/` — `dev.js` (dev stack), `dev-db.sh` (database), `test.js` (test stack).
- `docs/` — one file per broad concept, each a standalone instruction manual.
  `docs/COMPASS.md` covers roles/goals/projects and what is planned next for them.

## Documenting your work

Any broad concept (a subsystem, a workflow, an integration) gets its own file in `docs/`,
written as an instruction manual someone can follow end to end. Keep this file as the
short index and put the depth in `docs/`. See `docs/TEST_CREDENTIALS.md` for the format.

## Gotchas

- `config.js` (gitignored) overrides `defaultconfig.js`; production reads env vars instead.
- API errors return HTTP 200 with `{success: false}` via `returnFailure()`.
- Distinguish instants, civil dates, and wall times; follow `docs/DATE_AND_TIME.md`.
- Never implement timezone conversion with numeric offsets or advance calendar days by milliseconds.
- Keep code comments to one or two sentences.
