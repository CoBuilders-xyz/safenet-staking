import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  // packages/core ships TypeScript source, which node cannot run, so it is bundled in.
  // The published dependencies stay external and resolve from node_modules.
  noExternal: ["@cobuilders/safenet-core"],
})
