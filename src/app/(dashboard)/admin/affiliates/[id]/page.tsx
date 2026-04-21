"use client";

import { use } from "react";

import { ManagedAffiliateWorkspace } from "@/components/admin/managed-affiliate-workspace";

export default function AffiliateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return <ManagedAffiliateWorkspace affiliateId={id} />;
}
