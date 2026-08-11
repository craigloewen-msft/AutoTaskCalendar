# The dev database

AutoTaskCalendar runs MongoDB in **one** `wslc` container, shared by every branch,
worktree, agent, and test run on the host. Instances are isolated from each other by
*database name*, not by container. `scripts/dev-db.sh` manages it; `npm run db:*` wraps
that script.

## Why one container

wslc holds a host port-forward for every running container. Past a handful of live
forwards it starts resetting connections mid-run, which surfaces as random
`MongoNetworkError` / `MongoPoolClearedError` failures in whichever test was unlucky. The
old scheme created a container, a volume, and a forward per instance — with several agents
and their `-test` twins that added up fast.

A single mongod already isolates databases completely, so the container count is now fixed
at one no matter how many instances exist.

## What is shared and what is not

| Resource | Scope |
| --- | --- |
| Mongo container `autotaskcalendar-mongo` | shared, one per host |
| Volume `autotaskcalendar-mongo-data` | shared, one per host |
| Mongo port (default 27017) | shared, one per host |
| Database `autotaskcalendar_<instance>` | **per instance**, pinned to the branch name |
| API / web / inspect ports | **allocated at startup**, preferred block from the branch name |
| Session cookie | per instance |

`instance.js` is the single source of truth. The Mongo port is deliberately *not* offset by
instance; override it host-wide with `AUTOTASKCALENDAR_MONGO_PORT` if 27017 is taken.

## Ports are allocated, not assumed

The branch name hashes to a *preferred* block of ports, but there are only 49 blocks, so
distinct branches collide routinely — with a handful of agents it is the normal case, not
bad luck. `npm run dev` therefore probes from the preferred block and takes the first one
whose api/web/inspect ports actually bind (`scripts/port-allocator.js`), then prints what it
took:

```
AutoTaskCalendar instance "my-branch"
  web        http://localhost:8490
  api        http://localhost:3410
  debugger   9639
  database   autotaskcalendar_my_branch
  note       preferred block 41 was busy; using 42 instead
```

**That banner is the source of truth for where to connect.** Do not compute the URL from
the branch name; read it from the output. `npm test` allocates the same way.

Before this, two branches that hashed alike both derived port 3030, and the second one
silently drove the first one's server — a different codebase against a different database,
with nothing to indicate it.

Two consequences worth knowing:

- **The database never moves.** Its name is derived from the instance name only, so an
  instance that gets bumped to another port block still opens its own data.
- **Pinning still works.** Set `AUTOTASKCALENDAR_API_PORT`, `AUTOTASKCALENDAR_WEB_PORT` and
  `AUTOTASKCALENDAR_INSPECT_PORT` to bypass allocation entirely.

Running `npx playwright test` directly skips the allocator and will collide with your own
dev stack; go through `npm test`.

## Commands

| Command | Effect |
| --- | --- |
| `npm run db:up` | Ensure the shared container exists, is running, and answers a real MongoDB handshake through the published port. Idempotent and safe to run concurrently. |
| `npm run db:down` | Drop **your instance's database**. The shared server keeps running for everyone else. |
| `scripts/dev-db.sh down --server` | Actually stop the shared container. Affects every instance on the host. |
| `npm run db:reset` | `up`, then drop your database. Follow with `npm run seed`. |
| `npm run db:status` | Instance ports, your database name, container state, and every `autotaskcalendar_*` database with its size. |
| `npm run db:logs` | Follow the shared container's logs. |
| `npm run db:doctor` | Container state, whether the port really answers, and warnings about legacy per-instance containers. |
| `npm run db:migrate` | Remove every container/volume from the old one-per-instance scheme. |
| `scripts/dev-db.sh nuke-all` | Remove the shared container and volume, plus any legacy leftovers. |

## How `up` stays reliable

1. It takes an `flock` on `$TMPDIR/autotaskcalendar-mongo.lock`, so two worktrees racing to
   start the stack cannot both try to create the container.
2. It probes with a real MongoDB handshake, not a TCP connect. A stale wslc forward accepts
   TCP while dropping every handshake, so a socket probe would report a false healthy.
3. Running-but-unreachable → stop and start again. Missing → create volume + container.
4. If it still is not reachable within 60s, it removes the container and retries (3
   attempts, growing backoff) before failing with a pointer to `db:logs`.

Because `up` is convergent, `npm run dev` and `npm test` can both call it freely.

## Migrating from the old scheme

If you have containers named `autotaskcalendar-mongo-<branch>` or volumes named
`autotaskcalendar-mongo-data-<branch>`, they are leftovers:

```bash
npm run db:doctor    # lists them
npm run db:migrate   # removes them
npm run db:up        # start the shared one
npm run seed         # repopulate
```

Migration discards the old volumes' data. Dev data is seeded, so this is intended; there is
no automatic copy.

## Troubleshooting

- **`MongoNetworkError` mid-run.** Run `npm run db:doctor`. If legacy containers are listed,
  `npm run db:migrate`. If the shared container is unreachable, `npm run db:up` repairs the
  forward.
- **Port 27017 already in use by a non-AutoTaskCalendar mongod.** Set
  `AUTOTASKCALENDAR_MONGO_PORT` (in your shell or `config.js`) and re-run `npm run db:up`.
- **Another agent's data showed up in my app.** Check `npm run db:status`: two instances
  resolving to the same `dbName` means the same branch/`AUTOTASKCALENDAR_INSTANCE`. Set
  `AUTOTASKCALENDAR_INSTANCE` explicitly.
- **Wiping everything.** `scripts/dev-db.sh nuke-all && npm run db:up && npm run seed`.
