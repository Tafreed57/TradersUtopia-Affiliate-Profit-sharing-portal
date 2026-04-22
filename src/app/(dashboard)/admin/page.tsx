"use client";

import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Clock,
  Info,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Affiliate {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  status: string;
  commissionPercent: number;
  initialCommissionPercent: number;
  recurringCommissionPercent: number;
  canProposeRates: boolean;
  rewardfulAffiliateId: string | null;
  linkError: string | null;
  backfillError: string | null;
  createdAt: string;
  commissionsCount: number;
  studentsCount: number;
  teachersCount: number;
}

interface AffiliatesResponse {
  data: Affiliate[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface Proposal {
  id: string;
  proposedPercent: number;
  currentPercent: number;
  status: string;
  createdAt: string;
  proposer: { id: string; name: string | null; email: string };
  student: { id: string; name: string | null; email: string };
}

interface TeacherProposal {
  id: string;
  proposedCut: number;
  status: string;
  createdAt: string;
  teacher: { id: string; name: string | null; email: string };
  student: { id: string; name: string | null; email: string };
}

interface TestNotificationResponse {
  ok: boolean;
  notificationId: string;
  deviceTokenCount: number;
  pushStatus:
    | "PENDING"
    | "SENT"
    | "FAILED"
    | "SKIPPED_NO_TOKEN"
    | "SKIPPED_NO_MESSAGING"
    | "SKIPPED_PREF";
  pushError: string | null;
  sentPush: boolean;
}

interface AdminDiagnosticsResponse {
  linkedAccounts: number;
  accountsWithLinkIssues: number;
  usersWithPushTokens: number;
  totalDeviceTokenRows: number;
  legacyDeviceTokenRows: number;
  usersWithMultipleTokens: number;
  currentAdminDeviceTokens: number;
}

export default function AdminPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  // Scope admin caches by adminId so account-switching in the same browser
  // doesn't leak cached data between admins. Mirrors the affiliate-side
  // pattern (session-25). Prefix-based invalidations still match because
  // invalidateQueries prefix-matches by default.
  const { data: session } = useSession();
  const adminId = session?.user?.id;

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  if (search) queryParams.set("search", search);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);

  const { data: affiliatesData, isLoading: affiliatesLoading } =
    useQuery<AffiliatesResponse>({
      queryKey: ["admin-affiliates", adminId, page, search, statusFilter],
      enabled: !!adminId,
      queryFn: async () => {
        const res = await fetch(`/api/admin/affiliates?${queryParams}`);
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      },
    });

  const { data: proposalsData } = useQuery<{ data: Proposal[] }>({
    queryKey: ["admin-proposals", adminId],
    enabled: !!adminId,
    queryFn: async () => {
      const res = await fetch("/api/admin/proposals");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: teacherProposalsData } = useQuery<{ data: TeacherProposal[] }>({
    queryKey: ["admin-teacher-proposals", adminId],
    enabled: !!adminId,
    queryFn: async () => {
      const res = await fetch("/api/admin/teacher-proposals");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: diagnosticsData } = useQuery<AdminDiagnosticsResponse>({
    queryKey: ["admin-diagnostics", adminId],
    enabled: !!adminId,
    queryFn: async () => {
      const res = await fetch("/api/admin/diagnostics");
      if (!res.ok) throw new Error("Failed to fetch diagnostics");
      return res.json();
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/teacher-proposals/backfill", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Backfill failed");
      return res.json() as Promise<{ relationships: number; processed: number; created: number }>;
    },
    onSuccess: (data) => {
      toast.success(
        `Backfill complete — ${data.created} Commission row${data.created !== 1 ? "s" : ""} created across ${data.relationships} relationship${data.relationships !== 1 ? "s" : ""}`
      );
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
    },
    onError: () => toast.error("Backfill failed — check logs"),
  });

  const syncPaidMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/commissions/sync-paid", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json() as Promise<{ fetched: number; updated: number }>;
    },
    onSuccess: (data) =>
      toast.success(`Sync complete — ${data.updated} row${data.updated !== 1 ? "s" : ""} marked paid (${data.fetched} fetched upstream)`),
    onError: () => toast.error("Sync failed — check logs"),
  });

