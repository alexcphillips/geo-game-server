import type { z } from "zod";
import { CONFIG_FILES, DATA_FOLDERS, type ConfigFile, type DataFolder, type GameData } from "./data.schema";

/**
 * Checks `data/`: every card, item, enemy and tuning number in the game, one
 * TypeScript file each, whose default export is the entry. See
 * `data/README.md` for the layout, and each folder's README.md for its
 * fields; the models they're written against are `content/models.ts`.
 *
 * Every file is checked against its folder's schema, and every problem is
 * reported at once with its file, so one start shows them all. Nothing here
 * knows about other files; `content/index.ts` then checks the references
 * (a recipe's items exist, and so on).
 *
 * No file system here, so it runs on Node and in a Worker alike: the files
 * come in as modules, from `data.generated.ts` (static imports) or from
 * `data.disk.ts` (a scan, for tests).
 */

/** One file of `data/`: its path inside `data/` ("cards/combat/slash.ts") and what it exports. */
export type DataFile = {
    path: string;
    module?: { default?: unknown };
    /** Set instead of `module` when the file wouldn't import. */
    loadError?: string;
};

export class GameDataError extends Error {
    readonly problems: string[];

    constructor(problems: string[]) {
        super(`geo-game data has ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
        this.name = "GameDataError";
        this.problems = problems;
    }
}

/** offHand → off-hand: an armor slot as its folder name. */
const slotFolderName = (slot: string) => slot.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const isDataFile = (name: string) => name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts");

/** Folder by folder, as a directory listing sorts them, so content keeps one order everywhere. */
export function compareDataPaths(a: string, b: string): number {
    const left = a.split("/");
    const right = b.split("/");
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
        const order = (left[i] as string).localeCompare(right[i] as string);
        if (order !== 0) return order;
    }
    return left.length - right.length;
}

/** `actions.0.amount: Invalid input` — where in the file, and what's wrong. */
function describeIssues(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const where = issue.path.length > 0 ? issue.path.join(".") : "(file)";
        return `${where}: ${issue.message}`;
    });
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 2] ?? "";
};

export function readGameData(files: readonly DataFile[]): GameData {
    const problems: string[] = [];
    const sorted = [...files].sort((a, b) => compareDataPaths(a.path, b.path));

    function read<S extends z.ZodType>(file: DataFile, schema: S): z.output<S> | undefined {
        if (file.loadError !== undefined || !file.module) {
            problems.push(`${file.path}: doesn't load (${file.loadError ?? "no module"})`);
            return undefined;
        }
        if (file.module.default === undefined) {
            problems.push(`${file.path}: has no \`export default { … }\``);
            return undefined;
        }
        const parsed = schema.safeParse(file.module.default);
        if (!parsed.success) {
            for (const issue of describeIssues(parsed.error)) problems.push(`${file.path}: ${issue}`);
            return undefined;
        }
        return parsed.data;
    }

    const folders = {} as Record<DataFolder, unknown[]>;
    for (const folder of Object.keys(DATA_FOLDERS) as DataFolder[]) folders[folder] = [];
    const config = {} as Record<ConfigFile, unknown>;
    const unknownFolders = new Set<string>();

    for (const file of sorted) {
        const [top = "", ...rest] = file.path.split("/");
        if (top === "config") {
            const name = rest.join("/").replace(/\.ts$/, "");
            if (!(name in CONFIG_FILES)) {
                problems.push(`config/${rest.join("/")}: not a config file (known: ${Object.keys(CONFIG_FILES).join(", ")})`);
                continue;
            }
            config[name as ConfigFile] = read(file, CONFIG_FILES[name as ConfigFile]);
            continue;
        }
        if (!(top in DATA_FOLDERS)) {
            unknownFolders.add(top);
            continue;
        }
        const folder = top as DataFolder;
        if (rest.length === 0) {
            problems.push(`${folder}: should be a folder`);
            continue;
        }
        const entry = read(file, DATA_FOLDERS[folder]);
        if (!entry) continue;
        const expected = `${entry.id}.ts`;
        if (fileName(file.path) !== expected) {
            problems.push(`${file.path}: id "${entry.id}" doesn't match the file name (rename it ${expected})`);
            continue;
        }
        // Armor is sorted into a folder per slot: armor/head/, armor/off-hand/…
        if (folder === "armor" && "slot" in entry) {
            const slotFolder = slotFolderName(String(entry.slot));
            if (parentName(file.path) !== slotFolder) {
                problems.push(`${file.path}: a ${entry.slot} piece goes in armor/${slotFolder}/`);
                continue;
            }
        }
        // Layouts are sorted into a folder per dungeon: dungeon-layouts/slime-pits/…
        if (folder === "dungeon-layouts" && "dungeon" in entry && parentName(file.path) !== entry.dungeon) {
            problems.push(`${file.path}: a ${entry.dungeon} layout goes in dungeon-layouts/${entry.dungeon}/`);
            continue;
        }
        folders[folder].push(entry);
    }

    const known = [...Object.keys(DATA_FOLDERS), "config"].join(", ");
    for (const name of unknownFolders) problems.push(`${name}: not a data folder (known: ${known})`);
    for (const name of Object.keys(CONFIG_FILES) as ConfigFile[]) {
        if (!sorted.some((file) => file.path === `config/${name}.ts`)) problems.push(`config/${name}.ts: missing`);
    }

    if (problems.length > 0) throw new GameDataError(problems);
    return { ...folders, config } as GameData;
}
