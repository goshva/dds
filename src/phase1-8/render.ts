/**
 * Этап 1.8 — рендеринг логической модели в документы, диаграммы и JSON.
 *
 * Всё содержимое берётся из model.ts (авторская часть) и раскладывается в:
 *   docs/phase-01-8/*.md
 *   docs/phase-01-8/diagrams/*.mmd
 *   reports/phase-01-8/*.json
 *
 * Никаких догадок: статусы, evidence и ограничения переносятся как есть.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  CONTEXTS,
  EVIDENCE,
  ENTITIES,
  ATTRIBUTES,
  RELATIONSHIPS,
  DECISIONS,
  INVARIANTS,
  PROCESSES,
  MVP_FIELDS,
  METRICS,
  GAPS,
  type Entity,
  type AttributeSpec,
  type RelationshipSpec,
  type Evidence,
  type OpenDecision,
  type Invariant,
  type GapSpec,
  type ProcessSpec,
  type MvpField,
  type MetricSpec,
  type BoundedContext,
} from "./model";

export const DOCS_DIR = join("docs", "phase-01-8");
export const DIAGRAMS_DIR = join(DOCS_DIR, "diagrams");
export const REPORTS_DIR = join("reports", "phase-01-8");

export const GENERATED_AT = new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

function list(items: string[], bullet = "-"): string {
  return items.map((i) => `${bullet} ${i}`).join("\n");
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

const ENTITY_BY_ID = byId(ENTITIES);
const CONTEXT_BY_ID = byId(CONTEXTS);
const EVIDENCE_BY_ID = byId(EVIDENCE);
const DECISION_BY_ID = byId(DECISIONS);
const GAP_BY_ID = byId(GAPS);

function entityName(id: string): string {
  return ENTITY_BY_ID.get(id)?.name ?? id;
}

function contextName(id: string): string {
  const c = CONTEXT_BY_ID.get(id);
  return c ? `${c.ru_name} (${c.name})` : id;
}

function attributesOf(entityId: string): AttributeSpec[] {
  return ATTRIBUTES.filter((a) => a.entity_id === entityId);
}

function relationshipsOf(entityId: string): RelationshipSpec[] {
  return RELATIONSHIPS.filter((r) => r.from_entity === entityId || r.to_entity === entityId);
}

function evidenceRefs(ids: string[]): string {
  if (ids.length === 0) return "—";
  return ids.join(", ");
}

function mermaidName(id: string): string {
  return id.replace(/^ENT-/, "").replace(/-/g, "_");
}

function piiLabel(v: string): string {
  return v === "NONE" ? "нет" : v === "POSSIBLE" ? "возможно" : "подтверждено";
}

/* ------------------------------------------------------------------ */
/* 01 — Overview                                                       */
/* ------------------------------------------------------------------ */

function renderOverview(): string {
  const layers = ["OBSERVED_SOURCE", "TARGET_LOGICAL", "BOTH"];
  const layerRows = layers.map((l) => {
    const es = ENTITIES.filter((e) => e.layer === l);
    return [l, String(es.length), es.map((e) => e.name).join(", ") || "—"];
  });
  const contextRows = CONTEXTS.map((c) => {
    const es = ENTITIES.filter((e) => e.bounded_context === c.id);
    return [c.id, c.ru_name, c.name, String(es.length), c.mvp_scope, c.owner];
  });

  return `# 01 — Logical Model Overview

**Этап:** 1.8 — Logical Data Model & ERD  
**Сгенерировано:** ${GENERATED_AT}  
**Статус модели:** PASS_WITH_BLOCKERS (см. \`13_model_validation_report.md\`)

## 1. ***REMOVED*** и границы модели

Логическая модель описывает предметную область курьерской службы на уровне
сущностей, атрибутов и связей. Она опирается на артефакты этапов 1.1–1.7 и
явные бизнес-правила пользователя. <ФИО> **не является физической схемой**:
типы данных, ключи, FK и CHECK-ограничения не утверждаются без проверки данных.

Границы:

- входит: заказы, поездки/пулы, курьеры, смены, очередь, зоны, адреса,
  финансы, наставничество, события и аудит;
- не входит: физический DDL, миграции, ETL, фактические значения источников,
  настройка Superset, интеграционные API.

## 2. Два слоя модели

${mdTable(["Слой", "Сущностей", "Состав"], layerRows)}

- **Observed Source Concepts** — понятия, реально обнаруженные в SQL/metadata
  Superset. <ФИО> не доказанные физические сущности.
- **Target Logical Domain Model** — целевые сущности, включая те, для которых
  источник не найден. Такие сущности помечены \`BUSINESS_REQUIRED_NOT_FOUND\`,
  \`NOT_VERIFIABLE\`, \`NOT_FOUND_IN_SUPERSET\` или \`DESIGN_PROPOSAL\`.
- **BOTH** — сущность присутствует и в наблюдаемом, и в целевом слое.

Важно: \`Pool\` и \`Trip\` — разные концепты. Их эквивалентность не подтверждена
и в модели не предполагается.

## 3. Bounded contexts

${mdTable(["ID", "***REMOVED***", "Английское имя", "Сущностей", "MVP", "Владелец"], contextRows)}

***REMOVED***ы разделены по бизнес-ответственности. Пересечение имён сущностей между
контекстами отсутствует; shared-сущности вынесены в \`Shared & Audit\`.

## 4. Assumptions

1. <ФИО>-правила §4 ТЗ этапа 1.8 приняты как входные данные и не перепроверяются
   опросом; они помечены как \`BUSINESS_RULE\`.
2. SQL definitions Superset — evidence присутствия полей/таблиц, но не evidence
   фактических значений и не доказательство уникальности.
3. \`FILTER_VALUES\` и \`SQL_DERIVED\` — косвенные свидетельства, а не распределения.
4. Данные 1.7-исследования по снимку 3 767 датасетов и живая синхронизация 1.6.2
   (3 778 датасетов) относятся к разным контрольным точкам; расхождение не
   трактуется как потеря датасетов.
5. Полный пакет 1.7 в репозитории отсутствует (\`docs/phase-01-7/\` и
   \`reports/phase-01-7/\` не созданы), поэтому входные данные имеют статус
   \`PARTIAL_INPUTS\`; отчёт 1.7 в корне репозитория использован как источник.
6. Отсутствие поля в одном dataset SQL не означает отсутствия процесса в
   организации — это ограничение охвата, а не вывод об организации.

## 5. Observed vs Target

${mdTable(
  ["Показатель", "Значение"],
  [
    ["Всего сущностей", String(ENTITIES.length)],
    ["Только observed", String(ENTITIES.filter((e) => e.layer === "OBSERVED_SOURCE").length)],
    ["Только target", String(ENTITIES.filter((e) => e.layer === "TARGET_LOGICAL").length)],
    ["Оба слоя", String(ENTITIES.filter((e) => e.layer === "BOTH").length)],
    ["Атрибутов", String(ATTRIBUTES.length)],
    ["Связей", String(RELATIONSHIPS.length)],
    ["Evidence links", String(EVIDENCE.length)],
    ["Открытых решений", String(DECISIONS.length)],
    ["Инвариантов", String(INVARIANTS.length)],
    ["Gaps", String(GAPS.length)],
  ],
)}

## 6. Non-goals

- Не проектировать физические таблицы, типы, PK/FK и индексы.
- Не объявлять SQL JOIN внешним ключом.
- Не превращать \`Pool\` в \`Trip\` без подтверждения Operations.
- Не выдумывать источники готовности, зон, тарифов, начислений и выплат.
- Не подменять отсутствующие данные синтетическими значениями.
- Не выполнять SELECT к source DB и не менять Superset.

## 7. Навигация

| Документ | Содержание |
|---|---|
| \`02_entity_catalog.md\` | Каталог сущностей |
| \`03_attribute_catalog.md\` | Каталог атрибутов |
| \`04_relationship_catalog.md\` | Каталог связей |
| \`05_order_lifecycle.md\` | Жизненный цикл заказа |
| \`06_trip_pool_assignment.md\` | Trip / Pool / назначение |
| \`07_queue_shift_lifecycle.md\` | ***REMOVED*** и смены |
| \`08_zone_address_model.md\` | ***REMOVED*** и адреса |
| \`09_finance_model.md\` | Финансовая модель |
| \`10_mentorship_model.md\` | Наставничество |
| \`11_event_and_audit_model.md\` | <ФИО> и аудит |
| \`12_open_decisions_and_gaps.md\` | Решения и gaps |
| \`13_model_validation_report.md\` | Самопроверка G1–G10 |
| \`README.md\` | Навигация и статус |
`;
}

