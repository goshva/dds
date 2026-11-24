/**
 * Stage 3.4.6 — multi-horizon validation адаптивного baseline.
 *
 * Запуск: bun src/forecasting/analytics/adaptive-baseline/multi-horizon.ts
 *
 * Для h = 1, 3, 7, 14 сравнивает rolling_7_day_mean, Variant A и Variant B
 * на одинаковых парах (origin, target), считает HAC p-values и Holm (2 сравнения
 * внутри горизонта + семейная поправка по 8 сравнениям для справки).
 * Данные и production-код не изменяет.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildPairs, FROZEN_CONFIG, hacTest, holmAdjusted, metricsOf, splitByDate, type Pair } from "./experiment";
import { readCanonicalCsv } from "../expansion/history-builder";

const HORIZONS = [1, 3, 7, 14] as const;
const MIN_TRAINS = [28, 21] as const;

interface HorizonRow {
  horizon: number;
  minTrain: number;
  model: "baseline" | "A" | "B";
  n: number;
  mae: number;
  wape: number;
  bias: number;
}

interface HorizonStats {
  horizon: number;
  minTrain: number;
  n: number;
  rows: HorizonRow[];
  paired: {
    A: { mean: number; p: number; ci: [number, number]; holm: number };
    B: { mean: number; p: number; ci: [number, number]; holm: number };
  };
}

function horizonsFor(minTrain: number): HorizonStats[] {
  return HORIZONS.map((horizon) => {
    const pairs = buildPairs(resolveRows, minTrain, horizon);
    const { test } = splitByDate(pairs);
    const model = (pick: (pair: Pair) => number) => metricsOf(test.map((pair) => ({ actual: pair.actual, forecast: pick(pair) })));
    const baseline = model((pair) => pair.baseline);
    const a = model((pair) => pair.variantA);
    const b = model((pair) => pair.variantB);
    const diffsA = test.map((pair) => Math.abs(pair.baseline - pair.actual) - Math.abs(pair.variantA - pair.actual));
    const diffsB = test.map((pair) => Math.abs(pair.baseline - pair.actual) - Math.abs(pair.variantB - pair.actual));
    const hacA = hacTest(diffsA, horizon);
    const hacB = hacTest(diffsB, horizon);
    const holm = holmAdjusted([hacA.pValue, hacB.pValue]);
    return {
      horizon,
      minTrain,
      n: test.length,
      rows: [
        { horizon, minTrain, model: "baseline", n: baseline.n, mae: baseline.mae, wape: baseline.wape, bias: baseline.bias },
        { horizon, minTrain, model: "A", n: a.n, mae: a.mae, wape: a.wape, bias: a.bias },
        { horizon, minTrain, model: "B", n: b.n, mae: b.mae, wape: b.wape, bias: b.bias },
      ],
      paired: {
        A: { mean: hacA.meanDifference, p: hacA.pValue, ci: [hacA.ci95Low, hacA.ci95High], holm: holm[0]! },
        B: { mean: hacB.meanDifference, p: hacB.pValue, ci: [hacB.ci95Low, hacB.ci95High], holm: holm[1]! },
      },
    };
  });
}

let resolveRows: Awaited<ReturnType<typeof readCanonicalCsv>> = [];

async function main(): Promise<number> {
  resolveRows = await readCanonicalCsv(resolve("data/processed/forecasting/7745/canonical_daily_delivered_orders.csv"));
  const checksum = new Bun.CryptoHasher("sha256").update(resolveRows.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
  if (checksum !== FROZEN_CONFIG.datasetChecksum) {
    console.error(`[ОСТАНОВКА] checksum набора не совпал: ${checksum}`);
    return 2;
  }

  const results: HorizonStats[] = [];
  for (const minTrain of MIN_TRAINS) results.push(...horizonsFor(minTrain));

  // семейная Holm по 8 основным сравнениям (4 горизонта × 2 варианта, min_train=28)
  const primary = results.filter((entry) => entry.minTrain === 28);
  const familyP = primary.flatMap((entry) => [entry.paired.A.p, entry.paired.B.p]);
  const familyHolm = holmAdjusted(familyP);
  const family = primary.flatMap((entry, index) => [
    { horizon: entry.horizon, variant: "A", p_raw: entry.paired.A.p, p_family_holm: familyHolm[index * 2]! },
    { horizon: entry.horizon, variant: "B", p_raw: entry.paired.B.p, p_family_holm: familyHolm[index * 2 + 1]! },
  ]);

  const outDir = resolve("reports/forecasting/stage-3.4.6");
  await mkdir(outDir, { recursive: true });
  const toCsv = (headers: string[], body: Array<Array<unknown>>) => [headers.join(","), ...body.map((row) => row.map((cell) => String(cell)).join(","))].join("\n") + "\n";

  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(outDir, name), content);
    written.push(name);
  };
  await write("multi-horizon-metrics.csv", toCsv(
    ["horizon", "min_train", "model", "n", "MAE", "WAPE", "Bias"],
    results.flatMap((entry) => entry.rows.map((row) => [row.horizon, row.minTrain, row.model, row.n, row.mae, row.wape, row.bias])),
  ));
  await write("multi-horizon-paired.csv", toCsv(
    ["horizon", "min_train", "variant", "mean_difference", "p_hac", "ci95_low", "ci95_high", "p_holm"],
    results.flatMap((entry) => [
      [entry.horizon, entry.minTrain, "A", entry.paired.A.mean, entry.paired.A.p, entry.paired.A.ci[0], entry.paired.A.ci[1], entry.paired.A.holm],
      [entry.horizon, entry.minTrain, "B", entry.paired.B.mean, entry.paired.B.p, entry.paired.B.ci[0], entry.paired.B.ci[1], entry.paired.B.holm],
    ]),
  ));
  await write("multi-horizon-results.json", `${JSON.stringify({
    dataset_checksum: checksum,
    frozen: { alpha: FROZEN_CONFIG.alpha, limitPercent: FROZEN_CONFIG.limitPercent, splitPercent: FROZEN_CONFIG.originSplitPercent, hacLag: "horizon" },
    horizons: HORIZONS,
    min_trains: MIN_TRAINS,
    results,
    family_holm_primary: family,
    note: "min_train=28 — основной, min_train=21 — sensitivity",
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    dataset_checksum: checksum,
    primary_min_train: 28,
    results: results
      .filter((entry) => entry.minTrain === 28)
      .map((entry) => ({
        horizon: entry.horizon,
        n: entry.n,
        baseline_mae: entry.rows.find((row) => row.model === "baseline")!.mae,
        a_mae: entry.rows.find((row) => row.model === "A")!.mae,
        b_mae: entry.rows.find((row) => row.model === "B")!.mae,
        a_improvement_percent: ((entry.rows.find((row) => row.model === "baseline")!.mae - entry.rows.find((row) => row.model === "A")!.mae) / entry.rows.find((row) => row.model === "baseline")!.mae) * 100,
        b_improvement_percent: ((entry.rows.find((row) => row.model === "baseline")!.mae - entry.rows.find((row) => row.model === "B")!.mae) / entry.rows.find((row) => row.model === "baseline")!.mae) * 100,
        a_holm: entry.paired.A.holm,
        b_holm: entry.paired.B.holm,
        a_ci: entry.paired.A.ci,
        b_ci: entry.paired.B.ci,
      })),
    sensitivity: results
      .filter((entry) => entry.minTrain === 21)
      .map((entry) => ({
        horizon: entry.horizon,
        n: entry.n,
        baseline_mae: entry.rows.find((row) => row.model === "baseline")!.mae,
        a_mae: entry.rows.find((row) => row.model === "A")!.mae,
        b_mae: entry.rows.find((row) => row.model === "B")!.mae,
        a_holm: entry.paired.A.holm,
        b_holm: entry.paired.B.holm,
      })),
    family_holm: family,
    artifacts: written,
  }, null, 2));
  return 0;
}

if (import.meta.main) process.exitCode = await main();