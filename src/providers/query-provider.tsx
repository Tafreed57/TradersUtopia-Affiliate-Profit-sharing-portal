"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s instead of 60s so background-arrived commissions surface
            // within ~30s of a natural re-render without requiring page
            // refresh. refetchOnWindowFocus covers the "user tabbed away
            // and came back" path so webhook → UI lag drops from ~60s to
            // ~0s on return. Per-query overrides can raise this where the
            // payload is expensive (e.g. lifetime-stats which has its own
            // 5-min server cache — use staleTime: 5 * 60 * 1000 there).
            staleTime: 30 * 1000,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
