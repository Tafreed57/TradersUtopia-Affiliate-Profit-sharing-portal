"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface BackfillStatus {
  linked: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  commissionPercent: number;
  initialCommissionPercent: number;
  recurringCommissionPercent: number;
  canStartBackfill: boolean;
}

export function BackfillBanner() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const qc = useQueryClient();

  const { data } = useQuery<BackfillStatus>({
    queryKey: ["backfill-status", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch("/api/me/backfill-status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (!d.linked) return 15_000;
      if (d.status === "IN_PROGRESS") return 15_000;
      // Keep polling while we're waiting for admin to set rates so the
      // auto-kick can fire immediately when canStartBackfill flips true.
      if (d.status === "NOT_STARTED" && !d.canStartBackfill) return 15_000;
      return false;
    },
    refetchOnWindowFocus: true,
  });

  const kickoff = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/internal/backfill", { method: "POST" });
      if (!res.ok && res.status !== 202) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backfill-status"] });
    },
  });

  const kickedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    if (!data.linked) return;
    // Do not auto-kick backfill when rates haven't been set yet — the
    // import would just park every split as PENDING(rate_not_set) and the
    // RateNotSetBanner is already telling the affiliate to wait. When
    // rates are eventually set, the next poll will see canStartBackfill=true
    // with kickedRef still false (we never entered the kickoff branch), so
    // the effect fires exactly once without any reset gymnastics.
    if (!data.canStartBackfill) return;
    if (
      (data.status === "NOT_STARTED" || data.status === "FAILED") &&
      !kickedRef.current
    ) {
      kickedRef.current = true;
      kickoff.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (data?.status === "COMPLETED") {
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["lifetime-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    }
  }, [data?.status, qc]);

  if (!data || data.status !== "IN_PROGRESS") return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-info" />
      <div>
        <p className="font-medium">Importing your account history…</p>
        <p className="text-xs text-muted-foreground">
          This usually takes a minute. You can keep browsing — your commissions
          will appear here as they load.
        </p>
      </div>
    </div>
  );
}
