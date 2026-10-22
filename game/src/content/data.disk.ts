import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareDataPaths, GameDataError, isDataFile, readGameData, type DataFile } from "./data";
import type { GameData } from "./data.schema";

/**
 * `data/` read from disk, for Node only: the generator of
 * `data.generated.ts` and the tests that break a copy of `data/` on purpose.
 * The Worker reads the generated index.
 */

export const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/** Every data file's path inside `dir` ("cards/combat/slash.ts"), in content order. Guides and tests are skipped. */
export function listDataFiles(dir: string = DATA_DIR): string[] {
    if (!existsSync(dir)) throw new GameDataError([`no data folder at ${dir}`]);
    const found: string[] = [];
    const walk = (folder: string, prefix: string) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(join(folder, entry.name), path);
            else if (isDataFile(entry.name)) found.push(path);
            // A top-level file that isn't a guide is reported as an unknown folder.
            else if (!prefix && !entry.name.endsWith(".md")) found.push(path);
        }
    };
    walk(dir, "");
    return found.sort(compareDataPaths);
}

/** Imports every data file in `dir` and checks it. */
export async function loadGameData(dir: string = DATA_DIR): Promise<GameData> {
    const files = await Promise.all(
        listDataFiles(dir).map(async (path): Promise<DataFile> => {
            if (!isDataFile(path)) return { path, module: {} };
            try {
                return { path, module: (await import(pathToFileURL(join(dir, path)).href)) as DataFile["module"] };
            } catch (error) {
                return { path, loadError: (error as Error).message.split("\n")[0] };
            }
        }),
    );
    return readGameData(files);
}
