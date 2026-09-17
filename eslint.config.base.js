// Shared lint base. D-024: we start on the reference's ESLint config
// (safe-fndn/safenet-staking-ui, eslint.config.js) and migrate to Biome after M1,
// so that merging their tree does not also mean re-litigating lint.
//
// Packages extend this. Nothing here assumes a browser or React; apps/web adds both.
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["dist", "build", "coverage", ".turbo", "node_modules"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2020 },
    rules: {
      // Unused arguments prefixed with _ are deliberate, everything else is a smell.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
])
