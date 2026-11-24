#!/usr/bin/env bun
/**
 * CLI Stage 3.3.2 — воспроизводимое обновление: фиксация контракта запуска и проверки.
 *
 *   bun run forecast:refresh --capture --run <dir> --interval <label> [--dry-run]
 *   bun run forecast:refresh --status
 *   bun run forecast:refresh --verify --run-id <id>
 *
 * Raw-артефакты не изменяются; фиксируются только хеши и метаданные.
 * Коды возврата: 0 — VALIDATED, 1 — INCOMPLETE, 2 — REJECTED, 3 — ошибка аргументов.
 */

import { resolve } from "node:path";

import { captureRun, latestRun, listRuns } from "../analytics/refresh/run-contract";

interface Args {
  mode: "capture" | "status" | "verify";
  runDir: string | null;
  interval: string;
  runId: string | null;
  runsDir: string;
  shop: string;
  slice: number;
  metric: string;
  timezone: string;
  dryRun: boolean;
  now: string;
}

const DEFAULT_RUNS_DIR = "data/extraction/superset/stage-3.3/runs";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "status",
    runDir: null,
    interval: "interval",
    runId: null,
    runsDir: DEFAULT_RUNS_DIR,
    shop: "7745",
    slice: 20624,
    metric: "qty_orders_delivered",
    timezone: "Europe/Moscow",
    dryRun: false,
    now: new Date().toISOString(),
  };
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`не задано значение для ${current}`);
      return value;
    };
    switch (current) {
      case "--capture": args.mode = "capture"; break;
      case "--status": args.mode = "status"; break;
      case "--verify": args.mode = "verify"; break;
      case "--run": args.runDir = next(); break;
      case "--interval": args.interval = next(); break;
      case "--run-id": args.runId = next(); break;
      case "--runs-dir": args.runsDir = next(); break;
      case "--shop": args.shop = next(); break;
      case "--slice": args.slice = Number(next()); break;
      case "--metric": args.metric = next(); break;
      case "--timezone": args.timezone = next(); break;
      case "--dry-run": args.dryRun = true; break;
      case "--now": args.now = next(); break;
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
    if (args.mode === "capture") {
      if (!args.runDir) throw new Error("для --capture требуется --run <dir>");
      const result = await captureRun({
        runDir: resolve(args.runDir),
        intervalLabel: args.interval,
        shopNo: args.shop,
        sliceId: args.slice,
        metric: args.metric,
        timezone: args.timezone,
        runsDir: resolve(args.runsDir),
        startedAt: args.now,
        finishedAt: args.now,
        dryRun: args.dryRun,
      });
      console.log(JSON.stringify({
        created: result.created,
        dry_run: args.dryRun,
        path: result.path,
        run: {
          run_id: result.run.run_id,
          status: result.run.status,
          completeness: result.run.completeness,
          http_status: result.run.http_status,
          rows_received: result.run.rows_received,
          rows_valid: result.run.rows_valid,
          rows_rejected: result.run.rows_rejected,
          response_hash: result.run.response_hash,
          request_hash: result.run.request_hash,
          failed_checks: result.run.validation.filter((check) => !check.passed).map((check) => `${check.code}: ${check.detail}`),
        },
      }, null, 2));
      return result.run.status === "VALIDATED" ? 0 : result.run.status === "INCOMPLETE" ? 1 : 2;
    }

    if (args.mode === "verify") {
      const runs = await listRuns(resolve(args.runsDir));
      const target = args.runId ? runs.find((run) => run.run_id === args.runId) ?? null : await latestRun(resolve(args.runsDir));
      if (!target) {
        console.error(`[ОШИБКА] запуск не найден: ${args.runId ?? "последний"}`);
        return 2;
      }
      const failed = target.validation.filter((check) => !check.passed);
      console.log(JSON.stringify({ run_id: target.run_id, status: target.status, failed_checks: failed, checks_total: target.validation.length }, null, 2));
      return target.status === "VALIDATED" ? 0 : target.status === "INCOMPLETE" ? 1 : 2;
    }

    const runs = await listRuns(resolve(args.runsDir));
    const latest = runs.at(-1) ?? null;
    console.log(JSON.stringify({
      runs_dir: resolve(args.runsDir),
      runs_total: runs.length,
      runs: runs.map((run) => ({ run_id: run.run_id, interval: run.interval_label, status: run.status, rows_valid: run.rows_valid, from: run.requested_from, to: run.requested_to })),
      latest: latest ? { run_id: latest.run_id, status: latest.status, response_hash: latest.response_hash } : null,
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
