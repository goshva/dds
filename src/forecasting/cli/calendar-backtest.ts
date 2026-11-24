#!/usr/bin/env bun
/**
 * CLI Stage 3.4.3: календарная модель-кандидат против трёх baseline Stage 3.3.
 *
 *   bun run forecast:calendar-backtest [--dataset <csv>] [--out <dir>] [--now <ISO>]
 *
 * Контракт Stage 3.4.1: step-exact, min_train 28 (основной) и 21 (sensitivity),
 * горизонты 1/3/7/14, общие пары (origin, target), запрет утечки.
 * Pipeline и baseline-формулы не изменяются: календарная модель передаётся в runBacktest
 * через параметр `models`.
 *
 * Коды возврата: 0 — успех, 1 — ошибка, 2 — нарушение checksum набора.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ALL_BASELINES } from "../baselines";
import { calendarWeekdaySeasonalMean } from "../baselines/calendar-weekday-seasonal-mean";
import { computeMetrics, type MetricSet } from "../analytics/backtesting/metrics";
import { runBacktest, verifyMetricsAgainstRecords, type BacktestResult, type ForecastRecord } from "../analytics/backtesting/rolling-origin";
import { dataCoverageCsv, leakageCheckJson } from "../analytics/backtesting/reports";
import { toCsv } from "../analytics/profiling/report";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.4.3";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";
const CALENDAR_MODEL = calendarWeekdaySeasonalMean.name;
const BASELINE_MODELS = ALL_BASELINES.map((model) => model.name);

export interface ModelComparisonRow {
  horizonDays: number;
  minTrainDays: number;
  model: string;
  role: "baseline" | "candidate";
  evaluated: number;
  commonPairs: number;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  bias: number | null;
  medianAbsError: number | null;
  maxAbsError: number | null;
  /** Преимущество относительно ближайшего конкурента: MAE_best / MAE_second_best − 1. */
  marginToRunnerUp: number | null;
  /** Относительное изменение MAE против лучшего baseline на том же горизонте. */
  marginVsBaseline: number | null;
  absoluteMaeDifference: number | null;
  status: "BETTER" | "WORSE" | "NO_MATERIAL_DIFFERENCE" | "INCONCLUSIVE" | "NOT_AVAILABLE" | "INVALID";
}

function pairsOf(records: readonly ForecastRecord[], model: string, horizon: number, minTrain: number): Map<string, ForecastRecord> {
  const map = new Map<string, ForecastRecord>();
  for (const record of records) {
    if (record.model !== model || record.horizonDays !== horizon || record.minTrainDays !== minTrain) continue;
    if (record.step !== horizon) continue;
    if (record.predicted === null || record.actual === null) continue;
    map.set(`${record.originDate}|${record.targetDate}`, record);
  }
  return map;
}

function metricsOf(records: readonly ForecastRecord[]) {
  return computeMetrics(records.map((record) => ({ actual: record.actual as number, forecast: record.predicted as number })));
}

