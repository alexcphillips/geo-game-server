import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { buildContent } from "./build";
import { GameDataError, isDataFile } from "./data";
import { DATA_DIR, listDataFiles, loadGameData } from "./data.disk";
import { DATA_FILES } from "./data.generated";
import { DATA_FOLDERS, type DataFolder } from "./data.schema";
import { checkContent } from "./index";

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A throwaway copy of `data/` to break on purpose. */
function copyOfData(): string {
    const dir = mkdtempSync(join(tmpdir(), "geo-data-"));
    dirs.push(dir);
    cpSync(DATA_DIR, dir, { recursive: true });
    return dir;
}

async function problemsIn(dir: string): Promise<string[]> {
    try {
        const data = await loadGameData(dir);
        return checkContent(buildContent(data).content, data.config);
    } catch (error) {
        if (error instanceof GameDataError) return error.problems;
        throw error;
    }
}

/** Swaps text in a data file, which must contain it. */
function edit(path: string, from: string, to: string) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(from), `${path} has ${from}`);
    writeFileSync(path, source.replace(from, to));
}

describe("game data files", () => {
    it("the real data loads with no problems", async () => {
        assert.deepEqual(await problemsIn(DATA_DIR), []);
    });

    it("the generated index lists exactly the files in data/", () => {
        assert.deepEqual(
            DATA_FILES.map((file) => file.path),
            listDataFiles().filter(isDataFile),
            "content/data.generated.ts is out of date: run `npm run data:index`",
        );
    });

    it("names the file and field of a bad value, and every problem at once", async () => {
        const dir = copyOfData();
        edit(join(dir, "cards/combat/slash.ts"), "maxCharges: 100", 'maxCharges: "lots"');
        edit(join(dir, "food/bread.ts"), "heal: 15", "heals: 15");
        const problems = await problemsIn(dir);
        assert.ok(problems.some((line) => line.startsWith("cards/combat/slash.ts: maxCharges:")), problems.join("\n"));
        assert.ok(problems.some((line) => line.startsWith("food/bread.ts:") && line.includes("heals")), problems.join("\n"));
    });

    it("rejects a file whose id isn't its name", async () => {
        const dir = copyOfData();
        edit(join(dir, "weapons/claymore.ts"), 'id: "claymore"', 'id: "big-sword"');
        assert.ok((await problemsIn(dir)).some((line) => line.includes("rename it big-sword.ts")));
    });

    it("rejects an unknown folder, a file that won't load, and one with no default export", async () => {
        const dir = copyOfData();
        cpSync(join(dir, "weapons"), join(dir, "weapon"), { recursive: true });
        writeFileSync(join(dir, "misc/rift-lens.ts"), "export default { nope");
        edit(join(dir, "misc/rusty-chest-key.ts"), "export default", "export const key =");
        const problems = await problemsIn(dir);
        assert.ok(problems.some((line) => line.startsWith("weapon: not a data folder")), problems.join("\n"));
        assert.ok(problems.some((line) => line.startsWith("misc/rift-lens.ts: doesn't load")), problems.join("\n"));
        assert.ok(problems.includes("misc/rusty-chest-key.ts: has no `export default { … }`"), problems.join("\n"));
    });

    it("catches references to things that don't exist", async () => {
        const dir = copyOfData();
        edit(join(dir, "recipes/combat/envenom.ts"), 'itemId: "spider-fang"', 'itemId: "spider-fangs"');
        edit(join(dir, "config/spawns.ts"), 'enemyId: "spider"', 'enemyId: "dragon"');
        const problems = await problemsIn(dir);
        assert.ok(problems.includes(`Recipe "envenom" uses unknown item "spider-fangs"`), problems.join("\n"));
        assert.ok(problems.includes(`config/spawns.ts spawns unknown enemy "dragon"`), problems.join("\n"));
    });

    it("checks dungeon layouts: their folder, styles, keys and every roll", async () => {
        const moved = copyOfData();
        cpSync(join(moved, "dungeon-layouts/slime-pits/slime-pits-b.ts"), join(moved, "dungeon-layouts/slime-pits-b.ts"));
        rmSync(join(moved, "dungeon-layouts/slime-pits/slime-pits-b.ts"));
        assert.ok((await problemsIn(moved)).includes("dungeon-layouts/slime-pits-b.ts: a slime-pits layout goes in dungeon-layouts/slime-pits/"));

        const dir = copyOfData();
        edit(join(dir, "dungeons/slime-pits.ts"), 'style: "sluice" }', 'style: "sewer" }');
        edit(join(dir, "dungeons/slime-pits.ts"), 'lock: "sluice-key"', 'lock: "sewer-key"');
        edit(join(dir, "dungeon-layouts/slime-pits/slime-pits-a.ts"), 'place: [{ room: "den", at: [1, 2] }]', "place: []");
        const problems = await problemsIn(dir);
        const has = (text: string) => assert.ok(problems.some((line) => line.includes(text)), `${text}\n${problems.join("\n")}`);
        has('Dungeon "slime-pits" room "sluice-gate" uses unknown room style "sewer"');
        has('Dungeon "slime-pits" room "sluice-gate" is locked by unknown item "sewer-key"');
        has('Dungeon layout "slime-pits-a": needs exactly one boss room, has 0');
    });

    it("every example in the folder guides is a valid file", async () => {
        const dir = mkdtempSync(join(tmpdir(), "geo-examples-"));
        dirs.push(dir);
        const guides = readdirSync(DATA_DIR, { withFileTypes: true, recursive: true }).filter((entry) => entry.name === "README.md");
        let checked = 0;
        for (const guide of guides) {
            const folder = relative(DATA_DIR, guide.parentPath).split("/")[0] as DataFolder;
            const schema = DATA_FOLDERS[folder];
            if (!schema) continue;
            const text = readFileSync(join(guide.parentPath, guide.name), "utf8");
            for (const [index, [, example]] of [...text.matchAll(/```ts\n([\s\S]*?)```/g)].entries()) {
                const file = join(dir, `${folder}-${index}.ts`);
                writeFileSync(file, example ?? "");
                const { default: entry } = (await import(file)) as { default: unknown };
                const parsed = schema.safeParse(entry);
                assert.ok(parsed.success, `${relative(DATA_DIR, guide.parentPath)} example ${index + 1}: ${parsed.error?.message}`);
                checked += 1;
            }
        }
        assert.ok(checked > 10, `checked ${checked} examples`);
    });
});
