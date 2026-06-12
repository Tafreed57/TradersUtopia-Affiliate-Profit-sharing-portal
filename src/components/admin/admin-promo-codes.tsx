"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminCoupon {
  id: string;
  code: string;
  campaignId: string | null;
  campaignName: string | null;
  archived: boolean;
  archivedAt: string | null;
  leads: number;
  conversions: number;
  createdAt: string;
}

/**
 * Admin panel card for managing an affiliate's promo codes. Lists every
 * coupon attached to them upstream (including any auto-created ones)
 * and lets the admin create new ones directly or delete existing ones.
 * Deletes cascade to the upstream coupon AND mark any matching local
 * PromoCodeRequest row as rejected for audit clarity.
 */
export function AdminPromoCodes({ affiliateId }: { affiliateId: string }) {
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState("");

  const { data, isLoading } = useQuery<{ coupons: AdminCoupon[] }>({
    queryKey: ["admin-affiliate-coupons", affiliateId],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/affiliates/${affiliateId}/promo-codes`
      );
      if (!res.ok) throw new Error("Failed to fetch promo codes");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/admin/affiliates/${affiliateId}/promo-codes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: newCode.trim() }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to create promo code");
      }
      return payload;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-affiliate-coupons", affiliateId] });
      setNewCode("");
      toast.success("Promo code created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (couponId: string) => {
      const res = await fetch(
        `/api/admin/affiliates/${affiliateId}/promo-codes/${couponId}`,
        { method: "DELETE" }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to delete promo code");
      }
      return payload;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-affiliate-coupons", affiliateId] });
      toast.success("Promo code removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = newCode.trim().length >= 4 && !createMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Tag className="h-5 w-5 text-primary" />
          Promo Codes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Admin create — bypasses the affiliate-request / teacher-approval flow. */}
        <div className="rounded-lg border border-border/50 p-3 space-y-3">
          <p className="text-sm font-medium">Create new code</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
            <div className="space-y-1">
              <Label className="text-xs">Code</Label>
              <Input
                placeholder="e.g. TRADE"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {createMutation.isPending ? "Creating…" : "Add"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Admin-created codes are active immediately — no teacher approval
            required. The affiliate sees them in their own portal as Active.
          </p>
        </div>

        {/* Active codes list. Shows every coupon currently attached
            upstream, including any auto-created on signup. */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data?.coupons.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No promo codes for this affiliate yet.
          </p>
        ) : (
          <div className="space-y-2">
            {data.coupons.map((coupon) => (
              <div
                key={coupon.id}
                className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold">{coupon.code}</span>
                    <Badge
                      variant="default"
                      className={
                        coupon.archived
                          ? "bg-muted text-muted-foreground border-border"
                          : "bg-success/15 text-success border-success/30"
                      }
                    >
                      {coupon.archived ? "Archived" : "Active"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {coupon.leads} leads · {coupon.conversions} conversions
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-error hover:text-error"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        `Delete promo code "${coupon.code}"? This removes it from the affiliate's account upstream too.`
                      )
                    ) {
                      deleteMutation.mutate(coupon.id);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
