/**
 * Этап 1.4 — CLI-оркестратор.
 *
 * Команды: audit | access | sync | search | extract | parse | model | quality | validate | all
 * `all` останавливается при провале gate и не запускает массовые запросы без проверенного доступа.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./utils";

const SCRIPTS: Record<string, string> = {
  access: "src/phase1-4/access.ts",
  sync: "src/phase1-4/catalog-sync.ts",
  search: "src/phase1-4/search.ts",
  extract: "src/phase1-4/extract.ts",
  parse: "src/phase1-4/parse.ts",
  model: "src/phase1-4/model.ts",
  quality: "src/phase1-4/quality.ts",
  validate: "src/phase1-4/validate.ts",
};

function runScript(script: string): number {
  const p = Bun.spawnSync([process.execPath, "run", script], { stdio: ["inherit", "inherit", "inherit"] as const });
  return p.exitCode ?? 1;
}

function capture(args: string[]): string {
  try {
    const p = Bun.spawnSync(args, { stdio: ["ignore", "pipe", "pipe"] as const });
    return p.stdout ? new TextDecoder().decode(p.stdout).trim() : "";
  } catch {
    return "";
  }
}

function audit(): number {
  const facts = {
    generated_at: new Date().toISOString(),
    pwd: process.cwd(),
    branch: capture(["git", "branch", "--show-current"]),
    head: capture(["git", "log", "-1", "--oneline"]),
    status_short: capture(["git", "status", "--short"]).split("\n").filter(Boolean),
    status_untracked_all: capture(["git", "status", "--short", "--untracked-files=all"]).split("\n").filter(Boolean),
    diff_stat: capture(["git", "diff", "--stat"]).split("\n").filter(Boolean),
    diff_name_only: capture(["git", "diff", "--name-only"]).split("\n").filter(Boolean),
    tracked_count: capture(["git", "ls-files"]).split("\n").filter(Boolean).length,
  };
  writeJsonAtomic("reports/phase-01-4/00_repository_audit.auto.json", facts);
  const ok = existsSync("reports/phase-01-4/00_repository_audit.md");
  console.log(JSON.stringify({ audit_report: ok ? "present" : "MISSING", branch: facts.branch, head: facts.head, tracked: facts.tracked_count, untracked: facts.status_untracked_all.length }, null, 2));
  return ok ? 0 : 1;
}

function main() {
  const command = process.argv[2] ?? "help";
  if (command === "audit") {
    process.exitCode = audit();
    return;
  }
  if (command === "all") {
    const access = runScript(SCRIPTS.access);
    const accessReport = readJson<any>("reports/phase-01-4/01_superset_access_report.json");
    if (accessReport?.status !== "ACCESS_OK") {
      console.error(`[all] G1 not PASS (status=${accessReport?.status ?? "unknown"}). Массовые шаги не запускаются.`);
      process.exitCode = 2;
      return;
    }
    for (const step of ["sync", "search", "extract", "parse", "model", "quality", "validate"]) {
      const code = runScript(SCRIPTS[step]);
      if (code !== 0) {
        console.error(`[all] step ${step} failed with exit ${code}; остановка.`);
        process.exitCode = code;
        return;
      }
    }
    console.log("[all] completed");
    return;
  }
  const script = SCRIPTS[command];
  if (!script) {
    console.log("Команды: audit | access | sync | search | extract | parse | model | quality | validate | all");
    process.exitCode = 1;
    return;
  }
  process.exitCode = runScript(script);
}

main();
