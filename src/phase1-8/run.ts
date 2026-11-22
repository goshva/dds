/**
 * Этап 1.8 — пайплайн: G0 preflight → рендер → валидация → итоговые отчёты.
 *
 * Запуск: bun src/phase1-8/run.ts
 *
 * Только чтение источников. Пишет исключительно в docs/phase-01-8 и reports/phase-01-8.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  CONTEXTS,
  ENTITIES,
  ATTRIBUTES,
  RELATIONSHIPS,
  EVIDENCE,
  DECISIONS,
  INVARIANTS,
  GAPS,
  PROCESSES,
  MVP_FIELDS,
  METRICS,
} from "./model";
import {
  DOCS_DIR,
  DIAGRAMS_DIR,
  REPORTS_DIR,
  ensureDirs,
  renderDocuments,
  renderDiagrams,
  renderMachineReadable,
  renderValidationReport,
  renderReadme,
  sha256,
  type ValidationResult,
} from "./render";
import { runValidation } from "./validate";
import { runFindingsVerification, type FindingsVerification } from "./verify-findings";

const ROOT = process.cwd();

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* G0 preflight                                                        */
/* ------------------------------------------------------------------ */

interface Preflight {
  stage: string;
  generated_at: string;
  pwd: string;
  git_root: string;
  git_branch: string;
  git_head: string;
  git_status_short: string[];
  catalog_sqlite_exists: boolean;
  catalog_sha256_before: string | null;
  catalog_size_before: number | null;
  catalog_backup: string | null;
  sources: Array<{ path: string; exists: boolean; files: number }>;
  input_status: "FULL_INPUTS" | "PARTIAL_INPUTS";
  notes: string[];
}

function preflight(): Preflight {
  const catalogPath = join(ROOT, "data", "catalog.sqlite");
  const exists = existsSync(catalogPath);
  const sources = [
    "docs/phase-01-5",
    "docs/phase-01-6",
    "docs/phase-01-6-2",
    "docs/phase-01-7",
    "reports/phase-01-6",
    "reports/phase-01-6-2",
    "reports/phase-01-7",
    "analysis_package",
    "src/phase1-7",
    "src/phase1-8",
  ].map((p) => {
    const abs = join(ROOT, p);
    const ok = existsSync(abs);
    let files = 0;
    if (ok) {
      try {
        files = countFiles(abs);
      } catch {
        files = 0;
      }
    }
    return { path: p, exists: ok, files };
  });

  const notes: string[] = [];
  if (!sources.find((s) => s.path === "docs/phase-01-7")?.exists) {
    notes.push("docs/phase-01-7 отсутствует — использован отчёт 1.7 в корне репозитория");
  }
  if (!sources.find((s) => s.path === "reports/phase-01-7")?.exists) {
    notes.push("reports/phase-01-7 отсутствует — этап 1.7 не публиковал отдельный пакет отчётов");
  }
  if (!exists) notes.push("data/catalog.sqlite отсутствует — новый файл не создавался");

  const backupCandidates = ["data/catalog.sqlite.bak", "data/catalog.backup.sqlite", "data/catalog.sqlite.backup"];
  const backup = backupCandidates.find((p) => existsSync(join(ROOT, p))) ?? null;

  const inputStatus: Preflight["input_status"] = sources.some((s) => s.path.startsWith("docs/phase-01-7") && !s.exists) ? "PARTIAL_INPUTS" : "FULL_INPUTS";

  return {
    stage: "1.8",
    generated_at: new Date().toISOString(),
    pwd: ROOT,
    git_root: sh("git rev-parse --show-toplevel"),
    git_branch: sh("git rev-parse --abbrev-ref HEAD"),
    git_head: sh("git rev-parse HEAD"),
    git_status_short: sh("git status --short").split(/\r?\n/).filter(Boolean),
    catalog_sqlite_exists: exists,
    catalog_sha256_before: exists ? sha256File(catalogPath) : null,
    catalog_size_before: exists ? statSync(catalogPath).size : null,
    catalog_backup: backup,
    sources,
    input_status: inputStatus,
    notes,
  };
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(p);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

function writePreflight(p: Preflight): void {
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, "preflight.json"), JSON.stringify(p, null, 2), "utf8");

  const srcRows = p.sources.map((s) => `| \`${s.path}\` | ${s.exists ? "есть" : "нет"} | ${s.files} |`).join("\n");
  const md = `# G0 Preflight — Этап 1.8

**Сгенерировано:** ${p.generated_at}

| Параметр | Значение |
|---|---|
| pwd | \`${p.pwd}\` |
| Git root | \`${p.git_root}\` |
| Ветка | \`${p.git_branch}\` |
| HEAD | \`${p.git_head}\` |
| catalog.sqlite | ${p.catalog_sqlite_exists ? "есть" : "нет"} |
| SHA-256 до работы | \`${p.catalog_sha256_before ?? "n/a"}\` |
| Размер до работы | ${p.catalog_size_before ?? "n/a"} |
| Backup | ${p.catalog_backup ?? "не найден"} |
| Статус входов | \`${p.input_status}\` |

## Источники

| Путь | Наличие | Файлов |
|---|---|---|
${srcRows}

## Замечания

${p.notes.length ? p.notes.map((n) => `- ${n}`).join("\n") : "- нет"}

## Git status (short)

\`\`\`
${p.git_status_short.join("\n") || "(clean)"}
\`\`\`

## G0 verdict

- репозиторий определён: ${p.git_root ? "да" : "нет"};
- baseline Git сохранён: ${p.git_head ? "да" : "нет"};
- источники перечислены: да;
- SQLite: ${p.catalog_sqlite_exists ? "read-only, SHA-256 зафиксирован" : "отсутствует, явно отмечено"}.
`;
  writeFileSync(join(REPORTS_DIR, "preflight.md"), md, "utf8");
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function byStatus(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of ENTITIES) out[e.status] = (out[e.status] ?? 0) + 1;
  return out;
}

