"use client";

import { ArrowDownUp, DollarSign, Filter } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { BackfillBanner } from "@/components/commissions/backfill-banner";
import { EarningsSummary } from "@/components/commissions/earnings-summary";
import { LifetimeHeader } from "@/components/commissions/lifetime-header";
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
import { useCurrency } from "@/providers/currency-provider";

interface Commission {
  id: string;
  affiliateCutPercent: string;
  affiliateCutCad: string;
  status: "EARNED" | "FORFEITED" | "PENDING";
  forfeitedToCeo: boolean;
  forfeitureReason: string | null;
  conversionDate: string;
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

function formatConversionDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const STATUS_CONFIG = {
  EARNED: {
    label: "Earned",
    variant: "default" as const,
    className: "bg-success/15 text-success border-success/30",
  },
  FORFEITED: {
    label: "Forfeited",
    variant: "default" as const,
    className: "bg-error/15 text-error border-error/30",
  },
  PENDING: {
    label: "Pending",
    variant: "default" as const,
    className: "bg-warning/15 text-warning border-warning/30",
  },
};

export default function CommissionsPage() {
  const { currency, toggle, format, stale } = useCurrency();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", "20");
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (fromDate) queryParams.set("from", fromDate);
  if (toDate) queryParams.set("to", toDate);

  const { data, isLoading } = useQuery<CommissionResponse>({
    queryKey: ["commissions", page, statusFilter, fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(`/api/commissions?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch commissions");
      return res.json();
    },
  });

  const totalEarned =
    data?.data
      .filter((c) => c.status === "EARNED")
      .reduce((sum, c) => sum + Number(c.affiliateCutCad), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Commissions</h1>
          <p className="text-muted-foreground">
            Your commission history from conversions
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          className="flex items-center gap-2"
        >
          <ArrowDownUp className="h-4 w-4" />
          {currency}
          {stale && (
            <span className="text-xs text-warning" title="Using cached rate">
              (cached)
            </span>
          )}
        </Button>
      </div>

      <BackfillBanner />
      <LifetimeHeader />
      <EarningsSummary />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val ?? "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="EARNED">Earned</SelectItem>
                <SelectItem value="FORFEITED">Forfeited</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            placeholder="From"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            placeholder="To"
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

      {/* Commission List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            {data?.pagination.total ?? 0} Commission
            {data?.pagination.total !== 1 ? "s" : ""}
          </CardTitle>
          {totalEarned > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <DollarSign className="h-4 w-4 text-success" />
              <span className="font-semibold text-success">
                {format(totalEarned)}
              </span>
              <span className="text-muted-foreground">on this page</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !data?.data.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <DollarSign className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No commissions found</p>
              <p className="text-xs mt-1">
                Commissions will appear here when conversions come in
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Your Cut</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((commission) => {
                    const config = STATUS_CONFIG[commission.status];
                    return (
                      <TableRow key={commission.id}>
                        <TableCell>
                          <div className="font-medium">
                            {formatConversionDate(commission.conversionDate)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              commission.status === "FORFEITED"
                                ? "text-error line-through"
                                : "font-semibold"
                            }
                          >
                            {format(Number(commission.affiliateCutCad))}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {Number(commission.affiliateCutPercent)}%
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={config.variant}
                            className={config.className}
                          >
                            {config.label}
                          </Badge>
                          {commission.forfeitureReason && (
                            <p className="mt-1 text-xs text-error/70">
                              {commission.forfeitureReason}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data.pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {data.pagination.page} of {data.pagination.totalPages}
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
                      disabled={page >= data.pagination.totalPages}
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
