import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** Tests run inside workerd, against the real Worker and World object (Miniflare, all local). */
export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { GEO_JWT_SECRET: "test-secret" } },
        }),
    ],
});
