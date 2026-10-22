import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/** One config for every workspace: Node globals for `server/`, Worker globals for `worker/`, none for `shared/` (which the app also uses). */
export default defineConfig([
    globalIgnores(["**/dist", "**/node_modules"]),

    {
        files: ["**/*.ts"],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: { ecmaVersion: 2022 },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },

    {
        files: ["server/**/*.ts"],
        languageOptions: { globals: globals.node },
    },

    {
        files: ["worker/**/*.ts"],
        languageOptions: { globals: globals.serviceworker },
    },
]);
