#!/usr/bin/env bun
/** CLI Stage 3.4.4: структура ошибок baseline (разделы 2–3). Только чтение. */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { analyzeBaselineErrors } from "../analytics/diagnostics/error-structure";
import { ALL_BASELINES } from "../baselines";
import { toCsv } from "../analytics/profiling/report";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.4.4";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";

function md(structures: ReturnType<typeof analyzeBaselineErrors>["structures"], checksum: string, now: string): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.4 — Структура ошибок baseline (разделы 2–3)");
  lines.push("");
  lines.push(`- Набор: 905 дней, checksum ${checksum}; сформировано ${now}`);
  lines.push(`- Модели: ${ALL_BASELINES.map((model) => model.name).join(", ")}`);
  lines.push("- Ошибка = прогноз − факт; положительная — завышение, отрицательная — занижение");
  lines.push("");

  lines.push("## Сводка по горизонтам (горизонт 7 дней)");
  lines.push("");
  lines.push("| модель | n | средняя ошибка | медиана | MAE | σ ошибки | доля завышений | автокорреляция лаг 1 / 7 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const structure of structures.filter((entry) => entry.horizon === 7)) {
    const bias = structure.byDayOfWeek.reduce((acc, group) => acc + group.meanError * group.n, 0) / structure.n;
    lines.push(
      `| ${structure.model} | ${structure.n} | ${bias.toFixed(2)} | — | — | — | — | ${structure.autocorrelation.lag1} / ${structure.autocorrelation.lag7} |`,
    );
  }
  lines.push("");

  for (const structure of structures.filter((entry) => entry.horizon === 7 && entry.model === "rolling_7_day_mean")) {
    lines.push("## Распределение ошибок по дням недели (rolling_7_day_mean, h=7)");
    lines.push("");
    lines.push("| день | n | средняя ошибка | медиана | MAE | t-статистика | завышений / занижений |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const group of structure.byDayOfWeek) {
      lines.push(`| ${group.key} | ${group.n} | ${group.meanError} | ${group.medianError} | ${group.mae} | ${group.tStat} | ${group.positive} / ${group.negative} |`);
    }
    lines.push("");
    lines.push("## Поведение при росте и снижении уровня (до origin)");
    lines.push("");
    lines.push("| направление | n | средняя ошибка | MAE | t-статистика |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const group of structure.byLevelDirection) {
      lines.push(`| ${group.key} | ${group.n} | ${group.meanError} | ${group.mae} | ${group.tStat} |`);
    }
    lines.push("");
  }

  lines.push("## Устойчивость по участкам (rolling_7_day_mean, h=7)");
  lines.push("");
  lines.push("| участок | n | средняя ошибка | MAE |");
  lines.push("|---|---:|---:|---:|");
  const rolling7 = structures.find((entry) => entry.horizon === 7 && entry.model === "rolling_7_day_mean");
  for (const group of rolling7?.byQuarter ?? []) lines.push(`| ${group.key} | ${group.n} | ${group.meanError} | ${group.mae} |`);
  lines.push("");
  lines.push("## Календарный эффект в остатках: повторяемость по годам");
  lines.push("");
  lines.push("| год | день недели | n | средняя ошибка | MAE |");
  lines.push("|---:|---:|---:|---:|---:|");
  for (const row of rolling7?.byYearDayOfWeek ?? []) lines.push(`| ${row.year} | ${row.dayOfWeek} | ${row.n} | ${row.meanError} | ${row.mae} |`);
  lines.push("");
  lines.push("## Ограничения");
  lines.push("");
  lines.push("- t-статистика приведена без поправки на множественные сравнения: единичные значимые значения не считаются доказательством эффекта.");
  lines.push("- Сравнение по годам ограничено 2 неполными годами.");
  lines.push("- Выбросы не удалялись; причинность не устанавливается.");
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

    const { structures } = analyzeBaselineErrors({ history: rows, minTrain: 28, horizons: [1, 3, 7, 14] });
    const outDir = resolve(out);
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    const write = async (name: string, content: string) => {
      await Bun.write(join(outDir, name), content);
      written.push(name);
    };

    await write("3.4.4-error-structure.md", md(structures, checksum, now));
    await write("error-groups.csv", toCsv(
      ["horizon", "model", "dimension", "key", "n", "mean_error", "median_error", "mae", "stdev", "t_stat", "positive", "negative"],
      structures.flatMap((structure) => [
        ...structure.byDayOfWeek.map((group) => [structure.horizon, structure.model, "day_of_week", group.key, group.n, group.meanError, group.medianError, group.mae, group.stdevError, group.tStat, group.positive, group.negative]),
        ...structure.byLevelDirection.map((group) => [structure.horizon, structure.model, "level_direction", group.key, group.n, group.meanError, group.medianError, group.mae, group.stdevError, group.tStat, group.positive, group.negative]),
        ...structure.byQuarter.map((group) => [structure.horizon, structure.model, "quarter", group.key, group.n, group.meanError, group.medianError, group.mae, group.stdevError, group.tStat, group.positive, group.negative]),
        ...structure.byYear.map((group) => [structure.horizon, structure.model, "year", group.key, group.n, group.meanError, group.medianError, group.mae, group.stdevError, group.tStat, group.positive, group.negative]),
      ]),
    ));
    await write("error-autocorrelation.json", `${JSON.stringify({
      dataset_checksum: checksum,
      generated_at: now,
      structures: structures.map((structure) => ({ horizon: structure.horizon, model: structure.model, n: structure.n, autocorrelation: structure.autocorrelation })),
    }, null, 2)}\n`);

    const rolling7 = structures.find((entry) => entry.horizon === 7 && entry.model === "rolling_7_day_mean");
    console.log(JSON.stringify({
      structures: structures.length,
      by_horizon_model: structures.map((structure) => ({ horizon: structure.horizon, model: structure.model, n: structure.n, lag1: structure.autocorrelation.lag1, lag7: structure.autocorrelation.lag7 })),
      rolling_h7: {
        by_day_of_week: rolling7?.byDayOfWeek.map((group) => ({ day: group.key, n: group.n, mean: group.meanError, t: group.tStat })),
        by_direction: rolling7?.byLevelDirection.map((group) => ({ direction: group.key, n: group.n, mean: group.meanError, t: group.tStat })),
        by_quarter: rolling7?.byQuarter.map((group) => ({ quarter: group.key, n: group.n, mean: group.meanError })),
      },
      artifacts: written,
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));