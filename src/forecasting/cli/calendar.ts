#!/usr/bin/env bun
/**
 * CLI Stage 3.4.2: исследование календарных факторов (только чтение canonical CSV).
 *
 *   bun run forecast:calendar [--dataset <csv>] [--out <dir>] [--now <ISO>]
 *
 * Данные не изменяются, SQLite не используется, признаки в pipeline не внедряются.
 */

import { resolve } from "node:path";

import { analyzeCalendar, buildObservations } from "../analytics/calendar/analysis";
import { writeCalendarArtifacts } from "../analytics/calendar/reports";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DEFAULT_DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const DEFAULT_OUT = "reports/forecasting/stage-3.4.2";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";

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
    const path = resolve(dataset);
    const rows = await readCanonicalCsv(path);
    if (!rows.length) throw new Error(`набор ${path} пуст`);

    const checksum = new Bun.CryptoHasher("sha256")
      .update(rows.map((row) => `${row.date}\t${row.value}`).join("\n"))
      .digest("hex");
    if (checksum !== EXPECTED_CHECKSUM) {
      console.error(`[ОСТАНОВКА] checksum канонического набора не совпал: ${checksum} ≠ ${EXPECTED_CHECKSUM}`);
      return 2;
    }

    const observations = buildObservations(rows);
    const analysis = analyzeCalendar(observations);
    const datasetInfo = {
      rows: rows.length,
      from: rows[0]!.date,
      to: rows.at(-1)!.date,
      checksum,
      total: rows.reduce((acc, row) => acc + row.value, 0),
    };

    const written = await writeCalendarArtifacts({
      outDir: resolve(out),
      analysis,
      dataset: datasetInfo,
      generatedAt: now,
      testsSummary: "bun test tests/forecasting/calendar.test.ts",
    });

    console.log(JSON.stringify({
      dataset: path,
      dataset_checksum: checksum,
      rows: rows.length,
      period: { from: datasetInfo.from, to: datasetInfo.to },
      total: datasetInfo.total,
      statistics: {
        by_day_of_week: analysis.byDayOfWeek.map((row) => ({ group: row.group, n: row.n, mean: row.mean, median: row.median })),
        weekday_vs_weekend: analysis.weekdayVsWeekend.map((row) => ({ group: row.group, n: row.n, mean: row.mean })),
        seasons: analysis.bySeason.map((row) => ({ group: row.group, n: row.n, mean: row.mean })),
        holidays: analysis.officialHolidays.map((row) => ({ group: row.group, n: row.n, mean: row.mean })),
        long_weekend: analysis.longWeekend.map((row) => ({ group: row.group, n: row.n, mean: row.mean })),
      },
      year_stability: analysis.yearStability,
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
