"use client";

import { Bell, Save, Shield, User } from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { requestNotificationPermission } from "@/lib/firebase-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  canProposeRates: boolean;
  preferredCurrency: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { currency, setCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof window === "undefined") return "default";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  });

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["user-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch("/api/settings/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const saveMutation = useMutation({
    mutationFn: async (data: { preferredCurrency: string }) => {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      setCurrency(selectedCurrency as "CAD" | "USD");
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const notificationMutation = useMutation({
    mutationFn: async () => {
      const token = await requestNotificationPermission();
      const currentPermission =
        typeof window !== "undefined" && "Notification" in window
          ? Notification.permission
          : "default";
      setNotificationPermission(currentPermission);

      if (!token) {
        if (currentPermission === "denied") {
          throw new Error("Browser notifications are blocked for this site.");
        }
        throw new Error("Notifications could not be enabled on this device.");
      }

      const res = await fetch("/api/notifications/register-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, platform: "web" }),
      });
      if (!res.ok) {
        throw new Error("Failed to register this device for notifications.");
      }
    },
    onSuccess: () => {
      setNotificationPermission("granted");
      toast.success("Notifications enabled on this device");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account preferences
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-64" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <p className="font-medium">{profile?.name ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="font-medium">{profile?.email}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Member Since
                  </Label>
                  <p className="font-medium">
                    {profile?.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            month: "long",
                            year: "numeric",
                          }
                        )
                      : "—"}
                  </p>
                </div>
              </div>

              {profile && !profile.canProposeRates && (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  <Shield className="h-4 w-4" />
                  Rate proposal access has been revoked by an admin.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currency">Preferred Currency</Label>
            <Select
              value={selectedCurrency}
              onValueChange={(val) => {
                if (val) setSelectedCurrency(val);
              }}
            >
              <SelectTrigger className="w-[200px]" id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CAD">CAD — Canadian Dollar</SelectItem>
                <SelectItem value="USD">USD — US Dollar</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Amounts will be displayed in your preferred currency using live
              exchange rates.
            </p>
          </div>

          <Separator />

          <Button
            onClick={() =>
              saveMutation.mutate({ preferredCurrency: selectedCurrency })
            }
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Preferences"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5 text-primary" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Push Notifications</Label>
            <p className="text-sm text-muted-foreground">
              {notificationPermission === "granted"
                ? "This device is enabled for push notifications."
                : notificationPermission === "denied"
                  ? "Notifications are blocked in this browser for the portal."
                  : notificationPermission === "unsupported"
                    ? "This browser does not support push notifications."
                    : "Enable push notifications on this device to receive alerts in real time."}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => notificationMutation.mutate()}
            disabled={
              notificationMutation.isPending ||
              notificationPermission === "unsupported" ||
              notificationPermission === "granted"
            }
            className="gap-2"
          >
            <Bell className="h-4 w-4" />
            {notificationPermission === "granted"
              ? "Notifications Enabled"
              : notificationMutation.isPending
                ? "Enabling..."
                : "Enable Notifications"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
