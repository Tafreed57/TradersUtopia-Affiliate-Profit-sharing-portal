"use client";

import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  DollarSign,
  Filter,
  History,
  Link2,
  Lock,
  LockOpen,
  Percent,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  UserMinus,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { AdminPromoCodes } from "@/components/admin/admin-promo-codes";
import {
  RestoreGapApprovalDialog,
  type RestoreGapPreview,
} from "@/components/admin/restore-gap-approval-dialog";
import {
  EarningsSummaryCard,
  type EarningsSummaryData,
} from "@/components/commissions/earnings-summary";
import {
  LifetimeHeaderCards,
  type LifetimeHeaderData,
} from "@/components/commissions/lifetime-header";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrency } from "@/providers/currency-provider";

interface AffiliateDetail {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  status: "ACTIVE" | "DEACTIVATED";
  commissionPercent: number;
  initialCommissionPercent: number;
  recurringCommissionPercent: number;
  canProposeRates: boolean;
  canBeTeacher: boolean;
  ratesLocked: boolean;
  ratesConfigured: boolean;
  rewardfulAffiliateId: string | null;
  rewardfulEmail: string | null;
  backfillStatus: string;
  backfillStartedAt: string | null;
  backfillCompletedAt: string | null;
  backfillError: string | null;
  linkError: string | null;
  linkInProgressAt: string | null;
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
    affiliateCut: number;
    ceoCut: number;
    currency: "USD" | "CAD";
    status: "EARNED" | "FORFEITED" | "PENDING" | "PAID" | "VOIDED";
    forfeitedToCeo: boolean;
    conversionDate: string;
  }[];
  rateHistory: {
    id: string;
    previousPercent: number;
    newPercent: number;
    field: "LEGACY" | "INITIAL" | "RECURRING" | "LOCK";
    appliedMode: "RETROACTIVE" | "FORWARD_ONLY" | "LOCK" | "UNLOCK";
    reason: string | null;
    changedBy: string;
    createdAt: string;
  }[];
  totalEarnedCad: number;
  totalCommissions: number;
  totalAllocated: number;
  allocationWarning: boolean;
  pendingRateNotSetCount: number;
}

interface Commission {
  id: string;
  affiliateCut: string;
  currency: "USD" | "CAD";
  status: "EARNED" | "FORFEITED" | "PENDING" | "PAID" | "VOIDED";
  forfeitedToCeo: boolean;
  forfeitureReason: string | null;
  conversionDate: string;
  upstreamState: string | null;
  upstreamDueAt: string | null;
  campaignName: string | null;
  processedAt: string;
}

interface CommissionResponse {
  data: Commission[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface AttendanceRecord {
  id: string;
  date: string;
  timezone: string;
  note: string | null;
  submittedAt: string;
}

interface AttendanceResponse {
  data: AttendanceRecord[];
  hasEverSubmitted: boolean;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface Student {
  relationshipId: string;
  relationshipSequence: number;
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  status: string;
  depth: number;
  teacherCutPercent: number;
  teacherUnpaidCad: number;
  teacherDueCad: number;
  teacherPendingCad: number;
  teacherPaidCad: number;
  nextDueAt: string | null;
  conversionCount: number;
  attendanceDaysThisMonth: number;
  dataStale: boolean;
  dataReason: "ok" | "stale-cache" | "timeout" | "error" | "not-linked";
  fetchedAt: string | null;
}

interface DirectStudent extends Student {
  subStudents: Student[];
}

interface PreviousStudent extends Student {
  archiveId: string;
  archivedAt: string;
  archivedByRole: "ADMIN" | "TEACHER" | "SYSTEM";
  archiveReason: string | null;
  snapshotUnpaidCad: number;
  snapshotDueCad: number;
  snapshotPendingCad: number;
  snapshotPaidCad: number;
  snapshotCommissionCount: number;
  snapshotNextDueAt: string | null;
  pendingRestoreRequest: {
    id: string;
    createdAt: string;
    requestNote: string | null;
  } | null;
}

interface GrandTotals {
  totalUnpaidCad: number;
  totalDueCad: number;
  totalPendingCad: number;
  directUnpaidCad: number;
  indirectUnpaidCad: number;
  archivedUnpaidCad: number;
  activeUnpaidCad: number;
  totalPaidCad: number;
  archivedPaidCad: number;
}

interface StudentsResponse {
  directStudents: DirectStudent[];
  orphanedSubStudents?: Student[];
  previousStudents?: PreviousStudent[];
  grandTotals: GrandTotals;
  isTeacher: boolean;
  hasArchivedStudents: boolean;
  canBeTeacher: boolean;
  canProposeRates: boolean;
}

interface UserSearchResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface DetailCommission {
  id: string;
  conversionDate: string;
  teacherCut: number;
  currency: "USD" | "CAD";
  status: string;
  forfeitureReason: string | null;
  paidAt: string | null;
  upstreamState: string | null;
  upstreamDueAt: string | null;
  campaignName: string | null;
}

interface DetailAttendance {
  id: string;
  date: string;
  timezone: string;
  note: string | null;
  submittedAt: string;
}

interface StudentDetailResponse {
  student: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  relationshipId: string;
  relationshipSequence: number;
  depth: number;
  teacherCutPercent: number;
  teacherUnpaidCad: number;
  teacherDueCad: number;
  teacherPendingCad: number;
  teacherPaidCad: number;
  nextDueAt: string | null;
  dataStale: boolean;
  dataReason: "ok" | "stale-cache" | "timeout" | "error" | "not-linked";
  fetchedAt: string | null;
  commissions: DetailCommission[];
  attendance: DetailAttendance[];
  commissionTotal: number;
  attendanceTotal: number;
  commissionHasMore: boolean;
  attendanceHasMore: boolean;
}

type ManagedLifetimeStats = LifetimeHeaderData & EarningsSummaryData;

const STATUS_CONFIG = {
  EARNED: {
    label: "Earned",
    className: "bg-success/15 text-success border-success/30",
  },
  FORFEITED: {
    label: "Forfeited",
    className: "bg-error/15 text-error border-error/30",
  },
  PENDING: {
    label: "Pending",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  PAID: {
    label: "Paid",
    className: "bg-info/15 text-info border-info/30",
  },
  VOIDED: {
    label: "Voided",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
} as const;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload as T;
}

function formatConversionDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getEarnedBadge(upstreamState: string | null) {
  if (upstreamState === "due") {
    return {
      label: "Due Now",
      className: "bg-info/15 text-info border-info/30",
    };
  }

  return {
    label: "In Holding",
    className: "bg-warning/15 text-warning border-warning/30",
  };
}

function formatAttendanceDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatAttendanceTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function friendlyForfeitureReason(raw: string | null) {
  if (!raw) return null;
  if (raw === "rate_not_set") {
    return "Pending until commission rates are configured";
  }
  return raw.replace(/_/g, " ");
}

function getInitials(name: string | null, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return email[0]?.toUpperCase() ?? "A";
}

function formatArchiveActor(role: PreviousStudent["archivedByRole"]) {
  switch (role) {
    case "ADMIN":
      return "admin";
    case "TEACHER":
      return "teacher";
    default:
      return "system";
  }
}

function getMonthWindow(selectedMonth: string) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, from, to, lastDay };
}

function InfoTip({ children }: { children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80 transition-colors hover:text-foreground">
        <CircleHelp className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">{children}</TooltipContent>
    </Tooltip>
  );
}

function ModeBadge({ locked }: { locked: boolean }) {
  return (
    <Badge
      variant="default"
      className={
        locked
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-warning/15 text-warning border-warning/30"
      }
    >
      {locked ? "History Locked" : "Onboarding Mode"}
    </Badge>
  );
}

function AccountStatusBadge({ status }: { status: AffiliateDetail["status"] }) {
  return (
    <Badge
      variant="default"
      className={
        status === "ACTIVE"
          ? "bg-success/15 text-success border-success/30"
          : "bg-error/15 text-error border-error/30"
      }
    >
      {status}
    </Badge>
  );
}

function CommissionStatusBadge({
  status,
}: {
  status: Commission["status"] | AffiliateDetail["recentCommissions"][number]["status"];
}) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="default" className={config.className}>
      {config.label}
    </Badge>
  );
}