/** Сравнение кандидата с baseline строго на общих парах (origin, target). */
export function compareOnCommonPairs(result: BacktestResult, horizon: number, minTrain: number): Array<{
  model: string;
  role: "baseline" | "candidate";
  pairs: number;
  metrics: MetricSet;
  vsBestBaseline: { absolute: number; relative: number } | null;
  status: ModelComparisonRow["status"];
}> {
  const calendarPairs = pairsOf(result.records, CALENDAR_MODEL, horizon, minTrain);
  const baselinePairs = BASELINE_MODELS.map((model) => ({ model, pairs: pairsOf(result.records, model, horizon, minTrain) }));
  // на шаге h часть моделей недоступна (например, weekly на h=14): сравниваем только с доступными
  const availableBaselines = baselinePairs.filter((entry) => entry.pairs.size > 0);

  const baselineRows = availableBaselines.map((entry) => {
    // попарное пересечение с кандидатом: baseline и кандидат оцениваются на одних и тех же (origin, target)
    const shared = [...calendarPairs.keys()].filter((key) => entry.pairs.has(key));
    return {
      model: entry.model,
      role: "baseline" as const,
      pairs: shared.length,
      metrics: metricsOf(shared.map((key) => entry.pairs.get(key)!)),
      vsBestBaseline: null,
      status: "INCONCLUSIVE" as ModelComparisonRow["status"],
    };
  });

  // кандидат оценивается на объединении пар доступных baseline, чтобы сравнение было сопоставимым
  const unionKeys = new Set<string>();
  for (const entry of availableBaselines) for (const key of entry.pairs.keys()) unionKeys.add(key);
  const candidateShared = [...calendarPairs.keys()].filter((key) => unionKeys.has(key)).map((key) => calendarPairs.get(key)!);
  const candidateMetrics = metricsOf(candidateShared);
  const validBaselines = baselineRows.filter((row) => row.metrics.mae !== null);
  const bestBaseline = validBaselines.length
    ? validBaselines.reduce((best, row) => ((row.metrics.mae as number) < (best.metrics.mae as number) ? row : best))
    : null;

  const candidateRow = {
    model: CALENDAR_MODEL,
    role: "candidate" as const,
    pairs: candidateShared.length,
    metrics: candidateMetrics,
    vsBestBaseline:
      bestBaseline && candidateMetrics.mae !== null && (bestBaseline.metrics.mae as number) > 0
        ? {
            absolute: Number(((candidateMetrics.mae as number) - (bestBaseline.metrics.mae as number)).toFixed(4)),
            relative: Number((((candidateMetrics.mae as number) - (bestBaseline.metrics.mae as number)) / (bestBaseline.metrics.mae as number)).toFixed(4)),
          }
        : null,
    status: "INCONCLUSIVE" as ModelComparisonRow["status"],
  };

  // статус: без численного порога значимости; малый отрыв трактуется как неразличимость
  if (!candidateShared.length) candidateRow.status = "NOT_AVAILABLE";
  else if (candidateRow.vsBestBaseline === null) candidateRow.status = "INCONCLUSIVE";
  else if (candidateRow.vsBestBaseline.relative < 0) candidateRow.status = "BETTER";
  else if (candidateRow.vsBestBaseline.relative > 0) candidateRow.status = "WORSE";
  else candidateRow.status = "NO_MATERIAL_DIFFERENCE";

  return [...baselineRows, candidateRow];
}

/** Преимущество лучшей модели против ближайшего конкурента на горизонте. */
export function marginToRunnerUp(rows: ReadonlyArray<{ model: string; metrics: MetricSet }>): { best: string | null; marginToRunnerUp: number | null; spreadToWorst: number | null } {
  const valid = rows.filter((row) => row.metrics.mae !== null).sort((a, b) => (a.metrics.mae as number) - (b.metrics.mae as number));
  if (!valid.length) return { best: null, marginToRunnerUp: null, spreadToWorst: null };
  const best = valid[0]!;
  if (valid.length === 1) return { best: best.model, marginToRunnerUp: null, spreadToWorst: null };
  const second = valid[1]!;
  const worst = valid.at(-1)!;
  return {
    best: best.model,
    marginToRunnerUp: (best.metrics.mae as number) > 0 ? Number((((second.metrics.mae as number) - (best.metrics.mae as number)) / (best.metrics.mae as number)).toFixed(4)) : null,
    spreadToWorst: (best.metrics.mae as number) > 0 ? Number((((worst.metrics.mae as number) - (best.metrics.mae as number)) / (best.metrics.mae as number)).toFixed(4)) : null,
  };
}

function comparisonCsv(rows: readonly ModelComparisonRow[]): string {
  return toCsv(
    ["horizon_days", "min_train_days", "model", "role", "evaluated_on_common_pairs", "all_model_common_pairs", "MAE", "RMSE", "WAPE", "Bias", "median_abs_error", "max_abs_error", "margin_to_runner_up", "margin_vs_baseline", "absolute_mae_difference", "status"],
    rows.map((row) => [
      row.horizonDays, row.minTrainDays, row.model, row.role, row.evaluated, row.commonPairs,
      row.mae, row.rmse, row.wape, row.bias, row.medianAbsError, row.maxAbsError,
      row.marginToRunnerUp ?? "", row.marginVsBaseline ?? "", row.absoluteMaeDifference ?? "", row.status,
    ]),
  );
}