/* ------------------------------------------------------------------ */
/* 02 — Entity catalog                                                 */
/* ------------------------------------------------------------------ */

function renderEntityCatalog(): string {
  const summaryRows = CONTEXTS.map((c) => {
    const es = ENTITIES.filter((e) => e.bounded_context === c.id);
    const found = es.filter((e) => e.status === "FOUND_IN_SUPERSET_SQL" || e.status === "FOUND_IN_SUPERSET_METADATA" || e.status === "FOUND_IN_FILTER_VALUES" || e.status === "FOUND_AS_SQL_DERIVED").length;
    const missing = es.filter((e) => e.status === "BUSINESS_REQUIRED_NOT_FOUND" || e.status === "NOT_FOUND_IN_SUPERSET" || e.status === "NOT_VERIFIABLE" || e.status === "DESIGN_PROPOSAL").length;
    return [c.id, c.ru_name, String(es.length), String(found), String(missing)];
  });

  const detailRows = ENTITIES.map((e) => [
    e.id,
    e.name,
    e.ru_name,
    e.layer,
    e.bounded_context,
    e.grain,
    e.identity.candidate_keys.join(", ") || "—",
    e.identity.status,
    e.status,
    e.confidence,
    e.decision,
    piiLabel(e.pii),
  ]);

  const notesRows = ENTITIES.filter((e) => e.notes).map((e) => [e.id, e.name, e.notes]);

  return `# 02 — Entity Catalog

**Сгенерировано:** ${GENERATED_AT}  
**Всего сущностей:** ${ENTITIES.length}

## 1. Сводка по контекстам

${mdTable(["***REMOVED***", "Имя", "Сущностей", "Есть evidence", "Нет источника / не проверяемо"], summaryRows)}

## 2. Каталог сущностей

${mdTable(
  ["ID", "Имя", "RU", "Слой", "***REMOVED***", "Grain", "Кандидаты ключа", "Статус ключа", "Статус", "Confidence", "***REMOVED***", "PII"],
  detailRows,
)}

## 3. Ограничения и примечания

${mdTable(["ID", "Сущность", "Примечание"], notesRows)}

## 4. Правила чтения статусов

- \`FOUND_IN_SUPERSET_SQL\` / \`FOUND_IN_SUPERSET_METADATA\` / \`FOUND_IN_FILTER_VALUES\` /
  \`FOUND_AS_SQL_DERIVED\` — присутствие в артефактах Superset, не в данных.
- \`INFERRED_FROM_MULTIPLE_SOURCES\` — вывод по нескольким признакам, не подтверждение.
- \`BUSINESS_REQUIRED_NOT_FOUND\` — бизнес-требование есть, источник не найден.
- \`NOT_FOUND_IN_SUPERSET\` — не найдено в проверенном охвате Superset.
- \`NOT_VERIFIABLE\` — нельзя проверить без доступа к данным.
- \`DESIGN_PROPOSAL\` — проектное предложение, не бизнес-требование.
- \`CONTRADICTED\` — противоречие между источниками зафиксировано.

Ни одна сущность не помечена \`VERIFIED\`: фактическая выборка строк не выполнялась.
`;
}

/* ------------------------------------------------------------------ */
/* 03 — Attribute catalog                                              */
/* ------------------------------------------------------------------ */

function renderAttributeCatalog(): string {
  const covered = new Set(ATTRIBUTES.map((a) => a.entity_id));
  const without = ENTITIES.filter((e) => !covered.has(e.id));

  const perEntity = ENTITIES.filter((e) => covered.has(e.id)).map((e) => {
    const attrs = attributesOf(e.id);
    const rows = attrs.map((a) => [
      a.id,
      a.name,
      a.ru_name,
      a.logical_type,
      a.nullable,
      a.source_field ?? "—",
      a.dataset_id !== null ? String(a.dataset_id) : "—",
      a.evidence_id ?? "—",
      a.status,
      a.confidence,
      piiLabel(a.pii),
      a.notes,
    ]);
    return `### ${e.id} — ${e.ru_name} (${e.name})

${mdTable(["ID", "Поле", "RU", "Логический тип", "Nullable", "Source field", "Dataset", "Evidence", "Статус", "Confidence", "PII", "Примечание"], rows)}
`;
  }).join("\n");

  const withoutRows = without.map((e) => [e.id, e.name, e.status, e.decision, e.notes]);

  return `# 03 — Attribute Catalog

**Сгенерировано:** ${GENERATED_AT}  
**Всего атрибутов:** ${ATTRIBUTES.length}  
**Сущностей с атрибутами:** ${covered.size} из ${ENTITIES.length}

## 1. Правила

- \`logical_type\` — логический тип, не физический.
- \`nullable\` и \`required\` не утверждаются без проверки данных; \`UNKNOWN\` означает,
  что свойство не проверено.
- \`source_fields\` указывает dataset и поле, где атрибут встречается в SQL.
- PII-классификация: \`NONE\` — не персональные данные; \`POSSIBLE\` — возможны;
  \`CONFIRMED\` — подтверждены. Значения PII не выгружаются.

## 2. Атрибуты по сущностям

${perEntity}

## 3. Сущности без подтверждённых атрибутов

${without.length === 0 ? "Все сущности имеют хотя бы один атрибут." : mdTable(["ID", "Сущность", "Статус", "***REMOVED***", "Примечание"], withoutRows)}

Для этих сущностей источник атрибутов не найден или сущность является проектным
предложением. <ФИО> не означает, что атрибутов нет в организации; это означает,
что они не подтверждены в проверенном охвате.
`;
}

