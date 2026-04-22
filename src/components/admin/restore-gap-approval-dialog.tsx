"use client";

import { AlertTriangle, CalendarClock, History, Wallet } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type RestoreBackfillMode = "NONE" | "ALL" | "CUSTOM";

export interface RestoreGapCommissionPreview {
  eventId: string;
  rewardfulCommissionId: string | null;
  conversionDate: string;
  campaignName: string | null;
  currency: "CAD" | "USD";
  currentState: "DUE_NOW" | "IN_HOLDING" | "PAID" | "VOIDED";
  releasesAt: string | null;
  paidAt: string | null;
  teacherCutPercent: number;
  grantAmountNative: number;
  grantAmountCad: number;
  canGrant: boolean;
  disabledReason: string | null;
}

export interface RestoreGapPreview {
  archiveId: string;
  relationshipId: string;
  teacherId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string;
  teacherName: string | null;
  teacherEmail: string;
  teacherCutPercent: number;
  archivedAt: string;
  archivedByRole: "ADMIN" | "TEACHER" | "SYSTEM";
  archiveReason: string | null;
  snapshot: {
    teacherUnpaidCad: number;
    teacherDueCad: number;
    teacherPendingCad: number;
    teacherPaidCad: number;
    nextDueAt: string | null;
    commissionCount: number;
  };
  gap: {
    totalCount: number;
    grantableCount: number;
    grantableCad: number;
    paidCad: number;
    dueCad: number;
    pendingCad: number;
  };
  commissions: RestoreGapCommissionPreview[];
  pendingRequest: {
    id: string;
    createdAt: string;
    requestNote: string | null;
    requestedById: string;
  } | null;
}

interface RestoreGapApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: RestoreGapPreview | null;
  pending?: boolean;
  title: string;
  description: string;
  submitLabel: string;
  format: (amount: number, inputCurrency?: "CAD" | "USD") => string;
  onSubmit: (payload: {
    backfillMode: RestoreBackfillMode;
    selectedEventIds: string[];
    reviewNote: string;
  }) => void;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStateBadge(state: RestoreGapCommissionPreview["currentState"]) {
  switch (state) {
    case "DUE_NOW":
      return {
        label: "Due now",
        className: "bg-info/15 text-info border-info/30",
      };
    case "PAID":
      return {
        label: "Paid",
        className: "bg-success/15 text-success border-success/30",
      };
    case "VOIDED":
      return {
        label: "Voided",
        className: "bg-destructive/15 text-destructive border-destructive/30",
      };
    default:
      return {
        label: "In holding",
        className: "bg-warning/15 text-warning border-warning/30",
      };
  }
}

function getArchiveActorLabel(role: RestoreGapPreview["archivedByRole"]) {
  switch (role) {
    case "ADMIN":
      return "admin action";
    case "TEACHER":
      return "teacher action";
    default:
      return "system action";
  }
}

