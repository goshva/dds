/**
 * Stage 3.4.7 — временная устойчивость и распределение ошибок Variant B против baseline.
 *
 * Запуск: bun src/forecasting/analytics/adaptive-baseline/stability.ts
 *
 * Диагностика на test-интервале Stage 3.4.5/3.4.6. Конфигурация не меняется,
 * новые гипотезы не тестируются, production-код и данные не изменяются.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { isoDayOfWeek } from "../calendar/calendar-core";
import { readCanonicalCsv } from "../expansion/history-builder";
import { buildPairs, FROZEN_CONFIG, metricsOf, percentileLinear, splitByDate, type Pair } from "./experiment";

const HORIZONS = [1, 3, 7, 14] as const;
const BLOCKS = 4;

export interface SliceStats {
  horizon: number;
  dimension: string;
  key: string;
  n: number;
  maeBaseline: number;
  maeCandidate: number;
  improvementAbs: number;
  improvementPercent: number;
  wapeBaseline: number;
  wapeCandidate: number;
  biasBaseline: number;
  biasCandidate: number;
  underforecastBaseline: number;
  overforecastBaseline: number;
  underforecastCandidate: number;
  overforecastCandidate: number;
  p90AbsBaseline: number;
  p90AbsCandidate: number;
  p95AbsBaseline: number;
  p95AbsCandidate: number;
}

function slice(horizon: number, dimension: string, key: string, pairs: readonly Pair[]): SliceStats {
  const baseline = metricsOf(pairs.map((pair) => ({ actual: pair.actual, forecast: pair.baseline })));
  const candidate = metricsOf(pairs.map((pair) => ({ actual: pair.actual, forecast: pair.variantB })));
  const absBaseline = pairs.map((pair) => Math.abs(pair.baseline - pair.actual));
  const absCandidate = pairs.map((pair) => Math.abs(pair.variantB - pair.actual));
  return {
    horizon,
    dimension,
    key,
    n: pairs.length,
    maeBaseline: baseline.mae,
    maeCandidate: candidate.mae,
    improvementAbs: baseline.mae - candidate.mae,
    improvementPercent: baseline.mae === 0 ? 0 : ((baseline.mae - candidate.mae) / baseline.mae) * 100,
    wapeBaseline: baseline.wape,
    wapeCandidate: candidate.wape,
    biasBaseline: baseline.bias,
    biasCandidate: candidate.bias,
    underforecastBaseline: pairs.filter((pair) => pair.baseline < pair.actual).length,
    overforecastBaseline: pairs.filter((pair) => pair.baseline > pair.actual).length,
    underforecastCandidate: pairs.filter((pair) => pair.variantB < pair.actual).length,
    overforecastCandidate: pairs.filter((pair) => pair.variantB > pair.actual).length,
    p90AbsBaseline: percentileLinear(absBaseline, 0.9),
    p90AbsCandidate: percentileLinear(absCandidate, 0.9),
    p95AbsBaseline: percentileLinear(absBaseline, 0.95),
    p95AbsCandidate: percentileLinear(absCandidate, 0.95),
  };
}

function blocks(pairs: readonly Pair[]): Pair[][] {
  const size = Math.floor(pairs.length / BLOCKS);
  const result: Pair[][] = [];
  for (let index = 0; index < BLOCKS; index++) {
    const start = index * size;
    const end = index === BLOCKS - 1 ? pairs.length : start + size;
    result.push(pairs.slice(start, end));
  }
  return result;
}

async function main(): Promise<number> {
  const rows = await readCanonicalCsv(resolve("data/processed/forecasting/7745/canonical_daily_delivered_orders.csv"));
  const checksum = new Bun.CryptoHasher("sha256").update(rows.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
  if (checksum !== FROZEN_CONFIG.datasetChecksum) {
    console.error(`[ОСТАНОВКА] checksum не совпал: ${checksum}`);
    return 2;
  }

  const temporal: SliceStats[] = [];
  const weekday: SliceStats[] = [];
  const monthly: SliceStats[] = [];
  const biasGroups: SliceStats[] = [];
  const perHorizon: Array<{ horizon: number; testPairs: number; maeBaseline: number; maeCandidate: number; improvementPercent: number; betterBlocks: number; totalBlocks: number; minBlockImprovement: number; maxBlockImprovement: number }> = [];

  for (const horizon of HORIZONS) {
    const pairs = buildPairs(rows, FROZEN_CONFIG.minTrainPrimary, horizon);
    const { test } = splitByDate(pairs);
    const blockSlices = blocks(test).map((block, index) => slice(horizon, "block", `block_${index + 1}`, block));
    temporal.push(...blockSlices);
    const overall = slice(horizon, "overall", "test", test);
    temporal.push(overall);

    const byDow = new Map<number, Pair[]>();
    const byMonth = new Map<string, Pair[]>();
    for (const pair of test) {
      byDow.set(isoDayOfWeek(pair.targetDate), [...(byDow.get(isoDayOfWeek(pair.targetDate)) ?? []), pair]);
      const month = pair.targetDate.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), pair]);
    }
    for (const [dow, list] of [...byDow.entries()].sort((a, b) => a[0] - b[0])) weekday.push(slice(horizon, "weekday", String(dow), list));
    for (const [month, list] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) monthly.push(slice(horizon, "month", month, list));
    biasGroups.push(slice(horizon, "bias_sign", "baseline_overforecast", test.filter((pair) => pair.baseline > pair.actual)));
    biasGroups.push(slice(horizon, "bias_sign", "baseline_underforecast", test.filter((pair) => pair.baseline < pair.actual)));

    const blockImprovements = blockSlices.map((entry) => entry.improvementPercent);
    perHorizon.push({
      horizon,
      testPairs: test.length,
      maeBaseline: overall.maeBaseline,
      maeCandidate: overall.maeCandidate,
      improvementPercent: overall.improvementPercent,
      betterBlocks: blockSlices.filter((entry) => entry.improvementAbs > 0).length,
      totalBlocks: blockSlices.length,
      minBlockImprovement: Math.min(...blockImprovements),
      maxBlockImprovement: Math.max(...blockImprovements),
    });
  }

  const outDir = resolve("reports/forecasting/stage-3.4.7");
  await mkdir(outDir, { recursive: true });
  const toCsv = (headers: string[], body: Array<Array<unknown>>) => [headers.join(","), ...body.map((row) => row.map((cell) => String(cell)).join(","))].join("\n") + "\n";
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(outDir, name), content);
    written.push(name);
  };
  const statFields = ["horizon", "dimension", "key", "n", "mae_baseline", "mae_candidate", "improvement_abs", "improvement_percent", "wape_baseline", "wape_candidate", "bias_baseline", "bias_candidate", "under_baseline", "over_baseline", "under_candidate", "over_candidate", "p90_baseline", "p90_candidate", "p95_baseline", "p95_candidate"];
  const statRow = (entry: SliceStats) => [entry.horizon, entry.dimension, entry.key, entry.n, entry.maeBaseline, entry.maeCandidate, entry.improvementAbs, entry.improvementPercent, entry.wapeBaseline, entry.wapeCandidate, entry.biasBaseline, entry.biasCandidate, entry.underforecastBaseline, entry.overforecastBaseline, entry.underforecastCandidate, entry.overforecastCandidate, entry.p90AbsBaseline, entry.p90AbsCandidate, entry.p95AbsBaseline, entry.p95AbsCandidate];

  await write("temporal-stability.csv", toCsv(statFields, temporal.map(statRow)));
  await write("weekday-stability.csv", toCsv(statFields, weekday.map(statRow)));
  await write("error-distribution.csv", toCsv(["dimension", ...statFields.slice(3)], [...monthly, ...biasGroups].map((entry) => [entry.dimension, ...statRow(entry).slice(3)])));
  await write("stability-summary.json", `${JSON.stringify({ dataset_checksum: checksum, horizons: HORIZONS, per_horizon: perHorizon, temporal, weekday, monthly, bias_groups: biasGroups }, null, 2)}\n`);

  console.log(JSON.stringify({
    dataset_checksum: checksum,
    per_horizon: perHorizon,
    temporal: temporal.filter((entry) => entry.dimension === "block").map((entry) => ({ horizon: entry.horizon, block: entry.key, n: entry.n, improvement_percent: entry.improvementPercent, mae_baseline: entry.maeBaseline, mae_candidate: entry.maeCandidate })),
    weekday_h7: weekday.filter((entry) => entry.horizon === 7).map((entry) => ({ dow: entry.key, n: entry.n, improvement_percent: entry.improvementPercent })),
    month_h7: monthly.filter((entry) => entry.horizon === 7).map((entry) => ({ month: entry.key, n: entry.n, improvement_percent: entry.improvementPercent })),
    bias_h7: biasGroups.filter((entry) => entry.horizon === 7).map((entry) => ({ group: entry.key, n: entry.n, improvement_percent: entry.improvementPercent })),
    artifacts: written,
  }, null, 2));
  return 0;
}

if (import.meta.main) process.exitCode = await main();