/* ------------------------------------------------------------------ */
/* 04 — Relationship catalog                                           */
/* ------------------------------------------------------------------ */

function renderRelationshipCatalog(): string {
  const rows = RELATIONSHIPS.map((r) => [
    r.id,
    r.from_entity,
    r.to_entity,
    r.name,
    r.cardinality,
    r.optionality,
    r.kind,
    r.status,
    r.confidence,
    evidenceRefs(r.evidence_ids),
    r.rationale,
  ]);

  const byKind = ["BUSINESS_CONCEPT", "SQL_JOIN", "INFERRED", "PROPOSED", "HIERARCHY", "MAPPING"]
    .map((k) => {
      const rs = RELATIONSHIPS.filter((r) => r.kind === k);
      if (rs.length === 0) return null;
      return `### ${k} (${rs.length})\n\n${mdTable(["ID", "From", "To", "Cardinality", "Статус"], rs.map((r) => [r.id, r.from_entity, r.to_entity, r.cardinality, r.status]))}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `# 04 — Relationship Catalog

**Сгенерировано:** ${GENERATED_AT}  
**Всего связей:** ${RELATIONSHIPS.length}

## 1. Каталог

${mdTable(["ID", "From", "To", "Имя", "Cardinality", "Optionality", "Kind", "Статус", "Confidence", "Evidence", "Обоснование"], rows)}

## 2. Группировка по kind

${byKind}

## 3. Запрещённые трактовки

- SQL JOIN не является внешним ключом.
- Наличие \`id_*\` не доказывает уникальность или ссылочную целостность.
- \`VERIFIED_BY_DATA\` не используется: фактическая выборка строк не выполнялась.
- Связи \`Pool\` ↔ \`Trip\` помечены как \`INFERRED\` / \`MAPPING\` и не объявлены
  эквивалентностью.
- Cardinality и optionality без проверки данных помечены \`UNKNOWN\`.
`;
}

/* ------------------------------------------------------------------ */
/* 05 — Order lifecycle                                                */
/* ------------------------------------------------------------------ */

function renderOrderLifecycle(): string {
  const order = ENTITY_BY_ID.get("ENT-ORDER");
  const orderAttrs = attributesOf("ENT-ORDER");
  const procs = PROCESSES.filter((p) => p.context === "CTX-ORDER");
  const procRows = procs.map((p) => [p.id, p.ru_name, p.steps.join(" → "), p.events.join(", "), p.timestamps.join(", "), p.source]);

  return `# 05 — Order Lifecycle

**Сгенерировано:** ${GENERATED_AT}

## 1. Сущность Order

${order ? `- **Grain:** ${order.grain}\n- **Identity:** ${order.identity.candidate_keys.join(", ")} (${order.identity.status})\n- **Статус:** ${order.status}, confidence ${order.confidence}\n- *****REMOVED***:** ${order.decision} — ${order.decision_reason}` : "Сущность не найдена в модели."}

## 2. Атрибуты заказа

${mdTable(["ID", "Поле", "Тип", "Nullable", "Статус", "Примечание"], orderAttrs.map((a) => [a.id, a.name, a.logical_type, a.nullable, a.status, a.notes]))}

## 3. <ФИО>-процессы заказа

${mdTable(["ID", "Процесс", "Шаги", "<ФИО>", "Timestamps", "Источник"], procRows)}

## 4. Подтверждённые события

- Создание заказа, обновление, отмена — бизнес-требование.
- Сборка: \`date_collect_start\`, \`date_collected\`, \`date_set_cell\`, \`is_collected\` —
  присутствуют в SQL, но семантика этапов не утверждена.
- Доставка: \`date_delivered\`, \`date_pickuped\`, \`date_supply\` — присутствуют в SQL.

## 5. Неразрешённое состояние готовности

\`time_ready\` и \`time_ready_plan\` отсутствуют в полном SQL датасета 3466.
Кандидаты \`date_set_cell\`, \`date_f_status_3_5\`, \`date_collect_start\`,
\`date_collected\`, \`date_collected_plan\`, \`is_collected\` не являются
автоматическим эквивалентом бизнес-события «заказ готов к выдаче курьеру».

**Статус:** \`BUSINESS_REQUIRED_NOT_FOUND\` / \`NOT_VERIFIABLE\`.
Нельзя утверждать, что события готовности нет в организации; доказано только
отсутствие полей в проверенном SQL.

## 6. SLA и отмены/возвраты

- Пользователь ответил «Нет» на исключение отменённых/возвращённых заказов из SLA.
- Точный расчёт отмен/возвратов требует определения.
- \`7119\` фильтрует \`id_status = 18\`, \`is_route = true\`, последние 14 дней —
  это не универсальная SLA-методика.
- \`1970-01-01\` — sentinel отсутствия даты.
- Глобальный сдвиг +3 часа не применяется.

## 7. MVP-поля списка заказов

${mdTable(["Поле", "RU", "Статус", "Источник", "Примечание"], MVP_FIELDS.map((m) => [m.field, m.ru_name, m.status, m.source, m.notes]))}
`;
}

/* ------------------------------------------------------------------ */
/* 06 — Trip / Pool / assignment                                       */
/* ------------------------------------------------------------------ */

function renderTripPool(): string {
  const trip = ENTITY_BY_ID.get("ENT-TRIP");
  const pool = ENTITY_BY_ID.get("ENT-POOL");
  const tripOrder = ENTITY_BY_ID.get("ENT-TRIP-ORDER");
  const assignment = ENTITY_BY_ID.get("ENT-COURIER-ASSIGNMENT");
  const change = ENTITY_BY_ID.get("ENT-TRIP-COMPOSITION-CHANGE");

  const rows = [trip, pool, tripOrder, assignment, change]
    .filter((e): e is Entity => !!e)
    .map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.decision, e.grain]);

  const rels = RELATIONSHIPS.filter((r) =>
    ["ENT-TRIP", "ENT-POOL", "ENT-TRIP-ORDER", "ENT-COURIER-ASSIGNMENT", "ENT-TRIP-COMPOSITION-CHANGE"].includes(r.from_entity) ||
    ["ENT-TRIP", "ENT-POOL", "ENT-TRIP-ORDER", "ENT-COURIER-ASSIGNMENT", "ENT-TRIP-COMPOSITION-CHANGE"].includes(r.to_entity),
  );

  return `# 06 — Trip / Pool / Assignment

**Сгенерировано:** ${GENERATED_AT}

## 1. Ключевое различие

| Концепт | Что это | Статус |
|---|---|---|
| \`Trip\` | <ФИО>-поездка: один выезд курьера с несколькими заказами | \`BUSINESS_RULE\` / target |
| \`Pool\` | Наблюдаемый источник: \`id_pool\` в SQL Superset | \`FOUND_IN_SUPERSET_SQL\` |
| \`TripOrder\` | Состав поездки: связь поездки и заказов | \`BUSINESS_RULE\` / target |
| \`CourierAssignment\` | Назначение курьера, отдельно от состава | \`BUSINESS_RULE\` / target |
| \`Delivery\` | Результат доставки конкретного заказа | \`FOUND_IN_SUPERSET_SQL\` |

\`Pool\` и \`Trip\` — **разные концепты** до подтверждения эквивалентности.
Потенциальная связь показывается как \`INFERRED\` / \`MAPPING\`.

## 2. Сущности

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "***REMOVED***", "Grain"], rows)}

## 3. Связи

${mdTable(["ID", "From", "To", "Cardinality", "Kind", "Статус", "Обоснование"], rels.map((r) => [r.id, r.from_entity, r.to_entity, r.cardinality, r.kind, r.status, r.rationale]))}

## 4. <ФИО>-правила состава

1. Целевой размер группы — 3–5 заказов; 2 заказа допустимы, если готовы только два.
2. Если готово больше пяти — отбор по времени готовности, срочности и кратчайшему маршруту.
3. Группировка автоматическая, возможна ручная корректировка.
4. Поездка формируется после появления состава; назначение курьера — отдельный процесс.
5. Куратор может менять состав после назначения и до выезда; изменения должны иметь историю.
6. После выезда состав неизменяем.
7. Одна поездка — одна зона.
8. Состав меняет только куратор.
9. 3–5 — бизнес-ориентир, не DB CHECK.
10. Смешение соседних зон — только с отдельным разрешением.

## 5. <ФИО> изменения состава

- \`TripCompositionChange\` — предлагаемая сущность истории изменений.
- Изменения до выезда: mutable, с записью кто/когда/что изменил.
- После выезда: immutable; изменение запрещено.
- В модели **нет** \`CHECK(order_count BETWEEN 3 AND 5)\` и нет \`NOT NULL\`/FK
  на непроверенных полях.

## 6. Что не подтверждено

- Эквивалентность \`Pool\` и \`Trip\`.
- Семантика \`courier_id_darkstore\`: назначенный курьер, курьер на доставке или атрибут факта.
- Фактическая кардинальность \`id_general\` относительно \`id_order\`.
- Источник события выезда и фиксации состава.
- Правила смешения зон.
`;
}

