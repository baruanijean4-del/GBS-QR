// Config Vitest : mêmes alias que vite.config.ts, sans les plugins
// serveur/dev qui n'ont pas de sens en test.
import path from "path";
import { defineConfig } from "vitest/config";

const __dirname = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  test: {
    include: ["api/__tests__/**/*.test.ts", "src/__tests__/**/*.test.ts", "src/__tests__/**/*.test.tsx"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
