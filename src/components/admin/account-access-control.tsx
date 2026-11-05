"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AccessAccount {
  id: string;
  name: string | null;
  email: string;
  status: string;
  accountType: "COMMISSION" | "WORK";
  canDeactivate: boolean;
}

interface AccessPreview {
  canDeactivate: boolean;
  students: Array<{
    relationshipId: string;
    id: string;
    name: string | null;
    email: string;
    depth: number;
  }>;
}

/** The same confirmed access change is available in the list and the workspace. */
export function AccountAccessControl({
  affiliate,
  adminId,
  compact = false,
}: {
  affiliate: AccessAccount;
  adminId: string | undefined;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const deactivating = affiliate.status === "ACTIVE";
  const protectedAccount = affiliate.id === adminId || !affiliate.canDeactivate;
  const name = affiliate.name ?? affiliate.email;
  const preview = useQuery<AccessPreview>({
    queryKey: ["admin-account-access-preview", adminId, affiliate.id],
    enabled: open && deactivating && !!adminId && !protectedAccount,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/admin/affiliates/${affiliate.id}`);
      if (!response.ok) throw new Error("Could not load account details. Please try again.");
      return response.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/affiliates/${affiliate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: deactivating ? "DEACTIVATED" : "ACTIVE" }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Could not update account access. Please try again.");
      }
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success(deactivating ? `Access removed for ${name}` : `Access restored for ${name}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-affiliate-workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-account-access-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["students"] }),
      ]);
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        className={deactivating ? "text-error border-error/30 hover:bg-error/10" : undefined}
        disabled={!adminId || (deactivating && protectedAccount)}
        title={deactivating && protectedAccount ? "Administrator accounts cannot be deactivated here" : undefined}
        aria-label={`${deactivating ? "Deactivate" : "Reactivate"} ${name}`}
        onClick={() => { mutation.reset(); setOpen(true); }}
      >
        {deactivating && <UserX className="h-4 w-4" />}
        {deactivating ? "Deactivate" : "Reactivate"}
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!mutation.isPending) setOpen(nextOpen); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>{deactivating ? "Deactivate account" : "Reactivate account"}</DialogTitle>
            <DialogDescription>
              {deactivating
                ? "Remove this person's access to the portal."
                : "Allow this person to sign in to the portal again."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/60 px-3 py-2">
            <p className="font-medium break-words">{name}</p>
            <p className="text-sm text-muted-foreground break-all">{affiliate.email}</p>
          </div>
          {deactivating ? (
            <div className="space-y-3 text-sm">
              <p>Google and password sign-in will be blocked. Existing sessions will lose access on their next request.</p>
              <p className="text-muted-foreground">Their account, commission history, and attendance records will be kept. You can restore account access later.</p>
              {affiliate.accountType === "COMMISSION" && (
                <p className="text-muted-foreground">Their teacher and student links will be disabled. Students keep their own accounts and access, and will not be reassigned automatically. Review their assignments separately in Manage.</p>
              )}
              {preview.isFetching ? <p role="status">Checking linked students...</p> : preview.isError ? (
                <div role="alert" className="space-y-2 text-error">
                  <p>{preview.error.message}</p>
                  <Button variant="outline" size="sm" onClick={() => { void preview.refetch(); }}>Try again</Button>
                </div>
              ) : preview.data && !preview.data.canDeactivate ? (
                <p role="alert" className="text-error">This administrator account cannot be deactivated here.</p>
              ) : affiliate.accountType === "COMMISSION" && preview.data ? (
                <div className="space-y-2">
                  <p className="font-medium">Linked students ({preview.data.students.length})</p>
                  {preview.data.students.length === 0 ? (
                    <p className="text-muted-foreground">No active student links.</p>
                  ) : (
                    <ul className="max-h-48 space-y-2 overflow-y-auto">
                      {preview.data.students.map((student) => (
                        <li key={student.relationshipId} className="rounded border border-border/50 px-3 py-2">
                          <p className="font-medium break-words">{student.name ?? student.email}</p>
                          <p className="text-xs text-muted-foreground break-all">{student.email}</p>
                          <p className="text-xs text-muted-foreground">{student.depth === 1 ? "Direct student" : "Second-level student"}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ) : affiliate.accountType === "COMMISSION" ? (
            <p className="text-sm text-muted-foreground">Previous teacher and student links stay disabled until you restore or reassign them separately.</p>
          ) : null}
          {mutation.isError && <p role="alert" className="text-sm text-error">{mutation.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={deactivating ? "destructive" : "default"}
              disabled={mutation.isPending || (deactivating && (protectedAccount || preview.isFetching || !preview.data?.canDeactivate || preview.isError))}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving..." : deactivating ? "Deactivate and remove access" : "Restore access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