/* ------------------------------------------------------------------ */
/* 07 — Queue / shift lifecycle                                        */
/* ------------------------------------------------------------------ */

function renderQueueShift(): string {
  const procs = PROCESSES.filter((p) => ["PRC-006", "PRC-010"].includes(p.id));
  const entities = ["ENT-QUEUE-ENTRY", "ENT-COURIER-SHIFT", "ENT-SHIFT-BREAK", "ENT-SHIFT-SLOT", "ENT-COURIER"]
    .map((id) => ENTITY_BY_ID.get(id))
    .filter((e): e is Entity => !!e);

  return `# 07 — Queue & Shift Lifecycle

**Сгенерировано:** ${GENERATED_AT}

## 1. ***REMOVED***

<ФИО>-правила:

1. Курьер назначается после прибытия в ТТ и входа в очередь.
2. ***REMOVED*** FIFO.
3. Если курьер не готов при вызове — его пропускают и вызывают следующего.
4. Отказ от предложенной поездки не допускается.
5. Максимальное ожидание не утверждено.
6. Нужно учитывать начало/окончание смены, перерыв и возвращение.
7. Поведение пропущенного курьера при возвращении в очередь не определено.

## 2. Смены

- ***REMOVED*** — временной интервал.
- Есть план одного slot system, но booking vs check-in не выяснено.
- No-show thresholds не утверждены.
- \`ShiftSlot\` — lifecycle unresolved; не подтверждён как booking entity.

## 3. Сущности

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "Grain"], entities.map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.grain]))}

## 4. Процессы

${mdTable(["ID", "Процесс", "Шаги", "<ФИО>", "Timestamps", "Источник"], procs.map((p) => [p.id, p.ru_name, p.steps.join(" → "), p.events.join(", "), p.timestamps.join(", "), p.source]))}

## 5. SQL-наблюдение 7802

\`7802 shift_time_breakdown\` ссылается на:

- \`agile_mart_operational.shifts\` — \`id_shift\`, \`id_courier\`, \`shift_start\`, \`shift_finish\`;
- \`agile_mart_operational.pools\` — \`id_pool\`, \`pool_start\`, \`pool_finish\`;
- \`agile_mart_operational.courier_queue\` — \`courier_id\`, \`queue_in_dttm\`, \`queue_out_dttm\`, \`first_delivery_dttm\`, \`has_order\`.

\`wait_iv\` строится от \`queue_in_dttm\` до \`first_delivery_dttm\`, \`assembly_iv\` —
от \`first_delivery_dttm\` до \`queue_out_dttm\`. \`wait_minutes\` — вычисляемый интервал,
а не подтверждённое бизнес-время ожидания.

## 6. Неутверждённые правила

- FIFO: порядок при равных timestamp и tie-breaker не определены.
- Пропуск и повторный вход: событийная модель не подтверждена.
- No-show: пороги и последствия не утверждены.
- Перерыв: длительность, влияние на очередь и оплату не подтверждены.
- Booking vs check-in: не выяснено.
- Максимальное ожидание: не утверждено.
`;
}

/* ------------------------------------------------------------------ */
/* 08 — Zone / address model                                           */
/* ------------------------------------------------------------------ */

