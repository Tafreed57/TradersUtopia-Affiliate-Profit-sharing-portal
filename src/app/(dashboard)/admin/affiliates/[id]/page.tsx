"use client";

import {
  AlertTriangle,
  ArrowLeft,
  History,
  Link2Off,
  Percent,
  Plus,
  RefreshCw,
  Save,
  Send,
  Shield,
  UserX,
  Users,
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
  initialCommissionPercent: number;
  recurringCommissionPercent: number;
  canProposeRates: boolean;
  canBeTeacher: boolean;
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
    relationshipId: string;
    id: string;
    name: string | null;
    email: string;
    status: string;
    depth: number;
    teacherCut: number;
    createdVia: "SELF_PROPOSAL" | "ADMIN_PAIR";
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
    field: "LEGACY" | "INITIAL" | "RECURRING";
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

  const [newInitialRate, setNewInitialRate] = useState("");
  const [newRecurringRate, setNewRecurringRate] = useState("");
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
        const n = result.autoRecalc.updated;
        toast.success(
          `Rates saved. ${n} unpaid commission${n === 1 ? "" : "s"} re-priced.`
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
      return payload as { updated: number; teacherRowsAffected: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      toast.success(
        `Re-priced ${result.updated} commission${result.updated === 1 ? "" : "s"}.`
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
    const initial = newInitialRate === "" ? undefined : Number(newInitialRate);
    const recurring = newRecurringRate === "" ? undefined : Number(newRecurringRate);
    if (initial === undefined && recurring === undefined) {
      toast.error("Enter at least one rate");
      return;
    }
    if (initial !== undefined && (isNaN(initial) || initial < 0 || initial > 100)) {
      toast.error("Initial rate must be 0-100");
      return;
    }
    if (recurring !== undefined && (isNaN(recurring) || recurring < 0 || recurring > 100)) {
      toast.error("Recurring rate must be 0-100");
      return;
    }
    const payload: Record<string, unknown> = {};
    if (initial !== undefined) payload.initialCommissionPercent = initial;
    if (recurring !== undefined) payload.recurringCommissionPercent = recurring;
    if (rateReason) payload.reason = rateReason;
    updateMutation.mutate(payload);
    setNewInitialRate("");
    setNewRecurringRate("");
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Current initial
                </p>
                <p className="text-2xl font-bold text-primary">
                  {data.initialCommissionPercent}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Current recurring
                </p>
                <p className="text-2xl font-bold text-primary">
                  {data.recurringCommissionPercent}%
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>New initial (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    placeholder={String(data.initialCommissionPercent)}
                    value={newInitialRate}
                    onChange={(e) => setNewInitialRate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>New recurring (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    placeholder={String(data.recurringCommissionPercent)}
                    value={newRecurringRate}
                    onChange={(e) => setNewRecurringRate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="Performance adjustment, etc."
                  value={rateReason}
                  onChange={(e) => setRateReason(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Saving re-prices all unpaid commissions for this affiliate
                using the event&apos;s initial/recurring classification.
                Paid commissions are never changed.
              </p>
              <Button
                onClick={handleRateChange}
                disabled={
                  (!newInitialRate && !newRecurringRate) ||
                  updateMutation.isPending
                }
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
                      imported before rates were set. Re-price using the
                      current initial ({data.initialCommissionPercent}%) +
                      recurring ({data.recurringCommissionPercent}%) rates.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 w-full"
                    disabled={
                      (data.initialCommissionPercent === 0 &&
                        data.recurringCommissionPercent === 0) ||
                      recalcMutation.isPending
                    }
                    onClick={() => recalcMutation.mutate()}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Re-price unpaid
                  </Button>
                </div>
              </>
            )}

            <Separator />

            {/* Teacher allocation breakdown — dual-rate aware. */}
            <div className="text-sm">
              <p className="font-medium mb-2">Allocation Breakdown</p>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Affiliate cut (initial)</span>
                  <span>{data.initialCommissionPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Affiliate cut (recurring)</span>
                  <span>{data.recurringCommissionPercent}%</span>
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
                  <span>Highest total allocated</span>
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
                <p className="font-medium">Teacher Access</p>
                <p className="text-xs text-muted-foreground">
                  When on, this affiliate can propose their own students. Admin
                  can always pair directly regardless.
                </p>
              </div>
              <Switch
                checked={data.canBeTeacher}
                onCheckedChange={(checked) =>
                  updateMutation.mutate({ canBeTeacher: checked })
                }
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Total Earned</p>
                <p className="text-xs text-muted-foreground">
                  {data.totalConversions} commissions
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
                  <TableHead>Rate</TableHead>
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
                    <TableCell>
                      <Badge
                        variant="default"
                        className={
                          entry.field === "INITIAL"
                            ? "bg-primary/15 text-primary border-primary/30"
                            : entry.field === "RECURRING"
                            ? "bg-info/15 text-info border-info/30"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {entry.field === "INITIAL"
                          ? "Initial"
                          : entry.field === "RECURRING"
                          ? "Recurring"
                          : "Legacy"}
                      </Badge>
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

interface StudentRow {
  relationshipId: string;
  id: string;
  name: string | null;
  email: string;
  status: string;
  depth: number;
  teacherCut: number;
  createdVia: "SELF_PROPOSAL" | "ADMIN_PAIR";
}

interface UserSearchResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

function StudentsUnderTeacher({
  teacherId,
  teacherName,
  students,
  onChange,
}: {
  teacherId: string;
  teacherName: string;
  students: StudentRow[];
  onChange: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const [cut, setCut] = useState("0");
  const [unpairTarget, setUnpairTarget] = useState<StudentRow | null>(null);

  const { data: searchResults, isFetching: searching } = useQuery<{
    data: UserSearchResult[];
  }>({
    queryKey: ["admin-pair-search", search],
    queryFn: async () => {
      const res = await fetch(
        `/api/users/search?q=${encodeURIComponent(search)}`
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: search.length >= 2,
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/teacher-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          studentId: selected!.id,
          teacherCut: Number(cut),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Failed to pair");
      return payload as { allocationWarning: boolean; totalAllocated: number };
    },
    onSuccess: (result) => {
      if (result.allocationWarning) {
        toast.warning(
          `Paired, but total allocation is now ${result.totalAllocated.toFixed(1)}%.`
        );
      } else {
        toast.success("Student paired.");
      }
      setAddOpen(false);
      setSearch("");
      setSelected(null);
      setCut("0");
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unpairMutation = useMutation({
    mutationFn: async (relationshipId: string) => {
      const res = await fetch(
        `/api/admin/teacher-student/${relationshipId}`,
        { method: "DELETE" }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Failed to unpair");
      return payload as { cascaded: number };
    },
    onSuccess: (result) => {
      toast.success(
        result.cascaded > 0
          ? `Unpaired. ${result.cascaded} depth-2 relationship${result.cascaded === 1 ? "" : "s"} also deactivated.`
          : "Unpaired."
      );
      setUnpairTarget(null);
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePair = () => {
    if (!selected) return;
    const n = Number(cut);
    if (isNaN(n) || n < 0 || n > 100) {
      toast.error("Cut must be 0-100");
      return;
    }
    pairMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-primary" />
          Students Under This Teacher
        </CardTitle>
        <Button
          size="sm"
          className="gap-2"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Student
        </Button>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No students paired with this teacher yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Cut</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.relationshipId}>
                  <TableCell>
                    <p className="font-medium">{s.name ?? s.email}</p>
                    {s.name && (
                      <p className="text-xs text-muted-foreground">
                        {s.email}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{s.teacherCut}%</TableCell>
                  <TableCell>
                    <Badge
                      variant="default"
                      className={
                        s.createdVia === "ADMIN_PAIR"
                          ? "bg-info/15 text-info border-info/30"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {s.createdVia === "ADMIN_PAIR" ? "Admin" : "Self"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-error hover:bg-error/10"
                      onClick={() => setUnpairTarget(s)}
                    >
                      <Link2Off className="h-3 w-3" />
                      Unpair
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Pair dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(v) => {
          setAddOpen(v);
          if (!v) {
            setSearch("");
            setSelected(null);
            setCut("0");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Student to {teacherName}</DialogTitle>
            <DialogDescription>
              Directly pair this teacher with a student. Takes effect
              immediately — no proposal review step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!selected ? (
              <div className="space-y-2">
                <Label>Search by name or email</Label>
                <Input
                  placeholder="Type at least 2 characters…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                {search.length >= 2 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                    {searching ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        Searching…
                      </div>
                    ) : !searchResults?.data.length ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        No users found
                      </div>
                    ) : (
                      searchResults.data.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => setSelected(u)}
                          disabled={u.id === teacherId}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={u.image ?? undefined} />
                            <AvatarFallback className="text-xs">
                              {(u.name ?? u.email)[0].toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {u.name ?? u.email}
                            </p>
                            {u.name && (
                              <p className="truncate text-xs text-muted-foreground">
                                {u.email}
                              </p>
                            )}
                            {u.id === teacherId && (
                              <p className="text-xs text-warning">
                                Same as teacher
                              </p>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selected.image ?? undefined} />
                    <AvatarFallback className="text-sm">
                      {(selected.name ?? selected.email)[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {selected.name ?? selected.email}
                    </p>
                    {selected.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {selected.email}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(null)}
                    className="text-xs"
                  >
                    Change
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-pair-cut">
                    Teacher&apos;s cut (%)
                  </Label>
                  <Input
                    id="admin-pair-cut"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={cut}
                    onChange={(e) => setCut(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Applies to all new conversions. Past conversions get
                    retroactive teacher splits at this rate.
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePair}
              disabled={!selected || pairMutation.isPending}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {pairMutation.isPending ? "Pairing…" : "Pair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unpair confirmation dialog */}
      <Dialog
        open={!!unpairTarget}
        onOpenChange={(v) => {
          if (!v) setUnpairTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpair student?</DialogTitle>
            <DialogDescription>
              Deactivate the relationship between {teacherName} and{" "}
              {unpairTarget?.name ?? unpairTarget?.email}. New commissions stop
              flowing to this teacher from this student. Past commissions are
              preserved. Depth-2 relationships lose their basis unless another
              active path survives.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnpairTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-error text-white hover:bg-error/90"
              onClick={() =>
                unpairTarget && unpairMutation.mutate(unpairTarget.relationshipId)
              }
              disabled={unpairMutation.isPending}
            >
              {unpairMutation.isPending ? "Unpairing…" : "Unpair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
