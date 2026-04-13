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
  convert: (cadAmount: number) => number;
  format: (cadAmount: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("CAD");

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
    (cadAmount: number) => {
      if (currency === "CAD" || !data?.rate) return cadAmount;
      return Math.round(cadAmount * data.rate * 100) / 100;
    },
    [currency, data?.rate]
  );

  const format = useCallback(
    (cadAmount: number) => {
      const amount = convert(cadAmount);
      const symbol = currency === "CAD" ? "CA$" : "US$";
      return `${symbol}${amount.toFixed(2)}`;
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
