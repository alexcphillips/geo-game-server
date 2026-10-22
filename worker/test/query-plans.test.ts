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
};

const modules = import.meta.glob<Record<string, unknown>>("../src/modules/**/*.sql.ts", { eager: true });
const statements = Object.entries(modules).flatMap(([file, exports]) =>
    Object.entries(exports)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /\b(SELECT|UPDATE|DELETE)\b/i.test(entry[1]))
        .map(([name, sql]) => ({ name: `${file.replace("../src/modules/", "")}:${name}`, sql })),
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
