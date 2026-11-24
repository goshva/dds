/**
 * Stage 3.3.1 — отчёты: аудит источника, расширение истории, сверка и профиль.
 * CSV формируются общим сериализатором проекта (UTF-8, RFC 4180, разделитель «,»).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toCsv } from "../profiling/report";
import type { ExpandedHistory, HistoryProfile, HistoryReconciliationResult } from "./types";

const fmt = (value: number | null | undefined, digits = 2): string =>
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

export function sourceAuditMarkdown(input: {
  shopNo: string;
  sliceId: number;
  chartId: number;
  datasetId: number;
  vizType: string;
  metric: string;
  granularity: string;
  timeGrain: string;
  timezone: string;
  filters: string[];
  rowLimit: number | null;
  timeField: string;
  depthDays: number;
  intervals: ExpandedHistory["intervals"];
  generatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push("# Stage 3.3.1 — Аудит источника данных");
  lines.push("");
  lines.push(`Магазин ${input.shopNo}; срез ${input.sliceId}; метрика ${input.metric}; сформировано ${input.generatedAt}.`);
  lines.push("");
  lines.push("## Параметры источника (FACT)");
  lines.push("");
  lines.push(mdTable(["Параметр", "Значение"], [
    ["chart_id", input.chartId],
    ["slice_id", input.sliceId],
    ["datasource_id", input.datasetId],
    ["viz_type", input.vizType],
    ["метрика", input.metric],
    ["granularity (запрос)", input.granularity],
    ["time_grain_sqla (запрос)", input.timeGrain],
    ["временное поле", input.timeField],
    ["timezone", input.timezone],
    ["row_limit", input.rowLimit ?? "—"],
    ["фильтры", input.filters.join("; ")],
  ]));
  lines.push("");
  lines.push("## Доступная глубина истории (FACT)");
  lines.push("");
  lines.push(`Проверено последовательными запросами: доступно **${input.depthDays}** календарных дней.`);
  lines.push("");
  lines.push(mdTable(
    ["интервал", "запрошено", "HTTP", "полнота", "строк", "первая дата", "последняя дата"],
    input.intervals.map((interval) => [
      interval.label,
      `${interval.requestedFrom} … ${interval.requestedToExclusive} (исключая)`,
      interval.httpStatus ?? "—",
      interval.completeness,
      interval.rows,
      interval.firstDate ?? "—",
      interval.lastDate ?? "—",
    ]),
  ));
  lines.push("");
  lines.push("## Ограничения и правила запросов (FACT/INFERENCE)");
  lines.push("");
  lines.push(bullets([
    "FACT: запросы выполнялись последовательно, с паузой не менее 15 секунд, без параллельных обращений к одному datasource",
    "FACT: верхняя граница периода трактуется как исключающая, поэтому незавершённый день 2026-11-23 в выборку не попадает",
    "FACT: row_limit запроса — 10000, фактическое число строк не приближается к лимиту (одна строка на дату)",
    "INFERENCE: глубина ограничена только доступностью данных в источнике; на проверенных интервалах полнота full и расхождений нет",
    "UNCONFIRMED: правила пересчёта исторических значений задним числом в источнике не документированы",
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function historyExpansionMarkdown(input: {
  history: ExpandedHistory;
  reconciliation: HistoryReconciliationResult;
  profileNew: HistoryProfile;
  profileOld: HistoryProfile | null;
  generatedAt: string;
}): string {
  const { history, reconciliation, profileNew, profileOld } = input;
  const lines: string[] = [];
  lines.push("# Stage 3.3.1 — Расширение исторических данных");
  lines.push("");
  lines.push(`Магазин ${history.shopNo}; срез ${history.sliceId}; метрика ${history.metric}; сформировано ${input.generatedAt}.`);
  lines.push("");
  lines.push("## Итог расширения");
  lines.push("");
  lines.push(mdTable(["Показатель", "Значение"], [
    ["наблюдений", history.observations.length],
    ["период", `${history.period.from} … ${history.period.to}`],
    ["календарных дней", history.period.days],
    ["пропущенных дат", history.missingDates.length],
    ["дубликатов дат", history.duplicates.length],
    ["исключённых строк", history.rejectedRows.length],
    ["checksum содержимого", history.checksum],
    ["статус сверки с предыдущей версией", reconciliation.status],
  ]));
  lines.push("");
  lines.push("## Интервалы выгрузки");
  lines.push("");
  lines.push(mdTable(
    ["интервал", "строк", "первая дата", "последняя дата", "HTTP", "полнота", "sha256 manifest", "sha256 observations"],
    history.intervals.map((interval) => [
      interval.label, interval.rows, interval.firstDate ?? "—", interval.lastDate ?? "—", interval.httpStatus ?? "—",
      interval.completeness, (interval.fileHashes["manifest.json"] ?? "").slice(0, 12) + "…",
      (interval.fileHashes["observations_7745.csv"] ?? "").slice(0, 12) + "…",
    ]),
  ));
  lines.push("");
  lines.push("## Сверка с предыдущей версией canonical dataset");
  lines.push("");
  lines.push(mdTable(["Категория", "Количество"], Object.entries(reconciliation.counts).map(([category, count]) => [category, count])));
  lines.push("");
  lines.push(bullets(reconciliation.notes));
  lines.push("");
  if (reconciliation.rows.some((row) => row.category === "VALUE_CHANGED" || row.category === "MISSING")) {
    lines.push("### Даты с расхождениями");
    lines.push("");
    lines.push(mdTable(
      ["date", "было", "стало", "отклонение", "категория", "примечание"],
      reconciliation.rows
        .filter((row) => row.category === "VALUE_CHANGED" || row.category === "MISSING")
        .map((row) => [row.date, fmt(row.previousValue), fmt(row.newValue), fmt(row.deviation), row.category, row.note]),
    ));
    lines.push("");
  }
  lines.push("## Профиль расширенной истории");
  lines.push("");
  lines.push(mdTable(["Показатель", "Расширенная история", "Прежняя (41 день)"], [
    ["наблюдений", profileNew.observations, profileOld?.observations ?? "—"],
    ["период", `${profileNew.firstDate} … ${profileNew.lastDate}`, profileOld ? `${profileOld.firstDate} … ${profileOld.lastDate}` : "—"],
    ["календарных дней", profileNew.calendarDays, profileOld?.calendarDays ?? "—"],
    ["пропущенных дат", profileNew.missingDates, profileOld?.missingDates ?? "—"],
    ["min", fmt(profileNew.min), profileOld ? fmt(profileOld.min) : "—"],
    ["max", fmt(profileNew.max), profileOld ? fmt(profileOld.max) : "—"],
    ["mean", fmt(profileNew.mean), profileOld ? fmt(profileOld.mean) : "—"],
    ["median", fmt(profileNew.median), profileOld ? fmt(profileOld.median) : "—"],
    ["stdev", fmt(profileNew.stdev), profileOld ? fmt(profileOld.stdev) : "—"],
    ["p05 / p95", `${fmt(profileNew.percentiles.p05)} / ${fmt(profileNew.percentiles.p95)}`, profileOld ? `${fmt(profileOld.percentiles.p05)} / ${fmt(profileOld.percentiles.p95)}` : "—"],
    ["IQR", fmt(profileNew.iqr), profileOld ? fmt(profileOld.iqr) : "—"],
    ["MAD", fmt(profileNew.mad), profileOld ? fmt(profileOld.mad) : "—"],
    ["выбросов IQR / MAD", `${profileNew.outlierCountIqr} / ${profileNew.outlierCountMad}`, profileOld ? `${profileOld.outlierCountIqr} / ${profileOld.outlierCountMad}` : "—"],
    ["нулей", profileNew.zeros, profileOld?.zeros ?? "—"],
    ["отрицательных", profileNew.negatives, profileOld?.negatives ?? "—"],
    ["макс. рост подряд, дней", profileNew.longestGrowthStreak, profileOld?.longestGrowthStreak ?? "—"],
    ["макс. снижение подряд, дней", profileNew.longestDeclineStreak, profileOld?.longestDeclineStreak ?? "—"],
  ]));
  lines.push("");
  lines.push("Выбросы не удалялись и не корректировались: они перечислены в CSV профиля и требуют проверки по первоисточнику.");
  lines.push("");
  lines.push("## Распределение по дням недели");
  lines.push("");
  lines.push(mdTable(
    ["день недели", "наблюдений", "среднее", "медиана"],
    profileNew.weekdayMeans.map((entry) => [entry.label, entry.observations, fmt(entry.mean), fmt(entry.median)]),
  ));
  lines.push("");
  lines.push("## Недельные агрегаты (первые 12 и последние 6 недель)");
  lines.push("");
  const weeks = profileNew.weeklyAggregates;
  const shown = [...weeks.slice(0, 12), ...weeks.slice(-6)];
  lines.push(mdTable(["неделя (пн)", "дней", "сумма", "среднее"], shown.map((week) => [week.weekStart, week.days, week.total, fmt(week.mean)])));
  lines.push("");
  lines.push("## Ограничения");
  lines.push("");
  lines.push(bullets([
    "история расширена только по утверждённому источнику (срез " + history.sliceId + "); другие срезы не добавлялись",
    "значения прежней версии не перезаписывались: расхождения фиксируются в отчёте",
    "семантика метрики остаётся PROVISIONAL до письменного подтверждения бизнес-владельцем (см. Stage 3.3.3)",
    "пропущенные календарные даты не интерполировались",
    `исключённых строк: ${history.rejectedRows.length}`,
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function historyCsv(history: ExpandedHistory): string {
  return toCsv(
    ["date", "shop_no", "slice_id", "metric", "value", "interval_label", "dataset_id"],
    history.observations.map((observation) => [
      observation.date, history.shopNo, observation.sliceId, history.metric, observation.value,
      observation.intervalLabel, observation.datasetId,
    ]),
  );
}

/**
 * Canonical CSV в формате Stage 3.2 (8 колонок, без изменения схемы).
 * Провенанс строк, пришедших из файловых выгрузок, кодируется в source_run_id
 * как `interval:<метка>`; для строк, известных в SQLite, остаётся числовой run_id.
 */
