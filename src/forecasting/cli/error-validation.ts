#!/usr/bin/env bun
/**
 * CLI Stage 3.4.4.1 — валидация анализа ошибок: step-exact против cumulative, HAC-значимость.
 *
 *   bun run forecast:error-validation [--dataset <csv>] [--out <dir>] [--now <ISO>]
 *
 * Только чтение. Production-код моделей и pipeline не изменяются.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ALL_BASELINES } from "../baselines";
import { runBacktest } from "../analytics/backtesting/rolling-origin";
import { errorStructureFor, type ErrorStructure } from "../analytics/diagnostics/error-structure";
import { toCsv } from "../analytics/profiling/report";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.4.4.1";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";
const HORIZONS = [1, 3, 7, 14];

function md(input: {
  step: Record<number, ErrorStructure | null>;
  cumulative: Record<number, ErrorStructure | null>;
  checksum: string;
  now: string;
}): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.4.1 — Валидация анализа ошибок");
  lines.push("");
  lines.push(`- Набор: canonical CSV, checksum ${input.checksum}; сформировано ${input.now}`);
  lines.push("- Ошибка = прогноз − факт; положительная — завышение");
  lines.push("- Обычная t-статистика предполагает независимые наблюдения; HAC — поправка Ньюи–Уэста с лагом h");
  lines.push("");

  lines.push("## Наблюдения: step-exact против cumulative");
  lines.push("");
  lines.push("| горизонт | модель | step-exact n | cumulative n |");
  lines.push("|---:|---|---:|---:|");
  for (const horizon of HORIZONS) {
    lines.push(`| ${horizon} | rolling_7_day_mean | ${input.step[horizon]?.n ?? 0} | ${input.cumulative[horizon]?.n ?? 0} |`);
  }
  lines.push("");
  lines.push("Вывод: ранее опубликованная таблица по дню недели с n = 6 048 для горизонта 7 соответствовала **cumulative** (шаги 1…7). Точный горизонт 7 даёт n = 864.");
  lines.push("");

  for (const horizon of HORIZONS) {
    const structure = input.step[horizon];
    if (!structure) continue;
    lines.push(`## Точный горизонт ${horizon} дн. (rolling_7_day_mean, step-exact, n = ${structure.n})`);
    lines.push("");
    lines.push("| день | n | средняя ошибка | MAE | t обычная | t HAC | 95% CI (HAC) |");
    lines.push("|---|---:|---:|---:|---:|---:|---|");
    for (const hac of structure.byDayOfWeekHac) {
      const plain = structure.byDayOfWeek.find((group) => group.key === hac.key);
      lines.push(`| ${hac.key} | ${hac.n} | ${hac.mean} | ${plain?.mae ?? "—"} | ${plain?.tStat ?? "—"} | ${hac.tHac} | [${hac.ci95Low}; ${hac.ci95High}] |`);
    }
    lines.push("");
    lines.push("Направление уровня (до origin):");
    lines.push("");
    lines.push("| направление | n | средняя ошибка | t обычная |");
    lines.push("|---|---:|---:|---:|");
    for (const group of structure.byLevelDirection) lines.push(`| ${group.key} | ${group.n} | ${group.meanError} | ${group.tStat} |`);
    lines.push("");
    lines.push("Автокорреляция остатков: lag1 = " + structure.autocorrelation.lag1 + ", lag7 = " + structure.autocorrelation.lag7);
    lines.push("");
  }

  lines.push("## Совпадение знака недельного смещения: step-exact шаг 7 против cumulative 1…7");
  lines.push("");
  lines.push("| день | step-exact h=7 | cumulative h=7 | совпадение знака |");
  lines.push("|---|---:|---:|---|");
  const step7 = input.step[7];
  const cumulative7 = input.cumulative[7];
  for (const group of step7?.byDayOfWeekHac ?? []) {
    const cumulativeGroup = cumulative7?.byDayOfWeek.find((entry) => entry.key === group.key);
    const same = cumulativeGroup ? Math.sign(cumulativeGroup.meanError) === Math.sign(group.mean) : false;
    lines.push(`| ${group.key} | ${group.mean} | ${cumulativeGroup?.meanError ?? "—"} | ${same ? "да" : "нет"} |`);
  }
  lines.push("");
  lines.push("## Ограничения");
  lines.push("");
  lines.push("- HAC-поправка с лагом h учитывает перекрытие прогнозных окон, но не гарантирует асимптотическую нормальность на коротких сериях.");
  lines.push("- t-статистики приведены описательно, без поправки на множественные сравнения.");
  lines.push("- История охватывает два неполных года.");
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

    const result = runBacktest({
      shopNo: "7745",
      metric: "qty_orders_delivered",
      sliceId: 20624,
      history: rows,
      datasetChecksum: checksum,
      horizons: HORIZONS,
      minTrainDays: [28],
      models: ALL_BASELINES,
      generatedAt: now,
    });

    const step: Record<number, ErrorStructure | null> = {};
    const cumulative: Record<number, ErrorStructure | null> = {};
    for (const horizon of HORIZONS) {
      step[horizon] = errorStructureFor(result.records, "rolling_7_day_mean", horizon, 28, rows, { mode: "step-exact" });
      cumulative[horizon] = errorStructureFor(result.records, "rolling_7_day_mean", horizon, 28, rows, { mode: "cumulative" });
    }

    const outDir = resolve(out);
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    const write = async (name: string, content: string) => {
      await Bun.write(join(outDir, name), content);
      written.push(name);
    };

    await write("3.4.4.1-error-analysis-validation.md", md({ step, cumulative, checksum, now }));
    await write("error-validation-groups.csv", toCsv(
      ["mode", "horizon", "model", "day", "n", "mean_error", "mae", "t_plain", "t_hac", "ci95_low", "ci95_high", "lag"],
      HORIZONS.flatMap((horizon) => {
        const structure = step[horizon];
        if (!structure) return [];
        return structure.byDayOfWeekHac.map((hac) => {
          const plain = structure.byDayOfWeek.find((group) => group.key === hac.key);
          return ["step-exact", horizon, structure.model, hac.key, hac.n, hac.mean, plain?.mae ?? "", plain?.tStat ?? "", hac.tHac, hac.ci95Low, hac.ci95High, hac.lag];
        });
      }),
    ));
    await write("error-validation-summary.json", `${JSON.stringify({
      dataset_checksum: checksum,
      generated_at: now,
      horizon_observation_counts: HORIZONS.map((horizon) => ({ horizon, step_exact: step[horizon]?.n ?? 0, cumulative: cumulative[horizon]?.n ?? 0 })),
      step_exact_day_of_week: HORIZONS.filter((horizon) => step[horizon]).map((horizon) => ({
        horizon,
        n: step[horizon]!.n,
        days: step[horizon]!.byDayOfWeekHac,
      })),
      autocorrelation: HORIZONS.filter((horizon) => step[horizon]).map((horizon) => ({ horizon, ...step[horizon]!.autocorrelation })),
    }, null, 2)}\n`);

    console.log(JSON.stringify({
      counts: HORIZONS.map((horizon) => ({ horizon, step_exact: step[horizon]?.n ?? 0, cumulative: cumulative[horizon]?.n ?? 0 })),
      step_exact_h7: step[7]?.byDayOfWeekHac,
      step_exact_h1: step[1]?.byDayOfWeekHac,
      cumulative_h7: cumulative[7]?.byDayOfWeek.map((group) => ({ day: group.key, mean: group.meanError })),
      autocorrelation: HORIZONS.filter((horizon) => step[horizon]).map((horizon) => ({ horizon, ...step[horizon]!.autocorrelation })),
      artifacts: written,
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));