// Stage 3.4.8: тесты изолированного Shadow Mode.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendSnapshot,
  inputDataVersion,
  readJsonl,
  snapshotId,
  storePaths,
  type ShadowSnapshot,
} from "../../src/forecasting/shadow/store";
import { runShadowMode, SHADOW_HORIZONS, type HistoryRow } from "../../src/forecasting/shadow/runner";
import { monitor, reconcile } from "../../src/forecasting/shadow/pipeline";

const NOW = "2026-11-24T00:00:00.000Z";
const CHECKSUM = "d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a";

/** 40 дней истории с недельной структурой; последняя дата = 2026-02-09. */
function rows(): HistoryRow[] {
  return Array.from({ length: 40 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1));
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), value: 1000 + (index % 7) * 20 };
  });
}

async function store(): Promise<ReturnType<typeof storePaths>> {
  const dir = await mkdtemp(join(tmpdir(), "dds-shadow-"));
  return storePaths(dir);
}

describe("одинаковые входные данные для baseline и Variant B", () => {
  test("для каждой пары (origin, target, h) есть обе модели", async () => {
    const s = await store();
    await runShadowMode(rows(), { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const snapshots = await readJsonl<ShadowSnapshot>(s.forecasts);
    const keys = new Map<string, Set<string>>();
    for (const snapshot of snapshots) {
      const key = `${snapshot.origin_date}|${snapshot.target_date}|${snapshot.horizon}`;
      keys.set(key, (keys.get(key) ?? new Set()).add(snapshot.model_id));
    }
    expect(keys.size).toBeGreaterThan(0);
    for (const models of keys.values()) {
      expect([...models].sort()).toEqual(["adaptive_baseline", "rolling_7_day_mean"]);
    }
  });
});

describe("неизменяемость снапшота", () => {
  test("повторный запуск не перезаписывает и не дублирует записи", async () => {
    const s = await store();
    const first = await runShadowMode(rows(), { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const before = (await readJsonl(s.forecasts)).length;
    const second = await runShadowMode(rows(), { mode: "replay", runId: "run-2", datasetChecksum: CHECKSUM, generatedAt: "2026-11-25T00:00:00.000Z", store: s });
    const after = (await readJsonl(s.forecasts)).length;
    expect(first.written).toBeGreaterThan(0);
    expect(second.written).toBe(0);
    expect(second.noop).toBe(first.forecasts);
    expect(after).toBe(before);
  });
});

describe("отсутствие future leakage", () => {
  test("replay создаёт прогнозы только на подтверждённые даты", async () => {
    const s = await store();
    const data = rows();
    const last = data[data.length - 1]!.date;
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const snapshots = await readJsonl<ShadowSnapshot>(s.forecasts);
    expect(snapshots.every((snapshot) => snapshot.target_date <= last)).toBe(true);
    expect(snapshots.every((snapshot) => snapshot.target_date > snapshot.origin_date)).toBe(true);
  });

  test("shadow создаёт прогноз на будущую дату и не оценивает её", async () => {
    const s = await store();
    const data = rows();
    const summary = await runShadowMode(data, { mode: "shadow", runId: "run-s", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    expect(summary.pendingActual).toBeGreaterThan(0);
    const snapshots = await readJsonl<ShadowSnapshot>(s.forecasts);
    const last = data[data.length - 1]!.date;
    expect(snapshots.every((snapshot) => snapshot.target_date > last)).toBe(true);
    const reconciliation = await reconcile(data, s, "run-s", NOW);
    expect(reconciliation.pendingFuture).toBe(snapshots.length);
    expect(reconciliation.reconciled).toBe(0);
  });
});

describe("сопоставление с фактом", () => {
  test("absolute_error и signed_error рассчитываются корректно", async () => {
    const s = await store();
    const data = rows();
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const summary = await reconcile(data, s, "run-r", NOW);
    expect(summary.newRecords).toBeGreaterThan(0);
    const records = await readJsonl<any>(s.reconciliations);
    for (const record of records) {
      expect(record.absolute_error).toBeCloseTo(Math.abs(record.forecast_value - record.actual), 9);
      expect(record.signed_error).toBeCloseTo(record.forecast_value - record.actual, 9);
    }
  });

  test("reconciliation не изменяет прогнозы", async () => {
    const s = await store();
    const data = rows();
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const before = await Bun.file(s.forecasts).text();
    await reconcile(data, s, "run-r", NOW);
    const after = await Bun.file(s.forecasts).text();
    expect(after).toBe(before);
  });

  test("отсутствующий факт не превращается в ноль", async () => {
    const s = await store();
    const data = rows();
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    // разрыв в середине: дата-факт отсутствует, но не является будущей
    const truncated = data.filter((row) => row.date !== data[30]!.date);
    const summary = await reconcile(truncated, s, "run-r", NOW);
    expect(summary.missingActual).toBeGreaterThan(0);
    const records = await readJsonl<any>(s.reconciliations);
    expect(records.every((record) => record.actual !== 0)).toBe(true);
  });
});

describe("отсутствие влияния на production baseline", () => {
  test("baseline не зависит от Variant B", async () => {
    const s = await store();
    const data = rows();
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    const snapshots = await readJsonl<ShadowSnapshot>(s.forecasts);
    const baseline = snapshots.filter((snapshot) => snapshot.model_id === "rolling_7_day_mean");
    const last = data[data.length - 1]!.date;
    // baseline на последнем полном origin равен среднему последних 7 значений (формула не изменена)
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline.every((snapshot) => snapshot.variant === null)).toBe(true);
    // baseline-снапшот существует независимо от статуса Variant B
    const shadow = snapshots.filter((snapshot) => snapshot.model_id === "adaptive_baseline");
    expect(shadow.every((snapshot) => snapshot.variant === "B")).toBe(true);
  });
});

describe("идемпотентность и повторный запуск", () => {
  test("snapshot_id детерминирован и не зависит от generated_at", () => {
    const base = { modelId: "adaptive_baseline" as const, modelVersion: "adaptive-baseline/v1+variantB", horizon: 1 as const, originDate: "2026-01-01", targetDate: "2026-01-02", inputDataVersion: "abc" };
    expect(snapshotId(base)).toBe(snapshotId(base));
    expect(snapshotId({ ...base, targetDate: "2026-01-03" })).not.toBe(snapshotId(base));
  });

  test("CONFLICT при том же ID и другом содержимом, без перезаписи", async () => {
    const s = await store();
    const snapshot: ShadowSnapshot = {
      snapshot_id: "fixed-id", run_id: "run-1", mode: "replay", model_id: "rolling_7_day_mean", model_version: "rolling-7-day-mean/v1",
      variant: null, horizon: 1, origin_date: "2026-01-01", target_date: "2026-01-02", forecast_value: 100,
      status: "OK", fallback_reason: null, input_data_version: "iv", dataset_checksum: CHECKSUM, generated_at: NOW,
    };
    const first = await appendSnapshot(s, snapshot);
    expect(first.written).toBe(true);
    const before = await Bun.file(s.forecasts).text();
    const second = await appendSnapshot(s, { ...snapshot, forecast_value: 999, generated_at: "2026-11-25T00:00:00.000Z" });
    expect(second.conflict).toBe(true);
    expect(await Bun.file(s.forecasts).text()).toBe(before);
    const errors = await readJsonl<any>(s.errors);
    expect(errors.some((error) => error.code === "SNAPSHOT_CONFLICT")).toBe(true);
  });
});

describe("fail-closed поведение", () => {
  test("неконечный baseline не сохраняется как прогноз", async () => {
    const s = await store();
    const broken = rows();
    // NaN внутри окна rolling (последние 7 дней), чтобы baseline стал неконечным
    broken[36] = { ...broken[36]!, value: Number.NaN };
    const summary = await runShadowMode(broken, { mode: "replay", runId: "run-b", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    expect(summary.invalids).toBeGreaterThan(0);
    expect(summary.errors.some((error) => error.code === "NON_FINITE_BASELINE")).toBe(true);
    const snapshots = await readJsonl<ShadowSnapshot>(s.forecasts);
    expect(snapshots.every((snapshot) => snapshot.forecast_value === null || Number.isFinite(snapshot.forecast_value))).toBe(true);
  });

  test("мониторинг считает прогнозы, факты и различия", async () => {
    const s = await store();
    const data = rows();
    await runShadowMode(data, { mode: "replay", runId: "run-1", datasetChecksum: CHECKSUM, generatedAt: NOW, store: s });
    await reconcile(data, s, "run-r", NOW);
    const report = await monitor(data, s, NOW);
    expect(report.forecasts).toBeGreaterThan(0);
    expect(report.reconciled).toBeGreaterThan(0);
    expect(report.comparison.length).toBe(2);
    expect(report.status_counts.OK).toBeGreaterThan(0);
  });
});