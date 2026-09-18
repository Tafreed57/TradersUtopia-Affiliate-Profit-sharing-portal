"use client";

import { Eye, EyeOff, RefreshCw, Search, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

interface LeaderboardVisibilityRow {
  affiliateId: string;
  displayName: string;
  email: string | null;
  visible: boolean;
  updatedAt: string | null;
}

async function fetchVisibilityRows() {
  const res = await fetch("/api/admin/leaderboard-affiliates");
  const payload = (await res.json().catch(() => ({}))) as {
    data?: LeaderboardVisibilityRow[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error ?? "Failed to load leaderboard settings");
  }
  return payload.data ?? [];
}

export function LeaderboardVisibilityCard({
  adminId,
}: {
  adminId: string | undefined;
}) {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-leaderboard-affiliates", adminId],
    enabled: !!adminId,
    queryFn: fetchVisibilityRows,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async ({
      affiliateId,
      visible,
    }: {
      affiliateId: string;
      visible: boolean;
    }) => {
      const res = await fetch("/api/admin/leaderboard-affiliates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliateId, visible }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to update leaderboard settings");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-leaderboard-affiliates"],
      });
      queryClient.invalidateQueries({ queryKey: ["company-performance"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update leaderboard settings"
      ),
  });

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((row) => {
      return (
        row.displayName.toLowerCase().includes(needle) ||
        row.email?.toLowerCase().includes(needle) ||
        row.affiliateId.toLowerCase().includes(needle)
      );
    });
  }, [data, search]);

  const visibleCount = (data ?? []).filter((row) => row.visible).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-primary" />
              Leaderboard Visibility
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {visibleCount} shown of {(data ?? []).length}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="relative pt-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search affiliates..."
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !adminId ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No affiliates found
          </p>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {filteredRows.map((row) => (
              <div
                key={row.affiliateId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {row.displayName}
                    </p>
                    <Badge
                      variant="default"
                      className={
                        row.visible
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-muted/30 text-muted-foreground border-border/60"
                      }
                    >
                      {row.visible ? "Shown" : "Hidden"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.email ?? row.affiliateId}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.visible ? (
                    <Eye className="h-4 w-4 text-success" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Switch
                    checked={row.visible}
                    onCheckedChange={(visible) =>
                      mutation.mutate({ affiliateId: row.affiliateId, visible })
                    }
                    disabled={mutation.isPending}
                    aria-label={`Toggle ${row.displayName}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
