import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const srcRoot = path.join(repoRoot, "src");

const extensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirs = new Set([".git", ".next", "node_modules"]);

const forbiddenPatterns = [
  {
    label: "student-facing teacher earnings copy",
    pattern: /earning\s+a\s+cut\s+from\s+your\s+commissions/i,
  },
  {
    label: "teacher cut/share/percentage from your commissions",
    pattern:
      /teacher[^`'"\n]{0,80}(cut|share|percentage)[^`'"\n]{0,80}your\s+commissions/i,
  },
  {
    label: "cut/share/percentage from your commissions",
    pattern:
      /(cut|share|percentage)[^`'"\n]{0,80}from\s+your\s+commissions/i,
  },
];

const requiredSanitizerUses = [
  {
    file: "src/lib/notifications.ts",
    needle: "sanitizeNotificationCopy",
    label: "new notification copy sanitizer",
  },
  {
    file: "src/app/api/notifications/route.ts",
    needle: "sanitizeNotificationCopy",
    label: "stored notification copy sanitizer",
  },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

const failures = [];
const files = await walk(srcRoot);

for (const file of files) {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(line)) {
        failures.push({
          file: relative(file),
          line: index + 1,
          label,
          text: line.trim(),
        });
      }
    }
  }
}

for (const requirement of requiredSanitizerUses) {
  const file = path.join(repoRoot, requirement.file);
  const text = await readFile(file, "utf8");
  if (!text.includes(requirement.needle)) {
    failures.push({
      file: requirement.file,
      line: 1,
      label: requirement.label,
      text: `Missing ${requirement.needle}`,
    });
  }
}

if (failures.length > 0) {
  console.error("Notification privacy check failed:");
  for (const failure of failures) {
    console.error(
      `- ${failure.file}:${failure.line} [${failure.label}] ${failure.text}`
    );
  }
  process.exit(1);
}

console.log("Notification privacy check passed.");
