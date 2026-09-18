import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const accountingFiles = [
  "src/lib/affiliate-portal-data.ts",
  "src/lib/rewardful-student-stats.ts",
  "src/lib/teacher-student-relationships.ts",
  "src/app/api/dashboard/stats/route.ts",
  "src/app/api/admin/affiliates/[id]/route.ts",
];

test("commission accounting surfaces do not use the live CAD/USD rate", async () => {
  for (const path of accountingFiles) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(
      source,
      /getCadToUsdRate/,
      `${path} still derives commission accounting from today's FX rate`
    );
  }
});

test("relationship episode totals use provider-matched split allocations", async () => {
  const source = await readFile(
    new URL("src/lib/teacher-student-relationships.ts", root),
    "utf8"
  );
  assert.match(source, /getCommissionCadAllocation/);
  assert.match(source, /splitCadById:\s*allocation\.splitCadById/);
});

test("commission row APIs expose provider-matched CAD values beside native amounts", async () => {
  const source = await readFile(
    new URL("src/lib/affiliate-portal-data.ts", root),
    "utf8"
  );
  assert.match(source, /affiliateCutCad/);
  assert.match(source, /teacherCutCad/);
});

test("provider-matched CAD allocations freeze resolved event and split amounts", async () => {
  const source = await readFile(
    new URL("src/lib/commission-cad-service.ts", root),
    "utf8"
  );
  assert.match(source, /providerFullAmountCad/);
  assert.match(source, /providerCutCad/);
  assert.match(source, /persistProviderCadUpdates/);
});
