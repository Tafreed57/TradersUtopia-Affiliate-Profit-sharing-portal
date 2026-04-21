"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { DollarSign, MousePointerClick, Target, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";

export interface LifetimeHeaderData {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  grossEarnedCad: number;
  currency: "USD" | "CAD";
  nextDueAt: string | null;
  campaign: {
    id: string;
    name: string;
    rewardType: "percent" | "amount";
    commissionPercent: number | null;
    commissionAmountCents: number | null;
    commissionAmountCurrency: string | null;
    daysUntilCommissionsAreDue: number | null;
    minimumPayoutCents: number | null;
    minimumPayoutCurrency: string | null;
  } | null;
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

export function LifetimeHeaderCards({
  data,
  isLoading = false,
}: {
  data?: LifetimeHeaderData | null;
  isLoading?: boolean;
}) {
  const { format } = useCurrency();

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const cachedLabel = data.cachedAt
    ? `updated ${new Date(data.cachedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}${data.stale ? " · cached" : ""}`
    : undefined;
  const campaignLabel = data.campaign
    ? [
        data.campaign.name,
        data.campaign.daysUntilCommissionsAreDue != null
          ? `${data.campaign.daysUntilCommissionsAreDue}-day hold`
          : null,
        data.campaign.minimumPayoutCents != null &&
        data.campaign.minimumPayoutCurrency
          ? `min payout ${format(
              data.campaign.minimumPayoutCents / 100,
              data.campaign.minimumPayoutCurrency as "CAD" | "USD"
            )}`
          : null,
        data.nextDueAt
          ? `next release ${new Date(data.nextDueAt).toLocaleDateString(
              "en-US",
              {
                month: "short",
                day: "numeric",
                year: "numeric",
              }
            )}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

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
          label="Total earned"
          value={format(data.grossEarnedCad, data.currency ?? "USD")}
        />
      </div>
      {cachedLabel && (
        <p className="text-xs text-muted-foreground">{cachedLabel}</p>
      )}
      {campaignLabel && (
        <p className="text-xs text-muted-foreground">{campaignLabel}</p>
      )}
    </section>
  );
}

export function LifetimeHeader() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { data, isLoading, isError } = useQuery<LifetimeHeaderData>({
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

  return <LifetimeHeaderCards data={data} isLoading={isLoading} />;
}