function renderZoneAddress(): string {
  const entities = ["ENT-DELIVERY-ZONE", "ENT-ZONE-BOUNDARY-VERSION", "ENT-ADDRESS", "ENT-ADDRESS-ZONE", "ENT-DARKSTORE", "ENT-ROUTE"]
    .map((id) => ENTITY_BY_ID.get(id))
    .filter((e): e is Entity => !!e);

  return `# 08 — Zone & Address Model

**Сгенерировано:** ${GENERATED_AT}

## 1. <ФИО>-правила зон

1. Одна зона = одно ТТ и окружающая территория.
2. Границы зависят от heatmap/плотности заказов, расстояния и времени доставки.
3. Гео-отдел утверждает границы.
4. Адрес относится к зоне с минимальным временем доставки.
5. История изменения границ технически желательна, но не была обязательным
   бизнес-требованием.
6. Источник справочника delivery zones пока не найден.

## 2. Три разных понятия, которые нельзя смешивать

| Понятие | Где встречается | Семантика | Не является |
|---|---|---|---|
| \`zone_cluster\` | \`mart.org_unit_actual\` | организационная группировка ТТ | DeliveryZone |
| \`inactivity_zone\` | \`hr_delivery\`, датасет 7293 | зона активности/неактивности курьера в HR | DeliveryZone |
| \`cluster_id\` | routing results | кластер в маршрутизационной аналитике | DeliveryZone |

Ни одно из полей не доказывает наличие целевой \`DeliveryZone\` с геометрией,
границами, назначением адреса и версионированием.

## 3. Сущности

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "***REMOVED***", "Grain"], entities.map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.decision, e.grain]))}

## 4. Предлагаемая модель

- \`DeliveryZone\` — бизнес-зона: ТТ + территория; статус \`BUSINESS_REQUIRED_NOT_FOUND\`.
- \`ZoneBoundaryVersion\` — проектное предложение версионирования границ;
  **не бизнес-требование**.
- \`Address\` — адрес клиента; канонический мастер не подтверждён.
- \`AddressToZoneAssignment\` — связь адреса и зоны по минимальному времени доставки;
  источник не найден.

## 5. Gaps

- Нет подтверждённой геометрии и границ зон.
- Нет подтверждённого мастер-адреса и геокодирования.
- Нет связи customer address → delivery zone.
- Нет владельца master data зон.
- Версионирование границ — предложение, не мандат.

## 6. Что нужно от Geo

1. Где хранится справочник delivery zones и геометрия границ?
2. Где хранится адрес → зона и версия назначения?
3. \`cluster_id\`, \`zone_cluster\` или иное поле является географическим кластером доставки?
4. Кто владелец справочника?
`;
}

/* ------------------------------------------------------------------ */
/* 09 — Finance                                                        */
/* ------------------------------------------------------------------ */

function renderFinance(): string {
  const entities = ENTITIES.filter((e) => e.bounded_context === "CTX-FINANCE");
  const procs = PROCESSES.filter((p) => p.context === "CTX-FINANCE");

  return `# 09 — Finance Model

**Сгенерировано:** ${GENERATED_AT}

## 1. <ФИО>-правила оплаты

1. Оплата за каждый доставленный заказ.
2. Зависит от зоны и расстояния.
3. Начисление после доставки каждого заказа.
4. Отменённый заказ не оплачивается.
5. В поездке с несколькими заказами оплачиваются только доставленные.
6. Ожидание включено в стоимость заказа; отдельной оплаты простоя нет.
7. Штрафов нет.
8. Возможная зависимость тарифа от нагрузки; формула не утверждена.
9. Первые пять смен — референс, не универсальный тариф.
10. Тарифы и утверждающий владелец неизвестны.
11. \`sum_order\` / \`sum_paid\` не являются доходом курьера.

## 2. Сущности финансов

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "***REMOVED***", "Grain"], entities.map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.decision, e.grain]))}

## 3. Процессы

${mdTable(["ID", "Процесс", "Шаги", "<ФИО>", "Timestamps", "Источник"], procs.map((p) => [p.id, p.ru_name, p.steps.join(" → "), p.events.join(", "), p.timestamps.join(", "), p.source]))}

## 4. Предлагаемая модель

- \`Tariff\` + \`TariffVersion\` + \`TariffRule\` — версионируемый тариф; формула open.
- \`CourierAccrual\` + \`AccrualLine\` — начисление за доставленный заказ.
- \`Payout\` + \`PayoutLine\` — выплата; источник не найден.

## 5. Что нельзя утверждать

- \`shift_N_profit\` — аналитика первых пяти смен, не универсальный тариф и не ledger.
- \`sum_order\` / \`sum_paid\` — суммы заказа/оплаты, не заработок курьера.
- \`events_qty\` — не явка курьера.
- Начисление и выплата не разделены на подтверждённые источники.
- Нет версии тарифов, effective dates и владельца утверждения.

## 6. Что нужно от Finance

1. Где тарифы, версии и даты действия?
2. Где факт начисления за конкретный доставленный заказ?
3. Где факт выплаты курьеру?
4. Как утверждается тариф и как фиксируется изменение формулы?
`;
}

/* ------------------------------------------------------------------ */
/* 10 — Mentorship                                                     */
/* ------------------------------------------------------------------ */

function renderMentorship(): string {
  const entities = ENTITIES.filter((e) => e.bounded_context === "CTX-HR");
  const procs = PROCESSES.filter((p) => p.context === "CTX-HR");

  return `# 10 — Mentorship Model

**Сгенерировано:** ${GENERATED_AT}

## 1. <ФИО>-правила наставничества

1. Куратор — наставник.
2. Сопровождение — две недели.
3. Оценка по первым пяти сменам, качеству доставки и соблюдению правил.
4. Куратор может добавлять заказы в свою группу с учётом нагрузки/доступности.
5. Жёсткого лимита стажёров нет; можно предусмотреть предупреждение.
6. Кто назначает стажёра куратору — неизвестно.
7. Критерии завершения/продления после двух недель требуют уточнения.

## 2. Сущности

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "***REMOVED***", "Grain"], entities.map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.decision, e.grain]))}

## 3. Процессы

${mdTable(["ID", "Процесс", "Шаги", "<ФИО>", "Timestamps", "Источник"], procs.map((p) => [p.id, p.ru_name, p.steps.join(" → "), p.events.join(", "), p.timestamps.join(", "), p.source]))}

## 4. HR-evidence и его ограничения

\`5939 hr_daily_pers_mentors\` использует \`agile_mart_techaudit.hr_daily_pers\`,
\`actual_assistant_tt\`, \`stage_outer_sources.fio_employee\` и выводит \`mentorid\`,
\`mentorid_at_date\`, \`mentor_at_date\`, \`mentor_in_five\`, \`shift_rn_trainee\`,
\`trainee_shift_in_five\`, \`trainee_shifts_qty\`, \`mentor_same_tt_date\`.

<ФИО> реальное evidence о наставнических атрибутах в HR-аналитике. Но SQL описывает
наставничество персонала/сотрудников в розничном контуре и не доказывает, что эти
поля полностью покрывают процесс «куратор — стажёр-курьер» с двухнедельным
сопровождением.

\`date_for_mentor\` в SQL \`5939\` отсутствует — прежнее упоминание считать stale metadata.

## 5. Разделение в модели

- \`HrMentorship\` — наблюдаемый HR-контекст (частично прослеживается).
- \`CourierMentorship\` — целевая курьерская программа (требует подтверждения).
- \`MentorshipAssessment\` — оценка по первым пяти сменам; источник не найден.

## 6. Что нужно от HR

1. Применяются ли \`mentorid_at_date\` и \`trainee_shift_in_five\` к курьерам или к сотрудникам розницы?
2. Где хранится назначение курьера куратору и период двухнедельного сопровождения?
3. Кто утверждает завершение/продление обучения?
`;
}

