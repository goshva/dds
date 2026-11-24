/**
 * Stage 3.3.1 — сборка расширенной истории из непересекающихся интервалов выгрузки.
 *
 * Правила:
 *  - читаются только готовые артефакты выгрузки (никаких новых запросов);
 *  - значения NULL не заменяются нулём, отрицательные и дробные значения фиксируются;
 *  - дубли дат не суммируются: они попадают в диагностику и блокируют сборку;
 *  - пропущенные календарные даты явно перечисляются, интерполяция не выполняется.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readRunArtifacts } from "../../ingestion/artifact-reader";
import { addDays, calendarRange } from "../profiling/metrics-profile";
import { iqr, mad, mean, median, quantile, round, stdev } from "../profiling/stats";
import { detectOutliers } from "../profiling/outliers";
import { DOW_LABELS, dayOfWeek } from "../profiling/metrics-profile";
import type {
  ExpandedHistory,
  ExtractionInterval,
  HistoryObservation,
  HistoryProfile,
} from "./types";

async function sha256OfFile(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Читает один каталог выгрузки: метаданные интервала и дневные наблюдения целевой метрики. */
export async function readInterval(
  runDir: string,
  label: string,
  expected: { shopNo: string; metric: string; sliceId: number },
): Promise<{ interval: ExtractionInterval; observations: HistoryObservation[]; rejected: Array<{ interval: string; date: string; reason: string }> }> {
  const dir = resolve(runDir);
  const artifacts = await readRunArtifacts(dir);
  const quality = artifacts.quality?.requests?.[0] ?? {};
  const source = artifacts.manifest?.sources?.[0] ?? {};
  const request = artifacts.observations.filter((row) => row.metric === expected.metric);
  const rejected: Array<{ interval: string; date: string; reason: string }> = [];
  const observations: HistoryObservation[] = [];

  for (const row of request) {
    if ((artifacts.manifest?.shopno ?? "") !== expected.shopNo) {
      rejected.push({ interval: label, date: row.date, reason: `shopno=${artifacts.manifest?.shopno} не совпадает с ${expected.shopNo}` });
      continue;
    }
    if (row.slice_id !== expected.sliceId) {
      rejected.push({ interval: label, date: row.date, reason: `slice_id=${row.slice_id} не совпадает с ${expected.sliceId}` });
      continue;
    }
    if (!row.date) {
      rejected.push({ interval: label, date: "", reason: "строка без даты (итог за период)" });
      continue;
    }
    if (row.value === null) {
      rejected.push({ interval: label, date: row.date, reason: "NULL значение" });
      continue;
    }
    if (row.value < 0) {
      rejected.push({ interval: label, date: row.date, reason: `отрицательное значение ${row.value}` });
      continue;
    }
    observations.push({
      date: row.date,
      value: row.value,
      intervalLabel: label,
      sliceId: row.slice_id,
      datasetId: row.dataset_id,
      manifestSha256: String(artifacts.manifest?.manifest_sha256 ?? "") || null,
    });
  }

  const manifestPath = join(dir, "manifest.json");
  const interval: ExtractionInterval = {
    label,
    runDir: dir,
    requestedFrom: String(artifacts.manifest?.period?.from ?? ""),
    requestedToExclusive: String(artifacts.manifest?.period?.to ?? ""),
    manifestGeneratedAt: String(artifacts.manifest?.generated_at ?? ""),
    requestSha256: source.request_sha256 ? String(source.request_sha256) : null,
    httpStatus: quality.http_status == null ? null : Number(quality.http_status),
    completeness: String(quality.completeness ?? "none"),
    rows: observations.length,
    firstDate: observations[0]?.date ?? null,
    lastDate: observations.at(-1)?.date ?? null,
    fileHashes: {
      "manifest.json": await sha256OfFile(manifestPath),
      "observations_7745.csv": await sha256OfFile(join(dir, "observations_7745.csv")),
    },
  };

  return { interval, observations, rejected };
}

export interface BuildHistoryInput {
  shopNo: string;
  metric: string;
  sliceId: number;
  intervals: Array<{ runDir: string; label: string }>;
}

/** Собирает расширенную историю и проверяет её инварианты (дубли, пропуски, пересечения). */
export async function buildExpandedHistory(input: BuildHistoryInput): Promise<ExpandedHistory> {
  const intervals: ExtractionInterval[] = [];
  const rejectedRows: ExpandedHistory["rejectedRows"] = [];
  const byDate = new Map<string, HistoryObservation[]>();

  for (const spec of input.intervals) {
    const { interval, observations, rejected } = await readInterval(spec.runDir, spec.label, input);
    intervals.push(interval);
    rejectedRows.push(...rejected);
    for (const observation of observations) {
      const bucket = byDate.get(observation.date) ?? [];
      bucket.push(observation);
      byDate.set(observation.date, bucket);
    }
  }

  const duplicates = [...byDate.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([date, rows]) => ({ date, values: rows.map((row) => row.value), intervals: rows.map((row) => row.intervalLabel) }));

  const observations = [...byDate.entries()]
    .filter(([, rows]) => rows.length === 1)
    .map(([, rows]) => rows[0]!)
    .sort((a, b) => a.date.localeCompare(b.date));

  const from = observations[0]?.date ?? "";
  const to = observations.at(-1)?.date ?? "";
  const calendar = from && to ? calendarRange(from, to) : [];
  const present = new Set(observations.map((observation) => observation.date));
  const missingDates = calendar.filter((date) => !present.has(date));
  const gaps: ExpandedHistory["gaps"] = [];
  let gapStart: string | null = null;
  let gapEnd: string | null = null;
  for (const date of calendar) {
    if (present.has(date)) {
      if (gapStart && gapEnd) gaps.push({ from: gapStart, to: gapEnd, days: calendarRange(gapStart, gapEnd).length });
      gapStart = null;
      gapEnd = null;
    } else {
      gapStart ??= date;
      gapEnd = date;
    }
  }
  if (gapStart && gapEnd) gaps.push({ from: gapStart, to: gapEnd, days: calendarRange(gapStart, gapEnd).length });

  // пересечения интервалов: один и тот же день покрыт более чем одним интервалом
  const overlapWarnings: string[] = [];
  for (const duplicate of duplicates) {
    overlapWarnings.push(`${duplicate.date}: значение присутствует в нескольких интервалах (${duplicate.intervals.join(", ")})`);
  }

  const checksum = new Bun.CryptoHasher("sha256")
    .update(observations.map((observation) => `${observation.date}\t${observation.value}`).join("\n"))
    .digest("hex");

  return {
    shopNo: input.shopNo,
    metric: input.metric,
    sliceId: input.sliceId,
    observations,
    period: { from, to, days: calendar.length },
    expectedDays: calendar.length,
    missingDates,
    gaps,
    duplicates,
    intervals,
    overlapWarnings,
    rejectedRows,
    checksum,
  };
}

