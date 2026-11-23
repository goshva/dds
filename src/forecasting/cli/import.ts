#!/usr/bin/env bun
/**
 * CLI импорта артефактов Superset и плана мероприятий в прогнозную базу.
 *
 *   bun src/forecasting/cli/import.ts --run <dir> --label <имя> [--db <path>] [--transform-version v1]
 *   bun src/forecasting/cli/import.ts --plan <csv> [--shopno 7745] [--db <path>]
 *
 * Коды возврата: 0 — успех, 1 — ошибка импорта (включая отказ проверок), 2 — ошибка аргументов.
 */

import { resolve } from "node:path";

import { importRun } from "../ingestion/importer";
import { importPlan } from "../ingestion/plan-loader";
import { openStore } from "../storage/sqlite/store";

const DEFAULT_DB = "data/forecast/forecasting.sqlite";

interface Args {
  db: string;
  run?: string;
  label: string;
  plan?: string;
  shopno: string;
  transformVersion: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { db: DEFAULT_DB, label: "unknown", shopno: "7745", transformVersion: "v1" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`не задано значение для ${a}`);
      return v;
    };
    switch (a) {
      case "--db": args.db = next(); break;
      case "--run": args.run = next(); break;
      case "--label": args.label = next(); break;
      case "--plan": args.plan = next(); break;
      case "--shopno": args.shopno = next(); break;
      case "--transform-version": args.transformVersion = next(); break;
      default: throw new Error(`неизвестный параметр: ${a}`);
    }
  }
  if (!args.run && !args.plan) throw new Error("укажите --run <dir> и/или --plan <csv>");
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 2;
  }

  const store = await openStore(resolve(args.db));
  try {
    const output: Record<string, unknown> = { db: resolve(args.db) };

    if (args.run) {
      output.run = await importRun(
        { store },
        {
          runDir: resolve(args.run),
          sourceLabel: args.label,
          transformVersion: args.transformVersion,
          mode: "import-artifacts",
        },
      );
    }

    if (args.plan) {
      output.plan = await importPlan(store, { path: resolve(args.plan), shopNo: args.shopno });
    }

    output.totals = {
      daily_metrics: (store.db.query("SELECT COUNT(*) AS c FROM daily_metrics").get() as { c: number }).c,
      domain_events: (store.db.query("SELECT COUNT(*) AS c FROM domain_events").get() as { c: number }).c,
      extraction_runs: (store.db.query("SELECT COUNT(*) AS c FROM extraction_runs").get() as { c: number }).c,
      raw_extractions: (store.db.query("SELECT COUNT(*) AS c FROM raw_extractions").get() as { c: number }).c,
    };

    console.log(JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
