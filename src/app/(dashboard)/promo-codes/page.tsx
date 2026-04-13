"use client";

import {
  Check,
  Clock,
  Plus,
  Tag,
  X,
  AlertCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface PromoCodeRequest {
  id: string;
  proposedCode: string;
  status: string;
  rejectionReason: string | null;
  errorMessage: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: { id: string; name: string | null } | null;
}

interface PendingApproval {
  id: string;
  proposedCode: string;
  createdAt: string;
  requester: { id: string; name: string | null; email: string };
}

interface PromoCodesResponse {
  myRequests: PromoCodeRequest[];
  pendingApprovals: PendingApproval[];
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; className: string }
> = {
  PENDING_TEACHER: {
    label: "Pending Approval",
    icon: <Clock className="h-3 w-3" />,
    className: "bg-warning/15 text-warning border-warning/30",
  },
  APPROVED_TEACHER: {
    label: "Creating...",
    icon: <Clock className="h-3 w-3" />,
    className: "bg-info/15 text-info border-info/30",
  },
  CREATED: {
    label: "Active",
    icon: <Check className="h-3 w-3" />,
    className: "bg-success/15 text-success border-success/30",
  },
  REJECTED_TEACHER: {
    label: "Rejected",
    icon: <X className="h-3 w-3" />,
    className: "bg-error/15 text-error border-error/30",
  },
  FAILED: {
    label: "Failed",
    icon: <AlertCircle className="h-3 w-3" />,
    className: "bg-error/15 text-error border-error/30",
  },
};

export default function PromoCodesPage() {
  const queryClient = useQueryClient();
  const [newCode, setNewCode] = useState("");

  const { data, isLoading } = useQuery<PromoCodesResponse>({
    queryKey: ["promo-codes"],
    queryFn: async () => {
      const res = await fetch("/api/promo-codes");
      if (!res.ok) throw new Error("Failed to fetch promo codes");
      return res.json();
    },
  });

  const requestMutation = useMutation({
    mutationFn: async (proposedCode: string) => {
      const res = await fetch("/api/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedCode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to request code");
      }
      return res.json();
    },
    onSuccess: () => {
      setNewCode("");
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast.success("Promo code request submitted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "approve" | "reject";
      reason?: string;
    }) => {
      const res = await fetch(`/api/promo-codes/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to process");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast.success(
        variables.action === "approve"
          ? "Code approved and created"
          : "Code rejected"
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleRequest = useCallback(() => {
    if (newCode.length < 4 || newCode.length > 6) {
      toast.error("Code must be 4-6 letters");
      return;
    }
    if (!/^[A-Za-z]+$/.test(newCode)) {
      toast.error("Code must contain only letters");
      return;
    }
    requestMutation.mutate(newCode);
  }, [newCode, requestMutation]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Promo Codes</h1>
        <p className="text-muted-foreground">
          Request and manage your promotional codes
        </p>
      </div>

      {/* Request New Code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" />
            Request a Promo Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Promo Code (4-6 letters only)</Label>
            <div className="flex gap-2">
              <Input
                id="code"
                placeholder="e.g. TRADE"
                value={newCode}
                onChange={(e) =>
                  setNewCode(e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 6))
                }
                maxLength={6}
                className="uppercase max-w-xs"
              />
              <Button
                onClick={handleRequest}
                disabled={
                  requestMutation.isPending || newCode.length < 4
                }
              >
                {requestMutation.isPending ? "Submitting..." : "Request"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Your code will be sent to your teacher for approval. Once approved,
            it will be automatically created and ready to use.
          </p>
        </CardContent>
      </Card>

      {/* Pending Approvals (Teacher View) */}
      {data && data.pendingApprovals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Pending Approvals ({data.pendingApprovals.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.pendingApprovals.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-primary" />
                    <span className="font-mono font-bold text-lg">
                      {request.proposedCode}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested by {request.requester.name ?? request.requester.email}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-error border-error/30 hover:bg-error/10"
                    onClick={() =>
                      approveMutation.mutate({
                        id: request.id,
                        action: "reject",
                      })
                    }
                    disabled={approveMutation.isPending}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      approveMutation.mutate({
                        id: request.id,
                        action: "approve",
                      })
                    }
                    disabled={approveMutation.isPending}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* My Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My Codes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !data?.myRequests.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <Tag className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No promo codes yet</p>
              <p className="text-xs mt-1">Request one above to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.myRequests.map((request) => {
                const config = STATUS_CONFIG[request.status] ?? STATUS_CONFIG.FAILED;
                return (
                  <div
                    key={request.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-primary" />
                        <span className="font-mono font-bold text-lg">
                          {request.proposedCode}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Requested{" "}
                        {new Date(request.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </p>
                      {request.rejectionReason && (
                        <p className="text-xs text-error mt-0.5">
                          Reason: {request.rejectionReason}
                        </p>
                      )}
                      {request.errorMessage && (
                        <p className="text-xs text-error mt-0.5">
                          Error: {request.errorMessage}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="default"
                      className={`gap-1 ${config.className}`}
                    >
                      {config.icon}
                      {config.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