function StudentDetailSheet({
  adminId,
  affiliateId,
  student,
  onClose,
  format,
}: {
  adminId: string | undefined;
  affiliateId: string;
  student: Student | null;
  onClose: () => void;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
}) {
  const { data, isLoading } = useQuery<StudentDetailResponse>({
    queryKey: [
      "admin-affiliate-workspace",
      adminId,
      affiliateId,
      "student-detail",
      student?.id,
      student?.relationshipId,
      student?.relationshipSequence,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (student?.relationshipId) {
        params.set("relationshipId", student.relationshipId);
      }
      if (student?.relationshipSequence) {
        params.set("relationshipSequence", String(student.relationshipSequence));
      }
      return fetchJson(
        `/api/admin/affiliates/${affiliateId}/students/${student!.id}/detail?${params.toString()}`
      );
    },
    enabled: !!student && !!adminId,
    retry: false,
  });

  return (
    <Sheet
      open={!!student}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/50 p-4 pb-0">
          <div className="flex items-center gap-3 pb-4 pr-8">
            <Avatar className="h-10 w-10">
              <AvatarImage src={student?.image ?? undefined} />
              <AvatarFallback className="bg-primary/10 text-sm text-primary">
                {student ? getInitials(student.name, student.email) : ""}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <SheetTitle>{student?.name ?? student?.email}</SheetTitle>
              {student?.name && (
                <SheetDescription className="truncate">
                  {student.email}
                </SheetDescription>
              )}
            </div>
          </div>

          {data && (
            <div className="grid grid-cols-3 gap-3 pb-4 text-sm">
              <div>
                <p className="font-semibold text-info">
                  {format(data.teacherDueCad, "CAD")}
                </p>
                <p className="text-xs text-muted-foreground">Due now</p>
              </div>
              <div>
                <p className="font-semibold text-warning">
                  {format(data.teacherPendingCad, "CAD")}
                </p>
                <p className="text-xs text-muted-foreground">In holding</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">
                  {format(data.teacherPaidCad, "CAD")}
                </p>
                <p className="text-xs text-muted-foreground">Paid</p>
              </div>
              <div>
                <p className="font-semibold">{data.commissionTotal}</p>
                <p className="text-xs text-muted-foreground">Commissions</p>
              </div>
              <div>
                <p className="font-semibold">{data.attendanceTotal}</p>
                <p className="text-xs text-muted-foreground">Attendance</p>
              </div>
              <div>
                <p className="font-semibold">{data.teacherCutPercent}%</p>
                <p className="text-xs text-muted-foreground">Teacher cut</p>
              </div>
            </div>
          )}
          {data?.nextDueAt && data.teacherPendingCad > 0 && (
            <p className="pb-4 text-xs text-muted-foreground">
              Next release {formatShortDate(data.nextDueAt)}
            </p>
          )}
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="commissions" className="flex flex-1 flex-col overflow-hidden">
            <TabsList variant="line" className="w-full justify-start px-4 pt-2">
              <TabsTrigger value="commissions">
                Commissions ({data?.commissionTotal ?? 0})
              </TabsTrigger>
              <TabsTrigger value="attendance">
                Attendance ({data?.attendanceTotal ?? 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="commissions"
              className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
            >
              {!data?.commissions.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No commissions yet
                </p>
              ) : (
                data.commissions.map((commission) => {
                  const earnedBadge = getEarnedBadge(commission.upstreamState);
                  const badgeClassName =
                    commission.status === "EARNED"
                      ? earnedBadge.className
                      : commission.status === "PAID"
                        ? "bg-info/15 text-info border-info/30"
                        : commission.status === "FORFEITED"
                          ? "bg-error/15 text-error border-error/30"
                          : commission.status === "VOIDED"
                            ? "bg-destructive/15 text-destructive border-destructive/30"
                            : "bg-warning/15 text-warning border-warning/30";
                  const badgeLabel =
                    commission.status === "PAID"
                      ? "Paid"
                      : commission.status === "EARNED"
                        ? earnedBadge.label
                        : commission.status;

                  return (
                  <div
                    key={commission.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {formatShortDate(commission.conversionDate)}
                      </p>
                      {commission.status === "PAID" && commission.paidAt && (
                        <p className="text-xs text-muted-foreground">
                          Paid {formatShortDate(commission.paidAt)}
                        </p>
                      )}
                      {commission.status === "EARNED" &&
                        commission.upstreamState !== "due" &&
                        commission.upstreamDueAt && (
                          <p className="text-xs text-muted-foreground">
                            Releases {formatShortDate(commission.upstreamDueAt)}
                          </p>
                        )}
                      {commission.campaignName && (
                        <p className="text-xs text-muted-foreground">
                          {commission.campaignName}
                        </p>
                      )}
                      {friendlyForfeitureReason(commission.forfeitureReason) && (
                        <p className="text-xs capitalize text-muted-foreground">
                          {friendlyForfeitureReason(commission.forfeitureReason)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${
                          commission.status === "EARNED"
                            ? "text-success"
                            : "text-muted-foreground"
                        }`}
                      >
                        {format(commission.teacherCut, commission.currency)}
                      </span>
                      <Badge variant="default" className={badgeClassName}>
                        {badgeLabel}
                      </Badge>
                    </div>
                  </div>
                  );
                })
              )}
              {data?.commissionHasMore && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Showing most recent {data.commissions.length} of{" "}
                  {data.commissionTotal}
                </p>
              )}
            </TabsContent>

            <TabsContent
              value="attendance"
              className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
            >
              {!data?.attendance.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No attendance records yet
                </p>
              ) : (
                data.attendance.map((attendance) => (
                  <div
                    key={attendance.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{attendance.date}</p>
                      <p className="text-xs text-muted-foreground">
                        {attendance.timezone}
                      </p>
                    </div>
                    {attendance.note && (
                      <p className="max-w-[150px] truncate text-xs text-muted-foreground">
                        {attendance.note}
                      </p>
                    )}
                  </div>
                ))
              )}
              {data?.attendanceHasMore && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Showing most recent {data.attendance.length} of{" "}
                  {data.attendanceTotal}
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AdminPairStudentDialog({
  teacherId,
  previousStudents,
  onRestoreInstead,
  onSuccess,
}: {
  teacherId: string;
  previousStudents: PreviousStudent[];
  onRestoreInstead: (student: PreviousStudent) => void;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const [teacherCut, setTeacherCut] = useState("");

  const { data: searchResults, isFetching } = useQuery<{ data: UserSearchResult[] }>({
    queryKey: ["admin-pair-student-search", teacherId, search],
    queryFn: async () =>
      fetchJson(`/api/users/search?q=${encodeURIComponent(search)}`),
    enabled: open && search.length >= 2,
    retry: false,
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/teacher-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          studentId: selected!.id,
          teacherCut: Number(teacherCut),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.error ?? "Failed to add student") as Error & {
          requiresRestoreReview?: boolean;
          relationshipId?: string;
        };
        error.requiresRestoreReview = payload.requiresRestoreReview === true;
        error.relationshipId = payload.relationshipId;
        throw error;
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("Student linked successfully");
      setOpen(false);
      setSearch("");
      setSelected(null);
      setTeacherCut("");
      onSuccess();
    },
    onError: (error: Error & { requiresRestoreReview?: boolean; relationshipId?: string }) => {
      if (error.requiresRestoreReview) {
        const archivedMatch = previousStudents.find(
          (student) => student.relationshipId === error.relationshipId
        );
        if (archivedMatch) {
          setOpen(false);
          setSearch("");
          setSelected(null);
          setTeacherCut("");
          toast.error(
            "This student already has archived history here. Review the restore options instead."
          );
          onRestoreInstead(archivedMatch);
          return;
        }
      }
      toast.error(error.message);
    },
  });

  const reset = () => {
    setSearch("");
    setSelected(null);
    setTeacherCut("");
  };

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add Student
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Student To This Affiliate</DialogTitle>
            <DialogDescription>
              Search for a portal user and set the teacher share that this managed
              affiliate should receive.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!selected ? (
              <div className="space-y-2">
                <Label>Search by name or email</Label>
                <Input
                  placeholder="Type at least 2 characters..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoFocus
                />
                {search.length >= 2 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                    {isFetching ? (
                      <div className="p-3 text-sm text-muted-foreground">Searching...</div>
                    ) : !searchResults?.data.length ? (
                      <div className="p-3 text-sm text-muted-foreground">No users found</div>
                    ) : (
                      searchResults.data.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelected(user)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={user.image ?? undefined} />
                            <AvatarFallback className="text-xs">
                              {getInitials(user.name, user.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {user.name ?? user.email}
                            </p>
                            {user.name && (
                              <p className="truncate text-xs text-muted-foreground">
                                {user.email}
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
                <div className="flex items-center gap-3 rounded-xl border border-border/50 p-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selected.image ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(selected.name, selected.email)}
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
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Change
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-student-teacher-cut">Teacher share (%)</Label>
                  <Input
                    id="admin-student-teacher-cut"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={teacherCut}
                    onChange={(event) => setTeacherCut(event.target.value)}
                    placeholder="e.g. 15"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    If this student has archived history under this affiliate already, the
                    system will route you into the restore flow instead so gap income can
                    be reviewed first.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => pairMutation.mutate()}
              disabled={!selected || !teacherCut || pairMutation.isPending}
            >
              {pairMutation.isPending ? "Saving..." : "Add Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ArchiveStudentDialog({
  student,
  open,
  onOpenChange,
  onSuccess,
}: {
  student: DirectStudent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [archiveReason, setArchiveReason] = useState("");
  const [showInPreviousStudents, setShowInPreviousStudents] = useState(true);

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!student) throw new Error("No student selected");
      return fetchJson(`/api/admin/teacher-student/${student.relationshipId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archiveReason:
            archiveReason.trim() || "Admin removed this student from the active roster.",
          showInPreviousStudents,
        }),
      });
    },
    onSuccess: () => {
      toast.success(
        showInPreviousStudents
          ? "Student moved to Previous Students with history preserved."
          : "Student removed from the active roster without showing in the previous-students list."
      );
      setArchiveReason("");
      setShowInPreviousStudents(true);
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setArchiveReason("");
          setShowInPreviousStudents(true);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove Student From Active Roster</DialogTitle>
          <DialogDescription>
            Safely archive this student relationship. Existing payout progress stays
            intact, and you can choose whether the archive remains visible in the
            previous-students section.
          </DialogDescription>
        </DialogHeader>

        {student && (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm">
              <p className="font-medium">{student.name ?? student.email}</p>
              <p className="mt-2 text-muted-foreground">
                Current unpaid {student.teacherUnpaidCad.toFixed(2)} CAD, paid{" "}
                {student.teacherPaidCad.toFixed(2)} CAD.
              </p>
            </div>

            <div className="rounded-xl border border-border/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">Show in previous students</p>
                  <p className="text-sm text-muted-foreground">
                    Leave this on if the teacher should still see the archived record and
                    request a future return from the portal.
                  </p>
                </div>
                <Switch
                  checked={showInPreviousStudents}
                  onCheckedChange={setShowInPreviousStudents}
                />
              </div>
              {!showInPreviousStudents && (
                <p className="mt-3 text-xs text-warning">
                  This archive will be hidden from the teacher-facing previous-students
                  list and from this workspace list.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="archive-student-reason">Reason (optional)</Label>
              <Input
                id="archive-student-reason"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                placeholder="Explain why this student is being removed."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending || !student}
          >
            {archiveMutation.isPending ? "Removing..." : "Remove Student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagedPreviousStudentCard({
  student,
  format,
  onViewDetail,
  onRestore,
}: {
  student: PreviousStudent;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onViewDetail: (student: Student) => void;
  onRestore: (student: PreviousStudent) => void;
}) {
  return (
    <Card className="overflow-hidden border-border/60 bg-muted/10">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={student.image ?? undefined} />
              <AvatarFallback className="bg-primary/10 text-sm text-primary">
                {getInitials(student.name, student.email)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{student.name ?? student.email}</p>
                <Badge
                  variant="default"
                  className="bg-muted/20 text-muted-foreground border-border/60"
                >
                  Previous student
                </Badge>
                {student.pendingRestoreRequest && (
                  <Badge
                    variant="default"
                    className="bg-info/15 text-info border-info/30"
                  >
                    Teacher requested return
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{student.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Removed {formatShortDate(student.archivedAt)} by{" "}
                {formatArchiveActor(student.archivedByRole)}
                {student.archiveReason ? ` - ${student.archiveReason}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onViewDetail(student)}>
              View
            </Button>
            <Button size="sm" onClick={() => onRestore(student)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Restore
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Current unpaid</p>
            <p className="mt-1 font-semibold text-success">
              {format(student.teacherUnpaidCad, "CAD")}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Due now</p>
            <p className="mt-1 font-semibold text-info">
              {format(student.teacherDueCad, "CAD")}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">In holding</p>
            <p className="mt-1 font-semibold">
              {format(student.teacherPendingCad, "CAD")}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="mt-1 font-semibold">
              {format(student.teacherPaidCad, "CAD")}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          Snapshot at removal: unpaid {format(student.snapshotUnpaidCad, "CAD")} |
          paid {format(student.snapshotPaidCad, "CAD")} | {student.snapshotCommissionCount}{" "}
          commission{student.snapshotCommissionCount === 1 ? "" : "s"}
          {student.snapshotNextDueAt
            ? ` | next release ${formatShortDate(student.snapshotNextDueAt)}`
            : ""}
        </div>

        {student.pendingRestoreRequest?.requestNote && (
          <p className="mt-3 text-xs text-muted-foreground">
            Teacher note: {student.pendingRestoreRequest.requestNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ManagedStudentCard({
  student,
  format,
  onViewDetail,
  onArchive,
}: {
  student: DirectStudent;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onViewDetail: (student: Student) => void;
  onArchive: (student: DirectStudent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const subCount = student.subStudents.length;
  const subUnpaid = student.subStudents.reduce(
    (sum, subStudent) => sum + subStudent.teacherUnpaidCad,
    0
  );

  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={student.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-sm text-primary">
              {getInitials(student.name, student.email)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{student.name ?? student.email}</p>
              {student.dataStale && (
                <Badge
                  variant="default"
                  className="bg-warning/15 text-warning border-warning/30"
                >
                  Cached
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {student.email}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onViewDetail(student)}>
              View
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-error hover:bg-error/10 hover:text-error"
              onClick={() => onArchive(student)}
            >
              <UserMinus className="mr-1 h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Due now</p>
            <p className="mt-1 font-semibold text-info">
              {format(student.teacherDueCad, "CAD")}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">In holding</p>
            <p className="mt-1 font-semibold">
              {format(student.teacherPendingCad, "CAD")}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Commissions</p>
            <p className="mt-1 font-semibold">{student.conversionCount}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="mt-1 font-semibold">{format(student.teacherPaidCad, "CAD")}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Attendance{" "}
            <span className="font-medium text-foreground">
              {student.attendanceDaysThisMonth}
            </span>
          </span>
          <span>
            Teacher cut{" "}
            <span className="font-medium text-foreground">
              {student.teacherCutPercent}%
            </span>
          </span>
          <span>
            Status{" "}
            <span className="font-medium text-foreground">{student.status}</span>
          </span>
          {student.fetchedAt && (
            <span>
              Updated{" "}
              <span className="font-medium text-foreground">
                {new Date(student.fetchedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </span>
          )}
          {student.nextDueAt && student.teacherPendingCad > 0 && (
            <span>
              Next release{" "}
              <span className="font-medium text-foreground">
                {formatShortDate(student.nextDueAt)}
              </span>
            </span>
          )}
        </div>

        {subCount > 0 && (
          <div className="mt-4 border-t border-border/50 pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-border/50 bg-muted/10 px-3 py-2 text-left transition-colors hover:bg-muted/20"
              onClick={() => setExpanded((value) => !value)}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {subCount} indirect {subCount === 1 ? "student" : "students"}
              </span>
              <span className="text-xs text-muted-foreground">
                {format(subUnpaid, "CAD")} unpaid
              </span>
            </button>

            {expanded && (
              <div className="mt-3 space-y-2">
                {student.subStudents.map((subStudent) => (
                  <button
                    key={subStudent.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent/30"
                    onClick={() => onViewDetail(subStudent)}
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {subStudent.name ?? subStudent.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subStudent.email}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-info">
                        {format(subStudent.teacherDueCad, "CAD")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subStudent.teacherPendingCad > 0
                          ? `Holding ${format(subStudent.teacherPendingCad, "CAD")}`
                          : `${subStudent.teacherCutPercent}% cut`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ManagedAffiliateWorkspace({
  affiliateId,
}: {
  affiliateId: string;
}) {
  const { data: session } = useSession();
  const adminId = session?.user?.id;
  const queryClient = useQueryClient();
  const { currency, toggle, format, convert, stale } = useCurrency();

  const [activeTab, setActiveTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentToArchive, setStudentToArchive] = useState<DirectStudent | null>(null);
  const [studentToRestore, setStudentToRestore] = useState<PreviousStudent | null>(null);
  const [newInitialRate, setNewInitialRate] = useState("");
  const [newRecurringRate, setNewRecurringRate] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [replaceLinkDialogOpen, setReplaceLinkDialogOpen] = useState(false);
  const [replaceLinkIdentifier, setReplaceLinkIdentifier] = useState("");
  const [replaceLinkConfirmText, setReplaceLinkConfirmText] = useState("");

  const workspaceKey = ["admin-affiliate-workspace", adminId, affiliateId] as const;
  const monthWindow = getMonthWindow(selectedMonth);
  const commissionQueryParams = new URLSearchParams();
  commissionQueryParams.set("page", String(page));
  commissionQueryParams.set("limit", "20");
  if (statusFilter !== "all") commissionQueryParams.set("status", statusFilter);
  if (fromDate) commissionQueryParams.set("from", fromDate);
  if (toDate) commissionQueryParams.set("to", toDate);

  const invalidateWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-affiliate-workspace", adminId, affiliateId] });
    queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
  };

  const overviewQuery = useQuery<AffiliateDetail>({
    queryKey: [...workspaceKey, "overview"],
    enabled: !!adminId,
    queryFn: async () => fetchJson(`/api/admin/affiliates/${affiliateId}`),
    retry: false,
  });

  const lifetimeQuery = useQuery<ManagedLifetimeStats>({
    queryKey: [...workspaceKey, "lifetime"],
    enabled: !!adminId,
    queryFn: async () =>
      fetchJson(`/api/admin/affiliates/${affiliateId}/lifetime-stats`),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const attendanceQuery = useQuery<AttendanceResponse>({
    queryKey: [...workspaceKey, "attendance", monthWindow.from, monthWindow.to],
    enabled: !!adminId,
    queryFn: async () =>
      fetchJson(
        `/api/admin/affiliates/${affiliateId}/attendance?from=${monthWindow.from}&to=${monthWindow.to}&limit=100`
      ),
    retry: false,
  });

  const studentsQuery = useQuery<StudentsResponse>({
    queryKey: [...workspaceKey, "students"],
    enabled: !!adminId,
    queryFn: async () =>
      fetchJson(`/api/admin/affiliates/${affiliateId}/students`),
    retry: false,
  });

  const restorePreviewQuery = useQuery<RestoreGapPreview>({
    queryKey: [...workspaceKey, "restore-preview", studentToRestore?.archiveId],
    enabled: !!adminId && !!studentToRestore?.archiveId,
    queryFn: async () =>
      fetchJson(
        `/api/admin/teacher-student/restore-preview?archiveId=${studentToRestore!.archiveId}`
      ),
    retry: false,
  });

  const commissionsQuery = useQuery<CommissionResponse>({
    queryKey: [
      ...workspaceKey,
      "commissions",
      page,
      statusFilter,
      fromDate,
      toDate,
    ],
    enabled: !!adminId && activeTab === "commissions",
    queryFn: async () =>
      fetchJson(
        `/api/admin/affiliates/${affiliateId}/commissions?${commissionQueryParams.toString()}`
      ),
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) =>
      fetchJson<{
        autoRecalc?: { updated: number; teacherRowsAffected: number };
      }>(`/api/admin/affiliates/${affiliateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }),
    onSuccess: (result) => {
      invalidateWorkspace();
      if (result.autoRecalc?.updated) {
        toast.success(
          `Rates saved. ${result.autoRecalc.updated} unpaid commission${
            result.autoRecalc.updated === 1 ? "" : "s"
          } re-priced.`
        );
      } else {
        toast.success("Affiliate updated");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recalcMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{ updated: number; teacherRowsAffected: number }>(
        `/api/admin/affiliates/${affiliateId}/recalc-pending`,
        { method: "POST" }
      ),
    onSuccess: (result) => {
      invalidateWorkspace();
      toast.success(
        `Re-priced ${result.updated} commission${result.updated === 1 ? "" : "s"}.`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncPaidMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{
        fetched: number;
        updated: number;
      }>(`/api/admin/affiliates/${affiliateId}/sync-paid`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      invalidateWorkspace();
      toast.success(
        `Synced ${result.fetched} commission${result.fetched === 1 ? "" : "s"} and flipped ${result.updated} split${result.updated === 1 ? "" : "s"} to paid.`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restoreStudentMutation = useMutation({
    mutationFn: async ({
      backfillMode,
      selectedEventIds,
      reviewNote,
    }: {
      backfillMode: "NONE" | "ALL" | "CUSTOM";
      selectedEventIds: string[];
      reviewNote: string;
    }) => {
      if (!studentToRestore) {
        throw new Error("No archived student selected");
      }
      return fetchJson(`/api/admin/teacher-student/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archiveId: studentToRestore.archiveId,
          backfillMode,
          selectedEventIds,
          reviewNote: reviewNote || undefined,
        }),
      });
    },
    onSuccess: () => {
      invalidateWorkspace();
      queryClient.invalidateQueries({ queryKey: ["admin-teacher-restore-requests"] });
      setStudentToRestore(null);
      toast.success("Student restored successfully");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retryLinkMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{ alreadyLinked?: boolean; rewardfulAffiliateId?: string }>(
        `/api/admin/affiliates/${affiliateId}/retry-link`,
        { method: "POST" }
      ),
    onSuccess: (result) => {
      invalidateWorkspace();
      toast.success(
        result.alreadyLinked
          ? "Account is already linked."
          : "Link retry completed."
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const replaceLinkMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{
        targetAffiliateEmail: string;
        deleted: { events: number; splitsCascaded: number };
        waitingForRate: boolean;
        backfill:
          | null
          | {
              imported: number;
              skipped: number;
              failed: number;
              status: "COMPLETED" | "FAILED" | "WAITING_FOR_RATE";
            };
      }>(`/api/admin/affiliates/${affiliateId}/replace-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: replaceLinkIdentifier.trim() }),
      }),
    onSuccess: (result) => {
      invalidateWorkspace();
      setReplaceLinkDialogOpen(false);
      setReplaceLinkIdentifier("");
      setReplaceLinkConfirmText("");

      if (result.waitingForRate || result.backfill?.status === "WAITING_FOR_RATE") {
        toast.success(
          "Linked account replaced. History will import after rates are configured."
        );
        return;
      }

      if (result.backfill?.status === "FAILED") {
        toast.warning(
          `Linked account replaced, but import needs attention after clearing ${result.deleted.events} prior commission record${
            result.deleted.events === 1 ? "" : "s"
          }.`
        );
        return;
      }

      toast.success(
        `Linked account replaced. Imported ${result.backfill?.imported ?? 0} commission${
          result.backfill?.imported === 1 ? "" : "s"
        } from ${result.targetAffiliateEmail}.`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lockMutation = useMutation({
    mutationFn: async (locked: boolean) =>
      fetchJson<{ ratesLocked: boolean }>(
        `/api/admin/affiliates/${affiliateId}/lock`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked }),
        }
      ),
    onSuccess: (result) => {
      invalidateWorkspace();
      toast.success(
        result.ratesLocked
          ? "History locked. Future rate changes now affect new commissions only."
          : "History unlocked. The next rate change can re-price unpaid commissions."
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (overviewQuery.isLoading || !adminId) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (overviewQuery.error instanceof Error) {
    return <p className="text-muted-foreground">{overviewQuery.error.message}</p>;
  }

  const data = overviewQuery.data;
  if (!data) {
    return <p className="text-muted-foreground">Affiliate not found.</p>;
  }

  const lifetimeError =
    lifetimeQuery.error instanceof Error ? lifetimeQuery.error.message : null;
  const attendanceError =
    attendanceQuery.error instanceof Error ? attendanceQuery.error.message : null;
  const studentsError =
    studentsQuery.error instanceof Error ? studentsQuery.error.message : null;
  const commissionsError =
    commissionsQuery.error instanceof Error ? commissionsQuery.error.message : null;

  const studentsData = studentsQuery.data;
  const studentGrandTotals = studentsData?.grandTotals;
  const directStudentCount = studentsData?.directStudents.length ?? 0;
  const orphanedSubStudents = studentsData?.orphanedSubStudents ?? [];
  const previousStudents = studentsData?.previousStudents ?? [];
  const indirectStudentCount =
    (studentsData?.directStudents.reduce(
      (count, student) => count + student.subStudents.length,
      0
    ) ?? 0) + orphanedSubStudents.length;
  const previousStudentCount = previousStudents.length;
  const totalVisibleStudents =
    directStudentCount + indirectStudentCount + previousStudentCount;
  const lastAttendance = attendanceQuery.data?.data[0] ?? null;
  const attendanceDates = new Set(attendanceQuery.data?.data.map((row) => row.date) ?? []);
  const firstDayOfMonth = new Date(monthWindow.year, monthWindow.month - 1, 1).getDay();
  const calendarDays: Array<number | null> = [];
  for (let index = 0; index < firstDayOfMonth; index += 1) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= monthWindow.lastDay; day += 1) {
    calendarDays.push(day);
  }

  const commissionsPageTotal =
    commissionsQuery.data?.data
      .filter((commission) => commission.status === "EARNED")
      .reduce(
        (sum, commission) =>
          sum + convert(Number(commission.affiliateCut), commission.currency),
        0
      ) ?? 0;

  const handleRateChange = () => {
    const initial = newInitialRate === "" ? undefined : Number(newInitialRate);
    const recurring =
      newRecurringRate === "" ? undefined : Number(newRecurringRate);

    if (initial === undefined && recurring === undefined) {
      toast.error("Enter at least one rate");
      return;
    }
    if (initial !== undefined && (Number.isNaN(initial) || initial < 0 || initial > 100)) {
      toast.error("Initial rate must be 0-100");
      return;
    }
    if (
      recurring !== undefined &&
      (Number.isNaN(recurring) || recurring < 0 || recurring > 100)
    ) {
      toast.error("Recurring rate must be 0-100");
      return;
    }

    const payload: Record<string, unknown> = {};
    if (initial !== undefined) payload.initialCommissionPercent = initial;
    if (recurring !== undefined) payload.recurringCommissionPercent = recurring;
    if (rateReason.trim()) payload.reason = rateReason.trim();

    updateMutation.mutate(payload);
    setNewInitialRate("");
    setNewRecurringRate("");
    setRateReason("");
  };

  return (
    <TooltipProvider>
      <StudentDetailSheet
        adminId={adminId}
        affiliateId={affiliateId}
        student={selectedStudent}
        onClose={() => setSelectedStudent(null)}
        format={format}
      />
      <ArchiveStudentDialog
        student={studentToArchive}
        open={!!studentToArchive}
        onOpenChange={(open) => {
          if (!open) setStudentToArchive(null);
        }}
        onSuccess={invalidateWorkspace}
      />
      <RestoreGapApprovalDialog
        open={!!studentToRestore}
        onOpenChange={(open) => {
          if (!open) setStudentToRestore(null);
        }}
        preview={restorePreviewQuery.data ?? null}
        pending={restorePreviewQuery.isFetching || restoreStudentMutation.isPending}
        title="Restore Student to Active Roster"
        description={
          studentToRestore
            ? `Choose whether this affiliate should receive none, some, or all archived-gap income before ${studentToRestore.name ?? studentToRestore.email} becomes active under them again.`
            : "Review the archived gap and choose what should be granted back before the student returns."
        }
        submitLabel="Restore Student"
        format={format}
        onSubmit={({ backfillMode, selectedEventIds, reviewNote }) =>
          restoreStudentMutation.mutate({
            backfillMode,
            selectedEventIds,
            reviewNote,
          })
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Admin
            </Button>
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            className="flex items-center gap-2"
          >
            <ArrowDownUp className="h-4 w-4" />
            Display {currency}
            {stale && (
              <span className="text-xs text-warning" title="Using cached rate">
                (cached)
              </span>
            )}
          </Button>
        </div>

        <Card className="overflow-hidden border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(0,255,204,0.10),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,193,7,0.08),transparent_32%)]">
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16 border border-border/60">
                  <AvatarImage src={data.image ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-lg text-primary">
                    {getInitials(data.name, data.email)}
                  </AvatarFallback>
                </Avatar>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      Managed Affiliate Workspace
                    </p>
                    <h1 className="text-3xl font-bold tracking-tight">
                      {data.name ?? data.email}
                    </h1>
                    <p className="text-sm text-muted-foreground">{data.email}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <AccountStatusBadge status={data.status} />
                    <ModeBadge locked={data.ratesLocked} />
                    <Badge
                      variant="default"
                      className="bg-muted/30 text-muted-foreground border-border/60"
                    >
                      Preferred {data.preferredCurrency}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Initial rate</p>
                  <p className="mt-1 text-lg font-semibold text-primary">
                    {data.initialCommissionPercent}%
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Recurring rate</p>
                  <p className="mt-1 text-lg font-semibold text-primary">
                    {data.recurringCommissionPercent}%
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Commissions</p>
                  <p className="mt-1 text-lg font-semibold">
                    {data.totalCommissions.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Total earned</p>
                  <p className="mt-1 text-lg font-semibold text-success">
                    {format(data.totalEarnedCad, "CAD")}
                  </p>
                </div>
              </div>
            </div>

            {(data.linkError || data.backfillError) && (
              <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      Account sync needs attention
                    </p>
                    <p className="text-muted-foreground">
                      {data.linkError ?? data.backfillError}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {data.allocationWarning && (
          <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-warning">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium">
              Highest total allocation is {data.totalAllocated.toFixed(1)}%.
              CEO remainder may go negative until the split is adjusted.
            </span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList variant="line" className="w-full justify-start gap-2 border-b border-border/50 px-0 pb-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="commissions">Commissions</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="controls">Controls</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {lifetimeError ? (
              <Card className="border-warning/30 bg-warning/10">
                <CardContent className="flex gap-3 pt-6">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                  <div>
                    <p className="font-medium">Portal stats are unavailable right now</p>
                    <p className="text-sm text-muted-foreground">{lifetimeError}</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <LifetimeHeaderCards
                  data={lifetimeQuery.data}
                  isLoading={lifetimeQuery.isLoading}
                />
                <EarningsSummaryCard
                  data={lifetimeQuery.data}
                  isLoading={lifetimeQuery.isLoading}
                />
              </>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
              <div className="space-y-6">
                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Commissions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!data.recentCommissions.length ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No commissions recorded yet.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Their cut</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.recentCommissions.slice(0, 6).map((commission) => (
                            <TableRow key={commission.id}>
                              <TableCell className="font-medium">
                                {formatShortDate(commission.conversionDate)}
                              </TableCell>
                              <TableCell>
                                {format(commission.affiliateCut, commission.currency)}
                              </TableCell>
                              <TableCell>
                                <CommissionStatusBadge status={commission.status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="text-lg">Attendance Snapshot</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {attendanceError ? (
                      <p className="text-sm text-muted-foreground">{attendanceError}</p>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                            <p className="text-xs text-muted-foreground">
                              This month
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {attendanceQuery.data?.pagination.total ?? 0}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                            <p className="text-xs text-muted-foreground">
                              Started eligibility
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {attendanceQuery.data?.hasEverSubmitted ? "Yes" : "No"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                            <p className="text-xs text-muted-foreground">
                              Last recorded
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {lastAttendance ? lastAttendance.date : "None"}
                            </p>
                          </div>
                        </div>

                        {!attendanceQuery.data?.data.length ? (
                          <p className="text-sm text-muted-foreground">
                            No attendance records in the selected month yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {attendanceQuery.data.data.slice(0, 5).map((record) => (
                              <div
                                key={record.id}
                                className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2"
                              >
                                <div>
                                  <p className="text-sm font-medium">
                                    {formatAttendanceDate(record.date)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatAttendanceTime(record.submittedAt)}
                                  </p>
                                </div>
                                <div className="max-w-[210px] text-right text-xs text-muted-foreground">
                                  {record.note ?? record.timezone}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      Portal Snapshot
                      <InfoTip>
                        This mirrors the managed affiliate&apos;s portal-facing
                        state: rates, link health, preferred display currency,
                        and whether the history is still in onboarding mode.
                      </InfoTip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Linked account</span>
                      <span className="max-w-[220px] truncate text-right font-medium">
                        {data.rewardfulEmail ?? "Not linked"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Backfill state</span>
                      <span className="font-medium">
                        {data.backfillStatus.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Rate mode</span>
                      <span className="font-medium">
                        {data.ratesLocked ? "Forward only" : "Retroactive while onboarding"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Preferred currency</span>
                      <span className="font-medium">{data.preferredCurrency}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Joined portal</span>
                      <span className="font-medium">
                        {formatShortDate(data.createdAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      Relationship Snapshot
                      <InfoTip>
                        Teacher counts come from active pairings above this
                        affiliate. Student counts mirror the teacher dashboard
                        tree beneath them.
                      </InfoTip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Teachers above</p>
                        <p className="mt-1 text-lg font-semibold">
                          {data.teachers.length}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Direct students</p>
                        <p className="mt-1 text-lg font-semibold">
                          {directStudentCount}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">
                          Indirect students
                        </p>
                        <p className="mt-1 text-lg font-semibold">
                          {indirectStudentCount}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">
                          Teacher access
                        </p>
                        <p className="mt-1 text-lg font-semibold">
                          {data.canBeTeacher ? "Enabled" : "Disabled"}
                        </p>
                      </div>
                    </div>

                    {data.teachers.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Teachers above this affiliate
                        </p>
                        {data.teachers.map((teacher) => (
                          <div
                            key={teacher.teacherId}
                            className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2"
                          >
                            <span className="text-sm">{teacher.teacherName}</span>
                            <span className="text-xs text-muted-foreground">
                              {teacher.cutPercent}% at depth {teacher.depth}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="commissions" className="space-y-6">
            {lifetimeError ? (
              <Card className="border-warning/30 bg-warning/10">
                <CardContent className="flex gap-3 pt-6">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                  <div>
                    <p className="font-medium">Lifetime stats unavailable</p>
                    <p className="text-sm text-muted-foreground">{lifetimeError}</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <LifetimeHeaderCards
                  data={lifetimeQuery.data}
                  isLoading={lifetimeQuery.isLoading}
                />
                <EarningsSummaryCard
                  data={lifetimeQuery.data}
                  isLoading={lifetimeQuery.isLoading}
                />
              </>
            )}

            <Card>
              <CardContent className="flex flex-wrap gap-3 pt-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value ?? "all");
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="EARNED">Earned</SelectItem>
                      <SelectItem value="PAID">Paid</SelectItem>
                      <SelectItem value="FORFEITED">Forfeited</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="VOIDED">Voided</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setPage(1);
                  }}
                  className="w-auto"
                />
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setPage(1);
                  }}
                  className="w-auto"
                />
                {(statusFilter !== "all" || fromDate || toDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStatusFilter("all");
                      setFromDate("");
                      setToDate("");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">
                  {commissionsQuery.data?.pagination.total ?? 0} commission
                  {(commissionsQuery.data?.pagination.total ?? 0) === 1 ? "" : "s"}
                </CardTitle>
                {commissionsPageTotal > 0 && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <DollarSign className="h-4 w-4 text-success" />
                    <span className="font-semibold text-success">
                      {format(commissionsPageTotal, currency)}
                    </span>
                    <span className="text-muted-foreground">on this page</span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {commissionsQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-12 w-full" />
                    ))}
                  </div>
                ) : commissionsError ? (
                  <p className="text-sm text-muted-foreground">{commissionsError}</p>
                ) : !commissionsQuery.data?.data.length ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <DollarSign className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    <p>No commissions found</p>
                    <p className="mt-1 text-xs">
                      Adjust the filters or wait for new commissions to arrive.
                    </p>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Their Cut</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {commissionsQuery.data.data.map((commission) => {
                          const earnedBadge = getEarnedBadge(commission.upstreamState);
                          return (
                          <TableRow key={commission.id}>
                            <TableCell>
                              <div className="font-medium">
                                {formatConversionDate(commission.conversionDate)}
                              </div>
                              {commission.status === "EARNED" &&
                                commission.upstreamState !== "due" &&
                                commission.upstreamDueAt && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Releases {formatShortDate(commission.upstreamDueAt)}
                                  </p>
                                )}
                              {commission.campaignName && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {commission.campaignName}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  commission.status === "FORFEITED"
                                    ? "text-error line-through"
                                    : "font-semibold"
                                }
                              >
                                {format(
                                  Number(commission.affiliateCut),
                                  commission.currency
                                )}
                              </span>
                            </TableCell>
                            <TableCell>
                              {commission.status === "EARNED" ? (
                                <Badge
                                  variant="default"
                                  className={earnedBadge.className}
                                >
                                  {earnedBadge.label}
                                </Badge>
                              ) : (
                                <CommissionStatusBadge status={commission.status} />
                              )}
                              {friendlyForfeitureReason(commission.forfeitureReason) && (
                                <p className="mt-1 text-xs text-muted-foreground capitalize">
                                  {friendlyForfeitureReason(commission.forfeitureReason)}
                                </p>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                        })}
                      </TableBody>
                    </Table>

                    {commissionsQuery.data.pagination.totalPages > 1 && (
                      <div className="mt-4 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Page {commissionsQuery.data.pagination.page} of{" "}
                          {commissionsQuery.data.pagination.totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((value) => value - 1)}
                            disabled={page <= 1}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((value) => value + 1)}
                            disabled={
                              page >= commissionsQuery.data.pagination.totalPages
                            }
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
          </TabsContent>

          <TabsContent value="attendance" className="space-y-6">
            <Card className="border-border/60">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Attendance</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Read-only view of the managed affiliate&apos;s attendance history.
                  </p>
                </div>
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="w-auto"
                />
              </CardHeader>
            </Card>

            {!attendanceQuery.data?.hasEverSubmitted && !attendanceQuery.isLoading && (
              <Card className="border-warning/30 bg-warning/10">
                <CardContent className="flex gap-3 pt-6">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                  <div className="space-y-1">
                    <p className="font-medium">
                      This affiliate hasn&apos;t started attendance yet
                    </p>
                    <p className="text-sm text-muted-foreground">
                      If a commission lands on a day without attendance after
                      eligibility starts, the affiliate&apos;s cut is forfeited.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-lg">Calendar</CardTitle>
                </CardHeader>
                <CardContent>
                  {attendanceError ? (
                    <p className="text-sm text-muted-foreground">{attendanceError}</p>
                  ) : (
                    <>
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">This month</p>
                          <p className="mt-1 text-lg font-semibold">
                            {attendanceQuery.data?.pagination.total ?? 0}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">Last day logged</p>
                          <p className="mt-1 text-sm font-semibold">
                            {lastAttendance?.date ?? "None"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">Latest note</p>
                          <p className="mt-1 text-sm font-semibold">
                            {lastAttendance?.note ?? "No note"}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-7 gap-1 text-center text-xs">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                          <div
                            key={day}
                            className="py-1.5 font-medium text-muted-foreground"
                          >
                            {day}
                          </div>
                        ))}
                        {calendarDays.map((day, index) => {
                          if (day === null) return <div key={`empty-${index}`} />;

                          const dateStr = `${monthWindow.year}-${String(monthWindow.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                          const hasAttendance = attendanceDates.has(dateStr);
                          const isToday = dateStr === today;
                          const isFuture = today ? dateStr > today : false;

                          return (
                            <div
                              key={dateStr}
                              className={`relative flex h-9 items-center justify-center rounded-md text-sm ${
                                isToday ? "ring-1 ring-primary font-bold" : ""
                              } ${
                                hasAttendance
                                  ? "bg-primary/20 text-primary font-medium"
                                  : ""
                              } ${
                                isFuture ? "text-muted-foreground/40" : ""
                              } ${
                                !hasAttendance && !isFuture && !isToday
                                  ? "text-muted-foreground"
                                  : ""
                              }`}
                            >
                              {day}
                              {hasAttendance && (
                                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-primary/20 ring-1 ring-primary/40" />
                          Submitted
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-primary" />
                          Today
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-lg">History</CardTitle>
                </CardHeader>
                <CardContent>
                  {attendanceQuery.isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : attendanceError ? (
                    <p className="text-sm text-muted-foreground">{attendanceError}</p>
                  ) : !attendanceQuery.data?.data.length ? (
                    <p className="text-sm text-muted-foreground">
                      No attendance records for this month.
                    </p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Note</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {attendanceQuery.data.data.map((record) => (
                            <TableRow key={record.id}>
                              <TableCell className="font-medium">
                                {formatAttendanceDate(record.date)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatAttendanceTime(record.submittedAt)}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate text-muted-foreground">
                                {record.note ?? record.timezone}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {attendanceQuery.data.pagination.total} record
                        {attendanceQuery.data.pagination.total === 1 ? "" : "s"} this
                        month
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="students" className="space-y-6">
            {studentsError ? (
              <Card className="border-warning/30 bg-warning/10">
                <CardContent className="flex gap-3 pt-6">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                  <div>
                    <p className="font-medium">Students unavailable right now</p>
                    <p className="text-sm text-muted-foreground">{studentsError}</p>
                  </div>
                </CardContent>
              </Card>
            ) : studentsQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-44 w-full" />
                ))}
              </div>
            ) : (
              <>
                <Card className="border-border/60">
                  <CardContent className="pt-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Teacher Summary
                          </p>
                          <InfoTip>
                            This mirrors the teacher-facing student area, but adds
                            admin-only archive and restore controls so you can safely
                            move students without losing payout history.
                          </InfoTip>
                        </div>
                        <p className="mt-1 text-3xl font-bold tracking-tight text-success">
                          {format(studentGrandTotals?.totalUnpaidCad ?? 0, "CAD")}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Due now {format(studentGrandTotals?.totalDueCad ?? 0, "CAD")} |
                          In holding {format(studentGrandTotals?.totalPendingCad ?? 0, "CAD")} |
                          Paid {format(studentGrandTotals?.totalPaidCad ?? 0, "CAD")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Active roster {format(studentGrandTotals?.activeUnpaidCad ?? 0, "CAD")} |
                          Previous students {format(studentGrandTotals?.archivedUnpaidCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 self-start">
                        <AdminPairStudentDialog
                          teacherId={affiliateId}
                          previousStudents={previousStudents}
                          onRestoreInstead={setStudentToRestore}
                          onSuccess={invalidateWorkspace}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => studentsQuery.refetch()}
                          disabled={studentsQuery.isFetching}
                          className="gap-2"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${studentsQuery.isFetching ? "animate-spin" : ""}`}
                          />
                          {studentsQuery.isFetching ? "Refreshing..." : "Refresh"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Total unpaid</p>
                        <p className="mt-1 text-lg font-semibold text-success">
                          {format(studentGrandTotals?.totalUnpaidCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Due now</p>
                        <p className="mt-1 text-lg font-semibold text-info">
                          {format(studentGrandTotals?.totalDueCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">In holding</p>
                        <p className="mt-1 text-lg font-semibold">
                          {format(studentGrandTotals?.totalPendingCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Direct unpaid</p>
                        <p className="mt-1 text-lg font-semibold">
                          {format(studentGrandTotals?.directUnpaidCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Indirect unpaid</p>
                        <p className="mt-1 text-lg font-semibold">
                          {format(studentGrandTotals?.indirectUnpaidCad ?? 0, "CAD")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Previous unpaid</p>
                        <p className="mt-1 text-lg font-semibold">
                          {format(studentGrandTotals?.archivedUnpaidCad ?? 0, "CAD")}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Visible students</p>
                        <p className="mt-1 text-lg font-semibold">
                          {totalVisibleStudents}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Direct students</p>
                        <p className="mt-1 text-lg font-semibold">
                          {directStudentCount}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Indirect students</p>
                        <p className="mt-1 text-lg font-semibold">
                          {indirectStudentCount}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Previous students</p>
                        <p className="mt-1 text-lg font-semibold">
                          {previousStudentCount}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant="default"
                        className="bg-muted/20 text-muted-foreground border-border/60"
                      >
                        Teacher proposals {studentsData?.canProposeRates ? "enabled" : "disabled"}
                      </Badge>
                      <Badge
                        variant="default"
                        className="bg-muted/20 text-muted-foreground border-border/60"
                      >
                        Teacher self-serve access {studentsData?.canBeTeacher ? "enabled" : "disabled"}
                      </Badge>
                      {previousStudentCount > 0 && (
                        <span>
                          Previous students keep moving from holding to paid even while
                          they are off the live roster.
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {orphanedSubStudents.length > 0 && (
                  <Card className="border-warning/30 bg-warning/10">
                    <CardContent className="flex gap-3 pt-6">
                      <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                      <div>
                        <p className="font-medium">Indirect student repair needed</p>
                        <p className="text-sm text-muted-foreground">
                          {orphanedSubStudents.length} indirect student
                          {orphanedSubStudents.length === 1 ? "" : "s"} appear without
                          an active direct parent link in the current tree.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {!directStudentCount ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                      <p className="text-muted-foreground">
                        {previousStudentCount > 0
                          ? "No active students are linked right now. Archived payout history is still tracked below."
                          : "No active students are linked under this affiliate yet."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold">Active Students</h3>
                      <p className="text-sm text-muted-foreground">
                        These are the live student relationships currently contributing
                        to this affiliate&apos;s teacher totals.
                      </p>
                    </div>
                    {studentsData?.directStudents.map((student) => (
                      <ManagedStudentCard
                        key={`${student.relationshipId}:${student.relationshipSequence}`}
                        student={student}
                        format={format}
                        onViewDetail={setSelectedStudent}
                        onArchive={setStudentToArchive}
                      />
                    ))}
                  </div>
                )}

                {previousStudentCount > 0 && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <History className="h-4 w-4 text-muted-foreground" />
                        Previous Students
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Archived students stay here so already-earned payouts keep
                        progressing safely. Restoring one lets you choose whether to
                        grant none, some, or all missed-gap income.
                      </p>
                    </div>
                    <div className="space-y-4">
                      {previousStudents.map((student) => (
                        <ManagedPreviousStudentCard
                          key={`${student.archiveId}:${student.relationshipSequence}`}
                          student={student}
                          format={format}
                          onViewDetail={setSelectedStudent}
                          onRestore={setStudentToRestore}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="controls" className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_380px]">
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Percent className="h-5 w-5 text-primary" />
                    Commission Controls
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {data.ratesLocked ? (
                    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Lock className="h-4 w-4 text-primary" />
                            <p className="font-medium">History locked</p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Rate changes now apply to new commissions only. Existing
                            earned and paid rows stay frozen.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnlockDialogOpen(true)}
                        >
                          Unlock
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <LockOpen className="h-4 w-4 text-warning" />
                            <p className="font-medium">Onboarding mode</p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Rate changes re-price unpaid commissions until you lock
                            history.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={lockMutation.isPending}
                          onClick={() => lockMutation.mutate(true)}
                        >
                          Lock history
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                      <p className="text-xs text-muted-foreground">Current initial</p>
                      <p className="mt-1 text-2xl font-bold text-primary">
                        {data.initialCommissionPercent}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                      <p className="text-xs text-muted-foreground">Current recurring</p>
                      <p className="mt-1 text-2xl font-bold text-primary">
                        {data.recurringCommissionPercent}%
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="new-initial">New initial (%)</Label>
                      <Input
                        id="new-initial"
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder={String(data.initialCommissionPercent)}
                        value={newInitialRate}
                        onChange={(event) => setNewInitialRate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-recurring">New recurring (%)</Label>
                      <Input
                        id="new-recurring"
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder={String(data.recurringCommissionPercent)}
                        value={newRecurringRate}
                        onChange={(event) => setNewRecurringRate(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate-reason">Reason (optional)</Label>
                    <Input
                      id="rate-reason"
                      placeholder="Performance adjustment, correction, onboarding fix..."
                      value={rateReason}
                      onChange={(event) => setRateReason(event.target.value)}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {data.ratesLocked
                      ? "Saving now affects new commissions only."
                      : "Saving now re-prices unpaid commissions using the event's initial or recurring classification."}
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
                    {updateMutation.isPending ? "Saving..." : "Update Rates"}
                  </Button>

                  {data.pendingRateNotSetCount > 0 && (
                    <>
                      <Separator />
                      <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                          <div className="space-y-2">
                            <p className="text-sm">
                              <span className="font-medium">
                                {data.pendingRateNotSetCount} pending commission
                                {data.pendingRateNotSetCount === 1 ? "" : "s"}
                              </span>{" "}
                              were imported before rates were configured.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              disabled={
                                !data.ratesConfigured || recalcMutation.isPending
                              }
                              onClick={() => recalcMutation.mutate()}
                            >
                              <RefreshCw className="h-3 w-3" />
                              {recalcMutation.isPending
                                ? "Re-pricing..."
                                : "Re-price unpaid"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={syncPaidMutation.isPending}
                    onClick={() => syncPaidMutation.mutate()}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${syncPaidMutation.isPending ? "animate-spin" : ""}`}
                    />
                    {syncPaidMutation.isPending ? "Syncing..." : "Sync paid state"}
                  </Button>

                  <Separator />

                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">Allocation breakdown</p>
                      <InfoTip>
                        This shows the highest active allocation path: affiliate
                        cut plus active teacher cuts above them.
                      </InfoTip>
                    </div>
                    <div className="space-y-2 text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Affiliate cut (initial)</span>
                        <span>{data.initialCommissionPercent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Affiliate cut (recurring)</span>
                        <span>{data.recurringCommissionPercent}%</span>
                      </div>
                      {data.teachers.map((teacher) => (
                        <div key={teacher.teacherId} className="flex justify-between">
                          <span>
                            {teacher.teacherName} (depth {teacher.depth})
                          </span>
                          <span>{teacher.cutPercent}%</span>
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

              <div className="space-y-6">
                <Card className="border-border/60">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Shield className="h-5 w-5 text-primary" />
                      Account Controls
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Rate proposal access</p>
                        <p className="text-xs text-muted-foreground">
                          Allow this affiliate to propose rate changes as a teacher.
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

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Teacher access</p>
                        <p className="text-xs text-muted-foreground">
                          When on, this affiliate can be paired to students and build
                          a teacher tree.
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

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">Linked account</p>
                        <InfoTip>
                          The upstream link is anchored by affiliate ID, not the
                          portal email. Changing the portal email alone does not move
                          history.
                        </InfoTip>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {data.rewardfulEmail ??
                          (data.rewardfulAffiliateId
                            ? "Affiliate ID linked with no stored email"
                            : "No affiliate account linked yet")}
                      </p>
                      {data.rewardfulAffiliateId && (
                        <p className="break-all rounded-xl border border-border/50 bg-muted/20 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          {data.rewardfulAffiliateId}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setReplaceLinkDialogOpen(true)}
                      >
                        {data.rewardfulAffiliateId
                          ? "Replace linked account"
                          : "Link account"}
                      </Button>
                      {!data.rewardfulAffiliateId && (
                        <Button
                          variant="outline"
                          className="gap-2"
                          onClick={() => retryLinkMutation.mutate()}
                          disabled={retryLinkMutation.isPending}
                        >
                          <Link2 className="h-4 w-4" />
                          {retryLinkMutation.isPending
                            ? "Retrying..."
                            : "Retry auto-link"}
                        </Button>
                      )}
                    </div>

                    <Separator />

                    {data.status === "ACTIVE" ? (
                      <Button
                        variant="outline"
                        className="w-full text-error border-error/30 hover:bg-error/10"
                        onClick={() => setDeactivateDialogOpen(true)}
                      >
                        <UserX className="mr-2 h-4 w-4" />
                        Deactivate affiliate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => updateMutation.mutate({ status: "ACTIVE" })}
                        disabled={updateMutation.isPending}
                      >
                        Reactivate affiliate
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <AdminPromoCodes affiliateId={affiliateId} />
              </div>
            </div>

            {data.rateHistory.length > 0 && (
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <History className="h-5 w-5 text-primary" />
                    Rate history
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Previous</TableHead>
                        <TableHead>New</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Changed by</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rateHistory.map((entry) => {
                        const isLockEvent = entry.field === "LOCK";
                        return (
                          <TableRow key={entry.id}>
                            <TableCell className="text-muted-foreground">
                              {formatShortDate(entry.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="default"
                                className={
                                  entry.field === "INITIAL"
                                    ? "bg-primary/15 text-primary border-primary/30"
                                    : entry.field === "RECURRING"
                                      ? "bg-info/15 text-info border-info/30"
                                      : "bg-muted/30 text-muted-foreground border-muted/40"
                                }
                              >
                                {entry.field === "INITIAL"
                                  ? "Initial"
                                  : entry.field === "RECURRING"
                                    ? "Recurring"
                                    : entry.field === "LOCK"
                                      ? "Lock"
                                      : "Legacy"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isLockEvent ? "-" : `${entry.previousPercent}%`}
                            </TableCell>
                            <TableCell className="font-medium">
                              {isLockEvent ? "-" : `${entry.newPercent}%`}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="default"
                                className={
                                  entry.appliedMode === "RETROACTIVE"
                                    ? "bg-warning/15 text-warning border-warning/30"
                                    : entry.appliedMode === "FORWARD_ONLY"
                                      ? "bg-success/15 text-success border-success/30"
                                      : "bg-muted/30 text-muted-foreground border-muted/40"
                                }
                              >
                                {entry.appliedMode === "RETROACTIVE"
                                  ? "Retroactive"
                                  : entry.appliedMode === "FORWARD_ONLY"
                                    ? "Forward only"
                                    : entry.appliedMode === "LOCK"
                                      ? "Locked"
                                      : "Unlocked"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {entry.changedBy}
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate text-muted-foreground">
                              {entry.reason ?? "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unlock rate history?</DialogTitle>
              <DialogDescription>
                Unlocking returns this affiliate to onboarding mode. The next
                rate change can re-price all unpaid commissions retroactively.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUnlockDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={lockMutation.isPending}
                onClick={() => {
                  lockMutation.mutate(false);
                  setUnlockDialogOpen(false);
                }}
              >
                Unlock history
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={replaceLinkDialogOpen}
          onOpenChange={(open) => {
            setReplaceLinkDialogOpen(open);
            if (!open) {
              setReplaceLinkIdentifier("");
              setReplaceLinkConfirmText("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {data.rewardfulAffiliateId ? "Replace linked account" : "Link account"}
              </DialogTitle>
              <DialogDescription>
                Use this only when the wrong affiliate account was linked to the
                portal user. The portal identity, rates, attendance, and teacher
                relationships stay the same while imported commissions are replaced.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="replace-link-id">Replacement email or affiliate ID</Label>
                <Input
                  id="replace-link-id"
                  value={replaceLinkIdentifier}
                  onChange={(event) => setReplaceLinkIdentifier(event.target.value)}
                  placeholder="name@example.com or affiliate id"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="replace-link-confirm">Type REPLACE to confirm</Label>
                <Input
                  id="replace-link-confirm"
                  value={replaceLinkConfirmText}
                  onChange={(event) => setReplaceLinkConfirmText(event.target.value)}
                  placeholder="REPLACE"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                This does not merge two histories. It replaces the linked account
                on this user and re-imports from the new source.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setReplaceLinkDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !replaceLinkIdentifier.trim() ||
                  replaceLinkConfirmText.trim().toUpperCase() !== "REPLACE" ||
                  replaceLinkMutation.isPending
                }
                onClick={() => replaceLinkMutation.mutate()}
              >
                {replaceLinkMutation.isPending ? "Replacing..." : "Replace link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deactivateDialogOpen}
          onOpenChange={setDeactivateDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deactivate affiliate</DialogTitle>
              <DialogDescription>
                This will deactivate {data.name ?? data.email} and disable their
                active teacher-student relationships.
              </DialogDescription>
            </DialogHeader>

            {data.students.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Students directly affected</p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {data.students.map((student) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between rounded border border-border/50 px-3 py-2 text-sm"
                    >
                      <span>{student.name ?? student.email}</span>
                      <span className="text-muted-foreground">
                        {student.teacherCut}% cut
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
                variant="destructive"
                disabled={updateMutation.isPending}
                onClick={() => {
                  updateMutation.mutate({ status: "DEACTIVATED" });
                  setDeactivateDialogOpen(false);
                }}
              >
                Confirm deactivation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
