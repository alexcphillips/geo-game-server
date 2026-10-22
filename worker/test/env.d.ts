import type { Env as WorkerEnv } from "../src/env";

/** `env` in tests is the Worker's own Env. */
declare global {
    namespace Cloudflare {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merging into the global Env is the point
        interface Env extends WorkerEnv {}
    }
}
