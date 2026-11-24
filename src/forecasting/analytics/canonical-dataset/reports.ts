/**
 * Stage 3.2 — генерация всех артефактов этапа (markdown, CSV, JSON).
 *
 * Артефакты создаются только из фактических результатов: никаких «примерных» значений.
 * CSV формируется общим сериализатором проекта (RFC 4180, UTF-8, разделитель «,»).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toCsv } from "../profiling/report";
import { METRIC_REGISTRY, TARGET_METRIC_BUSINESS_NAME, TARGET_METRIC_KEY, validateRegistry } from "../semantics/metric-registry";
import type { SourceDecision } from "./types";
import type { SelectionResult } from "./selection";
import type {
  CanonicalDataset,
  CrossSliceRow,
  ReconciliationResult,
  SliceCandidateStats,
  ValidationReport,
} from "./types";

const fmt = (value: number | null | undefined, digits = 4): string =>
  value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits);

function mdTable(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) return "_нет данных_";
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

function bullets(items: readonly string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "_нет_";
}

// ---------------------------------------------------------------------------
// Stage 3.2.1 — реестр семантики
// ---------------------------------------------------------------------------
export function registryMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Stage 3.2.1 — Реестр бизнес-семантики метрик");
  lines.push("");
  lines.push(`Магазин 7745, датасет 3035. Целевая метрика этапа: \`${TARGET_METRIC_KEY}\` → \`${TARGET_METRIC_BUSINESS_NAME}\`.`);
  lines.push("");
  lines.push("Источник определений — каталог метаданных Superset (`reports/phase-01-6-2/dataset_metrics.csv`, поля `verbose_name`, `expression`, `aggregation`) ");
  lines.push("и прямая проверка значений в `daily_metrics`. **Каталог не является письменным бизнес-согласованием**, поэтому статус `confirmed` не присвоен ни одной метрике.");
  lines.push("");
  lines.push("## Сводная таблица");
  lines.push("");
  lines.push(mdTable(
    ["metric_key", "business_name", "kind", "unit", "confidence", "заблокирована", "пригодна как целевая", "срезы"],
    METRIC_REGISTRY.map((metric) => [
      metric.metric_key,
      metric.business_name,
      metric.metric_kind,
      metric.unit ?? "—",
      metric.confidence,
      metric.blocked ? "да" : "нет",
      metric.target_eligible ? "да" : "нет",
      metric.source_slices.join(", "),
    ]),
  ));
  lines.push("");

  for (const metric of METRIC_REGISTRY) {
    lines.push(`## ${metric.metric_key}`);
    lines.push("");
    lines.push(mdTable(["Поле", "Значение"], [
      ["business_name", metric.business_name],
      ["metric_kind", metric.metric_kind],
      ["unit", metric.unit ?? "—"],
      ["numerator", metric.numerator ?? "—"],
      ["denominator", metric.denominator ?? "—"],
      ["aggregation_rule (внутри дня)", metric.aggregation_rule.within_day],
      ["aggregation_rule (между днями)", metric.aggregation_rule.across_days],
      ["требует доказательства аддитивности", metric.aggregation_rule.requires_additivity_proof ? "да" : "нет"],
      ["source_slices", metric.source_slices.join(", ")],
      ["store_scope", metric.store_scope],
      ["temporal_grain", metric.temporal_grain],
      ["confidence", metric.confidence],
      ["заблокирована", metric.blocked ? `да — ${metric.blocked_reason}` : "нет"],
    ]));
    lines.push("");
    lines.push("**description.** " + metric.description);
    lines.push("");
    lines.push("**restrictions:**");
    lines.push("");
    lines.push(bullets(metric.restrictions));
    lines.push("");
    lines.push("**evidence:**");
    lines.push("");
    lines.push(bullets(metric.evidence));
    lines.push("");
  }

  lines.push("## Правила агрегации и обработки особых значений");
  lines.push("");
  lines.push(mdTable(["Ситуация", "Правило"], [
    ["агрегация по измерениям", "только при доказанной взаимоисключаемости и полноте категорий; иначе значение берётся из среза с одной строкой на дату"],
    ["агрегация по датам", "additive — сумма по дням как итог периода; ratio — только sum(числитель)/sum(знаменатель)"],
    ["несколько строк на дату", "не суммируются автоматически: это нарушение инварианта канонического набора"],
    ["NULL", "не заменяется нулём; строка не попадает в канонический ряд, фиксируется ошибка"],
    ["пустое значение", "обрабатывается как NULL (в текущем наборе таких строк нет)"],
    ["ноль", "сохраняется как значение источника (ноль — подтверждённое отсутствие заказов)"],
    ["отрицательное значение", "фиксируется как ошибка, набор не строится"],
    ["дробное значение", "сохраняется как есть, статус качества понижается до conditional, фиксируется finding"],
    ["дублирование источника", "обнаруживается по ключу (дата + измерения); набор не строится"],
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export interface RegistryValidation {
  ok: boolean;
  errors: string[];
  metrics: number;
  target_metric: { metric_key: string; present: boolean; blocked: boolean; confidence: string };
  blocked_metrics: string[];
  unconfirmed_metrics: string[];
  contradictions: string[];
}

export function registryValidation(): RegistryValidation {
  const validation = validateRegistry();
  const target = METRIC_REGISTRY.find((metric) => metric.metric_key === TARGET_METRIC_KEY) ?? null;
  return {
    ok: validation.ok && target !== null && !target.blocked,
    errors: validation.errors,
    metrics: METRIC_REGISTRY.length,
    target_metric: {
      metric_key: TARGET_METRIC_KEY,
      present: target !== null,
      blocked: target?.blocked ?? true,
      confidence: target?.confidence ?? "unconfirmed",
    },
    blocked_metrics: METRIC_REGISTRY.filter((metric) => metric.blocked).map((metric) => metric.metric_key),
    unconfirmed_metrics: METRIC_REGISTRY.filter((metric) => metric.confidence === "unconfirmed").map((metric) => metric.metric_key),
    contradictions: [
      "sum_without_bonuses: имя метрики не соответствует каталожному описанию «Сумма (ДС + баллы)» при выражении SUM(sum_paid)",
      "sum_with_bonuses: имя метрики не соответствует каталожному описанию «Сумма (только ДС)» при выражении SUM(sum_paid - sum_paid_disc)",
      "денежные метрики: единица измерения (рубли или копейки) не подтверждена",
      "ratio-метрики share_not_in_slot_above_all/under_all/share_delivered_taxi: числители в наборе отсутствуют",
      "share_orders_delivered: знаменатель — все заказы УЗ, в наборе отсутствует; значения постоянны (1.0)",
      "qty_orders_in_work: все значения равны нулю",
    ],
  };
}

export function semanticsFindingsMarkdown(validation: RegistryValidation): string {
  const lines: string[] = [];
  lines.push("# Stage 3.2.1 — findings по бизнес-семантике");
  lines.push("");
  lines.push(`Метрик в реестре: ${validation.metrics}; целостность реестра: ${validation.ok ? "ok" : "ОШИБКИ"}.`);
  lines.push("");
  lines.push("## Противоречия и неопределённости");
  lines.push("");
  lines.push(bullets(validation.contradictions));
  lines.push("");
  lines.push("## Заблокированные метрики");
  lines.push("");
  lines.push(bullets(validation.blocked_metrics) || "_нет_");
  lines.push("");
  lines.push("## Метрики без подтверждённого определения (unconfirmed)");
  lines.push("");
  lines.push(bullets(validation.unconfirmed_metrics));
  lines.push("");
  lines.push("## Что требуется от бизнеса");
  lines.push("");
  lines.push(bullets([
    "письменно подтвердить определение qty_orders_delivered (что именно считается доставленным заказом и какая дата используется)",
    "подтвердить единицы измерения денежных метрик и устранить противоречие имён sum_with_bonuses / sum_without_bonuses",
    "подтвердить числители и знаменатели ratio-метрик",
    "объяснить нулевые значения qty_orders_in_work и постоянное значение 1.0 у share_orders_delivered",
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Stage 3.2.2 — сравнение срезов и решение
// ---------------------------------------------------------------------------
export function sliceComparisonCsv(candidates: readonly SliceCandidateStats[]): string {
  return toCsv(
    [
      "slice_id", "rows", "daily_rows", "totals_rows", "dates", "rows_per_day_min", "rows_per_day_max", "rows_per_day_avg",
      "dimension_combinations", "dimension1_values", "dimension2_values", "empty_dim1", "empty_dim2", "masked_dim1", "masked_dim2",
      "nulls", "zeros", "negatives", "fractional", "min", "max", "daily_total", "duplicate_keys", "dataset_id", "run_id",
      "single_row_per_date", "calendar_complete",
    ],
    candidates.map((candidate) => [
      candidate.sliceId, candidate.rows, candidate.dailyRows, candidate.totalsRows, candidate.dates,
      candidate.rowsPerDayMin, candidate.rowsPerDayMax, Number(candidate.rowsPerDayAvg.toFixed(4)),
      candidate.dimensionCombinations, candidate.dimension1Values, candidate.dimension2Values,
      candidate.emptyDimension1, candidate.emptyDimension2, candidate.maskedDimension1, candidate.maskedDimension2,
      candidate.nullValues, candidate.zeroValues, candidate.negativeValues, candidate.fractionalValues,
      candidate.min, candidate.max, candidate.dailyTotal, candidate.duplicateKeys, candidate.datasetId, candidate.runId,
      candidate.singleRowPerDate, candidate.calendarComplete,
    ]),
  );
}

export function crossSliceCsv(rows: readonly CrossSliceRow[], slices: readonly number[]): string {
  return toCsv(
    ["date", ...slices.map((slice) => `slice_${slice}`), "all_equal", "max_deviation", "slices_compared"],
    rows.map((row) => [
      row.date,
      ...slices.map((slice) => row.totalsBySlice[String(slice)] ?? null),
      row.allEqual,
      row.maxDeviation,
      row.slicesCompared,
    ]),
  );
}

export function decisionMarkdown(
  decision: SourceDecision,
  selection: SelectionResult,
  expectedPeriod: { from: string; toInclusive: string; days: number },
): string {
  const lines: string[] = [];
  lines.push("# Stage 3.2.2 — Решение о каноническом источнике");
  lines.push("");
  lines.push(`**Выбранный slice_id:** ${decision.sliceId ?? "—"}`);
  lines.push(`**Статус решения:** ${decision.status}`);
  lines.push(`**Зафиксировано:** ${decision.decidedAt}`);
  lines.push(`**Основание:** ${decision.decidedBy}`);
  lines.push("");
  lines.push("## Причины выбора");
  lines.push("");
  lines.push(bullets(decision.reasons));
  lines.push("");
  lines.push("## Доказательства");
  lines.push("");
  lines.push(bullets(decision.evidence));
  lines.push("");
  lines.push("## Проверка решения по данным");
  lines.push("");
  lines.push(bullets(selection.evidence));
  lines.push("");
  lines.push("## Отклонённые кандидаты");
  lines.push("");
  lines.push(mdTable(["slice", "причина"], [...decision.rejected, ...selection.rejected].map((entry) => [entry.sliceId, entry.reason])));
  lines.push("");
  lines.push("## Альтернативные и контрольные источники");
  lines.push("");
  lines.push(mdTable(["slice", "роль", "примечание"], decision.alternatives.map((entry) => [entry.sliceId, entry.role, entry.note])));
  lines.push("");
  lines.push("## Способ получения дневного значения");
  lines.push("");
  lines.push(`Для выбранного среза ${decision.sliceId ?? "—"} на каждую дату приходится ровно одна строка, поэтому дневное значение берётся как есть, `);
  lines.push("без агрегации измерений. Строки без даты (итоги за период) в дневной ряд не включаются.");
  lines.push("");
  lines.push("## Ожидаемый период и способ проверки");
  lines.push("");
  lines.push(`Период: ${expectedPeriod.from} … ${expectedPeriod.toInclusive} включительно, ${expectedPeriod.days} календарных дней. `);
  lines.push("Верхняя граница исходных запросов трактуется как исключающая (как в манифестах выгрузок).");
  lines.push("");
  lines.push("## Риски и ограничения");
  lines.push("");
  lines.push(bullets([
    "письменного бизнес-согласования определения qty_orders_delivered нет; подтверждение — каталог метаданных и данные",
    "срез 20624 даёт одну строку на дату, но не позволяет разложить показатель по сервисам — при необходимости используются контрольные срезы",
    "control-срезы (20403, 20405, 20623) требуют агрегации категорий; их значения применяются только для сверки",
    "срез 20404 не используется из-за плейсхолдера маскирования в dimension_1",
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Stage 3.2.3 — канонический набор
// ---------------------------------------------------------------------------
export function canonicalCsv(dataset: CanonicalDataset): string {
  return toCsv(
    ["date", "shop_no", "metric", "value", "source_slice_id", "source_dataset_id", "source_run_id", "quality_status"],
    dataset.observations.map((observation) => [
      observation.date, observation.shopNo, observation.metric, observation.value,
      observation.sourceSliceId, observation.sourceDatasetId, observation.sourceRunId, observation.qualityStatus,
    ]),
  );
}

export function datasetSummaryJson(
  dataset: CanonicalDataset,
  validation: ValidationReport,
  reconciliation: ReconciliationResult,
  selection: SelectionResult,
): string {
  return `${JSON.stringify({
    shop_no: dataset.shopNo,
    metric: dataset.metric,
    business_name: dataset.businessName,
    source_slice_id: dataset.sourceSliceId,
    period: dataset.period,
    rows: dataset.observations.length,
    total_delivered: dataset.totalDelivered,
    excluded_totals_rows: dataset.excludedTotalsRows,
    quality_status: dataset.observations[0]?.qualityStatus ?? "blocked",
    provenance: dataset.provenance,
    validation: { ok: validation.ok, checks: validation.checks, issues: validation.issues },
    reconciliation: { status: reconciliation.status, counts: reconciliation.counts, totals: reconciliation.totals },
    selection: { status: selection.status, slice_id: selection.sliceId },
  }, null, 2)}\n`;
}

export function datasetReportMarkdown(dataset: CanonicalDataset, validation: ValidationReport): string {
  const lines: string[] = [];
  lines.push("# Stage 3.2.3 — Канонический дневной набор доставленных заказов");
  lines.push("");
  lines.push(`**Магазин:** ${dataset.shopNo} · **Метрика:** ${dataset.metric} (${dataset.businessName}) · **Источник:** срез ${dataset.sourceSliceId}`);
  lines.push(`**Период:** ${dataset.period.from} … ${dataset.period.to} (${dataset.period.days} дней) · **Сумма:** ${dataset.totalDelivered}`);
  lines.push(`**Проверки набора:** ${validation.ok ? "пройдены" : "ЕСТЬ ОШИБКИ"} · **Итогов без даты исключено:** ${dataset.excludedTotalsRows}`);
  lines.push("");
  lines.push("## Формат записи");
  lines.push("");
  lines.push(mdTable(["Поле", "Значение"], [
    ["date", "календарный день Europe/Moscow"],
    ["shop_no", dataset.shopNo],
    ["metric", dataset.metric],
    ["value", "количество доставленных заказов (значение источника, без округления)"],
    ["source_slice_id", dataset.sourceSliceId],
    ["source_dataset_id", dataset.provenance.sourceDatasetId ?? "—"],
    ["source_run_id", dataset.provenance.extractionRunIds.join(", ") || "—"],
    ["quality_status", dataset.observations[0]?.qualityStatus ?? "—"],
  ]));
  lines.push("");
  lines.push("## Проверки инвариантов");
  lines.push("");
  lines.push(mdTable(["проверка", "результат", "детали"], validation.checks.map((check) => [check.code, check.passed ? "PASS" : "FAIL", check.detail])));
  lines.push("");
  if (validation.issues.length) {
    lines.push("## Замечания");
    lines.push("");
    lines.push(mdTable(["уровень", "код", "сообщение"], validation.issues.map((issue) => [issue.severity, issue.code, issue.message])));
    lines.push("");
  }
  lines.push("## Провенанс");
  lines.push("");
  lines.push(mdTable(["Поле", "Значение"], [
    ["source_file", dataset.provenance.sourceFile],
    ["extraction_run_ids", dataset.provenance.extractionRunIds.join(", ") || "—"],
    ["transform_versions", dataset.provenance.transformVersions.join(", ")],
    ["evidence_statuses", dataset.provenance.evidenceStatuses.join(", ")],
    ["data_statuses", dataset.provenance.dataStatuses.join(", ")],
    ["checksum", dataset.provenance.checksum ?? "—"],
    ["generated_at", dataset.provenance.generatedAt],
  ]));
  lines.push("");
  lines.push("## Дневной ряд");
  lines.push("");
  lines.push(mdTable(["date", "delivered_orders"], dataset.observations.map((observation) => [observation.date, observation.value])));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Stage 3.2.4 — сверка
// ---------------------------------------------------------------------------
export function dailyReconciliationCsv(result: ReconciliationResult): string {
  const slices = [...new Set(result.rows.flatMap((row) => Object.keys(row.crossSliceTotals)))].sort();
  return toCsv(
    ["date", "source_daily_total", "source_rows", "canonical_value", "deviation", "equal", ...slices.map((slice) => `cross_${slice}`), "cross_slice_equal"],
    result.rows.map((row) => [
      row.date, row.sourceDailyTotal, row.sourceRows, row.canonicalValue, row.deviation, row.equal,
      ...slices.map((slice) => row.crossSliceTotals[slice] ?? null), row.crossSliceEqual,
    ]),
  );
}

export function reconciliationMarkdown(result: ReconciliationResult, dataset: CanonicalDataset): string {
  const lines: string[] = [];
  lines.push("# Stage 3.2.4 — Сверка канонического набора с исходными данными");
  lines.push("");
  lines.push(`**Статус:** ${result.status}`);
  lines.push(`**Источник:** срез ${dataset.sourceSliceId} · **Период:** ${dataset.period.from} … ${dataset.period.to} · **Сумма:** ${result.totals.canonicalTotal}`);
  lines.push("");
  lines.push("## Количества");
  lines.push("");
  lines.push(mdTable(["Показатель", "Значение"], [
    ["строк метрики по всем срезам", result.counts.sourceRowsForMetric],
    ["дневных строк выбранного среза", result.counts.sourceDailyRows],
    ["итоговых строк без даты", result.counts.sourceTotalsRows],
    ["записей канонического ряда", result.counts.canonicalRows],
    ["дат", result.counts.dates],
    ["исключено totals", result.counts.excludedTotals],
    ["отклонено строк", result.counts.rejectedRows],
    ["конфликтов значений", result.counts.conflicts],
  ]));
  lines.push("");
  lines.push("## Проверки");
  lines.push("");
  lines.push(mdTable(["проверка", "результат", "детали"], result.checks.map((check) => [check.code, check.passed ? "PASS" : "FAIL", check.detail])));
  lines.push("");
  lines.push("## Суммы и период");
  lines.push("");
  lines.push(mdTable(["Показатель", "Значение"], [
    ["сумма источника", result.totals.sourceTotal],
    ["сумма канонического ряда", result.totals.canonicalTotal],
    ["суммы совпадают", result.totals.equal ? "да" : "нет"],
    ["контрольная сумма Stage 3.1", result.totals.expectedTotal ?? "не задана"],
    ["совпадает с контрольной", result.totals.matchesExpected === null ? "не проверялось" : result.totals.matchesExpected ? "да" : "нет"],
    ["расхождений между срезами", result.crossSliceMismatches],
    ["детерминированность", result.determinism.identical ? `да (${result.determinism.runs} прогона)` : "нет"],
    ["checksum набора", result.determinism.checksum],
  ]));
  lines.push("");
  if (result.issues.length) {
    lines.push("## Замечания и расхождения");
    lines.push("");
    lines.push(mdTable(["уровень", "код", "сообщение"], result.issues.map((issue) => [issue.severity, issue.code, issue.message])));
    lines.push("");
  }
  lines.push("## Сверка по датам (первые 45 строк)");
  lines.push("");
  lines.push(mdTable(
    ["date", "источник", "строк", "канон", "отклонение", "срезы совпадают"],
    result.rows.slice(0, 45).map((row) => [row.date, fmt(row.sourceDailyTotal), row.sourceRows, fmt(row.canonicalValue), fmt(row.deviation), row.crossSliceEqual ? "да" : "НЕТ"]),
  ));
  lines.push("");
  lines.push("Полный список — в `daily-reconciliation.csv`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function reconciliationSummaryJson(result: ReconciliationResult): string {
  return `${JSON.stringify({
    status: result.status,
    counts: result.counts,
    period: result.period,
    totals: result.totals,
    cross_slice_mismatches: result.crossSliceMismatches,
    determinism: result.determinism,
    checks: result.checks,
    issues: result.issues,
  }, null, 2)}\n`;
}

export interface IntegritySnapshot {
  sha256: string | null;
  size: number;
  lastWriteTime: string;
  counts: { daily_metrics: number; domain_events: number; extraction_runs: number; raw_extractions: number };
  integrity: string;
  foreignKeyViolations: number;
  queryOnly: number;
  writeBlocked: boolean;
}

export function sourceIntegrityJson(before: IntegritySnapshot, after: IntegritySnapshot): string {
  return `${JSON.stringify({
    unchanged: before.sha256 !== null && before.sha256 === after.sha256,
    before,
    after,
    notes: [
      "доступ только для чтения: readonly: true и PRAGMA query_only = 1",
      "пробная запись отклоняется драйвером (write_blocked = true)",
      "WAL-файлы не изменялись вручную",
    ],
  }, null, 2)}\n`;
}

export function finalReportMarkdown(input: {
  dataset: CanonicalDataset;
  decision: SourceDecision;
  selection: SelectionResult;
  validation: ValidationReport;
  reconciliation: ReconciliationResult;
  integrityBefore: IntegritySnapshot;
  integrityAfter: IntegritySnapshot;
  testsSummary: string;
  limitations: string[];
  openQuestions: string[];
}): string {
  const { dataset, decision, validation, reconciliation, integrityBefore, integrityAfter } = input;
  const lines: string[] = [];
  lines.push("# Stage 3.2 — Итоговый отчёт: семантика, канонический источник и дневной набор");
  lines.push("");
  lines.push(`**Статус этапа:** ${reconciliation.status === "PASS" ? "ACCEPTED" : reconciliation.status === "CONDITIONAL" ? "CONDITIONAL" : "BLOCKED"}`);
  lines.push("");
  lines.push("## 1. Что реализовано");
  lines.push("");
  lines.push(bullets([
    "Stage 3.2.1 — реестр бизнес-семантики 11 метрик в коде (`src/forecasting/analytics/semantics/metric-registry.ts`) и в отчёте",
    "Stage 3.2.2 — доказательный выбор канонического среза (`selection.ts`, `decision.ts`) со сравнением всех пяти срезов",
    "Stage 3.2.3 — построение канонического дневного набора (`builder.ts`, `validation.ts`)",
    "Stage 3.2.4 — сверка набора с источником и контрольными срезами (`reconciliation.ts`)",
    "CLI `forecast:canonical`, артефакты в `reports/forecasting/stage-3.2/` и CSV набора в `data/processed/forecasting/7745/`",
  ]));
  lines.push("");
  lines.push("## 2. Выбранный срез");
  lines.push("");
  lines.push(`**slice_id = ${decision.sliceId}**, статус решения — ${decision.status}. Обоснование: в срезе ровно одна строка на дату, измерение — сама ТТ магазина, поэтому агрегация измерений не требуется. `);
  lines.push("Остальные срезы (20403, 20405, 20623) используются только как контрольные, срез 20404 отклонён из-за плейсхолдера маскирования.");
  lines.push("");
  lines.push("## 3. Как строится дневной ряд");
  lines.push("");
  lines.push(bullets([
    "источник: только выбранный срез, магазин 7745, метрика qty_orders_delivered",
    "одна дата — ровно одна строка; при нескольких строках набор не строится (суммирование измерений не подтверждено)",
    "строки без даты (итоги за период) исключены и посчитаны отдельно",
    "NULL не заменяется нулём, отрицательные значения — ошибка, дробные сохраняются и понижают статус качества",
    `верхняя граница периода исключающая: ${dataset.period.from} … ${dataset.period.to}`,
  ]));
  lines.push("");
  lines.push("## 4. Число дат и строк");
  lines.push("");
  lines.push(mdTable(["Показатель", "Значение"], [
    ["дат", dataset.period.days],
    ["записей", dataset.observations.length],
    ["исключено итогов без даты", dataset.excludedTotalsRows],
    ["период", `${dataset.period.from} … ${dataset.period.to}`],
  ]));
  lines.push("");
  lines.push("## 5. Общая сумма");
  lines.push("");
  lines.push(`Сумма канонического ряда: **${dataset.totalDelivered}**; сумма исходного среза: **${reconciliation.totals.sourceTotal}**; контрольная сумма Stage 3.1: ${reconciliation.totals.expectedTotal ?? "не задана"}.`);
  lines.push("");
  lines.push("## 6. Результат сверки");
  lines.push("");
  lines.push(mdTable(["проверка", "результат", "детали"], reconciliation.checks.map((check) => [check.code, check.passed ? "PASS" : "FAIL", check.detail])));
  lines.push("");
  lines.push("## 7. Отсутствие задвоения");
  lines.push("");
  lines.push(bullets([
    `в наборе использован один срез (${dataset.sourceSliceId}); строки других срезов в ряд не добавлялись`,
    `расхождений дневных сумм между срезами: ${reconciliation.crossSliceMismatches}`,
    `дублей дат: ${reconciliation.counts.dates === reconciliation.counts.canonicalRows ? "нет" : "есть"}`,
    "суммирование одинаковой метрики между срезами не выполнялось",
  ]));
  lines.push("");
  lines.push("## 8. Проверка неизменности SQLite");
  lines.push("");
  lines.push(mdTable(["Показатель", "До", "После"], [
    ["SHA-256", integrityBefore.sha256 ?? "—", integrityAfter.sha256 ?? "—"],
    ["размер", integrityBefore.size, integrityAfter.size],
    ["LastWriteTime", integrityBefore.lastWriteTime, integrityAfter.lastWriteTime],
    ["daily_metrics", integrityBefore.counts.daily_metrics, integrityAfter.counts.daily_metrics],
    ["domain_events", integrityBefore.counts.domain_events, integrityAfter.counts.domain_events],
    ["extraction_runs", integrityBefore.counts.extraction_runs, integrityAfter.counts.extraction_runs],
    ["raw_extractions", integrityBefore.counts.raw_extractions, integrityAfter.counts.raw_extractions],
    ["integrity_check", integrityBefore.integrity, integrityAfter.integrity],
    ["нарушений внешних ключей", integrityBefore.foreignKeyViolations, integrityAfter.foreignKeyViolations],
  ]));
  lines.push("");
  lines.push(`Идентичность файла БД: **${integrityBefore.sha256 === integrityAfter.sha256 ? "подтверждена" : "НЕ подтверждена"}** (query_only = ${integrityAfter.queryOnly}, пробная запись отклонена = ${after_write(integrityAfter)}).`);
  lines.push("");
  lines.push("## 9. Результаты тестов");
  lines.push("");
  lines.push(input.testsSummary);
  lines.push("");
  lines.push("## 10. Известные ограничения");
  lines.push("");
  lines.push(bullets(input.limitations));
  lines.push("");
  lines.push("## 11. Открытые бизнес-вопросы");
  lines.push("");
  lines.push(bullets(input.openQuestions));
  lines.push("");
  lines.push("## 12. Итоговый статус");
  lines.push("");
  lines.push(`**${reconciliation.status === "PASS" ? "ACCEPTED" : reconciliation.status === "CONDITIONAL" ? "CONDITIONAL" : "BLOCKED"}** — ${validation.ok ? "инварианты набора соблюдены" : "инварианты нарушены"}; сверка ${reconciliation.status}.`);
  lines.push("");
  lines.push("## 13. Что необходимо сделать перед Stage 3.3");
  lines.push("");
  lines.push(bullets([
    "получить письменное подтверждение определения qty_orders_delivered и единиц измерения денежных метрик",
    "зафиксировать регламент обновления канонического набора при каждом новом сборе данных",
    "расширить историю до 12+ недель перед оценкой недельного профиля и backtesting",
    "определить порядок работы с выбросами (без автокоррекции)",
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function after_write(snapshot: IntegritySnapshot): string {
  return snapshot.writeBlocked ? "да" : "НЕТ";
}

export interface Stage32Artifacts {
  /** Записывает все артефакты этапа; при BLOCKED канонический CSV не создаётся. */
  outDir: string;
  canonicalCsvPath: string;
}

