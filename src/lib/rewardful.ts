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
    throw new Error(
      `Rewardful API ${res.status}: ${res.statusText} — ${text}`
    );
  }

  return res.json() as Promise<T>;
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
  links: { url: string; visitors: number }[];
  coupons: { id: string; code: string }[];
  created_at: string;
  updated_at: string;
}

export interface RewardfulCommission {
  id: string;
  amount: number;
  currency: string;
  due_at: string | null;
  paid_at: string | null;
  sale?: {
    id: string;
    amount: number;
    currency: string;
    charged_at: string;
    refunded_at: string | null;
    customer?: {
      id: string;
      email: string;
      name: string;
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
  code: string;
  affiliate_id: string;
  campaign_id: string;
  created_at: string;
}

export interface RewardfulCampaign {
  id: string;
  name: string;
  url: string;
  commission_type: string;
  reward_type: string;
  private: boolean;
  created_at: string;
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
  const res = await listAffiliates({ limit: 100 });
  return res.data.find(
    (a) => a.email.toLowerCase() === email.toLowerCase()
  ) ?? null;
}

export async function listCommissions(params?: {
  page?: number;
  limit?: number;
  affiliate_id?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.affiliate_id) qs.set("affiliate_id", params.affiliate_id);
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
