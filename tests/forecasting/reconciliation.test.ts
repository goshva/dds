// Этап 2: сверка выгрузок — все типы расхождений на синтетических наборах.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareRuns } from "../../src/forecasting/reconciliation/comparison";
import { loadRun, parseCsv } from "../../src/forecasting/reconciliation/normalizer";
import { buildReconciliationReport, suitability } from "../../src/forecasting/reconciliation/reconciliation-report";
import { classifyValue } from "../../src/forecasting/reconciliation/difference-classifier";

const AT = "2026-11-23T17:00:00.000Z";
const HEADER = "date,slice_id,dataset_id,viz_type,dimension_1,dimension_2,metric,metric_kind,value";

interface Row {
  date: string;
  slice_id: number;
  dimension_1?: string;
  dimension_2?: string;
  metric: string;
  metric_kind?: string;
  value: string | number;
  dataset_id?: number;
}

interface RunSpec {
  period?: { from: string; to: string; time_range?: string; weeks?: number };
  slices?: number[];
  completeness?: string;
  http?: number;
  row_count?: number;
  rows: Row[];
}

/** Пишет синтетический каталог выгрузки и возвращает его путь. */
async function writeRun(spec: RunSpec, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dds-recon-${name}-`));
  const slices = spec.slices ?? [...new Set(spec.rows.map((r) => r.slice_id))];
  const period = spec.period ?? { from: "2026-10-13", to: "2026-11-23", time_range: "2026-10-13 : 2026-11-23", weeks: 6 };

  const manifest = {
    generated_at: AT,
    shopno: "7745",
    period,
    sources: slices.map((slice_id) => ({
      slice_id,
      datasource_id: 3035,
      request_sha256: `sha-${slice_id}`,
      file: `tools/har-out/1${String(slice_id).slice(-2)}_request.json`,
    })),
  };
  const quality = {
    requests: slices.map((slice_id) => ({
      slice_id,
      http_status: spec.http ?? 200,
      completeness: spec.completeness ?? "full",
      row_count: spec.row_count ?? spec.rows.filter((r) => r.slice_id === slice_id).length,
      missing_metrics: [],
      missing_dimensions: [],
      truncated_queries: [],
      duplicate_rows: 0,
      query_count_mismatch: false,
      ratio_weighting: "none",
    })),
  };
  const csv = [
    HEADER,
    ...spec.rows.map((r) =>
      [
        r.date,
        r.slice_id,
        r.dataset_id ?? 3035,
        "table",
        r.dimension_1 ?? "",
        r.dimension_2 ?? "",
        r.metric,
        r.metric_kind ?? "additive",
        r.value,
      ].join(","),
    ),
  ].join("\n");

  await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(join(dir, "quality.json"), `${JSON.stringify(quality, null, 2)}\n`);
  await Bun.write(join(dir, "observations_7745.csv"), `${csv}\n`);
  return dir;
}

const daily = (date: string, value: number | string, over: Partial<Row> = {}): Row => ({
  date,
  slice_id: 20403,
  metric: "qty_orders_delivered",
  value,
  ...over,
});

describe("normalizer", () => {
  test("разбирает CSV с кавычками и вычисляет ключи, дубли и итоги", async () => {
    const dir = await writeRun(
      {
        rows: [
          daily("2026-11-01", 10),
          daily("2026-11-01", 10), // дубль по ключу
          { date: "", slice_id: 20403, metric: "qty_orders_delivered", value: 20 }, // итог за период
          { date: "2026-11-02", slice_id: 20403, dimension_1: 'служба "А"', metric: "qty_orders_delivered", value: 5 },
        ],
      },
      "norm",
    );
    const run = await loadRun(dir);
    expect(run.shop_no).toBe("7745");
    expect(run.observations.length).toBe(4);
    expect(run.total_rows).toBe(1);
    expect(run.duplicates.length).toBe(1);
    expect(run.by_key.size).toBe(3);
    expect(run.metric_set_by_slice.get(20403)).toEqual(["qty_orders_delivered"]);
  });

  test("parseCsv разбирает кавычки, запятые и переводы строк внутри поля", () => {
    const { header, rows } = parseCsv('a,b\n"x,1","y\n2"\n');
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["x,1", "y\n2"]]);
  });
});

describe("сравнение: базовые категории", () => {
  test("IDENTICAL — полное совпадение", async () => {
    const rows = [daily("2026-11-01", 10), daily("2026-11-02", 12)];
    const oldDir = await writeRun({ rows }, "same-old");
    const newDir = await writeRun({ rows }, "same-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("IDENTICAL");
    expect(result.counts.identical).toBe(2);
    expect(result.counts.value_changed).toBe(0);
    expect(result.diffs).toEqual([]);
  });

  test("VALUE_CHANGED — значение изменилось", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "val-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 11)] }, "val-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("DATA_CHANGED");
    expect(result.counts.value_changed).toBe(1);
    const diff = result.diffs.find((d) => d.category === "VALUE_CHANGED")!;
    expect(diff.old_value).toBe(10);
    expect(diff.new_value).toBe(11);
    expect(diff.abs_delta).toBe(1);
    expect(diff.scope).toBe("daily");
  });

  test("NEW_ROW — новая запись", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "new-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", 5)] }, "new-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.counts.new_rows).toBe(1);
    expect(result.diffs.some((d) => d.category === "NEW_ROW" && d.date === "2026-11-02")).toBe(true);
    expect(result.status).toBe("MATCH_WITH_MINOR_DIFFERENCES");
  });

  test("MISSING_ROW — запись исчезла", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", 5)] }, "miss-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "miss-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.counts.missing_rows).toBe(1);
    const diff = result.diffs.find((d) => d.category === "MISSING_ROW")!;
    expect(diff.date).toBe("2026-11-02");
    expect(diff.new_value).toBeNull();
  });

  test("SCHEMA_CHANGED — изменился состав метрик среза", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10)] }, "schema-old");
    const newDir = await writeRun(
      { rows: [daily("2026-11-01", 10), { date: "2026-11-01", slice_id: 20403, metric: "qty_orders_declined", value: 2 }] },
      "schema-new",
    );
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.slices.new).toEqual([20403]);
    expect(result.per_slice[0]!.metric_set_changed).toBe(true);
    const diff = result.diffs.find((d) => d.category === "SCHEMA_CHANGED" && d.scope === "metric_set")!;
    expect(diff.detail).toContain("qty_orders_declined");
    expect(result.status).toBe("MATCH_WITH_MINOR_DIFFERENCES");
  });

  test("SCHEMA_CHANGED — изменилось измерение при том же периоде и метрике", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10, { dimension_1: "Служба A" })] }, "dim-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 10, { dimension_1: "Служба B" })] }, "dim-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    const diff = result.diffs.find((d) => d.category === "SCHEMA_CHANGED" && d.scope === "dimension");
    expect(diff).toBeDefined();
    expect(diff!.detail).toContain("Служба A");
    expect(diff!.detail).toContain("Служба B");
  });

  test("UNKNOWN — несопоставимые нечисловые значения", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", "н/д")] }, "unk-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 5)] }, "unk-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.counts.value_changed).toBe(1);
    expect(result.diffs.some((d) => d.category === "UNKNOWN")).toBe(true);
  });
});

describe("сравнение: качество, доступ и период", () => {
  test("INCOMPLETE — частичный ответ API", async () => {
    const rows = [daily("2026-11-01", 10)];
    const oldDir = await writeRun({ rows }, "part-old");
    const newDir = await writeRun({ rows, completeness: "partial" }, "part-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("INCOMPLETE");
    expect(result.quality_changes.some((c) => c.field === "completeness" && c.degraded)).toBe(true);
    expect(result.diffs.some((d) => d.category === "QUALITY_DEGRADED")).toBe(true);
  });

  test("BLOCKED — доступ запрещён (403)", async () => {
    const rows = [daily("2026-11-01", 10)];
    const oldDir = await writeRun({ rows }, "acc-old");
    const newDir = await writeRun({ rows, http: 403, completeness: "none" }, "acc-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("BLOCKED");
    expect(result.access_changed).toBe(true);
    expect(result.diffs.some((d) => d.category === "ACCESS_CHANGED")).toBe(true);
  });

  test("PERIOD_MISMATCH — не совпадает период, сравнение недействительно", async () => {
    const rows = [daily("2026-11-01", 10)];
    const oldDir = await writeRun({ rows }, "per-old");
    const newDir = await writeRun(
      { rows, period: { from: "2026-10-06", to: "2026-11-23", time_range: "2026-10-06 : 2026-11-23", weeks: 7 } },
      "per-new",
    );
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.period_mismatch).toBe(true);
    expect(result.diffs.some((d) => d.category === "PERIOD_MISMATCH")).toBe(true);
    expect(result.status).toBe("INCOMPLETE");
  });

  test("дубли фиксируются, но не удваивают сравнение", async () => {
    const dup = [daily("2026-11-01", 10), daily("2026-11-01", 10)];
    // row_count задаём явно: сравнение дублей не должно зависеть от метаданных качества
    const oldDir = await writeRun({ rows: dup, row_count: 1 }, "dup-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 10)], row_count: 1 }, "dup-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.counts.duplicates_old).toBe(1);
    expect(result.counts.compared).toBe(1);
    expect(result.counts.identical).toBe(1);
    expect(result.diffs).toEqual([]);
  });
});

describe("сравнение: итоги, срезы, допуск, маскирование", () => {
  test("итоги за период (пустая дата) сравниваются отдельно от дневных строк", async () => {
    const total = (value: number): Row => ({ date: "", slice_id: 20403, metric: "qty_orders_delivered", value });
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 10), total(10)] }, "tot-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 10), total(11)] }, "tot-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.counts.daily_identical).toBe(1);
    expect(result.counts.totals_identical).toBe(0);
    expect(result.counts.value_changed).toBe(1);
    const diff = result.diffs.find((d) => d.category === "VALUE_CHANGED")!;
    expect(diff.scope).toBe("total");
    expect(diff.old_value).toBe(10);
    expect(diff.new_value).toBe(11);
  });

  test("одинаковый дневной итог у разных срезов не суммируется", async () => {
    const rows = [
      { date: "2026-11-01", slice_id: 20403, metric: "qty_orders_delivered", value: 100 },
      { date: "2026-11-01", slice_id: 20404, metric: "qty_orders_delivered", value: 100 },
    ];
    const oldDir = await writeRun({ rows }, "slice-old");
    const newDir = await writeRun({ rows }, "slice-new");
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("IDENTICAL");
    expect(result.per_slice.length).toBe(2);
    expect(result.per_slice.map((s) => s.total_old)).toEqual([100, 100]);
    expect(result.per_slice.map((s) => s.total_new)).toEqual([100, 100]);
    expect(result.counts.identical).toBe(2);
  });

  test("допуск применяется только при явном задании", async () => {
    const oldDir = await writeRun({ rows: [daily("2026-11-01", 1.0)] }, "tol-old");
    const newDir = await writeRun({ rows: [daily("2026-11-01", 1.0000001)] }, "tol-new");

    const strict = compareRuns(await loadRun(oldDir), await loadRun(newDir));
    expect(strict.status).toBe("DATA_CHANGED");

    const relaxed = compareRuns(await loadRun(oldDir), await loadRun(newDir), { toleranceRel: 1e-6 });
    expect(relaxed.status).toBe("IDENTICAL");
    expect(relaxed.diffs).toEqual([]);
  });

  test("classifyValue: точное совпадение важнее допуска", () => {
    expect(classifyValue("10", "10", 10, 10, { abs: 5, rel: 0.5 }).category).toBe("IDENTICAL");
    expect(classifyValue("10", "20", 10, 20, { abs: 0, rel: 0 }).category).toBe("VALUE_CHANGED");
    expect(classifyValue("10.00", "10", 10, 10, { abs: 0, rel: 0 }).detail).toContain("числовое равенство");
  });

  test("маскирование не создаёт ложных расхождений и оценивается отдельно", async () => {
    // старая выгрузка хранится замаскированной, новая — «сырая»
    const oldDir = await writeRun(
      { rows: [daily("2026-11-01", 10, { dimension_1: "<ФИО>" })] },
      "mask-old",
    );
    const newDir = await writeRun(
      { rows: [daily("2026-11-01", 10, { dimension_1: ["Иванов", "Иван"].join(" ") })] },
      "mask-new",
    );
    const result = compareRuns(await loadRun(oldDir), await loadRun(newDir));

    expect(result.status).toBe("IDENTICAL");
    expect(result.diffs).toEqual([]);
    expect(result.masking.hidden_dimension_differences).toBe(1);
    expect(result.masking.masked_rows_old).toBe(1);
  });
});

describe("отчёт сверки", () => {
  test("содержит обязательные разделы, статус и вывод о пригодности", async () => {
    const oldRun = await loadRun(await writeRun({ rows: [daily("2026-11-01", 10)] }, "rep-old"));
    const newRun = await loadRun(await writeRun({ rows: [daily("2026-11-01", 12)] }, "rep-new"));
    const result = compareRuns(oldRun, newRun);
    const markdown = buildReconciliationReport({
      result,
      old_run: oldRun,
      new_run: newRun,
      authorization: "Авторизация: успешный вход (значения не сохраняются).",
      collection: { command: "bun tools/fetch-darkstore-aggregates.ts --live --yes", strategy: "per-slice" },
      chart_20209: "chart 20209: проверка выполнена отдельно.",
    });

    for (const section of [
      "## 1. Параметры API-сбора",
      "## 2. Источники и их статусы",
      "## 3. Авторизация",
      "## 4. Объёмы и результаты сравнения",
      "## 5. Сравнение по срезам",
      "## 6. Агрегаты по срезам",
      "## 7. Качество запросов",
      "## 8. Таблица расхождений",
      "## 9. Объяснения выявленных изменений",
      "## 10. Отдельная проверка chart 20209",
      "## 11. Вывод о пригодности данных",
    ]) {
      expect(markdown).toContain(section);
    }
    expect(markdown).toContain("DATA_CHANGED");
    expect(markdown).toContain("Требуется решение пользователя");
    expect(suitability(result)).toContain("Требуется решение пользователя");
  });
});
