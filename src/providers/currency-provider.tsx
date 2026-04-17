"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";

type Currency = "CAD" | "USD";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  toggle: () => void;
  rate: number | null;
  stale: boolean;
  loading: boolean;
  /**
   * Convert an amount to the user's chosen display currency.
   * @param amount   - the numeric value
   * @param inputCurrency - currency the amount is in (default "USD" since DB stores USD)
   */
  convert: (amount: number, inputCurrency?: Currency) => number;
  /**
   * Format an amount for display in the user's chosen currency.
   * @param amount   - the numeric value
   * @param inputCurrency - currency the amount is in (default "USD" since DB stores USD)
   */
  format: (amount: number, inputCurrency?: Currency) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("CAD");

  // Fetches the CAD→USD rate from the server
  const { data, isLoading } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: async () => {
      const res = await fetch("/api/currency");
      if (!res.ok) return null;
      return res.json() as Promise<{
        rate: number;
        stale: boolean;
      }>;
    },
    staleTime: 5 * 60 * 1000, // Match server cache TTL
    refetchInterval: 5 * 60 * 1000,
  });

  const toggle = useCallback(() => {
    setCurrency((c) => (c === "CAD" ? "USD" : "CAD"));
  }, []);

  const convert = useCallback(
    (amount: number, inputCurrency: Currency = "USD") => {
      // Already in the display currency — no conversion needed
      if (inputCurrency === currency) return amount;

      const cadToUsd = data?.rate;
      if (!cadToUsd) return amount; // No rate available — return as-is

      if (inputCurrency === "USD" && currency === "CAD") {
        // USD → CAD: divide by CAD→USD rate (i.e. multiply by USD→CAD)
        return Math.round((amount / cadToUsd) * 100) / 100;
      }
      if (inputCurrency === "CAD" && currency === "USD") {
        // CAD → USD: multiply by CAD→USD rate
        return Math.round(amount * cadToUsd * 100) / 100;
      }
      return amount;
    },
    [currency, data?.rate]
  );

  const format = useCallback(
    (amount: number, inputCurrency: Currency = "USD") => {
      const converted = convert(amount, inputCurrency);
      const symbol = currency === "CAD" ? "CA$" : "US$";
      return `${symbol}${converted.toFixed(2)}`;
    },
    [convert, currency]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      toggle,
      rate: data?.rate ?? null,
      stale: data?.stale ?? false,
      loading: isLoading,
      convert,
      format,
    }),
    [currency, setCurrency, toggle, data, isLoading, convert, format]
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
