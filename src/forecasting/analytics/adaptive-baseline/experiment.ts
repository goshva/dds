/**
 * Stage 3.4.5 — экспериментальный прогон (исследовательский скрипт, не production).
 *
 * Запуск: bun src/forecasting/analytics/adaptive-baseline/experiment.ts
 *
 * Что делает: по утверждённому протоколу проводит validation → frozen config → test
 * evaluation (HAC + Holm + bootstrap) → noise control (100 seed). Пишет артефакты
 * в reports/forecasting/stage-3.4.5/. Данные и production-код не изменяет.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { calculateForVariant, type AdaptiveBaselineResult, type HistoryObservation, type Variant } from "./calculator";
import { readCanonicalCsv } from "../expansion/history-builder";

export const FROZEN_CONFIG = {
  baseline: "rolling_7_day_mean",
  variants: ["A", "B"] as const,
  mainHorizon: 7,
  minTrainPrimary: 28,
  minTrainSensitivity: 21,
  originSplitPercent: 50,
  alpha: 1.0,
  limitPercent: 0.1,
  holmAlpha: 0.05,
  hacLag: 7,
  bootstrap: { replicates: 10000, blockLength: 7, seed: 20261124 },
  noise: { seeds: 100, seedFrom: 1 },
  datasetChecksum: "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a",
  frozenAt: "2026-11-24T10:15:00.000Z",
} as const;

export interface Pair {
  originDate: string;
  targetDate: string;
  actual: number;
  baseline: number;
  variantA: number;
  variantB: number;
  correctionA: number | null;
  correctionB: number | null;
  appliedA: boolean;
  appliedB: boolean;
  statusA: string;
  statusB: string;
}

export interface Metrics {
  n: number;
  mae: number;
  wape: number;
  bias: number;
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1));
}

/** HAC-дисперсия среднего (Newey–West) с весом Бартлетта. */
export function hacVariance(values: readonly number[], lag: number): number {
  const n = values.length;
  if (n < 3) return 0;
  const avg = mean(values);
  const centered = values.map((value) => value - avg);
  let variance = centered.reduce((acc, value) => acc + value * value, 0) / n;
  for (let k = 1; k <= Math.min(lag, n - 1); k++) {
    const weight = 1 - k / (lag + 1);
    let covariance = 0;
    for (let index = k; index < n; index++) covariance += centered[index]! * centered[index - k]!;
    covariance /= n;
    variance += 2 * weight * covariance;
  }
  return Math.max(variance, 0) / n;
}

/** Нормальная CDF через erf (Abramowitz–Stegun 7.1.26). */
export function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export interface HacResult {
  n: number;
  meanDifference: number;
  standardError: number;
  tStat: number;
  pValue: number;
  ci95Low: number;
  ci95High: number;
  lag: number;
}

export function hacTest(differences: readonly number[], lag: number): HacResult {
  const n = differences.length;
  const avg = mean(differences);
  const variance = hacVariance(differences, lag);
  const se = variance > 0 ? Math.sqrt(variance) : 0;
  const tStat = se === 0 ? 0 : avg / se;
  return {
    n,
    meanDifference: avg,
    standardError: se,
    tStat,
    pValue: 2 * (1 - normalCdf(Math.abs(tStat))),
    ci95Low: avg - 1.96 * se,
    ci95High: avg + 1.96 * se,
    lag,
  };
}

/** Holm-adjusted p-values (для публикации). */
export function holmAdjusted(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((pValue, index) => ({ pValue, index })).sort((a, b) => a.pValue - b.pValue);
  const adjusted = new Array<number>(m).fill(0);
  let running = 0;
  order.forEach((entry, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * entry.pValue));
    adjusted[entry.index] = running;
  });
  return adjusted;
}

