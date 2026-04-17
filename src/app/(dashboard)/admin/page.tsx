"use client";

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
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
  canProposeRates: boolean;
  rewardfulAffiliateId: string | null;
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

export default function AdminPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  if (search) queryParams.set("search", search);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);

  const { data: affiliatesData, isLoading: affiliatesLoading } =
    useQuery<AffiliatesResponse>({
      queryKey: ["admin-affiliates", page, search, statusFilter],
      queryFn: async () => {
        const res = await fetch(`/api/admin/affiliates?${queryParams}`);
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      },
    });

  const { data: proposalsData } = useQuery<{ data: Proposal[] }>({
    queryKey: ["admin-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/admin/proposals");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: teacherProposalsData } = useQuery<{ data: TeacherProposal[] }>({
    queryKey: ["admin-teacher-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/admin/teacher-proposals");
      if (!res.ok) throw new Error("Failed to fetch");
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

  const pendingProposals =
    proposalsData?.data.filter((p) => p.status === "PENDING") ?? [];
  const pendingTeacherProposals = teacherProposalsData?.data ?? [];
  const totalPending = pendingProposals.length + pendingTeacherProposals.length;

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

      {/* Pending Proposals Alert */}
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
              <div
                key={p.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  <strong>
                    {p.proposer.name ?? p.proposer.email}
                  </strong>{" "}
                  wants to change rate for{" "}
                  <strong>{p.student.name ?? p.student.email}</strong>:{" "}
                  {p.currentPercent}% → {p.proposedPercent}%
                </span>
                <Link href={`/admin/proposals`}>
                  <Button variant="outline" size="sm">
                    Review
                  </Button>
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
          {affiliatesLoading ? (
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
                    <TableHead>Rate</TableHead>
                    <TableHead>Conversions</TableHead>
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
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {affiliate.commissionPercent}%
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
