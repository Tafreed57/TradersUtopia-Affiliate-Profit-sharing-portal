"use client";

import {
  AlertTriangle,
  ArrowLeft,
  History,
  Percent,
  RefreshCw,
  Save,
  Shield,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/providers/currency-provider";

interface AffiliateDetail {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  status: string;
  commissionPercent: number;
  canProposeRates: boolean;
  rewardfulAffiliateId: string | null;
  preferredCurrency: string;
  createdAt: string;
  teachers: {
    teacherId: string;
    teacherName: string;
    cutPercent: number;
    depth: number;
  }[];
  students: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    depth: number;
    teacherCut: number;
  }[];
  recentCommissions: {
    id: string;
    affiliateCutPercent: number;
    affiliateCutCad: number;
    ceoCutCad: number;
    status: string;
    forfeitedToCeo: boolean;
    conversionDate: string;
  }[];
  rateHistory: {
    id: string;
    previousPercent: number;
    newPercent: number;
    reason: string | null;
    changedBy: string;
    createdAt: string;
  }[];
  totalEarnedCad: number;
  totalConversions: number;
  totalAllocated: number;
  allocationWarning: boolean;
  pendingRateNotSetCount: number;
}

export default function AffiliateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { format } = useCurrency();
  const queryClient = useQueryClient();

  const [newRate, setNewRate] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);

  const { data, isLoading } = useQuery<AffiliateDetail>({
    queryKey: ["admin-affiliate", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/affiliates/${id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await fetch(`/api/admin/affiliates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update");
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      if (result.autoRecalc?.updated > 0) {
        toast.success(
          `Rate set and ${result.autoRecalc.updated} pending commission${result.autoRecalc.updated === 1 ? "" : "s"} automatically recalculated at ${result.autoRecalc.newRate}%.`
        );
      } else {
        toast.success("Affiliate updated");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/admin/affiliates/${id}/recalc-pending`,
        { method: "POST" }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to recalculate");
      }
      return payload as { updated: number; newRate: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      toast.success(
        `Recalculated ${result.updated} commission${result.updated === 1 ? "" : "s"} at ${result.newRate}%.`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">Affiliate not found.</p>;
  }

  const handleRateChange = () => {
    const rate = Number(newRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error("Rate must be 0-100");
      return;
    }
    updateMutation.mutate({
      commissionPercent: rate,
      reason: rateReason || undefined,
    });
    setNewRate("");
    setRateReason("");
  };

  const handleDeactivate = () => {
    updateMutation.mutate({ status: "DEACTIVATED" });
    setDeactivateDialogOpen(false);
  };

  const handleReactivate = () => {
    updateMutation.mutate({ status: "ACTIVE" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={data.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {(data.name ?? data.email)[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-xl font-bold">{data.name ?? data.email}</h1>
            <p className="text-sm text-muted-foreground">{data.email}</p>
          </div>
          <Badge
            variant="default"
            className={
              data.status === "ACTIVE"
                ? "bg-success/15 text-success border-success/30"
                : "bg-error/15 text-error border-error/30"
            }
          >
            {data.status}
          </Badge>
        </div>
      </div>

      {/* Allocation Warning */}
      {data.allocationWarning && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-sm font-medium">
            Total allocation is {data.totalAllocated.toFixed(1)}% (threshold:{" "}
            {85}%). CEO remainder may be negative.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Commission Rate Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Percent className="h-5 w-5 text-primary" />
              Commission Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Current rate
              </span>
              <span className="text-2xl font-bold text-primary">
                {data.commissionPercent}%
              </span>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="space-y-2">
                <Label>New rate (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder={String(data.commissionPercent)}
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="Performance adjustment, etc."
                  value={rateReason}
                  onChange={(e) => setRateReason(e.target.value)}
                />
              </div>
              <Button
                onClick={handleRateChange}
                disabled={!newRate || updateMutation.isPending}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Update Rate
              </Button>
            </div>

            {data.pendingRateNotSetCount > 0 && (
              <>
                <Separator />
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-warning flex-shrink-0" />
                    <p className="text-sm">
                      <span className="font-medium">
                        {data.pendingRateNotSetCount} pending commission
                        {data.pendingRateNotSetCount === 1 ? "" : "s"}
                      </span>{" "}
                      imported before a rate was set. Recalculate at the
                      current rate ({data.commissionPercent}%) to pay them out.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 w-full"
                    disabled={
                      data.commissionPercent === 0 || recalcMutation.isPending
                    }
                    onClick={() => recalcMutation.mutate()}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Recalculate at current rate
                  </Button>
                </div>
              </>
            )}

            <Separator />

            {/* Teacher allocation breakdown */}
            <div className="text-sm">
              <p className="font-medium mb-2">Allocation Breakdown</p>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Affiliate cut</span>
                  <span>{data.commissionPercent}%</span>
                </div>
                {data.teachers.map((t) => (
                  <div key={t.teacherId} className="flex justify-between">
                    <span>
                      {t.teacherName} (depth {t.depth})
                    </span>
                    <span>{t.cutPercent}%</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between font-medium text-foreground">
                  <span>Total allocated</span>
                  <span>{data.totalAllocated.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>CEO remainder</span>
                  <span>{(100 - data.totalAllocated).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-primary" />
              Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Rate Proposal Access</p>
                <p className="text-xs text-muted-foreground">
                  Allow this affiliate to propose rate changes as a teacher
                </p>
              </div>
              <Switch
                checked={data.canProposeRates}
                onCheckedChange={(checked) =>
                  updateMutation.mutate({ canProposeRates: checked })
                }
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Total Earned</p>
                <p className="text-xs text-muted-foreground">
                  {data.totalConversions} conversions
                </p>
              </div>
              <span className="text-lg font-bold text-success">
                {format(data.totalEarnedCad)}
              </span>
            </div>

            <Separator />

            {data.status === "ACTIVE" ? (
              <Dialog
                open={deactivateDialogOpen}
                onOpenChange={setDeactivateDialogOpen}
              >
                <DialogTrigger>
                  <Button
                    variant="outline"
                    className="w-full text-error border-error/30 hover:bg-error/10"
                  >
                    <UserX className="mr-2 h-4 w-4" />
                    Deactivate Affiliate
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deactivate Affiliate</DialogTitle>
                    <DialogDescription>
                      This will deactivate {data.name ?? data.email} and disable
                      all their teacher-student relationships.
                    </DialogDescription>
                  </DialogHeader>

                  {data.students.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Students that will be affected:
                      </p>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {data.students.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between rounded border border-border/50 px-3 py-2 text-sm"
                          >
                            <span>{s.name ?? s.email}</span>
                            <span className="text-muted-foreground">
                              {s.teacherCut}% cut
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeactivateDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      className="bg-error hover:bg-error/90 text-white"
                      onClick={handleDeactivate}
                      disabled={updateMutation.isPending}
                    >
                      Confirm Deactivation
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleReactivate}
                disabled={updateMutation.isPending}
              >
                Reactivate Affiliate
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rate Change History */}
      {data.rateHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-primary" />
              Rate Change History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Previous</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Changed By</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rateHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell>{entry.previousPercent}%</TableCell>
                    <TableCell className="font-medium">
                      {entry.newPercent}%
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.changedBy}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {entry.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Commissions */}
      {data.recentCommissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Commissions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Affiliate Cut</TableHead>
                  <TableHead>CEO Cut</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentCommissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(c.conversionDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell>{format(c.affiliateCutCad)}</TableCell>
                    <TableCell>{format(c.ceoCutCad)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="default"
                        className={
                          c.status === "EARNED"
                            ? "bg-success/15 text-success border-success/30"
                            : c.status === "FORFEITED"
                              ? "bg-error/15 text-error border-error/30"
                              : "bg-warning/15 text-warning border-warning/30"
                        }
                      >
                        {c.status}
                      </Badge>
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
