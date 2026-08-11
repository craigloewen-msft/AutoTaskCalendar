# AutoTaskCalendar

This repository's goal is to make a web interface to manage your daily tasks and automatically schedule them on your calendar.

> Working on this repo with an AI agent? See [AGENTS.md](AGENTS.md).

## Set up

You need [`node`](https://github.com/nodesource/distributions/blob/master/README.md) and
[`docker`](https://docs.docker.com/engine/install/). Nothing else — MongoDB runs in a
container that the scripts start for you.

```bash
npm install      # installs this project and webinterface/
npm run seed     # optional: sample data, log in as testuser / testpassword
npm run dev      # database + backend + frontend
```

That's the whole set-up. `npm run dev` prints the URLs it picked, normally
<http://localhost:8080>. The frontend hot reloads and the backend restarts via nodemon.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the full stack. |
| `npm test` | Runs the Playwright suite, building the frontend first if needed. |
| `npm run seed` | Resets the database to the sample dataset. |
| `npm run build` | Production build into `dist/`. |

See [docs/TEST_CREDENTIALS.md](docs/TEST_CREDENTIALS.md) for the seeded login details.

## Running more than one copy

Every git branch gets its own database and its own ports, so several checkouts — or
several AI agents — can run at once without colliding. Ports are probed at startup, so a
busy one is simply skipped. Set `AUTOTASKCALENDAR_INSTANCE` to run two stacks on one
branch:

```bash
AUTOTASKCALENDAR_INSTANCE=agent2 npm run dev
```

All instances share one `autotaskcalendar-mongo` container and are isolated by database
name.

## Configuration

Copy `defaultconfig.js` to `config.js` to override settings locally; `config.js` is
gitignored and takes precedence. In production, values are read from environment
variables instead (`prodMongoDBConnectionString`, `secret`, `sessionSecret`,
`googleOAuthClientID`, `googleOAuthClientSecret`, `appUrl`).

## If the database misbehaves

The scripts own the container, but it is a normal Docker container if you need to poke it:

```bash
docker logs autotaskcalendar-mongo             # what happened
docker rm -f autotaskcalendar-mongo            # rebuilt next command, data survives
docker volume rm autotaskcalendar-mongo-data   # also throws the data away
```