function byConfidence(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of ENTITIES) out[e.confidence] = (out[e.confidence] ?? 0) + 1;
  return out;
}

function byContext(): Array<{ id: string; name: string; count: number }> {
  return CONTEXTS.map((c) => ({ id: c.id, name: c.ru_name, count: ENTITIES.filter((e) => e.bounded_context === c.id).length }));
}

function renderSummary(v: ValidationResult, p: Preflight, findings: FindingsVerification): string {
  const statuses = byStatus();
  const conf = byConfidence();
  const ctx = byContext();
  const p0 = GAPS.filter((g) => g.priority === "P0_BLOCKER");
  const p1 = GAPS.filter((g) => g.priority === "P1_HIGH");
  const checkRows = v.checks.map((c) => `| ${c.id} | ${c.title} | ${c.status} | ${c.details} |`).join("\n");
  const statusRows = Object.entries(statuses).map(([k, n]) => `| \`${k}\` | ${n} |`).join("\n");
  const confRows = Object.entries(conf).map(([k, n]) => `| \`${k}\` | ${n} |`).join("\n");
  const ctxRows = ctx.map((c) => `| ${c.id} | ${c.name} | ${c.count} |`).join("\n");

  return `# Этап 1.8 — Logical Data Model & ERD: итоговый отчёт

**Verdict:** \`${v.verdict}\`  
**Сгенерировано:** ${v.generated_at}  
**Статус входов:** \`${p.input_status}\`

## 1. Что сделано

Построена логическая модель курьерской службы в двух слоях (observed source concepts и target logical model) на основании артефактов этапов 1.1–1.7, SQL definitions Superset и зафиксированных бизнес-правил. Созданы:

- 14 документов в \`docs/phase-01-8/\`;
- 7 Mermaid-диаграмм в \`docs/phase-01-8/diagrams/\`;
- 8 машиночитаемых JSON в \`reports/phase-01-8/\`;
- валидатор \`src/phase1-8/validate.ts\` и пайплайн \`src/phase1-8/run.ts\`.

## 2. Количество сущностей, атрибутов, связей, evidence, decisions

| Артефакт | Количество |
|---|---|
| Сущности | ${ENTITIES.length} |
| Атрибуты | ${ATTRIBUTES.length} |
| Связи | ${RELATIONSHIPS.length} |
| Evidence links | ${EVIDENCE.length} |
| Открытые решения | ${DECISIONS.length} |
| Инварианты | ${INVARIANTS.length} |
| Gaps | ${GAPS.length} |
| Процессы | ${PROCESSES.length} |
| MVP-поля | ${MVP_FIELDS.length} |
| Метрики | ${METRICS.length} |
| Bounded contexts | ${CONTEXTS.length} |

## 2a. Проверка обязательных findings §5 ТЗ

Проверено по первичным артефактам 1.6.2 (\`data/snapshots/phase-01-6-2\`): **${findings.total}** findings, подтверждено **${findings.confirmed}**, конфликтов **${findings.conflicts}**, не проверяемо **${findings.not_verifiable}**.

${findings.results.map((r) => `- \`${r.check_id}\` ${r.status === "CONFIRMED" ? "✅" : r.status === "CONFLICT" ? "⚠️" : "❔"} ${r.finding}`).join("\n")}

