"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { resolveNotificationHref } from "@/lib/notification-links";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data?: {
    href?: string;
  } | null;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof window === "undefined") return "default";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  });

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const syncPermission = () => {
      setNotificationPermission(Notification.permission);
    };

    document.addEventListener("visibilitychange", syncPermission);
    window.addEventListener("focus", syncPermission);

    return () => {
      document.removeEventListener("visibilitychange", syncPermission);
      window.removeEventListener("focus", syncPermission);
    };
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.data);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silently fail — bell just shows stale data
    }
  }, []);

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void fetchNotifications();
    }, 0);
    const interval = window.setInterval(() => {
      void fetchNotifications();
    }, 30_000);

    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
    };
  }, [fetchNotifications]);

  // Refresh when dropdown opens
  useEffect(() => {
    if (!open) return;
    const refresh = window.setTimeout(() => {
      void fetchNotifications();
    }, 0);

    return () => {
      window.clearTimeout(refresh);
    };
  }, [open, fetchNotifications]);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="relative inline-flex items-center justify-center rounded-md p-2 text-foreground hover:bg-muted">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>
        {notificationPermission === "denied" && (
          <div className="border-b bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
            Push alerts are blocked in this browser.{" "}
            <Link
              href="/settings"
              className="font-medium text-primary underline underline-offset-4"
            >
              Enable them in Settings
            </Link>
            .
          </div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-2 border-b px-3 py-2.5 last:border-0 ${
                  n.read ? "opacity-60" : "bg-muted/30"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">
                    {n.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {n.body}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <p>
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                    <Link
                      href={resolveNotificationHref(n.type, n.data)}
                      className="font-medium text-primary underline underline-offset-4"
                      onClick={() => {
                        if (!n.read) {
                          void markOneRead(n.id);
                        }
                      }}
                    >
                      Open
                    </Link>
                  </div>
                </div>
                {!n.read && (
                  <button
                    onClick={() => markOneRead(n.id)}
                    className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Mark as read"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
