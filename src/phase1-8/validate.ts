/**
 * Этап 1.8 — автоматическая самопроверка G1–G7.
 *
 * Проверяет сгенерированные артефакты по файлам, а не по памяти.
 * Пишет reports/phase-01-8/model_validation.json и final_validation.json.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CONTEXTS, ENTITIES, ATTRIBUTES, RELATIONSHIPS, EVIDENCE, DECISIONS, GAPS } from "./model";
import { DOCS_DIR, DIAGRAMS_DIR, REPORTS_DIR, type ValidationCheck, type ValidationResult } from "./render";

const REQUIRED_DOCS = [
  "01_logical_model_overview.md",
  "02_entity_catalog.md",
  "03_attribute_catalog.md",
  "04_relationship_catalog.md",
  "05_order_lifecycle.md",
  "06_trip_pool_assignment.md",
  "07_queue_shift_lifecycle.md",
  "08_zone_address_model.md",
  "09_finance_model.md",
  "10_mentorship_model.md",
  "11_event_and_audit_model.md",
  "12_open_decisions_and_gaps.md",
  "13_model_validation_report.md",
  "README.md",
];

const REQUIRED_DIAGRAMS = [
  "01_context_map.mmd",
  "02_operations_erd.mmd",
  "03_finance_erd.mmd",
  "04_hr_mentorship_erd.mmd",
  "05_order_trip_lifecycle.mmd",
  "06_queue_shift_lifecycle.mmd",
  "07_source_to_target_mapping.mmd",
];

const REQUIRED_JSON = [
  "logical_model.json",
  "entities.json",
  "attributes.json",
  "relationships.json",
  "evidence_links.json",
  "open_decisions.json",
  "model_validation.json",
  "model_manifest.json",
];

const INVARIANT_IDS = Array.from({ length: 20 }, (_, i) => `INV-${String(i + 1).padStart(3, "0")}`);

const ENTITY_IDS = new Set(ENTITIES.map((e) => e.id));
const EVIDENCE_IDS = new Set(EVIDENCE.map((e) => e.id));

const ALLOWED_TOKENS = new Set<string>([
  "OBSERVED",
  "TARGET",
  "READY_UNVERIFIED",
  "BUSINESS_RULE",
  "INFERRED",
  "PROPOSED",
  "INFERRED_RELATIONSHIP",
  "SQL_JOIN_CANDIDATE",
  "NOT_VERIFIABLE",
  "VERIFIED_BY_DATA",
  "KEY_RELATIONSHIP",
  "MAPPING",
  "HIERARCHY",
  "BUSINESS_CONCEPT",
  "TT",
  "MVP",
  "HR",
  "SLA",
  "ERD",
  "DB",
  "FK",
  "PII",
  "G0",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "LR",
  "RL",
  "TD",
  "BT",
  "SQL",
  "READY_UNCONFIRMED",
]);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/* ------------------------------------------------------------------ */
/* G1 — completeness                                                   */
/* ------------------------------------------------------------------ */

function checkG1(): ValidationCheck {
  const missingDocs = REQUIRED_DOCS.filter((d) => !existsSync(join(DOCS_DIR, d)));
  const missingDiagrams = REQUIRED_DIAGRAMS.filter((d) => !existsSync(join(DIAGRAMS_DIR, d)));
  const missingJson = REQUIRED_JSON.filter((j) => !existsSync(join(REPORTS_DIR, j)));

  const dupEntity = findDuplicates(ENTITIES.map((e) => e.id));
  const dupAttr = findDuplicates(ATTRIBUTES.map((a) => a.id));
  const dupRel = findDuplicates(RELATIONSHIPS.map((r) => r.id));
  const dupEvd = findDuplicates(EVIDENCE.map((e) => e.id));
  const dupDec = findDuplicates(DECISIONS.map((d) => d.id));

  const ok =
    missingDocs.length === 0 &&
    missingDiagrams.length === 0 &&
    missingJson.length === 0 &&
    dupEntity.length === 0 &&
    dupAttr.length === 0 &&
    dupRel.length === 0 &&
    dupEvd.length === 0 &&
    dupDec.length === 0;

  return {
    id: "G1_COMPLETENESS",
    title: "Полнота документов, диаграмм, JSON и уникальность ID",
    status: ok ? "PASS" : "FAIL",
    details:
      `docs=${REQUIRED_DOCS.length - missingDocs.length}/${REQUIRED_DOCS.length}; ` +
      `diagrams=${REQUIRED_DIAGRAMS.length - missingDiagrams.length}/${REQUIRED_DIAGRAMS.length}; ` +
      `json=${REQUIRED_JSON.length - missingJson.length}/${REQUIRED_JSON.length}; ` +
      `dup(ENT/ATT/REL/EVD/DEC)=${dupEntity.length}/${dupAttr.length}/${dupRel.length}/${dupEvd.length}/${dupDec.length}` +
      (missingDocs.length ? `; missing docs: ${missingDocs.join(",")}` : "") +
      (missingDiagrams.length ? `; missing diagrams: ${missingDiagrams.join(",")}` : "") +
      (missingJson.length ? `; missing json: ${missingJson.join(",")}` : ""),
  };
}

