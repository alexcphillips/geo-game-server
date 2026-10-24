geo-game's backend. The app is `../geo-game`. Start with `game/src/README.md` (the game and how it behaves), `worker/README.md` (the Cloudflare backend and its rules) and `game/src/data/README.md` (content).

- Three npm workspaces: `game/` (`@geo/game`: engine, rules, content; no I/O, runs in Node and the Worker), `worker/` (`@geo/worker`: the Worker + one World Durable Object with SQLite, Cloudflare free plan; `worker/scripts/` are Node scripts against it) and `shared/` (`@geo/shared`, the API contracts). `shared/` has no runtime dependencies and must run in the app too.
- The Worker imports game code by relative path (`../../../../game/src/content`). Nothing in `game/` may import from `worker/` or use Node-only APIs outside `game/src/dev/`, `content/data.disk.ts` and tests.
- After changing anything in `shared/src/`, run `npm run sync:contracts` in `../geo-game`.

## Checking work

- `npm run check`: data index up to date, typecheck (all workspaces and `worker/scripts`), eslint, `npm test` (game + Worker), then `geo:data`.
- `npm run smoke:geo-<area> --workspace @geo/worker` runs an end-to-end suite against `npm run dev:worker` (localhost:8787; needs GEO_OPS_SECRET in `.env`). workers.dev has dev tools off, so the suites don't run there. The list is in `worker/package.json`.
- `npm run geo:data --workspace @geo/game` checks content alone.

## Conventions

- Worker modules are four files: `*.routes.ts`, `*.controller.ts` (read and check the request), `*.repository.ts` (all database work), `*.sql.ts` (the SQL text). The rules in `worker/README.md` apply (write budget, indexed queries, synchronous transactions, `due` rows for timed work).
- Reject with `AppError` (`badRequest`, `notFound`…) from `game/src/http/AppError.ts`. Shared request checks are in `game/src/lib/validate.ts` (`isUuid`, `wholeNumber`), each taking the endpoint's own error.
- Content is one TypeScript file per thing in `game/src/data/`, typed `satisfies <Model>` from `#geo/models`. It loads through `content/data.generated.ts` (static imports, so it runs in a Worker): after adding, moving or removing a data file run `npm run data:index --workspace @geo/game`. The loader checks it at load.
- Combat rules are data (`data/EFFECTS.md`); a new trigger, condition or action goes in `engine/engine.types.ts` and `engine/battle.ts`, with a test.
- Missing art never blocks content. Build an enemy in full with its `sprite` id before the png exists: until geo-game has the image it just doesn't spawn on the map (`hasArt` in `game/src/world/spawns.ts`), and it starts spawning once the user adds it and the sprite list regenerates.
- `game/src/world/app-sprites.generated.ts` is written by geo-game's sprite generator (runs on its `npm start`, or `npm run assets`); don't edit it.

## Shell

- zsh: quote globs, e.g. `grep -rn x --include='*.ts' game/src`.
