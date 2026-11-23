// Этап 2: слой загрузки — идемпотентность, статусы, провенанс, план мероприятий.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPlan } from "../../src/forecasting/ingestion/artifact-reader";
import { importRun } from "../../src/forecasting/ingestion/importer";
import { importPlan } from "../../src/forecasting/ingestion/plan-loader";
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

async function writeRun(spec: { rows: Row[]; completeness?: string; http?: number; slices?: number[] }, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dds-ingest-${name}-`));
  const slices = spec.slices ?? [...new Set(spec.rows.map((r) => r.slice_id))];
  const manifest = {
    generated_at: AT,
    mode: "test",
    shopno: "7745",
    period: { from: "2026-10-13", to: "2026-11-23", time_range: "2026-10-13 : 2026-11-23", weeks: 6 },
    sources: slices.map((slice_id) => ({ slice_id, datasource_id: 3035, request_sha256: `sha-${slice_id}`, file: `file_${slice_id}.json` })),
    completeness: { counts: { full: spec.completeness === "full" || !spec.completeness ? slices.length : 0, partial: spec.completeness === "partial" ? slices.length : 0, truncated: 0, none: spec.http && spec.http !== 200 ? slices.length : 0 } },
  };
  const quality = {
    requests: slices.map((slice_id) => ({
      slice_id,
      http_status: spec.http ?? 200,
      completeness: spec.completeness ?? "full",
      row_count: spec.rows.filter((r) => r.slice_id === slice_id).length,
      missing_metrics: [],
      missing_dimensions: [],
      truncated_queries: [],
      duplicate_rows: 0,
      query_count_mismatch: false,
      ratio_weighting: "none",
    })),
  };
  const csv = [HEADER, ...spec.rows.map((r) => [r.date, r.slice_id, 3035, "table", r.dimension_1 ?? "", r.dimension_2 ?? "", r.metric, r.metric_kind ?? "additive", r.value].join(","))].join("\n");

  await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(join(dir, "quality.json"), `${JSON.stringify(quality, null, 2)}\n`);
  await Bun.write(join(dir, "observations_7745.csv"), `${csv}\n`);
  // агрегатный CSV отличается от наблюдений (в реальной выгрузке — 19 колонок),
  // иначе дедупликация по sha256 схлопнула бы два разных артефакта в один
  await Bun.write(join(dir, "aggregate_7745.csv"), `${HEADER}\n${spec.rows.filter((r) => r.date).map((r) => [r.date, r.slice_id, 3035, "table", r.dimension_1 ?? "", r.dimension_2 ?? "", r.metric, r.metric_kind ?? "additive", r.value].join(",")).join("\n")}\n`);
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
      // две версии данных живут как два отдельных запуска
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
      // в аналитической строке нет персональных данных
      expect(rows[0]!.dimension_1).toBe("<ФИО>");
      expect(JSON.stringify(rows)).not.toContain("Иванов");
    } finally {
      store.close();
    }
  });

  test("неполный ответ помечается partial/unknown, отсутствующее значение остаётся NULL", async () => {
    const runDir = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-02", "")], completeness: "partial" }, "partial");
    const store = await makeStore();
    try {
      await importRun({ store }, { runDir, sourceLabel: "legacy-6w", transformVersion: "v1" });
      const rows = store.metrics.getDailyMetrics({ shop_no: "7745" });
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.data_status === "partial")).toBe(true);
      expect(rows.every((r) => r.evidence_status === "unknown")).toBe(true);
      expect(rows.find((r) => r.date === "2026-11-02")!.value).toBeNull();
    } finally {
      store.close();
    }
  });

  test("импорт отклоняется при HTTP 500, дублях и некорректной дате", async () => {
    const store = await makeStore();
    try {
      const serverError = await writeRun({ rows: [daily("2026-11-01", 10)], http: 500 }, "500");
      await expect(importRun({ store }, { runDir: serverError, sourceLabel: "x", transformVersion: "v1" })).rejects.toThrow(/HTTP 500/);

      const duplicates = await writeRun({ rows: [daily("2026-11-01", 10), daily("2026-11-01", 10)] }, "dup");
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
    // содержимое в ASCII: проверка декодирования CP1251 — в отдельном тесте выше
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
