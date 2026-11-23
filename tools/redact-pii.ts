#!/usr/bin/env bun
/**
 * tools/redact-pii.ts
 *
 * PII masking for published reports. Sources are read-only: the tool writes redacted
 * COPIES, never modifies the originals.
 *
 * Detected and masked:
 *   person_name  — «<ФИО> [Отчество]» (Cyrillic) and «First Last» (Latin, stop-listed)
 *   email        — <EMAIL>
 *   phone        — +7/<ТЕЛЕФОН>
 *   secret       — values after session=/csrf=/token=/password=/authorization:/bearer
 *   person_code  — long numeric personnel ids when labelled person/courier/employee
 *
 * Usage:
 *   bun tools/redact-pii.ts --in reports/phase-01-9 --out reports/public/phase-01-9
 *   bun tools/redact-pii.ts --in reports/phase-01-9/darkstore_7745_requirements_gap.md --out C:/Temp/redacted
 *   bun tools/redact-pii.ts --in <dir> --out <dir> --report reports/public/pii-redaction-report.json
 *   bun tools/redact-pii.ts --in <file> --dry-run          # only count, write nothing
 */

import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

export type PiiRule = "person_name" | "email" | "phone" | "secret" | "person_code";

export interface RedactResult {
  text: string;
  counts: Record<PiiRule, number>;
}

const MASK: Record<PiiRule, string> = {
  person_name: "<ФИО>",
  email: "<EMAIL>",
  phone: "<ТЕЛЕФОН>",
  secret: "<СЕКРЕТ>",
  person_code: "<ID-СОТРУДНИКА>",
};

/** Latin pairs that are not personal names. */
const LATIN_STOPWORDS = new Set([
  "dark store", "test user", "hello world", "select from", "order by", "group by",
  "union all", "inner join", "left join", "create table", "values values",
]);

