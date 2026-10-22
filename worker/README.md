# @geo/worker

geo-game on Cloudflare's free plan, replacing the Express server module by
module (the plan is in the "geo-game Backend TODO" doc, "Hosting: move to
Cloudflare"). Live at https://geo-game.alexphillipsdev.workers.dev.

```
src/
├── index.ts        the Worker: forwards every request to the one World object (≈0–1 ms CPU)
├── world.ts        the World Durable Object: owns the SQLite database, runs the API, keeps one alarm
├── app.ts          Hono wiring: routes, 404, errors (AppError → status + { error }); the World's memory
├── jobs.ts         what the alarm runs, by `due` key: turn clocks, dungeon wakes, auction ends, the election, farm weeks, cleanup
├── db/db.ts        Db: all / one / run / transaction (nested = savepoint) / afterCommit; counts rows read and written
├── db/schema.ts    numbered migrations, run when the World starts (2: every game table; 3: `due`; 4: a narrower runs index;
│                   5: the Market's singles index and seller-delete refund trigger; 6: `gone`, when a party member dropped)
├── http/           auth (bearer token → playerId, role), JSON body helpers, dev-tools switch, the rate limiter
│                   (per IP, or per player with `key`), the ops secret
├── lib/            PBKDF2 passwords, jose tokens, the secret spawn seed (all Web Crypto)
├── realtime/       the geo socket: hub.ts (hibernating sockets, who's connected, pushes), presence.ts (sign-in
│                   snapshots, what coming and going changes), socket.routes.ts (the upgrade at /geo/socket)
└── modules/        four-file modules, as in server/ (routes, controller, repository, sql)
    ├── content/    GET /geo/content (built once per World instance) and /geo/health
    ├── accounts/   sign-up (with the starter kit), sign-in, refresh, sign-out
    ├── player/     /geo/me: gear, bag, hands, lunchbox (and eating from it), bait, camp, bank, pets
    ├── wardrobe/   loadouts, auto-swap
    ├── world/      spawns around the player
    ├── places/     hand-made places near the player; admin.ts: admins make, edit and remove them
    ├── runs/       combat Runs, solo and shared (a party's boss), flee, dev kill
    ├── fishing/    fishing Runs (same `runs` table)
    ├── chests/     chests won, pending and opened
    ├── dungeons/   lobbies: list, create, join, leave, start
    ├── dungeon-runs/ a party's map, room by room, its ready-up; fights.ts is what Runs call back into
    ├── farming/    the farm, the Research Lab, weekly contests, admin's next cycle
    ├── quests/     the quest log: given, tracked, counted, claimed
    ├── vendors/    NPC buy, sell, reforge, Kat's pet upgrades
    ├── crafting/   recipes
    ├── market/     listings, stacks, bids (an auction's end is its `auction:<id>` due row), collect
    ├── mayor/      the weekly election (its end is the `election` due row) and the mayor's perks
    ├── friends/    friends and requests; presence is World memory (`presence`, `lastHeard`)
    ├── inbox/, feedback/, suggestions/   mail and announcements, players' feedback, suggested places
    ├── admin/      game-admin tools, every change audited
    ├── ops/        the operator's routes behind GEO_OPS_SECRET: first admin, wipe, and (dev tools only) SQL and grants
    └── jobs/       the `due` table: schedule(key, at)
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
- **Memory instead of rows** (`World` in app.ts): who was last heard over
  HTTP, each player's walking (travel) and spawns' out-of-reach countdowns.
  A restart or hibernation forgets them, which costs a little banked
  distance, nothing more.
- **Timed work is a `due` row** (modules/jobs): `schedule(db, key, at)` books
  or moves it, `null` clears it. The World keeps one alarm at the soonest
  row, re-armed after each request only when that time moved (setting it is
  a write). Add a job by adding its key's prefix to `JOBS` in jobs.ts. Never
  `setTimeout`: the World can be evicted between requests.
- **Pushes go after commit**: `db.afterCommit(() => world.hub.publish(…))`.
- **Sockets hibernate** (realtime/hub.ts): the World can leave memory with
  sockets open and starts again for their next message, so what a socket
  must remember (whose it is, its token's expiry, the player's activity) is
  its attachment. `ping` is answered by the runtime without waking the World.
  Short timers (10 s sign-in wait, 10 s offline grace, 250 ms push
  coalescing) are `setTimeout`s, which keep the World awake while they run;
  the hourly ones (`reauth`, closing an expired token) go through the alarm,
  by the minute. A silent socket is closed by the next request or alarm
  (`sweep`). Memory is lost at every hibernation, so when a player in a
  party or shared fight went offline is the `gone` table (migration 6).
- **Tables are STRICT**: a fractional number in an INTEGER column (times are
  whole ms) throws, where Postgres rounded. JSON columns are TEXT, a list of
  ids goes in as a JSON array and is read with `json_each(?)`.
- **Dev routes** (`/geo/dev/*`, `?fill=true`) answer only while
  `GEO_DEV_TOOLS` is `"true"` (wrangler.jsonc); turn it off at cutover.
- **Operator routes** (`/geo/ops/*`, `modules/ops/ops.paths.ts`) answer only
  with `Authorization: Bearer <GEO_OPS_SECRET>` (404 otherwise). The dev
  scripts reach them with `--url <base>` and GEO_OPS_SECRET in the root
  `.env`: `npm run geo:admin -- you@example.com --url …`, `npm run wipe:geo
  -- --url … [--yes]`, and any smoke suite (`-- --url …`; without it, the
  suites use `npm run dev:worker` at localhost:8787). The dev routes the
  suites use (SQL, grants, coins, XP, quest events, modifiers, farm weeks,
  due jobs, the spawn clock) also need `GEO_DEV_TOOLS`, and the kit's calls
  skip the rate limits by sending the secret in `X-Geo-Ops`.
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

The deployed secrets are set with `wrangler secret put GEO_JWT_SECRET` and
`wrangler secret put GEO_OPS_SECRET` (both done; the ops one matches the
root `.env`). Locally they're in `worker/.dev.vars`, which git ignores.
