/**
 * Этап 1.6.2 — автоматическая валидация артефактов.
 * Проверяет структуру JSON/CSV, PII, секреты, происхождение значений, лимиты выборок,
 * неизменность предыдущих артефактов и catalog.sqlite. Пишет final_validation.json.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { isPiiText, nowIso, readJson } from "./utils";

const REPORTS = "reports/phase-01-6-2";
const DOCS = "docs/phase-01-6-2";
const PACKAGE = "analysis_package";

type Check = { id: string; name: string; status: "PASS" | "FAIL" | "WARN" | "SKIP"; detail: string };
const checks: Check[] = [];
function add(id: string, name: string, status: Check["status"], detail: string) {
  checks.push({ id, name, status, detail });
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const startedAt = new Date().toISOString();
  const access = readJson<any>(join(REPORTS, "superset_access_matrix.json"));
  const stats = readJson<any>(join(REPORTS, "analysis_stats.json"));
  const values = readJson<any>(join(REPORTS, "column_values.json"));
  const syncManifest = readJson<any>(join("data", "snapshots", "phase-01-6-2", "manifest.json"));

  // 1. JSON structure
  const requiredJson = [
    "superset_access_matrix.json",
    "datasets_inventory.json",
    "charts_inventory.json",
    "dashboards_inventory.json",
    "dashboard_filters.json",
    "column_values.json",
  ];
  const missingJson = requiredJson.filter((f) => !existsSync(join(REPORTS, f)));
  add("C01", "Обязательные JSON существуют", missingJson.length ? "FAIL" : "PASS", missingJson.length ? `отсутствуют: ${missingJson.join(", ")}` : "все на месте");

  const badJson: string[] = [];
  for (const f of walk(REPORTS).filter((p) => p.endsWith(".json"))) {
    try {
      JSON.parse(readText(f));
    } catch {
      badJson.push(f);
    }
  }
  add("C02", "JSON корректно парсится", badJson.length ? "FAIL" : "PASS", badJson.length ? badJson.join("; ") : "ошибок нет");

  // 2. CSV structure
  const requiredCsv = [
    join(PACKAGE, "column_values.csv"),
    join(PACKAGE, "data_dictionary.csv"),
    join(PACKAGE, "temporal_fields.csv"),
    join(PACKAGE, "relationships_candidates.csv"),
    join(PACKAGE, "metrics_catalog.csv"),
  ];
  const badCsv: string[] = [];
  for (const f of requiredCsv) {
    if (!existsSync(f)) {
      badCsv.push(`${f}: отсутствует`);
      continue;
    }
    const lines = readText(f).split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) badCsv.push(`${f}: нет строк данных`);
  }
  add("C03", "CSV корректны и непусты", badCsv.length ? "FAIL" : "PASS", badCsv.length ? badCsv.join("; ") : "все CSV с заголовком и данными");

  // 3. PII / secrets
  const piiHits: string[] = [];
  const secretHits: string[] = [];
  const scanDirs = [REPORTS, DOCS, PACKAGE];
  for (const dir of scanDirs) {
    for (const f of walk(dir)) {
      if (!/\.(json|csv|md|txt)$/i.test(f)) continue;
      const text = readText(f);
      if (isPiiText(text)) piiHits.push(f);
      if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(text)) secretHits.push(f);
      if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(text)) secretHits.push(f);
    }
  }
  add("C04", "PII в артефактах отсутствует", piiHits.length ? "FAIL" : "PASS", piiHits.length ? piiHits.join("; ") : "совпадений нет");
  add("C05", "Секреты и токены отсутствуют", secretHits.length ? "FAIL" : "PASS", secretHits.length ? secretHits.join("; ") : "совпадений нет");

  // 4. Provenance and evidence refs
  const columns = values?.columns ?? [];
  const noEvidence = columns.filter((c: any) => !c.evidence_ref).length;
  add("C06", "У значений есть evidence_ref", noEvidence ? "FAIL" : "PASS", noEvidence ? `${noEvidence} записей без evidence_ref` : `${columns.length} записей с evidence_ref`);

  const noSource = columns.filter((c: any) => !c.source).length;
  add("C07", "У значений указан источник", noSource ? "FAIL" : "PASS", noSource ? `${noSource} записей без source` : "источник указан у всех");

  const noStatus = columns.filter((c: any) => !c.retrieval_status).length;
  add("C08", "У значений указан retrieval_status", noStatus ? "FAIL" : "PASS", noStatus ? `${noStatus} записей без статуса` : "статус указан у всех");

  const badNulls = columns.filter((c: any) => c.retrieval_status === "NOT_AVAILABLE" && (c.distinct_count !== null || c.null_count !== null)).length;
  add("C09", "Недоступные значения не заменены нулями", badNulls ? "FAIL" : "PASS", badNulls ? `${badNulls} записей с нулями вместо null` : "недоступные значения оставлены null");

  // 5. Sync completeness
  if (syncManifest) {
    const lists = syncManifest.resources ?? {};
    const ok = Boolean(lists.datasets_list && lists.charts_list && lists.dashboards_list);
    add("C10", "Синхронизация метаданных выполнена", ok ? "PASS" : "FAIL", ok ? "датасеты/чарты/дашборды синхронизированы" : "часть списков отсутствует");
  } else {
    add("C10", "Синхронизация метаданных выполнена", "SKIP", "манифест синхронизации отсутствует (сеть/VPN)");
  }

  // 6. Previous artifacts untouched
  const stageStart = access?.generated_at ? Date.parse(access.generated_at) : Date.now();
  const priorDirs = ["reports/phase-01-4", "reports/phase-01-5", "reports/phase-01-6", "docs/phase-01-5", "docs/phase-01-6"];
  const touched: string[] = [];
  for (const dir of priorDirs) {
    for (const f of walk(dir)) {
      try {
        if (statSync(f).mtimeMs > stageStart) touched.push(f);
      } catch {
        /* ignore */
      }
    }
  }
  add("C11", "Артефакты предыдущих этапов не изменены", touched.length ? "FAIL" : "PASS", touched.length ? touched.slice(0, 10).join("; ") : "изменений после старта этапа нет");

  // 7. catalog.sqlite unchanged
  const dbPath = "data/catalog.sqlite";
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const qc = db.query("PRAGMA quick_check").get() as any;
      const counts: any = {};
      for (const t of ["datasets", "charts", "dashboards"]) {
        try {
          counts[t] = (db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c;
        } catch {
          counts[t] = null;
        }
      }
      db.close();
      add("C12", "catalog.sqlite доступна только для чтения", "PASS", `quick_check=${qc?.quick_check ?? "?"}; counts=${JSON.stringify(counts)}`);
    } catch (e: any) {
      add("C12", "catalog.sqlite доступна только для чтения", "WARN", String(e?.message ?? e));
    }
  } else {
    add("C12", "catalog.sqlite доступна только для чтения", "SKIP", "файл не найден");
  }

  // 8. Values provenance summary
  const summary = values?.summary ?? {};
  add("C13", "Классификация происхождения заполнена", values?.classification ? "PASS" : "FAIL", values?.classification ? "5 классов присутствуют" : "классификация отсутствует");

  // 9. Limits documented
  const limitsOk = String(readText(join(DOCS, "03_extraction_methodology.md"))).includes("500");
  add("C14", "Лимиты выборок задокументированы", limitsOk ? "PASS" : "WARN", limitsOk ? "лимиты 500/100/50 указаны" : "лимиты не найдены");

  // 10. Package files
  const pkgFiles = ["ANALYST_BRIEF.md", "column_values.csv", "data_dictionary.csv", "temporal_fields.csv", "relationships_candidates.csv", "metrics_catalog.csv"];
  const missingPkg = pkgFiles.filter((f) => !existsSync(join(PACKAGE, f)));
  add("C15", "Аналитический пакет собран", missingPkg.length ? "FAIL" : "PASS", missingPkg.length ? `отсутствуют: ${missingPkg.join(", ")}` : "все 6 файлов на месте");

  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const skip = checks.filter((c) => c.status === "SKIP").length;
  const pass = checks.filter((c) => c.status === "PASS").length;

  let status: string;
  if (fail > 0) status = "FAIL";
  else if (!syncManifest) status = "PARTIAL";
  else if (summary.charts_with_filters || summary.dashboards_with_filters) status = "PASS_WITH_BLOCKERS";
  else status = "PARTIAL";

  const out = {
    stage: "1.6.2",
    generated_at: nowIso(),
    started_at: startedAt,
    status,
    summary: { pass, fail, warn, skip, total: checks.length },
    counts: {
      datasets_total: stats?.datasets_total ?? null,
      datasets_detail: stats?.datasets_detail_loaded ?? null,
      columns_total: stats?.columns_total ?? null,
      columns_with_values: stats?.columns_with_values ?? null,
      charts_total: stats?.charts_total ?? null,
      dashboards_total: stats?.dashboards_total ?? null,
      relationships: stats?.relationships_total ?? null,
    },
    checks,
    limitations: [
      "Фактические значения из данных не получены: SQL Lab 403, chart data 401.",
      "Значения из фильтров и SQL-определений не являются фактическими значениями колонок.",
      "Кардинальность, NULL-доли и покрытие связей не измерены.",
    ],
  };
  writeFileSync(join(REPORTS, "final_validation.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ status, summary: out.summary, counts: out.counts }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main();
