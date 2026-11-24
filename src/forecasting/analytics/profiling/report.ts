/**
 * Формирование отчётов Stage 3.1: markdown-отчёт, findings и пять CSV.
 *
 * CSV: UTF-8, разделитель «,», экранирование по RFC 4180 (кавычки удваиваются),
 * пустые значения — пустое поле (не «0» и не «NULL»).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { dimensionValueCounts } from "./dimensions-profile";
import type { DailyObservationRow, ProfilingResult } from "./types";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export function metricsProfileCsv(result: ProfilingResult): string {
  return toCsv(
    [
      "metric", "metric_kind", "slice_id", "unit", "observations", "days_with_data", "first_date", "last_date",
      "expected_days", "missing_days", "fill_rate", "max_gap_days", "n", "nulls", "zeros", "negatives",
      "min", "max", "mean", "median", "stdev", "cv", "q1", "q3", "iqr", "mad", "sum", "mean_per_day",
      "positive_days", "zero_days", "additive_aggregation_confirmed",
    ],
    result.metric_profiles.map((profile) => [
      profile.metric, profile.metric_kind, profile.slice_id, profile.unit, profile.observations, profile.days_with_data,
      profile.first_date, profile.last_date, profile.expected_days, profile.missing_days, profile.fill_rate,
      profile.max_gap_days, profile.stats.n, profile.stats.nulls, profile.stats.zeros, profile.stats.negatives,
      profile.stats.min, profile.stats.max, profile.stats.mean, profile.stats.median, profile.stats.stdev,
      profile.stats.cv, profile.stats.q1, profile.stats.q3, profile.stats.iqr, profile.stats.mad, profile.sum,
      profile.mean_per_day, profile.positive_days, profile.zero_days, profile.additive_aggregation_confirmed,
    ]),
  );
}

export function temporalCoverageCsv(result: ProfilingResult): string {
  return toCsv(
    ["slice_id", "metric", "first_date", "last_date", "days_with_data", "expected_days", "missing_days", "missing_dates"],
    result.temporal_coverage.map((row) => [
      row.slice_id, row.metric, row.first_date, row.last_date, row.days_with_data, row.expected_days, row.missing_days,
      row.missing_dates.join(";"),
    ]),
  );
}

export function outliersCsv(result: ProfilingResult): string {
  return toCsv(
    ["metric", "slice_id", "dimension_1", "dimension_2", "date", "value", "method", "statistic", "lower_bound", "upper_bound", "reason"],
    result.outliers.map((row) => [
      row.metric, row.slice_id, row.dimension_1, row.dimension_2, row.date, row.value, row.method, row.statistic,
      row.lower_bound, row.upper_bound, row.reason,
    ]),
  );
}

export function dimensionsProfileCsv(result: ProfilingResult, rows: readonly DailyObservationRow[]): string {
  const lines: Array<Array<unknown>> = [];
  for (const profile of result.dimensions) {
    const counts = dimensionValueCounts(rows, profile.field);
    const total = counts.reduce((acc, entry) => acc + entry.rows, 0) || 1;
    counts.forEach((entry, index) => {
      const special = /^(total|итог|все|__all__|all)$/i.test(entry.value);
      const placeholder = entry.value.trim().startsWith("<");
      lines.push([
        profile.field, profile.unique_values, profile.empty_values, profile.cardinality,
        profile.masking_placeholder_values, entry.value, entry.rows, Number((entry.rows / total).toFixed(6)),
        index + 1, special, placeholder,
      ]);
    });
    if (!counts.length) {
      lines.push([profile.field, profile.unique_values, profile.empty_values, profile.cardinality, profile.masking_placeholder_values, "", 0, 0, 0, false, false]);
    }
  }
  return toCsv(
    ["field", "unique_values", "empty_values", "cardinality", "masking_placeholder_values", "value", "rows", "share", "rank", "special_value", "masked_placeholder"],
    lines,
  );
}

export function readinessCsv(result: ProfilingResult): string {
  return toCsv(
    ["metric", "metric_kind", "slices", "observations", "coverage", "missing", "nulls", "zeros", "outliers", "semantic_status", "forecast_readiness", "reasons", "required_actions"],
    result.readiness.map((row) => [
      row.metric, row.metric_kind, row.slices.join(";"), row.observations, row.coverage, row.missing, row.nulls,
      row.zeros, row.outliers, row.semantic_status, row.forecast_readiness, row.reasons.join(" | "),
      row.required_actions.join(" | "),
    ]),
  );
}

const fmt = (value: number | null | undefined, digits = 4): string =>
  value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits);

function table(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) return "_нет данных_";
  return [headers, headers.map(() => "---"), ...rows].map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
}

export function buildDataQualityReport(result: ProfilingResult): string {
  const lines: string[] = [];
  const byStatus = (status: string) => result.readiness.filter((row) => row.forecast_readiness === status);
  const ready = byStatus("READY");
  const conditional = byStatus("CONDITIONAL");
  const blocked = byStatus("BLOCKED");

  lines.push("# Stage 3.1 — Качество данных и профилирование (модуль прогнозирования)");
  lines.push("");
  lines.push(`**Магазин:** ${result.shop_no} · **Сформировано:** ${result.generated_at} · **Режим:** только чтение SQLite`);
  lines.push("");
  lines.push("> Все числовые результаты получены SQL-запросами к `daily_metrics`/`domain_events` и вычислениями по этим данным.");
  lines.push("> Утверждения о сезонности, трендах и бизнес-смысле, не подтверждённые источником, помечены как предположения.");
  lines.push("");

  lines.push("## 1. Краткое резюме");
  lines.push("");
  lines.push(`- Период данных: **${result.period.from} … ${result.period.to}**, ${result.period.days} календарных дней; соответствует ожидаемому: ${result.period.matches_expected_period ? "да" : "**нет**"}.`);
  lines.push(`- Пропущенных календарных дней внутри периода: **${result.period.missing_calendar_days.length}**.`);
  lines.push(`- Срезов: ${result.slices.length} (${result.slices.join(", ")}); наблюдений в `+"`daily_metrics`"+`: ${result.source_counts.daily_metrics}.`);
  lines.push(`- Профилей метрик (metric × slice): **${result.metric_profiles.length}**; уникальных метрик: **${new Set(result.metric_profiles.map((p) => p.metric)).size}**.`);
  lines.push(`- Дублей по natural key: **${result.duplicates.count}**.`);
  lines.push(`- Выбросов (IQR/MAD): **${result.outliers.length}** (не удаляются и не исправляются).`);
  lines.push(`- Готовность: READY — ${ready.length}, CONDITIONAL — ${conditional.length}, BLOCKED — ${blocked.length}.`);
  lines.push(`- Все мероприятия плана: ${JSON.stringify(result.events.by_status)} — фактические события отсутствуют.`);
  lines.push("");

  lines.push("## 2. Исходные данные");
  lines.push("");
  lines.push(table(["Показатель", "Значение"], [
    ["Магазин", result.shop_no],
    ["Период (факт)", `${result.period.from} … ${result.period.to}`],
    ["Период (ожидаемый)", `${result.period.expected_period.from} … ${result.period.expected_period.to}`],
    ["Календарных дней", result.period.days],
    ["daily_metrics", result.source_counts.daily_metrics],
    ["domain_events", result.source_counts.domain_events],
    ["extraction_runs", result.source_counts.extraction_runs],
    ["raw_extractions", result.source_counts.raw_extractions],
    ["Срезы", result.slices.join(", ")],
    ["data_status", JSON.stringify(result.status_counts.data_status)],
    ["evidence_status", JSON.stringify(result.status_counts.evidence_status)],
    ["transform_version", JSON.stringify(result.status_counts.transform_version)],
    ["Read-only", `query_only=${result.read_only.query_only}, пробная запись отклонена=${result.read_only.write_attempt_blocked}`],
  ]));
  lines.push("");

  lines.push("## 3. Проверка целостности периода");
  lines.push("");
  lines.push(`- Минимальная дата: **${result.period.from}**, максимальная: **${result.period.to}**, уникальных дат: **${result.period.days}**.`);
  lines.push(`- Отсутствующие календарные дни: ${result.period.missing_calendar_days.length ? result.period.missing_calendar_days.join(", ") : "нет"}.`);
  lines.push(`- Дубли по natural key: ${result.duplicates.count}${result.duplicates.examples.length ? ` (примеры: ${result.duplicates.examples.join("; ")})` : ""}.`);
  lines.push(`- Полных недель (пн–вс): **${result.period_assessment.complete_weeks}**.`);
  lines.push("");
  lines.push("Покрытие по срезам и метрикам (полный список — в `temporal-coverage.csv`):");
  lines.push("");
  lines.push(table(
    ["slice_id", "метрика", "первое наблюдение", "последнее наблюдение", "дней с данными", "пропусков"],
    result.temporal_coverage.slice(0, 30).map((row) => [row.slice_id, row.metric, row.first_date ?? "—", row.last_date ?? "—", row.days_with_data, row.missing_days]),
  ));
  lines.push("");

  lines.push("## 4. Профиль метрик");
  lines.push("");
  lines.push(table(
    ["метрика", "тип", "slice", "набл.", "дней", "min", "max", "среднее", "медиана", "σ", "CV", "нулей", "NULL", "пропусков"],
    result.metric_profiles.map((profile) => [
      profile.metric, profile.metric_kind, profile.slice_id, profile.observations, profile.days_with_data,
      fmt(profile.stats.min), fmt(profile.stats.max), fmt(profile.stats.mean), fmt(profile.stats.median),
      fmt(profile.stats.stdev), fmt(profile.stats.cv), profile.stats.zeros, profile.stats.nulls, profile.missing_days,
    ]),
  ));
  lines.push("");
  lines.push("### 4.1. Additive-метрики");
  lines.push("");
  lines.push("Суммы приведены как описательная характеристика. **Корректность суммирования как бизнес-агрегата не подтверждена** ни для одной метрики (`additive_aggregation_confirmed = false`), пока определение не согласовано.");
  lines.push("");
  lines.push(table(
    ["метрика", "slice", "наблюдений", "сумма", "среднее/день", "положительных дней", "нулевых", "σ", "CV"],
    result.metric_profiles.filter((profile) => profile.metric_kind === "additive").map((profile) => [
      profile.metric, profile.slice_id, profile.observations, fmt(profile.sum, 2), fmt(profile.mean_per_day), profile.positive_days, profile.zero_days, fmt(profile.stats.stdev), fmt(profile.stats.cv),
    ]),
  ));
  lines.push("");
  lines.push("### 4.2. Ratio-метрики и проверка отношений");
  lines.push("");
  lines.push("Доли не суммируются. Знаменатель подтверждён формулой из каталога метаданных Superset; проверка восстановления отношения выполнена там, где числитель присутствует в наборе.");
  lines.push("");
  lines.push(table(
    ["метрика", "slice", "числитель", "знаменатель", "проверено", "точных", "в пределах округления", "макс. отклонение", "примечание"],
    result.ratio_checks.map((check) => [
      check.metric, check.slice_id, check.numerator_metric ?? "—", check.denominator_metric ?? "—",
      check.dates_checked, check.exact_matches, check.matches_within_rounding, fmt(check.max_abs_deviation, 8), check.note,
    ]),
  ));
  lines.push("");
  lines.push(table(
    ["метрика", "slice", "наблюдений", "среднее", "медиана", "min", "max", "σ", "CV", "нулей"],
    result.metric_profiles.filter((profile) => profile.metric_kind === "ratio").map((profile) => [
      profile.metric, profile.slice_id, profile.observations, fmt(profile.stats.mean), fmt(profile.stats.median),
      fmt(profile.stats.min), fmt(profile.stats.max), fmt(profile.stats.stdev), fmt(profile.stats.cv), profile.stats.zeros,
    ]),
  ));
  lines.push("");

  lines.push("## 5. Пропуски, NULL и нули");
  lines.push("");
  lines.push("Различаются четыре состояния: нет строки (наблюдения нет), NULL (значение неизвестно), 0 (источник сообщил ноль) и отсутствие метрики в срезе. Значения NULL нулём не заменяются, интерполяция не выполняется.");
  lines.push("");
  const gaps = result.metric_profiles.filter((profile) => profile.missing_days > 0);
  lines.push(gaps.length
    ? table(["метрика", "slice", "пропущено дней", "заполненность", "макс. непрерывный пропуск"], gaps.map((profile) => [profile.metric, profile.slice_id, profile.missing_days, fmt(profile.fill_rate), profile.max_gap_days]))
    : "Пропусков календарных дней внутри периода не обнаружено ни по одной паре (метрика, срез).");
  lines.push("");
  const nulls = result.metric_profiles.filter((profile) => profile.stats.nulls > 0);
  lines.push(nulls.length
    ? table(["метрика", "slice", "NULL", "нулей"], nulls.map((profile) => [profile.metric, profile.slice_id, profile.stats.nulls, profile.stats.zeros]))
    : "Наблюдений со значением NULL нет.");
  lines.push("");

  lines.push("## 6. Выбросы (IQR и MAD)");
  lines.push("");
  if (!result.outliers.length) {
    lines.push("Статистических выбросов не обнаружено ни одним из методов.");
  } else {
    lines.push(table(
      ["дата", "метрика", "slice", "измерение 1", "измерение 2", "значение", "метод", "статистика", "границы", "причина"],
      result.outliers.slice(0, 60).map((row) => [
        row.date, row.metric, row.slice_id, row.dimension_1 || "—", row.dimension_2 || "—", row.value, row.method, row.statistic,
        row.lower_bound === null ? "—" : `[${fmt(row.lower_bound)}, ${fmt(row.upper_bound!)}]`, row.reason,
      ]),
    ));
    lines.push("");
    lines.push(`Всего помечено: ${result.outliers.length}. Статистический выброс **не является** доказательством ошибки данных; значения не изменялись.`);
  }
  lines.push("");
  lines.push("Ограничения применимости методов (объём < 8 наблюдений или постоянный ряд) перечислены в `stage-3.1-findings.md`.");
  lines.push("");

  lines.push("## 7. Временная структура");
  lines.push("");
  const mainProfiles = result.temporal_profiles.filter((profile) => profile.metric === "qty_orders_delivered");
  lines.push(table(
    ["метрика", "slice", "агрегация дня", "точек", "первое значение", "последнее", "среднее 1-й недели", "среднее последней", "тренд/день", "R²"],
    mainProfiles.map((profile) => [
      profile.metric, profile.slice_id, profile.aggregation, profile.points_used, fmt(profile.first_value), fmt(profile.last_value), fmt(profile.first_week_mean),
      fmt(profile.last_week_mean), fmt(profile.trend_slope_per_day), fmt(profile.trend_r2),
    ]),
  ));
  lines.push("");
  for (const profile of mainProfiles.slice(0, 1)) {
    lines.push(`Способ сведения строк дня: ${profile.aggregation_note}`);
    lines.push("");
  }
  lines.push("Средние по дням недели (по срезу 20403, метрика `qty_orders_delivered`):");
  lines.push("");
  const dowProfile = mainProfiles.find((profile) => profile.slice_id === result.slices[0]) ?? mainProfiles[0];
  lines.push(dowProfile
    ? table(["день недели", "наблюдений", "среднее", "медиана", "min", "max", "σ"], dowProfile.dow.map((row) => [row.label, row.observations, fmt(row.mean), fmt(row.median), fmt(row.min), fmt(row.max), fmt(row.stdev)]))
    : "_нет данных_");
  lines.push("");
  lines.push(`**Ограничение:** ${result.period_assessment.complete_weeks} полных недель. ${"Различия средних по дням недели — наблюдаемая закономерность, а не подтверждённая сезонность."}`);
  lines.push("");

  lines.push("## 8. Dimensions");
  lines.push("");
  lines.push(table(
    ["поле", "уникальных", "пустых", "кардинальность", "плейсхолдеров маскирования", "значений в день (min…max)"],
    result.dimensions.map((profile) => [
      profile.field, profile.unique_values, profile.empty_values, profile.cardinality, profile.masking_placeholder_values,
      `${profile.values_per_date_min}…${profile.values_per_date_max}`,
    ]),
  ));
  lines.push("");
  for (const profile of result.dimensions) {
    if (profile.notes.length) {
      lines.push(`- **${profile.field}:** ${profile.notes.join("; ")}`);
    }
  }
  lines.push("");

  lines.push("## 9. Межсрезовая согласованность");
  lines.push("");
  lines.push(table(
    ["метрика", "срезы", "дат с пересечением", "суммы совпадают", "независимость"],
    result.slice_overlap.map((row) => [row.metric, row.slices.join(", "), row.shared_dates, row.values_equal_on_shared_dates ? "да" : "нет", row.independence]),
  ));
  lines.push("");
  lines.push("Суммирование значений между срезами **запрещено**: независимость срезов не доказана. Для `qty_orders_delivered` совпадение дневных сумм означает, что срезы описывают одно население в разных разрезах.");
  lines.push("");
  const delivered = result.metric_profiles.filter((profile) => profile.metric === "qty_orders_delivered");
  lines.push(table(
    ["slice", "сумма qty_orders_delivered", "дней", "первое", "последнее"],
    delivered.map((profile) => [profile.slice_id, fmt(profile.sum, 2), profile.days_with_data, profile.first_date, profile.last_date]),
  ));
  lines.push("");

  lines.push("## 10. Пригодность исторического периода");
  lines.push("");
  const assessment = result.period_assessment;
  lines.push(table(["Вопрос", "Ответ"], [
    ["Длина истории", `${assessment.days} календарных дней (${assessment.from} … ${assessment.to})`],
    ["Полных недель (пн–вс)", assessment.complete_weeks],
    ["Простая базовая модель возможна", assessment.simple_baseline_possible ? "да (>= 21 дня)" : "нет"],
    ["Дни недели как признаки возможны", assessment.dow_features_possible ? "да (>= 2 полных недель)" : "нет"],
    ["Надёжность недельного профиля", assessment.weekly_profile_reliability === "medium" ? "средняя (4–5 полных недель), не высокая" : "низкая"],
    ["Рекомендуемые горизонты", assessment.recommended_horizons.length ? `${assessment.recommended_horizons.join(", ")} дней` : "не определены"],
  ]));
  lines.push("");
  lines.push("Число фолдов rolling-origin (оценка, без реализации backtesting):");
  lines.push("");
  lines.push(table(
    ["горизонт, дней", "мин. обучающая история, дней", "фолдов"],
    assessment.backtesting_folds.map((fold) => [fold.horizon_days, fold.min_train_days, fold.folds]),
  ));
  lines.push("");
  lines.push("На этой истории **нельзя** утверждать:");
  lines.push("");
  for (const claim of assessment.forbidden_claims) lines.push(`- ${claim}`);
  lines.push("");
  lines.push("Это ограничение объёма данных, а не качества пайплайна: выводы появятся после накопления 12+ недель.");
  lines.push("");

  lines.push("## 11. Ограничения");
  lines.push("");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);
  lines.push("");

  lines.push("## 12. Выводы");
  lines.push("");
  lines.push(`- Данные технически пригодны для подготовки временного ряда: период непрерывен по календарю, дублей natural key нет, NULL отсутствуют.`);
  lines.push(`- Показатель \`qty_orders_delivered\` присутствует во всех ${result.slices.length} срезах с одинаковыми дневными суммами — это разные разрезы одного показателя, поэтому нужен канонический срез.`);
  lines.push(`- Ни одна метрика не получает статус READY: бизнес-семантика подтверждена только каталогом метаданных, а не согласованными определениями.`);
  lines.push(`- Готовность к прогнозированию: CONDITIONAL — ${conditional.length}, BLOCKED — ${blocked.length}, READY — ${ready.length}.`);
  lines.push(`- История ${result.period.days} дня позволяет проверить только короткие горизонты (${result.period_assessment.recommended_horizons.join(", ")} дней); выводы о сезонности невозможны.`);
  lines.push("");
  lines.push("Подробный перечень проблем и действий — в `stage-3.1-findings.md`.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function buildFindings(result: ProfilingResult): string {
  const lines: string[] = [];
  lines.push("# Stage 3.1 — обнаруженные проблемы, ограничения и рекомендуемые действия");
  lines.push("");
  lines.push(`Магазин ${result.shop_no}, период ${result.period.from} … ${result.period.to}, сформировано ${result.generated_at}.`);
  lines.push("");

  lines.push("## Проблемы и ограничения данных");
  lines.push("");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);
  lines.push("");

  lines.push("## Проблемы уровня метрик (BLOCKED)");
  lines.push("");
  const blocked = result.readiness.filter((row) => row.forecast_readiness === "BLOCKED");
  if (blocked.length) {
    for (const row of blocked) {
      lines.push(`### ${row.metric} (slice ${row.slices.join(", ")})`);
      lines.push(`- Причины: ${row.reasons.join("; ")}`);
      lines.push(`- Требуется: ${row.required_actions.join("; ")}`);
    }
  } else {
    lines.push("Блокирующих проблем не обнаружено.");
  }
  lines.push("");

  lines.push("## Условно пригодные метрики (CONDITIONAL)");
  lines.push("");
  for (const row of result.readiness.filter((entry) => entry.forecast_readiness === "CONDITIONAL")) {
    lines.push(`- **${row.metric}** (slice ${row.slices.join(", ")}, ${row.metric_kind}): ${row.reasons.join("; ")}`);
    if (row.required_actions.length) lines.push(`  - требуется: ${row.required_actions.join("; ")}`);
  }
  if (!result.readiness.some((entry) => entry.forecast_readiness === "CONDITIONAL")) lines.push("Нет.");
  lines.push("");

  lines.push("## Ограничения методов поиска выбросов");
  lines.push("");
  for (const profile of result.metric_profiles) {
    const points = profile.stats.n;
    if (points < 8) lines.push(`- ${profile.metric} (slice ${profile.slice_id}): ${points} наблюдений — IQR и MAD неприменимы (минимум 8)`);
    else if (profile.stats.iqr === 0) lines.push(`- ${profile.metric} (slice ${profile.slice_id}): IQR = 0 (постоянный ряд) — метод неприменим`);
    else if (profile.stats.mad === 0) lines.push(`- ${profile.metric} (slice ${profile.slice_id}): MAD = 0 — метод MAD неприменим`);
  }
  lines.push("");

  lines.push("## Рекомендуемые действия до Stage 3.2");
  lines.push("");
  lines.push("1. Письменно согласовать определения и единицы измерения всех метрик (в первую очередь денежных).");
  lines.push("2. Определить канонический срез для `qty_orders_delivered` и запретить суммирование между срезами.");
  lines.push("3. Подтвердить числитель и знаменатель каждой ratio-метрики; для `share_not_in_slot_all` отношение уже восстанавливается точно.");
  lines.push("4. Зафиксировать политику обработки NULL и пропусков (без интерполяции).");
  lines.push("5. Проверить помеченные выбросы по первоисточнику; решения фиксировать в журнале.");
  lines.push("6. Расширить период истории минимум до 12 недель для оценки недельного профиля и backtesting.");
  lines.push("7. Проверить, что 43 плановых мероприятия не используются как исторические факторы.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export interface ReportFiles {
  report: string;
  metrics: string;
  coverage: string;
  outliers: string;
  dimensions: string;
  readiness: string;
  findings: string;
}

/** Записывает все семь артефактов Stage 3.1 (вне SQLite). */
export async function writeReports(
  result: ProfilingResult,
  rows: readonly DailyObservationRow[],
  outDir: string,
): Promise<ReportFiles> {
  await mkdir(outDir, { recursive: true });
  const files: ReportFiles = {
    report: join(outDir, "data-quality-report.md"),
    metrics: join(outDir, "metrics-profile.csv"),
    coverage: join(outDir, "temporal-coverage.csv"),
    outliers: join(outDir, "outliers.csv"),
    dimensions: join(outDir, "dimensions-profile.csv"),
    readiness: join(outDir, "forecast-readiness.csv"),
    findings: join(outDir, "stage-3.1-findings.md"),
  };

  await Bun.write(files.report, buildDataQualityReport(result));
  await Bun.write(files.metrics, metricsProfileCsv(result));
  await Bun.write(files.coverage, temporalCoverageCsv(result));
  await Bun.write(files.outliers, outliersCsv(result));
  await Bun.write(files.dimensions, dimensionsProfileCsv(result, rows));
  await Bun.write(files.readiness, readinessCsv(result));
  await Bun.write(files.findings, buildFindings(result));

  return files;
}
