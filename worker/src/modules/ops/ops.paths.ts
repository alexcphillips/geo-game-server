/**
 * The operator's routes, behind GEO_OPS_SECRET (http/ops.ts). Not part of the
 * app's API (`@geo/shared`): only worker/scripts call them.
 */
export const GEO_OPS_PATHS = {
    /** POST { email, role }: the way to the first admin (`npm run geo:admin`). */
    role: "/geo/ops/role",
    /** POST { confirm? }: every player's progress back to the starter kit (`npm run wipe:geo`). Without confirm, only counts. */
    wipe: "/geo/ops/wipe",
    /** POST { sql, params }: one statement in its own transaction; its rows. Only while GEO_DEV_TOOLS is on (the smoke kit). */
    sql: "/geo/ops/sql",
    /** POST { playerId, items }: items straight into an inventory; the new row ids. Only while GEO_DEV_TOOLS is on. */
    grant: "/geo/ops/grant",
    // The rest, dev tools only too: what a smoke suite needs beyond the API.
    /** POST { playerId, amount, reason?, reference? }: coins through the ledger (addCoins). */
    coins: "/geo/ops/coins",
    /** POST { playerId, skill, amount }: skill XP, and the active pet's share (addSkillXp). */
    xp: "/geo/ops/xp",
    /** POST { playerId, events }: quest progress, as a won fight records it (recordQuestEvents). */
    questEvents: "/geo/ops/quest-events",
    /** POST { playerId }: the player's own stat modifiers (gear, pet, talismans); { modifiers }. */
    modifiers: "/geo/ops/modifiers",
    /** POST { at }: pays out farm weeks finished by `at` (ms), as the Monday job does; { nextAt }. */
    farmWeeks: "/geo/ops/farm-weeks",
    /** POST { at? }: runs every due job by `at` (ms; default now), as the alarm does. */
    jobs: "/geo/ops/jobs",
    /** POST { playerId, seconds }: moves the player's spawns' out-of-reach countdowns that far on (World memory). */
    spawnClock: "/geo/ops/spawn-clock",
} as const;