/** Детерминированный PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moving block bootstrap среднего по блокам фиксированной длины. */
export function blockBootstrap(differences: readonly number[], blockLength: number, replicates: number, seed: number): { mean: number; ci95Low: number; ci95High: number; pValue: number } {
  const n = differences.length;
  const random = mulberry32(seed);
  const means: number[] = [];
  const blocksCount = Math.ceil(n / blockLength);
  for (let replicate = 0; replicate < replicates; replicate++) {
    const sampled: number[] = [];
    for (let block = 0; block < blocksCount; block++) {
      const start = Math.floor(random() * n);
      for (let offset = 0; offset < blockLength && sampled.length < n; offset++) sampled.push(differences[(start + offset) % n]!);
    }
    means.push(mean(sampled.slice(0, n)));
  }
  means.sort((a, b) => a - b);
  const percentile = (q: number) => {
    const position = q * (means.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return means[lower]! + (position - lower) * (means[upper]! - means[lower]!);
  };
  const below = means.filter((value) => value <= 0).length;
  const above = means.filter((value) => value >= 0).length;
  return { mean: mean(means), ci95Low: percentile(0.025), ci95High: percentile(0.975), pValue: 2 * Math.min(below, above) / means.length };
}

/** Линейный перцентиль с нулевой индексацией. */
export function percentileLinear(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (position - lower) * (sorted[upper]! - sorted[lower]!);
}

export function metricsOf(pairs: ReadonlyArray<{ actual: number; forecast: number }>): Metrics {
  const n = pairs.length;
  const absErrors = pairs.map((pair) => Math.abs(pair.forecast - pair.actual));
  const signed = pairs.map((pair) => pair.forecast - pair.actual);
  const actualAbs = pairs.reduce((acc, pair) => acc + Math.abs(pair.actual), 0);
  return {
    n,
    mae: mean(absErrors),
    wape: actualAbs === 0 ? 0 : (absErrors.reduce((acc, value) => acc + value, 0) / actualAbs) * 100,
    bias: mean(signed),
  };
}

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------

function rolling7(history: readonly HistoryObservation[]): number {
  const window = history.slice(-7);
  return mean(window.map((observation) => observation.value));
}

export function buildPairs(rows: ReadonlyArray<{ date: string; value: number }>, minTrain: number, horizon: number): Pair[] {
  const pairs: Pair[] = [];
  const byDate = new Map(rows.map((row) => [row.date, row.value]));
  for (let index = minTrain - 1; index + horizon < rows.length; index++) {
    const origin = rows[index]!;
    const targetDate = rows[index + horizon]!.date;
    const actual = byDate.get(targetDate);
    if (actual === undefined) continue;
    const history = rows.slice(0, index + 1);
    const baseline = rolling7(history);
    const a = calculateForVariant("A", { originDate: origin.date, targetDate, history, baselineForecast: baseline, alpha: FROZEN_CONFIG.alpha, limitPercent: FROZEN_CONFIG.limitPercent });
    const b = calculateForVariant("B", { originDate: origin.date, targetDate, history, baselineForecast: baseline, alpha: FROZEN_CONFIG.alpha, limitPercent: FROZEN_CONFIG.limitPercent });
    pairs.push({
      originDate: origin.date,
      targetDate,
      actual,
      baseline,
      variantA: a.correctedForecast ?? Number.NaN,
      variantB: b.correctedForecast ?? Number.NaN,
      correctionA: a.correction,
      correctionB: b.correction,
      appliedA: a.applied,
      appliedB: b.applied,
      statusA: a.status,
      statusB: b.status,
    });
  }
  return pairs;
}

export function splitByDate(pairs: readonly Pair[]): { validation: Pair[]; test: Pair[] } {
  const midpoint = Math.floor(pairs.length * (FROZEN_CONFIG.originSplitPercent / 100));
  return { validation: pairs.slice(0, midpoint), test: pairs.slice(midpoint) };
}

export interface NoiseControl {
  amplitude: number;
  seeds: number;
  dCalendarA: number;
  dCalendarB: number;
  percentile95A: number;
  percentile95B: number;
  passedA: boolean;
  passedB: boolean;
  rows: Array<{ seed: number; mae: number; d: number }>;
}

export function runNoiseControl(testPairs: readonly Pair[], amplitude: number, candidate: "A" | "B"): NoiseControl {
  const rows: Array<{ seed: number; mae: number; d: number }> = [];
  const baselineMetrics = metricsOf(testPairs.map((pair) => ({ actual: pair.actual, forecast: pair.baseline })));
  for (let seed = FROZEN_CONFIG.noise.seedFrom; seed <= FROZEN_CONFIG.noise.seeds; seed++) {
    const random = mulberry32(seed);
    const forecasts = testPairs.map((pair) => {
      const magnitude = amplitude * random();
      const sign = random() < 0.5 ? -1 : 1;
      return pair.baseline + sign * magnitude;
    });
    const metrics = metricsOf(testPairs.map((pair, index) => ({ actual: pair.actual, forecast: forecasts[index]! })));
    rows.push({ seed, mae: metrics.mae, d: baselineMetrics.mae - metrics.mae });
  }
  const dValues = rows.map((row) => row.d);
  const percentile95 = percentileLinear(dValues, 0.95);
  const candidateRows = testPairs.map((pair) => ({ actual: pair.actual, forecast: candidate === "A" ? pair.variantA : pair.variantB }));
  const candidateMetrics = metricsOf(candidateRows);
  const dCalendar = baselineMetrics.mae - candidateMetrics.mae;
  return { amplitude, seeds: rows.length, dCalendarA: candidate === "A" ? dCalendar : Number.NaN, dCalendarB: candidate === "B" ? dCalendar : Number.NaN, percentile95A: percentile95, percentile95B: percentile95, passedA: candidate === "A" && dCalendar > percentile95, passedB: candidate === "B" && dCalendar > percentile95, rows };
}

export function duplicateDiagnostics(pairs: readonly Pair[]): Record<string, unknown> {
  const weightsA = pairs.map((pair) => pair.correctionA).filter((value): value is number => value !== null);
  const weightsB = pairs.map((pair) => pair.correctionB).filter((value): value is number => value !== null);
  const weights = [...weightsA, ...weightsB];
  const levels = pairs.map((pair) => pair.baseline);
  const weightMean = mean(weights);
  const levelMean = mean(levels);
  const cov = weights.length && levels.length ? mean(weights.map((value, index) => (value - weightMean) * (levels[index % levels.length]! - levelMean))) : 0;
  return {
    correction_count: weights.length,
    correction_mean: weightMean,
    correction_median: percentileLinear(weights, 0.5),
    correction_p05: weights.length ? percentileLinear(weights, 0.05) : null,
    correction_p95: weights.length ? percentileLinear(weights, 0.95) : null,
    correction_percent_of_level_mean: levelMean === 0 ? null : (weightMean / levelMean) * 100,
    correlation_with_level: stdev(weights) === 0 || stdev(levels) === 0 ? null : cov / (stdev(weights) * stdev(levels)),
  };
}

async function main(): Promise<number> {
  const rows = await readCanonicalCsv(resolve("data/processed/forecasting/7745/canonical_daily_delivered_orders.csv"));
  const checksum = new Bun.CryptoHasher("sha256").update(rows.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
  if (checksum !== FROZEN_CONFIG.datasetChecksum) {
    console.error(`[ОСТАНОВКА] checksum набора не совпал: ${checksum}`);
    return 2;
  }

  const allPairs = buildPairs(rows, FROZEN_CONFIG.minTrainPrimary, FROZEN_CONFIG.mainHorizon);
  const { validation, test } = splitByDate(allPairs);

  // leakage-check
  const leakageViolations = allPairs.filter((pair) => pair.targetDate <= pair.originDate || !Number.isFinite(pair.baseline) || !Number.isFinite(pair.actual));

  // frozen amplitude: медиана |correction A| на validation
  // амплитуда шума считается по ПРИМЕНЁННЫМ поправкам варианта A (дни пн/сб),
  // иначе медиана равна нулю из-за дней без поправки
  const validationCorrections = validation
    .filter((pair) => pair.appliedA && pair.correctionA !== null)
    .map((pair) => pair.correctionA as number);
  const amplitude = validationCorrections.length ? percentileLinear(validationCorrections.map(Math.abs), 0.5) : 0;

  // test evaluation
  const baselineTest = metricsOf(test.map((pair) => ({ actual: pair.actual, forecast: pair.baseline })));
  const aTest = metricsOf(test.map((pair) => ({ actual: pair.actual, forecast: pair.variantA })));
  const bTest = metricsOf(test.map((pair) => ({ actual: pair.actual, forecast: pair.variantB })));
  const diffsA = test.map((pair) => Math.abs(pair.baseline - pair.actual) - Math.abs(pair.variantA - pair.actual));
  const diffsB = test.map((pair) => Math.abs(pair.baseline - pair.actual) - Math.abs(pair.variantB - pair.actual));
  const hacA = hacTest(diffsA, FROZEN_CONFIG.hacLag);
  const hacB = hacTest(diffsB, FROZEN_CONFIG.hacLag);
  const holm = holmAdjusted([hacA.pValue, hacB.pValue]);
  const bootA = blockBootstrap(diffsA, FROZEN_CONFIG.bootstrap.blockLength, FROZEN_CONFIG.bootstrap.replicates, FROZEN_CONFIG.bootstrap.seed);
  const bootB = blockBootstrap(diffsB, FROZEN_CONFIG.bootstrap.blockLength, FROZEN_CONFIG.bootstrap.replicates, FROZEN_CONFIG.bootstrap.seed);
  const abDiff = hacTest(diffsA.map((value, index) => value - diffsB[index]!), FROZEN_CONFIG.hacLag);

  // sensitivity analysis: min_train = 21 (не заменяет основной результат)
  const sensitivityPairs = buildPairs(rows, FROZEN_CONFIG.minTrainSensitivity, FROZEN_CONFIG.mainHorizon);
  const sensitivitySplit = splitByDate(sensitivityPairs);
  const sensitivityBaseline = metricsOf(sensitivitySplit.test.map((pair) => ({ actual: pair.actual, forecast: pair.baseline })));
  const sensitivityA = metricsOf(sensitivitySplit.test.map((pair) => ({ actual: pair.actual, forecast: pair.variantA })));
  const sensitivityB = metricsOf(sensitivitySplit.test.map((pair) => ({ actual: pair.actual, forecast: pair.variantB })));

  const noiseA = runNoiseControl(test, amplitude, "A");
  const noiseB = runNoiseControl(test, amplitude, "B");
  const duplication = duplicateDiagnostics(allPairs);

  const outDir = resolve("reports/forecasting/stage-3.4.5");
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(outDir, name), content);
    written.push(name);
  };
  const toCsv = (headers: string[], body: Array<Array<unknown>>) => [headers.join(","), ...body.map((row) => row.map((cell) => String(cell)).join(","))].join("\n") + "\n";

  await write("config.json", `${JSON.stringify({ ...FROZEN_CONFIG, frozenAmplitude: amplitude }, null, 2)}\n`);
  await write("validation-vs-test.json", `${JSON.stringify({
    total_pairs: allPairs.length,
    validation_pairs: validation.length,
    test_pairs: test.length,
    split_percent: FROZEN_CONFIG.originSplitPercent,
    validation_from: validation[0]?.originDate ?? null,
    validation_to: validation.at(-1)?.originDate ?? null,
    test_from: test[0]?.originDate ?? null,
    test_to: test.at(-1)?.originDate ?? null,
    frozen_amplitude: amplitude,
  }, null, 2)}\n`);
  await write("leakage-check.json", `${JSON.stringify({ passed: leakageViolations.length === 0, violations: leakageViolations.length, rule: "targetDate > originDate; baseline и actual конечны" }, null, 2)}\n`);
  await write("forecast-details.csv", toCsv(
    ["origin_date", "target_date", "actual", "baseline", "variant_a", "variant_b", "correction_a", "correction_b", "applied_a", "applied_b", "status_a", "status_b"],
    allPairs.map((pair) => [pair.originDate, pair.targetDate, pair.actual, pair.baseline, pair.variantA, pair.variantB, pair.correctionA, pair.correctionB, pair.appliedA, pair.appliedB, pair.statusA, pair.statusB]),
  ));
  await write("model-comparison.csv", toCsv(
    ["model", "n", "MAE", "WAPE", "Bias"],
    [
      ["baseline", baselineTest.n, baselineTest.mae, baselineTest.wape, baselineTest.bias],
      ["variant_A", aTest.n, aTest.mae, aTest.wape, aTest.bias],
      ["variant_B", bTest.n, bTest.mae, bTest.wape, bTest.bias],
    ],
  ));
  await write("paired-differences.csv", toCsv(
    ["origin_date", "target_date", "diff_a", "diff_b"],
    test.map((pair, index) => [pair.originDate, pair.targetDate, diffsA[index], diffsB[index]]),
  ));
  await write("holm-results.json", `${JSON.stringify({
    method: "HAC (Newey–West), lag = horizon",
    comparisons: [
      { variant: "A", p_raw: hacA.pValue, p_holm: holm[0]!, reject: holm[0]! < FROZEN_CONFIG.holmAlpha, mean_difference: hacA.meanDifference, ci95: [hacA.ci95Low, hacA.ci95High] },
      { variant: "B", p_raw: hacB.pValue, p_holm: holm[1]!, reject: holm[1]! < FROZEN_CONFIG.holmAlpha, mean_difference: hacB.meanDifference, ci95: [hacB.ci95Low, hacB.ci95High] },
    ],
    alpha: FROZEN_CONFIG.holmAlpha,
  }, null, 2)}\n`);
  await write("noise-control.csv", toCsv(
    ["variant", "seed", "MAE", "D"],
    [...noiseA.rows.map((row) => ["A", row.seed, row.mae, row.d]), ...noiseB.rows.map((row) => ["B", row.seed, row.mae, row.d])],
  ));
  await write("duplication-diagnostics.json", `${JSON.stringify(duplication, null, 2)}\n`);
  await write("sensitivity.json", `${JSON.stringify({
    min_train: FROZEN_CONFIG.minTrainSensitivity,
    pairs: { total: sensitivityPairs.length, validation: sensitivitySplit.validation.length, test: sensitivitySplit.test.length },
    test_metrics: { baseline: sensitivityBaseline, A: sensitivityA, B: sensitivityB },
    note: "sensitivity analysis: не заменяет основной результат",
  }, null, 2)}\n`);
  await write("variant-comparison.json", `${JSON.stringify({
    mae_a: aTest.mae,
    mae_b: bTest.mae,
    mae_difference_b_minus_a: bTest.mae - aTest.mae,
    mean_difference_a_minus_b: abDiff.meanDifference,
    hac: abDiff,
    note: "A vs B: положительное mean_difference означает преимущество B",
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    dataset_checksum: checksum,
    pairs: { total: allPairs.length, validation: validation.length, test: test.length },
    frozen_amplitude: amplitude,
    validation_metrics: {
      baseline: metricsOf(validation.map((pair) => ({ actual: pair.actual, forecast: pair.baseline }))),
      A: metricsOf(validation.map((pair) => ({ actual: pair.actual, forecast: pair.variantA }))),
      B: metricsOf(validation.map((pair) => ({ actual: pair.actual, forecast: pair.variantB }))),
    },
    test_metrics: { baseline: baselineTest, A: aTest, B: bTest },
    paired: {
      A: { mean: hacA.meanDifference, se: hacA.standardError, t: hacA.tStat, p: hacA.pValue, ci: [hacA.ci95Low, hacA.ci95High], holm: holm[0] },
      B: { mean: hacB.meanDifference, se: hacB.standardError, t: hacB.tStat, p: hacB.pValue, ci: [hacB.ci95Low, hacB.ci95High], holm: holm[1] },
    },
    bootstrap: { A: bootA, B: bootB },
    sensitivity: { baseline: sensitivityBaseline, A: sensitivityA, B: sensitivityB },
    variant_comparison: { mae_a: aTest.mae, mae_b: bTest.mae, difference_b_minus_a: bTest.mae - aTest.mae, mean_a_minus_b: abDiff.meanDifference, p: abDiff.pValue, ci: [abDiff.ci95Low, abDiff.ci95High] },
    noise: { amplitude, A: { d: noiseA.dCalendarA, p95: noiseA.percentile95A, passed: noiseA.passedA }, B: { d: noiseB.dCalendarB, p95: noiseB.percentile95B, passed: noiseB.passedB } },
    duplication,
    artifacts: written,
  }, null, 2));
  return 0;
}

if (import.meta.main) process.exitCode = await main();