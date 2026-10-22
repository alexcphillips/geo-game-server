import app from "./app";
import { ENV } from "./config/env";
import { ensureGeoSchema } from "./db/geo.schema";
import { startGeoJobs } from "./jobs";
import { attachGeoSocket } from "./realtime/geo-socket";

/** Process entry point: bring the schema up to date, start the clock, then listen. */
async function start() {
    await ensureGeoSchema();
    startGeoJobs();

    const server = app.listen(ENV.PORT, () => {
        console.log(`geo-game server listening on port ${ENV.PORT} (${ENV.NODE_ENV})`);
    });
    attachGeoSocket(server);
}

start();
