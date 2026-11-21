/**
 * Этап 1.5 — генератор документации и draft-DDL из канонической модели.
 * Не выполняет миграции, не подключается к БД, пишет только в docs/phase-01-5/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TABLES, LIFECYCLES, INVARIANTS, type Col, type TableSpec } from "./model";
import {
  EVENTS,
  EVENT_ENVELOPE_FIELDS,
  BUSINESS_DECISIONS,
  BUSINESS_RULES,
  GLOSSARY,
  PII_POLICY,
  SOURCE_OF_TRUTH,
  MAPPING,
  MIGRATIONS,
} from "./registries";

const ROOT = "docs/phase-01-5";

function w(path: string, content: string) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, { mode: 0o600 });
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

type Opts = { pk: boolean; nn: boolean; uq: boolean; tbd: boolean; fk: string | null; def: string | null };
function parseOpts(opts?: string): Opts {
  const o: Opts = { pk: false, nn: false, uq: false, tbd: false, fk: null, def: null };
  if (!opts) return o;
  for (const token of opts.split(",")) {
    const t = token.trim();
    if (t === "pk") o.pk = true;
    else if (t === "nn") o.nn = true;
    else if (t === "uq") o.uq = true;
    else if (t === "tbd") o.tbd = true;
    else if (t.startsWith("fk:")) o.fk = t.slice(3);
    else if (t.startsWith("def:")) o.def = t.slice(4);
  }
  return o;
}

function pgType(t: Col[1]): string {
  switch (t) {
    case "UUID": return "uuid";
    case "TEXT": return "text";
    case "INTEGER": return "integer";
    case "BIGINT": return "bigint";
    case "BOOLEAN": return "boolean";
    case "TIMESTAMPTZ": return "timestamptz";
    case "DATE": return "date";
    case "NUMERIC": return "numeric(14,2)";
    case "JSONB": return "jsonb";
    case "GEOGRAPHY": return "geography(POLYGON,4326)";
    case "DOUBLE": return "double precision";
  }
}
function sqliteType(t: Col[1]): string {
  switch (t) {
    case "UUID": return "TEXT";
    case "TEXT": return "TEXT";
    case "INTEGER": return "INTEGER";
    case "BIGINT": return "INTEGER";
    case "BOOLEAN": return "INTEGER";
    case "TIMESTAMPTZ": return "TEXT";
    case "DATE": return "TEXT";
    case "NUMERIC": return "NUMERIC";
    case "JSONB": return "TEXT";
    case "GEOGRAPHY": return "TEXT";
    case "DOUBLE": return "REAL";
  }
}

function tableByName(name: string): TableSpec | undefined {
  return TABLES.find((t) => t.name === name);
}

// ---------------------------------------------------------------- logical model MD

function logicalModelMd(): string {
  const lines: string[] = [];
  lines.push("# 04. Логическая модель данных");
  lines.push("");
  lines.push(`Таблиц: **${TABLES.length}**. <ФИО> — проектная; статусы источников указаны в mapping.`);
  lines.push("");
  lines.push("## Реестр таблиц");
  lines.push("");
  lines.push("| Таблица | ***REMOVED*** | Зерно | PK | Владелец |");
  lines.push("|---|---|---|---|---|");
  for (const t of TABLES) {
    const pk = t.cols.filter((c) => parseOpts(c[2]).pk).map((c) => c[0]).join(", ");
    lines.push(`| ${t.name} | ${t.context} | ${t.grain} | ${pk} | ${t.owner} |`);
  }
  lines.push("");
  for (const t of TABLES) {
    lines.push(`## ${t.name} — ${t.title}`);
    lines.push("");
    lines.push(`- *****REMOVED***:** ${t.context}`);
    lines.push(`- **Назначение:** ${t.purpose}`);
    lines.push(`- **Зерно:** ${t.grain}`);
    lines.push(`- **Владелец:** ${t.owner}`);
    lines.push(`- **Источник Superset:** ${t.superset}`);
    if (t.statuses?.length) lines.push(`- **Статусы:** ${t.statuses.join(", ")}`);
    if (t.tbd?.length) lines.push(`- **TBD:** ${t.tbd.join("; ")}`);
    lines.push("");
    lines.push("| Поле | Тип | Null | PK | FK | Unique | Default | TBD |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const [name, type, opts] of t.cols) {
      const o = parseOpts(opts);
      lines.push(`| ${name} | ${type} | ${o.nn ? "NOT NULL" : "NULL"} | ${o.pk ? "PK" : ""} | ${o.fk ?? ""} | ${o.uq ? "UNIQUE" : ""} | ${o.def ?? ""} | ${o.tbd ? "TBD" : ""} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function physicalModelMd(): string {
  const lines: string[] = [];
  lines.push("# 05. Физическая модель (DRAFT)");
  lines.push("");
  lines.push("**СУБД:** рекомендуется PostgreSQL 15+ (см. `21_adr/ADR-001-database-choice.md`). SQLite — только прототип.");
  lines.push("");
  lines.push("## Типы");
  lines.push("");
  lines.push("| Логический тип | PostgreSQL | SQLite (прототип) |");
  lines.push("|---|---|---|");
  for (const t of ["UUID", "TEXT", "INTEGER", "BIGINT", "BOOLEAN", "TIMESTAMPTZ", "DATE", "NUMERIC", "JSONB", "GEOGRAPHY", "DOUBLE"] as Col[1][]) {
    lines.push(`| ${t} | ${pgType(t)} | ${sqliteType(t)} |`);
  }
  lines.push("");
  lines.push("## Решения");
  lines.push("");
  lines.push("- Время — `timestamptz`, хранение в UTC.");
  lines.push("- Деньги — `numeric(14,2)` + `currency`.");
  lines.push("- Геоданные — PostGIS `geography`; альтернатива — `jsonb` с GeoJSON, если PostGIS недоступен (TBD BD-018).");
  lines.push("- JSON — `jsonb` с JSON Schema валидацией на уровне приложения.");
  lines.push("- Append-only события — без UPDATE/DELETE (права БД + триггеры опционально).");
  lines.push("- Частичные уникальные индексы — PostgreSQL `WHERE`; в SQLite эмулируются транзакцией.");
  lines.push("");
  lines.push("## Индексы и ограничения");
  lines.push("");
  lines.push("См. `13_indexes_and_constraints.md` и `ddl/postgres/*.sql` (DRAFT).");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------- mermaid

function erMmd(): string {
  const lines: string[] = ["erDiagram"];
  for (const t of TABLES) {
    lines.push(`  ${t.name.toUpperCase()} {`);
    for (const [name, type, opts] of t.cols) {
      const o = parseOpts(opts);
      const key = o.pk ? "PK" : o.fk ? "FK" : o.uq ? "UK" : "";
      lines.push(`    ${type.toLowerCase()} ${name} ${key}`.trimEnd());
    }
    lines.push("  }");
  }
  for (const t of TABLES) {
    for (const [name, , opts] of t.cols) {
      const o = parseOpts(opts);
      if (!o.fk) continue;
      const [pt, pc] = o.fk.split(".");
      const card = o.nn ? "||--o{" : "|o--o{";
      lines.push(`  ${pt.toUpperCase()} ${card} ${t.name.toUpperCase()} : "${name}"`);
    }
  }
  lines.push("");
  lines.push("  %% PK/FK/UK — из логической модели; SQL JOIN из Superset не считается FK.");
  return lines.join("\n") + "\n";
}

function orderLifecycleMmd(): string {
  return `stateDiagram-v2
  [*] --> RECEIVED
  RECEIVED --> ACCEPTED : ORDER_ACCEPTED
  ACCEPTED --> COLLECTING : COLLECTION_STARTED
  COLLECTING --> COLLECTED : COLLECTION_COMPLETED
  COLLECTED --> READY : ORDER_READY (подтверждённое событие)
  READY --> ASSIGNED : ORDER_ASSIGNED_TO_TRIP
  ASSIGNED --> IN_DELIVERY : ORDER_DELIVERY_STARTED
  IN_DELIVERY --> DELIVERED : ORDER_DELIVERED
  IN_DELIVERY --> CANCELLED : ORDER_CANCELLED
  IN_DELIVERY --> RETURNED : ORDER_RETURNED
  IN_DELIVERY --> EXCEPTION : TRIP_EXCEPTION_RECORDED
  ASSIGNED --> READY : ORDER_REMOVED_FROM_TRIP
  DELIVERED --> [*]
  CANCELLED --> [*]
  RETURNED --> [*]
  EXCEPTION --> [*]
  note right of READY : Без подтверждённого order_ready переход запрещён (BD-013)
`;
}

function tripQueueMmd(): string {
  return `stateDiagram-v2
  state "***REMOVED***" as T {
    [*] --> DRAFT
    DRAFT --> FORMED : TRIP_FORMED
    FORMED --> ASSIGNED : TRIP_ASSIGNED
    ASSIGNED --> DEPARTED : TRIP_DEPARTED (состав блокируется)
    DEPARTED --> IN_PROGRESS
    IN_PROGRESS --> RETURNED : TRIP_RETURNED
    IN_PROGRESS --> COMPLETED : TRIP_COMPLETED
    ASSIGNED --> FORMED : TRIP_ASSIGNMENT_CANCELLED
    DRAFT --> CANCELLED
    IN_PROGRESS --> EXCEPTION
  }  state "***REMOVED***" as Q {
    [*] --> WAITING : COURIER_JOINED_QUEUE
    WAITING --> OFFERED
    OFFERED --> ASSIGNED
    WAITING --> SKIPPED : COURIER_SKIPPED_IN_QUEUE
    SKIPPED --> WAITING : возврат (BD-004)
    WAITING --> PAUSED : COURIER_QUEUE_PAUSED
    PAUSED --> WAITING : COURIER_QUEUE_RESUMED
    WAITING --> LEFT : курьер покинул очередь
    ASSIGNED --> CLOSED
  }
`;
}

function financialFlowMmd(): string {
  return `sequenceDiagram
  participant C as Курьер
  participant OS as <ФИО> система
  participant T as tariff_versions
  participant A as courier_accruals
  participant F as Finance
  C->>OS: доставка подтверждена
  OS->>OS: ORDER_DELIVERED (идемпотентно)
  OS->>T: выбрать действующую версию тарифа на момент доставки
  alt Тариф найден
    OS->>A: создать начисление (PENDING) + calculation_basis
    A->>F: COURIER_ACCRUAL_CREATED
    F->>A: APPROVED / PAID / REVERSED
  else Тариф не утверждён
    OS->>A: начисление ON_HOLD (доставка не теряется)
  end
  Note over A,F: Корректировки — отдельные записи (accrual_adjustments), исходное начисление не меняется
`;
}

// ---------------------------------------------------------------- events

function eventCatalogMd(): string {
  const lines: string[] = [];
  lines.push("# 10. Каталог событий");
  lines.push("");
  lines.push(`Событий: **${EVENTS.length}**. Обязательные поля конверта: ${EVENT_ENVELOPE_FIELDS.join(", ")}.`);
  lines.push("");
  const groups = ["orders", "zones", "couriers_shifts", "trips_assignments", "finance", "mentorship"];
  for (const g of groups) {
    lines.push(`## ${g}`);
    lines.push("");
    lines.push("| Событие | Агрегат | Payload | Идемпотентность | Примечание |");
    lines.push("|---|---|---|---|---|");
    for (const e of EVENTS.filter((x) => x.group === g)) {
      lines.push(`| ${e.type} | ${e.aggregate} | ${e.payload.join(", ")} | ${e.idempotency_scope} | ${e.note ?? ""} |`);
    }
    lines.push("");
  }
  lines.push("## Правила");
  lines.push("");
  lines.push("- Append-only; повторная доставка не повторяет бизнес-эффект (idempotency_key).");
  lines.push("- `occurred_at` ≠ `recorded_at`; поздние события сохраняют оба времени.");
  lines.push("- Ошибки не удаляются — компенсирующее событие.");
  lines.push("- Payload валидируется JSON Schema; версия схемы обязательна.");
  lines.push("");
  return lines.join("\n");
}

function eventCatalogJson(): string {
  return JSON.stringify(
    { generated_by: "phase1-5/generate.ts", envelope_fields: EVENT_ENVELOPE_FIELDS, count: EVENTS.length, events: EVENTS },
    null,
    2,
  );
}

function envelopeSchema(): string {
  return JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://dds.local/schemas/event-envelope.schema.json",
      title: "Domain event envelope",
      type: "object",
      additionalProperties: false,
      required: EVENT_ENVELOPE_FIELDS.filter((f) => f !== "actor_id" && f !== "source_event_id" && f !== "correlation_id" && f !== "causation_id" && f !== "actor_type" && f !== "source_system"),
      properties: {
        event_id: { type: "string", format: "uuid" },
        event_type: { type: "string", minLength: 3 },
        aggregate_type: { type: "string", minLength: 1 },
        aggregate_id: { type: "string", minLength: 1 },
        occurred_at: { type: "string", format: "date-time" },
        recorded_at: { type: "string", format: "date-time" },
        actor_type: { type: ["string", "null"] },
        actor_id: { type: ["string", "null"] },
        source_system: { type: ["string", "null"] },
        source_event_id: { type: ["string", "null"] },
        correlation_id: { type: ["string", "null"] },
        causation_id: { type: ["string", "null"] },
        idempotency_key: { type: "string", minLength: 3 },
        schema_version: { type: "string", minLength: 1 },
        payload: { type: "object" },
      },
    },
    null,
    2,
  );
}

function eventPayloadSchema(type: string, payload: string[]): string {
  const props: Record<string, unknown> = {};
  for (const p of payload) {
    props[p] = p.endsWith("_at") ? { type: "string", format: "date-time" } : { type: ["string", "number", "array", "null"] };
  }
  return JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://dds.local/schemas/events/${type}.schema.json`,
      title: type,
      allOf: [{ $ref: "../event-envelope.schema.json" }],
      type: "object",
      properties: { event_type: { const: type }, payload: { type: "object", required: payload, properties: props } },
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------- DDL

function sqlDefault(v: string): string {
  if (v.startsWith("'")) return v; // уже строковый литерал/приведение
  if (/^(now\(\)|true|false|null|-?\d+(\.\d+)?)$/i.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

function ddlForStep(stepIndex: number): string {
  const step = MIGRATIONS[stepIndex];
  const lines: string[] = [];
  lines.push(`-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.`);
  lines.push(`-- Миграция ${step.id}_${step.name}`);
  lines.push(`-- Назначение: ${step.purpose}`);
  lines.push(`-- Зависимости: ${step.depends_on.join(", ") || "нет"}`);
  lines.push(`-- Rollback: ${step.rollback}`);
  lines.push("");
  if (step.name === "access_audit") {
    lines.push("-- Роли/права: реализуются через существующий identity provider (BD-019).");
    lines.push("-- DDL не создаётся, пока не утверждён механизм авторизации.");
    return lines.join("\n") + "\n";
  }
  if (step.name === "indexes_constraints") {
    for (const t of TABLES) {
      for (const idx of t.indexes ?? []) {
        const unique = idx.includes("UNIQUE");
        const cols = idx.filter((c) => c !== "UNIQUE").map((c) => c).join(", ");
        const name = `idx_${t.name}_${cols.replace(/,\s*/g, "_")}`.toLowerCase();
        lines.push(`-- CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON ${t.name} (${cols});`);
      }
    }
    lines.push("");
    lines.push("-- Частичные уникальные индексы (примеры, требуют подтверждения):");
    lines.push("-- CREATE UNIQUE INDEX uq_trip_orders_active_order ON trip_orders (order_id) WHERE removed_at IS NULL;");
    lines.push("-- CREATE UNIQUE INDEX uq_trip_active_assignment ON trip_assignments (trip_id) WHERE assignment_status IN ('PROPOSED','ACCEPTED','DEPARTED');");
    lines.push("-- CREATE UNIQUE INDEX uq_queue_active_shift ON courier_queue_entries (shift_id) WHERE queue_status IN ('WAITING','OFFERED','PAUSED');");
    lines.push("-- CREATE UNIQUE INDEX uq_mentorship_active_trainee ON mentorship_assignments (trainee_courier_id) WHERE status = 'ACTIVE';");
    return lines.join("\n") + "\n";
  }
  for (const tname of step.tables) {
    const t = tableByName(tname);
    if (!t) continue;
    lines.push(`CREATE TABLE ${t.name} (`);
    const defs: string[] = [];
    for (const [name, type, opts] of t.cols) {
      const o = parseOpts(opts);
      let d = `  ${name} ${pgType(type)}`;
      if (o.def) d += ` DEFAULT ${sqlDefault(o.def)}`;
      if (o.nn) d += " NOT NULL";
      defs.push(d);
    }
    const pk = t.cols.filter((c) => parseOpts(c[2]).pk).map((c) => c[0]);
    if (pk.length) defs.push(`  CONSTRAINT pk_${t.name} PRIMARY KEY (${pk.join(", ")})`);
    for (const [name, , opts] of t.cols) {
      const o = parseOpts(opts);
      if (o.uq) defs.push(`  CONSTRAINT uq_${t.name}_${name} UNIQUE (${name})`);
      if (o.fk) {
        const [pt, pc] = o.fk.split(".");
        defs.push(`  CONSTRAINT fk_${t.name}_${name} FOREIGN KEY (${name}) REFERENCES ${pt} (${pc})`);
      }
    }
    lines.push(defs.join(",\n"));
    lines.push(");");
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- other docs

function integrityRulesMd(): string {
  const lines: string[] = [];
  lines.push("# 12. Правила целостности и инварианты");
  lines.push("");
  lines.push(`Инвариантов: **${INVARIANTS.length}**. Типы проверок: DB_CONSTRAINT, PARTIAL_INDEX, TRANSACTION, APPLICATION, TEST.`);
  lines.push("");
  lines.push("| ID | Область | ***REMOVED*** | Тип | Таблицы | Источник |");
  lines.push("|---|---|---|---|---|---|");
  for (const i of INVARIANTS) lines.push(`| ${i.id} | ${i.area} | ${i.statement} | ${i.check_type} | ${i.tables.join(", ")} | ${i.source} |`);
  lines.push("");
  return lines.join("\n");
}

function indexesMd(): string {
  const lines: string[] = [];
  lines.push("# 13. Индексы и ограничения");
  lines.push("");
  lines.push("## Уникальности");
  lines.push("");
  lines.push("| Таблица | ***REMOVED*** | Тип |");
  lines.push("|---|---|---|");
  for (const t of TABLES) {
    for (const [name, , opts] of t.cols) {
      const o = parseOpts(opts);
      if (o.uq) lines.push(`| ${t.name} | ${name} | UNIQUE (колонка) |`);
    }
    for (const idx of t.indexes ?? []) {
      if (idx.includes("UNIQUE")) {
        const cols = idx.filter((c) => c !== "UNIQUE").join(", ");
        lines.push(`| ${t.name} | ${cols} | UNIQUE (составной) |`);
      }
    }
  }
  lines.push("");
  lines.push("## Индексы");
  lines.push("");
  lines.push("| Таблица | Колонки | Назначение |");
  lines.push("|---|---|---|");
  for (const t of TABLES) {
    for (const idx of t.indexes ?? []) {
      if (idx.includes("UNIQUE")) continue;
      lines.push(`| ${t.name} | ${idx.join(", ")} | поиск/фильтрация |`);
    }
  }
  lines.push("");
  lines.push("## Частичные уникальные индексы (PostgreSQL)");
  lines.push("");
  lines.push("- `trip_orders (order_id) WHERE removed_at IS NULL` — один активный состав на заказ.");
  lines.push("- `trip_assignments (trip_id) WHERE assignment_status IN ('PROPOSED','ACCEPTED','DEPARTED')` — одно активное назначение.");
  lines.push("- `courier_queue_entries (shift_id) WHERE queue_status IN ('WAITING','OFFERED','PAUSED')` — один активный вход в очередь.");
  lines.push("- `mentorship_assignments (trainee_courier_id) WHERE status = 'ACTIVE'` — одно активное наставничество.");
  lines.push("");
  lines.push("При отсутствии поддержки частичных индексов (SQLite) — транзакционная проверка.");
  lines.push("");
  return lines.join("\n");
}

function decisionsMd(): string {
  const lines: string[] = [];
  lines.push("# 02. Реестр открытых бизнес-решений");
  lines.push("");
  lines.push(`Решений: **${BUSINESS_DECISIONS.length}**, все со статусом OPEN. Выдуманные значения не подставляются.`);
  lines.push("");
  for (const d of BUSINESS_DECISIONS) {
    lines.push(`## ${d.id}. ${d.question}`);
    lines.push("");
    lines.push(`- **Почему важно:** ${d.why}`);
    lines.push(`- **Владелец:** ${d.owner}`);
    lines.push(`- **Влияние на модель:** ${d.impact}`);
    lines.push(`- **Требуемое решение:** ${d.required_decision}`);
    lines.push(`- **Варианты:** ${d.options.join("; ")}`);
    lines.push(`- **Последствия:** ${d.consequences.join("; ")}`);
    lines.push(`- **Затрагивает:** ${d.affects.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function businessRulesMd(): string {
  const lines: string[] = [];
  lines.push("# 01. Реестр согласованных бизнес-правил");
  lines.push("");
  lines.push(`Правил: **${BUSINESS_RULES.length}**; AGREED: ${BUSINESS_RULES.filter((r) => r.status === "AGREED").length}; TBD: ${BUSINESS_RULES.filter((r) => r.status === "TBD").length}.`);
  lines.push("");
  lines.push("| ID | Область | ***REMOVED*** | Статус | Источник |");
  lines.push("|---|---|---|---|---|");
  for (const r of BUSINESS_RULES) lines.push(`| ${r.id} | ${r.area} | ${r.statement} | ${r.status} | ${r.source} |`);
  lines.push("");
  return lines.join("\n");
}

function glossaryMd(): string {
  const lines: string[] = [];
  lines.push("# 03. Словарь предметной области");
  lines.push("");
  lines.push("| Термин | Определение | Статус | Примечание |");
  lines.push("|---|---|---|---|");
  for (const g of GLOSSARY) lines.push(`| ${g.term} | ${g.definition} | ${g.status} | ${g.note} |`);
  lines.push("");
  return lines.join("\n");
}

function securityMd(): string {
  const lines: string[] = [];
  lines.push("# 19. Безопасность, PII и доступы");
  lines.push("");
  lines.push("## Политики");
  lines.push("");
  lines.push("| ID | Объект | Политика | Роли |");
  lines.push("|---|---|---|---|");
  for (const p of PII_POLICY) lines.push(`| ${p.id} | ${p.subject} | ${p.policy} | ${p.roles} |`);
  lines.push("");
  lines.push("## Роли для проектирования");
  lines.push("");
  lines.push("`ADMIN`, `OPERATIONS_MANAGER`, `GEO_MANAGER`, `CURATOR`, `DISPATCHER` (если утверждён), `COURIER`, `HR`, `FINANCE`, `READ_ONLY_ANALYST`.");
  lines.push("");
  lines.push("`DISPATCHER` не меняет состав ходки, пока действует правило «только куратор».");
  lines.push("");
  lines.push("## Запреты");
  lines.push("");
  lines.push("- PII в fixtures, тестовых отчётах, примерах и логах.");
  lines.push("- Секреты в логах и репозитории.");
  lines.push("- Собственная система паролей при наличии identity provider.");
  lines.push("");
  return lines.join("\n");
}

function openQuestionsMd(): string {
  const lines: string[] = [];
  lines.push("# 20. <ФИО> вопросы");
  lines.push("");
  lines.push("## <ФИО>-решения");
  lines.push("");
  for (const d of BUSINESS_DECISIONS) lines.push(`- **${d.id}** — ${d.question} (влияние: ${d.impact})`);
  lines.push("");
  lines.push("## Технические");
  lines.push("");
  lines.push("- BD-018: выбор СУБД (ADR-001).");
  lines.push("- BD-019: стек backend и авторизация.");
  lines.push("- Стратегия геоданных: PostGIS или JSONB GeoJSON.");
  lines.push("- Срок хранения событий/финансов (BD-023) и партиционирование.");
  lines.push("- Мастер-источник заказа и курьера (BD-016/BD-017).");
  lines.push("- Уточнить semantics: `time_ready` (3466), `id_shift` (7802), `mentorid` (5939), `quantity_batch`/`orders_assignment` (2339), `stake` (5939).");
  lines.push("");
  return lines.join("\n");
}

function mappingDocs() {
  const rows: unknown[][] = [["domain_table", "domain_column", "superset_dataset", "superset_table", "superset_field", "evidence", "confidence", "limitation", "usable_for_initial_load", "needs"]];
  for (const m of MAPPING) rows.push([m.domain_table, m.domain_column, m.superset_dataset, m.superset_table, m.superset_field, m.evidence, m.confidence, m.limitation, m.usable_for_initial_load, m.needs]);
  w("superset-to-domain-mapping.csv", csv(rows));
  w("superset-to-domain-mapping.json", JSON.stringify({ generated_by: "phase1-5/generate.ts", count: MAPPING.length, mappings: MAPPING }, null, 2));
  const lines: string[] = [];
  lines.push("# 14. Mapping Superset → новая модель");
  lines.push("");
  lines.push(`Строк mapping: **${MAPPING.length}**.`);
  const byEvidence = (e: string) => MAPPING.filter((m) => m.evidence === e).length;
  lines.push(`DIRECT: ${byEvidence("DIRECT")}; DERIVED: ${byEvidence("DERIVED")}; INFERRED: ${byEvidence("INFERRED")}; UNKNOWN: ${byEvidence("UNKNOWN")}.`);
  lines.push("");
  lines.push("Принципы: Superset read-only; новая БД владеет операционными фактами; SQL JOIN ≠ FK; внешние ID не создают FK по имени; суммы заказа ≠ оплата курьера.");
  lines.push("");
  lines.push("| Домен | Поле | Dataset | Поле источника | Доказательство | Confidence | ***REMOVED*** | Загрузка |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const m of MAPPING) lines.push(`| ${m.domain_table} | ${m.domain_column} | ${m.superset_dataset ?? "—"} | ${m.superset_field ?? "—"} | ${m.evidence} | ${m.confidence} | ${m.limitation} | ${m.usable_for_initial_load} |`);
  lines.push("");
  w("14_superset_mapping.md", lines.join("\n"));
}

function sotCsv() {
  const rows: unknown[][] = [["attribute", "table", "source_of_truth", "owner", "sync", "note"]];
  for (const s of SOURCE_OF_TRUTH) rows.push([s.attribute, s.table, s.source_of_truth, s.owner, s.sync, s.note]);
  w("15_source_of_truth_matrix.csv", csv(rows));
}

function externalIdDocs() {
  const rows: unknown[][] = [["entity", "external_system", "external_field", "new_table", "new_column", "confidence", "limitation"]];
  rows.push(["courier", "Superset/HR", "id_courier", "courier_external_ids", "external_id", "MEDIUM", "числовой id; сопоставление не доказано"]);
  rows.push(["courier", "Superset", "courier_id", "courier_external_ids", "external_id", "MEDIUM", "5247/5399 агрегаты"]);
  rows.push(["courier", "Superset", "ID (7775)", "courier_external_ids", "external_id", "MEDIUM", "источник истины — BD-017"]);
  rows.push(["courier", "Superset/HR", "mentorid (5939)", "courier_external_ids", "external_id", "LOW", "string id; роль — BD-001"]);
  rows.push(["shop", "Superset", "shopno", "shops", "external_source_id", "HIGH", "числовой"]);
  rows.push(["shop", "Superset", "id_tt", "shops", "external_source_id", "MEDIUM", "nullable"]);
  rows.push(["order", "Master", "external_order_id", "orders", "external_order_id", "MEDIUM", "мастер-источник — BD-016"]);
  rows.push(["shift", "Superset", "id_shift (7802)", "courier_shifts", "external_shift_id", "MEDIUM", "string; универсальность не доказана"]);
  rows.push(["trip", "Superset", "id_pool_calc", "trips", "external_trip_ref", "LOW", "вычисляемый пул"]);
  w("16_external_id_mapping.csv", csv(rows));
  const md: string[] = ["# 16. Внешние идентификаторы", "", "| Сущность | Система | Внешнее поле | Таблица | Колонка | Confidence | ***REMOVED*** |", "|---|---|---|---|---|---|---|"];
  for (const r of rows.slice(1)) md.push(`| ${r.join(" | ")} |`);
  md.push("");
  w("16_external_id_mapping.md", md.join("\n"));
}

function migrationDocs() {
  w("18_migration_matrix.csv", csv([
    ["id", "name", "purpose", "tables", "depends_on", "rollback", "checks_before", "checks_after", "risk"],
    ...MIGRATIONS.map((m) => [m.id, m.name, m.purpose, m.tables.join(";"), m.depends_on.join(";"), m.rollback, m.checks_before.join(";"), m.checks_after.join(";"), m.risk]),
  ]));
  const lines: string[] = [];
  lines.push("# 17. План миграций (DRAFT, не применялся)");
  lines.push("");
  lines.push("Миграции не применялись. DDL — только draft.");
  lines.push("");
  lines.push("## Порядок");
  lines.push("");
  lines.push("| ID | Название | Зависит от | Rollback | Риск |");
  lines.push("|---|---|---|---|---|");
  for (const m of MIGRATIONS) lines.push(`| ${m.id} | ${m.name} | ${m.depends_on.join(", ") || "—"} | ${m.rollback} | ${m.risk} |`);
  lines.push("");
  lines.push("## Стратегия");
  lines.push("");
  lines.push("Expand → backfill → validate → switch → contract. Новые таблицы/колонки — сначала nullable.");
  lines.push("Backfill только из разрешённых источников и после отдельного разрешения. Старые поля не удаляются.");
  lines.push("Для финансовых данных предпочтительны компенсирующие операции, а не destructive rollback.");
  lines.push("Повторный запуск безопасен или корректно отклоняется; каждая миграция имеет номер и checksum.");
  lines.push("");
  lines.push("## <ФИО> до/после");
  lines.push("");
  for (const m of MIGRATIONS) {
    lines.push(`### ${m.id}_${m.name}`);
    lines.push("");
    lines.push(`- До: ${m.checks_before.join("; ")}`);
    lines.push(`- После: ${m.checks_after.join("; ")}`);
    lines.push("");
  }
  w("17_migration_plan.md", lines.join("\n"));
}