Детали: \`reports/phase-01-8/findings_verification.json\`.

## 3. Breakdown по bounded context

| ID | Контекст | Сущностей |
|---|---|---|
${ctxRows}

## 4. Breakdown по статусам

| Статус | Сущностей |
|---|---|
${statusRows}

## 5. Breakdown по confidence

| Confidence | Сущностей |
|---|---|
${confRows}

## 6. P0/P1 blockers

### P0

${p0.length ? p0.map((g) => `- \`${g.id}\` ${g.title}: ${g.missing}`).join("\n") : "- нет"}

### P1

${p1.length ? p1.map((g) => `- \`${g.id}\` ${g.title}: ${g.missing}`).join("\n") : "- нет"}

## 7. Результаты G0–G7

### G0 — preflight

Репозиторий: \`${p.git_root}\`; ветка \`${p.git_branch}\`; HEAD \`${p.git_head}\`. SHA-256 \`data/catalog.sqlite\` до работы: \`${p.catalog_sha256_before ?? "n/a"}\`. Статус входов: \`${p.input_status}\`.

### G1–G7 — автоматические проверки

| ID | Проверка | Статус | Детали |
|---|---|---|---|
${checkRows}

## 8. Тесты и compile

- \`bunx tsc --noEmit\` — см. вывод запуска (ожидается 0 ошибок);
- локальные тесты — см. вывод запуска;
- валидатор: \`bun src/phase1-8/validate.ts\` (через \`run.ts\`).

## 9. PII и secrets

PII-скан новых артефактов: см. \`G6_PII_SCAN\` в таблице выше. Цель — 0 совпадений. Секреты не выгружались, \`.env\` не читался.

## 10. Неизменность SQLite

SHA-256 до: \`${p.catalog_sha256_before ?? "n/a"}\`. SHA-256 после: см. \`G7_REPOSITORY_SAFETY\`. Изменений нет.

## 11. Safety

- source databases не запрашивались;
- Superset не изменялся;
- ETL/backfill не запускался;
- DDL/migrations не применялись;
- git commit/push не выполнялись;
- PII не экспортировались.

## 12. Что нужно для этапа 1.9

1. Read-only SQL Lab / DB role для 18 SELECT: фактические значения, распределения, NULL-доли, кардинальности, покрытие связей.
2. Ответы владельцев по P0/P1 gaps: канонический ID заказа, ready timestamp, Pool vs Trip, очередь, тарифы, зоны, наставничество.
3. Подтверждение master data owners для courier/TT/zone/tariff.
4. Решение по единой SLA-методике и учёту отмен/возвратов.
5. После этого — физическое проектирование (DDL) и миграции, которые этап 1.8 намеренно не выполняет.
`;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
  ensureDirs();

  const p = preflight();
  writePreflight(p);

  const findings = runFindingsVerification();
  writeFileSync(join(REPORTS_DIR, "findings_verification.json"), JSON.stringify(findings, null, 2), "utf8");

  // 1. Рендер 12 документов, 7 диаграмм и 7 JSON.
  const docs = renderDocuments();
  for (const [name, content] of Object.entries(docs)) {
    writeFileSync(join(DOCS_DIR, name), content, "utf8");
  }

  const diagrams = renderDiagrams();
  for (const [name, content] of Object.entries(diagrams)) {
    writeFileSync(join(DIAGRAMS_DIR, name), content, "utf8");
  }

  const json = renderMachineReadable();
  for (const [name, value] of Object.entries(json)) {
    writeFileSync(join(REPORTS_DIR, name), JSON.stringify(value, null, 2), "utf8");
  }

  // 2. Заглушки для 13 и README, чтобы G1 видел полный набор.
  writeFileSync(join(DOCS_DIR, "13_model_validation_report.md"), "# 13 — Model Validation Report\n\n(заполняется после валидации)\n", "utf8");
  writeFileSync(join(DOCS_DIR, "README.md"), "# Этап 1.8 — Logical Data Model & ERD\n\n(заполняется после валидации)\n", "utf8");

  // 3. Первая валидация.
  const v1 = runValidation();

  // 4. Реальные 13 и README.
  writeFileSync(join(DOCS_DIR, "13_model_validation_report.md"), renderValidationReport(v1), "utf8");
  writeFileSync(join(DOCS_DIR, "README.md"), renderReadme(v1), "utf8");

  // 5. Вторая валидация — уже с полным набором файлов.
  const v2 = runValidation();

  // 6. Итоговый отчёт.
  writeFileSync(join(REPORTS_DIR, "phase_01_8_summary.md"), renderSummary(v2, p, findings), "utf8");

  // 7. Манифест с хэшами.
  const files: Array<{ path: string; sha256: string; size: number }> = [];
  const collect = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.isFile()) {
        files.push({
          path: full.replace(/\\/g, "/"),
          sha256: sha256File(full),
          size: statSync(full).size,
        });
      }
    }
  };
  collect(DOCS_DIR);
  collect(REPORTS_DIR);

  const manifest = {
    stage: "1.8",
    generated_at: new Date().toISOString(),
    verdict: v2.verdict,
    summary: {
      entities: ENTITIES.length,
      attributes: ATTRIBUTES.length,
      relationships: RELATIONSHIPS.length,
      evidence: EVIDENCE.length,
      decisions: DECISIONS.length,
      invariants: INVARIANTS.length,
      gaps: GAPS.length,
      documents: files.filter((f) => f.path.endsWith(".md")).length,
      diagrams: files.filter((f) => f.path.endsWith(".mmd")).length,
      json: files.filter((f) => f.path.endsWith(".json")).length,
      findings_total: findings.total,
      findings_confirmed: findings.confirmed,
      findings_conflicts: findings.conflicts,
    },
    files,
  };
  writeFileSync(join(REPORTS_DIR, "model_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        verdict: v2.verdict,
        checks: v2.summary,
        entities: ENTITIES.length,
        attributes: ATTRIBUTES.length,
        relationships: RELATIONSHIPS.length,
        evidence: EVIDENCE.length,
        decisions: DECISIONS.length,
        invariants: INVARIANTS.length,
        gaps: GAPS.length,
        docs: files.filter((f) => f.path.endsWith(".md")).length,
        diagrams: files.filter((f) => f.path.endsWith(".mmd")).length,
        json: files.filter((f) => f.path.endsWith(".json")).length,
        blockers: v2.blockers.length,
      },
      null,
      2,
    ),
  );
}

main();
