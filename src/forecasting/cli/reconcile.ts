#!/usr/bin/env bun
/**
 * CLI сверки двух выгрузок Superset.
 *
 *   bun src/forecasting/cli/reconcile.ts --old <dir> --new <dir> --out <report.md> --json <report.json> \
 *       [--tolerance-abs <n>] [--tolerance-rel <n>] [--chart-section <file.md>] \
 *       [--authorization <text>] [--command <text>] [--strategy <text>] [--incident <text>]
 *
 * Коды возврата: 0 — IDENTICAL или MATCH_WITH_MINOR_DIFFERENCES,
 *                1 — INCOMPLETE, 2 — BLOCKED, 3 — DATA_CHANGED (нужно решение пользователя),
 *                4 — ошибка аргументов.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { compareRuns } from "../reconciliation/comparison";
import { loadRun } from "../reconciliation/normalizer";
import { buildReconciliationJson, buildReconciliationReport } from "../reconciliation/reconciliation-report";

interface Args {
  oldDir: string;
  newDir: string;
  out: string;
  json: string;
  toleranceAbs: number;
  toleranceRel: number;
  chartSection?: string;
  authorization: string;
  command: string;
  strategy: string;
  incident?: string;
}

const DEFAULT_AUTHORIZATION =
  "Авторизация: успешный вход по логину/паролю из `.env` (значения не читаются в отчёт), " +
  "CSRF-токен получен. Логины, пароли и токены в отчёте, артефактах и логах задачи не сохраняются.";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    oldDir: "",
    newDir: "",
    out: "",
    json: "",
    toleranceAbs: 0,
    toleranceRel: 0,
    authorization: DEFAULT_AUTHORIZATION,
    command: "",
    strategy: "per-slice (по одному срезу за запрос, с паузами)",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`не задано значение для ${a}`);
      return v;
    };
    switch (a) {
      case "--old": args.oldDir = next(); break;
      case "--new": args.newDir = next(); break;
      case "--out": args.out = next(); break;
      case "--json": args.json = next(); break;
      case "--tolerance-abs": args.toleranceAbs = Number(next()); break;
      case "--tolerance-rel": args.toleranceRel = Number(next()); break;
      case "--chart-section": args.chartSection = next(); break;
      case "--authorization": args.authorization = next(); break;
      case "--command": args.command = next(); break;
      case "--strategy": args.strategy = next(); break;
      case "--incident": args.incident = next(); break;
      default: throw new Error(`неизвестный параметр: ${a}`);
    }
  }
  if (!args.oldDir || !args.newDir || !args.out || !args.json) {
    throw new Error("использование: --old <dir> --new <dir> --out <report.md> --json <report.json> [опции]");
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 4;
  }

  const oldRun = await loadRun(args.oldDir);
  const newRun = await loadRun(args.newDir);
  const result = compareRuns(oldRun, newRun, {
    toleranceAbs: args.toleranceAbs,
    toleranceRel: args.toleranceRel,
  });

  const chartSection = args.chartSection ? await readFile(resolve(args.chartSection), "utf8") : undefined;
  const input = {
    result,
    old_run: oldRun,
    new_run: newRun,
    authorization: args.authorization,
    collection: {
      command: args.command || "bun tools/fetch-darkstore-aggregates.ts --live --yes --files <101..105> --shopno 7745 --from 2026-10-13 --to 2026-11-23 --weeks 6 --raw-artifacts --out data/extraction/superset/7745-api-refresh",
      strategy: args.strategy,
      incident: args.incident,
    },
    chart_20209: chartSection,
  };

  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buildReconciliationReport(input), "utf8");
  const jsonPath = resolve(args.json);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, buildReconciliationJson(input), "utf8");

  console.log(
    JSON.stringify(
      {
        status: result.status,
        report: outPath,
        json: jsonPath,
        counts: result.counts,
        value_changed_details: result.diffs
          .filter((d) => d.category === "VALUE_CHANGED")
          .slice(0, 20)
          .map((d) => ({ slice_id: d.slice_id, date: d.date, metric: d.metric, dim1: d.dimension_1, dim2: d.dimension_2, old: d.old_value, new: d.new_value, abs: d.abs_delta })),
        per_slice: result.per_slice,
      },
      null,
      2,
    ),
  );

  switch (result.status) {
    case "BLOCKED": return 2;
    case "INCOMPLETE": return 1;
    case "DATA_CHANGED": return 3;
    default: return 0;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    process.exitCode = 4;
  }
}
