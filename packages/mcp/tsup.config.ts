import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  // The workspace packages are bundled in from their TypeScript, through the "source" condition,
  // so the published package depends on nothing that is not on npm. The SDK, viem and zod stay
  // external and resolve from node_modules.
  noExternal: [/^@cobuilders\//],
  esbuildOptions(options) {
    options.conditions = ["source"]
    // The map keeps file and line references for stack traces, but not the TypeScript itself:
    // the private workspace sources it would carry stay out of the npm tarball.
    options.sourcesContent = false
  },
})
