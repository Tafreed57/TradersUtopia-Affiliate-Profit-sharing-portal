"use client";

import { Check, Clock, RotateCcw, Users, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  RestoreGapApprovalDialog,
  type RestoreGapPreview,
} from "@/components/admin/restore-gap-approval-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useCurrency } from "@/providers/currency-provider";

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

interface TeacherProposal {
  id: string;
  proposedCut: number;
  status: string;
  createdAt: string;
  teacher: { id: string; name: string | null; email: string; image: string | null };
  student: { id: string; name: string | null; email: string; image: string | null };
}

interface TeacherRestoreRequest {
  id: string;
  createdAt: string;
  requestNote: string | null;
  requestedBy: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  teacher: { id: string; name: string | null; email: string; image: string | null };
  student: { id: string; name: string | null; email: string; image: string | null };
  preview: RestoreGapPreview | null;
}

function getInitials(name: string | null, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0].toUpperCase();
}

export default function ProposalsPage() {
  const { format } = useCurrency();
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [teacherReviewNotes, setTeacherReviewNotes] = useState<Record<string, string>>({});
  const [restoreReviewNotes, setRestoreReviewNotes] = useState<Record<string, string>>(
    {}
  );
  const [selectedRestoreRequest, setSelectedRestoreRequest] =
    useState<TeacherRestoreRequest | null>(null);
  // Scope by adminId so account-switching in the same browser doesn't leak
  // cached data across admins. Prefix invalidations still match.
  const { data: session } = useSession();
  const adminId = session?.user?.id;

  const { data, isLoading } = useQuery<{ data: Proposal[] }>({
    queryKey: ["admin-proposals", adminId],
    enabled: !!adminId,
    queryFn: async () => {
      const res = await fetch("/api/admin/proposals");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: teacherProposalsData, isLoading: teacherProposalsLoading } =
    useQuery<{ data: TeacherProposal[] }>({
      queryKey: ["admin-teacher-proposals", adminId],
      enabled: !!adminId,
      queryFn: async () => {
        const res = await fetch("/api/admin/teacher-proposals");
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      },
    });

  const { data: restoreRequestsData, isLoading: restoreRequestsLoading } =
    useQuery<{ data: TeacherRestoreRequest[] }>({
      queryKey: ["admin-teacher-restore-requests", adminId],
      enabled: !!adminId,
      queryFn: async () => {
        const res = await fetch("/api/admin/teacher-restore-requests");
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

  const teacherProposalMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      reviewNote,
    }: {
      id: string;
      action: "approve" | "reject";
      reviewNote?: string;
    }) => {
      const res = await fetch(`/api/admin/teacher-proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to process");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teacher-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      toast.success(
        variables.action === "approve"
          ? "Student relationship approved — commissions will now flow"
          : "Proposal rejected"
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restoreRequestMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      reviewNote,
      backfillMode,
      selectedEventIds,
    }: {
      id: string;
      action: "approve" | "reject";
      reviewNote?: string;
      backfillMode?: "NONE" | "ALL" | "CUSTOM";
      selectedEventIds?: string[];
    }) => {
      const res = await fetch(`/api/admin/teacher-restore-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? {
                action,
                reviewNote,
                backfillMode,
                selectedEventIds,
              }
            : { action, reviewNote }
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to process restore request");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teacher-restore-requests"] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });

      if (variables.action === "approve") {
        setSelectedRestoreRequest(null);
        toast.success("Student return approved");
      } else {
        toast.success("Student return request rejected");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pendingProposals =
    data?.data.filter((p) => p.status === "PENDING") ?? [];
  const reviewedProposals =
    data?.data.filter((p) => p.status !== "PENDING") ?? [];

  const pendingTeacherProposals = teacherProposalsData?.data ?? [];
  const pendingRestoreRequests = restoreRequestsData?.data ?? [];

  return (
    <div className="space-y-8">
      <RestoreGapApprovalDialog
        open={!!selectedRestoreRequest}
        onOpenChange={(open) => {
          if (!open) setSelectedRestoreRequest(null);
        }}
        preview={selectedRestoreRequest?.preview ?? null}
        pending={restoreRequestMutation.isPending}
        title="Approve Student Return"
        description={
          selectedRestoreRequest
            ? `Choose how much archived-gap income to grant back before ${selectedRestoreRequest.student.name ?? selectedRestoreRequest.student.email} returns under ${selectedRestoreRequest.teacher.name ?? selectedRestoreRequest.teacher.email}.`
            : "Review the archived-gap earnings before restoring the student."
        }
        submitLabel="Approve Return"
        format={format}
        onSubmit={({ backfillMode, selectedEventIds, reviewNote }) => {
          if (!selectedRestoreRequest) return;
          restoreRequestMutation.mutate({
            id: selectedRestoreRequest.id,
            action: "approve",
            reviewNote,
            backfillMode,
            selectedEventIds,
          });
        }}
      />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Proposals</h1>
        <p className="text-muted-foreground">
          Review teacher-student relationships and rate change proposals
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <RotateCcw className="h-5 w-5 text-primary" />
            Student Return Requests ({pendingRestoreRequests.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {restoreRequestsLoading || !adminId ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-32 w-full" />
              ))}
            </div>
          ) : pendingRestoreRequests.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No pending student return requests
            </p>
          ) : (
            <div className="space-y-4">
              {pendingRestoreRequests.map((request) => {
                const preview = request.preview;

                return (
                  <div
                    key={request.id}
                    className="space-y-4 rounded-lg border border-border/50 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={request.teacher.image ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(request.teacher.name, request.teacher.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {request.teacher.name ?? request.teacher.email}
                          </p>
                          <p className="text-xs text-muted-foreground">Teacher</p>
                        </div>
                      </div>

                      <div className="text-sm text-muted-foreground lg:self-center">
                        wants to bring back
                      </div>

                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={request.student.image ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(request.student.name, request.student.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {request.student.name ?? request.student.email}
                          </p>
                          <p className="text-xs text-muted-foreground">Student</p>
                        </div>
                      </div>

                      <Badge
                        variant="default"
                        className="bg-primary/15 text-primary border-primary/30 shrink-0"
                      >
                        {preview
                          ? `${preview.gap.grantableCount} grantable item${
                              preview.gap.grantableCount === 1 ? "" : "s"
                            }`
                          : "Awaiting preview"}
                      </Badge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Removed</p>
                        <p className="mt-1 font-medium">
                          {preview ? new Date(preview.archivedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }) : "Loading..."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {preview?.archiveReason ?? "No removal note"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Snapshot at removal</p>
                        <p className="mt-1 font-medium">
                          {preview ? format(preview.snapshot.teacherUnpaidCad, "CAD") : "-"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Paid {preview ? format(preview.snapshot.teacherPaidCad, "CAD") : "-"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Missed while archived</p>
                        <p className="mt-1 font-medium">
                          {preview ? format(preview.gap.grantableCad, "CAD") : "-"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {preview?.gap.totalCount ?? 0} total archived-gap commission
                          {(preview?.gap.totalCount ?? 0) === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    {request.requestNote && (
                      <p className="text-sm text-muted-foreground">
                        Teacher note: {request.requestNote}
                      </p>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <Input
                        placeholder="Rejection note (optional)"
                        value={restoreReviewNotes[request.id] ?? ""}
                        onChange={(event) =>
                          setRestoreReviewNotes((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-error border-error/30 hover:bg-error/10"
                        onClick={() =>
                          restoreRequestMutation.mutate({
                            id: request.id,
                            action: "reject",
                            reviewNote: restoreReviewNotes[request.id],
                          })
                        }
                        disabled={restoreRequestMutation.isPending}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setSelectedRestoreRequest(request)}
                        disabled={restoreRequestMutation.isPending || !preview}
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Review Return
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teacher-Student Proposals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-info" />
            Student Relationship Requests ({pendingTeacherProposals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {teacherProposalsLoading || !adminId ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : pendingTeacherProposals.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No pending student proposals
            </p>
          ) : (
            <div className="space-y-4">
              {pendingTeacherProposals.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-border/50 p-4 space-y-3"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={p.teacher.image ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(p.teacher.name, p.teacher.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.teacher.name ?? p.teacher.email}
                        </p>
                        <p className="text-xs text-muted-foreground">Teacher</p>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground shrink-0 self-center">
                      wants to add
                    </div>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={p.student.image ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(p.student.name, p.student.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.student.name ?? p.student.email}
                        </p>
                        <p className="text-xs text-muted-foreground">Student</p>
                      </div>
                    </div>

                    <Badge
                      variant="default"
                      className="bg-info/15 text-info border-info/30 shrink-0"
                    >
                      {p.proposedCut}% cut
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Submitted{" "}
                    {new Date(p.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>

                  <div className="flex items-end gap-2">
                    <Input
                      placeholder="Note (optional)"
                      value={teacherReviewNotes[p.id] ?? ""}
                      onChange={(e) =>
                        setTeacherReviewNotes((prev) => ({
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
                        teacherProposalMutation.mutate({
                          id: p.id,
                          action: "reject",
                          reviewNote: teacherReviewNotes[p.id],
                        })
                      }
                      disabled={teacherProposalMutation.isPending}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        teacherProposalMutation.mutate({
                          id: p.id,
                          action: "approve",
                          reviewNote: teacherReviewNotes[p.id],
                        })
                      }
                      disabled={teacherProposalMutation.isPending}
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

      {/* Rate Change Proposals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-warning" />
            Rate Change Requests ({pendingProposals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !adminId ? (
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
            <CardTitle className="text-lg">Rate Change History</CardTitle>
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
