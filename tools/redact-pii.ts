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

/** Keys whose values are personnel identifiers: always masked, numeric or string. */
export const PERSON_ID_KEYS = ["person_code", "id_courier", "courier_id", "employee_id"] as const;
export const PERSON_ID_PLACEHOLDER = MASK.person_code;

/** Key normalisation: case-insensitive, `id-courier` / `ID Courier` / `id_courier` are the same key. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Is this object key a personnel identifier? */
export function isPersonIdKey(key: string): boolean {
  return (PERSON_ID_KEYS as readonly string[]).includes(normalizeKey(key));
}

/** Regex source for the identifier keys, shared by the text rule and key-aware masking. */
const PERSON_ID_KEY_SOURCE = PERSON_ID_KEYS.join("|");

/** Auth scheme words: they follow the key but are never the secret themselves. */
const AUTH_SCHEME_WORDS = new Set(["bearer", "basic", "token", "digest", "negotiate", "oauth", "apikey", "api_key"]);

/** Words that follow "bearer/token" in prose and must not be mistaken for a credential. */
const BEARER_PROSE = new Set([
  "acquired", "provided", "value", "values", "here", "below", "above", "missing", "invalid",
  "expired", "set", "not", "and", "the", "a", "an", "is", "was", "will", "must", "should",
  "authentication", "authorization", "based", "only", "access", "refresh", "string", "jwt",
]);

/** Latin pairs that are not personal names. */
const LATIN_STOPWORDS = new Set([
  "dark store", "test user", "hello world", "select from", "order by", "group by",
  "union all", "inner join", "left join", "create table", "values values",
]);

