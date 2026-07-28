import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before each test file — points the app at the test DB and truncates
    // tables between tests.
    setupFiles: ["./src/test/setup.ts"],
    // All tests share ONE test database and truncate between tests, so running
    // test FILES in parallel would let one file's truncate wipe another's data
    // mid-test. Run files serially to keep them isolated.
    fileParallelism: false,
  },
});
