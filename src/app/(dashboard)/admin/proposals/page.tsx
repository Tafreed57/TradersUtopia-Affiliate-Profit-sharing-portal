"use client";

import { Check, Clock, X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Proposal {
  id: string;
  proposedPercent: number;
  currentPercent: number;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  proposer: { id: string; name: string | null; email: string };
  student: { id: string; name: string | null; email: string };
  reviewedBy: { name: string | null; email: string } | null;
}

export default function ProposalsPage() {
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ data: Proposal[] }>({
    queryKey: ["admin-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/admin/proposals");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      proposalId,
      action,
      reviewNote,
    }: {
      proposalId: string;
      action: "approve" | "reject";
      reviewNote?: string;
    }) => {
      const res = await fetch("/api/admin/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, action, reviewNote }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to process");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-proposals"] });
      toast.success(
        variables.action === "approve"
          ? "Proposal approved — rate updated"
          : "Proposal rejected"
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pendingProposals =
    data?.data.filter((p) => p.status === "PENDING") ?? [];
  const reviewedProposals =
    data?.data.filter((p) => p.status !== "PENDING") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rate Proposals</h1>
        <p className="text-muted-foreground">
          Review rate change proposals from teachers
        </p>
      </div>

      {/* Pending */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-warning" />
            Pending ({pendingProposals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : pendingProposals.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No pending proposals
            </p>
          ) : (
            <div className="space-y-4">
              {pendingProposals.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-border/50 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">
                        {p.proposer.name ?? p.proposer.email}{" "}
                        <span className="text-muted-foreground font-normal">
                          wants to change rate for
                        </span>{" "}
                        {p.student.name ?? p.student.email}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {p.currentPercent}% → {p.proposedPercent}%
                        <span className="ml-2">
                          ({p.proposedPercent > p.currentPercent ? "+" : ""}
                          {(p.proposedPercent - p.currentPercent).toFixed(1)}%)
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Submitted{" "}
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <Input
                      placeholder="Note (optional)"
                      value={reviewNotes[p.id] ?? ""}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-error border-error/30 hover:bg-error/10"
                      onClick={() =>
                        reviewMutation.mutate({
                          proposalId: p.id,
                          action: "reject",
                          reviewNote: reviewNotes[p.id],
                        })
                      }
                      disabled={reviewMutation.isPending}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        reviewMutation.mutate({
                          proposalId: p.id,
                          action: "approve",
                          reviewNote: reviewNotes[p.id],
                        })
                      }
                      disabled={reviewMutation.isPending}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {reviewedProposals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewedProposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.proposer.name ?? p.proposer.email}
                    </TableCell>
                    <TableCell>
                      {p.student.name ?? p.student.email}
                    </TableCell>
                    <TableCell>
                      {p.currentPercent}% → {p.proposedPercent}%
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="default"
                        className={
                          p.status === "APPROVED"
                            ? "bg-success/15 text-success border-success/30"
                            : "bg-error/15 text-error border-error/30"
                        }
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.reviewedAt
                        ? new Date(p.reviewedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
