"use client";

import { CalendarCheck, DollarSign, Send, Users } from "lucide-react";
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
  DialogTrigger,
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

  const directStudents =
    data?.students.filter((s) => s.depth === 1) ?? [];
  const indirectStudents =
    data?.students.filter((s) => s.depth === 2) ?? [];

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

  if (!data?.isTeacher) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Students</h1>
          <p className="text-muted-foreground">
            You don&apos;t have any students assigned yet.
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              Students will appear here once they are linked to your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Students</h1>
        <p className="text-muted-foreground">
          {directStudents.length} direct student
          {directStudents.length !== 1 ? "s" : ""}
          {indirectStudents.length > 0 &&
            `, ${indirectStudents.length} indirect`}
        </p>
      </div>

      {/* Direct Students */}
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

      {/* Indirect Students */}
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
        body: JSON.stringify({
          studentId: student.id,
          proposedPercent,
        }),
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
            <p className="text-sm font-semibold">
              {student.conversionCount}
            </p>
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
            Your rate: <span className="font-medium text-foreground">{student.teacherCutPercent}%</span>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <Send className="h-3 w-3" />
                Propose Rate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Propose New Rate</DialogTitle>
                <DialogDescription>
                  Propose a new commission rate for{" "}
                  {student.name ?? student.email}. An admin must approve the
                  change before it takes effect.
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
                  {proposalMutation.isPending ? "Submitting..." : "Submit Proposal"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
