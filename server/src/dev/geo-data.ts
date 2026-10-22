/**
 * `npm run geo:data`: loads and checks every file in `data/`, as the server
 * does on start, without needing the database. `npm run typecheck` checks
 * them against their models too.
 */
try {
    const { CONTENT } = await import("../content");
    const counts = Object.entries(CONTENT).map(([kind, entries]) => `${Object.keys(entries).length} ${kind}`);
    console.log(`Data OK: ${counts.join(", ")}.`);
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
