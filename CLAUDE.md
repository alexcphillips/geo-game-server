geo-game's backend. The app is `../geo-game`. Start with `server/src/README.md` (layout, modules) and `server/src/data/README.md` (content).

- Three npm workspaces: `server/` (`@geo/server`, Express + Postgres + `ws`, serving the game today), `worker/` (`@geo/worker`, the Cloudflare port, read worker/README.md before touching it) and `shared/` (`@geo/shared`, the API contracts). `shared/` has no runtime dependencies and must run in the app too.
- Tables are in the `geo` Postgres schema, still inside cozy-app's database for now (`DB_NAME`).
- After changing anything in `shared/src/`, run `npm run sync:contracts` in `../geo-game`.
- In progress: the move to Cloudflare Workers + a Durable Object with SQLite, free plan, session by session. The plan is in the "geo-game Backend TODO" doc's "Hosting: move to Cloudflare" section. New server work should port easily: no new Postgres-only features.

## Checking work

- `npm run check`: data index up to date, typecheck (all workspaces), eslint, `npm test` (server + Worker), then `geo:data`.
- `npm run smoke:geo-<area> --workspace @geo/server` runs an end-to-end suite against the dev database (throwaway accounts, cleaned up). The list is in `server/package.json`.
- `npm run geo:data --workspace @geo/server` checks content alone.

## Conventions

- Modules are four files: `*.routes.ts`, `*.controller.ts` (read and check the request), `*.repository.ts` (all database work), `*.sql.ts` (the SQL text).
- Reject with `AppError` (`badRequest`, `notFound`…), never `res.status(4xx)`. Shared request checks are in `lib/validate.ts` (`isUuid`, `wholeNumber`), each taking the endpoint's own error. A malformed id that reaches Postgres still becomes a 400 (`middleware/geo-db-errors.ts`).
- Only `config/env.ts` reads `process.env`.
- Anything writing more than one row runs in `withTransaction`, takes `playerRepository.lockPlayer` first, and only queries through `tx`. Mid-Run guards: `runsRepository.assertNotInRun`, `assertHandNotInRun`.
- Content is one TypeScript file per thing in `data/`, typed `satisfies <Model>` from `#geo/models`. It loads through `content/data.generated.ts` (static imports, so it runs in a Worker): after adding, moving or removing a data file run `npm run data:index --workspace @geo/server` (`npm run dev` does it). The loader checks it at boot.
- Combat rules are data (`data/EFFECTS.md`); a new trigger, condition or action goes in `engine/engine.types.ts` and `engine/battle.ts`, with a test.
- `world/app-sprites.generated.ts` is written by geo-game's sprite generator (runs on its `npm start`, or `npm run assets`); don't edit it.
- The socket takes only `/geo/socket` upgrades and leaves any other path to another `upgrade` listener (destroying it only when there's none).

## Shell

- zsh: quote globs, e.g. `grep -rn x --include='*.ts' server/src`.
