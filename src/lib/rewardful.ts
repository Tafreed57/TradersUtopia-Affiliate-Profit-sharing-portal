/**
 * Rewardful API client — server-only.
 * Never import this file from client components.
 */

const API_KEY = process.env.REWARDFUL_API_KEY ?? "";
const BASE_URL =
  process.env.REWARDFUL_API_BASE_URL ?? "https://api.getrewardful.com/v1";

function headers(): HeadersInit {
  const encoded = Buffer.from(`${API_KEY}:`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Typed Rewardful error — callers can branch on `.status` instead of
 *  string-matching the error message. Preserves the original message
 *  shape for log compatibility. */
export class RewardfulApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, statusText: string, body: string) {
    super(`Rewardful API ${status}: ${statusText} — ${body}`);
    this.name = "RewardfulApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RewardfulApiError(res.status, res.statusText, text);
  }

  // 204 No Content (DELETE usually) + any genuinely empty body: don't
  // call res.json() because it throws on empty input. Callers that
  // expect void can still `await` this helper.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Types (match Rewardful API response shapes)
// ---------------------------------------------------------------------------

export interface RewardfulAffiliate {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
  visitors: number;
  leads: number;
  conversions: number;
  campaign?: { id: string; name: string };
  campaign_id?: string;
  links: { url: string; visitors: number }[];
  coupons: { id: string; code: string }[];
  commission_stats?: {
    total_commissions?: number;
    paid_commissions?: number;
    due_commissions?: number;
    unpaid_commissions?: number;
    currencies?: Record<
      string,
      {
        paid?: { cents: number };
        unpaid?: { cents: number };
        due?: { cents: number };
        total?: { cents: number };
        gross_revenue?: { cents: number };
        net_revenue?: { cents: number };
      }
    >;
  };
  created_at: string;
  updated_at: string;
}

export interface RewardfulCommission {
  id: string;
  amount: number;
  currency: string;
  state?: RewardfulCommissionState;
  due_at: string | null;
  paid_at: string | null;
  voided_at?: string | null;
  sale?: {
    id: string;
    currency: string;
    charged_at: string;
    refunded_at: string | null;
    sale_amount_cents: number;
    charge_amount_cents: number;
    refund_amount_cents: number;
    customer?: {
      id: string;
      email: string;
      name: string;
    };
    // Rewardful nests referral INSIDE sale (despite also exposing a
    // top-level `referral` field on some payload variants). The nested one
    // is the ground truth for webhook payloads.
    referral?: {
      id: string;
    };
  };
  referral?: {
    id: string;
    link?: { url: string };
    visitor?: { id: string };
  };
  campaign?: { id: string; name: string };
  created_at: string;
  updated_at: string;
}

export interface RewardfulReferral {
  id: string;
  affiliate: { id: string; email: string };
  link?: { url: string };
  visitor?: { id: string };
  conversion_state: string;
  customer?: { id: string; email: string; name: string };
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardfulCoupon {
  id: string;
  /** Discount token shown in checkout (e.g. "SPRING20"). Rewardful returns
   *  this on /coupons responses. Some older endpoints used `code`; we
   *  alias via helper below. */
  token?: string;
  code?: string;
  affiliate_id?: string;
  campaign_id?: string;
  campaign?: { id: string; name?: string } | null;
  leads?: number;
  conversions?: number;
  created_at?: string;
}

/** Returns the human-readable code for a coupon regardless of whether
 *  Rewardful returned it as `token` or `code`. */
export function couponCode(c: RewardfulCoupon): string {
  return c.token ?? c.code ?? "";
}

export interface RewardfulCampaign {
  id: string;
  created_at?: string;
  updated_at?: string;
  name: string;
  url: string;
  commission_type?: string;
  reward_type: "percent" | "amount";
  private: boolean;
  default: boolean;
  commission_percent: number;
  commission_amount_cents: number | null;
  commission_amount_currency: string | null;
  max_commission_period_months?: number | null;
  max_commissions?: number | null;
  days_before_referrals_expire?: number | null;
  days_until_commissions_are_due?: number | null;
  minimum_payout_cents?: number | null;
  minimum_payout_currency?: string | null;
  stripe_coupon_id: string | null;
  visitors?: number;
  leads?: number;
  conversions?: number;
  affiliates?: number;
}

export type RewardfulCommissionState =
  | "pending"
  | "due"
  | "paid"
  | "voided";

export interface RewardfulCommissionSnapshot {
  rewardfulCommissionId: string;
  state: RewardfulCommissionState | null;
  dueAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export function normalizeRewardfulCommissionState(
  value: unknown
): RewardfulCommissionState | null {
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  if (
    lowered === "pending" ||
    lowered === "due" ||
    lowered === "paid" ||
    lowered === "voided"
  ) {
    return lowered;
  }
  return null;
}

export function snapshotFromRewardfulCommission(
  commission: Pick<
    RewardfulCommission,
    "id" | "state" | "due_at" | "paid_at" | "voided_at" | "campaign"
  >
): RewardfulCommissionSnapshot {
  return {
    rewardfulCommissionId: commission.id,
    state: normalizeRewardfulCommissionState(commission.state),
    dueAt: commission.due_at ?? null,
    paidAt: commission.paid_at ?? null,
    voidedAt: commission.voided_at ?? null,
    campaignId: commission.campaign?.id ?? null,
    campaignName: commission.campaign?.name ?? null,
  };
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    previous_page: number | null;
    current_page: number;
    next_page: number | null;
    count: number;
    limit: number;
    total_pages: number;
    total_count: number;
  };
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export async function listAffiliates(params?: {
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString() ? `?${qs}` : "";
  return request<PaginatedResponse<RewardfulAffiliate>>(
    `/affiliates${query}`
  );
}

export async function getAffiliate(id: string) {
  return request<RewardfulAffiliate>(`/affiliates/${id}`);
}

export async function getAffiliateByEmail(email: string) {
  const qs = new URLSearchParams({
    email,
    limit: "5",
  });
  qs.append("expand[]", "commission_stats");
  const raw = await request<unknown>(`/affiliates?${qs}`);
  const rows = extractPagedRows<RewardfulAffiliate>(raw, ["affiliates"]);
  return (
    rows.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null
  );
}

export async function createAffiliate(data: {
  email: string;
  first_name: string;
  /** Required by Rewardful's presence validator — both `""` and a missing
   *  key trip "Last name can't be blank" with a 422. Caller must provide
   *  a non-empty fallback (e.g. "-") for single-name profiles. */
  last_name: string;
  campaign_id?: string;
}) {
  const body: Record<string, string> = {
    email: data.email,
    first_name: data.first_name,
    last_name: data.last_name,
  };
  if (data.campaign_id) body.campaign_id = data.campaign_id;
  return request<RewardfulAffiliate>("/affiliates", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listCommissions(params?: {
  page?: number;
  limit?: number;
  affiliate_id?: string;
  state?: "due" | "pending" | "paid" | "voided";
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.affiliate_id) qs.set("affiliate_id", params.affiliate_id);
  if (params?.state) qs.set("state", params.state);
  const query = qs.toString() ? `?${qs}` : "";
  return request<PaginatedResponse<RewardfulCommission>>(
    `/commissions${query}`
  );
}

export async function getCommission(id: string) {
  return request<RewardfulCommission>(`/commissions/${id}`);
}

export async function listReferrals(params?: {
  page?: number;
  limit?: number;
  affiliate_id?: string;
  conversion_state?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.affiliate_id) qs.set("affiliate_id", params.affiliate_id);
  if (params?.conversion_state)
    qs.set("conversion_state", params.conversion_state);
  const query = qs.toString() ? `?${qs}` : "";
  return request<PaginatedResponse<RewardfulReferral>>(
    `/referrals${query}`
  );
}

export async function createCoupon(data: {
  affiliate_id: string;
  campaign_id: string;
  code: string;
}) {
  return request<RewardfulCoupon>("/coupons", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * List coupons for a specific affiliate. Paginates via the standard
 * PaginatedResponse shape. Used by the admin panel to show all coupons
 * (including any auto-created by Rewardful) + by the affiliate's own
 * promo-codes page to display their existing codes alongside pending
 * local requests.
 */
export async function listCoupons(params: {
  affiliate_id: string;
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  qs.set("affiliate_id", params.affiliate_id);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  return request<PaginatedResponse<RewardfulCoupon>>(`/coupons?${qs}`);
}

/** Fetches ALL coupons for an affiliate across pages. Uses the shared
 *  extractPagedRows helper so Rewardful's alternate resource-key shape
 *  `{ coupons: [...], pagination }` is handled alongside the `{ data, pagination }`
 *  shape. Matches how listAllCommissionsForAffiliate etc. parse pages. */
export async function listAllCouponsForAffiliate(
  affiliateId: string
): Promise<RewardfulCoupon[]> {
  const all: RewardfulCoupon[] = [];
  let page = 1;
  const limit = 100;
  const MAX_PAGES = 50; // 5 000 coupons max — far beyond realistic
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams();
    qs.set("affiliate_id", affiliateId);
    qs.set("page", String(page));
    qs.set("limit", String(limit));
    const raw = await request<unknown>(`/coupons?${qs}`);
    all.push(...extractPagedRows<RewardfulCoupon>(raw, ["coupons"]));
    const next = extractNextPage(raw, page);
    if (next === null) return all;
    page = next;
    await sleep(PAGE_DELAY_MS);
  }
  console.error(
    `[rewardful] listAllCouponsForAffiliate hit MAX_PAGES=${MAX_PAGES} for ${affiliateId} — truncated.`
  );
  return all;
}

export async function deleteCoupon(couponId: string): Promise<void> {
  await request<void>(`/coupons/${couponId}`, { method: "DELETE" });
}

export async function listCampaigns(params?: {
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString() ? `?${qs}` : "";
  return request<PaginatedResponse<RewardfulCampaign>>(
    `/campaigns${query}`
  );
}

export async function listAllCampaigns(): Promise<RewardfulCampaign[]> {
  const all: RewardfulCampaign[] = [];
  let page = 1;
  const limit = 100;
  for (let i = 0; i < MAX_PAGES; i++) {
    const raw = await request<unknown>(`/campaigns?page=${page}&limit=${limit}`);
    all.push(...extractPagedRows<RewardfulCampaign>(raw, ["campaigns"]));
    const next = extractNextPage(raw, page);
    if (next === null) return all;
    page = next;
    await sleep(PAGE_DELAY_MS);
  }
  console.error(
    `[rewardful] listAllCampaigns hit MAX_PAGES=${MAX_PAGES} cap - results truncated.`
  );
  return all;
}

// ---------------------------------------------------------------------------
// Aggregate / paginated helpers
// ---------------------------------------------------------------------------

const PAGE_DELAY_MS = 250;
const MAX_PAGES = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPagedRows<T>(raw: unknown, fallbackKeys: string[]): T[] {
  const obj = raw as Record<string, unknown> | null;
  if (!obj) return [];
  if (Array.isArray(obj.data)) return obj.data as T[];
  for (const key of fallbackKeys) {
    if (Array.isArray(obj[key])) return obj[key] as T[];
  }
  return [];
}

function extractNextPage(raw: unknown, currentPage: number): number | null {
  const pagination = (raw as { pagination?: Record<string, unknown> })
    ?.pagination;
  if (!pagination) return null;
  const next = pagination.next_page;
  if (typeof next !== "number") return null;
  if (next <= currentPage) return null;
  return next;
}

export async function listAllCommissionsForAffiliate(
  affiliateId: string
): Promise<RewardfulCommission[]> {
  const all: RewardfulCommission[] = [];
  let page = 1;
  const limit = 100;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      affiliate_id: affiliateId,
    });
    qs.append("expand[]", "sale");
    qs.append("expand[]", "campaign");
    const raw = await request<unknown>(`/commissions?${qs}`);
    all.push(...extractPagedRows<RewardfulCommission>(raw, ["commissions"]));
    const next = extractNextPage(raw, page);
    if (next === null) return all;
    page = next;
    await sleep(PAGE_DELAY_MS);
  }
  console.error(
    `[rewardful] listAllCommissionsForAffiliate hit MAX_PAGES=${MAX_PAGES} cap for affiliate=${affiliateId} — next_page still present; results truncated.`
  );
  return all;
}

export async function listAllReferralsForAffiliate(
  affiliateId: string
): Promise<RewardfulReferral[]> {
  const all: RewardfulReferral[] = [];
  let page = 1;
  const limit = 100;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    const raw = await request<unknown>(
      `/affiliates/${affiliateId}/referrals?${qs}`
    );
    all.push(...extractPagedRows<RewardfulReferral>(raw, ["referrals"]));
    const next = extractNextPage(raw, page);
    if (next === null) return all;
    page = next;
    await sleep(PAGE_DELAY_MS);
  }
  console.error(
    `[rewardful] listAllReferralsForAffiliate hit MAX_PAGES=${MAX_PAGES} cap for affiliate=${affiliateId} — next_page still present; results truncated.`
  );
  return all;
}

export interface AffiliateLifetimeStats {
  visitors: number;
  leads: number;
  conversions: number;
  conversionRate: number;
  totalCommissionCents: number;
  paidCents: number;
  unpaidCents: number;
  dueCents: number;
  coupons: { id: string; code: string }[];
  campaignId?: string;
  fetchedAt: string;
}

export async function getAffiliateLifetimeStats(
  affiliateId: string,
  signal?: AbortSignal
): Promise<AffiliateLifetimeStats> {
  const qs = new URLSearchParams();
  qs.append("expand[]", "commission_stats");
  qs.append("expand[]", "coupons");
  const affiliate = await request<RewardfulAffiliate>(
    `/affiliates/${affiliateId}?${qs}`,
    signal ? { signal } : undefined
  );
  const visitors = affiliate.visitors ?? 0;
  const leads = affiliate.leads ?? 0;
  const conversions = affiliate.conversions ?? 0;
  const conversionRate = leads > 0 ? (conversions / leads) * 100 : 0;

  const cs = affiliate.commission_stats;
  const cad = cs?.currencies?.CAD;

  const totalCents = cad?.total?.cents ?? cs?.total_commissions ?? 0;
  const paidCents = cad?.paid?.cents ?? cs?.paid_commissions ?? 0;
  const unpaidCents = cad?.unpaid?.cents ?? cs?.unpaid_commissions ?? 0;
  const dueCents = cad?.due?.cents ?? cs?.due_commissions ?? 0;

  return {
    visitors,
    leads,
    conversions,
    conversionRate,
    totalCommissionCents: totalCents,
    paidCents,
    unpaidCents,
    dueCents,
    coupons: (affiliate.coupons ?? []).map((c) => ({
      id: c.id,
      code: c.code,
    })),
    campaignId: affiliate.campaign?.id ?? affiliate.campaign_id,
    fetchedAt: new Date().toISOString(),
  };
}
