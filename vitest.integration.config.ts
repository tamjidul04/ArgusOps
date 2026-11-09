import { defineConfig } from "vitest/config";
import path from "path";

/** Integration tests hit the real database in DATABASE_URL and run one file at a time. */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