/** Профиль дневного ряда (расширенная история или сравнение версий). */
export function profileHistory(observations: readonly HistoryObservation[]): HistoryProfile {
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((observation) => observation.value);
  const calendar = sorted.length ? calendarRange(sorted[0]!.date, sorted.at(-1)!.date) : [];
  const present = new Set(sorted.map((observation) => observation.date));

  const byDow = new Map<number, number[]>();
  for (const observation of sorted) {
    const dow = dayOfWeek(observation.date);
    const bucket = byDow.get(dow) ?? [];
    bucket.push(observation.value);
    byDow.set(dow, bucket);
  }

  // недельные агрегаты: недели по понедельникам
  const weeks = new Map<string, number[]>();
  for (const observation of sorted) {
    const dow = dayOfWeek(observation.date);
    const weekStart = addDays(observation.date, -(dow - 1));
    const bucket = weeks.get(weekStart) ?? [];
    bucket.push(observation.value);
    weeks.set(weekStart, bucket);
  }

  let longestGrowth = 0;
  let longestDecline = 0;
  let currentGrowth = 0;
  let currentDecline = 0;
  let largest: { date: string; delta: number } | null = null;
  for (let index = 1; index < sorted.length; index++) {
    const delta = sorted[index]!.value - sorted[index - 1]!.value;
    if (!largest || Math.abs(delta) > Math.abs(largest.delta)) largest = { date: sorted[index]!.date, delta };
    if (delta > 0) {
      currentGrowth++;
      currentDecline = 0;
    } else if (delta < 0) {
      currentDecline++;
      currentGrowth = 0;
    } else {
      currentGrowth = 0;
      currentDecline = 0;
    }
    longestGrowth = Math.max(longestGrowth, currentGrowth);
    longestDecline = Math.max(longestDecline, currentDecline);
  }

  const points = sorted.map((observation) => ({ date: observation.date, value: observation.value }));
  const iqrOutliers = detectOutliers(points, { metric: "value", slice_id: 20624 }).findings.filter((finding) => finding.method === "IQR");
  const madOutliers = detectOutliers(points, { metric: "value", slice_id: 20624 }).findings.filter((finding) => finding.method === "MAD");

  return {
    observations: sorted.length,
    firstDate: sorted[0]?.date ?? "",
    lastDate: sorted.at(-1)?.date ?? "",
    calendarDays: calendar.length,
    missingDates: calendar.filter((date) => !present.has(date)).length,
    duplicates: 0,
    nulls: 0,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    mean: round(mean(values)) ?? 0,
    median: round(median(values)) ?? 0,
    stdev: round(stdev(values)) ?? 0,
    q1: round(quantile(values, 0.25)) ?? 0,
    q3: round(quantile(values, 0.75)) ?? 0,
    iqr: round(iqr(values)) ?? 0,
    mad: round(mad(values)) ?? 0,
    percentiles: {
      p05: round(quantile(values, 0.05)) ?? 0,
      p25: round(quantile(values, 0.25)) ?? 0,
      p50: round(quantile(values, 0.5)) ?? 0,
      p75: round(quantile(values, 0.75)) ?? 0,
      p95: round(quantile(values, 0.95)) ?? 0,
    },
    zeros: values.filter((value) => value === 0).length,
    negatives: values.filter((value) => value < 0).length,
    outlierCountIqr: iqrOutliers.length,
    outlierCountMad: madOutliers.length,
    weekdayMeans: [...byDow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dow, dowValues]) => ({
        dow,
        label: DOW_LABELS[dow] ?? String(dow),
        observations: dowValues.length,
        mean: round(mean(dowValues)) ?? 0,
        median: round(median(dowValues)) ?? 0,
      })),
    weeklyAggregates: [...weeks.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, weekValues]) => ({
        weekStart,
        days: weekValues.length,
        total: weekValues.reduce((acc, value) => acc + value, 0),
        mean: round(mean(weekValues)) ?? 0,
      })),
    longestGrowthStreak: longestGrowth,
    longestDeclineStreak: longestDecline,
    largestDayOverDayChange: largest,
  };
}

/** Читает дневные значения из canonical CSV (сравнение версий). */
export async function readCanonicalCsv(path: string): Promise<Array<{ date: string; value: number }>> {
  const text = await readFile(path, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  const dateIndex = header.indexOf("date");
  const valueIndex = header.indexOf("value");
  if (dateIndex < 0 || valueIndex < 0) throw new Error(`${path}: в CSV нет колонок date/value`);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    return { date: cells[dateIndex]!, value: Number(cells[valueIndex]!) };
  });
}
