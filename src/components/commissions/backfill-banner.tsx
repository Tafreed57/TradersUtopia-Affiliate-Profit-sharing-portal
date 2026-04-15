"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

interface BackfillStatus {
  linked: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
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
    refetchInterval: (q) =>
      q.state.data?.status === "IN_PROGRESS" ? 15_000 : false,
    refetchOnWindowFocus: false,
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

  useEffect(() => {
    if (!data) return;
    if (!data.linked) return;
    if (data.status === "NOT_STARTED" || data.status === "FAILED") {
      kickoff.mutate();
    }
  }, [data, kickoff]);

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