/* ------------------------------------------------------------------ */
/* 11 — Event & audit model                                            */
/* ------------------------------------------------------------------ */

function renderEventAudit(): string {
  const eventEntities = ["ENT-BUSINESS-EVENT", "ENT-TRIP-COMPOSITION-CHANGE", "ENT-COURIER-APP-EVENT", "ENT-SOURCE-SYSTEM", "ENT-EVIDENCE-REFERENCE"]
    .map((id) => ENTITY_BY_ID.get(id))
    .filter((e): e is Entity => !!e);

  const events = PROCESSES.flatMap((p) => p.events.map((e) => ({ process: p.id, event: e })));

  return `# 11 — Event & Audit Model

**Сгенерировано:** ${GENERATED_AT}

## 1. <ФИО> по процессам

${mdTable(["Процесс", "Событие"], events.map((e) => [e.process, e.event]))}

## 2. Сущности событий и аудита

${mdTable(["ID", "Имя", "Слой", "Статус", "Confidence", "Grain"], eventEntities.map((e) => [e.id, e.name, e.layer, e.status, e.confidence, e.grain]))}

## 3. Append-only vs mutable state

- \`BusinessEvent\` — единая модель событий **не навязывается**; допустима только
  при обосновании. Статус \`NOT_VERIFIABLE\`.
- \`TripCompositionChange\` — append-only история изменений состава поездки до выезда.
- \`CourierAppEvent\` — агрегированный слой телеметрии, не нормализованный event store.
- \`EntityChangeLog\` — не подтверждён как существующий источник; проектное предложение.

## 4. Кто меняет состав поездки

- Только куратор.
- До выезда: изменение разрешено, должна оставаться история.
- После выезда: изменение запрещено.
- Назначение курьера — отдельный процесс, не часть состава.

## 5. Idempotency recommendations

1. Ключ идемпотентности события: \`event_type + entity_id + occurred_at\` (при наличии
   стабильного ID).
2. Повторная обработка не должна создавать дубль начисления или изменения состава.
3. Для \`TripCompositionChange\` — уникальность по \`trip_id + change_seq\`.
4. Для \`CourierAccrual\` — уникальность по \`order_id + delivered_at\` при подтверждении
   зерна.
5. Все рекомендации — проектные, не подтверждённые источником.

## 6. Что не подтверждено

- Единый журнал событий.
- Событие выезда и фиксации состава.
- <ФИО> очереди: вызов, пропуск, возврат, no-show.
- <ФИО> отмены/возврата в SLA.
- Фактическая семантика timestamp в событиях.
`;
}

/* ------------------------------------------------------------------ */
/* 12 — Open decisions and gaps                                        */
/* ------------------------------------------------------------------ */

function renderDecisionsAndGaps(): string {
  const decisionRows = DECISIONS.map((d) => [d.id, d.title, d.status, d.owner, d.impact, d.blocking, d.closes_with]);
  const gapRows = GAPS.map((g) => [g.id, g.title, g.priority, g.gap_type, g.missing, g.impact, g.resolution, g.owner]);

  const p0 = GAPS.filter((g) => g.priority === "P0_BLOCKER");
  const p1 = GAPS.filter((g) => g.priority === "P1_HIGH");

  return `# 12 — Open Decisions & Gaps

**Сгенерировано:** ${GENERATED_AT}  
**Решений:** ${DECISIONS.length}  
**Gaps:** ${GAPS.length} (P0: ${p0.length}, P1: ${p1.length})

## 1. <ФИО> решения

${mdTable(["ID", "Тема", "Статус", "Владелец", "Влияние", "Что блокирует", "Чем закрывается"], decisionRows)}

## 2. Gaps

${mdTable(["ID", "Gap", "Приоритет", "Тип", "Чего нет", "Влияние", "Как закрыть", "Владелец"], gapRows)}

## 3. P0 blockers

${p0.length === 0 ? "P0 blockers не зафиксированы." : list(p0.map((g) => `- **${g.id}** ${g.title}: ${g.missing} → ${g.resolution}`))}

## 4. P1 blockers

${p1.length === 0 ? "P1 blockers не зафиксированы." : list(p1.map((g) => `- **${g.id}** ${g.title}: ${g.missing} → ${g.resolution}`))}

## 5. ***REMOVED***

<ФИО> решения и gaps не скрываются и не заменяются догадками. Пока решение не
принято, соответствующая сущность/связь остаётся в статусе, отражающем
неопределённость (\`UNKNOWN\`, \`NOT_VERIFIABLE\`, \`BUSINESS_DECISION_REQUIRED\`,
\`INFERRED\`).
`;
}

/* ------------------------------------------------------------------ */
/* 13 — Validation report (rendered after validation)                  */
/* ------------------------------------------------------------------ */

export interface ValidationCheck {
  id: string;
  title: string;
  status: "PASS" | "FAIL" | "WARN" | "BLOCKED";
  details: string;
}

export interface ValidationResult {
  stage: string;
  verdict: "PASS" | "PASS_WITH_BLOCKERS" | "PARTIAL" | "FAIL";
  generated_at: string;
  checks: ValidationCheck[];
  summary: { pass: number; fail: number; warn: number; blocked: number };
  safety: Record<string, boolean | number>;
  blockers: string[];
}