function RestoreGapApprovalDialogPanel({
  onOpenChange,
  preview,
  pending = false,
  title,
  description,
  submitLabel,
  format,
  onSubmit,
}: Omit<RestoreGapApprovalDialogProps, "open">) {
  const [backfillMode, setBackfillMode] = useState<RestoreBackfillMode>("NONE");
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [reviewNote, setReviewNote] = useState("");

  const grantableItems = useMemo(
    () => preview?.commissions.filter((item) => item.canGrant) ?? [],
    [preview]
  );

  const grantableIds = useMemo(
    () => grantableItems.map((item) => item.eventId),
    [grantableItems]
  );

  const effectiveSelectedIds = useMemo(() => {
    if (backfillMode === "ALL") return grantableIds;
    if (backfillMode === "NONE") return [];
    const allowed = new Set(grantableIds);
    return selectedEventIds.filter((id) => allowed.has(id));
  }, [backfillMode, grantableIds, selectedEventIds]);

  const selectedGrantCad = useMemo(() => {
    const selected = new Set(effectiveSelectedIds);
    return grantableItems.reduce(
      (sum, item) => (selected.has(item.eventId) ? sum + item.grantAmountCad : sum),
      0
    );
  }, [effectiveSelectedIds, grantableItems]);

  const canSubmit =
    !!preview &&
    !pending &&
    (backfillMode !== "CUSTOM" ||
      grantableItems.length === 0 ||
      effectiveSelectedIds.length > 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {!preview ? (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
          Restore details are still loading.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border/60 bg-muted/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {preview.studentName ?? preview.studentEmail}
                </p>
                <p className="text-xs text-muted-foreground">
                  Removed {formatShortDate(preview.archivedAt)} by{" "}
                  {getArchiveActorLabel(preview.archivedByRole)}
                </p>
              </div>
              <Badge
                variant="default"
                className="bg-primary/15 text-primary border-primary/30"
              >
                {preview.teacherCutPercent}% teacher share
              </Badge>
            </div>
            {preview.archiveReason && (
              <p className="mt-3 text-sm text-muted-foreground">
                {preview.archiveReason}
              </p>
            )}
            {preview.pendingRequest && (
              <div className="mt-3 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
                <p className="font-medium text-info">Teacher already asked for this return</p>
                <p className="mt-1 text-muted-foreground">
                  Requested {formatShortDate(preview.pendingRequest.createdAt)}
                  {preview.pendingRequest.requestNote
                    ? `: ${preview.pendingRequest.requestNote}`
                    : "."}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" />
                Snapshot at removal
              </div>
              <p className="mt-3 text-2xl font-semibold">
                {format(preview.snapshot.teacherUnpaidCad, "CAD")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Due now {format(preview.snapshot.teacherDueCad, "CAD")} | In holding{" "}
                {format(preview.snapshot.teacherPendingCad, "CAD")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Paid {format(preview.snapshot.teacherPaidCad, "CAD")} across{" "}
                {preview.snapshot.commissionCount} commission
                {preview.snapshot.commissionCount === 1 ? "" : "s"}
              </p>
            </div>

            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CalendarClock className="h-4 w-4 text-warning" />
                Missed while archived
              </div>
              <p className="mt-3 text-2xl font-semibold">
                {format(preview.gap.grantableCad, "CAD")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {preview.gap.grantableCount} grantable commission
                {preview.gap.grantableCount === 1 ? "" : "s"} out of{" "}
                {preview.gap.totalCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Due now {format(preview.gap.dueCad, "CAD")} | In holding{" "}
                {format(preview.gap.pendingCad, "CAD")} | Paid{" "}
                {format(preview.gap.paidCad, "CAD")}
              </p>
            </div>

            <div className="rounded-2xl border border-border/50 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-primary" />
                Add back on restore
              </div>
              <p className="mt-3 text-2xl font-semibold text-primary">
                {format(selectedGrantCad, "CAD")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {effectiveSelectedIds.length} commission
                {effectiveSelectedIds.length === 1 ? "" : "s"} selected
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose none, all, or a custom set before approving the return.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 p-4">
            <div className="space-y-2">
              <Label htmlFor="restore-grant-mode">Grant option</Label>
              <Select
                value={backfillMode}
                onValueChange={(value) =>
                  setBackfillMode(value as RestoreBackfillMode)
                }
              >
                <SelectTrigger id="restore-grant-mode">
                  <SelectValue placeholder="Choose what to grant back" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Grant none</SelectItem>
                  <SelectItem value="ALL">Grant all missed commissions</SelectItem>
                  <SelectItem value="CUSTOM">Choose specific commissions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              {backfillMode === "NONE"
                ? "The student will be active again, but archived-gap commissions stay excluded from this teacher."
                : backfillMode === "ALL"
                ? "Every grantable commission from the archived gap will be added back using the original teacher share."
                : "Pick exactly which archived-gap commissions should be granted back to this teacher."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="restore-review-note">Admin note (optional)</Label>
            <textarea
              id="restore-review-note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Explain why you're granting none, some, or all."
              className="min-h-[92px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Archived-gap commissions</p>
                <p className="text-xs text-muted-foreground">
                  These are the commissions that came in after removal and before this
                  return.
                </p>
              </div>
              <Badge
                variant="default"
                className="bg-muted/20 text-muted-foreground border-border/60"
              >
                {preview.commissions.length} item
                {preview.commissions.length === 1 ? "" : "s"}
              </Badge>
            </div>

            {!preview.commissions.length ? (
              <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
                No commissions landed during the archived gap.
              </div>
            ) : (
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {preview.commissions.map((commission) => {
                  const state = getStateBadge(commission.currentState);
                  const checked = effectiveSelectedIds.includes(commission.eventId);
                  const customDisabled =
                    backfillMode !== "CUSTOM" || !commission.canGrant;

                  return (
                    <label
                      key={commission.eventId}
                      className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors ${
                        checked
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/50 bg-muted/10"
                      } ${commission.canGrant ? "" : "opacity-70"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={customDisabled}
                        onChange={() => {
                          if (customDisabled) return;
                          setSelectedEventIds((current) =>
                            checked
                              ? current.filter((id) => id !== commission.eventId)
                              : [...current, commission.eventId]
                          );
                        }}
                        className="mt-1 h-4 w-4 rounded border-border bg-transparent accent-current"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">
                            {formatShortDate(commission.conversionDate)}
                          </p>
                          <Badge variant="default" className={state.className}>
                            {state.label}
                          </Badge>
                          {!commission.canGrant && (
                            <Badge
                              variant="default"
                              className="bg-muted/20 text-muted-foreground border-border/60"
                            >
                              Not grantable
                            </Badge>
                          )}
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {commission.campaignName ?? "Campaign unavailable"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Teacher share {commission.teacherCutPercent}% | Potential add-back{" "}
                          {format(commission.grantAmountCad, "CAD")}
                        </p>

                        {commission.paidAt && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Paid {formatShortDate(commission.paidAt)}
                          </p>
                        )}
                        {!commission.paidAt && commission.releasesAt && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Release date {formatShortDate(commission.releasesAt)}
                          </p>
                        )}

                        {commission.disabledReason && (
                          <div className="mt-2 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2 text-xs text-muted-foreground">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />
                            <span>{commission.disabledReason}</span>
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {backfillMode === "CUSTOM" &&
              grantableItems.length > 0 &&
              effectiveSelectedIds.length === 0 && (
                <p className="text-xs text-warning">
                  Choose at least one grantable commission, or switch the grant option
                  to &quot;Grant none.&quot;
                </p>
              )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onSubmit({
              backfillMode,
              selectedEventIds: effectiveSelectedIds,
              reviewNote: reviewNote.trim(),
            })
          }
          disabled={!canSubmit}
        >
          {pending ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RestoreGapApprovalDialog(props: RestoreGapApprovalDialogProps) {
  const resetKey = props.open ? props.preview?.archiveId ?? "loading" : "closed";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <RestoreGapApprovalDialogPanel key={resetKey} {...props} />
      </DialogContent>
    </Dialog>
  );
}
