# geo-game-server

The backend for [geo-game](../geo-game): a Cloudflare Worker and one Durable
Object with SQLite, on the free plan, all under `/geo`. Live at
https://geo-game.alexphillipsdev.workers.dev.

```
geo-game-server/
├── game/     @geo/game: the game itself, no I/O: combat engine, rules, all content (see game/src/README.md)
├── worker/   @geo/worker: the Worker + World Durable Object: storage, API, clock, socket (see worker/README.md);
│             worker/scripts/ has the smoke suites and the operator scripts
└── shared/   @geo/shared: the API contracts; the app copies them with `npm run sync:contracts`
```

## Run it

1. `npm install`
2. `worker/.dev.vars` holds the local secrets (`GEO_JWT_SECRET`, `GEO_OPS_SECRET`,
   `GEO_DEV_TOOLS=true`); git ignores it. For the scripts, `cp .env.example .env`
   and set `GEO_OPS_SECRET` to the same value.
3. `npm run dev:worker`: `wrangler dev` on localhost:8787, reloading on changes.
   The app reaches it with `EXPO_PUBLIC_API_URL=lan` (add `-- --ip 0.0.0.0`).
4. `npm run deploy:worker` deploys.

## Check it

| Command | Does |
| --- | --- |
| `npm run check` | data index, typecheck every workspace, eslint, game and Worker tests, then the content check |
| `npm test` | game tests (node:test) and Worker tests (in workerd) |
| `npm run smoke:geo-<area> --workspace @geo/worker` | an end-to-end suite against `npm run dev:worker`; the list is in `worker/package.json` |

Content (cards, items, enemies, tuning) is in `game/src/data/`; start with
its README.
