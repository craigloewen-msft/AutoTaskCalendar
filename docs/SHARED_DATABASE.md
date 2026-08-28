# The shared database

Every agent, every checkout, and every test run on this machine use **one MongoDB, one
database**: `mongodb://127.0.0.1:27017/autotaskcalendar`. Nothing is derived from the git
branch, nothing is probed, and nothing is configured. Isolation between agents is the IDE's
job; isolation between tests is by **seed namespace** inside that one database.

## The declaration

`.kingdom/services.toml` is committed and is what Kingdom reads:

```toml
[[service]]
type   = "docker"
name   = "mongo"
image  = "mongo:7"
port   = 27017
volume = "autotaskcalendar-mongo-data"
```

Kingdom raises that container once for the whole machine, reference-counted across plans,
and every plan reaches it at `localhost:27017` on its own loopback. There is no address to
configure and no environment variable to read.

**A plan must never start, stop, or restart that container.** Other agents are using it.

## Ports

Fixed, because each plan has a loopback of its own:

| What | Port | Override |
| --- | --- | --- |
| API | 3000 | `AUTOTASKCALENDAR_API_PORT` |
| Web (vue-cli) | 8080 | `AUTOTASKCALENDAR_WEB_PORT` |
| Node inspector | 9229 | `AUTOTASKCALENDAR_INSPECT_PORT` |
| MongoDB | 27017 | `AUTOTASKCALENDAR_MONGO_URL` |

`instance.js` is the single source of truth and is now just these constants. The overrides
exist for the one case the fixed numbers do not cover: two stacks on one **unisolated**
host, where the second gets `EADDRINUSE` and should be pinned elsewhere.

## Namespaces

A namespace is a tenant: a set of users, plus everything those users own (tasks, events,
roles, goals, projects, weekly plans, OAuth state). Every seeded user carries the namespace
in two indexed fields:

- `seedNamespace` — the tenant it belongs to;
- `seededAt` — when it was created, which is what the sweeper reads.

Usernames are prefixed too (`<namespace>-testuser`), so logging in as a specific tenant works
over the real API.

Every application query is already scoped by the authenticated user's `_id`, so two tenants
in one database cannot see each other — which is what makes the sharing safe.

| Who | Namespace |
| --- | --- |
| `npm run seed` | `local`, or `AUTOTASKCALENDAR_INSTANCE` slugified |
| a Playwright test | `pw-<run-id>-<worker>-<test-hash>` |

The run id comes from `scripts/test.js` and is exported as `AUTOTASKCALENDAR_TEST_RUN_ID`, so
two agents running the suite at the same instant cannot collide.

## Seeding

```bash
npm run seed              # this checkout's namespace: local-testuser / testpassword
npm run seed -- --global  # wipe the whole shared database, bare testuser / testpassword
```

`runSeed()` **refuses to run without a namespace** unless you pass `{ global: true }`. The
guard is deliberate: sharing one database means a stray wipe costs every other agent their
work, so the destructive path has to be asked for by name.

`--global` is for your own machine when you want the documented bare credentials. Do not run
it while other agents are working.

## Cleaning up

| Call | What it removes |
| --- | --- |
| `wipeNamespace(ns)` | One tenant. The `seed` fixture calls this after every test. |
| `wipeNamespacePrefix(prefix)` | Every tenant of one test run. `scripts/test.js` calls this at the end. |
| `sweepStaleNamespaces({ olderThanMs })` | Tenants older than 24h by default — the ones left by runs that were killed. |

Nothing drops the database any more. The sweeper is what stops abandoned tenants
accumulating, and it runs at the end of every `npm test`.

## Writing a spec that shares a database with everyone else's

1. **Never query without a scope.** `TaskDetails.find({})` will see other agents' data and
   will be flaky. Always filter by `userRef`, or by `seedNamespace` on users.
2. **Never assert on a global count.** `countDocuments({})` is meaningless here. Count
   within your tenant.
3. **Never call `runSeed({ global: true })` from a test.**
4. Use the `seed` fixture rather than seeding by hand; it namespaces and cleans up for you.
5. Reading the database directly? Wrap it in `withDb` so the connection exists first.

`tests/api/shared-database.spec.js` is the executable version of this contract.

## When Kingdom is not running the database

Outside the IDE, `scripts/db.js` is the fallback. `ensureDatabase()` first pings
`127.0.0.1:27017`; if anything answers it returns immediately and never touches Docker.
Only when nothing answers does it start an `autotaskcalendar-mongo` container on exactly
that port, with the same `autotaskcalendar-mongo-data` volume the manifest names — so the
data is the same either way. `dev`, `test`, and `seed` all call it, and it is convergent.

If the port is held by something that is not MongoDB, the script says so rather than
searching for another port; point the stack elsewhere with `AUTOTASKCALENDAR_MONGO_URL`.

```bash
docker logs autotaskcalendar-mongo     # why it will not start
docker rm -f autotaskcalendar-mongo    # only outside Kingdom, and only if nobody is working
```

## Production

Untouched. When `NODE_ENV=production`, `app.js` uses `prodMongoDBConnectionString` and none
of the above applies.
