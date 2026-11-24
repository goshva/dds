#!/usr/bin/env bun
/**
 * CLI Stage 3.3.4–3.3.5: baseline-модели и rolling-origin backtesting.
 *
 *   bun run forecast:backtest [--dataset <canonical.csv>] [--out <dir>] [--now <ISO>]
 *                             [--horizons 1,3,7,14] [--min-train 28,21]
 *
 * Источник — canonical CSV (SQLite не используется и не изменяется).
 * Коды возврата: 0 — проверки пройдены, 1 — есть ограничения, 2 — утечка данных или сбой проверок.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runBacktest, verifyMetricsAgainstRecords } from "../analytics/backtesting/rolling-origin";
import { baselineModelsMarkdown, writeBacktestArtifacts } from "../analytics/backtesting/reports";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

interface Args {
  dataset: string;
  out: string;
  now: string;
  horizons: number[];
  minTrain: number[];
  shop: string;
  metric: string;
  slice: number;
}

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.3";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dataset: DEFAULT_DATASET,
    out: DEFAULT_OUT,
    now: new Date().toISOString(),
    horizons: [1, 3, 7, 14],
    minTrain: [28, 21],
    shop: "7745",
    metric: "qty_orders_delivered",
    slice: 20624,
  };
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`не задано значение для ${current}`);
      return value;
    };
    switch (current) {
      case "--dataset": args.dataset = next(); break;
      case "--out": args.out = next(); break;
      case "--now": args.now = next(); break;
      case "--shop": args.shop = next(); break;
      case "--metric": args.metric = next(); break;
      case "--slice": args.slice = Number(next()); break;
      case "--horizons": args.horizons = next().split(",").map(Number); break;
      case "--min-train": args.minTrain = next().split(",").map(Number); break;
      default: throw new Error(`неизвестный параметр: ${current}`);
    }
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 3;
  }

  try {
    const history = await readCanonicalCsv(resolve(args.dataset));
    if (!history.length) throw new Error(`набор ${args.dataset} пуст`);
    const datasetChecksum = new Bun.CryptoHasher("sha256")
      .update(history.map((point) => `${point.date}\t${point.value}`).join("\n"))
      .digest("hex");

    const options = {
      shopNo: args.shop,
      metric: args.metric,
      sliceId: args.slice,
      history,
      datasetChecksum,
      horizons: args.horizons,
      minTrainDays: args.minTrain,
      generatedAt: args.now,
    };

    const first = runBacktest(options);
    const second = runBacktest(options);
    const verification = verifyMetricsAgainstRecords(first);

    // Сохраняем предыдущую версию отчётов перед перезаписью (требование Stage 3.3.6)
    const outDir = resolve(args.out);
    const archiveDir = join(outDir, "archive", "pre-3.3.6");
    await mkdir(archiveDir, { recursive: true });
    for (const name of ["3.3.5-backtesting-report.md", "3.3.5-model-comparison.csv", "3.3.5-fold-summary.csv", "3.3.5-data-coverage.csv"]) {
      const source = join(outDir, name);
      const target = join(archiveDir, name);
      if (await exists(source) && !(await exists(target))) await copyFile(source, target);
    }

    const artifacts = await writeBacktestArtifacts({
      outDir,
      result: first,
      secondRunChecksum: second.reproducibility.checksum,
      baselineModelsMarkdown: baselineModelsMarkdown(),
    });

    const bestPerHorizon = first.horizons.map((horizon) => {
      const primaryTrain = first.minTrainDays[0]!;
      const rows = first.commonStepMetrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === primaryTrain && row.mae !== null);
      const notAvailable = first.notAvailable.filter((entry) => entry.horizonDays === horizon && entry.minTrainDays === primaryTrain);
      if (!rows.length) return { horizon, mode: "step-exact", best: null, evaluated: 0, spread: null, not_available: notAvailable.map((entry) => entry.model) };
      const sorted = [...rows].sort((a, b) => (a.mae as number) - (b.mae as number));
      return {
        horizon,
        mode: "step-exact",
        best: sorted[0]!.model,
        evaluated: sorted[0]!.evaluated,
        spread: Math.abs((sorted.at(-1)!.mae as number) - (sorted[0]!.mae as number)),
        not_available: notAvailable.map((entry) => entry.model),
        by_model: rows.map((row) => ({ model: row.model, mae: row.mae, rmse: row.rmse, wape: row.wape, bias: row.bias, n: row.evaluated })),
      };
    });

    console.log(JSON.stringify({
      dataset: resolve(args.dataset),
      dataset_checksum: datasetChecksum,
      points: history.length,
      period: first.period,
      horizons: first.horizons,
      min_train_days: first.minTrainDays,
      coverage: first.coverage,
      best_per_horizon: bestPerHorizon,
      leakage: { passed: first.leakage.passed, violations: first.leakage.violations.length, checked: first.leakage.checked },
      reproducibility: {
        records_checksum: first.reproducibility.checksum,
        second_run_identical: first.reproducibility.checksum === second.reproducibility.checksum,
        metrics_recalculation_ok: verification.ok,
        mismatches: verification.mismatches.length,
      },
      artifacts,
    }, null, 2));

    if (!first.leakage.passed || !verification.ok) return 2;
    return first.records.length ? 0 : 1;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