export function renderValidationReport(v: ValidationResult): string {
  const rows = v.checks.map((c) => [c.id, c.title, c.status, c.details]);
  return `# 13 — Model Validation Report

**Сгенерировано:** ${v.generated_at}  
**Verdict:** \`${v.verdict}\`

## 1. Сводка

${mdTable(["Показатель", "Значение"], [
  ["PASS", String(v.summary.pass)],
  ["FAIL", String(v.summary.fail)],
  ["WARN", String(v.summary.warn)],
  ["BLOCKED", String(v.summary.blocked)],
])}

## 2. <ФИО> G1–G10

${mdTable(["ID", "Проверка", "Статус", "Детали"], rows)}

## 3. Safety

${mdTable(["Флаг", "Значение"], Object.entries(v.safety).map(([k, val]) => [k, String(val)]))}

## 4. Blockers

${v.blockers.length === 0 ? "Критических blockers нет." : list(v.blockers)}

## 5. ***REMOVED***

<ФИО> выполнялись статически по артефактам. Mermaid-диаграммы проверены
структурно (\`STATIC_VALIDATION\`), без полноценного render test. Фактические
SELECT к source DB не выполнялись, поэтому \`VERIFIED\` статусы не присваивались.
`;
}

/* ------------------------------------------------------------------ */
/* 14 — README                                                         */
/* ------------------------------------------------------------------ */

export function renderReadme(v: ValidationResult): string {
  return `# Logical Data Model & ERD — Этап 1.8

**Статус:** \`${v.verdict}\`  
**Сгенерировано:** ${v.generated_at}

## Что это

Логическая модель курьерской службы: сущности, атрибуты, связи, evidence,
открытые решения и инварианты. <ФИО> не является физической схемой и не
запускает миграции.

## Навигация

| Документ | О чём |
|---|---|
| \`01_logical_model_overview.md\` | Цели, границы, контексты, допущения |
| \`02_entity_catalog.md\` | Каталог сущностей |
| \`03_attribute_catalog.md\` | Каталог атрибутов |
| \`04_relationship_catalog.md\` | Каталог связей |
| \`05_order_lifecycle.md\` | Жизненный цикл заказа |
| \`06_trip_pool_assignment.md\` | Trip / Pool / назначение |
| \`07_queue_shift_lifecycle.md\` | ***REMOVED*** и смены |
| \`08_zone_address_model.md\` | ***REMOVED*** и адреса |
| \`09_finance_model.md\` | Финансовая модель |
| \`10_mentorship_model.md\` | Наставничество |
| \`11_event_and_audit_model.md\` | <ФИО> и аудит |
| \`12_open_decisions_and_gaps.md\` | Решения и gaps |
| \`13_model_validation_report.md\` | Самопроверка G1–G10 |
| \`README.md\` | Эта страница |

## Диаграммы

\`diagrams/\` — 7 Mermaid-файлов. Они соответствуют JSON-каталогам; связи без
подтверждения помечены \`INFERRED\`, \`PROPOSED\`, \`BUSINESS_RULE\`.

## Машиночитаемые артефакты

\`reports/phase-01-8/\`:

- \`logical_model.json\` — полная модель;
- \`entities.json\`, \`attributes.json\`, \`relationships.json\` — каталоги;
- \`evidence_links.json\` — evidence;
- \`open_decisions.json\` — решения;
- \`model_validation.json\` — результаты проверок;
- \`model_manifest.json\` — манифест и хэши;
- \`preflight.json\`, \`final_validation.json\`, \`phase_01_8_summary.md\`.

## Ключевые числа

- Сущностей: ${ENTITIES.length};
- Атрибутов: ${ATTRIBUTES.length};
- Связей: ${RELATIONSHIPS.length};
- Evidence: ${EVIDENCE.length};
- Решений: ${DECISIONS.length};
- Инвариантов: ${INVARIANTS.length};
- Gaps: ${GAPS.length}.

## Главное ограничение

SQL Lab и chart data недоступны (403/401), поэтому фактические значения,
распределения, кардинальности и уникальность не проверены. <ФИО> честно
показывает это через статусы и gaps, а не через догадки.
`;
}

/* ------------------------------------------------------------------ */
/* Diagrams                                                            */
/* ------------------------------------------------------------------ */

function sanitizeMermaid(id: string): string {
  return id.replace(/^ENT-/, "").replace(/-/g, "_");
}

function contextMap(): string {
  const lines: string[] = ["flowchart LR"];
  for (const c of CONTEXTS) {
    lines.push(`  subgraph ${sanitizeMermaid(c.id)}["${c.ru_name}"]`);
    for (const eid of c.entities) {
      const e = ENTITY_BY_ID.get(eid);
      if (e) lines.push(`    ${sanitizeMermaid(eid)}["${e.name}"]`);
    }
    lines.push("  end");
  }
  for (const r of RELATIONSHIPS) {
    const from = sanitizeMermaid(r.from_entity);
    const to = sanitizeMermaid(r.to_entity);
    const tag = r.status === "BUSINESS_RULE" ? "BUSINESS_RULE" : r.status === "INFERRED_RELATIONSHIP" ? "INFERRED" : r.status === "PROPOSED" ? "PROPOSED" : r.status;
    lines.push(`  ${from} -.->|${tag}| ${to}`);
  }
  return lines.join("\n") + "\n";
}

