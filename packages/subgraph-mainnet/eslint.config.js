// Only scripts/ is TypeScript. src/ and tests/ are AssemblyScript: they use types like i32
// and u64, `changetype<T>`, and a different standard library. Linting them with TypeScript
// rules reports errors that are not errors.
//
// AssemblyScript is type-checked by `graph build`, which compiles it to WebAssembly. That is
// a real check and it runs in `pnpm build` and `pnpm test`.
import globals from "globals"
import { defineConfig, globalIgnores } from "eslint/config"
import base from "../../eslint.config.base.js"

export default defineConfig([
  globalIgnores(["build/**", "generated/**", "node_modules/**", "src/**", "tests/**", "abis/**"]),
  ...base,
  {
    files: ["scripts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
])
