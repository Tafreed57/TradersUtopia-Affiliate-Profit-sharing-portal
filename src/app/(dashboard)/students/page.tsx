"use client";

import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Plus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

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
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";

interface Student {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  commissionPercent: number;
  status: string;
  depth: number;
  teacherCutPercent: number;
  teacherUnpaidCad: number;
  teacherPaidCad: number;
  conversionCount: number;
  attendanceDaysThisMonth: number;
  dataStale: boolean;
  dataReason:
    | "ok"
    | "stale-cache"
    | "timeout"
    | "error"
    | "not-linked";
  fetchedAt: string | null;
}

interface DirectStudent extends Student {
  subStudents: Student[];
}

interface GrandTotals {
  totalUnpaidCad: number;
  directUnpaidCad: number;
  indirectUnpaidCad: number;
  totalPaidCad: number;
}

interface StudentsResponse {
  directStudents: DirectStudent[];
  orphanedSubStudents?: Student[];
  grandTotals: GrandTotals;
  isTeacher: boolean;
  canBeTeacher: boolean;
}

interface UserResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface DetailCommission {
  id: string;
  conversionDate: string;
  teacherCutCad: number;
  status: string;
  forfeitureReason: string | null;
  paidAt: string | null;
}

interface DetailAttendance {
  id: string;
  date: string;
  timezone: string;
  note: string | null;
}

interface StudentDetailResponse {
  student: { id: string; name: string | null; email: string; image: string | null };
  teacherCutPercent: number;
  teacherUnpaidCad: number;
  teacherPaidCad: number;
  dataStale: boolean;
  dataReason:
    | "ok"
    | "stale-cache"
    | "timeout"
    | "error"
    | "not-linked";
  fetchedAt: string | null;
  commissions: DetailCommission[];
  attendance: DetailAttendance[];
  commissionTotal: number;
  attendanceTotal: number;
  commissionHasMore: boolean;
  attendanceHasMore: boolean;
}

