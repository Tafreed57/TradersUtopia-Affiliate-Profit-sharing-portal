"use client";

import {
  AlertCircle,
  Check,
  Clock,
  RefreshCw,
  Tag,
  X,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface CommissionPlan {
  id: string;
  name: string;
  isDefault: boolean;
  rewardType: "percent" | "amount";
  commissionPercent: number | null;
  commissionAmountCents: number | null;
  commissionAmountCurrency: string | null;
}

interface AdminPromoCode {
  id: string;
  proposedCode: string;
  status: string;
  campaignId: string | null;
  campaignName: string | null;
  rewardfulCouponId: string | null;
  rejectionReason: string | null;
  errorMessage: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requester: { id: string; name: string | null; email: string };
  reviewer: { id: string; name: string | null } | null;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  PENDING_TEACHER: { label: "Pending Teacher", icon: <Clock className="h-3 w-3" />, className: "bg-warning/15 text-warning border-warning/30" },
  APPROVED_TEACHER: { label: "Creating...", icon: <Clock className="h-3 w-3" />, className: "bg-info/15 text-info border-info/30" },
  CREATED: { label: "Active", icon: <Check className="h-3 w-3" />, className: "bg-success/15 text-success border-success/30" },
  REJECTED_TEACHER: { label: "Rejected", icon: <X className="h-3 w-3" />, className: "bg-error/15 text-error border-error/30" },
  FAILED: { label: "Failed", icon: <AlertCircle className="h-3 w-3" />, className: "bg-error/15 text-error border-error/30" },
};

function planLabel(plan: CommissionPlan): string {
  if (plan.rewardType === "percent") return `${plan.name} (${plan.commissionPercent}%)`;
  const cents = plan.commissionAmountCents ?? 0;
  const currency = plan.commissionAmountCurrency ?? "USD";
  return `${plan.name} ($${(cents / 100).toFixed(0)} ${currency})`;
}

export default function AdminPromoCodesPage() {
  const queryClient = useQueryClient();
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});

  const { data: plansData, isLoading: plansLoading } = useQuery<{ data: CommissionPlan[] }>({
    queryKey: ["admin", "campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/campaigns");
      if (!res.ok) throw new Error("Failed to fetch commission plans");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ data: AdminPromoCode[] }>({
    queryKey: ["admin", "promo-codes"],
    queryFn: async () => {
      const res = await fetch("/api/admin/promo-codes");
      if (!res.ok) throw new Error("Failed to fetch promo codes");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, action, campaignId }: { id: string; action: "approve" | "reject"; campaignId?: string }) => {
      const res = await fetch(`/api/promo-codes/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaign_id: campaignId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to process");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "promo-codes"] });
      toast.success(variables.action === "approve" ? "Code approved and created" : "Code rejected");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const plans = plansData?.data ?? [];
  const defaultPlanId = plans.find((p) => p.isDefault)?.id ?? plans[0]?.id ?? "";

  const getSelectedPlan = (codeId: string) => selectedPlans[codeId] ?? defaultPlanId;

  const pendingCodes = data?.data.filter((c) => c.status === "PENDING_TEACHER") ?? [];
  const allCodes = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Promo Code Management</h1>
        <p className="text-muted-foreground">Review requests and assign commission plans</p>
      </div>

      {/* Pending approvals */}
      {pendingCodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Approval ({pendingCodes.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingCodes.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 rounded-lg border border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-primary" />
                    <span className="font-mono font-bold text-lg">{request.proposedCode}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {request.requester.name ?? request.requester.email} · {new Date(request.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {plansLoading ? (
                    <Skeleton className="h-9 w-52" />
                  ) : (
                    <Select
                      value={getSelectedPlan(request.id)}
                      onValueChange={(v) => setSelectedPlans((prev) => ({ ...prev, [request.id]: v }) as Record<string, string>)}
                    >
                      <SelectTrigger className="w-52 text-xs">
                        <SelectValue placeholder="Select commission plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {planLabel(plan)}{plan.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-error border-error/30 hover:bg-error/10"
                      onClick={() => approveMutation.mutate({ id: request.id, action: "reject" })}
                      disabled={approveMutation.isPending}
                    >
                      <X className="mr-1 h-3 w-3" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: request.id, action: "approve", campaignId: getSelectedPlan(request.id) })}
                      disabled={approveMutation.isPending || !getSelectedPlan(request.id)}
                    >
                      <Check className="mr-1 h-3 w-3" /> Approve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All codes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Codes ({allCodes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !allCodes.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <Tag className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No promo codes yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Code</th>
                    <th className="pb-2 pr-4 font-medium">Affiliate</th>
                    <th className="pb-2 pr-4 font-medium">Commission Plan</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {allCodes.map((code) => {
                    const config = STATUS_CONFIG[code.status] ?? STATUS_CONFIG.FAILED;
                    return (
                      <tr key={code.id}>
                        <td className="py-3 pr-4 font-mono font-bold">{code.proposedCode}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{code.requester.name ?? code.requester.email}</td>
                        <td className="py-3 pr-4">
                          {code.campaignName ? (
                            <span className="text-foreground">{code.campaignName}</span>
                          ) : (
                            <span className="text-muted-foreground/50 italic">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant="default" className={`gap-1 text-xs ${config.className}`}>
                            {config.icon}{config.label}
                          </Badge>
                          {code.errorMessage && (
                            <p className="text-xs text-error mt-0.5">{code.errorMessage}</p>
                          )}
                        </td>
                        <td className="py-3 text-muted-foreground text-xs">
                          {new Date(code.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failed retry section */}
      {data?.data.some((c) => c.status === "FAILED") && (
        <Card className="border-error/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-error">
              <AlertCircle className="h-5 w-5" /> Failed Codes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.data.filter((c) => c.status === "FAILED").map((code) => (
              <div key={code.id} className="flex flex-col gap-2 rounded-lg border border-error/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-error" />
                    <span className="font-mono font-bold">{code.proposedCode}</span>
                    <span className="text-xs text-muted-foreground">for {code.requester.name ?? code.requester.email}</span>
                  </div>
                  {code.errorMessage && <p className="text-xs text-error mt-1">{code.errorMessage}</p>}
                </div>
                <div className="flex gap-2 items-center">
                  {!plansLoading && (
                    <Select
                      value={getSelectedPlan(code.id)}
                      onValueChange={(v) => setSelectedPlans((prev) => ({ ...prev, [code.id]: v }) as Record<string, string>)}
                    >
                      <SelectTrigger className="w-44 text-xs">
                        <SelectValue placeholder="Commission plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {planLabel(plan)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveMutation.mutate({ id: code.id, action: "approve", campaignId: getSelectedPlan(code.id) })}
                    disabled={approveMutation.isPending}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" /> Retry
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
