// Stage 3.3.1–3.3.2: расширение истории, сверка версий, контракт запуска и идемпотентность.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildExpandedHistory, profileHistory, readCanonicalCsv } from "../../src/forecasting/analytics/expansion/history-builder";
import { reconcileHistory } from "../../src/forecasting/analytics/expansion/history-reconciliation";
import { assertRunIdentity, captureRun, latestRun, listRuns, runIdFor, validateExtraction } from "../../src/forecasting/analytics/refresh/run-contract";

const AT = "2026-11-23T23:30:00.000Z";
const HEADER = "date,slice_id,dataset_id,viz_type,dimension_1,dimension_2,metric,metric_kind,value";

interface Row {
  date: string;
  value: string | number;
  slice_id?: number;
  metric?: string;
}

/** Синтетический каталог выгрузки: manifest + quality + observations. */
async function writeRun(spec: { label: string; rows: Row[]; http?: number; completeness?: string; shopno?: string; metrics?: string[] }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dds-exp-${spec.label}-`));
  const slices = [...new Set(spec.rows.map((row) => row.slice_id ?? 20624))];
  const metrics = spec.metrics ?? ["qty_orders_delivered"];
  const dates = spec.rows.filter((row) => row.date).map((row) => row.date).sort();
  const manifest = {
    generated_at: AT,
    shopno: spec.shopno ?? "7745",
    period: { from: dates[0] ?? "", to: dates.at(-1) ?? "", time_range: `${dates[0]} : ${dates.at(-1)}`, weeks: 4 },
    sources: slices.map((slice_id) => ({ slice_id, datasource_id: 3035, request_sha256: `req-${slice_id}`, file: "har" })),
  };
  const quality = {
    requests: slices.map((slice_id) => ({
      slice_id,
      http_status: spec.http ?? 200,
      completeness: spec.completeness ?? "full",
      row_count: spec.rows.length,
      missing_metrics: [],
      missing_dimensions: [],
      truncated_queries: [],
      duplicate_rows: 0,
      query_count_mismatch: false,
      ratio_weighting: "none",
    })),
  };
  const csv = [HEADER, ...spec.rows.map((row) => [row.date, row.slice_id ?? 20624, 3035, "echarts_area", "ТТ", "", row.metric ?? "qty_orders_delivered", "additive", row.value].join(","))].join("\n");
  await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(join(dir, "quality.json"), `${JSON.stringify(quality, null, 2)}\n`);
  await Bun.write(join(dir, "observations_7745.csv"), `${csv}\n`);
  await Bun.write(join(dir, "20624.request.json"), `${JSON.stringify({ form_data: { slice_id: 20624, viz_type: "echarts_area" }, datasource: { id: 3035 }, queries: [{ metrics, granularity: "date_supply", row_limit: 10000, extras: { time_grain_sqla: "P1D" }, filters: [{ col: "shopno", op: "IN", val: ["7745"] }] }] })}\n`);
  return dir;
}

describe("расширение истории", () => {
  test("интервалы объединяются, дубликаты и пропуски диагностируются", async () => {
    const first = await writeRun({ label: "i1", rows: [{ date: "2026-10-01", value: 10 }, { date: "2026-10-02", value: 20 }] });
    const second = await writeRun({ label: "i2", rows: [{ date: "2026-10-03", value: 30 }, { date: "2026-10-05", value: 50 }] });
    const history = await buildExpandedHistory({
      shopNo: "7745",
      metric: "qty_orders_delivered",
      sliceId: 20624,
      intervals: [{ runDir: first, label: "i1" }, { runDir: second, label: "i2" }],
    });

    expect(history.observations.length).toBe(4);
    expect(history.period).toEqual({ from: "2026-10-01", to: "2026-10-05", days: 5 });
    expect(history.missingDates).toEqual(["2026-10-04"]);
    expect(history.gaps).toEqual([{ from: "2026-10-04", to: "2026-10-04", days: 1 }]);
    expect(history.duplicates).toEqual([]);
    expect(history.checksum.length).toBe(64);
  });

  test("пересекающиеся интервалы дают дубликаты, а не сумму значений", async () => {
    const first = await writeRun({ label: "d1", rows: [{ date: "2026-10-01", value: 10 }] });
    const second = await writeRun({ label: "d2", rows: [{ date: "2026-10-01", value: 999 }] });
    const history = await buildExpandedHistory({
      shopNo: "7745",
      metric: "qty_orders_delivered",
      sliceId: 20624,
      intervals: [{ runDir: first, label: "d1" }, { runDir: second, label: "d2" }],
    });

    expect(history.duplicates.length).toBe(1);
    expect(history.duplicates[0]!.values.sort((a, b) => a - b)).toEqual([10, 999]);
    expect(history.observations.length).toBe(0); // дублирующаяся дата исключена, значения не суммированы
    expect(history.overlapWarnings[0]).toContain("2026-10-01");
  });

  test("строки других срезов, метрик, NULL и отрицательные значения отклоняются", async () => {
    const dir = await writeRun({
      label: "reject",
      rows: [
        { date: "2026-10-01", value: 10 },
        { date: "2026-10-02", value: 20, slice_id: 20403 },
        { date: "2026-10-03", value: 30, metric: "qty_orders_declined" },
        { date: "2026-10-04", value: "" },
        { date: "2026-10-05", value: -5 },
      ],
    });
    const history = await buildExpandedHistory({ shopNo: "7745", metric: "qty_orders_delivered", sliceId: 20624, intervals: [{ runDir: dir, label: "r" }] });
    expect(history.observations.map((observation) => observation.date)).toEqual(["2026-10-01"]);
    // строки другой метрики отсеиваются до проверки (их 1), остальные три отклоняются с причиной
    expect(history.rejectedRows.length).toBe(3);
    expect(history.rejectedRows.some((row) => row.reason.includes("slice_id"))).toBe(true);
    expect(history.rejectedRows.some((row) => row.reason.includes("NULL"))).toBe(true);
    expect(history.rejectedRows.some((row) => row.reason.includes("отрицательное"))).toBe(true);
  });

  test("чужой магазин отклоняется", async () => {
    const dir = await writeRun({ label: "shop", shopno: "9999", rows: [{ date: "2026-10-01", value: 10 }] });
    const history = await buildExpandedHistory({ shopNo: "7745", metric: "qty_orders_delivered", sliceId: 20624, intervals: [{ runDir: dir, label: "s" }] });
    expect(history.observations).toEqual([]);
    expect(history.rejectedRows[0]!.reason).toContain("shopno");
  });

  test("сверка версий классифицирует идентичные, новые и изменившиеся значения", async () => {
    const dir = await writeRun({
      label: "rec",
      rows: [
        { date: "2026-10-01", value: 10 },
        { date: "2026-10-02", value: 999 },
        { date: "2026-10-03", value: 30 },
      ],
    });
    const history = await buildExpandedHistory({ shopNo: "7745", metric: "qty_orders_delivered", sliceId: 20624, intervals: [{ runDir: dir, label: "rec" }] });
    const previous = [
      { date: "2026-10-01", value: 10 },
      { date: "2026-10-02", value: 20 },
      { date: "2026-10-09", value: 50 },
    ];
    const result = reconcileHistory(previous, history, { previousSourceSliceId: 20624 });

    expect(result.counts.IDENTICAL).toBe(1);
    expect(result.counts.VALUE_CHANGED).toBe(1);
    expect(result.counts.MISSING).toBe(1);
    expect(result.counts.NEW).toBe(1);
    expect(result.status).toBe("CHANGES_DETECTED");
  });

  test("профиль истории считает статистики и недельные агрегаты", async () => {
    const dir = await writeRun({
      label: "prof",
      rows: Array.from({ length: 14 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, value: 100 + index })),
    });
    const history = await buildExpandedHistory({ shopNo: "7745", metric: "qty_orders_delivered", sliceId: 20624, intervals: [{ runDir: dir, label: "p" }] });
    const profile = profileHistory(history.observations);

    expect(profile.observations).toBe(14);
    expect(profile.calendarDays).toBe(14);
    expect(profile.missingDates).toBe(0);
    expect(profile.min).toBe(100);
    expect(profile.max).toBe(113);
    expect(profile.median).toBe(106.5);
    expect(profile.weekdayMeans.reduce((acc, entry) => acc + entry.observations, 0)).toBe(14);
    expect(profile.weeklyAggregates.length).toBe(3);
  });

  test("readCanonicalCsv читает набор и отклоняет файл без нужных колонок", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-canon-"));
    const path = join(dir, "dataset.csv");
    await Bun.write(path, "date,shop_no,metric,value,source_slice_id,source_dataset_id,source_run_id,quality_status\n2026-10-01,7745,qty_orders_delivered,10,20624,3035,2,full\n");
    expect(await readCanonicalCsv(path)).toEqual([{ date: "2026-10-01", value: 10 }]);

    const broken = join(dir, "broken.csv");
    await Bun.write(broken, "a,b\n1,2\n");
    await expect(readCanonicalCsv(broken)).rejects.toThrow(/колонок/);
  });
});

describe("контракт запуска обновления", () => {
  test("валидная выгрузка получает статус VALIDATED со всеми проверками", async () => {
    const dir = await writeRun({ label: "valid", rows: [{ date: "2026-10-01", value: 10 }, { date: "2026-10-02", value: 20 }] });
    const outcome = await validateExtraction(dir, { shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered" });
    expect(outcome.status).toBe("VALIDATED");
    expect(outcome.checks.every((check) => check.passed)).toBe(true);
    expect(outcome.rowsValid).toBe(2);
    expect(outcome.responseHash.length).toBe(64);
  });

  test("неполный ответ и HTTP != 200 отклоняются (fail-closed)", async () => {
    const partial = await writeRun({ label: "partial", rows: [{ date: "2026-10-01", value: 10 }], completeness: "partial" });
    expect((await validateExtraction(partial, { shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered" })).status).toBe("INCOMPLETE");

    const serverError = await writeRun({ label: "http500", rows: [{ date: "2026-10-01", value: 10 }], http: 500 });
    expect((await validateExtraction(serverError, { shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered" })).status).toBe("REJECTED");
  });

  test("чужая метрика, срез и магазин отклоняются", async () => {
    const dir = await writeRun({ label: "wrong", rows: [{ date: "2026-10-01", value: 10, metric: "qty_orders_declined" }] });
    expect((await validateExtraction(dir, { shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered" })).status).toBe("REJECTED");
    expect((await validateExtraction(dir, { shopNo: "9999", sliceId: 20624, metric: "qty_orders_declined" })).status).toBe("REJECTED");
    expect((await validateExtraction(dir, { shopNo: "7745", sliceId: 20403, metric: "qty_orders_declined" })).status).toBe("REJECTED");
  });

  test("повторная фиксация запуска идемпотентна и не перезаписывает манифест", async () => {
    const dir = await writeRun({ label: "idem", rows: [{ date: "2026-10-01", value: 10 }, { date: "2026-10-02", value: 20 }] });
    const runsDir = await mkdtemp(join(tmpdir(), "dds-runs-"));
    const first = await captureRun({ runDir: dir, intervalLabel: "idem", shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered", timezone: "Europe/Moscow", runsDir, startedAt: AT, finishedAt: AT });
    const before = await Bun.file(first.path).text();
    const second = await captureRun({ runDir: dir, intervalLabel: "idem", shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered", timezone: "Europe/Moscow", runsDir, startedAt: "2026-11-24T00:00:00.000Z", finishedAt: "2026-11-24T00:00:00.000Z" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.run_id).toBe(first.run.run_id);
    expect(await Bun.file(first.path).text()).toBe(before);
    expect((await listRuns(runsDir)).length).toBe(1);
    expect((await latestRun(runsDir))!.status).toBe("VALIDATED");
  });

  test("dry-run не создаёт файл запуска", async () => {
    const dir = await writeRun({ label: "dry", rows: [{ date: "2026-10-01", value: 10 }] });
    const runsDir = await mkdtemp(join(tmpdir(), "dds-runs-dry-"));
    const result = await captureRun({ runDir: dir, intervalLabel: "dry", shopNo: "7745", sliceId: 20624, metric: "qty_orders_delivered", timezone: "Europe/Moscow", runsDir, startedAt: AT, finishedAt: AT, dryRun: true });
    expect(result.created).toBe(false);
    expect(await listRuns(runsDir)).toEqual([]);
  });

  test("повторное использование run_id с другим ответом обнаруживается", () => {
    const runId = runIdFor("q1", "abcdef1234567890", "2026-10-01", "2026-10-31");
    expect(runId).toBe("q1-abcdef123456-2026-10-01_2026-10-31");
    const run = { run_id: runId, response_hash: "hash1" } as never;
    expect(() => assertRunIdentity(run, "hash1")).not.toThrow();
    expect(() => assertRunIdentity(run, "hash2")).toThrow(/уже связан с другим ответом/);
  });
});
