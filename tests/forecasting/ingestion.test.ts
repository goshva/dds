// Этап 2: слой загрузки — валидация, идемпотентность, статусы, провенанс, план мероприятий.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPlan, readRunArtifacts } from "../../src/forecasting/ingestion/artifact-reader";
import { importRun } from "../../src/forecasting/ingestion/importer";
import { importPlan } from "../../src/forecasting/ingestion/plan-loader";
import { sliceStatusFromQuality, validateArtifacts } from "../../src/forecasting/ingestion/validation";
import { openStore } from "../../src/forecasting/storage/sqlite/store";

const AT = "2026-11-23T18:00:00.000Z";
const HEADER = "date,slice_id,dataset_id,viz_type,dimension_1,dimension_2,metric,metric_kind,value";

interface Row {
  date: string;
  slice_id: number;
  dimension_1?: string;
  dimension_2?: string;
  metric: string;
  metric_kind?: string;
  value: string | number;
}

interface RunSpec {
  rows: Row[];
  completeness?: string;
  http?: number;
  /** явный список срезов манифеста (по умолчанию — из rows); допускает дубли и пустые срезы */
  manifestSlices?: number[];
  /** срезы, для которых НЕ пишем запись в quality.json */
  qualityOmit?: number[];
  missingMetrics?: string[];
  missingDimensions?: string[];
  duplicateRows?: number;
  truncatedQueries?: number;
  queryCountMismatch?: boolean;
  shopno?: string;
  rowCount?: number;
  /** продублировать записи quality.json для указанных срезов (проверка уникальности slice_id) */
  qualityDuplicate?: number[];
  /** полностью заменить массив quality.requests (проверка типов и обязательных полей) */
  qualityRaw?: any[];
}