const RULES: Array<{ rule: PiiRule; re: RegExp; guard?: (match: string) => boolean; mode?: "bearer" }> = [
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
  {
    rule: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // VCS SSH endpoints (git@github.com:org/repo.git) are not personal data
    guard: (m) => !/^git@/i.test(m) && !/^[a-z]+@[a-z0-9.-]+\.(git|local)$/i.test(m),
  },
  { rule: "phone", re: /(?:\+7|8)[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  {
    rule: "secret",
    // Authorization / bearer / basic / token + the credential itself.
    // MUST run before the generic `key=value` rule: otherwise only the scheme word ("Bearer")
    // is treated as the value and the actual token stays in the text.
    mode: "bearer",
    re: /\b(authorization\s*[=:]\s*)?(bearer|basic|token)\s+([A-Za-z0-9._~+/=-]{8,})/gi,
  },
  {
    rule: "secret",
    // (?!<) keeps the placeholders stable: masking twice is idempotent
    re: /\b(session|csrf[_-]?token|x-csrftoken|access[_-]?token|refresh[_-]?token|token|password|authorization|bearer|cookie)\b"?\s*[=:]\s*("?)(?!<)([^\s",;]{4,})\2/gi,
  },
  {
    rule: "person_code",
    // masks the value after an identifier key, whatever its shape: 1234567, "abc-123", person_code=42
    re: new RegExp(`\\b(${PERSON_ID_KEY_SOURCE})\\b"?\\s*[=:]\\s*("?)([^\\s",;}]+)\\2`, "gi"),
  },
];

/** Mask PII in a text blob and report how many hits each rule produced. */
export function redactText(input: string): RedactResult {
  const counts: Record<PiiRule, number> = { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 };
  let text = input;

  for (const { rule, re, guard, mode } of RULES) {
    text = text.replace(re, (match, ...groups) => {
      if (guard && !guard(match)) return match;
      if (mode === "bearer") {
        // groups: 0 = optional "Authorization:" prefix, 1 = scheme, 2 = credential
        const prefix = String(groups[0] ?? "");
        const scheme = String(groups[1] ?? "").toLowerCase();
        const credential = String(groups[2] ?? "");
        if (!credential || credential === MASK.secret) return match;
        // prose guard: "bearer token acquired", "--token --username", "token value here" are not secrets
        if (BEARER_PROSE.has(credential.toLowerCase())) return match;
        if (credential.startsWith("-")) return match;
        const looksLikeCredential =
          credential.length >= 20 ||
          /\d/.test(credential) ||
          (scheme === "basic" && credential.length >= 8);
        if (!looksLikeCredential) return match;
        counts.secret++;
        return `${prefix}${MASK.secret}`;
      }
      if (rule === "person_code") {
        // value sits in group 3 (1 = key, 2 = quote); skip empties, JSON nulls and our own placeholder
        const value = String(groups[2] ?? "");
        if (!value || value === PERSON_ID_PLACEHOLDER || /^(null|true|false)$/i.test(value)) return match;
        counts.person_code++;
        return match.replace(/([=:]\s*"?)[^\s",;}]+("?)$/, `$1${PERSON_ID_PLACEHOLDER}$2`);
      }
      if (rule === "secret") {
        // generic key=value rule: groups 0 = key, 1 = quote, 2 = value
        const value = String(groups[2] ?? "");
        const quote = String(groups[1] ?? "");
        // scheme words ("Authorization: Bearer") and our own placeholders are not secrets
        if (!value || value.startsWith("<") || AUTH_SCHEME_WORDS.has(value.toLowerCase())) return match;
        counts.secret++;
        const prefix = match.slice(0, match.length - value.length - quote.length);
        return `${prefix}${MASK.secret}${quote}`;
      }
      counts[rule]++;
      return MASK[rule];
    });
  }

  return { text, counts };
}

/**
 * Recursively mask a JSON structure.
 *
 * Two mechanisms work together:
 *  - **key-aware**: values under `person_code` / `id_courier` / `courier_id` / `employee_id`
 *    (case- and separator-insensitive) are always replaced by `<ID-СОТРУДНИКА>`, whether they are
 *    numbers, numeric strings or opaque string ids; arrays and nested objects are handled.
 *  - **content-aware**: every remaining string goes through {@link redactText}.
 *
 * Keys themselves are preserved, and the function is idempotent.
 */
export function redactJson<T>(value: T): { value: T; counts: Record<PiiRule, number> } {
  const counts: Record<PiiRule, number> = { person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 };

  /** Mask an identifier value of any shape (primitive, array, nested object). */
  const maskIdValue = (node: any): any => {
    if (node === null || node === undefined) return node;
    if (typeof node === "string") {
      if (node === "" || node === PERSON_ID_PLACEHOLDER) return node;
      counts.person_code++;
      return PERSON_ID_PLACEHOLDER;
    }
    if (typeof node === "number" || typeof node === "bigint") {
      counts.person_code++;
      return PERSON_ID_PLACEHOLDER;
    }
    if (Array.isArray(node)) return node.map(maskIdValue);
    if (typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = maskIdValue(v);
      return out;
    }
    return node; // booleans are not identifiers
  };

  const walk = (node: any, key?: string): any => {
    if (key !== undefined && isPersonIdKey(key)) return maskIdValue(node);
    if (typeof node === "string") {
      const r = redactText(node);
      for (const k of Object.keys(r.counts) as PiiRule[]) counts[k] += r.counts[k];
      return r.text;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
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
  /** exit non-zero when any rule still matches (publish gate) */
  gate: boolean;
}

/** Files whose PII-like content is synthetic by design and must not fail the gate. */
const GATE_EXEMPT = /(\.test\.ts$|\.spec\.ts$|[\\/]tests?[\\/]|docs[\\/]phase-01-5[\\/]fixtures[\\/]|tools[\\/]redact-pii\.ts$)/;

function parseArgs(argv: string[]): CliOptions {
  const inputs: string[] = [];
  let outDir: string | null = null;
  let reportPath: string | null = null;
  let dryRun = false;
  let gate = false;
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
      case "--gate": gate = true; break;
      case "--help": case "-h":
        console.log("usage: bun tools/redact-pii.ts --in <file|dir> [--in ...] [--out <dir>] [--report <file>] [--dry-run] [--gate]");
        process.exit(0);
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  if (!inputs.length) throw new Error("--in is required");
  if (!dryRun && !gate && !outDir) throw new Error("--out is required unless --dry-run/--gate");
  return { inputs, outDir, reportPath, dryRun, gate };
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

  // Serialised reports use `<rule>_hits` keys on purpose: a bare `person_code` key would itself
  // look like a personnel-identifier field to the very rule set this tool implements.
  const safeCounts = (c: Record<PiiRule, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [`${k}_hits`, v]));

  const summary = {
    generated_at: new Date().toISOString(),
    dry_run: opts.dryRun,
    inputs: opts.inputs,
    out_dir: opts.outDir,
    files_scanned: files.length,
    files_written: reports.filter((r) => r.target).length,
    totals: safeCounts(totals),
    files_with_pii: reports.filter((r) => Object.values(r.counts).some((n) => n > 0)).map((r) => r.source),
    reports: reports.map((r) => ({ ...r, counts: safeCounts(r.counts) })),
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
  if (!opts.dryRun && opts.outDir) console.log(`output: ${resolve(opts.outDir)}`);

  if (opts.gate) {
    const offenders = reports.filter(
      (r) => Object.values(r.counts).some((n) => n > 0) && !GATE_EXEMPT.test(r.source),
    );
    if (offenders.length) {
      console.error(`[GATE FAIL] ${offenders.length} file(s) still contain PII-like values — publication blocked:`);
      for (const r of offenders) console.error(`  - ${r.source}`);
      process.exitCode = 1;
    } else {
      console.log(`[GATE PASS] no PII-like values outside exempt test/fixture files`);
    }
  }
}
