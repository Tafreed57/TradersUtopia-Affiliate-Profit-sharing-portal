"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AffiliateGroup {
  id: string;
  name: string;
  color: string;
  memberCount: number;
}

export interface AffiliateGroupsResponse {
  data: AffiliateGroup[];
  ungroupedCount: number;
}

const PALETTE = [
  { name: "Amber", color: "#F59E0B" },
  { name: "Coral", color: "#F87171" },
  { name: "Rose", color: "#F472B6" },
  { name: "Violet", color: "#A78BFA" },
  { name: "Blue", color: "#60A5FA" },
  { name: "Teal", color: "#2DD4BF" },
  { name: "Green", color: "#4ADE80" },
  { name: "Slate", color: "#94A3B8" },
];

export function GroupColorDot({ color }: { color?: string }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full border border-foreground/20" style={{ backgroundColor: color ?? "#94A3B8" }} />;
}

export function AffiliateGroupSelect({ groups, value, onValueChange, label, disabled, currentName }: {
  groups: AffiliateGroup[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  currentName?: string;
}) {
  const selectedGroup = groups.find((group) => group.id === value);
  return (
    <Select value={value} onValueChange={(next) => { if (next !== null) onValueChange(next); }} disabled={disabled}>
      <SelectTrigger className="w-44 max-w-full" aria-label={label}>
        <SelectValue>{value ? <><GroupColorDot color={selectedGroup?.color} /><span className="truncate">{value === "ungrouped" ? "Ungrouped" : selectedGroup?.name ?? currentName ?? "Choose group"}</span></> : "Choose group"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ungrouped"><GroupColorDot />Ungrouped</SelectItem>
        {groups.map((group) => <SelectItem key={group.id} value={group.id}><GroupColorDot color={group.color} /><span className="truncate">{group.name}</span></SelectItem>)}
      </SelectContent>
    </Select>
  );
}

async function writeGroup(path: string, method: string, body?: unknown) {
  const res = await fetch(`/api/admin/affiliate-groups${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(result.error ?? "Could not update affiliate groups. Please try again.");
  return result;
}

export function assignAffiliatesToGroup(affiliateIds: string[], groupId: string | null) {
  return writeGroup("/assign", "PATCH", { affiliateIds, groupId });
}

function GroupEditor({
  group, onClose, onSaved, onDelete,
}: {
  group: AffiliateGroup | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete: (group: AffiliateGroup) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState(group?.color ?? PALETTE[0].color);
  const validColor = /^#[0-9a-f]{6}$/i.test(color);
  const mutation = useMutation({
    mutationFn: () => writeGroup(group ? `/${group.id}` : "", group ? "PATCH" : "POST", { name: name.trim(), color }),
    onSuccess: async () => {
      await onSaved();
      toast.success(group ? "Group updated" : "Group created");
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "Create group"}</DialogTitle>
          <DialogDescription>Choose a name and color for this admin-only group.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (name.trim() && validColor) mutation.mutate(); }}>
          <div className="space-y-2">
            <Label htmlFor="affiliate-group-name">Group name</Label>
            <Input id="affiliate-group-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required autoFocus placeholder="e.g. Live session team" disabled={mutation.isPending} />
          </div>
          <fieldset className="space-y-3" disabled={mutation.isPending}>
            <legend className="text-sm font-medium">Group color</legend>
            <div className="flex flex-wrap gap-2" aria-label="Color palette">
              {PALETTE.map((swatch) => (
                <button key={swatch.color} type="button" aria-label={`${swatch.name} color`} aria-pressed={color.toUpperCase() === swatch.color} onClick={() => setColor(swatch.color)} className="grid size-8 place-items-center rounded-full border border-foreground/20 text-black outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" style={{ backgroundColor: swatch.color }}>
                  {color.toUpperCase() === swatch.color && <Check className="size-4" aria-hidden="true" />}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="affiliate-group-color">Custom color (hex)</Label>
              <div className="flex items-center gap-3">
                <input aria-label="Choose a custom group color" type="color" value={validColor ? color : "#94A3B8"} onChange={(event) => setColor(event.target.value.toUpperCase())} className="size-9 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5" />
                <Input id="affiliate-group-color" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} maxLength={7} pattern="#[0-9A-Fa-f]{6}" required aria-invalid={!validColor} aria-describedby="affiliate-group-color-hint" className="font-mono" />
              </div>
              <p id="affiliate-group-color-hint" className="text-xs text-muted-foreground">Use a six-digit color, such as #F59E0B.</p>
            </div>
          </fieldset>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
            <GroupColorDot color={validColor ? color : undefined} />
            <span className="break-all font-medium">{name.trim() || "Group preview"}</span>
          </div>
          {mutation.error && <p role="alert" className="text-sm text-error">{mutation.error.message}</p>}
          <DialogFooter>
            {group && <Button type="button" variant="ghost" className="mr-auto text-error" disabled={mutation.isPending} onClick={() => onDelete(group)}><Trash2 className="mr-1.5 size-4" />Delete group</Button>}
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || !validColor || mutation.isPending}>{mutation.isPending ? "Saving…" : group ? "Save group" : "Create group"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AffiliateGroups({
  adminId, groups, ungroupedCount, activeFilter, onFilterChange, loading, error, onRetry,
}: {
  adminId: string | undefined;
  groups: AffiliateGroup[];
  ungroupedCount: number;
  activeFilter: string;
  onFilterChange: (groupId: string) => void;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<AffiliateGroup | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<AffiliateGroup | null>(null);
  const refreshGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-affiliate-groups", adminId] }),
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates", adminId] }),
    ]);
  };
  const deleteMutation = useMutation({
    mutationFn: (group: AffiliateGroup) => writeGroup(`/${group.id}`, "DELETE"),
    onSuccess: async (_, group) => {
      if (activeFilter === group.id) onFilterChange("all");
      await refreshGroups();
      setDeleting(null);
      toast.success("Group deleted. Its members are now Ungrouped.");
    },
  });
  const allCount = groups.reduce((total, group) => total + group.memberCount, ungroupedCount);
  const filters = [
    { id: "all", name: "All", color: undefined, memberCount: allCount },
    { id: "ungrouped", name: "Ungrouped", color: "#94A3B8", memberCount: ungroupedCount },
    ...groups,
  ];

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Affiliate groups</h3>
          <p className="mt-1 text-xs text-muted-foreground">Visible only to admins. Each affiliate belongs to one group.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!adminId} onClick={() => setEditor(null)}><Plus className="mr-1.5 size-4" />New group</Button>
      </div>
      {loading ? <Skeleton className="h-9 w-full" /> : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-error">Could not load groups.<Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry groups</Button></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter affiliates by group">
            {filters.map((group) => (
              <div key={group.id} className={`inline-flex min-w-0 max-w-full items-stretch rounded-lg border ${activeFilter === group.id ? "border-foreground/50 bg-accent" : "border-border/60 bg-background/40"}`}>
                <button type="button" aria-pressed={activeFilter === group.id} onClick={() => onFilterChange(group.id)} className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  {group.id !== "all" && <GroupColorDot color={group.color} />}
                  <span className="break-all text-left">{group.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{group.memberCount}</span>
                </button>
                {group.id !== "all" && group.id !== "ungrouped" && <button type="button" aria-label={`Edit ${group.name} group`} onClick={() => setEditor(group as AffiliateGroup)} className="shrink-0 rounded-r-lg border-l border-border/60 px-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><Pencil className="size-3.5" aria-hidden="true" /></button>}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Group totals include all affiliates. Search, status, and account type filters apply to the list below.</p>
        </>
      )}
      {editor !== undefined && <GroupEditor key={editor?.id ?? "new"} group={editor} onClose={() => setEditor(undefined)} onSaved={refreshGroups} onDelete={(group) => { setEditor(undefined); deleteMutation.reset(); setDeleting(group); }} />}
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleting(null); }}>
        <DialogContent showCloseButton={!deleteMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>All members of this group will move to Ungrouped. Their accounts and account settings will stay the same.</DialogDescription>
          </DialogHeader>
          {deleteMutation.error && <p role="alert" className="text-sm text-error">{deleteMutation.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleteMutation.isPending} onClick={() => setDeleting(null)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={!deleting || deleteMutation.isPending} onClick={() => { if (deleting) deleteMutation.mutate(deleting); }}>{deleteMutation.isPending ? "Deleting…" : "Delete group"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