const RULES: Array<{ rule: PiiRule; re: RegExp; guard?: (match: string) => boolean }> = [
  // «<ФИО>» / «<ФИО>» — JS \b is ASCII-only, so Cyrillic uses lookarounds.
  // A maximal run of 2-3 capitalised Cyrillic words is masked (e.g. «<ФИО>»).
  {
    rule: "person_name",
    re: /(?<![А-ЯЁа-яё])(?:[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)(?:\s+(?:[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)){1,2}(?![А-ЯЁа-яё])/g,
  },
  // «Ivan Petrov» (stop-listed pairs excluded)
  {
    rule: "person_name",
    re: /\b[A-Z][a-z]{1,}(?:-[A-Z][a-z]{1,})?(?:\s+[A-Z][a-z]{1,}(?:-[A-Z][a-z]{1,})?){1,2}\b/g,
    guard: (m) => !LATIN_STOPWORDS.has(m.toLowerCase()),
  },
  { rule: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { rule: "phone", re: /(?:\+7|8)[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  {
    rule: "secret",
    re: /\b(session|csrf[_-]?token|x-csrftoken|access[_-]?token|refresh[_-]?token|token|password|authorization|bearer|cookie)\b"?\s*[=:]\s*("?)([^\s",;]{4,})\2/gi,
  },
  { rule: "person_code", re: /\b(person_code|id_courier|courier_id|employee_id)\b"?\s*[=:]\s*"?(\d{4,})"?/gi },
];

/** Mask PII in a text blob and report how many hits each rule produced. */
export function redactText(input: string): RedactResult {
  const counts: Record<PiiRule, number> = { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 };
  let text = input;

  for (const { rule, re, guard } of RULES) {
    text = text.replace(re, (match, ...groups) => {
      if (guard && !guard(match)) return match;
      counts[rule]++;
      if (rule === "secret") {
        // keep the key, mask only the value
        const key = String(groups[0]).toLowerCase();
        const mask = key.includes("authorization") || key.includes("bearer") || key.includes("cookie") ? MASK.secret : MASK.secret;
        return match.replace(/([=:]\s*"?)[^\s",;]{4,}("?)$/, `$1${mask}$2`);
      }
      if (rule === "person_code") {
        return match.replace(/\d{4,}/, MASK.person_code);
      }
      return MASK[rule];
    });
  }

  return { text, counts };
}

/** Recursively mask string values inside a JSON structure (keys are preserved). */
export function redactJson<T>(value: T): { value: T; counts: Record<PiiRule, number> } {
  const counts: Record<PiiRule, number> = { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 };
  const walk = (node: any): any => {
    if (typeof node === "string") {
      const r = redactText(node);
      for (const k of Object.keys(r.counts) as PiiRule[]) counts[k] += r.counts[k];
      return r.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return { value: walk(value) as T, counts };
}

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".tsv", ".log", ".html", ".xml", ".yaml", ".yml", ".sql"]);

async function listFiles(root: string): Promise<string[]> {
  const stat = await Bun.file(root).exists();
  if (stat) return [root];
  const out: string[] = [];
  for await (const entry of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
    out.push(join(root, entry));
  }
  return out;
}

interface FileReport {
  source: string;
  target: string | null;
  bytes: number;
  counts: Record<PiiRule, number>;
  skipped?: string;
}

interface CliOptions {
  inputs: string[];
  outDir: string | null;
  reportPath: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const inputs: string[] = [];
  let outDir: string | null = null;
  let reportPath: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--in": inputs.push(next()); break;
      case "--out": outDir = next(); break;
      case "--report": reportPath = next(); break;
      case "--dry-run": dryRun = true; break;
      case "--help": case "-h":
        console.log("usage: bun tools/redact-pii.ts --in <file|dir> [--in ...] [--out <dir>] [--report <file>] [--dry-run]");
        process.exit(0);
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  if (!inputs.length) throw new Error("--in is required");
  if (!dryRun && !outDir) throw new Error("--out is required unless --dry-run");
  return { inputs, outDir, reportPath, dryRun };
}

if (import.meta.main) {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${String(error)}`);
    console.error("usage: bun tools/redact-pii.ts --in <file|dir> [--in ...] [--out <dir>] [--report <file>] [--dry-run]");
    process.exitCode = 2;
    process.exit();
  }

  const files: string[] = [];
  for (const input of opts.inputs) files.push(...(await listFiles(resolve(input))));

  const reports: FileReport[] = [];
  const totals: Record<PiiRule, number> = { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 };

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const bytes = Bun.file(file).size;
    if (!TEXT_EXTENSIONS.has(ext)) {
      reports.push({ source: file, target: null, bytes, counts: { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 }, skipped: `not a text extension (${ext || "none"})` });
      continue;
    }
    const raw = await Bun.file(file).text();
    let counts: Record<PiiRule, number>;
    let output: string;
    if (ext === ".json") {
      try {
        const parsed = JSON.parse(raw);
        const r = redactJson(parsed);
        counts = r.counts;
        output = `${JSON.stringify(r.value, null, 2)}\n`;
      } catch {
        const r = redactText(raw);
        counts = r.counts;
        output = r.text;
      }
    } else {
      const r = redactText(raw);
      counts = r.counts;
      output = r.text;
    }
    for (const k of Object.keys(counts) as PiiRule[]) totals[k] += counts[k];

    let target: string | null = null;
    if (!opts.dryRun && opts.outDir) {
      const rel = opts.inputs.length === 1 && (await Bun.file(resolve(opts.inputs[0]!)).exists())
        ? basename(file)
        : relative(resolve(opts.inputs[0]!), file);
      target = join(resolve(opts.outDir), rel);
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, output);
    }
    reports.push({ source: file, target, bytes, counts });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    dry_run: opts.dryRun,
    inputs: opts.inputs,
    out_dir: opts.outDir,
    files_scanned: files.length,
    files_written: reports.filter((r) => r.target).length,
    totals,
    files_with_pii: reports.filter((r) => Object.values(r.counts).some((n) => n > 0)).map((r) => r.source),
    reports,
  };

  if (opts.reportPath) {
    const target = resolve(opts.reportPath);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, `${JSON.stringify(summary, null, 2)}\n`);
  }

  console.log(`files scanned: ${summary.files_scanned}, written: ${summary.files_written}`);
  console.log(`PII hits: ${Object.entries(totals).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  for (const r of reports.filter((x) => Object.values(x.counts).some((n) => n > 0))) {
    console.log(`  ${r.source}: ${Object.entries(r.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (!opts.dryRun) console.log(`output: ${resolve(opts.outDir!)}`);
}