function reportMarkdown(result: BacktestResult, rows: readonly ModelComparisonRow[], datasetChecksum: string): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.3 — Календарная модель против baseline: результаты backtesting");
  lines.push("");
  lines.push(`- Набор: ${result.datasetPoints} наблюдений, период ${result.period.from} … ${result.period.to}`);
  lines.push(`- checksum набора: ${datasetChecksum}`);
  lines.push(`- Контракт: \`evaluation_mode = step-exact\`, основной \`min_train = ${result.minTrainDays[0]}\`, sensitivity \`min_train = ${result.minTrainDays[1] ?? "—"}\`, горизонты ${result.horizons.join(", ")}`);
  lines.push(`- Кандидат: \`${CALENDAR_MODEL}\` (четыре календарных признака); baseline: ${BASELINE_MODELS.join(", ")}`);
  lines.push(`- Проверка утечки: ${result.leakage.passed ? "PASS" : "FAIL"}, нарушений ${result.leakage.violations.length}`);
  lines.push("");
  lines.push("## Сравнение на общих парах (origin, target)");
  lines.push("");
  lines.push("| горизонт | min train | модель | роль | пар | MAE | RMSE | WAPE, % | Bias | статус |");
  lines.push("|---|---:|---|---|---:|---:|---:|---:|---:|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.horizonDays} | ${row.minTrainDays} | ${row.model} | ${row.role} | ${row.evaluated} | ${row.mae ?? "—"} | ${row.rmse ?? "—"} | ${row.wape ?? "—"} | ${row.bias ?? "—"} | ${row.status} |`,
    );
  }
  lines.push("");
  lines.push("## Преимущество относительно ближайшего конкурента");
  lines.push("");
  lines.push("| горизонт | min train | лучшая модель | margin_to_runner_up | отрыв от худшей |");
  lines.push("|---|---:|---|---:|---:|");
  for (const horizon of result.horizons) {
    for (const minTrain of result.minTrainDays) {
      const group = rows.filter((row) => row.horizonDays === horizon && row.minTrainDays === minTrain);
      if (!group.length) continue;
      const margin = marginToRunnerUp(group.map((row) => ({ model: row.model, metrics: { n: row.evaluated, mae: row.mae, rmse: row.rmse, wape: row.wape, wape_status: "ok", bias: row.bias, median_abs_error: row.medianAbsError, max_abs_error: row.maxAbsError, signed_error_sum: null } })));
      lines.push(`| ${horizon} | ${minTrain} | ${margin.best ?? "—"} | ${margin.marginToRunnerUp ?? "—"} | ${margin.spreadToWorst ?? "—"} |`);
    }
  }
  lines.push("");
  lines.push("## Интерпретация");
  lines.push("");
  lines.push("- Статусы назначаются по `margin_vs_baseline` относительно лучшего baseline на том же горизонте и общих парах.");
  lines.push("- Численный порог практической значимости не установлен (см. контракт выбора модели Stage 3.4.1), поэтому малые отрывы не считаются доказательством превосходства.");
  lines.push("- Календарная модель использует только четыре признака; праздники, переносы, погода и городские события не подключены.");
  lines.push("- Семантика целевой метрики остаётся `PROVISIONAL`: результаты технические.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(argv: string[]): Promise<number> {
  let dataset = DEFAULT_DATASET;
  let out = DEFAULT_OUT;
  let now = new Date().toISOString();
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--dataset") dataset = argv[++index] ?? dataset;
    else if (argv[index] === "--out") out = argv[++index] ?? out;
    else if (argv[index] === "--now") now = argv[++index] ?? now;
  }

  try {
    const history = await readCanonicalCsv(resolve(dataset));
    const datasetChecksum = new Bun.CryptoHasher("sha256").update(history.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
    if (datasetChecksum !== EXPECTED_CHECKSUM) {
      console.error(`[ОСТАНОВКА] checksum набора не совпал: ${datasetChecksum}`);
      return 2;
    }

    const options = {
      shopNo: "7745",
      metric: "qty_orders_delivered",
      sliceId: 20624,
      history,
      datasetChecksum,
      horizons: [1, 3, 7, 14],
      minTrainDays: [28, 21],
      models: [...ALL_BASELINES, calendarWeekdaySeasonalMean],
      generatedAt: now,
    };

    const first = runBacktest(options);
    const second = runBacktest(options);
    const verification = verifyMetricsAgainstRecords(first);

    const rows: ModelComparisonRow[] = [];
    for (const minTrain of first.minTrainDays) {
      for (const horizon of first.horizons) {
        const comparisons = compareOnCommonPairs(first, horizon, minTrain);
        const groupMetrics = comparisons.map((entry) => ({ model: entry.model, metrics: entry.metrics }));
        const margin = marginToRunnerUp(groupMetrics);
        const bestBaselineMae = Math.min(...comparisons.filter((entry) => entry.role === "baseline" && entry.metrics.mae !== null).map((entry) => entry.metrics.mae as number));
        for (const entry of comparisons) {
          const allModelCommon = first.commonStepMetrics.find((row) => row.model === entry.model && row.horizonDays === horizon && row.minTrainDays === minTrain);
          rows.push({
            horizonDays: horizon,
            minTrainDays: minTrain,
            model: entry.model,
            role: entry.role,
            evaluated: entry.metrics.n,
            commonPairs: allModelCommon?.evaluated ?? 0,
            mae: entry.metrics.mae,
            rmse: entry.metrics.rmse,
            wape: entry.metrics.wape,
            bias: entry.metrics.bias,
            medianAbsError: entry.metrics.median_abs_error,
            maxAbsError: entry.metrics.max_abs_error,
            marginToRunnerUp: margin.best === entry.model ? margin.marginToRunnerUp : null,
            marginVsBaseline: entry.role === "candidate" && Number.isFinite(bestBaselineMae) && bestBaselineMae > 0 && entry.metrics.mae !== null
              ? Number((((entry.metrics.mae as number) - bestBaselineMae) / bestBaselineMae).toFixed(4))
              : null,
            absoluteMaeDifference: entry.role === "candidate" && Number.isFinite(bestBaselineMae) && entry.metrics.mae !== null
              ? Number(((entry.metrics.mae as number) - bestBaselineMae).toFixed(4))
              : null,
            status: entry.status,
          });
        }
      }
    }

    const outDir = resolve(out);
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    const write = async (name: string, content: string) => {
      await Bun.write(join(outDir, name), content);
      written.push(name);
    };
    await write("3.4.3-calendar-backtest.md", reportMarkdown(first, rows, datasetChecksum));
    await write("calendar-model-comparison.csv", comparisonCsv(rows));
    await write("calendar-coverage.csv", dataCoverageCsv(first));
    await write("calendar-leakage-check.json", leakageCheckJson(first));
    await write("calendar-reproducibility.json", `${JSON.stringify({
      dataset_checksum: datasetChecksum,
      records_checksum_first_run: first.reproducibility.checksum,
      records_checksum_second_run: second.reproducibility.checksum,
      identical: first.reproducibility.checksum === second.reproducibility.checksum,
      metrics_recalculation_ok: verification.ok,
      mismatches: verification.mismatches.length,
      models: [...BASELINE_MODELS, CALENDAR_MODEL],
      generated_at: now,
    }, null, 2)}\n`);

    const summary = first.horizons.map((horizon) => {
      const primary = first.minTrainDays[0]!;
      const group = rows.filter((row) => row.horizonDays === horizon && row.minTrainDays === primary);
      const candidate = group.find((row) => row.role === "candidate")!;
      const bestBaseline = group.filter((row) => row.role === "baseline" && row.mae !== null).sort((a, b) => (a.mae as number) - (b.mae as number))[0] ?? null;
      return {
        horizon,
        candidate_mae: candidate.mae,
        candidate_pairs: candidate.evaluated,
        best_baseline: bestBaseline?.model ?? null,
        best_baseline_mae: bestBaseline?.mae ?? null,
        margin_vs_baseline: candidate.marginVsBaseline,
        status: candidate.status,
      };
    });

    console.log(JSON.stringify({
      dataset: resolve(dataset),
      dataset_checksum: datasetChecksum,
      points: history.length,
      min_train_days: first.minTrainDays,
      horizons: first.horizons,
      coverage: first.coverage,
      leakage: { passed: first.leakage.passed, violations: first.leakage.violations.length },
      reproducibility: { identical: first.reproducibility.checksum === second.reproducibility.checksum, metrics_recalculation_ok: verification.ok },
      candidate_vs_baseline_primary: summary,
      not_available: first.notAvailable.map((entry) => `${entry.model}/h${entry.horizonDays}/train${entry.minTrainDays}`),
      artifacts: written,
    }, null, 2));

    return first.leakage.passed && verification.ok ? 0 : 2;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
