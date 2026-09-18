import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("registration E2E suites track and clean generated users", async () => {
  const files = await Promise.all(
    ["auth.spec.ts", "dashboard.spec.ts"].map((name) =>
      readFile(new URL(`../e2e/${name}`, import.meta.url), "utf8")
    )
  );

  for (const source of files) {
    assert.match(source, /trackTestUser/);
    assert.match(source, /cleanupTrackedTestUsers/);
    assert.match(source, /test\.afterEach/);
  }

  const fixture = await readFile(
    new URL("../e2e/test-user-cleanup.ts", import.meta.url),
    "utf8"
  );
  assert.match(fixture, /email:\s*\{\s*in:/);
  assert.match(fixture, /Dashboard Test User/);
  assert.match(fixture, /Login Test User/);
});
