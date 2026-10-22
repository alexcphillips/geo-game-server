import { ENV } from "./env";
import { GEO_OPS_PATHS } from "../src/modules/ops/ops.paths";

/**
 * Dev scripts against the Worker: `npm run dev:worker` (http://localhost:8787,
 * the default) or `--url <base>` (the workers.dev address). They reach the
 * World's database through its operator routes, with GEO_OPS_SECRET from .env.
 */

export { GEO_OPS_PATHS };

/** `npm run dev:worker`. */
export const LOCAL_WORKER = "http://localhost:8787";

/** The base URL after `--url`, or the local Worker. */
export function workerUrl(args: string[] = process.argv.slice(2)): string {
    const i = args.findIndex((arg) => arg === "--url" || arg.startsWith("--url="));
    if (i < 0) return LOCAL_WORKER;
    const value = args[i]!.includes("=") ? args[i]!.slice("--url=".length) : args[i + 1];
    if (!value) throw new Error("--url needs a base URL, e.g. --url http://localhost:8787");
    return value.replace(/\/+$/, "");
}

/** Calls an operator route; throws on anything but a 2xx. */
export async function ops<T>(base: string, path: string, body: unknown): Promise<T> {
    if (!ENV.GEO_OPS_SECRET) throw new Error("Set GEO_OPS_SECRET in .env to the Worker's secret");
    const response = await fetch(base + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.GEO_OPS_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = (text ? JSON.parse(text) : undefined) as T & { error?: string };
    if (!response.ok) {
        const hint = response.status === 404 && parsed?.error === "Not found" ? " (wrong GEO_OPS_SECRET, or the route needs GEO_DEV_TOOLS on?)" : "";
        throw new Error(`${path}: ${response.status} ${parsed?.error ?? text}${hint}`);
    }
    return parsed;
}

/** One SQLite statement on the World (dev tools only): its rows. */
export async function workerSql<Row>(base: string, sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await ops<{ rows: Row[] }>(base, GEO_OPS_PATHS.sql, { sql, params })).rows;
}
