# @geo/worker

geo-game on Cloudflare's free plan, replacing the Express server module by
module (the plan is in the "geo-game Backend TODO" doc, "Hosting: move to
Cloudflare"). Live at https://geo-game.alexphillipsdev.workers.dev.

```
src/
├── index.ts        the Worker: forwards every request to the one World object (≈0–1 ms CPU)
├── world.ts        the World Durable Object: owns the SQLite database, runs the API
├── app.ts          Hono wiring: routes, 404, errors (AppError → status + { error })
├── db/db.ts        Db: all / one / run / transaction over the object's SQLite; counts rows read and written
├── db/schema.ts    numbered migrations, run when the World starts
├── http/           JSON body helpers, the in-memory rate limiter
├── lib/            PBKDF2 passwords (Web Crypto), jose tokens
└── modules/        four-file modules, as in server/ (routes, controller, repository, sql)
```

Pure game code (content, engine, AppError, account rules) is imported from
`server/src` until the Express server is retired.

## Rules

- **Writes are the budget**: 100k rows a day on the free plan, and every index
  entry counts. Tables keyed by a TEXT id are `WITHOUT ROWID`. Tests assert
  rows written per endpoint (`test/accounts.test.ts`).
- **Every query uses an index**: `test/query-plans.test.ts` runs
  `EXPLAIN QUERY PLAN` on each statement in `src/modules/**/*.sql.ts` and fails on
  a full scan.
- **Import SQL modules with the extension**: `./accounts.sql.ts`, not
  `./accounts.sql`. Wrangler treats an import ending in `.sql` as a text file.
- **Database work is synchronous**: `db.transaction(() => …)` takes no `await`.
  Hash passwords and sign tokens before or after, never inside.
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
