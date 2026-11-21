/**
 * Этап 1.5 — автопроверки модели, JSON Schema, Mermaid, fixtures, DDL и неизменности SQLite.
 * Пишет docs/phase-01-5/validation/* и reports/phase-01-5/final_validation.json.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TABLES, LIFECYCLES, LIFECYCLE_TABLES, INVARIANTS, type Col } from "./model";
import { EVENTS, EVENT_ENVELOPE_FIELDS, BUSINESS_DECISIONS, BUSINESS_RULES, MAPPING, MIGRATIONS } from "./registries";
import { scanPiiSafe } from "./pii";

const DOCS = "docs/phase-01-5";
const VAL = join(DOCS, "validation");
const REPORTS = "reports/phase-01-5";
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";

type Check = { id: string; status: "PASS" | "FAIL" | "WARN"; details: string };
const checks: Check[] = [];
const add = (id: string, status: Check["status"], details: string) => checks.push({ id, status, details });

function parseOpts(opts?: string) {
  const o = { pk: false, nn: false, uq: false, tbd: false, fk: null as string | null, def: null as string | null };
  if (!opts) return o;
  for (const t of opts.split(",").map((x) => x.trim())) {
    if (t === "pk") o.pk = true;
    else if (t === "nn") o.nn = true;
    else if (t === "uq") o.uq = true;
    else if (t === "tbd") o.tbd = true;
    else if (t.startsWith("fk:")) o.fk = t.slice(3);
    else if (t.startsWith("def:")) o.def = t.slice(4);
  }
  return o;
}

function readJson(path: string): any | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}

function main() {
  mkdirSync(VAL, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });

  // --- 1. Таблицы ---
  const tableNames = new Set(TABLES.map((t) => t.name));
  add("tables_unique", tableNames.size === TABLES.length ? "PASS" : "FAIL", `tables=${TABLES.length}, unique=${tableNames.size}`);

  const noPk = TABLES.filter((t) => !t.cols.some((c) => parseOpts(c[2]).pk)).map((t) => t.name);
  add("every_table_has_pk", noPk.length === 0 ? "PASS" : "FAIL", noPk.length ? `no PK: ${noPk.join(", ")}` : "у каждой таблицы есть PK");

  const dupCols: string[] = [];
  for (const t of TABLES) {
    const names = t.cols.map((c) => c[0]);
    if (new Set(names).size !== names.length) dupCols.push(t.name);
  }
  add("columns_unique_in_table", dupCols.length === 0 ? "PASS" : "FAIL", dupCols.length ? `дубли колонок: ${dupCols.join(", ")}` : "колонки уникальны");

  // --- 2. FK ---
  const badFk: string[] = [];
  const typeMismatch: string[] = [];
  for (const t of TABLES) {
    for (const [name, type, opts] of t.cols) {
      const o = parseOpts(opts);
      if (!o.fk) continue;
      const [pt, pc] = o.fk.split(".");
      const parent = TABLES.find((x) => x.name === pt);
      if (!parent) {
        badFk.push(`${t.name}.${name} -> ${o.fk} (нет таблицы)`);
        continue;
      }
      const pcol = parent.cols.find((c) => c[0] === pc);
      if (!pcol) {
        badFk.push(`${t.name}.${name} -> ${o.fk} (нет колонки)`);
        continue;
      }
      if (pcol[1] !== type) typeMismatch.push(`${t.name}.${name}(${type}) -> ${pt}.${pc}(${pcol[1]})`);
    }
  }
  add("fk_targets_exist", badFk.length === 0 ? "PASS" : "FAIL", badFk.length ? badFk.join("; ") : "все FK указывают на существующие таблицы/колонки");
  add("fk_types_compatible", typeMismatch.length === 0 ? "PASS" : "FAIL", typeMismatch.length ? typeMismatch.join("; ") : "типы FK совместимы");

  // --- 3. статусы и жизненные циклы ---
  const lifecycleProblems: string[] = [];
  for (const [name, lc] of Object.entries(LIFECYCLES)) {
    const table = TABLES.find((t) => t.name === LIFECYCLE_TABLES[name]);
    if (!table?.statuses) {
      lifecycleProblems.push(`${name}: нет таблицы со статусами`);
      continue;
    }
    const known = new Set(table.statuses);
    for (const s of lc.states) if (!known.has(s)) lifecycleProblems.push(`${name}: состояние ${s} отсутствует в ${table.name}.statuses`);
  }
  add("lifecycle_states_defined", lifecycleProblems.length === 0 ? "PASS" : "FAIL", lifecycleProblems.length ? lifecycleProblems.join("; ") : "состояния жизненных циклов описаны в таблицах");

  // --- 4. события ---
  const eventTypes = EVENTS.map((e) => e.type);
  add("events_unique", new Set(eventTypes).size === eventTypes.length ? "PASS" : "FAIL", `events=${EVENTS.length}, unique=${new Set(eventTypes).size}`);
  const badPayload = EVENTS.filter((e) => !e.payload.length).map((e) => e.type);
  add("events_payload_nonempty", badPayload.length === 0 ? "PASS" : "FAIL", badPayload.length ? `пустой payload: ${badPayload.join(", ")}` : "у всех событий есть payload");
  const groups = new Set(["orders", "zones", "couriers_shifts", "trips_assignments", "finance", "mentorship"]);
  const badGroup = EVENTS.filter((e) => !groups.has(e.group)).map((e) => e.type);
  add("events_groups_valid", badGroup.length === 0 ? "PASS" : "FAIL", badGroup.length ? `неверная группа: ${badGroup.join(", ")}` : "группы событий корректны");

  // --- 5. инварианты ---
  const badInvTables = INVARIANTS.flatMap((i) => i.tables.filter((t) => !tableNames.has(t)).map((t) => `${i.id}:${t}`));
  add("invariants_reference_tables", badInvTables.length === 0 ? "PASS" : "FAIL", badInvTables.length ? badInvTables.join(", ") : `инвариантов ${INVARIANTS.length}, таблицы существуют`);

  // --- 6. mapping ---
  const badMapping = MAPPING.filter((m) => !tableNames.has(m.domain_table)).map((m) => m.domain_table);
  add("mapping_domain_tables_exist", badMapping.length === 0 ? "PASS" : "FAIL", badMapping.length ? `неизвестные таблицы: ${[...new Set(badMapping)].join(", ")}` : `mapping строк=${MAPPING.length}`);
  const directNoDataset = MAPPING.filter((m) => m.evidence === "DIRECT" && m.superset_dataset === null).map((m) => `${m.domain_table}.${m.domain_column}`);
  add("direct_mapping_has_source", directNoDataset.length === 0 ? "PASS" : "FAIL", directNoDataset.length ? `DIRECT без dataset: ${directNoDataset.join(", ")}` : "DIRECT-строки имеют источник");

  // --- 7. миграции ---
  const migProblems: string[] = [];
  const seenTables = new Set<string>();
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i];
    for (const d of m.depends_on) if (!MIGRATIONS.slice(0, i).some((x) => x.id === d)) migProblems.push(`${m.id}: зависимость ${d} не найдена раньше`);
    for (const t of m.tables) {
      if (!tableNames.has(t)) migProblems.push(`${m.id}: таблица ${t} не существует`);
      if (seenTables.has(t)) migProblems.push(`${m.id}: таблица ${t} уже в другой миграции`);
      seenTables.add(t);
    }
  }
  const missingTables = TABLES.filter((t) => !seenTables.has(t.name)).map((t) => t.name);
  if (missingTables.length) migProblems.push(`таблицы без миграции: ${missingTables.join(", ")}`);
  add("migrations_cover_tables", migProblems.length === 0 ? "PASS" : "FAIL", migProblems.length ? migProblems.join("; ") : "все таблицы покрыты ровно одной миграцией");

  // --- 8. JSON Schema ---
  const schemaProblems: string[] = [];
  const schemaDir = join(DOCS, "schemas");
  const envelope = readJson(join(schemaDir, "event-envelope.schema.json"));
  if (!envelope || envelope.$schema !== "https://json-schema.org/draft/2020-12/schema") schemaProblems.push("event-envelope.schema.json отсутствует или неверная $schema");
  else {
    for (const f of EVENT_ENVELOPE_FIELDS) if (!envelope.properties?.[f]) schemaProblems.push(`envelope: нет свойства ${f}`);
  }
  const eventSchemaDir = join(schemaDir, "events");
  for (const f of existsSync(eventSchemaDir) ? readdirSync(eventSchemaDir) : []) {
    const s = readJson(join(eventSchemaDir, f));
    const type = f.replace(".schema.json", "");
    const e = EVENTS.find((x) => x.type === type);
    if (!s || !e) {
      schemaProblems.push(`${f}: схема или событие не найдены`);
      continue;
    }
    for (const p of e.payload) if (!s.properties?.payload?.properties?.[p]) schemaProblems.push(`${f}: payload.${p} отсутствует`);
  }
  add("json_schemas_valid", schemaProblems.length === 0 ? "PASS" : "FAIL", schemaProblems.length ? schemaProblems.join("; ") : "JSON Schema конверта и ключевых событий корректны");

  // --- 9. Mermaid ---
  const mmdProblems: string[] = [];
  const mmdFiles = ["06_er_model.mmd", "07_order_lifecycle.mmd", "08_trip_and_queue_lifecycle.mmd", "09_financial_flow.mmd"];
  for (const f of mmdFiles) {
    const p = join(DOCS, f);
    if (!existsSync(p)) {
      mmdProblems.push(`${f}: отсутствует`);
      continue;
    }
    const text = readFileSync(p, "utf8");
    if (!/^\s*(erDiagram|stateDiagram-v2|sequenceDiagram|graph )/m.test(text)) mmdProblems.push(`${f}: неизвестный заголовок`);
    if (f === "06_er_model.mmd") {
      const blocks = (text.match(/^\s{2}[A-Z_]+ \{$/gm) ?? []).length;
      const closes = (text.match(/^\s{2}\}$/gm) ?? []).length;
      if (blocks !== closes || blocks !== TABLES.length) mmdProblems.push(`${f}: блоков ${blocks}, закрытий ${closes}, таблиц ${TABLES.length}`);
    }
    if (f === "07_order_lifecycle.mmd") {
      for (const s of LIFECYCLES.order.states) if (!text.includes(s)) mmdProblems.push(`${f}: нет состояния ${s}`);
    }
    if (f === "08_trip_and_queue_lifecycle.mmd") {
      for (const s of LIFECYCLES.queue.states) if (!text.includes(s)) mmdProblems.push(`${f}: нет состояния ${s}`);
    }
  }
  add("mermaid_valid", mmdProblems.length === 0 ? "PASS" : "FAIL", mmdProblems.length ? mmdProblems.join("; ") : "Mermaid-схемы корректны");

  // --- 10. fixtures и PII ---
  const fixtureDir = join(DOCS, "fixtures");
  const fixtureProblems: string[] = [];
  let fixtureRows = 0;
  for (const f of existsSync(fixtureDir) ? readdirSync(fixtureDir).filter((x) => x.endsWith(".json")) : []) {
    const text = readFileSync(join(fixtureDir, f), "utf8");
    try {
      const parsed = JSON.parse(text);
      fixtureRows += Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      fixtureProblems.push(`${f}: не JSON`);
      continue;
    }
    const hits = scanPiiSafe(text);
    for (const h of hits) fixtureProblems.push(`${f}: ${h.name}`);
  }
  add("fixtures_no_pii", fixtureProblems.length === 0 ? "PASS" : "FAIL", fixtureProblems.length ? fixtureProblems.join("; ") : `fixtures: ${fixtureRows} строк, PII нет`);

  // --- 11. DDL draft ---
  const ddlProblems: string[] = [];
  let ddlTables = 0;
  const ddlDir = join(DOCS, "ddl", "postgres");
  for (const m of MIGRATIONS) {
    const p = join(ddlDir, `${m.id}_${m.name}.sql`);
    if (!existsSync(p)) {
      ddlProblems.push(`${m.id}_${m.name}.sql отсутствует`);
      continue;
    }
    const text = readFileSync(p, "utf8");
    if (!/DRAFT ONLY/.test(text)) ddlProblems.push(`${m.id}: нет пометки DRAFT`);
    for (const t of m.tables) {
      if (!new RegExp(`CREATE TABLE ${t}\\b`).test(text)) ddlProblems.push(`${m.id}: нет CREATE TABLE ${t}`);
      else ddlTables++;
    }
  }
  add("ddl_draft_valid", ddlProblems.length === 0 ? "PASS" : "FAIL", ddlProblems.length ? ddlProblems.join("; ") : `DDL draft: ${ddlTables} таблиц, все с пометкой DRAFT`);

  const badDefaults: string[] = [];
  for (const m of MIGRATIONS) {
    const p = join(ddlDir, `${m.id}_${m.name}.sql`);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const match of text.matchAll(/DEFAULT\s+([A-Za-z_][A-Za-z0-9_/]*)/g)) {
      const token = match[1];
      if (!["now", "true", "false", "null"].includes(token.toLowerCase())) badDefaults.push(`${m.id}: DEFAULT ${token}`);
    }
  }
  add("ddl_defaults_quoted", badDefaults.length === 0 ? "PASS" : "FAIL", badDefaults.length ? badDefaults.join("; ") : "строковые DEFAULT заключены в кавычки");

  // --- 12. решения и правила ---
  const decisionIds = BUSINESS_DECISIONS.map((d) => d.id);
  add("decisions_unique", new Set(decisionIds).size === decisionIds.length ? "PASS" : "FAIL", `decisions=${BUSINESS_DECISIONS.length}, unique=${new Set(decisionIds).size}`);
  add("business_rules_present", BUSINESS_RULES.length > 0 ? "PASS" : "FAIL", `business_rules=${BUSINESS_RULES.length}, agreed=${BUSINESS_RULES.filter((r) => r.status === "AGREED").length}, tbd=${BUSINESS_RULES.filter((r) => r.status === "TBD").length}`);

  // --- 13. generator writes only allowed paths ---
  const allowedPrefixes = ["docs/phase-01-5", "reports/phase-01-5"];
  const writeProblems: string[] = [];
  const srcDir = "src/phase1-5";
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".ts"))) {
    const text = readFileSync(join(srcDir, f), "utf8");
    for (const m of text.matchAll(/w\(\s*[`"]([^`"]+)[`"]/g)) {
      const target = join(DOCS, m[1]);
      if (!allowedPrefixes.some((p) => target.replace(/\\/g, "/").startsWith(p))) writeProblems.push(`${f}: ${target}`);
    }
    for (const m of text.matchAll(/join\(ROOT,\s*[`"]([^`"]+)[`"]/g)) {
      const target = join(DOCS, m[1]);
      if (!allowedPrefixes.some((p) => target.replace(/\\/g, "/").startsWith(p))) writeProblems.push(`${f}: ${target}`);
    }
  }
  add("writer_paths_allowed", writeProblems.length === 0 ? "PASS" : "FAIL", writeProblems.length ? `запись вне разрешённых путей: ${writeProblems.join(", ")}` : "генератор пишет только в docs/phase-01-5");

  // --- 14. SQLite неизменность ---
  let sqliteOk = false;
  try {
    const db = new Database(DB, { readonly: true });
    const cur = db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[];
    const rel = Number((db.query("SELECT COUNT(*) c FROM relations").get() as any).c);
    db.close();
    const sort = (rows: any[]) => JSON.stringify([...rows].sort((a, b) => String(a.object_type).localeCompare(String(b.object_type))).map((r) => [r.object_type, Number(r.c)]));
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bak = b.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[];
      const brel = Number((b.query("SELECT COUNT(*) c FROM relations").get() as any).c);
      b.close();
      sqliteOk = sort(cur) === sort(bak) && rel === brel;
    }
  } catch {
    sqliteOk = false;
  }
  add("catalog_sqlite_unchanged", sqliteOk ? "PASS" : "FAIL", sqliteOk ? "counts совпадают с backup" : "SQLite отличается от backup или недоступна");

  // --- 15. TypeScript и тесты ---
  let tscOk = false;
  let testsOk = false;
  try {
    tscOk = (Bun.spawnSync(["bunx", "tsc", "--noEmit"], { stdio: ["ignore", "pipe", "pipe"] as const }).exitCode ?? 1) === 0;
  } catch { tscOk = false; }
  try {
    testsOk = (Bun.spawnSync([process.execPath, "test", "src/phase1-5/tests"], { stdio: ["ignore", "pipe", "pipe"] as const }).exitCode ?? 1) === 0;
  } catch { testsOk = false; }
  add("typescript_compile", tscOk ? "PASS" : "FAIL", tscOk ? "bunx tsc --noEmit exit 0" : "tsc failed");
  add("model_tests", testsOk ? "PASS" : "FAIL", testsOk ? "локальные тесты модели пройдены" : "тесты модели не пройдены");

  // --- 16. PII по всем артефактам этапа ---
  const docPii: string[] = [];
  const walk = (dir: string) => {
    for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json|csv|mmd|sql|txt)$/i.test(e.name)) {
        for (const h of scanPiiSafe(readFileSync(p, "utf8"))) docPii.push(`${p.replace(/\\/g, "/")}: ${h.name}`);
      }
    }
  };
  walk(DOCS);
  walk(REPORTS);
  add("docs_no_pii", docPii.length === 0 ? "PASS" : "FAIL", docPii.length ? docPii.join("; ") : "PII/секретов в артефактах этапа нет");

  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const status = fail > 0 ? "FAIL" : warn > 0 ? "PASS_WITH_WARNINGS" : "PASS";

  const out = {
    phase: "1.5",
    status,
    generated_at: new Date().toISOString(),
    counts: {
      tables: TABLES.length,
      events: EVENTS.length,
      business_decisions: BUSINESS_DECISIONS.length,
      business_rules: BUSINESS_RULES.length,
      mapping_rows: MAPPING.length,
      migrations: MIGRATIONS.length,
      invariants: INVARIANTS.length,
      lifecycles: Object.keys(LIFECYCLES).length,
      fixtures_rows: fixtureRows,
      ddl_tables: ddlTables,
    },
    gates: {
      G0: existsSync(join(DOCS, "repository_audit.md")) && existsSync(join(DOCS, "00_scope_and_assumptions.md")) ? "PASS" : "FAIL",
      G1: existsSync(join(DOCS, "01_business_rules_register.md")) && existsSync(join(DOCS, "02_business_decisions_register.md")) && existsSync(join(DOCS, "03_domain_glossary.md")) ? "PASS" : "FAIL",
      G2: existsSync(join(DOCS, "06_er_model.mmd")) ? "PASS" : "FAIL",
      G3: existsSync(join(DOCS, "04_logical_data_model.md")) ? "PASS" : "FAIL",
      G4: existsSync(join(DOCS, "10_event_catalog.md")) && existsSync(join(DOCS, "schemas", "event-envelope.schema.json")) ? "PASS" : "FAIL",
      G5: existsSync(join(DOCS, "05_physical_data_model.md")) && existsSync(join(DOCS, "ddl", "postgres")) ? "PASS" : "FAIL",
      G6: existsSync(join(DOCS, "14_superset_mapping.md")) && existsSync(join(DOCS, "15_source_of_truth_matrix.csv")) ? "PASS" : "FAIL",
      G7: existsSync(join(DOCS, "17_migration_plan.md")) && existsSync(join(DOCS, "19_security_and_pii.md")) && existsSync(join(DOCS, "20_open_questions.md")) ? "PASS" : "FAIL",
    },
    checks,
    summary: { pass: checks.filter((c) => c.status === "PASS").length, fail, warn },
  };

  write(join(VAL, "model_validation.json"), JSON.stringify(out, null, 2));
  write(join(VAL, "schema_lint.json"), JSON.stringify({ generated_at: out.generated_at, schema_problems: schemaProblems, mermaid_problems: mmdProblems, ddl_problems: ddlProblems }, null, 2));
  write(join(VAL, "model_validation.md"), [
    "# Валидация модели (Этап 1.5)",
    "",
    `Статус: **${status}**`,
    "",
    ...checks.map((c) => `- [${c.status}] ${c.id} — ${c.details}`),
    "",
  ].join("\n"));
  write(join(REPORTS, "final_validation.json"), JSON.stringify({ phase: "1.5", status, gates: out.gates, counts: out.counts, checks, summary: out.summary }, null, 2));

  console.log(JSON.stringify({ status, gates: out.gates, counts: out.counts, summary: out.summary }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main();