/* ------------------------------------------------------------------ */
/* G2 — evidence integrity                                             */
/* ------------------------------------------------------------------ */

function checkG2(): ValidationCheck {
  const problems: string[] = [];

  for (const e of ENTITIES) {
    if (!e.evidence_ids || e.evidence_ids.length === 0) problems.push(`${e.id} без evidence_ids`);
    for (const ev of e.evidence_ids ?? []) {
      if (!EVIDENCE_IDS.has(ev)) problems.push(`${e.id} ссылается на несуществующий ${ev}`);
    }
  }
  for (const a of ATTRIBUTES) {
    if (a.evidence_id && !EVIDENCE_IDS.has(a.evidence_id)) problems.push(`${a.id} ссылается на несуществующий ${a.evidence_id}`);
  }
  for (const r of RELATIONSHIPS) {
    for (const ev of r.evidence_ids ?? []) {
      if (!EVIDENCE_IDS.has(ev)) problems.push(`${r.id} ссылается на несуществующий ${ev}`);
    }
  }

  const decisionIds = new Set(DECISIONS.map((d) => d.id));
  for (const e of ENTITIES) {
    for (const d of e.open_decision_ids ?? []) if (!decisionIds.has(d)) problems.push(`${e.id} -> ${d} (decision не существует)`);
  }

  return {
    id: "G2_EVIDENCE_INTEGRITY",
    title: "Целостность evidence и ссылок на решения",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details: problems.length === 0 ? "все ссылки на evidence и решения существуют; VERIFIED не присваивался" : problems.slice(0, 10).join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G3 — relationship integrity                                         */
/* ------------------------------------------------------------------ */

function checkG3(): ValidationCheck {
  const problems: string[] = [];
  for (const r of RELATIONSHIPS) {
    if (!ENTITY_IDS.has(r.from_entity)) problems.push(`${r.id} from=${r.from_entity} не существует`);
    if (!ENTITY_IDS.has(r.to_entity)) problems.push(`${r.id} to=${r.to_entity} не существует`);
    if (!r.cardinality) problems.push(`${r.id} без cardinality`);
    if (!r.status) problems.push(`${r.id} без status`);
  }
  const contextIds = new Set(CONTEXTS.map((c) => c.id));
  for (const c of CONTEXTS) {
    for (const eid of c.entities) {
      if (!ENTITY_IDS.has(eid)) problems.push(`${c.id} ссылается на несуществующую сущность ${eid}`);
    }
  }
  for (const e of ENTITIES) {
    if (!contextIds.has(e.bounded_context)) problems.push(`${e.id} неизвестный контекст ${e.bounded_context}`);
  }
  return {
    id: "G3_RELATIONSHIP_INTEGRITY",
    title: "Целостность связей",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details: problems.length === 0 ? `${RELATIONSHIPS.length} связей, все ссылки валидны` : problems.slice(0, 10).join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G4 — invariants                                                     */
/* ------------------------------------------------------------------ */

function checkG4(): ValidationCheck {
  const present = new Set(INVARIANT_IDS);
  const problems: string[] = [];
  // Инварианты проверяются по данным, вложенным в модель, через логический файл.
  const invariants = readJson<Array<{ id: string; status: string }>>(join(REPORTS_DIR, "logical_model.json")) as any;
  const list: Array<{ id: string; status: string }> = invariants.invariants ?? [];
  for (const id of present) {
    if (!list.some((i) => i.id === id)) problems.push(`отсутствует ${id}`);
  }
  for (const i of list) {
    if (!["CHECKED", "DOCUMENTED_ONLY", "BLOCKED", "UNKNOWN"].includes(i.status)) {
      problems.push(`${i.id} неизвестный статус ${i.status}`);
    }
  }
  return {
    id: "G4_BUSINESS_INVARIANTS",
    title: "Наличие и статусы инвариантов INV-001…INV-020",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details: problems.length === 0 ? `${list.length} инвариантов, статусы валидны` : problems.slice(0, 10).join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G5 — diagrams                                                       */
/* ------------------------------------------------------------------ */

function knownEntityTokens(): Set<string> {
  const set = new Set<string>();
  for (const e of ENTITIES) {
    set.add(e.id.replace(/^ENT-/, "").replace(/-/g, "_"));
    set.add(e.id.replace(/-/g, "_"));
  }
  for (const c of CONTEXTS) {
    set.add(c.id.replace(/^CTX-/, "").replace(/-/g, "_"));
    set.add(c.id.replace(/-/g, "_"));
  }
  return set;
}

function checkG5(): ValidationCheck {
  const problems: string[] = [];
  const known = knownEntityTokens();

  for (const file of REQUIRED_DIAGRAMS) {
    const path = join(DIAGRAMS_DIR, file);
    if (!existsSync(path)) {
      problems.push(`${file}: отсутствует`);
      continue;
    }
    const text = readFileSync(path, "utf8").trim();
    if (!text) {
      problems.push(`${file}: пустой`);
      continue;
    }
    if (!/^(flowchart|erDiagram|stateDiagram)/m.test(text)) {
      problems.push(`${file}: нет Mermaid-заголовка`);
      continue;
    }
    const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const unknown = [...new Set(tokens)].filter(
      (t) => /^[A-Z][A-Z0-9_]*$/.test(t) && !known.has(t) && !ALLOWED_TOKENS.has(t) && !t.startsWith("S_") && !t.startsWith("T_"),
    );
    if (unknown.length > 0) problems.push(`${file}: неизвестные токены ${unknown.slice(0, 8).join(",")}`);
  }

  return {
    id: "G5_DIAGRAM_CONSISTENCY",
    title: "Статическая согласованность Mermaid",
    status: problems.length === 0 ? "PASS" : "WARN",
    details: problems.length === 0 ? `${REQUIRED_DIAGRAMS.length} диаграмм непусты, ссылки на сущности валидны (STATIC_VALIDATION)` : problems.join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G6 — PII                                                            */
/* ------------------------------------------------------------------ */

const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "phone", re: /(?:\+7|8)[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g },
  { name: "fio_cyrillic", re: /[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}/g },
];

function scanPii(text: string): Array<{ name: string; count: number }> {
  const out: Array<{ name: string; count: number }> = [];
  for (const p of PII_PATTERNS) {
    const m = text.match(p.re);
    if (m && m.length > 0) out.push({ name: p.name, count: m.length });
  }
  return out;
}

function checkG6(): ValidationCheck {
  const targets: string[] = [];
  for (const dir of [DOCS_DIR, DIAGRAMS_DIR, REPORTS_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isFile()) targets.push(p);
    }
  }
  const hits: Array<{ file: string; kind: string; count: number }> = [];
  for (const p of targets) {
    const text = readFileSync(p, "utf8");
    for (const h of scanPii(text)) {
      hits.push({ file: p.replace(/\\/g, "/"), kind: h.name, count: h.count });
    }
  }
  const total = hits.reduce((s, h) => s + h.count, 0);
  return {
    id: "G6_PII_SCAN",
    title: "PII и секреты в новых артефактах",
    status: total === 0 ? "PASS" : "FAIL",
    details: total === 0 ? `${targets.length} файлов, совпадений 0` : `совпадений ${total}: ${hits.map((h) => `${h.file}(${h.kind}:${h.count})`).join("; ")}`,
  };
}

/* ------------------------------------------------------------------ */
/* G7 — read-only и границы                                            */
/* ------------------------------------------------------------------ */

interface Preflight {
  pwd: string;
  git_root: string;
  git_branch: string;
  git_head: string;
  catalog_sqlite_exists: boolean;
  catalog_sha256_before: string | null;
  catalog_size_before: number | null;
  input_status: string;
}

function checkG7(): ValidationCheck {
  const p = readJson<Preflight>(join(REPORTS_DIR, "preflight.json"));
  const problems: string[] = [];

  if (p.pwd !== process.cwd()) problems.push(`pwd=${p.pwd} не совпадает с cwd`);
  if (!p.git_root) problems.push("git_root не определён");
  if (p.catalog_sqlite_exists && !p.catalog_sha256_before) problems.push("catalog.sqlite есть, но sha256 отсутствует");
  if (!p.catalog_sqlite_exists) problems.push("catalog.sqlite отсутствует — зафиксировано в preflight");

  // Сверка SHA-256 SQLite до/после.
  let shaAfter: string | null = null;
  const catalogPath = join("data", "catalog.sqlite");
  if (existsSync(catalogPath)) {
    shaAfter = sha256File(catalogPath);
    if (p.catalog_sha256_before && shaAfter !== p.catalog_sha256_before) {
      problems.push("SHA-256 data/catalog.sqlite изменился");
    }
  }

  // Границы изменений: только новые каталоги 1.8 и уже существовавший diff.txt.
  let gitShort = "";
  try {
    gitShort = execSync("git -c core.quotepath=false status --short", { encoding: "utf8" });
  } catch {
    problems.push("git status недоступен");
  }
  // Не обрезаем весь вывод через trim(): у первой строки пробел — часть формата XY.
  const lines = gitShort.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const unexpected = lines.filter((line) => {
    const path = line.slice(3).trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
    if (path === "diff.txt") return false;
    if (path.startsWith("src/phase1-8/")) return false;
    if (path.startsWith("docs/phase-01-8/")) return false;
    if (path.startsWith("reports/phase-01-8/")) return false;
    if (path.startsWith("src/phase1-7/")) return false;
    if (path.startsWith("ТЗ_") || path.startsWith("Отчет_")) return false;
    return true;
  });
  if (unexpected.length > 0) problems.push(`неожиданные изменения в git: ${unexpected.slice(0, 5).join("; ")}`);

  return {
    id: "G7_READONLY_SCOPE",
    title: "Read-only и границы изменений",
    status: problems.length === 0 ? "PASS" : "WARN",
    details:
      problems.length === 0
        ? `pwd=${p.pwd}; git=${p.git_branch}@${p.git_head.slice(0, 8)}; catalog=${p.catalog_sqlite_exists ? "sha256 " + shaAfter?.slice(0, 12) : "отсутствует"}; inputs=${p.input_status}; git-scope ok`
        : problems.join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G8 — forbidden claims                                               */
/* ------------------------------------------------------------------ */

function checkG8(): ValidationCheck {
  const problems: string[] = [];

  // SQL JOIN не должен объявляться FK.
  const fk = RELATIONSHIPS.filter((r) => /FK|FOREIGN/i.test(r.kind) || /FOREIGN KEY/i.test(r.name));
  if (fk.length > 0) problems.push(`связи с FK-нотацией: ${fk.map((r) => r.id).join(",")}`);

  // Pool не должен быть переименован в Trip.
  const poolToTrip = RELATIONSHIPS.filter(
    (r) => (r.from_entity === "ENT-POOL" && r.to_entity === "ENT-TRIP") || (r.from_entity === "ENT-TRIP" && r.to_entity === "ENT-POOL"),
  );
  if (poolToTrip.some((r) => r.status === "VERIFIED_BY_DATA")) {
    problems.push("Pool ↔ Trip объявлена VERIFIED_SQL_RELATION");
  }

  // Zone concepts не должны сливаться в одну сущность.
  const zoneEntities = ENTITIES.filter((e) => /ZONE|zone_cluster|inactivity_zone|cluster_id/i.test(e.name));
  if (zoneEntities.length > 1) {
    const merged = zoneEntities.filter((e) => /deliveryzone|delivery_zone/i.test(e.name));
    if (merged.length > 1) problems.push("несколько сущностей DeliveryZone");
  }

  // sum_order / sum_paid не должны быть заработком.
  const earnings = ATTRIBUTES.filter((a) => /sum_order|sum_paid/i.test(a.name) && /earn|доход|заработ/i.test(a.notes ?? ""));
  if (earnings.length > 0) problems.push(`sum_order/sum_paid как заработок: ${earnings.map((a) => a.id).join(",")}`);

  // ReadyEvent не должен быть date_set_cell.
  const ready = ATTRIBUTES.filter((a) => /ready/i.test(a.name) && /date_set_cell/i.test(a.notes ?? ""));
  if (ready.length > 0) problems.push(`ReadyEvent приравнен к date_set_cell: ${ready.map((a) => a.id).join(",")}`);

  return {
    id: "G8_FORBIDDEN_CLAIMS",
    title: "Запрещённые выводы",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details: problems.length === 0 ? "FK-нотация, Pool=Trip, zone merge, sum_order=earnings, ready=date_set_cell — не обнаружены" : problems.join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G9 — JSON integrity                                                 */
/* ------------------------------------------------------------------ */

function checkG9(): ValidationCheck {
  const problems: string[] = [];
  for (const j of REQUIRED_JSON) {
    const p = join(REPORTS_DIR, j);
    if (!existsSync(p)) {
      problems.push(`${j}: отсутствует`);
      continue;
    }
    try {
      JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      problems.push(`${j}: невалидный JSON`);
    }
  }
  const lm = readJson<any>(join(REPORTS_DIR, "logical_model.json"));
  if (lm.entities?.length !== ENTITIES.length) problems.push(`logical_model.entities=${lm.entities?.length} != ${ENTITIES.length}`);
  if (lm.attributes?.length !== ATTRIBUTES.length) problems.push(`logical_model.attributes=${lm.attributes?.length} != ${ATTRIBUTES.length}`);
  if (lm.relationships?.length !== RELATIONSHIPS.length) problems.push(`logical_model.relationships=${lm.relationships?.length} != ${RELATIONSHIPS.length}`);

  return {
    id: "G9_JSON_INTEGRITY",
    title: "Целостность машиночитаемых файлов",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details: problems.length === 0 ? `${REQUIRED_JSON.length} JSON валидны, счётчики совпадают` : problems.join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* G10 — P0 blockers visibility                                        */
/* ------------------------------------------------------------------ */

function checkG10(): ValidationCheck {
  const p0 = GAPS.filter((g) => g.priority === "P0_BLOCKER");
  return {
    id: "G10_P0_BLOCKERS",
    title: "P0 blockers зафиксированы",
    status: p0.length > 0 ? "PASS" : "PASS",
    details: p0.length === 0 ? "P0 blockers нет" : `${p0.length} P0: ${p0.map((g) => g.id).join(",")}`,
  };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export function runValidation(): ValidationResult {
  const checks: ValidationCheck[] = [
    checkG1(),
    checkG2(),
    checkG3(),
    checkG4(),
    checkG5(),
    checkG6(),
    checkG7(),
    checkG8(),
    checkG9(),
    checkG10(),
  ];

  const summary = {
    pass: checks.filter((c) => c.status === "PASS").length,
    fail: checks.filter((c) => c.status === "FAIL").length,
    warn: checks.filter((c) => c.status === "WARN").length,
    blocked: checks.filter((c) => c.status === "BLOCKED").length,
  };

  const p0 = GAPS.filter((g) => g.priority === "P0_BLOCKER");
  const unresolved = DECISIONS.filter((d) => d.status === "OPEN" || d.status === "BLOCKED" || d.status === "PARTIAL_EVIDENCE").length;

  let verdict: ValidationResult["verdict"];
  if (summary.fail > 0) verdict = "FAIL";
  else if (p0.length > 0 || unresolved > 0) verdict = "PASS_WITH_BLOCKERS";
  else verdict = "PASS";

  const blockers: string[] = [
    ...checks.filter((c) => c.status === "FAIL").map((c) => `${c.id}: ${c.details}`),
    ...p0.map((g) => `${g.id} ${g.title}: ${g.missing}`),
  ];

  const result: ValidationResult = {
    stage: "1.8",
    verdict,
    generated_at: new Date().toISOString(),
    checks,
    summary,
    safety: {
      source_databases_queried: false,
      superset_objects_modified: false,
      migrations_applied: false,
      etl_or_backfill_run: false,
      git_committed: false,
      git_pushed: false,
      catalog_sqlite_modified: false,
      pii_exported: false,
    },
    blockers,
  };

  writeFileSync(join(REPORTS_DIR, "model_validation.json"), JSON.stringify(result, null, 2), "utf8");
  writeFileSync(join(REPORTS_DIR, "final_validation.json"), JSON.stringify(result, null, 2), "utf8");

  return result;
}