function StudentDetailSheet({
  student,
  onClose,
  format,
}: {
  student: Student | null;
  onClose: () => void;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
}) {
  const { data, isLoading } = useQuery<StudentDetailResponse>({
    queryKey: ["student-detail", student?.id],
    queryFn: async () => {
      const res = await fetch(`/api/students/${student!.id}/detail`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!student,
  });

  const totalDueNow = data?.teacherUnpaidCad ?? 0;
  const totalPaid = data?.teacherPaidCad ?? 0;

  return (
    <Sheet open={!!student} onOpenChange={(open) => { if (!open) onClose(); }}>
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
                <SheetDescription className="truncate">{student.email}</SheetDescription>
              )}
            </div>
          </div>

          {data && (
            <div className="flex gap-5 pb-4 text-sm">
              <div>
                <p className="font-semibold text-success">{format(totalDueNow, "CAD")}</p>
                <p className="text-xs text-muted-foreground">Unpaid</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">{format(totalPaid)}</p>
                <p className="text-xs text-muted-foreground">Paid</p>
              </div>
              <div>
                <p className="font-semibold">{data.commissionTotal}</p>
                <p className="text-xs text-muted-foreground">Conversions</p>
              </div>
              <div>
                <p className="font-semibold">{data.attendanceTotal}</p>
                <p className="text-xs text-muted-foreground">Attendance</p>
              </div>
              <div>
                <p className="font-semibold">{data.teacherCutPercent}%</p>
                <p className="text-xs text-muted-foreground">Your rate</p>
              </div>
            </div>
          )}
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
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

            <TabsContent value="commissions" className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {!data?.commissions.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No commissions yet
                </p>
              ) : (
                data.commissions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(c.conversionDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      {c.status === "PAID" && c.paidAt && (
                        <p className="text-xs text-muted-foreground">
                          Paid {new Date(c.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                      {c.forfeitureReason && (
                        <p className="text-xs capitalize text-muted-foreground">
                          {c.forfeitureReason.replace(/_/g, " ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${
                          c.status === "EARNED" ? "text-success" : "text-muted-foreground"
                        }`}
                      >
                        {format(c.teacherCutCad)}
                      </span>
                      <Badge
                        variant="default"
                        className={
                          c.status === "EARNED"
                            ? "bg-success/15 text-success border-success/30"
                            : c.status === "PAID"
                            ? "bg-info/15 text-info border-info/30"
                            : c.status === "FORFEITED"
                            ? "bg-error/15 text-error border-error/30"
                            : "bg-warning/15 text-warning border-warning/30"
                        }
                      >
                        {c.status === "PAID" ? "Paid" : c.status === "EARNED" ? "Due" : c.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
              {data?.commissionHasMore && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Showing most recent {data.commissions.length} of {data.commissionTotal}
                </p>
              )}
            </TabsContent>

            <TabsContent value="attendance" className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {!data?.attendance.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No attendance records yet
                </p>
              ) : (
                data.attendance.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{a.date}</p>
                      <p className="text-xs text-muted-foreground">{a.timezone}</p>
                    </div>
                    {a.note && (
                      <p className="max-w-[140px] truncate text-xs text-muted-foreground">
                        {a.note}
                      </p>
                    )}
                  </div>
                ))
              )}
              {data?.attendanceHasMore && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Showing most recent {data.attendance.length} of {data.attendanceTotal}
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
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

function AddStudentDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [cut, setCut] = useState("");

  const { data: searchResults, isFetching } = useQuery<{ data: UserResult[] }>({
    queryKey: ["user-search", search],
    queryFn: async () => {
      const res = await fetch(
        `/api/users/search?q=${encodeURIComponent(search)}`
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: search.length >= 2,
  });

  const proposeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/students/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selected!.id,
          proposedCut: Number(cut),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to submit");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Proposal submitted — pending admin approval");
      setOpen(false);
      setSearch("");
      setSelected(null);
      setCut("");
      onSuccess();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSubmit = useCallback(() => {
    const n = Number(cut);
    if (!selected) return;
    if (isNaN(n) || n < 0 || n > 100) {
      toast.error("Cut must be between 0 and 100");
      return;
    }
    proposeMutation.mutate();
  }, [selected, cut, proposeMutation]);

  function resetDialog() {
    setSearch("");
    setSelected(null);
    setCut("");
  }

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Student
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetDialog();
        }}
      >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose a Student</DialogTitle>
          <DialogDescription>
            Search for a portal user, set your proposed cut, and submit for
            admin approval. Commissions only flow once approved.
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
                <div className="rounded-md border border-border max-h-48 overflow-y-auto">
                  {isFetching ? (
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
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors"
                      >
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={u.image ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(u.name, u.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">
                            {u.name ?? u.email}
                          </p>
                          {u.name && (
                            <p className="text-xs text-muted-foreground">
                              {u.email}
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
                    {getInitials(selected.name, selected.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {selected.name ?? selected.email}
                  </p>
                  {selected.name && (
                    <p className="text-xs text-muted-foreground truncate">
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
                <Label htmlFor="cut">Your proposed cut (%)</Label>
                <Input
                  id="cut"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="e.g. 10"
                  value={cut}
                  onChange={(e) => setCut(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  This is a proposal — admin must approve before it takes effect.
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
            onClick={handleSubmit}
            disabled={!selected || !cut || proposeMutation.isPending}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {proposeMutation.isPending ? "Submitting…" : "Submit Proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

export default function StudentsPage() {
  const { format } = useCurrency();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const isAdmin = session?.user?.isAdmin === true;
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<StudentsResponse>({
    queryKey: ["students", userId],
    queryFn: async () => {
      const res = await fetch("/api/students");
      if (!res.ok) throw new Error("Failed to fetch students");
      return res.json();
    },
  });

  const directStudents = data?.directStudents ?? [];
  const orphanedSubStudents = data?.orphanedSubStudents ?? [];
  const grandTotals = data?.grandTotals;
  // Count both nested sub-students (under a direct parent) AND orphaned ones
  // (depth-2 relationships whose direct-parent link is missing). grandTotals
  // .indirectUnpaidCad aggregates over both, so indirectCount must too —
  // otherwise a teacher whose only indirect earnings come from orphans would
  // have their sub-students progress bar hidden despite a nonzero total.
  const indirectCount =
    directStudents.reduce((n, s) => n + s.subStudents.length, 0) +
    orphanedSubStudents.length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StudentDetailSheet
        student={selectedStudent}
        onClose={() => setSelectedStudent(null)}
        format={format}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Students</h1>
          <p className="text-muted-foreground">
            {data?.isTeacher
              ? `${directStudents.length} direct student${directStudents.length !== 1 ? "s" : ""}${indirectCount > 0 ? `, ${indirectCount} indirect` : ""}`
              : data?.canBeTeacher || isAdmin
              ? "Propose students for admin approval"
              : ""}
          </p>
        </div>
        {(data?.canBeTeacher || isAdmin) && (
          <AddStudentDialog
            onSuccess={() =>
              queryClient.invalidateQueries({ queryKey: ["students"] })
            }
          />
        )}
      </div>

      {data?.isTeacher && grandTotals && (
        <GrandTotalSummary
          totals={grandTotals}
          indirectCount={indirectCount}
          format={format}
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
        />
      )}

      {!data?.isTeacher && directStudents.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {data?.canBeTeacher || isAdmin
                ? 'No active students yet. Use "Add Student" to submit a proposal.'
                : "You don't have any students."}
            </p>
          </CardContent>
        </Card>
      )}

      {directStudents.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Your Students</h2>
          <div className="space-y-4">
            {directStudents.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                format={format}
                onProposalSubmitted={() =>
                  queryClient.invalidateQueries({ queryKey: ["students"] })
                }
                onViewDetail={() => setSelectedStudent(student)}
                onSubStudentClick={(sub) => setSelectedStudent(sub)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GrandTotalSummary({
  totals,
  indirectCount,
  format,
  onRefresh,
  isRefreshing,
}: {
  totals: GrandTotals;
  indirectCount: number;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const denom = totals.totalUnpaidCad > 0 ? totals.totalUnpaidCad : 1;
  const directPct = Math.min(100, (totals.directUnpaidCad / denom) * 100);
  const indirectPct = Math.min(100, (totals.indirectUnpaidCad / denom) * 100);
  // Hide the "your students' students" bar when there aren't any — showing
  // an empty $0 bar implies the teacher is missing earnings that never
  // existed.
  const showIndirect = indirectCount > 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total Unpaid
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-success">
              {format(totals.totalUnpaidCad, "CAD")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across all students · {format(totals.totalPaidCad)} lifetime paid
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2 self-start"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Your students</span>
              <span className="font-medium">
                {format(totals.directUnpaidCad, "CAD")}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-success transition-all"
                style={{ width: `${directPct}%` }}
              />
            </div>
          </div>
          {showIndirect && (
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Your students&apos; students
                </span>
                <span className="font-medium">
                  {format(totals.indirectUnpaidCad, "CAD")}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-info transition-all"
                  style={{ width: `${indirectPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StudentCard({
  student,
  format,
  onProposalSubmitted,
  onViewDetail,
  onSubStudentClick,
}: {
  student: DirectStudent;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onProposalSubmitted: () => void;
  onViewDetail: () => void;
  onSubStudentClick: (sub: Student) => void;
}) {
  const [proposedRate, setProposedRate] = useState(
    String(student.teacherCutPercent)
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const subCount = student.subStudents.length;
  const subUnpaid = student.subStudents.reduce(
    (s, sub) => s + sub.teacherUnpaidCad,
    0
  );

  const proposalMutation = useMutation({
    mutationFn: async (proposedPercent: number) => {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, proposedPercent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to submit proposal");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rate proposal submitted for review");
      setDialogOpen(false);
      onProposalSubmitted();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSubmitProposal = useCallback(() => {
    const rate = Number(proposedRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }
    proposalMutation.mutate(rate);
  }, [proposedRate, proposalMutation]);

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/30"
      onClick={onViewDetail}
    >
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={student.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm">
              {getInitials(student.name, student.email)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">
              {student.name ?? student.email}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {student.email}
            </p>
          </div>

          {student.dataStale && (
            <Badge
              variant="default"
              className="gap-1 bg-warning/15 text-warning border-warning/30"
              title={
                student.dataReason === "timeout"
                  ? "Could not refresh — showing last known value"
                  : student.dataReason === "error"
                  ? "Refresh failed — showing last known value"
                  : "Using cached value"
              }
            >
              <AlertTriangle className="h-3 w-3" />
              Stale
            </Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <DollarSign className="mx-auto mb-1 h-4 w-4 text-success" />
            <p className="text-sm font-semibold">
              {format(student.teacherUnpaidCad, "CAD")}
            </p>
            <p className="text-xs text-muted-foreground">Unpaid</p>
          </div>
          <div>
            <Users className="mx-auto mb-1 h-4 w-4 text-info" />
            <p className="text-sm font-semibold">{student.conversionCount}</p>
            <p className="text-xs text-muted-foreground">Conversions</p>
          </div>
          <div>
            <CalendarCheck className="mx-auto mb-1 h-4 w-4 text-warning" />
            <p className="text-sm font-semibold">
              {student.attendanceDaysThisMonth}
            </p>
            <p className="text-xs text-muted-foreground">Attendance</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
            <div className="text-xs text-muted-foreground">
              Your rate:{" "}
              <span className="font-medium text-foreground">
                {student.teacherCutPercent}%
              </span>
            </div>

            <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
              >
                <Send className="h-3 w-3" />
                Propose Rate
              </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Propose New Rate</DialogTitle>
                  <DialogDescription>
                    Propose a new cut for {student.name ?? student.email}. An
                    admin must approve before it takes effect.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <div className="text-sm text-muted-foreground">
                    Current rate: {student.teacherCutPercent}%
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rate">New rate (%)</Label>
                    <Input
                      id="rate"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={proposedRate}
                      onChange={(e) => setProposedRate(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitProposal}
                    disabled={proposalMutation.isPending}
                  >
                    {proposalMutation.isPending
                      ? "Submitting…"
                      : "Submit Proposal"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

        {subCount > 0 && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <span className="flex items-center gap-2">
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {subCount} student{subCount !== 1 ? "s" : ""}&apos; student
                {subCount !== 1 ? "s" : ""}
              </span>
              <span className="font-medium text-foreground">
                {format(subUnpaid, "CAD")}
              </span>
            </button>
            {expanded && (
              <div className="mt-3 space-y-2">
                {student.subStudents.map((sub) => (
                  <SubStudentRow
                    key={sub.id}
                    sub={sub}
                    format={format}
                    onClick={() => onSubStudentClick(sub)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubStudentRow({
  sub,
  format,
  onClick,
}: {
  sub: Student;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="group flex w-full items-center gap-3 rounded-lg border border-border/40 px-3 py-2 text-left transition-colors hover:bg-accent/30"
    >
      <Avatar className="h-8 w-8">
        <AvatarImage src={sub.image ?? undefined} />
        <AvatarFallback className="bg-info/10 text-info text-xs">
          {getInitials(sub.name, sub.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {sub.name ?? sub.email}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {sub.conversionCount} conversions · {sub.attendanceDaysThisMonth}
          {" "}attendance · {sub.teacherCutPercent}% your rate
        </p>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-semibold text-success">
          {format(sub.teacherUnpaidCad, "CAD")}
        </span>
        {sub.dataStale && (
          <span
            className="flex items-center gap-0.5 text-[10px] text-warning"
            title={
              sub.dataReason === "timeout"
                ? "Could not refresh — showing last known value"
                : "Using cached value"
            }
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Stale
          </span>
        )}
      </div>
    </button>
  );
}
