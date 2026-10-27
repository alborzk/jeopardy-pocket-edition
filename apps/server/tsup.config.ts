import { defineConfig } from 'tsup';

// Everything is bundled into one file (the shared workspace package ships TypeScript source,
// and socket.io has no native parts), so the production image needs nothing but Node and dist/.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  noExternal: [/.*/],
  // Bundled CommonJS dependencies (socket.io, engine.io, ws) call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: true,
  clean: true,
});
