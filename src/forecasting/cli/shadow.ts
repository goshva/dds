#!/usr/bin/env bun
/**
 * CLI Stage 3.4.8 — Shadow Mode (изолированный контур, не production).
 *
 *   bun src/forecasting/cli/shadow.ts --mode replay|shadow|reconcile|monitor|all [--limit N] [--now ISO]
 *
 * Решения: JSONL (append-only), canonical CSV — единственный источник, h=1 и h=3.
 * package.json не изменяется (прямой запуск).
 *
 * Exit codes:
 *   0 — успех; 1 — ошибка; 2 — checksum CSV; 3 — CONFLICT снапшота;
 *   4 — lock занят; 5 — повреждённый/неоднозначный lock; 6 — повреждённое хранилище.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runShadowMode, type HistoryRow } from "../shadow/runner";
import { acquireShadowLock, releaseShadowLock } from "../shadow/lock";
import { monitor, reconcile } from "../shadow/pipeline";
import {
  isReconciliationRecord,
  isShadowErrorRecord,
  isSnapshotRecord,
  readJsonl,
  ShadowStorageCorruptedError,
  storePaths,
  writeManifest,
  type ShadowMode,
} from "../shadow/store";
import { readCanonicalCsv } from "../analytics/expansion/history-builder";

const DATASET = "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv";
const EXPECTED_CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";
// минимальная тестовая параметризация: при отсутствии переменной поведение прежнее
const STORE_DIR = process.env.DSH_SHADOW_STORE ?? "data/shadow/7745";

type Mode = ShadowMode | "reconcile" | "monitor" | "all";

async function main(argv: string[]): Promise<number> {
  let mode: Mode = "all";
  let limit: number | undefined;
  let now = new Date().toISOString();
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--mode") mode = (argv[++index] ?? mode) as Mode;
    else if (argv[index] === "--limit") limit = Number(argv[++index]);
    else if (argv[index] === "--now") now = argv[++index] ?? now;
  }

  try {
    const rows = (await readCanonicalCsv(resolve(DATASET))) as HistoryRow[];
    const checksum = new Bun.CryptoHasher("sha256").update(rows.map((row) => `${row.date}\t${row.value}`).join("\n")).digest("hex");
    if (checksum !== EXPECTED_CHECKSUM) {
      console.error(`[ОСТАНОВКА] checksum набора не совпал: ${checksum}`);
      return 2;
    }

    const store = storePaths(resolve(STORE_DIR));
    // R2: блокировка захватывается до любых операций с хранилищем
    const lock = acquireShadowLock(store.dir, mode, now);
    if (!lock.acquired) {
      console.error(`[LOCK] ${lock.code}: ${lock.message}`);
      return lock.code === "LOCKED" ? 4 : 5;
    }

    try {
      // fail-closed: сначала проверяем читаемость хранилища, затем пишем manifest
      await readJsonl(store.forecasts, isSnapshotRecord);
      await readJsonl(store.reconciliations, isReconciliationRecord);
      await readJsonl(store.errors, isShadowErrorRecord);

      await mkdir(store.dir, { recursive: true });
      await writeManifest(store.manifest, {
        version: "shadow-mode/v1",
        created_at: now,
        dataset_checksum: checksum,
        horizons: [1, 3],
        models: { rolling_7_day_mean: "rolling-7-day-mean/v1", adaptive_baseline: "adaptive-baseline/v1+variantB" },
        alpha: 1.0,
        limit_percent: 0.1,
        min_train_days: 28,
        note: "изолированный shadow-контур: production baseline не изменяется",
      });

      const result: Record<string, unknown> = { dataset_checksum: checksum, store: store.dir, modes: [] as string[], lock: { acquired: true, recovered: lock.recovered } };
      const modes: string[] = [];
      const runId = `shadow-${now.replace(/[:.]/g, "-")}`;
      let exitCode = 0;

      if (mode === "replay" || mode === "all") {
        const summary = await runShadowMode(rows, { mode: "replay", runId, datasetChecksum: checksum, generatedAt: now, store, limit });
        result.replay = summary;
        modes.push("replay");
        if (summary.conflicts > 0) exitCode = 3;
      }
      if (mode === "shadow" || mode === "all") {
        const summary = await runShadowMode(rows, { mode: "shadow", runId, datasetChecksum: checksum, generatedAt: now, store });
        result.shadow = summary;
        modes.push("shadow");
        if (summary.conflicts > 0) exitCode = 3;
      }
      if (mode === "reconcile" || mode === "all") {
        result.reconciliation = await reconcile(rows, store, runId, now);
        modes.push("reconcile");
      }
      if (mode === "monitor" || mode === "all") {
        const report = await monitor(rows, store, now);
        await Bun.write(join(store.dir, "shadow-monitor.json"), `${JSON.stringify(report, null, 2)}\n`);
        result.monitor = report;
        modes.push("monitor");
      }

      (result.modes as string[]).push(...modes);
      console.log(JSON.stringify(result, null, 2));
      return exitCode;
    } finally {
      // R2: гарантированное освобождение только собственного lock (проверка token)
      releaseShadowLock(lock.path, lock.token);
    }
  } catch (error) {
    if (error instanceof ShadowStorageCorruptedError) {
      console.error(`[STORAGE] ${error.message}`);
      return 6;
    }
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));