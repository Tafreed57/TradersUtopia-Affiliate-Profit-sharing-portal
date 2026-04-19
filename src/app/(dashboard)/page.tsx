"use client";

import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarPlus,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BackfillBanner } from "@/components/commissions/backfill-banner";
import { RateNotSetBanner } from "@/components/commissions/rate-not-set-banner";
import { useCurrency } from "@/providers/currency-provider";

interface DashboardStats {
  totalEarned: number;
  totalEarnedCurrency: "CAD" | "USD";
  thisMonthEarned: number;
  commissionCount: number;
  attendanceDaysThisMonth: number;
  recentCommissions: {
    id: string;
    affiliateCutCad: string;
    status: "EARNED" | "FORFEITED" | "PENDING" | "PAID" | "VOIDED";
    forfeitedToCeo: boolean;
    conversionDate: string;
  }[];
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { format, currency } = useCurrency();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const userId = session?.user?.id;
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const date = now.toLocaleDateString("en-CA");
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, timezone, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: (result) => {
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      if (result.reevaluatedCommissions > 0) {
        toast.success(
          `Attendance submitted! ${result.reevaluatedCommissions} commission(s) restored.`
        );
      } else {
        toast.success("Attendance submitted");
      }
    },
    onError: () => toast.error("Failed to submit attendance"),
  });

  const handleQuickAttendance = useCallback(() => {
    attendanceMutation.mutate();
  }, [attendanceMutation]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back
          {session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground">
          Here&apos;s an overview of your affiliate activity
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Earned
            </CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {format(stats?.totalEarned ?? 0, stats?.totalEarnedCurrency ?? "USD")}
                </div>
                <p className="text-xs text-muted-foreground">{currency}</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This Month
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {format(stats?.thisMonthEarned ?? 0, "CAD")}
                </div>
                <p className="text-xs text-muted-foreground">{currency}</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Commissions
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {stats?.commissionCount ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  total commissions
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Attendance
            </CardTitle>
            <CalendarCheck className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {stats?.attendanceDaysThisMonth ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  days this month
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <BackfillBanner />
      <RateNotSetBanner />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Commissions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Commissions</CardTitle>
            <Link href="/commissions">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !stats?.recentCommissions.length ? (
              <p className="text-sm text-muted-foreground">
                No commissions yet. They&apos;ll appear here once conversions
                come in.
              </p>
            ) : (
              <div className="space-y-3">
                {stats.recentCommissions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {format(Number(c.affiliateCutCad))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatShortDate(c.conversionDate)}
                      </p>
                    </div>
                    <Badge
                      variant="default"
                      className={
                        c.status === "EARNED"
                          ? "bg-success/15 text-success border-success/30"
                          : c.status === "PAID"
                            ? "bg-info/15 text-info border-info/30"
                            : c.status === "VOIDED"
                              ? "bg-destructive/15 text-destructive border-destructive/30"
                              : c.status === "FORFEITED"
                                ? "bg-error/15 text-error border-error/30"
                                : "bg-warning/15 text-warning border-warning/30"
                      }
                    >
                      {c.status === "EARNED"
                        ? "Earned"
                        : c.status === "PAID"
                          ? "Paid"
                          : c.status === "VOIDED"
                            ? "Voided"
                            : c.status === "FORFEITED"
                              ? "Forfeited"
                              : "Pending"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Attendance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarPlus className="h-5 w-5 text-primary" />
              Quick Attendance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Submit your attendance to stay eligible for commissions.
            </p>
            <Input
              placeholder="Activity note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleQuickAttendance}
                disabled={attendanceMutation.isPending}
                className="flex-1"
              >
                {attendanceMutation.isPending
                  ? "Submitting..."
                  : "Submit Today"}
              </Button>
              <Link href="/attendance">
                <Button variant="outline">View Calendar</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
