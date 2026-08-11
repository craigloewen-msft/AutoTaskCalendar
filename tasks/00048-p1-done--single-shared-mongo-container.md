# One shared MongoDB container for all instances

## Problem

`instance.js` gives every instance (branch, worktree, and each one's `-test` twin) its own
Mongo container, its own volume, and its own published port:

```
containerName: autotaskcalendar-mongo-<name>
volumeName:    autotaskcalendar-mongo-data-<name>
mongoPort:     27017 + offset*10
```

wslc holds a host port-forward per running container. With several agents this piles up
fast, and past a handful of live forwards wslc starts resetting connections mid-run —
surfacing as random `MongoNetworkError` / `MongoPoolClearedError` failures. The existing
`doctor`/`gc` commands exist purely to paper over this.

The isolation we actually need is *per-database*, not per-container. Mongo already gives us
that: `autotaskcalendar_<name>` databases inside one mongod are fully isolated.

## Goal

Exactly one MongoDB container ever exists on the host: `autotaskcalendar-mongo`, one volume
`autotaskcalendar-mongo-data`, one published port. Every instance keeps its own database
inside it. `up` becomes "ensure the shared container is healthy"; `down`/`reset` become
database-scoped, not container-scoped.

## Plan

### 1. `instance.js`

- Replace the per-instance container/volume/port fields with shared constants:
  - `containerName: 'autotaskcalendar-mongo'`
  - `volumeName: 'autotaskcalendar-mongo-data'`
  - `mongoPort`: fixed shared port, default 27017, overridable with
    `AUTOTASKCALENDAR_MONGO_PORT`. It no longer participates in the offset stride.
- Keep `apiPort` / `webPort` / `inspectPort` offset-derived — those must stay per-instance.
- `dbName` stays exactly as it is (`autotaskcalendar_<name>`, 63-byte safe). This is now the
  *only* isolation mechanism, so keep the collision-avoiding offset suffix on truncation.
- Drop `containerLabel`'s per-instance value (or make it a constant); nothing keys off it
  once there is one container.

### 2. `scripts/dev-db.sh`

- `up` — idempotent and self-healing, safe to run concurrently from several worktrees:
  1. Take a coarse lock (e.g. `flock` on a file under the system temp dir) so two agents
     racing `up` cannot both try to create the container.
  2. If the container is running **and** `mongo_ping` succeeds through the host port → done.
  3. If it is running but the ping fails (stale forward) → stop, start, re-wait.
  4. If it exists but is stopped → start, wait.
  5. If it does not exist → create the volume if needed, `wslc run -d --name
     autotaskcalendar-mongo -p <port>:27017 -v autotaskcalendar-mongo-data:/data/db`.
  6. Retry the recreate path a couple of times with backoff before failing, and print the
     `logs` hint on final failure. Keep the existing real-handshake `mongo_ping` (a TCP
     probe is not sufficient).
- `down` — **no longer stops the shared container.** It drops *this instance's database*
  (`db.dropDatabase()` against `$MONGO_URL`) and reports that the shared server is left
  running for everyone else. Add `down --server` for the rare "actually stop the container"
  case.
- `reset` — drop this instance's database, then `up` (ensuring health). No volume deletion;
  the volume is shared now.
- `status` — show instance name, ports, database name, the shared container's state, plus a
  list of the `autotaskcalendar_*` databases present and their sizes.
- `doctor` — repurposed: report the single container's state, whether the port answers,
  and warn if any *legacy* per-instance containers/volumes still exist, with the exact
  `migrate` command to clean them up.
- `gc` — replaced by `migrate` (below). Keep `gc` as a deprecated alias that prints a
  pointer and exits 0, so existing scripts/docs don't break mid-migration.
- `nuke-all` — removes the one container and the one volume, plus any legacy leftovers.
- New `migrate` — stop and remove every `autotaskcalendar-mongo-*` container and
  `autotaskcalendar-mongo-data-*` volume from the old scheme. Document that old data is
  discarded (dev data is seeded, so this is fine); mention `npm run seed` as the recovery.

### 3. Callers

- `scripts/test.js` — drop the `dev-db.sh gc` call; keep `up`. Test instances now share the
  container and differ only by database name, which is already the case via
  `<branch>-test`.
- `scripts/dev.js` — unchanged apart from the port no longer being offset-derived.
- `package.json` — `db:gc` → `db:migrate`; keep the rest.

### 4. Docs

- New `docs/DEV_DATABASE.md`: the one-container model, why (wslc forward exhaustion), the
  full command reference, the isolation guarantee (database-per-instance), concurrency/
  locking behaviour, and the migration step for anyone with old containers.
- Update `AGENTS.md`'s Containers section to match (one container, `db:migrate` instead of
  `db:gc`, `db:down` drops a database).
- `docs/TESTING.md`: note that the test stack shares the container.

## Tests

Behaviour change ships with a spec. Add `tests/api/dev-database.spec.js` (or similar,
non-Playwright-browser, API-tier) covering:

- `instance.js` resolves the same `containerName`/`volumeName`/`mongoPort` for two different
  instance names, while `dbName`, `apiPort`, `webPort`, `inspectPort` still differ.
- `AUTOTASKCALENDAR_MONGO_PORT` still overrides the shared port.
- Long branch names still yield a ≤63-byte, collision-free `dbName`.
- `dev-db.sh up` is idempotent: running it twice leaves exactly one container.
- `dev-db.sh down` leaves the shared container running and the *other* instance's database
  untouched (seed two databases, drop one, assert the other survives).

## Acceptance

- Only ever one `autotaskcalendar-mongo` container on the host, whatever the branch count.
- Two worktrees can run dev + tests simultaneously without touching each other's data.
- `npm run verify` passes.
