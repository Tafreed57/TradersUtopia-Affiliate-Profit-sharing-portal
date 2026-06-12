import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldBackfillHistoricalTeacherSplitForAffiliateStatus } from "../src/lib/historical-backfill-rules.ts";

test("unset-rate affiliate rows still qualify for unpaid teacher backfill", () => {
  assert.equal(
    shouldBackfillHistoricalTeacherSplitForAffiliateStatus("EARNED"),
    true
  );
  assert.equal(
    shouldBackfillHistoricalTeacherSplitForAffiliateStatus("PENDING"),
    true
  );
});

test("settled affiliate rows do not qualify for unpaid teacher backfill", () => {
  assert.equal(
    shouldBackfillHistoricalTeacherSplitForAffiliateStatus("PAID"),
    false
  );
  assert.equal(
    shouldBackfillHistoricalTeacherSplitForAffiliateStatus("VOIDED"),
    false
  );
  assert.equal(
    shouldBackfillHistoricalTeacherSplitForAffiliateStatus("FORFEITED"),
    false
  );
});
