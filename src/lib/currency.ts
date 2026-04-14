/**
 * Currency exchange rate system.
 *
 * Fetches live CAD→USD rates, caches in database with 5-minute TTL.
 * Falls back to stale cache on API failure; returns null if no cache exists.
 */

import Decimal from "decimal.js";

import { CURRENCY_CACHE_TTL_MS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

const EXCHANGE_RATE_API_KEY = process.env.EXCHANGE_RATE_API_KEY ?? "";
const EXCHANGE_RATE_API_URL =
  process.env.EXCHANGE_RATE_API_URL ?? "https://v6.exchangerate-api.com/v6";

interface ExchangeRateResult {
  rate: Decimal;
  stale: boolean;
}

/**
 * Get the CAD → USD exchange rate.
 * Returns { rate, stale } or null if completely unavailable.
 */
export async function getCadToUsdRate(): Promise<ExchangeRateResult | null> {
  // Check cache first
  const cached = await prisma.exchangeRateCache.findUnique({
    where: {
      fromCurrency_toCurrency: {
        fromCurrency: "CAD",
        toCurrency: "USD",
      },
    },
  });

  const now = Date.now();
  if (cached) {
    const age = now - cached.fetchedAt.getTime();
    if (age < CURRENCY_CACHE_TTL_MS) {
      return { rate: new Decimal(cached.rate.toString()), stale: false };
    }
  }

  // Cache expired or missing — fetch fresh rate
  if (!EXCHANGE_RATE_API_KEY) {
    // No API key configured — return stale cache or hardcoded fallback
    if (cached) {
      return { rate: new Decimal(cached.rate.toString()), stale: true };
    }
    // Fallback rate (~0.74 CAD→USD) when no API key and no cache
    return { rate: new Decimal("0.74"), stale: true };
  }

  try {
    const res = await fetch(
      `${EXCHANGE_RATE_API_URL}/${EXCHANGE_RATE_API_KEY}/pair/CAD/USD`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) {
      throw new Error(`Exchange rate API returned ${res.status}`);
    }

    const data = (await res.json()) as {
      result: string;
      conversion_rate: number;
    };

    if (data.result !== "success" || typeof data.conversion_rate !== "number") {
      throw new Error("Invalid exchange rate response");
    }

    const rate = new Decimal(data.conversion_rate);

    // Upsert cache
    await prisma.exchangeRateCache.upsert({
      where: {
        fromCurrency_toCurrency: {
          fromCurrency: "CAD",
          toCurrency: "USD",
        },
      },
      update: {
        rate: rate.toNumber(),
        fetchedAt: new Date(),
      },
      create: {
        fromCurrency: "CAD",
        toCurrency: "USD",
        rate: rate.toNumber(),
        fetchedAt: new Date(),
      },
    });

    return { rate, stale: false };
  } catch (error) {
    console.error("Failed to fetch exchange rate:", error);
    // Fall back to stale cache
    if (cached) {
      return { rate: new Decimal(cached.rate.toString()), stale: true };
    }
    return null;
  }
}

/**
 * Convert a CAD amount to USD using the current rate.
 */
export async function convertCadToUsd(
  cadAmount: Decimal | number | string
): Promise<{ usd: Decimal; stale: boolean } | null> {
  const result = await getCadToUsdRate();
  if (!result) return null;

  const amount = new Decimal(cadAmount.toString());
  return {
    usd: amount.mul(result.rate).toDecimalPlaces(2),
    stale: result.stale,
  };
}
