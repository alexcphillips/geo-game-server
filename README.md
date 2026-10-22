# geo-game-server

The backend for [geo-game](../geo-game): Express, Postgres and a WebSocket, all
under `/geo`. It used to be a module inside cozy-app's server, and is moving to
Cloudflare Workers, module by module.

```
geo-game-server/
├── server/   @geo/server: the API on Express + Postgres, serving the game today (see server/src/README.md)
├── worker/   @geo/worker: the same API on Cloudflare Workers + SQLite, being ported (see worker/README.md)
└── shared/   @geo/shared: the API contracts; the app copies them with `npm run sync:contracts`
```

## Run it

1. `cp .env.example .env` and fill it in. It needs a Postgres it can reach
   (`DB_*`) and `GEO_JWT_SECRET`, which signs tokens and seeds spawns.
2. `npm install`
3. `npm run dev`: the server on port 3001, restarting on changes. The `geo`
   schema is created or brought up to date at boot.

## Check it

| Command | Does |
| --- | --- |
| `npm run check` | data index, typecheck every workspace, eslint, server and Worker tests, then the content check |
| `npm test` | server unit tests (no database needed) and Worker tests (in workerd) |
| `npm run smoke:geo-<area> --workspace @geo/server` | an end-to-end suite against the Worker (`npm run dev:worker` first, or `-- --url <base>`); the list is in `server/package.json` |

Content (cards, items, enemies, tuning) is in `server/src/data/`; start with
its README.
