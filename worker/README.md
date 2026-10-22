# @geo/worker

geo-game on Cloudflare's free plan, replacing the Express server module by
module (the plan is in the "geo-game Backend TODO" doc, "Hosting: move to
Cloudflare"). Live at https://geo-game.alexphillipsdev.workers.dev.

```
src/
├── index.ts        the Worker: forwards every request to the one World object (≈0–1 ms CPU)
├── world.ts        the World Durable Object: owns the SQLite database, runs the API
├── app.ts          Hono wiring: routes, 404, errors (AppError → status + { error }); the World's memory
├── db/db.ts        Db: all / one / run / transaction over the object's SQLite; counts rows read and written
├── db/schema.ts    numbered migrations, run when the World starts (step 2: every game table)
├── http/           auth (bearer token → playerId, role), JSON body helpers, the in-memory rate limiter
├── lib/            PBKDF2 passwords, jose tokens, the secret spawn seed (all Web Crypto)
└── modules/        four-file modules, as in server/ (routes, controller, repository, sql)
    ├── accounts/   sign-up (with the starter kit), sign-in, refresh, sign-out
    ├── player/     /geo/me: gear, bag, hands, lunchbox, bait, camp, bank, pets
    ├── wardrobe/   loadouts, auto-swap
    ├── world/      spawns around the player
    ├── places/     hand-made places near the player
    └── mayor/, quests/, runs/   read-only pieces other modules need until those modules move
```

Pure game code (content, engine, AppError, account rules, spawns and travel,
stat sheet, modifier maths in `world/modifiers.ts`) is imported from
`server/src` until the Express server is retired.

## Rules

- **Writes are the budget**: 100k rows a day on the free plan, and every index
  entry counts. Tables keyed by a TEXT id are `WITHOUT ROWID`. Tests assert
  rows written per endpoint (each module's "write budget" test).
- **Every query uses an index**: `test/query-plans.test.ts` runs
  `EXPLAIN QUERY PLAN` on each statement in `src/modules/**/*.sql.ts` and fails on
  a full scan.
- **Import SQL modules with the extension**: `./accounts.sql.ts`, not
  `./accounts.sql`. Wrangler treats an import ending in `.sql` as a text file.
- **Database work is synchronous**: a controller awaits what it must (the
  body, a token, a password hash, a seed) first, then does every read and
  write in one `db.transaction(() => …)`, which takes no `await`. Other
  requests can run during an `await`, never inside the block.
- **Memory instead of rows** (`World` in app.ts): presence, each player's
  walking (travel) and spawns' out-of-reach countdowns. A restart forgets
  them, which costs a little banked distance, nothing more.
- **Tables are STRICT**: a fractional number in an INTEGER column (times are
  whole ms) throws, where Postgres rounded. JSON columns are TEXT, a list of
  ids goes in as a JSON array and is read with `json_each(?)`.
- **Dev routes** (`/geo/dev/*`, `?fill=true`) answer only while
  `GEO_DEV_TOOLS` is `"true"` (wrangler.jsonc); turn it off at cutover.
- **Resetting the deployed database** (only until the game moves here): change
  `WORLD_NAME` in `wrangler.jsonc` and deploy; the new name starts empty.

## Commands

From the repo root:

| Command | Does |
| --- | --- |
| `npm run test --workspace @geo/worker` | tests in workerd (Miniflare, local) |
| `npm run dev:worker` | `wrangler dev` on localhost:8787 (reads `worker/.dev.vars`) |
| `npm run deploy:worker` | deploys to Cloudflare |
| `npx wrangler tail geo-game --format json` (in `worker/`) | live requests, with CPU time per request |

The deployed token secret is set with `wrangler secret put GEO_JWT_SECRET`
(already done). Locally it's `worker/.dev.vars`, which git ignores.
