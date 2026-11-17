import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // the VS Code extension imports `vscode`, which only exists inside the editor: tests use a stand-in
      vscode: path.resolve(__dirname, "packages/vscode/test/vscode-mock.ts"),
    },
  },
  test: {
    environment: "node",
    // many tests start real git and real processes; CI machines (Windows especially) are slower than a laptop
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts", "packages/vscode/out/**"],
  },
});
