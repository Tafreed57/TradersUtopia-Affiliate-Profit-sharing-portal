-- Admin-only organizational labels. Existing affiliates start ungrouped.
CREATE TABLE "AffiliateGroup" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateGroup_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 48),
    CONSTRAINT "AffiliateGroup_color_check" CHECK ("color" ~ '^#[0-9A-F]{6}$')
);

CREATE UNIQUE INDEX "AffiliateGroup_nameKey_key" ON "AffiliateGroup"("nameKey");

-- Keep membership private without changing existing User columns or grants.
CREATE TABLE "AffiliateGroupMembership" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateGroupMembership_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "AffiliateGroupMembership_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "AffiliateGroupMembership_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "AffiliateGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "AffiliateGroupMembership_groupId_idx" ON "AffiliateGroupMembership"("groupId");

-- Prisma accesses this table through the privileged server connection.
-- No client policies: names, colors, and membership must remain private.
ALTER TABLE "AffiliateGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateGroupMembership" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AffiliateGroup" FROM PUBLIC;
REVOKE ALL ON TABLE "AffiliateGroupMembership" FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE "AffiliateGroup" FROM anon;
        REVOKE ALL ON TABLE "AffiliateGroupMembership" FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE "AffiliateGroup" FROM authenticated;
        REVOKE ALL ON TABLE "AffiliateGroupMembership" FROM authenticated;
    END IF;
END $$;
