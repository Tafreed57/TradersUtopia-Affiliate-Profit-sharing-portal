import { z } from "zod";

export const AFFILIATE_GROUP_NAME_MAX_LENGTH = 48;
export const AFFILIATE_GROUP_ASSIGNMENT_LIMIT = 100;

export const affiliateGroupIdSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid ID");

function hasNoControlCharacters(value: string) {
  return Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && (code < 127 || code > 159);
  });
}

export const affiliateGroupInputSchema = z.object({
  name: z.string()
    .transform((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Enter a group name").max(AFFILIATE_GROUP_NAME_MAX_LENGTH, "Group names must be 48 characters or fewer")
      .refine(hasNoControlCharacters, "Group names cannot contain control characters")),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Choose a six-digit hex color").transform((value) => value.toUpperCase()),
}).strict().refine(({ name }) => !["ungrouped", "all", "all affiliates"].includes(name.toLowerCase()), {
  message: '"Ungrouped", "All", and "All affiliates" are reserved. Choose a different group name.',
  path: ["name"],
}).transform(({ name, color }) => ({ name, nameKey: name.toLowerCase(), color }));

export const affiliateGroupAssignmentSchema = z.object({
  affiliateIds: z.array(affiliateGroupIdSchema).min(1).max(AFFILIATE_GROUP_ASSIGNMENT_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, "Affiliate IDs must be unique"),
  groupId: affiliateGroupIdSchema.nullable(),
}).strict();

/** Reject malformed pagination before it can reach Prisma's skip/take arguments. */
export function parseAffiliatePagination(params: URLSearchParams) {
  const rawPage = params.get("page") ?? "1";
  const rawLimit = params.get("limit") ?? "50";
  if (!/^\d+$/.test(rawPage) || !/^\d+$/.test(rawLimit)) return null;
  const page = Number(rawPage);
  const requestedLimit = Number(rawLimit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) return null;
  const limit = Math.min(100, requestedLimit);
  const skip = (page - 1) * limit;
  // PostgreSQL/Prisma pagination values use a signed 32-bit integer.
  if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) return null;
  return { page, limit, skip };
}
