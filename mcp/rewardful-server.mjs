#!/usr/bin/env node

/**
 * Rewardful MCP Server
 *
 * Exposes the Rewardful REST API as MCP tools so Claude Code
 * can query affiliates, commissions, referrals, and campaigns.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_KEY = process.env.REWARDFUL_API_KEY;
const BASE_URL = process.env.REWARDFUL_API_BASE_URL || 'https://api.getrewardful.com/v1';

if (!API_KEY) {
  console.error('REWARDFUL_API_KEY is required');
  process.exit(1);
}

const headers = {
  Authorization: 'Basic ' + Buffer.from(API_KEY + ':').toString('base64'),
  'Content-Type': 'application/json',
};

async function rewardfulFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers, timeout: 10000, ...options });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Rewardful API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'rewardful',
  version: '1.0.0',
});

// ── Tools ───────────────────────────────────────────────────────────────

server.tool(
  'list_affiliates',
  'List affiliates with optional pagination and state filter',
  {
    page: z.number().optional().default(1).describe('Page number (default 1)'),
    limit: z.number().optional().default(50).describe('Results per page (max 200)'),
    state: z.enum(['active', 'pending', 'inactive', 'deactivated']).optional().describe('Filter by state'),
  },
  async ({ page, limit, state }) => {
    let path = `/affiliates?page=${page}&limit=${limit}&expand[]=commission_stats`;
    if (state) path += `&state=${state}`;
    const data = await rewardfulFetch(path);
    const affiliates = (data.data || data.affiliates || []).map((a) => ({
      id: a.id,
      email: a.email,
      name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      state: a.state,
      campaign_id: a.campaign_id,
      visitors: a.visitors,
      leads: a.leads,
      conversions: a.conversions,
      commission_stats: a.commission_stats,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ affiliates, pagination: data.pagination }, null, 2) }] };
  }
);

server.tool(
  'get_affiliate_by_email',
  'Find an affiliate by their email address',
  {
    email: z.string().describe('Affiliate email address'),
  },
  async ({ email }) => {
    const data = await rewardfulFetch(`/affiliates?email=${encodeURIComponent(email)}&expand[]=commission_stats&limit=5`);
    const affiliates = data.data || data.affiliates || [];
    const match = affiliates.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!match) return { content: [{ type: 'text', text: `No affiliate found with email: ${email}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(match, null, 2) }] };
  }
);

server.tool(
  'get_affiliate_by_id',
  'Get a specific affiliate by their Rewardful ID',
  {
    id: z.string().describe('Affiliate UUID'),
  },
  async ({ id }) => {
    const data = await rewardfulFetch(`/affiliates/${id}?expand[]=commission_stats`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'list_commissions',
  'List commissions with optional filters for affiliate and state',
  {
    affiliate_id: z.string().optional().describe('Filter by affiliate ID'),
    state: z.enum(['due', 'pending', 'paid', 'voided']).optional().describe('Filter by commission state'),
    page: z.number().optional().default(1).describe('Page number'),
    limit: z.number().optional().default(50).describe('Results per page (max 100)'),
    expand_sale: z.boolean().optional().default(false).describe('Expand sale details'),
  },
  async ({ affiliate_id, state, page, limit, expand_sale }) => {
    let path = `/commissions?page=${page}&limit=${limit}`;
    if (affiliate_id) path += `&affiliate_id=${affiliate_id}`;
    if (state) path += `&state=${state}`;
    if (expand_sale) path += `&expand[]=sale`;
    const data = await rewardfulFetch(path);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_commission',
  'Get a specific commission by ID',
  {
    id: z.string().describe('Commission UUID'),
  },
  async ({ id }) => {
    const data = await rewardfulFetch(`/commissions/${id}?expand[]=sale`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'list_referrals',
  'List referrals for a specific affiliate',
  {
    affiliate_id: z.string().describe('Affiliate UUID'),
    page: z.number().optional().default(1).describe('Page number'),
    limit: z.number().optional().default(50).describe('Results per page'),
    conversion_state: z.enum(['lead', 'conversion', 'visitor']).optional().describe('Filter by conversion state'),
  },
  async ({ affiliate_id, page, limit, conversion_state }) => {
    let path = `/affiliates/${affiliate_id}/referrals?page=${page}&limit=${limit}`;
    if (conversion_state) path += `&conversion_state=${conversion_state}`;
    const data = await rewardfulFetch(path);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'list_campaigns',
  'List all campaigns',
  {},
  async () => {
    const data = await rewardfulFetch('/campaigns?limit=100');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_campaign',
  'Get a specific campaign by ID',
  {
    id: z.string().describe('Campaign UUID'),
  },
  async ({ id }) => {
    const data = await rewardfulFetch(`/campaigns/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'create_affiliate',
  'Create a new affiliate in Rewardful',
  {
    email: z.string().describe('Affiliate email'),
    first_name: z.string().describe('First name'),
    last_name: z.string().describe('Last name'),
    campaign_id: z.string().optional().describe('Campaign UUID to assign to'),
  },
  async ({ email, first_name, last_name, campaign_id }) => {
    const body = { email, first_name, last_name };
    if (campaign_id) body.campaign_id = campaign_id;
    const data = await rewardfulFetch('/affiliates', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_affiliate_commission_summary',
  'Get a full commission summary for an affiliate (totals + recent commissions)',
  {
    affiliate_id: z.string().describe('Affiliate UUID'),
  },
  async ({ affiliate_id }) => {
    const [affiliate, commissions] = await Promise.all([
      rewardfulFetch(`/affiliates/${affiliate_id}?expand[]=commission_stats`),
      rewardfulFetch(`/commissions?affiliate_id=${affiliate_id}&limit=10&expand[]=sale`),
    ]);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          affiliate: {
            id: affiliate.id,
            email: affiliate.email,
            name: `${affiliate.first_name || ''} ${affiliate.last_name || ''}`.trim(),
            state: affiliate.state,
            visitors: affiliate.visitors,
            leads: affiliate.leads,
            conversions: affiliate.conversions,
            commission_stats: affiliate.commission_stats,
          },
          recent_commissions: commissions,
        }, null, 2),
      }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