export function canonicalCsvCompat(
  history: ExpandedHistory,
  runIdByDate: Map<string, string>,
): string {
  return toCsv(
    ["date", "shop_no", "metric", "value", "source_slice_id", "source_dataset_id", "source_run_id", "quality_status"],
    history.observations.map((observation) => [
      observation.date,
      history.shopNo,
      history.metric,
      observation.value,
      observation.sliceId,
      observation.datasetId,
      runIdByDate.get(observation.date) ?? `interval:${observation.intervalLabel}`,
      "full",
    ]),
  );
}

export function reconciliationCsv(result: HistoryReconciliationResult): string {
  return toCsv(
    ["date", "previous_value", "new_value", "deviation", "category", "note"],
    result.rows.map((row) => [row.date, row.previousValue, row.newValue, row.deviation, row.category, row.note]),
  );
}

export function profileJson(profile: HistoryProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export interface ExpansionArtifacts {
  written: string[];
}

/** Записывает артефакты Stage 3.3.1. */
export async function writeExpansionArtifacts(input: {
  outDir: string;
  dataOutDir: string;
  sourceAudit: string;
  expansionMarkdown: string;
  history: ExpandedHistory;
  reconciliation: HistoryReconciliationResult;
  profileNew: HistoryProfile;
  profileOld: HistoryProfile | null;
  canonicalCsv: string;
  writeCanonical: boolean;
}): Promise<ExpansionArtifacts> {
  await mkdir(input.outDir, { recursive: true });
  await mkdir(input.dataOutDir, { recursive: true });
  const written: string[] = [];
  const write = async (path: string, content: string) => {
    await Bun.write(path, content);
    written.push(path);
  };

  await write(join(input.outDir, "3.3.1-source-audit.md"), input.sourceAudit);
  await write(join(input.outDir, "3.3.1-history-expansion.md"), input.expansionMarkdown);
  await write(join(input.outDir, "3.3.1-history.csv"), historyCsv(input.history));
  await write(join(input.outDir, "3.3.1-reconciliation.csv"), reconciliationCsv(input.reconciliation));
  await write(join(input.outDir, "3.3.1-reconciliation.json"), `${JSON.stringify({
    status: input.reconciliation.status,
    counts: input.reconciliation.counts,
    compared_dates: input.reconciliation.comparedDates,
    new_dates: input.reconciliation.newDates,
    notes: input.reconciliation.notes,
    interval_checksums: input.history.intervals.map((interval) => ({ label: interval.label, files: interval.fileHashes })),
    history_checksum: input.history.checksum,
  }, null, 2)}\n`);
  await write(join(input.outDir, "3.3.1-profile.json"), profileJson(input.profileNew));
  if (input.profileOld) await write(join(input.outDir, "3.3.1-profile-previous.json"), profileJson(input.profileOld));

  if (input.writeCanonical) {
    await write(join(input.dataOutDir, "canonical_daily_delivered_orders.csv"), input.canonicalCsv);
  }

  return { written };
}
