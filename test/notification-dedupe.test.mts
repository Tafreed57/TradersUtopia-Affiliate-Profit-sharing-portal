import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const notificationsPath = new URL("../src/lib/notifications.ts", import.meta.url);

test("notifications support a unique retry-safe dedupe key", async () => {
  const [schema, source] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(notificationsPath, "utf8"),
  ]);

  assert.match(schema, /dedupeKey\s+String\?\s+@unique/);
  assert.match(source, /dedupeKey\?: string/);
  assert.match(source, /P2002/);
  assert.match(source, /skipped:\s*true/);
});
