import { defineConfig } from "vitest/config";

// Minimal config for a Node-only backend.
//   - environment: "node"  — this is an API, not a browser app; no jsdom
//   - passWithNoTests      — let `npm test` exit 0 cleanly during the
//                            pre-test-files bootstrap window
//   - setupFiles           — runs before every test file; loads .env if
//                            present and seeds a test default for
//                            SUPABASE_JWT_SECRET so verifier tests
//                            don't need a real secret
//   - include              — both the dedicated test/ tree and any
//                            co-located *.test.js in src/ (for future
//                            unit tests on individual modules)
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.js", "src/**/*.test.js"],
  },
});