function coverageCsv() {
  const rows: unknown[][] = [["requirement", "covered_by", "status", "gaps", "evidence"]];
  rows.push(["***REMOVED***ы и жизненный цикл", "orders, order_status_history", "PARTIAL", "ORDER_READY (BD-013), статусы BD-014", "4732 order_status/date_*"]);
  rows.push(["Торговые точки и адреса", "shops, addresses", "PARTIAL", "адрес доставки/PII-политика", "4732 shopno; geo не разобран"]);
  rows.push(["Курьеры", "couriers, courier_external_ids", "PARTIAL", "мастер-источник BD-017", "7775/5797/5939"]);
  rows.push(["Смены и очередь", "courier_shifts, courier_queue_entries", "PARTIAL", "реальное время смен/очереди — новые события", "7802/7021/7712"]);
  rows.push(["***REMOVED*** доставки", "delivery_zones, zone_boundary_versions", "NEEDS_REFERENCE", "справочник зон и границы", "прямого источника нет"]);
  rows.push(["Ходки и состав", "trips, trip_orders", "PARTIAL", "подтверждение соответствия id_pool_calc; зоны", "7006/7027/2339"]);
  rows.push(["Назначения", "trip_assignments", "PARTIAL", "события назначения/принятия", "id_order+id_courier"]);
  rows.push(["Доставка, отмены, возвраты", "delivery_attempts, orders", "PARTIAL", "частичная доставка BD-021", "date_delivered/is_canceled/is_returned_store"]);
  rows.push(["Начисления", "tariff_versions, courier_accruals, accrual_adjustments", "NEEDS_REFERENCE", "тариф BD-008/BD-024", "7473 — только ориентир"]);
  rows.push(["Кураторство и обучение", "mentorship_assignments, mentorship_shift_reviews", "PARTIAL", "роль BD-001, шкала оценки", "5939 mentorid/trainee_*"]);
  rows.push(["<ФИО> и история", "courier_events, domain_events", "PASS (структура)", "наполнение новыми событиями", "event catalog"]);
  rows.push(["PII/безопасность", "политики PII", "PASS (политика)", "BD-023 сроки хранения", "07_pii_audit 1.4: 0 утечек"]);
  w("validation/coverage_matrix.csv", csv(rows));
}

