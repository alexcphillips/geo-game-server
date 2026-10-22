import type { Env } from "./env";

export { World } from "./world";

/**
 * The Worker: hands every request to the one World object, which owns the
 * game's database and runs the API (src/app.ts). The Worker itself stays
 * thin, because a Worker gets 10 ms of CPU a request on the free plan and the
 * World object gets 30 s (password hashing alone takes more than 10 ms).
 */
export default {
    async fetch(request, env): Promise<Response> {
        const world = env.WORLD.get(env.WORLD.idFromName(env.WORLD_NAME));
        return world.fetch(request);
    },
} satisfies ExportedHandler<Env>;
