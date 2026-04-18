"use client";

import { CalendarCheck, Clock, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface AttendanceRecord {
  id: string;
  date: string;
  timezone: string;
  note: string | null;
  submittedAt: string;
}

interface AttendanceResponse {
  data: AttendanceRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function getLocalDate() {
  const now = new Date();
  return now.toLocaleDateString("en-CA"); // YYYY-MM-DD format
}

function getTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function AttendancePage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Calculate date range for selected month
  const [fromDate, toDate] = (() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return [from, to];
  })();

  const { data, isLoading } = useQuery<AttendanceResponse>({
    queryKey: ["attendance", userId, fromDate, toDate],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance?from=${fromDate}&to=${toDate}&limit=100`
      );
      if (!res.ok) throw new Error("Failed to fetch attendance");
      return res.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: {
      date: string;
      timezone: string;
      note?: string;
    }) => {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to submit attendance");
      }
      return res.json();
    },
    onSuccess: (result) => {
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      if (result.reevaluatedCommissions > 0) {
        toast.success(
          `Attendance submitted! ${result.reevaluatedCommissions} commission(s) restored.`
        );
        queryClient.invalidateQueries({ queryKey: ["commissions"] });
      } else {
        toast.success("Attendance submitted successfully");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = useCallback(() => {
    submitMutation.mutate({
      date: getLocalDate(),
      timezone: getTimezone(),
      note: note.trim() || undefined,
    });
  }, [note, submitMutation]);

  // Defer client-only values to avoid SSR hydration mismatch
  const [today, setToday] = useState("");
  const [timezone, setTimezone] = useState("");
  useEffect(() => {
    setToday(getLocalDate());
    setTimezone(getTimezone());
  }, []);

  // Build calendar data
  const attendanceDates = new Set(data?.data.map((r) => r.date) ?? []);

  // Generate calendar grid for the month
  const [calYear, calMonth] = selectedMonth.split("-").map(Number);
  const firstDayOfMonth = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
        <p className="text-muted-foreground">
          Submit your daily marketing activity to stay eligible for commissions
        </p>
      </div>

      {/* Submit Today's Attendance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" />
            Submit Today&apos;s Attendance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CalendarCheck className="h-4 w-4" />
            <span>{today ? formatDate(today) : "\u00A0"}</span>
            <span className="text-border">|</span>
            <Clock className="h-4 w-4" />
            <span>{timezone || "\u00A0"}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Activity note (optional)</Label>
            <Input
              id="note"
              placeholder="What marketing activities did you do today?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="w-full sm:w-auto"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Attendance"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Calendar View */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Calendar</CardTitle>
            <Input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-auto"
            />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="py-1.5 font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;

                const dateStr = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const hasAttendance = attendanceDates.has(dateStr);
                const isToday = dateStr === today;
                const isFuture = dateStr > today;

                return (
                  <div
                    key={dateStr}
                    className={`
                      relative flex h-9 items-center justify-center rounded-md text-sm
                      ${isToday ? "ring-1 ring-primary font-bold" : ""}
                      ${hasAttendance ? "bg-primary/20 text-primary font-medium" : ""}
                      ${isFuture ? "text-muted-foreground/40" : ""}
                      ${!hasAttendance && !isFuture && !isToday ? "text-muted-foreground" : ""}
                    `}
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
          </CardContent>
        </Card>

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !data?.data.length ? (
              <p className="text-sm text-muted-foreground">
                No attendance records for this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        {formatDate(record.date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatTime(record.submittedAt)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {record.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {data && data.pagination.total > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                {data.pagination.total} record{data.pagination.total !== 1 ? "s" : ""} this month
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
