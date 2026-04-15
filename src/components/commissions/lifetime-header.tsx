"use client";

import { useQuery } from "@tanstack/react-query";
import { DollarSign, MousePointerClick, Target, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";

interface LifetimeStats {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  grossEarnedCad: number;
  cachedAt?: string;
  stale?: boolean;
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-4">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold">{value}</p>
          {sub && (
            <p className="truncate text-xs text-muted-foreground">{sub}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function LifetimeHeader() {
  const { format } = useCurrency();
  const { data, isLoading, isError } = useQuery<LifetimeStats>({
    queryKey: ["lifetime-stats"],
    queryFn: async () => {
      const res = await fetch("/api/commissions/lifetime-stats");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !data) return null;

  const cachedLabel = data.cachedAt
    ? `updated ${new Date(data.cachedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}${data.stale ? " · cached" : ""}`
    : undefined;

  return (
    <section className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Lifetime visitors"
          value={data.visitors.toLocaleString()}
        />
        <StatCard
          icon={<MousePointerClick className="h-4 w-4" />}
          label="Leads"
          value={data.leads.toLocaleString()}
          sub={`${data.conversionRate.toFixed(1)}% convert to sale`}
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Conversions"
          value={data.conversions.toLocaleString()}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Gross earned to you"
          value={format(data.grossEarnedCad)}
        />
      </div>
      {cachedLabel && (
        <p className="text-xs text-muted-foreground">{cachedLabel}</p>
      )}
    </section>
  );
}