/** Пишет синтетический каталог выгрузки и возвращает его путь. */
async function writeRun(spec: RunSpec, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dds-ingest-${name}-`));
  const slicesFromRows = [...new Set(spec.rows.map((r) => r.slice_id))];
  const manifestSlices = spec.manifestSlices ?? slicesFromRows;
  const qualitySlices = manifestSlices.filter((s) => !(spec.qualityOmit ?? []).includes(s));

  const manifest = {
    generated_at: AT,
    mode: "test",
    shopno: spec.shopno ?? "7745",
    period: { from: "2026-10-13", to: "2026-11-23", time_range: "2026-10-13 : 2026-11-23", weeks: 6 },
    sources: manifestSlices.map((slice_id) => ({ slice_id, datasource_id: 3035, request_sha256: `sha-${slice_id}`, file: `file_${slice_id}.json` })),
    completeness: {
      counts: {
        full: spec.completeness === "full" || !spec.completeness ? qualitySlices.length : 0,
        partial: spec.completeness === "partial" ? qualitySlices.length : 0,
        truncated: 0,
        none: spec.http && spec.http !== 200 ? qualitySlices.length : 0,
      },
    },
  };
  const qualityRequests = qualitySlices.map((slice_id) => ({
    slice_id,
    http_status: spec.http ?? 200,
    completeness: spec.completeness ?? "full",
    row_count: spec.rowCount ?? spec.rows.filter((r) => r.slice_id === slice_id).length,
    missing_metrics: spec.missingMetrics ?? [],
    missing_dimensions: spec.missingDimensions ?? [],
    truncated_queries: Array.from({ length: spec.truncatedQueries ?? 0 }, () => ({})),
    duplicate_rows: spec.duplicateRows ?? 0,
    query_count_mismatch: spec.queryCountMismatch ?? false,
    ratio_weighting: "none",
  }));
  const duplicated = spec.qualityDuplicate?.length
    ? [...qualityRequests, ...qualityRequests.filter((r) => spec.qualityDuplicate!.includes(r.slice_id))]
    : qualityRequests;
  const quality = { requests: spec.qualityRaw ?? duplicated };
  const toLine = (r: Row) => [r.date, r.slice_id, 3035, "table", r.dimension_1 ?? "", r.dimension_2 ?? "", r.metric, r.metric_kind ?? "additive", r.value].join(",");
  const csv = [HEADER, ...spec.rows.map(toLine)].join("\n");

  await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(join(dir, "quality.json"), `${JSON.stringify(quality, null, 2)}\n`);
  await Bun.write(join(dir, "observations_7745.csv"), `${csv}\n`);
  // агрегатный CSV отличается от наблюдений, иначе дедупликация по sha256 схлопнула бы два артефакта
  await Bun.write(join(dir, "aggregate_7745.csv"), `${HEADER}\n${spec.rows.filter((r) => r.date).map(toLine).join("\n")}\n`);
  return dir;
}

const daily = (date: string, value: string | number, over: Partial<Row> = {}): Row => ({
  date,
  slice_id: 20403,
  metric: "qty_orders_delivered",
  value,
  ...over,
});

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "dds-ingest-db-"));
  return openStore(join(dir, "forecasting.sqlite"));
}

/** Счётчики всех таблиц, в которые импорт может писать: отказ не должен оставлять следов. */
function tableCounts(store: Awaited<ReturnType<typeof openStore>>) {
  const count = (table: string) => (store.db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  return {
    shops: count("shops"),
    extraction_runs: count("extraction_runs"),
    raw_extractions: count("raw_extractions"),
    daily_metrics: count("daily_metrics"),
    domain_events: count("domain_events"),
  };
}

/** Полностью чистый срез quality.json (все обязательные поля корректны). */
const cleanQuality = (sliceId: number) => ({
  slice_id: sliceId,
  http_status: 200,
  completeness: "full",
  row_count: 1,
  missing_metrics: [],
  missing_dimensions: [],
  truncated_queries: [],
  duplicate_rows: 0,
  query_count_mismatch: false,
});

describe("validateArtifacts: состав срезов", () => {
  test("пять срезов в манифесте и пять в CSV — PASS", async () => {
    const slices = [20403, 20404, 20405, 20623, 20624];
    const rows = slices.map((slice_id) => daily("2026-11-01", 10, { slice_id }));
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, manifestSlices: slices }, "five-five")));

    expect(result.ok).toBe(true);
    expect(result.slices_in_manifest).toEqual(slices);
    expect(result.slices_with_rows).toEqual(slices);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.invariants.shop_no).toBe("7745");
  });

  test("пять срезов в манифесте и четыре в CSV — ERROR", async () => {
    const slices = [20403, 20404, 20405, 20623, 20624];
    const rows = slices.slice(0, 4).map((slice_id) => daily("2026-11-01", 10, { slice_id }));
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, manifestSlices: slices }, "five-four")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("20624") && f.message.includes("строк в CSV нет"))).toBe(true);
  });

  test("срез из манифеста без строк — ERROR", async () => {
    const rows = [daily("2026-11-01", 10, { slice_id: 20403 })];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, manifestSlices: [20403, 20404] }, "empty-slice")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("срез 20404") && f.message.includes("строк в CSV нет"))).toBe(true);
  });

  test("неизвестный slice_id в CSV — ERROR", async () => {
    const rows = [daily("2026-11-01", 10, { slice_id: 20403 }), daily("2026-11-01", 10, { slice_id: 99999 })];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, manifestSlices: [20403] }, "unknown-slice")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("99999") && f.message.includes("отсутствует в манифесте"))).toBe(true);
  });

  test("дублирующийся slice_id в манифесте — ERROR", async () => {
    const rows = [daily("2026-11-01", 10, { slice_id: 20403 })];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, manifestSlices: [20403, 20403] }, "dup-slice")));

    expect(result.ok).toBe(false);
    expect(result.duplicate_slice_ids).toEqual([20403]);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("повторяются slice_id"))).toBe(true);
  });

  test("нет записи в quality.json для ожидаемого среза — ERROR", async () => {
    const rows = [daily("2026-11-01", 10, { slice_id: 20403 }), daily("2026-11-01", 10, { slice_id: 20404 })];
    const result = validateArtifacts(
      await readRunArtifacts(await writeRun({ rows, manifestSlices: [20403, 20404], qualityOmit: [20404] }, "no-quality")),
    );

    expect(result.ok).toBe(false);
    expect(result.slices_missing_quality).toEqual([20404]);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("20404") && f.message.includes("нет записи в quality.json"))).toBe(true);
  });
});

describe("validateArtifacts: качество и ключ", () => {
  test("дубли наблюдений — ERROR", async () => {
    const rows = [daily("2026-11-01", 10), daily("2026-11-01", 10)];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, rowCount: 1 }, "dup-rows")));

    expect(result.ok).toBe(false);
    expect(result.duplicate_keys).toBe(1);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("natural key"))).toBe(true);
  });

  test("missing_metrics > 0 — ERROR", async () => {
    const rows = [daily("2026-11-01", 10)];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, missingMetrics: ["qty_orders_declined"] }, "missing-metrics")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("отсутствуют метрики"))).toBe(true);
  });

  test("duplicate_rows > 0 — ERROR", async () => {
    const rows = [daily("2026-11-01", 10)];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, duplicateRows: 3 }, "dup-quality")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("дубли строк: 3"))).toBe(true);
  });

  test("HTTP != 200 и completeness != full — ERROR", async () => {
    const rows = [daily("2026-11-01", 10)];
    const serverError = validateArtifacts(await readRunArtifacts(await writeRun({ rows, http: 500 }, "http-500")));
    expect(serverError.ok).toBe(false);
    expect(serverError.findings.some((f) => f.severity === "error" && f.message.includes("HTTP 500"))).toBe(true);

    const partial = validateArtifacts(await readRunArtifacts(await writeRun({ rows, completeness: "partial" }, "partial-run")));
    expect(partial.ok).toBe(false);
    expect(partial.findings.some((f) => f.severity === "error" && f.message.includes("полнота «partial»"))).toBe(true);
  });

  test("HTTP 200 + completeness full + missing_metrics > 0 — не full/actual", () => {
    const status = sliceStatusFromQuality({
      slice_id: 20403,
      http_status: 200,
      completeness: "full",
      missing_metrics: ["qty_orders_declined"],
      missing_dimensions: [],
      duplicate_rows: 0,
      truncated_queries: [],
      query_count_mismatch: false,
    });

    expect(status.importable_as_full).toBe(false);
    expect(status.data_status).not.toBe("full");
    expect(status.data_status).toBe("partial");
    expect(status.evidence_status).not.toBe("actual");
    expect(status.evidence_status).toBe("unknown");
  });

  test("HTTP 200 + completeness full + duplicate_rows > 0 — не full/actual", () => {
    const status = sliceStatusFromQuality({
      slice_id: 20403,
      http_status: 200,
      completeness: "full",
      missing_metrics: [],
      missing_dimensions: [],
      duplicate_rows: 5,
      truncated_queries: [],
      query_count_mismatch: false,
    });

    expect(status.importable_as_full).toBe(false);
    expect(status.data_status).toBe("partial");
    expect(status.evidence_status).toBe("unknown");
  });

  test("чистый срез — full/actual, ключ совпадает с SQLite natural key", async () => {
    const rows = [daily("2026-11-01", 10)];
    const artifacts = await readRunArtifacts(await writeRun({ rows }, "clean-slice"));
    const result = validateArtifacts(artifacts, { transformVersion: "v7" });

    expect(result.ok).toBe(true);
    expect(result.natural_key_fields).toEqual([
      "shop_no",
      "date",
      "slice_id",
      "dimension_1",
      "dimension_2",
      "metric",
      "transform_version",
    ]);
    expect(result.invariants).toEqual({ shop_no: "7745", transform_version: "v7" });
    expect(result.slice_statuses[0]!.data_status).toBe("full");
    expect(result.slice_statuses[0]!.evidence_status).toBe("actual");
    expect(result.slice_statuses[0]!.importable_as_full).toBe(true);
  });

  test("отсутствие shopno в манифесте — ERROR (инвариант ключа не определён)", async () => {
    const rows = [daily("2026-11-01", 10)];
    const dir = await writeRun({ rows, shopno: "" }, "no-shopno");
    const result = validateArtifacts(await readRunArtifacts(dir));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("shopno"))).toBe(true);
  });

  test("несовпадение shopno с ожидаемым — ERROR", async () => {
    const rows = [daily("2026-11-01", 10)];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows }, "shop-mismatch")), { expectedShopNo: "9999" });

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("не разрешён") && f.message.includes("9999"))).toBe(true);
  });
});

describe("importRun", () => {
  test("загружает наблюдения, сохраняет провенанс и итоги запуска", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", 12), { date: "", slice_id: 20403, metric: "qty_orders_delivered", value: 22 }] }, "ok");
    const store = await makeStore();
    try {
      const summary = await importRun({ store }, { runDir, sourceLabel: "legacy-6w", transformVersion: "v1" });

      expect(summary.inserted).toBe(2);
      expect(summary.updated).toBe(0);
      expect(summary.skipped_rows).toBe(1); // строка «итог за период» в daily_metrics не пишется
      expect(summary.raw_payloads_new).toBe(4); // manifest, quality, observations, aggregate
      expect(summary.raw_payloads_duplicate).toBe(0);
      expect(summary.quality_status).toBe("full");

      const run = store.raw.getRun(summary.run_id)!;
      expect(run.status).toBe("completed");
      expect(run.rows_raw).toBe(3);
      expect(run.rows_loaded).toBe(2);
      expect(run.period_from).toBe("2026-10-13");

      const rows = store.metrics.getDailyMetrics({ shop_no: "7745" });
      expect(rows.length).toBe(2);
      const first = rows[0]!;
      expect(first.evidence_status).toBe("actual");
      expect(first.data_status).toBe("full");
      expect(first.transform_version).toBe("v1");
      expect(first.request_sha256).toBe("sha-20403");
      expect(first.unit).toBe("count");
    } finally {
      store.close();
    }
  });

  test("повторный импорт идемпотентен: строк не добавляется, payload'ы не дублируются", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", 12)] }, "idem");
    const store = await makeStore();
    try {
      const first = await importRun({ store }, { runDir, sourceLabel: "legacy-6w", transformVersion: "v1" });
      const second = await importRun({ store }, { runDir, sourceLabel: "api-refresh", transformVersion: "v1" });

      expect(first.inserted).toBe(2);
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(2);
      expect(second.raw_payloads_new).toBe(0);
      expect(second.raw_payloads_duplicate).toBe(4);
      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(2);
      expect(store.raw.listRuns().length).toBe(2);
    } finally {
      store.close();
    }
  });

  test("маскированная и «сырая» версии одного наблюдения не размножаются в две строки", async () => {
    const legacy = await writeRun({ rows: [daily("2026-11-01", 10, { dimension_1: "<ФИО>" })] }, "mask-legacy");
    const refresh = await writeRun({ rows: [daily("2026-11-01", 10, { dimension_1: ["Иванов", "Иван"].join(" ") })] }, "mask-refresh");
    const store = await makeStore();
    try {
      const first = await importRun({ store }, { runDir: legacy, sourceLabel: "legacy-6w", transformVersion: "v1" });
      const second = await importRun({ store }, { runDir: refresh, sourceLabel: "api-refresh", transformVersion: "v1" });

      expect(first.inserted).toBe(1);
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(1);

      const rows = store.metrics.getDailyMetrics({ shop_no: "7745" });
      expect(rows.length).toBe(1);
      expect(rows[0]!.dimension_1).toBe("<ФИО>");
      expect(JSON.stringify(rows)).not.toContain("Иванов");
    } finally {
      store.close();
    }
  });

  test("разные дарксторы не считаются одним наблюдением", async () => {
    const rows = [daily("2026-11-01", 10)];
    const first = await writeRun({ rows, shopno: "7745" }, "shop-a");
    const second = await writeRun({ rows, shopno: "9999" }, "shop-b");
    const store = await makeStore();
    try {
      const a = await importRun({ store }, { runDir: first, sourceLabel: "a", transformVersion: "v1" });
      // другой магазин разрешён только при явном указании ожидаемого значения
      const b = await importRun({ store }, { runDir: second, sourceLabel: "b", transformVersion: "v1", shopNo: "9999" });

      expect(a.inserted).toBe(1);
      expect(b.inserted).toBe(1); // тот же date/slice/измерения/метрика, но другой магазин
      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(1);
      expect(store.metrics.getDailyMetrics({ shop_no: "9999" }).length).toBe(1);
    } finally {
      store.close();
    }
  });

  test("разные версии преобразования не считаются одним наблюдением", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "versions");
    const store = await makeStore();
    try {
      const v1 = await importRun({ store }, { runDir, sourceLabel: "v1", transformVersion: "v1" });
      const v2 = await importRun({ store }, { runDir, sourceLabel: "v2", transformVersion: "v2" });

      expect(v1.inserted).toBe(1);
      expect(v2.inserted).toBe(1);
      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(2);
      expect(store.metrics.getDailyMetrics({ shop_no: "7745", transform_version: "v1" }).length).toBe(1);
      expect(store.metrics.getDailyMetrics({ shop_no: "7745", transform_version: "v2" }).length).toBe(1);
    } finally {
      store.close();
    }
  });

  test("отсутствующее значение остаётся NULL, достоверность понижается до unknown", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", "")] }, "null-value");
    const store = await makeStore();
    try {
      await importRun({ store }, { runDir, sourceLabel: "legacy-6w", transformVersion: "v1" });
      const rows = store.metrics.getDailyMetrics({ shop_no: "7745" });
      expect(rows.length).toBe(2);
      // качество среза чистое, но конкретное наблюдение без значения не является фактом
      expect(rows.find((r) => r.date === "2026-11-02")!.value).toBeNull();
      expect(rows.find((r) => r.date === "2026-11-02")!.evidence_status).toBe("unknown");
      expect(rows.find((r) => r.date === "2026-11-01")!.evidence_status).toBe("actual");
    } finally {
      store.close();
    }
  });

  test("невалидный срез не импортируется и не получает full/actual", async () => {
    const store = await makeStore();
    try {
      const incomplete = await writeRun({ rows: [daily("2026-11-01", 10)], completeness: "partial" }, "no-import-partial");
      await expect(importRun({ store }, { runDir: incomplete, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/полнота «partial»/);

      const withMissingMetrics = await writeRun({ rows: [daily("2026-11-01", 10)], missingMetrics: ["qty_orders_declined"] }, "no-import-metrics");
      await expect(importRun({ store }, { runDir: withMissingMetrics, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/отсутствуют метрики/);

      const withDuplicates = await writeRun({ rows: [daily("2026-11-01", 10)], duplicateRows: 2 }, "no-import-dups");
      await expect(importRun({ store }, { runDir: withDuplicates, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/дубли строк/);

      const serverError = await writeRun({ rows: [daily("2026-11-01", 10)], http: 500 }, "no-import-500");
      await expect(importRun({ store }, { runDir: serverError, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/HTTP 500/);

      // ни одна строка не записана: неполный набор не превращается в факт
      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(0);
      expect(store.raw.listRuns().length).toBe(0);
    } finally {
      store.close();
    }
  });

  test("импорт отклоняется при дублях наблюдений и некорректной дате", async () => {
    const store = await makeStore();
    try {
      const duplicates = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-01", 10)], rowCount: 1 }, "dup");
      await expect(importRun({ store }, { runDir: duplicates, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/дублирующихся наблюдений/);

      const badDate = await writeRun({ rows: [{ date: "01.11.2026", slice_id: 20403, metric: "qty_orders_delivered", value: 1 }] }, "bad-date");
      await expect(importRun({ store }, { runDir: badDate, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/дата не в ISO/);

      const noKind = await writeRun({ rows: [{ date: "2026-11-01", slice_id: 20403, metric: "qty_orders_delivered", metric_kind: "", value: 1 }] }, "no-kind");
      await expect(importRun({ store }, { runDir: noKind, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/metric_kind/);

      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(0);
    } finally {
      store.close();
    }
  });

  test("несовпадение ожидаемого даркстора — импорт отклонён", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10)], shopno: "7745" }, "expected-shop");
    const store = await makeStore();
    try {
      await expect(
        importRun({ store }, { runDir, sourceLabel: "x", transformVersion: "v1", shopNo: "8519" }),
      ).rejects.toThrow(/не разрешён/);
      expect(store.metrics.getDailyMetrics({ shop_no: "7745" }).length).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("validateArtifacts: quality.json, магазин и строгие типы", () => {
  test("дублирующийся slice_id в quality.json — ERROR, молчаливой перезаписи нет", async () => {
    const rows = [daily("2026-11-01", 10)];
    const artifacts = await readRunArtifacts(await writeRun({ rows, qualityDuplicate: [20403] }, "dup-quality-slice"));
    const result = validateArtifacts(artifacts);

    expect(result.ok).toBe(false);
    expect(result.duplicate_quality_slice_ids).toEqual([20403]);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("в quality.json повторяются slice_id"))).toBe(true);
    // в Map осталась первая запись, а не последняя
    expect(result.slice_statuses.length).toBe(1);
  });

  test("дублирующийся slice_id в quality.json блокирует импорт и не создаёт записей", async () => {
    const rows = [daily("2026-11-01", 10)];
    const runDir = await writeRun({ rows, qualityDuplicate: [20403] }, "dup-quality-import");
    const store = await makeStore();
    try {
      await expect(importRun({ store }, { runDir, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/повторяются slice_id/);
      expect(tableCounts(store)).toEqual({ shops: 0, extraction_runs: 0, raw_extractions: 0, daily_metrics: 0, domain_events: 0 });
    } finally {
      store.close();
    }
  });

  test("неправильный shop_no — ERROR по умолчанию (ожидается 7745)", async () => {
    const rows = [daily("2026-11-01", 10)];
    const result = validateArtifacts(await readRunArtifacts(await writeRun({ rows, shopno: "9999" }, "wrong-shop")));

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("не разрешён") && f.message.includes("7745"))).toBe(true);
  });

  test("другой магазин разрешается только явным указанием", async () => {
    const rows = [daily("2026-11-01", 10)];
    const artifacts = await readRunArtifacts(await writeRun({ rows, shopno: "8519" }, "explicit-shop"));

    expect(validateArtifacts(artifacts).ok).toBe(false);
    expect(validateArtifacts(artifacts, { expectedShopNo: "8519" }).ok).toBe(true);
    expect(validateArtifacts(artifacts, { allowedShopNos: ["7745", "8519"] }).ok).toBe(true);
    expect(validateArtifacts(artifacts, { allowedShopNos: ["7745", "9999"] }).ok).toBe(false);
  });

  test("импорт другого магазина без явного указания отклоняется и не создаёт записей", async () => {
    const rows = [daily("2026-11-01", 10)];
    const runDir = await writeRun({ rows, shopno: "8519" }, "wrong-shop-import");
    const store = await makeStore();
    try {
      await expect(importRun({ store }, { runDir, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/не разрешён/);
      expect(tableCounts(store)).toEqual({ shops: 0, extraction_runs: 0, raw_extractions: 0, daily_metrics: 0, domain_events: 0 });
    } finally {
      store.close();
    }
  });

  test("некорректный duplicate_rows — безопасный отказ, а не успешная проверка", () => {
    for (const bad of ["0", null, -1, Number.NaN]) {
      const status = sliceStatusFromQuality({ ...cleanQuality(20403), duplicate_rows: bad });
      expect(status.importable_as_full, `duplicate_rows=${JSON.stringify(bad)}`).toBe(false);
      expect(status.data_status).not.toBe("full");
      expect(status.evidence_status).toBe("unknown");
      expect(status.reasons.some((r) => r.includes("duplicate_rows"))).toBe(true);
    }
  });

  test("некорректные значения обязательных полей quality — безопасный отказ", () => {
    const cases: Array<[string, any, string]> = [
      ["http_status строкой", { http_status: "200" }, "http_status"],
      ["http_status отсутствует", { http_status: undefined }, "http_status"],
      ["completeness неизвестное", { completeness: "ok" }, "completeness"],
      ["completeness числом", { completeness: 3 }, "completeness"],
      ["missing_metrics не массив", { missing_metrics: "нет" }, "missing_metrics"],
      ["missing_metrics с не-строкой", { missing_metrics: [42] }, "missing_metrics"],
      ["missing_dimensions не массив", { missing_dimensions: {} }, "missing_dimensions"],
      ["truncated_queries строкой", { truncated_queries: "обрезано" }, "truncated_queries"],
      ["query_count_mismatch строкой", { query_count_mismatch: "false" }, "query_count_mismatch"],
    ];

    for (const [label, patch, expectedReason] of cases) {
      const request: any = { ...cleanQuality(20403) };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete request[key];
        else request[key] = value;
      }
      const status = sliceStatusFromQuality(request);
      expect(status.importable_as_full, label).toBe(false);
      expect(status.evidence_status, label).not.toBe("actual");
      expect(status.reasons.some((r) => r.includes(expectedReason)), label).toBe(true);
    }
  });

  test("отсутствующие обязательные поля quality — безопасный отказ", () => {
    const request: any = cleanQuality(20403);
    delete request.missing_metrics;
    delete request.truncated_queries;
    delete request.query_count_mismatch;
    delete request.duplicate_rows;

    const status = sliceStatusFromQuality(request);
    expect(status.importable_as_full).toBe(false);
    expect(status.reasons).toEqual(
      expect.arrayContaining([
        "отсутствует поле missing_metrics",
        "отсутствует поле truncated_queries",
        "отсутствует поле query_count_mismatch",
        "отсутствует поле duplicate_rows",
      ]),
    );
  });

  test("все чистые срезы получают full/actual", async () => {
    const slices = [20403, 20404, 20405, 20623, 20624];
    const rows = slices.map((slice_id) => daily("2026-11-01", 10, { slice_id }));
    const result = validateArtifacts(
      await readRunArtifacts(await writeRun({ rows, manifestSlices: slices, qualityRaw: slices.map(cleanQuality) }, "all-clean")),
    );

    expect(result.ok).toBe(true);
    expect(result.slice_statuses.map((s) => [s.slice_id, s.data_status, s.evidence_status])).toEqual(
      slices.map((slice_id) => [slice_id, "full", "actual"]),
    );
  });

  test("любой дефект качества блокирует импорт и не создаёт записей ни в одной таблице", async () => {
    const rows = [daily("2026-11-01", 10)];
    const cases: Array<[string, RunSpec, RegExp]> = [
      ["неполный ответ", { rows, completeness: "partial" }, /полнота «partial»/],
      ["HTTP 500", { rows, http: 500 }, /HTTP 500/],
      ["отсутствуют метрики", { rows, missingMetrics: ["qty_orders_declined"] }, /отсутствуют метрики/],
      ["дубли строк", { rows, duplicateRows: 2 }, /дубли строк/],
      ["обрезанные запросы", { rows, truncatedQueries: 1 }, /обрезанные запросы/],
      ["несовпадение числа ответов", { rows, queryCountMismatch: true }, /число ответов не совпало/],
      ["некорректное completeness", { rows, qualityRaw: [{ ...cleanQuality(20403), completeness: "ok" }] }, /некорректный completeness/],
      ["некорректный duplicate_rows", { rows, qualityRaw: [{ ...cleanQuality(20403), duplicate_rows: "0" }] }, /некорректный duplicate_rows/],
    ];

    const store = await makeStore();
    try {
      for (const [label, spec, pattern] of cases) {
        const runDir = await writeRun(spec, `blocked-${Math.random().toString(36).slice(2, 8)}`);
        await expect(importRun({ store }, { runDir, sourceLabel: "x", transformVersion: "v1" }), label).rejects.toThrow(pattern);
        expect(tableCounts(store), label).toEqual({ shops: 0, extraction_runs: 0, raw_extractions: 0, daily_metrics: 0, domain_events: 0 });
      }
    } finally {
      store.close();
    }
  });
});

describe("план мероприятий", () => {
  test("readPlan декодирует CP1251 и разбирает разделитель «;»", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-plan-"));
    const path = join(dir, "plan.csv");
    const asciiHeader = "Day;Time;Task;Responsible;Controller;Result;Risk;Mitigation\n";
    const row = "Day 1;09:00-10:00;";
    const cyrillicA = Uint8Array.of(0xc0); // 'А' в CP1251
    const rest = ";You;You;result;risk;mitigation\n";
    const bytes = Buffer.concat([Buffer.from(asciiHeader, "latin1"), Buffer.from(row, "latin1"), Buffer.from(cyrillicA), Buffer.from(rest, "latin1")]);
    await Bun.write(path, bytes);

    const items = await readPlan(path);
    expect(items.length).toBe(1);
    expect(items[0]!.task).toBe("А");
    expect(items[0]!.day).toBe("Day 1");
    expect(items[0]!.ordinal).toBe(1);
  });

  test("план импортируется как плановые мероприятия и повторяется идемпотентно", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-plan2-"));
    const path = join(dir, "plan.csv");
    const header = "Day;Time;Task;Responsible;Controller;Result;Risk;Mitigation\n";
    const rows = [
      "Day 1 (Mon);09:00-10:00;Meeting with curators;You;You;Curators understand the task;Resistance;Explain the goal\n",
      ";10:00-13:00;Export statistics;You;You;Table with numbers;Data incomplete;Cross-check sources\n",
      "Day 2 (Tue);09:00-12:00;Walk the darkstore;;You;Checklist;Formal walk;Photo evidence\n",
    ].join("");
    await Bun.write(path, header + rows);

    const store = await makeStore();
    try {
      const first = await importPlan(store, { path, shopNo: "7745", now: new Date(AT) });
      expect(first.items).toBe(3);
      expect(first.inserted).toBe(3);

      const second = await importPlan(store, { path, shopNo: "7745", now: new Date(AT) });
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(3);

      const events = store.events.getEvents("7745");
      expect(events.length).toBe(3);
      expect(events.every((e) => e.status === "planned")).toBe(true);
      expect(events.every((e) => e.evidence_status === "planned")).toBe(true);
      expect(events.every((e) => e.actual_start === null && e.actual_end === null)).toBe(true);
      expect(events.every((e) => e.verification_result === "требует подтверждения")).toBe(true);
      expect(events[2]!.ledger_note).toContain("Day 2");
      expect(events[0]!.event_type).toBe("plan_item_01");
    } finally {
      store.close();
    }
  });
});

describe("CLI импорта", () => {
  test("импортирует выгрузку и план, возвращает 0 и сводку", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "cli");
    const dir = await mkdtemp(join(tmpdir(), "dds-ingest-cli-"));
    const dbPath = join(dir, "forecasting.sqlite");
    const planPath = join(dir, "plan.csv");
    await Bun.write(planPath, "Day;Time;Task;Responsible;Controller;Result;Risk;Mitigation\nDay 1;09:00;Task;You;You;Result;Risk;Mitigation\n");

    const proc = Bun.spawnSync({
      cmd: ["bun", join(import.meta.dir, "..", "..", "src", "forecasting", "cli", "import.ts"), "--run", runDir, "--label", "cli-test", "--plan", planPath, "--db", dbPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.run.inserted).toBe(1);
    expect(output.plan.items).toBe(1);
    expect(output.totals.daily_metrics).toBe(1);
    expect(output.totals.domain_events).toBe(1);
  });
});
