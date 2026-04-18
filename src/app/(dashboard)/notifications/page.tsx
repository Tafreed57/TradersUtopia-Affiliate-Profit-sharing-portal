"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Bell, Check, CheckCheck, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  data: Notification[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const TYPE_LABELS: Record<string, string> = {
  CONVERSION_RECEIVED: "Conversion",
  ATTENDANCE_FORFEITURE_ALERT: "Forfeiture",
  PROMO_CODE_REQUEST_RECEIVED: "Promo Request",
  PROMO_CODE_APPROVED: "Promo Approved",
  PROMO_CODE_REJECTED: "Promo Rejected",
  COMMISSION_RATE_CHANGED: "Rate Changed",
  NEW_STUDENT_LINKED: "New Student",
  AFFILIATE_DEACTIVATED: "Deactivated",
  RATE_PROPOSAL_SUBMITTED: "Proposal",
  RATE_PROPOSAL_APPROVED: "Proposal Approved",
  RATE_PROPOSAL_REJECTED: "Proposal Rejected",
};

export default function NotificationsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["notifications-page", userId, page, filter],
    enabled: !!userId,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (filter === "unread") params.set("unreadOnly", "true");
      const res = await fetch(`/api/notifications?${params}`);
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[] | "all") => {
      const body = ids === "all" ? { all: true } : { ids };
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            {data?.unreadCount
              ? `${data.unreadCount} unread`
              : "All caught up"}
          </p>
        </div>

        {data && data.unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markReadMutation.mutate("all")}
            disabled={markReadMutation.isPending}
            className="flex items-center gap-2"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={filter}
            onValueChange={(val) => {
              setFilter(val as "all" | "unread");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread only</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Notifications List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {data?.pagination.total ?? 0} Notification
            {data?.pagination.total !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !data?.data.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <Bell className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No notifications</p>
              <p className="mt-1 text-xs">
                {filter === "unread"
                  ? "No unread notifications"
                  : "Notifications will appear here as events happen"}
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y">
                {data.data.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 py-3 ${
                      n.read ? "opacity-60" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {n.body}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {TYPE_LABELS[n.type] ?? n.type}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                    {!n.read && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => markReadMutation.mutate([n.id])}
                        disabled={markReadMutation.isPending}
                        title="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

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