export async function writeStage32Artifacts(input: {
  outDir: string;
  canonicalCsvPath: string;
  status: ReconciliationResult["status"];
  dataset: CanonicalDataset | null;
  decision: SourceDecision;
  selection: SelectionResult;
  validation: ValidationReport | null;
  reconciliation: ReconciliationResult | null;
  candidates: readonly SliceCandidateStats[];
  crossSlice: readonly CrossSliceRow[];
  slices: readonly number[];
  expectedPeriod: { from: string; toInclusive: string; days: number };
  integrityBefore: IntegritySnapshot;
  integrityAfter: IntegritySnapshot;
  testsSummary: string;
  generatedAt: string;
}): Promise<{ written: string[] }> {
  await mkdir(input.outDir, { recursive: true });
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(input.outDir, name), content);
    written.push(name);
  };

  const registry = registryValidation();
  await write("business-semantics-registry.md", registryMarkdown());
  await write("business-semantics-validation.json", `${JSON.stringify({ generated_at: input.generatedAt, ...registry }, null, 2)}\n`);
  await write("business-semantics-findings.md", semanticsFindingsMarkdown(registry));
  await write("slice-comparison.csv", sliceComparisonCsv(input.candidates));
  await write("cross-slice-reconciliation.csv", crossSliceCsv(input.crossSlice, input.slices));
  await write("canonical-source-decision.md", decisionMarkdown(input.decision, input.selection, input.expectedPeriod));

  if (input.dataset && input.validation && input.reconciliation) {
    await write("canonical-dataset-summary.json", datasetSummaryJson(input.dataset, input.validation, input.reconciliation, input.selection));
    await write("canonical-dataset-report.md", datasetReportMarkdown(input.dataset, input.validation));
    await write("reconciliation-report.md", reconciliationMarkdown(input.reconciliation, input.dataset));
    await write("daily-reconciliation.csv", dailyReconciliationCsv(input.reconciliation));
    await write("reconciliation-summary.json", reconciliationSummaryJson(input.reconciliation));

    if (input.status !== "BLOCKED") {
      await mkdir(join(input.canonicalCsvPath, ".."), { recursive: true });
      await Bun.write(input.canonicalCsvPath, canonicalCsv(input.dataset));
      written.push(input.canonicalCsvPath);
    }

    await write("stage-3.2-final-report.md", finalReportMarkdown({
      dataset: input.dataset,
      decision: input.decision,
      selection: input.selection,
      validation: input.validation,
      reconciliation: input.reconciliation,
      integrityBefore: input.integrityBefore,
      integrityAfter: input.integrityAfter,
      testsSummary: input.testsSummary,
      limitations: [
        "41 день истории: недостаточно для подтверждения сезонности и для 14-дневного горизонта при обучении на 28 днях",
        "письменного бизнес-согласования определения целевой метрики нет (подтверждение — каталог метаданных и данные)",
        "причины отмен и корректировок заказов в наборе отсутствуют",
        "набор описывает только магазин 7745 и не переносится на другие даркстоны автоматически",
        "плановые мероприятия (43, статус planned) не используются как исторические факторы",
        "chart 20209 не подключён",
      ],
      openQuestions: [
        "подтвердить определение доставленного заказа и дату отнесения",
        "уточнить, требуются ли разрезы по сервисам в будущих этапах (тогда понадобится доказательство аддитивности категорий)",
        "определить регламент обновления канонического набора",
      ],
    }));
  }

  await write("source-integrity.json", sourceIntegrityJson(input.integrityBefore, input.integrityAfter));
  return { written };
}
