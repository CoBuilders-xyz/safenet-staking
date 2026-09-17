// Root config: the toolchain itself.
//
// tools/ holds the scripts that enforce this project's rules — the edit hook, the
// guard that refuses a green tick over a missing test suite, the spec gate, the
// report generators. They were the only code nobody linted, which is the wrong way
// round: the thing that checks should be checked.
//
// Note the explicit `extends` below. eslint.config.base.js scopes its rules to
// **/*.{ts,tsx}, so a block that only sets languageOptions for .mjs files gets
// listed by eslint and checked against nothing. The first version of this file did
// exactly that and reported a clean pass over an unlinted directory.
//
// The packages each own a config; this one covers what sits outside them.
import js from "@eslint/js"
import globals from "globals"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "apps/**", "packages/**"]),
  {
    files: ["tools/**/*.mjs", "scripts/**/*.mjs", "*.mjs", "*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
])
