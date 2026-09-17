import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adminAffiliateRoute = new URL(
  "../src/app/api/admin/affiliates/[id]/route.ts",
  import.meta.url
);

test("direct admin rate changes never notify the affiliate", async () => {
  const source = await readFile(adminAffiliateRoute, "utf8");

  assert.doesNotMatch(source, /COMMISSION_RATE_CHANGED/);
});
