import { defineConfig } from "vite";

export default defineConfig({
  root: "demo",
  publicDir: "public",
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
  },
  worker: {
    format: "es",
  },
});