  const retryLinkMutation = useMutation({
    mutationFn: async (affiliateId: string) => {
      const res = await fetch(
        `/api/admin/affiliates/${affiliateId}/retry-link`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Retry failed");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Affiliate re-linked");
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Retry failed"),
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/notifications/test", {
        method: "POST",
      });
      const data =
        (await res.json().catch(() => ({}))) as Partial<TestNotificationResponse> & {
          error?: string;
        };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send test notification");
      }
      return data as TestNotificationResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });

      if (data.pushStatus === "SENT") {
        toast.success(
          `Test notification sent. ${data.deviceTokenCount} device${data.deviceTokenCount !== 1 ? "s" : ""} registered for this account.`
        );
        return;
      }

      if (data.pushStatus === "SKIPPED_NO_TOKEN") {
        toast(
          "Test notification was created, but this account does not have any registered devices yet."
        );
        return;
      }

      if (data.pushStatus === "SKIPPED_NO_MESSAGING") {
        toast.error(
          "Test notification was created, but push delivery is disabled in the current server runtime."
        );
        return;
      }

      toast.error(
        data.pushError
          ? `Test notification failed: ${data.pushError}`
          : `Test notification ended with status ${data.pushStatus}.`
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to send test notification"
      ),
  });

  const pendingProposals =
    proposalsData?.data.filter((p) => p.status === "PENDING") ?? [];
  const pendingTeacherProposals = teacherProposalsData?.data ?? [];
  const totalPending = pendingProposals.length + pendingTeacherProposals.length;

  return (
    <TooltipProvider>
      <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          Admin Panel
        </h1>
        <p className="text-muted-foreground">
          Manage affiliates, review proposals, and monitor activity
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">
                {affiliatesData?.pagination.total ?? "—"}
              </p>
              <p className="text-sm text-muted-foreground">Total Affiliates</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Clock className="h-8 w-8 text-warning" />
            <div>
              <p className="text-2xl font-bold">{totalPending}</p>
              <p className="text-sm text-muted-foreground">
                Pending Proposals
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <CheckCircle className="h-8 w-8 text-success" />
            <div>
              <p className="text-2xl font-bold">
                {affiliatesData?.data.filter((a) => a.rewardfulAffiliateId)
                  .length ?? "—"}
              </p>
              <p className="text-sm text-muted-foreground">Linked Accounts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Rate Proposals Alert */}
      {pendingProposals.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-warning text-base">
              <AlertTriangle className="h-5 w-5" />
              {pendingProposals.length} Pending Rate Proposal
              {pendingProposals.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingProposals.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>
                  <strong>{p.proposer.name ?? p.proposer.email}</strong> wants
                  to change rate for{" "}
                  <strong>{p.student.name ?? p.student.email}</strong>:{" "}
                  {p.currentPercent}% → {p.proposedPercent}%
                </span>
                <Link href="/admin/proposals">
                  <Button variant="outline" size="sm">Review</Button>
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending Teacher-Student Proposals Alert */}
      {pendingTeacherProposals.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-warning text-base">
              <AlertTriangle className="h-5 w-5" />
              {pendingTeacherProposals.length} Pending Student Relationship Request
              {pendingTeacherProposals.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingTeacherProposals.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>
                  <strong>{p.teacher.name ?? p.teacher.email}</strong> wants to
                  add <strong>{p.student.name ?? p.student.email}</strong> as a
                  student at {p.proposedCut}% cut
                </span>
                <Link href="/admin/proposals">
                  <Button variant="outline" size="sm">Review</Button>
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Admin Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Diagnostics & Recovery</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
            <p className="text-sm font-medium">Normal operation is automatic</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Linking, history import, commission-state sync, and upstream commission-email suppression now run automatically. The controls below are for diagnostics, one-time historical repairs, or delivery testing.
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Push-Ready Users
                </p>
                <Tooltip>
                  <TooltipTrigger className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Users with at least one registered push endpoint.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {diagnosticsData?.usersWithPushTokens ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {diagnosticsData?.totalDeviceTokenRows ?? 0} total device token row
                {(diagnosticsData?.totalDeviceTokenRows ?? 0) === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Multi-Token Accounts
                </p>
                <Tooltip>
                  <TooltipTrigger className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Accounts with more than one live push token. A single test can fan out to all of them.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {diagnosticsData?.usersWithMultipleTokens ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Should trend toward zero as devices re-register
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Legacy Token Rows
                </p>
                <Tooltip>
                  <TooltipTrigger className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Older push registrations created before stable device identity. They are auto-retired on the next registration from that device.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {diagnosticsData?.legacyDeviceTokenRows ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Automatic cleanup target
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Link Issues
                </p>
                <Tooltip>
                  <TooltipTrigger className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Affiliates with a stored linking or historical repair error.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {diagnosticsData?.accountsWithLinkIssues ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {diagnosticsData?.linkedAccounts ?? 0} linked account
                {(diagnosticsData?.linkedAccounts ?? 0) === 1 ? "" : "s"} total
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Backfill Teacher Cuts</p>
              <p className="text-xs text-muted-foreground">
                Creates missing teacher Commission rows for all active relationships.
                Safe to run multiple times.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
              {backfillMutation.isPending ? "Running…" : "Run Backfill"}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-1">
            <div>
              <p className="text-sm font-medium">Sync Paid History</p>
              <p className="text-xs text-muted-foreground">
                Pulls all paid commissions from upstream and marks them PAID here. One-time baseline sync.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => syncPaidMutation.mutate()}
              disabled={syncPaidMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${syncPaidMutation.isPending ? "animate-spin" : ""}`} />
              {syncPaidMutation.isPending ? "Syncing…" : "Sync Paid"}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-1">
            <div>
              <p className="text-sm font-medium">Send Test Notification</p>
              <p className="text-xs text-muted-foreground">
                Sends a real notification to your own admin account so you can verify push delivery on this device.
              </p>
              {typeof diagnosticsData?.currentAdminDeviceTokens === "number" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This admin account currently has{" "}
                  <span className="font-medium text-foreground">
                    {diagnosticsData.currentAdminDeviceTokens}
                  </span>{" "}
                  registered push endpoint
                  {diagnosticsData.currentAdminDeviceTokens === 1 ? "" : "s"}.
                  {diagnosticsData.currentAdminDeviceTokens > 1
                    ? " A single test can fan out to each live endpoint until cleanup finishes."
                    : ""}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => testNotificationMutation.mutate()}
              disabled={testNotificationMutation.isPending}
            >
              <Bell className="h-4 w-4" />
              {testNotificationMutation.isPending ? "Sending..." : "Send Test"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Affiliates Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Affiliates</CardTitle>
          <div className="flex flex-wrap gap-3 pt-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val ?? "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {affiliatesLoading || !adminId ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !affiliatesData?.data.length ? (
            <p className="py-8 text-center text-muted-foreground">
              No affiliates found
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Affiliate</TableHead>
                    <TableHead>Rates (init / rec)</TableHead>
                    <TableHead>Commissions</TableHead>
                    <TableHead>Students</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {affiliatesData.data.map((affiliate) => (
                    <TableRow key={affiliate.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={affiliate.image ?? undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {(affiliate.name ?? affiliate.email)[0].toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {affiliate.name ?? affiliate.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {affiliate.email}
                            </p>
                            {(affiliate.linkError || affiliate.backfillError) && (
                              <div className="mt-0.5 flex items-start gap-2 max-w-[320px]">
                                <p
                                  className="line-clamp-1 text-xs text-error"
                                  title={affiliate.linkError ?? affiliate.backfillError ?? ""}
                                >
                                  {affiliate.linkError
                                    ? `Link error: ${affiliate.linkError}`
                                    : `Backfill error: ${affiliate.backfillError}`}
                                </p>
                                {affiliate.linkError && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() =>
                                      retryLinkMutation.mutate(affiliate.id)
                                    }
                                    disabled={
                                      retryLinkMutation.isPending &&
                                      retryLinkMutation.variables === affiliate.id
                                    }
                                  >
                                    {retryLinkMutation.isPending &&
                                    retryLinkMutation.variables === affiliate.id
                                      ? "Retrying…"
                                      : "Retry"}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>{affiliate.initialCommissionPercent}% init</div>
                        <div className="text-muted-foreground">
                          {affiliate.recurringCommissionPercent}% rec
                        </div>
                      </TableCell>
                      <TableCell>{affiliate.commissionsCount}</TableCell>
                      <TableCell>{affiliate.studentsCount}</TableCell>
                      <TableCell>
                        <Badge
                          variant="default"
                          className={
                            affiliate.status === "ACTIVE"
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-error/15 text-error border-error/30"
                          }
                        >
                          {affiliate.status === "ACTIVE"
                            ? "Active"
                            : "Deactivated"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/affiliates/${affiliate.id}`}>
                          <Button variant="ghost" size="sm">
                            Manage
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {affiliatesData.pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {affiliatesData.pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= affiliatesData.pagination.totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </TooltipProvider>
  );
}