function erdForContext(contextId: string, title: string): string {
  const es = ENTITIES.filter((e) => e.bounded_context === contextId);
  const lines: string[] = [`erDiagram`, `  %% ${title}`];
  for (const e of es) {
    const name = sanitizeMermaid(e.id);
    lines.push(`  ${name} {`);
    const attrs = attributesOf(e.id).slice(0, 8);
    for (const a of attrs) {
      const type = a.logical_type.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`    ${type} ${a.name.replace(/[^a-zA-Z0-9_]/g, "_")}`);
    }
    lines.push("  }");
  }
  const ids = new Set(es.map((e) => e.id));
  for (const r of RELATIONSHIPS) {
    if (!ids.has(r.from_entity) || !ids.has(r.to_entity)) continue;
    const from = sanitizeMermaid(r.from_entity);
    const to = sanitizeMermaid(r.to_entity);
    const label = `${r.status} ${r.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const card = r.cardinality === "1:N" ? "||--o{" : r.cardinality === "N:1" ? "}o--||" : r.cardinality === "1:1" ? "||--||" : "||--o{";
    lines.push(`  ${from} ${card} ${to} : ${label}`);
  }
  return lines.join("\n") + "\n";
}

function orderTripLifecycle(): string {
  return `stateDiagram-v2
  [*] --> Created: OrderCreated
  Created --> Assembling: AssemblyStarted
  Assembling --> Collected: date_collected
  Collected --> Ready: READY_UNCONFIRMED
  Ready --> InTrip: TripDeparted
  InTrip --> Delivered: OrderDelivered
  InTrip --> Cancelled: OrderCancelled
  InTrip --> Returned: OrderReturned
  Delivered --> [*]
  Cancelled --> [*]
  Returned --> [*]
  note right of Ready
    ReadyEvent не подтверждён:
    time_ready отсутствует в SQL 3466.
    Кандидаты date_set_cell/is_collected
    не эквивалентны бизнес-событию.
  end note
`;
}

function queueShiftLifecycle(): string {
  return `stateDiagram-v2
  [*] --> ShiftPlanned: ShiftSlot planned (unconfirmed)
  ShiftPlanned --> ShiftStarted: shift_start
  ShiftStarted --> InQueue: queue_in_dttm
  InQueue --> Called: CourierCalled
  Called --> Assigned: CourierAssigned
  Called --> Skipped: CourierSkipped
  Skipped --> InQueue: return (rule open)
  Assigned --> OnTrip: TripDeparted
  OnTrip --> Delivered: OrderDelivered
  Delivered --> InQueue: queue_in_dttm (next)
  InQueue --> Break: break (rules open)
  Break --> InQueue: return
  InQueue --> ShiftEnded: shift_finish
  ShiftEnded --> [*]
  note right of Skipped
    Поведение пропущенного курьера
    при возвращении не определено.
  end note
`;
}

function sourceToTargetMapping(): string {
  const pairs = ENTITIES.filter((e) => e.layer === "BOTH").map((e) => e);
  const lines = ["flowchart LR", "  subgraph OBSERVED[\"Observed Source Concepts\"]"];
  for (const e of ENTITIES.filter((x) => x.layer === "OBSERVED_SOURCE" || x.layer === "BOTH")) {
    lines.push(`    S_${sanitizeMermaid(e.id)}["${e.name}"]`);
  }
  lines.push("  end", "  subgraph TARGET[\"Target Logical Model\"]");
  for (const e of ENTITIES.filter((x) => x.layer === "TARGET_LOGICAL" || x.layer === "BOTH")) {
    lines.push(`    T_${sanitizeMermaid(e.id)}["${e.name}"]`);
  }
  lines.push("  end");
  for (const e of pairs) {
    lines.push(`  S_${sanitizeMermaid(e.id)} ==> T_${sanitizeMermaid(e.id)}`);
  }
  for (const r of RELATIONSHIPS.filter((x) => x.kind === "MAPPING" || x.status === "INFERRED_RELATIONSHIP")) {
    lines.push(`  S_${sanitizeMermaid(r.from_entity)} -.->|${r.status}| T_${sanitizeMermaid(r.to_entity)}`);
  }
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Public render API                                                   */
/* ------------------------------------------------------------------ */

export function ensureDirs(): void {
  for (const d of [DOCS_DIR, DIAGRAMS_DIR, REPORTS_DIR]) {
    mkdirSync(d, { recursive: true });
  }
}

export function renderDiagrams(): Record<string, string> {
  return {
    "01_context_map.mmd": contextMap(),
    "02_operations_erd.mmd": erdForContext("CTX-COURIER", "Operations ERD"),
    "03_finance_erd.mmd": erdForContext("CTX-FINANCE", "Finance ERD"),
    "04_hr_mentorship_erd.mmd": erdForContext("CTX-HR", "HR / Mentorship ERD"),
    "05_order_trip_lifecycle.mmd": orderTripLifecycle(),
    "06_queue_shift_lifecycle.mmd": queueShiftLifecycle(),
    "07_source_to_target_mapping.mmd": sourceToTargetMapping(),
  };
}

export function renderDocuments(): Record<string, string> {
  return {
    "01_logical_model_overview.md": renderOverview(),
    "02_entity_catalog.md": renderEntityCatalog(),
    "03_attribute_catalog.md": renderAttributeCatalog(),
    "04_relationship_catalog.md": renderRelationshipCatalog(),
    "05_order_lifecycle.md": renderOrderLifecycle(),
    "06_trip_pool_assignment.md": renderTripPool(),
    "07_queue_shift_lifecycle.md": renderQueueShift(),
    "08_zone_address_model.md": renderZoneAddress(),
    "09_finance_model.md": renderFinance(),
    "10_mentorship_model.md": renderMentorship(),
    "11_event_and_audit_model.md": renderEventAudit(),
    "12_open_decisions_and_gaps.md": renderDecisionsAndGaps(),
  };
}

export function renderMachineReadable(): Record<string, unknown> {
  const summary = {
    entities: ENTITIES.length,
    attributes: ATTRIBUTES.length,
    relationships: RELATIONSHIPS.length,
    evidence: EVIDENCE.length,
    decisions: DECISIONS.length,
    invariants: INVARIANTS.length,
    gaps: GAPS.length,
    contexts: CONTEXTS.length,
    processes: PROCESSES.length,
    mvp_fields: MVP_FIELDS.length,
    metrics: METRICS.length,
    by_status: countBy(ENTITIES, (e) => e.status),
    by_confidence: countBy(ENTITIES, (e) => e.confidence),
    by_context: countBy(ENTITIES, (e) => e.bounded_context),
  };

  return {
    "logical_model.json": {
      stage: "1.8",
      generated_at: GENERATED_AT,
      layers: {
        observed_source: ENTITIES.filter((e) => e.layer === "OBSERVED_SOURCE").length,
        target_logical: ENTITIES.filter((e) => e.layer === "TARGET_LOGICAL").length,
        both: ENTITIES.filter((e) => e.layer === "BOTH").length,
      },
      contexts: CONTEXTS,
      entities: ENTITIES,
      attributes: ATTRIBUTES,
      relationships: RELATIONSHIPS,
      evidence: EVIDENCE,
      decisions: DECISIONS,
      invariants: INVARIANTS,
      gaps: GAPS,
      processes: PROCESSES,
      mvp_fields: MVP_FIELDS,
      metrics: METRICS,
      summary,
    },
    "entities.json": ENTITIES,
    "attributes.json": ATTRIBUTES,
    "relationships.json": RELATIONSHIPS,
    "evidence_links.json": EVIDENCE,
    "open_decisions.json": DECISIONS,
    "model_manifest.json": {
      stage: "1.8",
      generated_at: GENERATED_AT,
      summary,
      files: [],
    },
  };
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    const k = key(i);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export const FILES = {
  DOCS_DIR,
  DIAGRAMS_DIR,
  REPORTS_DIR,
  GENERATED_AT,
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
  CONTEXTS,
};
