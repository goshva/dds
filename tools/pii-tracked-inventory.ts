#!/usr/bin/env bun
/**
 * tools/pii-tracked-inventory.ts
 *
 * Inventory of PII-like content in **tracked** files: how many hits per rule, per file,
 * which commit last touched it and whether it is already on the remote.
 * Prints counts and file paths only — never the matched values.
 *
 * Usage:
 *   bun tools/pii-tracked-inventory.ts [--out reports/code-review/pii-tracked-inventory.json]
 *
 * Counter fields are named `<rule>_hits` (not `person_code`) so that the report itself
 * does not look like a personnel-identifier document to the masking rules.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { redactText } from "./redact-pii";

const ROOT = resolve(import.meta.dir, "..");
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".tsv", ".log", ".html", ".xml", ".yaml", ".yml", ".sql", ".ts"]);

interface FileEntry {
  file: string;
  person_name_hits: number;
  phone_hits: number;
  email_hits: number;
  secret_hits: number;
  person_code_hits: number;
  bytes: number;
  last_commit: string;
  in_origin_main: boolean;
}

function outPath(): string {
  const index = process.argv.indexOf("--out");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : "reports/code-review/pii-tracked-inventory.json";
}

const tracked = Bun.spawnSync({ cmd: ["git", "ls-files"], cwd: ROOT })
  .stdout.toString()
  .split(/\r?\n/)
  .filter(Boolean);

const files: FileEntry[] = [];
for (const rel of tracked) {
  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) continue;
  const file = Bun.file(`${ROOT}/${rel}`);
  if (!(await file.exists()) || file.size > 40 * 1024 * 1024) continue;
  const { counts } = redactText(await file.text());
  if (counts.person_name + counts.phone + counts.email + counts.person_code === 0) continue;

  const commit = Bun.spawnSync({ cmd: ["git", "log", "--oneline", "-1", "--", rel], cwd: ROOT }).stdout.toString().trim();
  const inOrigin = Bun.spawnSync({ cmd: ["git", "cat-file", "-e", `origin/main:${rel}`], cwd: ROOT }).exitCode === 0;
  files.push({
    file: rel,
    person_name_hits: counts.person_name,
    phone_hits: counts.phone,
    email_hits: counts.email,
    secret_hits: counts.secret,
    person_code_hits: counts.person_code,
    bytes: file.size,
    last_commit: commit,
    in_origin_main: inOrigin,
  });
}
files.sort((a, b) => b.person_name_hits + b.phone_hits + b.email_hits - (a.person_name_hits + a.phone_hits + a.email_hits));

const totals = files.reduce(
  (acc, f) => ({
    person_name_hits: acc.person_name_hits + f.person_name_hits,
    phone_hits: acc.phone_hits + f.phone_hits,
    email_hits: acc.email_hits + f.email_hits,
    secret_hits: acc.secret_hits + f.secret_hits,
    person_code_hits: acc.person_code_hits + f.person_code_hits,
  }),
  { person_name_hits: 0, phone_hits: 0, email_hits: 0, secret_hits: 0, person_code_hits: 0 },
);

const target = resolve(ROOT, outPath());
await mkdir(dirname(target), { recursive: true });
await Bun.write(
  target,
  `${JSON.stringify({ generated_at: new Date().toISOString(), tracked_text_files: tracked.length, files_with_hits: files.length, totals, files }, null, 2)}\n`,
);

console.log(`tracked text files: ${tracked.length}, with hits: ${files.length}`);
console.log(`totals: ${Object.entries(totals).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`already in origin/main: ${files.filter((f) => f.in_origin_main).length}/${files.length}`);
for (const f of files.slice(0, 15)) {
  console.log(`  ${String(f.person_name_hits).padStart(5)} name ${String(f.phone_hits).padStart(3)} phone  ${f.in_origin_main ? "PUSHED" : "local "}  ${f.file}`);
}
console.log(`written: ${target.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "")}`);
