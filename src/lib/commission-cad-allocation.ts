import Decimal from "decimal.js";

export type CommissionCadState = "paid" | "due" | "pending";

export interface CadAllocationEvent {
  id: string;
  currency: string;
  fullAmount: Decimal.Value;
  upstreamState?: string | null;
  upstreamPaidAt?: Date | string | null;
  upstreamVoidedAt?: Date | string | null;
  providerFullAmountCad?: Decimal.Value | null;
}

export interface CadStateTotals {
  paidCad: Decimal.Value;
  dueCad: Decimal.Value;
  pendingCad: Decimal.Value;
}

export interface CommissionCadAllocation {
  eventCad: Map<string, Decimal>;
  unavailableStates: Set<CommissionCadState>;
  fallbackEventIds: Set<string>;
}

const ZERO = new Decimal(0);
const MIN_PLAUSIBLE_CAD_RATIO = new Decimal("0.5");
const MAX_PLAUSIBLE_CAD_RATIO = new Decimal("1.5");

export function commissionCadState(
  event: CadAllocationEvent
): CommissionCadState | null {
  const state = event.upstreamState?.toLowerCase() ?? null;
  if (event.upstreamVoidedAt || state === "voided") return null;
  if (event.upstreamPaidAt || state === "paid") return "paid";
  if (state === "due") return "due";
  return "pending";
}

export function allocateCutCad(
  eventCad: Decimal.Value,
  cutPercent: Decimal.Value
): Decimal {
  return new Decimal(eventCad).mul(cutPercent).div(100);
}

function stateBase(
  totals: CadStateTotals,
  state: CommissionCadState
): Decimal {
  if (state === "paid") return new Decimal(totals.paidCad);
  if (state === "due") return new Decimal(totals.dueCad);
  return new Decimal(totals.pendingCad);
}

export function allocateCommissionCad(
  events: CadAllocationEvent[],
  totals: CadStateTotals,
  options?: { cadToUsdRate?: Decimal.Value | null }
): CommissionCadAllocation {
  const eventCad = new Map<string, Decimal>();
  const unavailableStates = new Set<CommissionCadState>();
  const fallbackEventIds = new Set<string>();
  const states: CommissionCadState[] = ["paid", "due", "pending"];

  for (const state of states) {
    const stateEvents = events.filter(
      (event) => commissionCadState(event) === state
    );
    if (stateEvents.length === 0) continue;

    const upstreamCad = Decimal.max(stateBase(totals, state), ZERO);
    const frozenEvents = stateEvents.filter(
      (event) => event.providerFullAmountCad !== undefined && event.providerFullAmountCad !== null
    );
    const unresolvedEvents = stateEvents.filter(
      (event) => event.providerFullAmountCad === undefined || event.providerFullAmountCad === null
    );

    for (const event of frozenEvents) {
      eventCad.set(event.id, new Decimal(event.providerFullAmountCad!));
    }

    if (unresolvedEvents.length === 0) {
      continue;
    }

    const cadEvents = unresolvedEvents.filter(
      (event) => event.currency.toUpperCase() === "CAD"
    );
    const usdEvents = unresolvedEvents.filter(
      (event) => event.currency.toUpperCase() === "USD"
    );
    const unsupported = unresolvedEvents.filter(
      (event) => !["CAD", "USD"].includes(event.currency.toUpperCase())
    );

    if (unsupported.length > 0) {
      unavailableStates.add(state);
      continue;
    }

    const nativeCad = Decimal.sum(
      ZERO,
      ...cadEvents.map((event) => new Decimal(event.fullAmount))
    );
    const nativeUsd = Decimal.sum(
      ZERO,
      ...usdEvents.map((event) => new Decimal(event.fullAmount))
    );
    const frozenCad = Decimal.sum(
      ZERO,
      ...frozenEvents.map((event) => new Decimal(event.providerFullAmountCad!))
    );
    const cadRemainder = upstreamCad.sub(frozenCad).sub(nativeCad);

    if (cadRemainder.isNegative() || (nativeUsd.isZero() && !cadRemainder.isZero())) {
      unavailableStates.add(state);
      continue;
    }

    for (const event of cadEvents) {
      eventCad.set(event.id, new Decimal(event.fullAmount));
    }

    if (!nativeUsd.isZero()) {
      const usdToCad = cadRemainder.div(nativeUsd);
      for (const event of usdEvents) {
        eventCad.set(event.id, new Decimal(event.fullAmount).mul(usdToCad));
      }
    }
  }

  const cadToUsdRate =
    options?.cadToUsdRate !== undefined && options.cadToUsdRate !== null
      ? new Decimal(options.cadToUsdRate)
      : null;
  if (cadToUsdRate?.gt(0)) {
    for (const event of events) {
      const fallbackCad = fallbackEventCad(event, cadToUsdRate);
      if (!fallbackCad) continue;

      const currentCad = eventCad.get(event.id);
      if (!currentCad || !isPlausibleCad(currentCad, fallbackCad)) {
        eventCad.set(event.id, fallbackCad);
        fallbackEventIds.add(event.id);
      }
    }

    for (const state of [...unavailableStates]) {
      const unresolved = events.some(
        (event) => commissionCadState(event) === state && !eventCad.has(event.id)
      );
      if (!unresolved) unavailableStates.delete(state);
    }
  }

  return { eventCad, unavailableStates, fallbackEventIds };
}

function fallbackEventCad(
  event: CadAllocationEvent,
  cadToUsdRate: Decimal
): Decimal | null {
  const currency = event.currency.toUpperCase();
  const fullAmount = new Decimal(event.fullAmount);
  if (fullAmount.lt(0)) return null;
  if (currency === "CAD") return fullAmount;
  if (currency === "USD") return fullAmount.div(cadToUsdRate);
  return null;
}

function isPlausibleCad(currentCad: Decimal, fallbackCad: Decimal): boolean {
  if (fallbackCad.isZero()) return currentCad.isZero();
  const ratio = currentCad.div(fallbackCad).abs();
  return (
    ratio.gte(MIN_PLAUSIBLE_CAD_RATIO) &&
    ratio.lte(MAX_PLAUSIBLE_CAD_RATIO)
  );
}

export function upstreamCadStateTotals(stats: {
  paidCents: number;
  unpaidCents: number;
  dueCents: number;
}): CadStateTotals {
  const paidCad = new Decimal(stats.paidCents).div(100);
  const unpaidCad = new Decimal(stats.unpaidCents).div(100);
  const dueCad = Decimal.min(
    Decimal.max(new Decimal(stats.dueCents).div(100), ZERO),
    unpaidCad
  );

  return {
    paidCad,
    dueCad,
    pendingCad: Decimal.max(unpaidCad.sub(dueCad), ZERO),
  };
}
