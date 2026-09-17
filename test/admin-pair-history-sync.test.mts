import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("admin teacher-student pairing queues history sync outside the request", async () => {
  const source = await readFile(
    new URL("src/app/api/admin/teacher-student/route.ts", root),
    "utf8"
  );

  assert.match(source, /import\s+\{\s*after,\s*NextRequest,\s*NextResponse\s*\}/);
  assert.match(source, /historicalBackfill:\s*"NONE"/);
  assert.match(source, /after\(async\s*\(\)\s*=>/);
  const beforeBackgroundJob = source.slice(0, source.indexOf("after(async"));
  assert.doesNotMatch(
    beforeBackgroundJob,
    /await\s+syncAffiliateCommissionCatalog\(/,
    "admin pairing must not block the Save action on a full commission-history sync"
  );
});

test("batch commission imports skip per-row value notifications by default", async () => {
  const syncSource = await readFile(
    new URL("src/lib/affiliate-sync-service.ts", root),
    "utf8"
  );
  const backfillSource = await readFile(
    new URL("src/lib/backfill-service.ts", root),
    "utf8"
  );
  const webhookSource = await readFile(
    new URL("src/app/api/webhooks/rewardful/route.ts", root),
    "utf8"
  );

  assert.match(
    syncSource,
    /notifyOnImportedCommissions\s*=\s*options\?\.notifyOnImportedCommissions\s*\?\?\s*false/
  );
  assert.match(syncSource, /notify:\s*notifyOnImportedCommissions/);
  assert.match(backfillSource, /processConversion\(conversion,\s*\{\s*notify:\s*false\s*\}\)/);
  assert.doesNotMatch(
    webhookSource,
    /notify:\s*false/,
    "live webhook conversions should keep normal notification behavior"
  );
});
