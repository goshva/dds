/**
 * Этап 1.6.2 — генерация документов и итогового отчёта из локальных результатов.
 * Не делает сетевых запросов. Пишет docs/phase-01-6-2/*, reports/phase-01-6-2/analytical_checks.md,
 * reports/phase-01-6-2/phase_01_6_2_summary.md.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, nowIso, readJson, redactPii } from "./utils";

const REPORTS = "reports/phase-01-6-2";
const DOCS = "docs/phase-01-6-2";

function write(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, redactPii(content), "utf8");
}

function main() {
  const stats = readJson<any>(join(REPORTS, "analysis_stats.json"));
  const access = readJson<any>(join(REPORTS, "superset_access_matrix.json"));
  const values = readJson<any>(join(REPORTS, "column_values.json"));
  const netwatch = readJson<any>(join(REPORTS, "evidence", "connectivity_watch.json"));
  const syncManifest = readJson<any>(join("data", "snapshots", "phase-01-6-2", "manifest.json"));

  const s = stats ?? {};
  const v = values ?? {};
  const a = access ?? {};
  const summary = v.summary ?? {};
  const cols: any[] = Array.isArray(v.columns) ? v.columns : [];
  const byEvidence = (e: string) => cols.filter((c) => c.evidence_status === e).length;
  const colsWithValues = cols.filter((c) => c.retrieval_status !== "NOT_AVAILABLE").length;
  const distinctObserved = new Set(
    cols.flatMap((c) => (c.top_values ?? []).map((t: any) => `${c.dataset_id}::${c.column_name}::${t.value}`)),
  ).size;
  const datasetSqlCols = cols.filter((c) => c.source === "dataset_sql").length;

  write(join(DOCS, "01_scope.md"), [
    "# Этап 1.6.2 — границы работ",
    "",
    "## ***REMOVED***",
    "<ФИО> максимально полный набор доступных сведений Superset о реальном содержимом источников",
    "и подготовить аналитический пакет для проверки логической модели Этапа 1.5.",
    "",
    "## Что входит",
    "- Матрица доступных возможностей Superset (штатные API, без обхода RBAC).",
    "- Инвентаризация датасетов, чартов, дашбордов и фильтров.",
    "- Доступные значения колонок из разрешённых источников.",
    "- Каталоги полей, временных полей, метрик и связей-кандидатов.",
    "- Аналитический пакет и итоговый отчёт.",
    "",
    "## Что не входит",
    "- Изменение Superset, датасетов, чартов, дашбордов.",
    "- DDL/DML, миграции, ETL, backfill.",
    "- Обход RBAC и SQL Lab.",
    "- Извлечение PII и персональных данных.",
    "- Изменение `data/catalog.sqlite` и артефактов этапов 1.1–1.6.",
    "",
    "## Источники",
    "- Штатные GET-эндпоинты Superset API.",
    "- SQL Lab — только при наличии штатного разрешения (фактически недоступен).",
    "- Ранее сохранённые артефакты этапов 1.4–1.6 — только как справочные.",
    "",
    `Дата формирования: ${nowIso()}.`,
  ].join("\n"));

  write(join(DOCS, "02_access_results.md"), [
    "# Этап 1.6.2 — результаты проверки доступа",
    "",
    "## Матрица возможностей",
    "",
    "| Возможность | Статус |",
    "|---|---|",
    ...Object.entries(a.capabilities ?? {}).map(([k, val]) => `| ${k} | ${val} |`),
    "",
    "## Пробы",
    "",
    "| ID | Возможность | Endpoint | HTTP | мс |",
    "|---|---|---|---:|---:|",
    ...(a.probes ?? []).map((p: any) => `| ${p.id} | ${p.capability} | ${p.endpoint} | ${p.http_status ?? "—"} | ${p.duration_ms ?? "—"} |`),
    "",
    "## Ограничения",
    "- SQL Lab (`/api/v1/sqllab/execute/`) — 403; `/api/v1/database/` возвращает 0 доступных баз.",
    "- Chart data API — 401.",
    "- Прямые значения колонок через `/api/v1/dataset/{id}/values` — маршрут отсутствует; вариант `/datasource/.../values` — 403.",
    "",
    "## Сетевой простой",
    netwatch
      ? `Зафиксирован простой соединения с Superset. Начало: ${netwatch.started_at ?? "—"}; восстановление: ${netwatch.restored_at ?? "не зафиксировано"}. Всего попыток: ${(netwatch.attempts ?? []).length}.`
      : "Простей не зафиксировано в отдельном файле.",
    "",
    "Доступность API не считается доказательством права выполнять SQL.",
  ].join("\n"));

  write(join(DOCS, "03_extraction_methodology.md"), [
    "# Этап 1.6.2 — методика извлечения",
    "",
    "## Порядок источников значений",
    "1. Фильтры дашбордов (значения по умолчанию).",
    "2. Определения чартов (`adhoc_filters`, `filters`).",
    "3. SQL Lab / chart data — только при наличии прав.",
    "4. Метаданные и SQL-определения — как описание, не как доказательство значений.",
    "",
    "## Классификация происхождения",
    "| Класс | Значение |",
    "|---|---|",
    "| ACTUAL_VALUES | Получено из результатов запросов к данным |",
    "| FILTER_VALUES | Получено из фильтров дашбордов |",
    "| SQL_DERIVED | Выведено из SQL-логики и определений чартов |",
    "| METADATA_ONLY | Только описание и типы |",
    "| NOT_AVAILABLE | Получить не удалось |",
    "",
    "## Ограничения выборок",
    "- До 500 уникальных значений на категориальную колонку.",
    "- До 100 наиболее частых значений для высококардинальных колонок.",
    "- До 50 строк агрегированных результатов на запрос.",
    "- Полная выгрузка строк не выполнялась.",
    "",
    "## Идемпотентность и сохранность",
    "- Синхронизация метаданных — с повторным использованием готовых файлов.",
    "- Частичные результаты сохраняются после каждого этапа.",
    "- Секреты и токены в отчёты не попадают.",
    "- PII не извлекается; фиксируется только наличие поля.",
  ].join("\n"));

  write(join(DOCS, "04_data_quality.md"), [
    "# Этап 1.6.2 — качество данных и покрытие",
    "",
    "## Покрытие",
    `- Датасетов в каталоге: **${s.datasets_total ?? "—"}**.`,
    `- Датасетов с детальными метаданными: **${s.datasets_detail_loaded ?? "—"}**.`,
    `- Колонок проанализировано: **${s.columns_total ?? "—"}**.`,
    `- Колонок со значениями из фильтров: **${s.columns_with_values ?? "—"}**.`,
    `- Чартов: **${s.charts_total ?? "—"}**; дашбордов: **${s.dashboards_total ?? "—"}**.`,
    "",
    "## Происхождение значений",
    `- FILTER_VALUES: ${summary.dashboards_with_filters ?? "—"}; SQL_DERIVED: ${summary.charts_with_filters ?? "—"}; ACTUAL_VALUES: 0.`,
    "",
    "## Ограничения",
    "- Фактические значения из данных не получены: SQL Lab и chart data недоступны.",
    "- Частоты отражают число определений, а не частоту в данных.",
    "- Специальные даты (`1970-01-01`) не заменялись на NULL.",
    "- PII-колонки не выгружались.",
  ].join("\n"));

  write(join(DOCS, "05_model_impact.md"), [
    "# Этап 1.6.2 — влияние на модель данных",
    "",
    "## Что подтверждено",
    "- Метаданные и структура источников доступны и пригодны для инвентаризации.",
    "- Определения чартов содержат статусы, категории и фильтры, полезные для уточнения модели.",
    "",
    "## Что осталось неподтверждённым",
    "- Фактические значения, распределения, NULL-доли и кардинальности.",
    "- Уникальность зерна и покрытие связей.",
    "- <ФИО>-смысл статусов и показателей.",
    "",
    "## Влияние на Этапы 1.7–1.9",
    "- <ФИО> можно уточнять по метаданным и определениям чартов.",
    "- Финальный DDL и миграции нельзя утверждать без фактических проверок.",
    "- Требуется доступ к SQL Lab или эквивалентному read-only каналу.",
  ].join("\n"));

  // analytical checks
  const statusValues = s.status_values ?? [];
  const checks: string[] = [];
  checks.push("# Этап 1.6.2 — аналитические проверки");
  checks.push("");
  checks.push("<ФИО> выполнены по доступным значениям и метаданным; фактические данные не получены.");
  checks.push("");
  checks.push("## 1. Одинаковые статусы в разных датасетах");
  checks.push(statusValues.length ? statusValues.slice(0, 40).map((x: any) => `- ${x.dataset_id} / ${x.column_name}: ${x.values.slice(0, 10).join(", ")}`).join("\n") : "Статусы в определениях фильтров не обнаружены.");
  checks.push("");
  checks.push("## 2. Статусы, отсутствующие в отдельных источниках");
  checks.push("Сравнение невозможно без фактических значений; зафиксировано только наличие полей в метаданных.");
  checks.push("");
  checks.push("## 3. Временные поля по источникам");
  checks.push(`Временных полей в P0/P1: **${s.temporal_fields_total ?? "—"}**. Диапазоны не измерены.`);
  checks.push("");
  checks.push("## 4. NULL и специальные даты");
  checks.push("NULL-доли не измерены. Дата `1970-01-01` не заменялась; специальные значения не подтверждены.");
  checks.push("");
  checks.push("## 5. Потенциальные идентификаторы");
  checks.push("Выявлены по именам полей (`id_*`, `*_id`, `*_code`, `*_key`); уникальность не проверена.");
  checks.push("");
  checks.push("## 6. Поля-связки");
  checks.push(`Кандидатов связей: **${s.relationships_total ?? "—"}**. Все — на уровне имён и SQL, не данных.`);
  checks.push("");
  checks.push("## 7. Отношения с подтверждённой кратностью");
  checks.push("Нет: кардинальность не измерена.");
  checks.push("");
  checks.push("## 8. Одинаковые названия метрик с разными формулами");
  checks.push("Выявлены по каталогу метрик; см. `analysis_package/metrics_catalog.csv`.");
  checks.push("");
  checks.push("## 9. Технические заглушки");
  checks.push("Проверены значения `1970-01-01`, пустые строки, `NULL`, `-1`; без данных подтвердить нельзя.");
  checks.push("");
  checks.push("## 10. <ФИО> и противоречивые определения");
  checks.push("Зафиксированы ранее: `time_ready` в 3466, `date_for_mentor` в 5939, `shift_type` в 7021.");
  write(join(REPORTS, "analytical_checks.md"), checks.join("\n"));

  // summary
  const summaryLines: string[] = [];
  summaryLines.push("# Этап 1.6.2 — итоговый отчёт");
  summaryLines.push("");
  summaryLines.push(`Сформировано: ${nowIso()}.`);
  summaryLines.push("");
  summaryLines.push("## 1. Сколько датасетов обнаружено");
  summaryLines.push(`В каталоге: **${s.datasets_total ?? "—"}**.`);
  summaryLines.push("");
  summaryLines.push("## 2. Сколько датасетов исследовано");
  summaryLines.push(`Детальные метаданные: **${s.datasets_detail_loaded ?? "—"}** (P0+P1).`);
  summaryLines.push("");
  summaryLines.push("## 3. Сколько колонок проанализировано");
  summaryLines.push(`**${s.columns_total ?? "—"}**.`);
  summaryLines.push("");
  summaryLines.push("## 4. Сколько колонок имеют фактические значения");
  summaryLines.push(`**${byEvidence("ACTUAL_VALUES")}** — фактические значения из данных не получены (SQL Lab 403, chart data 401). Колонок с какими-либо значениями (фильтры/SQL): **${colsWithValues}**; различных наблюдённых значений: **${distinctObserved}**.`);
  summaryLines.push("");
  summaryLines.push("## 5. Сколько значений получено из фильтров");
  summaryLines.push(`FILTER_VALUES: **${byEvidence("FILTER_VALUES")}** колонок; дашбордов с native-фильтрами: **${summary.dashboards_with_filters ?? "—"}**; чартов с определениями фильтров: **${summary.charts_with_filters ?? "—"}**; всего строк фильтров: **${s.dashboard_filters_total ?? "—"}**.`);
  summaryLines.push("");
  summaryLines.push("## 6. Сколько значений выведено только из SQL");
  summaryLines.push(`SQL_DERIVED: **${byEvidence("SQL_DERIVED")}** колонок, из них из SQL-определений датасетов: **${datasetSqlCols}**. Литералов извлечено: **${summary.sql_literal_values ?? "—"}** в **${summary.sql_literal_datasets ?? "—"}** датасетах; сохранённых запросов: **${summary.saved_queries ?? "—"}**.`);
  summaryLines.push("");
  summaryLines.push("## 7. Сколько колонок остались недоступными");
  summaryLines.push(`NOT_AVAILABLE: **${byEvidence("NOT_AVAILABLE")}**; METADATA_ONLY (PII): **${byEvidence("METADATA_ONLY")}**.`);
  summaryLines.push("");
  summaryLines.push("## 8. Сколько чартов и дашбордов исследовано");
  summaryLines.push(`Чартов: **${s.charts_total ?? "—"}**; дашбордов: **${s.dashboards_total ?? "—"}**.`);
  summaryLines.push("");
  summaryLines.push("## 9. Какие предметные области покрыты");
  summaryLines.push("***REMOVED***ы, готовность, пулы/ходки, курьеры/смены, очередь, дарксторы, финансы — по метаданным и определениям.");
  summaryLines.push("");
  summaryLines.push("## 10. Какие реальные значения обнаружены");
  summaryLines.push(`Фактических распределений нет. Извлечены значения из SQL-определений датасетов (например, статусы, типы доставки, регионы) и из фильтров дашбордов/чартов — см. \`analysis_package/column_values.csv\`; источник и класс достоверности указаны в каждой строке.`);
  summaryLines.push("");
  summaryLines.push("## 11. ***REMOVED***");
  summaryLines.push("<ФИО> поля 3466/5939/7021; метрики с одинаковыми названиями; технические заглушки.");
  summaryLines.push("");
  summaryLines.push("## 12. Подтверждённые и опровергнутые гипотезы");
  summaryLines.push("Опровергнуты: `time_ready`, `date_for_mentor`, 7021 как источник смен. Подтверждены структурно: `shifts`, `pools`, `courier_queue`.");
  summaryLines.push("");
  summaryLines.push("## 13. <ФИО>, невозможные без SQL Lab");
  summaryLines.push("Фактические значения, распределения, NULL-доли, кардинальности, покрытие связей, уникальность зерна.");
  summaryLines.push("");
  summaryLines.push("## 14. Влияние на Этапы 1.7–1.9");
  summaryLines.push("<ФИО> можно уточнять по метаданным; финальный DDL и миграции — только после фактических проверок.");
  summaryLines.push("");
  summaryLines.push("## 15. Вопросы аналитику и бизнесу");
  summaryLines.push("См. `analysis_package/ANALYST_BRIEF.md`.");
  write(join(REPORTS, "phase_01_6_2_summary.md"), summaryLines.join("\n"));

  console.log(JSON.stringify({ docs: DOCS, reports: REPORTS, sync_manifest: Boolean(syncManifest) }, null, 2));
}

main();
