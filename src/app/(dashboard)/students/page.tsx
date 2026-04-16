"use client";

import { CalendarCheck, DollarSign, Plus, Send, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
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
  teacherEarnedCad: number;
  conversionCount: number;
  attendanceDaysThisMonth: number;
}

interface StudentsResponse {
  students: Student[];
  isTeacher: boolean;
}

interface UserResult {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
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

  const { data, isLoading } = useQuery<StudentsResponse>({
    queryKey: ["students", userId],
    queryFn: async () => {
      const res = await fetch("/api/students");
      if (!res.ok) throw new Error("Failed to fetch students");
      return res.json();
    },
  });

  const directStudents = data?.students.filter((s) => s.depth === 1) ?? [];
  const indirectStudents = data?.students.filter((s) => s.depth === 2) ?? [];

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Students</h1>
          <p className="text-muted-foreground">
            {data?.isTeacher
              ? `${directStudents.length} direct student${directStudents.length !== 1 ? "s" : ""}${indirectStudents.length > 0 ? `, ${indirectStudents.length} indirect` : ""}`
              : "Propose students for admin approval"}
          </p>
        </div>
        <AddStudentDialog
          onSuccess={() =>
            queryClient.invalidateQueries({ queryKey: ["students"] })
          }
        />
      </div>

      {!data?.isTeacher && directStudents.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              No active students yet. Use &quot;Add Student&quot; to submit a
              proposal.
            </p>
          </CardContent>
        </Card>
      )}

      {directStudents.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Direct Students</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {directStudents.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                format={format}
                onProposalSubmitted={() =>
                  queryClient.invalidateQueries({ queryKey: ["students"] })
                }
              />
            ))}
          </div>
        </div>
      )}

      {indirectStudents.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Students&apos; Students
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {indirectStudents.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                format={format}
                onProposalSubmitted={() =>
                  queryClient.invalidateQueries({ queryKey: ["students"] })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StudentCard({
  student,
  format,
  onProposalSubmitted,
}: {
  student: Student;
  format: (cad: number) => string;
  onProposalSubmitted: () => void;
}) {
  const [proposedRate, setProposedRate] = useState(
    String(student.teacherCutPercent)
  );
  const [dialogOpen, setDialogOpen] = useState(false);

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
    <Card>
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

          <Badge
            variant="default"
            className={
              student.depth === 1
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-info/15 text-info border-info/30"
            }
          >
            {student.depth === 1 ? "Direct" : "Depth 2"}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <DollarSign className="mx-auto mb-1 h-4 w-4 text-success" />
            <p className="text-sm font-semibold">
              {format(student.teacherEarnedCad)}
            </p>
            <p className="text-xs text-muted-foreground">Your cut</p>
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

        {student.depth === 1 && (
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
                onClick={() => setDialogOpen(true)}
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
        )}
      </CardContent>
    </Card>
  );
}
