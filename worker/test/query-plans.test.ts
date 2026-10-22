import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { World } from "../src/world";

/**
 * Every statement in every `*.sql.ts` must find its rows through an index or
 * a primary key. A full scan of a table that grows costs a row read per row,
 * on every call, against the free plan's daily reads. A statement that really
 * must scan (a table that stays small) goes in ALLOWED_SCANS with the reason.
 */
const ALLOWED_SCANS: Record<string, string> = {};

const modules = import.meta.glob<Record<string, unknown>>("../src/modules/**/*.sql.ts", { eager: true });
const statements = Object.entries(modules).flatMap(([file, exports]) =>
    Object.entries(exports)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /\b(SELECT|UPDATE|DELETE)\b/i.test(entry[1]))
        .map(([name, sql]) => ({ name: `${file.replace("../src/modules/", "")}:${name}`, sql })),
);

describe("query plans", () => {
    it("finds statements to check", () => {
        expect(statements.length).toBeGreaterThan(5);
    });

    it.each(statements)("$name uses an index", async ({ name, sql }) => {
        const world = env.WORLD.get(env.WORLD.idFromName(env.WORLD_NAME));
        const plan = await runInDurableObject(world, (instance: World) => {
            const params = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => null);
            return instance.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params).map((row) => row.detail);
        });
        const scans = plan.filter((detail) => /^SCAN /.test(detail));
        if (ALLOWED_SCANS[name]) return;
        expect(scans, `${name}\n${plan.join("\n")}`).toEqual([]);
    });
});
