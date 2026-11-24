#!/usr/bin/env bun
/**
 * CLI Stage 3.4.4: диагностика ряда и ошибок baseline (исследовательский этап).
 *
 *   bun run forecast:diagnostics [--dataset <csv>] [--out <dir>] [--now <ISO>]
 *
 * Только чтение: канонический CSV, SQLite и baseline-модели не изменяются.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { analyzeLevelDynamics, latestLevelSnapshot } from "../analytics/diagnostics/level-dynamics";
import { toCsv } from "../analytics/profiling/report";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.4.4";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";

function markdown(dynamics: ReturnType<typeof analyzeLevelDynamics>, snapshot: ReturnType<typeof latestLevelSnapshot>, generatedAt: string): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.4 — Динамика уровня спроса (исследование)");
  lines.push("");
  lines.push(`- Наблюдений: ${dynamics.observations}; период: ${dynamics.period.from} … ${dynamics.period.to}; сформировано: ${generatedAt}`);
  lines.push(`- Ряд: среднее ${dynamics.overall.mean}, медиана ${dynamics.overall.median}, σ ${dynamics.overall.stdev}, CV ${dynamics.overall.cv}, min ${dynamics.overall.min}, max ${dynamics.overall.max}`);
  lines.push("");
  lines.push("## Устойчивость окон");
  lines.push("");
  lines.push("| окно | среднее окон | σ оконных средних | CV | худшее дневное изменение среднего, % |");
  lines.push("|---:|---:|---:|---:|---:|");
  for (const entry of dynamics.stability) {
    lines.push(`| ${entry.window} | ${entry.meanOfWindowMeans} | ${entry.stdevOfWindowMeans} | ${entry.cv} | ${entry.worstChangePercent} |`);
  }
  lines.push("");
  lines.push("## Последний срез уровня");
  lines.push("");
  lines.push("| окно | средний уровень | тренд за окно, % | R² тренда | последнее дневное изменение, % |");
  lines.push("|---:|---:|---:|---:|---:|");
  for (const entry of snapshot) {
    lines.push(`| ${entry.window} | ${entry.lastMean} | ${entry.lastTrendPercent} | ${entry.lastR2} | ${entry.lastChangePercent} |`);
  }
  lines.push("");
  lines.push("## Режимы изменения среднего");
  lines.push("");
  lines.push(`- порог «плоско»: ${dynamics.regimeSummary.flatThresholdPercent}% за день`);
  lines.push(`- рост: ${dynamics.regimeSummary.up}; снижение: ${dynamics.regimeSummary.down}; плоско: ${dynamics.regimeSummary.flat}`);
  lines.push("");
  lines.push("## Интерпретация (предварительно)");
  lines.push("");
  lines.push("- Высокий CV оконных средних означает, что уровень спроса заметно меняется во времени: статичный профиль (как в отклонённой календарной модели) не может следовать за уровнем.");
  lines.push("- Значимый локальный тренд (|тренд| > 5% и R² > 0,5) указывает на участки, где адаптивность важнее точности профиля.");
  lines.push("- Причинность не устанавливается; выводы описывают структуру ряда.");
  lines.push("");
  lines.push("_Разделы об ошибках baseline, остатках и потенциале коррекции — в следующих документах этапа._");
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
    const rows = await readCanonicalCsv(resolve(dataset));
    const checksum = new Bun.CryptoHasher("sha256").update(rows.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
    if (checksum !== EXPECTED_CHECKSUM) {
      console.error(`[ОСТАНОВКА] checksum набора не совпал: ${checksum}`);
      return 2;
    }

    const dynamics = analyzeLevelDynamics(rows);
    const snapshot = latestLevelSnapshot(dynamics);
    const outDir = resolve(out);
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    const write = async (name: string, content: string) => {
      await Bun.write(join(outDir, name), content);
      written.push(name);
    };

    await write("3.4.4-level-dynamics.md", markdown(dynamics, snapshot, now));
    await write("level-dynamics.json", `${JSON.stringify({ dataset_checksum: checksum, generated_at: now, overall: dynamics.overall, stability: dynamics.stability, regime_summary: dynamics.regimeSummary, snapshot, notes: dynamics.notes }, null, 2)}\n`);
    await write("level-rolling.csv", toCsv(
      ["date", "window", "mean", "stdev", "cv", "min", "max"],
      dynamics.rolling.map((entry) => [entry.date, entry.window, entry.mean, entry.stdev, entry.cv, entry.min, entry.max]),
    ));
    await write("level-trends.csv", toCsv(
      ["end_date", "window", "slope", "slope_total", "slope_percent", "r2"],
      dynamics.trends.map((entry) => [entry.endDate, entry.window, entry.slope, entry.slopeTotal, entry.slopePercent, entry.r2]),
    ));

    console.log(JSON.stringify({
      dataset_checksum: checksum,
      observations: dynamics.observations,
      period: dynamics.period,
      overall: dynamics.overall,
      stability: dynamics.stability,
      snapshot,
      regimes: dynamics.regimeSummary,
      artifacts: written,
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}