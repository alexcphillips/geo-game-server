# @geo/worker

geo-game on Cloudflare's free plan, replacing the Express server module by
module (the plan is in the "geo-game Backend TODO" doc, "Hosting: move to
Cloudflare"). Live at https://geo-game.alexphillipsdev.workers.dev.

```
src/
├── index.ts        the Worker: forwards every request to the one World object (≈0–1 ms CPU)
├── world.ts        the World Durable Object: owns the SQLite database, runs the API, keeps one alarm
├── app.ts          Hono wiring: routes, 404, errors (AppError → status + { error }); the World's memory
├── jobs.ts         what the alarm runs, by `due` key: turn clocks, dungeon wakes, farm weeks, cleanup
├── db/db.ts        Db: all / one / run / transaction (nested = savepoint) / afterCommit; counts rows read and written
├── db/schema.ts    numbered migrations, run when the World starts (2: every game table; 3: `due`; 4: a narrower runs index)
├── http/           auth (bearer token → playerId, role), JSON body helpers, dev-tools switch, the rate limiter
├── lib/            PBKDF2 passwords, jose tokens, the secret spawn seed (all Web Crypto)
├── realtime/hub.ts who's connected and pushes: a stand-in (nobody connected, nobody gone) until session 5
└── modules/        four-file modules, as in server/ (routes, controller, repository, sql)
    ├── accounts/   sign-up (with the starter kit), sign-in, refresh, sign-out
    ├── player/     /geo/me: gear, bag, hands, lunchbox (and eating from it), bait, camp, bank, pets
    ├── wardrobe/   loadouts, auto-swap
    ├── world/      spawns around the player
    ├── places/     hand-made places near the player
    ├── runs/       combat Runs, solo and shared (a party's boss), flee, dev kill
    ├── fishing/    fishing Runs (same `runs` table)
    ├── chests/     chests won, pending and opened
    ├── dungeons/   lobbies: list, create, join, leave, start
    ├── dungeon-runs/ a party's map, room by room, its ready-up; fights.ts is what Runs call back into
    ├── farming/    the farm, the Research Lab, weekly contests
    ├── jobs/       the `due` table: schedule(key, at)
    └── mayor/, quests/, inbox/   the pieces other modules need until those modules move
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
- **Don't set an indexed column to the value it has**: SQLite rewrites the
  index entry anyway, a second write. `status` is in partial indexes
  (`runs_one_active`, `dungeon_run_members_one_active`), so a step that
  leaves a Run going uses `UPDATE_RUN_STATE`, and a dungeon member is saved
  only when they changed (`saved` on the row). Measure with `rowsWrittenBy`.
- **Memory instead of rows** (`World` in app.ts): presence, each player's
  walking (travel) and spawns' out-of-reach countdowns. A restart forgets
  them, which costs a little banked distance, nothing more.
- **Timed work is a `due` row** (modules/jobs): `schedule(db, key, at)` books
  or moves it, `null` clears it. The World keeps one alarm at the soonest
  row, re-armed after each request only when that time moved (setting it is
  a write). Add a job by adding its key's prefix to `JOBS` in jobs.ts. Never
  `setTimeout`: the World can be evicted between requests.
- **Pushes go after commit**: `db.afterCommit(() => world.hub.publish(…))`.
  Until session 5 the hub is a stand-in: nobody is connected (pushes go
  nowhere) and nobody counts as gone (turn clocks run their full length).
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