function fixtures() {
  const shops = [{ id: "11111111-1111-4111-8111-111111111111", code: "SHOP-001", name: "Darkstore-001", status: "ACTIVE", valid_from: "2026-01-01T00:00:00Z" }];
  const couriers = [
    { id: "22222222-2222-4222-8222-222222222222", display_name: "Courier-001", courier_type: "вело", operational_status: "ACTIVE", is_blocked: false },
    { id: "33333333-3333-4333-8333-333333333333", display_name: "Courier-002", courier_type: "авто", operational_status: "ACTIVE", is_blocked: false },
  ];
  const orders = [
    { id: "44444444-4444-4444-8444-444444444444", external_order_id: "EXT-0001", source_system: "fixture", shop_id: shops[0].id, order_status: "READY", order_created_at: "2026-11-21T08:00:00Z", ready_at: "2026-11-21T08:20:00Z" },
    { id: "55555555-5555-4555-8555-555555555555", external_order_id: "EXT-0002", source_system: "fixture", shop_id: shops[0].id, order_status: "READY", order_created_at: "2026-11-21T08:05:00Z", ready_at: "2026-11-21T08:25:00Z" },
    { id: "66666666-6666-4666-8666-666666666666", external_order_id: "EXT-0003", source_system: "fixture", shop_id: shops[0].id, order_status: "READY", order_created_at: "2026-11-21T08:10:00Z", ready_at: "2026-11-21T08:30:00Z" },
  ];
  const shift = { id: "77777777-7777-4777-8777-777777777777", courier_id: couriers[0].id, shop_id: shops[0].id, actual_start_at: "2026-11-21T08:00:00Z", shift_status: "STARTED" };
  const queue = { id: "8<ТЕЛЕФОН>-4888-8888-<ТЕЛЕФОН>8", courier_id: couriers[0].id, shop_id: shops[0].id, shift_id: shift.id, arrived_at: "2026-11-21T08:05:00Z", queue_sequence: 1, queue_status: "WAITING" };
  const trip = { id: "99999999-9999-4999-8999-999999999999", shop_id: shops[0].id, zone_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", courier_id: couriers[0].id, trip_status: "FORMED", formed_at: "2026-11-21T08:35:00Z" };
  const tripOrders = orders.map((o, i) => ({ id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0${i + 1}`, trip_id: trip.id, order_id: o.id, sequence_no: i + 1, added_at: "2026-11-21T08:35:00Z", added_by: couriers[0].id }));
  const zone = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", shop_id: shops[0].id, code: "Z-SHOP-001", name: "Zone-001", boundary_type: "MANUAL", status: "ACTIVE", valid_from: "2026-01-01T00:00:00Z" };
  const tariff = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Fixture tariff (DRAFT)", base_amount: 100.0, currency: "RUB", effective_from: "2026-01-01T00:00:00Z", status: "DRAFT" };
  const mentorship = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", mentor_courier_id: couriers[0].id, trainee_courier_id: couriers[1].id, starts_at: "2026-11-21T00:00:00Z", planned_ends_at: "2026-12-05T00:00:00Z", status: "ACTIVE" };
  w("fixtures/shops.json", JSON.stringify(shops, null, 2));
  w("fixtures/couriers.json", JSON.stringify(couriers, null, 2));
  w("fixtures/orders.json", JSON.stringify(orders, null, 2));
  w("fixtures/delivery_zones.json", JSON.stringify([zone], null, 2));
  w("fixtures/courier_shifts.json", JSON.stringify([shift], null, 2));
  w("fixtures/courier_queue_entries.json", JSON.stringify([queue], null, 2));
  w("fixtures/trips.json", JSON.stringify([trip], null, 2));
  w("fixtures/trip_orders.json", JSON.stringify(tripOrders, null, 2));
  w("fixtures/tariff_versions.json", JSON.stringify([tariff], null, 2));
  w("fixtures/mentorship_assignments.json", JSON.stringify([mentorship], null, 2));
  w("fixtures/README.md", "# Синтетические fixtures\n\nВсе данные вымышлены. Реальные ФИО, телефоны, ИНН и адреса не используются.\n");
}

function readme() {
  w("README.md", `# Этап 1.5 — модель данных курьерской службы

Артефакты спроектированы на основе Phase 1.1–1.4 (read-only). Реальные миграции не применялись,
production-БД не создавалась, Superset и \`data/catalog.sqlite\` не изменялись, commit/push не выполнялись.

## Состав

- \`00_scope_and_assumptions.md\` — границы и допущения
- \`repository_audit.md\` — аудит результатов 1.4 (Gate G0)
- \`01_business_rules_register.md\` — согласованные правила
- \`02_business_decisions_register.md\`, \`business_decisions_register.csv/json\` — открытые решения BD-001…BD-024
- \`03_domain_glossary.md\` — словарь
- \`04_logical_data_model.md\` — логическая модель
- \`05_physical_data_model.md\` + \`ddl/postgres/*.sql\` (DRAFT)
- \`06_er_model.mmd\`, \`07_order_lifecycle.mmd\`, \`08_trip_and_queue_lifecycle.mmd\`, \`09_financial_flow.mmd\`
- \`10_event_catalog.md\`, \`11_event_catalog.json\`, \`schemas/\`
- \`12_integrity_rules.md\`, \`13_indexes_and_constraints.md\`
- \`14_superset_mapping.md\`, \`superset-to-domain-mapping.csv/json\`
- \`15_source_of_truth_matrix.csv\`, \`16_external_id_mapping.md/csv\`
- \`17_migration_plan.md\`, \`18_migration_matrix.csv\`
- \`19_security_and_pii.md\`, \`20_open_questions.md\`, \`21_adr/\`
- \`fixtures/\` — синтетические данные
- \`validation/\` — результаты автопроверок
`);
}

function adr() {
  w("21_adr/ADR-001-database-choice.md", `# ADR-001. Выбор СУБД

**Статус:** PROPOSED (BD-018). **Дата:** 2026-11-21.

## ***REMOVED***
<ФИО> система курьерской службы: многопользовательская очередь, конкурентное формирование ходок,
транзакции, события append-only, геоданные, JSON payload, история.

## Варианты
1. **PostgreSQL 15+** — конкурентность, транзакции, частичные уникальные индексы, PostGIS, jsonb, партиционирование.
2. **SQLite** — простой локальный прототип/однопользовательский режим; ограниченная конкурентная запись, нет PostGIS.

## Рекомендация
PostgreSQL для production. SQLite — только для локального прототипа и тестов модели.
<ФИО> рекомендация, не принятое решение. Окончательные DDL не создаются до утверждения СУБД.

## Последствия
- PostgreSQL: требуется эксплуатация, но покрывает конкурентную очередь и частичные индексы.
- SQLite: проще, но риск конфликтов записи и отсутствие гео-типов.
`);
  w("21_adr/ADR-002-readiness-attempts.md", `# ADR-002. <ФИО> готовности заказа

**Статус:** PROPOSED.

Вариант A: одна активная запись готовности на заказ.
Вариант B: readiness attempts с номером попытки (повторные циклы сборки).

Рекомендация: B (attempt_no) — безопаснее при повторной сборке; A — проще для MVP.
***REMOVED*** зависит от BD-013.
`);
  w("21_adr/ADR-003-zone-history.md", `# ADR-003. История границ зон

**Статус:** PROPOSED (BD-022).

***REMOVED***чик оценивал полную историю как непринципиальную, но для воспроизводимости назначений
нужен технический аудит изменений и даты действия правил. Рекомендуется \`zone_boundary_versions\`
как минимальная версионность, включаемая в MVP по решению владельца процесса.
`);
  w("21_adr/ADR-004-dispatcher-role.md", `# ADR-004. Роль диспетчера

**Статус:** PROPOSED (BD-011).

Роль \`DISPATCHER\` не получает право менять состав ходки, пока действует ответ «только куратор».
Аварийные отмены — отдельные права и обязательная причина.
`);
}

// ---------------------------------------------------------------- main

function main() {
  mkdirSync(ROOT, { recursive: true });
  w("04_logical_data_model.md", logicalModelMd());
  w("05_physical_data_model.md", physicalModelMd());
  w("06_er_model.mmd", erMmd());
  w("07_order_lifecycle.mmd", orderLifecycleMmd());
  w("08_trip_and_queue_lifecycle.mmd", tripQueueMmd());
  w("09_financial_flow.mmd", financialFlowMmd());
  w("10_event_catalog.md", eventCatalogMd());
  w("11_event_catalog.json", eventCatalogJson());
  w("12_integrity_rules.md", integrityRulesMd());
  w("13_indexes_and_constraints.md", indexesMd());
  mappingDocs();
  sotCsv();
  externalIdDocs();
  migrationDocs();
  w("02_business_decisions_register.md", decisionsMd());
  w("01_business_rules_register.md", businessRulesMd());
  w("03_domain_glossary.md", glossaryMd());
  w("19_security_and_pii.md", securityMd());
  w("20_open_questions.md", openQuestionsMd());
  coverageCsv();
  fixtures();
  readme();
  adr();

  w("business_decisions_register.csv", csv([
    ["id", "question", "why", "owner", "impact", "required_decision", "options", "consequences", "status", "affects"],
    ...BUSINESS_DECISIONS.map((d) => [d.id, d.question, d.why, d.owner, d.impact, d.required_decision, d.options.join(";"), d.consequences.join(";"), d.status, d.affects.join(";")]),
  ]));
  w("business_decisions_register.json", JSON.stringify({ generated_by: "phase1-5/generate.ts", count: BUSINESS_DECISIONS.length, decisions: BUSINESS_DECISIONS }, null, 2));

  w("schemas/event-envelope.schema.json", envelopeSchema());
  const keyEvents = ["ORDER_READY", "ORDER_DELIVERED", "TRIP_ASSIGNED", "TRIP_DEPARTED", "COURIER_ACCRUAL_CREATED", "MENTORSHIP_ASSIGNED", "SHIFT_STARTED", "COURIER_JOINED_QUEUE"];
  for (const type of keyEvents) {
    const e = EVENTS.find((x) => x.type === type);
    if (e) w(`schemas/events/${type}.schema.json`, eventPayloadSchema(type, e.payload));
  }
  for (let i = 0; i < MIGRATIONS.length; i++) {
    w(`ddl/postgres/${MIGRATIONS[i].id}_${MIGRATIONS[i].name}.sql`, ddlForStep(i));
  }

  console.log(JSON.stringify({
    tables: TABLES.length,
    events: EVENTS.length,
    decisions: BUSINESS_DECISIONS.length,
    business_rules: BUSINESS_RULES.length,
    glossary: GLOSSARY.length,
    pii_policies: PII_POLICY.length,
    source_of_truth: SOURCE_OF_TRUTH.length,
    mapping: MAPPING.length,
    migrations: MIGRATIONS.length,
    invariants: INVARIANTS.length,
    lifecycles: Object.keys(LIFECYCLES).length,
    root: ROOT,
  }, null, 2));
}

main();
