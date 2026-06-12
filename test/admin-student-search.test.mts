import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeAdminStudentSearchResults,
  rewardfulAffiliateDisplayName,
} from "../src/lib/admin-student-search.ts";

test("formats upstream affiliate names from first and last name", () => {
  assert.equal(
    rewardfulAffiliateDisplayName({
      first_name: "Linda",
      last_name: "Perez",
      email: "linda@example.com",
    }),
    "Linda Perez"
  );
});

test("admin student search includes upstream-only affiliates without duplicating linked portal users", () => {
  const results = mergeAdminStudentSearchResults({
    query: "linda",
    portalUsers: [
      {
        id: "user_linked",
        name: "Linda Portal",
        email: "linda.portal@example.com",
        image: null,
        rewardfulAffiliateId: "aff_linked",
      },
    ],
    upstreamAffiliates: [
      {
        id: "aff_linked",
        email: "linda.portal@example.com",
        first_name: "Linda",
        last_name: "Portal",
      },
      {
        id: "aff_upstream_only",
        email: "linda.upstream@example.com",
        first_name: "Linda",
        last_name: "Upstream",
      },
    ],
    excludedUserIds: new Set(),
  });

  assert.deepEqual(
    results.map((row) => ({
      source: row.source,
      id: row.id,
      upstreamAffiliateId: row.upstreamAffiliateId,
      email: row.email,
    })),
    [
      {
        source: "portal",
        id: "user_linked",
        upstreamAffiliateId: "aff_linked",
        email: "linda.portal@example.com",
      },
      {
        source: "upstream",
        id: "upstream:aff_upstream_only",
        upstreamAffiliateId: "aff_upstream_only",
        email: "linda.upstream@example.com",
      },
    ]
  );
});
