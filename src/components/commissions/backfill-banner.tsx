"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface BackfillStatus {
  linked: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  commissionPercent: number;
}

export function BackfillBanner() {
  const qc = useQueryClient();

  const { data } = useQuery<BackfillStatus>({
    queryKey: ["backfill-status"],
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
