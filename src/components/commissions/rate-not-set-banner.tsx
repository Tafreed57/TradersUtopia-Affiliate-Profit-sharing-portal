"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

interface BackfillStatus {
  linked: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  commissionPercent: number;
}

export function RateNotSetBanner() {
  const { data } = useQuery<BackfillStatus>({
    queryKey: ["backfill-status"],
    queryFn: async () => {
      const res = await fetch("/api/me/backfill-status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  if (!data) return null;
  if (data.commissionPercent > 0) return null;
  // Defer to BackfillBanner while import is in flight — one banner at a time.
  if (data.status === "IN_PROGRESS") return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
      <div>
        <p className="font-medium">Your commission rate isn&rsquo;t set yet</p>
        <p className="text-xs text-muted-foreground">
          Conversions are being tracked and held as pending — they&rsquo;ll be
          calculated and paid out once an admin sets your rate. Contact your
          admin if this is unexpected.
        </p>
      </div>
    </div>
  );
}
