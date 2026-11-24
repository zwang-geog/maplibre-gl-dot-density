import { defineConfig } from "vite";

/** Library build for npm (`dist/`). Demo still uses `vite.config.ts`. */
export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ["maplibre-gl", "mapbox-gl"],
    },
  },
  worker: {
    format: "es",
  },
});
