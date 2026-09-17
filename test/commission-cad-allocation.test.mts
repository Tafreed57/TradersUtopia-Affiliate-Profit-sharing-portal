import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allocateCommissionCad,
  allocateCutCad,
  commissionCadState,
  type CadAllocationEvent,
} from "../src/lib/commission-cad-allocation.ts";

test("Linda due base gives Mario the exact 20 percent CAD share", () => {
  const result = allocateCommissionCad(
    [{ id: "linda-due", currency: "USD", fullAmount: "6503.97", upstreamState: "due" }],
    { paidCad: "0", dueCad: "8886.40", pendingCad: "0" }
  );

  assert.equal(result.eventCad.get("linda-due")?.toFixed(2), "8886.40");
  assert.equal(allocateCutCad(result.eventCad.get("linda-due")!, "20").toFixed(2), "1777.28");
});

test("CAD-native events are preserved and only the remainder is apportioned to USD", () => {
  const result = allocateCommissionCad(
    [
      { id: "cad", currency: "CAD", fullAmount: "100", upstreamState: "pending" },
      { id: "usd-a", currency: "USD", fullAmount: "100", upstreamState: "pending" },
      { id: "usd-b", currency: "USD", fullAmount: "300", upstreamState: "pending" },
    ],
    { paidCad: "0", dueCad: "0", pendingCad: "900" }
  );

  assert.equal(result.eventCad.get("cad")?.toFixed(2), "100.00");
  assert.equal(result.eventCad.get("usd-a")?.toFixed(2), "200.00");
  assert.equal(result.eventCad.get("usd-b")?.toFixed(2), "600.00");
});

test("existing provider-matched CAD amounts stay frozen and only unresolved USD rows receive the remainder", () => {
  const result = allocateCommissionCad(
    [
      {
        id: "already-fixed",
        currency: "USD",
        fullAmount: "100",
        upstreamState: "pending",
        providerFullAmountCad: "125",
      },
      {
        id: "new-row",
        currency: "USD",
        fullAmount: "50",
        upstreamState: "pending",
      },
    ],
    { paidCad: "0", dueCad: "0", pendingCad: "200" }
  );

  assert.equal(result.eventCad.get("already-fixed")?.toFixed(2), "125.00");
  assert.equal(result.eventCad.get("new-row")?.toFixed(2), "75.00");
});

test("paid, due, and pending states allocate independently and voided events are excluded", () => {
  const events: CadAllocationEvent[] = [
    { id: "paid", currency: "USD", fullAmount: "50", upstreamState: "paid" },
    { id: "due", currency: "USD", fullAmount: "50", upstreamState: "due" },
    { id: "pending", currency: "USD", fullAmount: "50", upstreamState: "pending" },
    { id: "voided", currency: "USD", fullAmount: "50", upstreamState: "voided" },
  ];
  const result = allocateCommissionCad(events, {
    paidCad: "75",
    dueCad: "80",
    pendingCad: "90",
  });

  assert.equal(result.eventCad.get("paid")?.toFixed(2), "75.00");
  assert.equal(result.eventCad.get("due")?.toFixed(2), "80.00");
  assert.equal(result.eventCad.get("pending")?.toFixed(2), "90.00");
  assert.equal(result.eventCad.has("voided"), false);
  assert.equal(commissionCadState(events[3]), null);
});

test("cut allocation keeps exact decimals until the output boundary", () => {
  assert.equal(allocateCutCad("10.005", "33.33").toDecimalPlaces(6).toString(), "3.334667");
});

test("implausibly tiny USD CAD allocations fall back to the live exchange rate for any cut percentage", () => {
  const result = allocateCommissionCad(
    [
      {
        id: "stale-provider-row",
        currency: "USD",
        fullAmount: "74.99",
        upstreamState: "pending",
        providerFullAmountCad: "0.56",
      },
    ],
    { paidCad: "0", dueCad: "0", pendingCad: "0.56" },
    { cadToUsdRate: "0.7039" }
  );

  assert.equal(result.eventCad.get("stale-provider-row")?.toFixed(2), "106.54");
  assert.equal(result.fallbackEventIds.has("stale-provider-row"), true);
  assert.equal(
    allocateCutCad(result.eventCad.get("stale-provider-row")!, "20").toFixed(2),
    "21.31"
  );
  assert.equal(
    allocateCutCad(result.eventCad.get("stale-provider-row")!, "30").toFixed(2),
    "31.96"
  );
  assert.equal(
    allocateCutCad(result.eventCad.get("stale-provider-row")!, "40").toFixed(2),
    "42.61"
  );
  assert.equal(
    allocateCutCad(result.eventCad.get("stale-provider-row")!, "60").toFixed(2),
    "63.92"
  );
});
