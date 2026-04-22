"use client";

import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Clock,
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
      queryClient.invalidateQueries({ queryKey: ["admin-diagnostics"] });

      if (data.pushStatus === "SENT") {
        return;
      }

      if (data.pushStatus === "SKIPPED_NO_TOKEN") {
        toast(
          "No phone or browser is currently saved for alerts on this account."
        );
        return;
      }

      if (data.pushStatus === "SKIPPED_NO_MESSAGING") {
        toast.error(
          "The test alert was created, but push delivery is disabled on the server right now."
        );
        return;
      }

      toast.error(
        data.pushError
          ? `Test alert failed: ${data.pushError}`
          : `Test alert ended with status ${data.pushStatus}.`
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
  const repeatedAlertAccounts = diagnosticsData?.usersWithMultipleTokens ?? 0;
  const accountsReadyForAlerts = diagnosticsData?.usersWithPushTokens ?? 0;
  const linkedAccounts = diagnosticsData?.linkedAccounts ?? 0;
  const linkIssues = diagnosticsData?.accountsWithLinkIssues ?? 0;
  const currentAdminDeviceTokens = diagnosticsData?.currentAdminDeviceTokens ?? 0;

  return (
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
          <CardTitle className="text-base">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
            <p className="text-sm font-medium">
              Most of this runs by itself
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Linking accounts, updating paid amounts, and keeping outside
              commission emails turned off now happen automatically. You
              normally do not need to use the buttons below unless you are
              fixing older data or testing alerts.
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                App Alerts
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {accountsReadyForAlerts}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {accountsReadyForAlerts === 1
                  ? "1 account can receive app alerts right now."
                  : `${accountsReadyForAlerts} accounts can receive app alerts right now.`}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Repeated Alerts
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {repeatedAlertAccounts}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {repeatedAlertAccounts === 0
                  ? "No accounts are currently expected to get duplicate alerts."
                  : repeatedAlertAccounts === 1
                    ? "1 account may still get duplicate alerts until it opens the app again on the device it still uses."
                    : `${repeatedAlertAccounts} accounts may still get duplicate alerts until they open the app again on the device they still use.`}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Linked Accounts
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {linkIssues}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {linkIssues === 0
                  ? `All ${linkedAccounts} linked accounts look healthy.`
                  : `${linkIssues} linked account${linkIssues === 1 ? "" : "s"} need attention out of ${linkedAccounts}.`}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Fix Missing Teacher Earnings</p>
              <p className="text-xs text-muted-foreground">
                Rebuilds older teacher earnings that may have been missed.
                You usually do not need this.
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
              {backfillMutation.isPending ? "Running..." : "Fix History"}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-1">
            <div>
              <p className="text-sm font-medium">Refresh Paid Amounts</p>
              <p className="text-xs text-muted-foreground">
                Checks older payouts and updates paid amounts here if they are
                behind. You usually only need this for historical cleanup.
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
              {syncPaidMutation.isPending ? "Checking..." : "Refresh Paid"}
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-1">
            <div>
              <p className="text-sm font-medium">Send Test Alert</p>
              <p className="text-xs text-muted-foreground">
                Sends one real alert to your admin account so you can test app
                notifications on your phone.
              </p>
              {typeof diagnosticsData?.currentAdminDeviceTokens === "number" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentAdminDeviceTokens <= 1
                    ? "This admin account currently has 1 saved device. One test should create one phone alert."
                    : `This admin account currently has ${currentAdminDeviceTokens} saved devices, so one test may reach more than one place.`}
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
              {testNotificationMutation.isPending ? "Sending..." : "Send Alert"}
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
  );
}
