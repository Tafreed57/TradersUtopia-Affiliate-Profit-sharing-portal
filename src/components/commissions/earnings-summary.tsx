"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";

export interface EarningsSummaryData {
  grossEarnedCad: number;
  paidCad: number;
  unpaidCad: number;
  currency: "USD" | "CAD";
  stale?: boolean;
  cachedAt?: string;
}

function ProgressBar({
  segments,
}: {
  segments: { ratio: number; color: string; label: string }[];
}) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {segments.map(
        (seg) =>
          seg.ratio > 0 && (
            <div
              key={seg.label}
              className={`${seg.color} transition-all`}
              style={{ width: `${(seg.ratio * 100).toFixed(1)}%` }}
              title={`${seg.label}: ${(seg.ratio * 100).toFixed(1)}%`}
            />
          )
      )}
    </div>
  );
}

function Row({
  color,
  label,
  amount,
  percent,
}: {
  color: string;
  label: string;
  amount: string;
  percent: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium">{amount}</span>
        <span className="w-12 text-right text-xs text-muted-foreground">
          {percent}
        </span>
      </div>
    </div>
  );
}

export function EarningsSummaryCard({
  data,
  isLoading = false,
}: {
  data?: EarningsSummaryData | null;
  isLoading?: boolean;
}) {
  const { format } = useCurrency();

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data || data.grossEarnedCad <= 0) return null;

  const paid = Math.max(0, data.paidCad ?? 0);
  const unpaid = Math.max(0, data.unpaidCad ?? 0);
  const gross = data.grossEarnedCad;
  const sourceCurrency = data.currency ?? "USD";

  const total = paid + unpaid;
  const paidR = total > 0 ? paid / total : 0;
  const unpaidR = total > 0 ? unpaid / total : 0;

  const fmtPct = (r: number) => `${(r * 100).toFixed(0)}%`;

  const segments = [
    { ratio: paidR, color: "bg-success", label: "Paid" },
    { ratio: unpaidR, color: "bg-warning", label: "Unpaid" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-4 w-4" />
            Earnings Summary
          </CardTitle>
          {data.stale && (
            <span className="text-xs text-muted-foreground">cached</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total Earned</span>
          <span className="text-2xl font-bold">{format(gross, sourceCurrency)}</span>
        </div>

        <ProgressBar segments={segments} />

        <div className="space-y-2">
          <Row
            color="bg-success"
            label="Paid Out"
            amount={format(paid, sourceCurrency)}
            percent={fmtPct(paidR)}
          />
          <Row
            color="bg-warning"
            label="Unpaid"
            amount={format(unpaid, sourceCurrency)}
            percent={fmtPct(unpaidR)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function EarningsSummary() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const { data, isLoading, isError } = useQuery<EarningsSummaryData>({
    queryKey: ["lifetime-stats", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch("/api/commissions/lifetime-stats");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isError) return null;

  return <EarningsSummaryCard data={data} isLoading={isLoading} />;
}
