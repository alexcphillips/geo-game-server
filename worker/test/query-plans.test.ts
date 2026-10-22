import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { World } from "../src/world";

/**
 * Every statement in every `*.sql.ts` must find its rows through an index or
 * a primary key. A full scan of a table that grows costs a row read per row,
 * on every call, against the free plan's daily reads. A statement that really
 * must scan (a table that stays small) goes in ALLOWED_SCANS with the reason.
 *
 * Not table scans, so not counted: walking a JSON list passed in
 * (`json_each(?)`, a virtual table), SQLite's one-row constant scan, and a
 * statement's own CTEs and subqueries (`CO-ROUTINE`s), whose rows were
 * already found through an index.
 */
const ALLOWED_SCANS: Record<string, string> = {
    "mayor/mayor.sql.ts:CURRENT_MAYOR": "walks elections_closed newest first and stops at the first row (LIMIT 1)",
    "jobs/jobs.sql.ts:FIND_DUE": "due holds one row per live fight or dungeon plus a few; an index would cost a write per reschedule",
    "jobs/jobs.sql.ts:NEXT_DUE": "as FIND_DUE",
    "jobs/jobs.sql.ts:DELETE_OLD_REFRESH_TOKENS": "once a day; an index on expiry would cost a write on every sign-in and refresh",
    "dungeons/dungeons.sql.ts:LIST_OPEN_LOBBIES": "walks dungeon_lobbies_open, a partial index holding only lobbies waiting to start",
    "inbox/inbox.sql.ts:FIND_ANNOUNCEMENTS": "walks announcements_created newest first and stops at 100",
    "market/market.sql.ts:FIND_ACTIVE_SINGLES": "walks market_listings_singles (live single items only) newest first and stops at 500",
    "ops/ops.sql.ts:RESET_PLAYERS": "the wipe: every player, on purpose",
    "ops/ops.sql.ts:DELETE_PROGRESS_JOBS": "the wipe: due holds a few rows (see FIND_DUE)",
    // Admin pages: an admin opens them now and then, and an index for each would cost writes all day.
    "admin/admin.sql.ts:FIND_ALL_PLAYERS": "admin only; walks every player",
    "admin/admin.sql.ts:SEARCH_PLAYERS": "admin only; a LIKE '%…%' can't use an index",
    "admin/admin.sql.ts:FIND_AUDIT": "admin only; walks the rowid newest first and stops at 200",
    "admin/admin.sql.ts:SUM_PURSES": "admin only (economy page)",
    "admin/admin.sql.ts:LEDGER_LAST_DAY": "admin only (economy page); an index on time would cost a write per coin movement",
    "admin/admin.sql.ts:LEDGER_MISMATCHES": "admin only (economy page): checks every purse against every ledger row",
    "market/market.sql.ts:SUM_HELD_ALL": "admin only (economy page)",
    "market/market.sql.ts:SUM_UNCOLLECTED_ALL": "admin only (economy page)",
    "feedback/feedback.sql.ts:FIND_ALL_FEEDBACK": "admin only; one status at a time uses feedback_status",
    "feedback/feedback.sql.ts:COUNT_FEEDBACK": "admin only; walks feedback_status",
    "suggestions/suggestions.sql.ts:FIND_ALL_SUGGESTIONS": "admin only; one status at a time uses location_suggestions_status",
    "suggestions/suggestions.sql.ts:COUNT_SUGGESTIONS": "admin only; walks location_suggestions_status",
    "inbox/inbox.sql.ts:FIND_ALL_ANNOUNCEMENTS": "admin only; walks announcements_created newest first and stops at 200",
    "places/places.sql.ts:FIND_PLACES": "admin only; walks places_created newest first and stops at 1000",
};

const modules = import.meta.glob<Record<string, unknown>>(["../src/modules/**/*.sql.ts", "../src/realtime/*.sql.ts"], { eager: true });
const statements = Object.entries(modules).flatMap(([file, exports]) =>
    Object.entries(exports)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /\b(SELECT|UPDATE|DELETE)\b/i.test(entry[1]))
        .map(([name, sql]) => ({ name: `${file.replace("../src/modules/", "").replace("../src/", "")}:${name}`, sql })),
);

/** How many values a statement binds: the highest `?N`, or one per bare `?`. */
function paramCount(sql: string): number {
    const numbered = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]));
    return numbered.length > 0 ? Math.max(...numbered) : (sql.match(/\?/g) ?? []).length;
}

describe("query plans", () => {
    it("finds statements to check", () => {
        expect(statements.length).toBeGreaterThan(5);
    });

    it.each(statements)("$name uses an index", async ({ name, sql }) => {
        const world = env.WORLD.get(env.WORLD.idFromName(env.WORLD_NAME));
        const plan = await runInDurableObject(world, (instance: World) => {
            const params = Array.from({ length: paramCount(sql) }, () => null);
            return instance.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params).map((row) => row.detail);
        });
        const coroutines = new Set(plan.flatMap((detail) => detail.match(/^CO-ROUTINE (.+)$/)?.[1] ?? []));
        const scans = plan.filter(
            (detail) => /^SCAN /.test(detail) && !/VIRTUAL TABLE|^SCAN CONSTANT ROW/.test(detail) && !coroutines.has(detail.slice(5)),
        );
        if (ALLOWED_SCANS[name]) return;
        expect(scans, `${name}\n${plan.join("\n")}`).toEqual([]);
    });
});
