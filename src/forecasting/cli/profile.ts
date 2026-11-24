#!/usr/bin/env bun
/**
 * CLI профилирования данных (Stage 3.1).
 *
 *   bun run forecast:profile --shop 7745 [--db <path>] [--out <dir>] [--now <ISO>] [--catalog <csv>]
 *
 * Безопасность: база открывается ТОЛЬКО для чтения (`readonly: true` + `PRAGMA query_only = 1`),
 * миграции не применяются, никакие данные не изменяются. Отчёты пишутся в файловую систему.
 *
 * Коды возврата: 0 — успех, 1 — ошибка выполнения, 2 — ошибка аргументов.
 */

import { resolve } from "node:path";

import { profileShop, readObservations } from "../analytics/profiling/profiler";
import { openReadOnlyDatabase } from "../analytics/profiling/read-only";
import { writeReports } from "../analytics/profiling/report";
import { CATALOG_PATH } from "../analytics/profiling/semantics";

interface Args {
  shop: string;
  db: string;
  out: string;
  now: string;
  catalog: string;
}

const DEFAULT_DB = "data/forecast/forecasting.sqlite";
const DEFAULT_OUT = "reports/forecasting/stage-3.1";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    shop: "7745",
    db: DEFAULT_DB,
    out: DEFAULT_OUT,
    now: new Date().toISOString(),
    catalog: CATALOG_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`не задано значение для ${current}`);
      return value;
    };
    switch (current) {
      case "--shop": args.shop = next(); break;
      case "--db": args.db = next(); break;
      case "--out": args.out = next(); break;
      case "--now": args.now = next(); break;
      case "--catalog": args.catalog = next(); break;
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
    console.error("использование: bun run forecast:profile --shop 7745 [--db <path>] [--out <dir>] [--now <ISO>] [--catalog <csv>]");
    return 2;
  }

  let connection: ReturnType<typeof openReadOnlyDatabase> | null = null;
  try {
    connection = openReadOnlyDatabase(resolve(args.db));
    const rows = readObservations(connection.db, args.shop);
    const result = profileShop(connection.db, {
      shopNo: args.shop,
      generatedAt: args.now,
      catalogPath: args.catalog,
    });
    const files = await writeReports(result, rows, resolve(args.out));

    const readinessCounts = result.readiness.reduce<Record<string, number>>((acc, row) => {
      acc[row.forecast_readiness] = (acc[row.forecast_readiness] ?? 0) + 1;
      return acc;
    }, {});

    console.log(JSON.stringify({
      shop: result.shop_no,
      period: { from: result.period.from, to: result.period.to, days: result.period.days, matches_expected: result.period.matches_expected_period },
      slices: result.slices,
      metrics: [...new Set(result.metric_profiles.map((profile) => profile.metric))].length,
      metric_profiles: result.metric_profiles.length,
      observations: result.source_counts.daily_metrics,
      duplicates: result.duplicates.count,
      outliers: result.outliers.length,
      readiness: readinessCounts,
      read_only: { query_only: result.read_only.query_only, write_blocked: result.read_only.write_attempt_blocked },
      reports: files,
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  } finally {
    connection?.db.close(false);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
