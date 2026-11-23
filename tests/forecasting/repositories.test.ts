// Этап 1: репозитории — происхождение, идемпотентность, выборки, разделение плана и факта.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase } from "../../src/forecasting/storage/sqlite/connection";
import { applyMigrations, loadMigrations } from "../../src/forecasting/storage/sqlite/migrations";
import { SqliteEventsRepository } from "../../src/forecasting/storage/sqlite/repositories/events-repository";
import { SqliteFeaturesRepository } from "../../src/forecasting/storage/sqlite/repositories/features-repository";
import { SqliteForecastRepository } from "../../src/forecasting/storage/sqlite/repositories/forecast-repository";
import { SqliteMetricsRepository } from "../../src/forecasting/storage/sqlite/repositories/metrics-repository";
import { SqliteRawRepository } from "../../src/forecasting/storage/sqlite/repositories/raw-repository";
import type { DailyMetricRow } from "../../src/forecasting/storage/interfaces/types";

const AT = "2026-11-23T10:00:00.000Z";
const SHOP = "7745";

async function makeDb() {
  const path = join(await mkdtemp(join(tmpdir(), "dds-fc-repo-")), "db.sqlite");
  const db = await openDatabase(path);
  applyMigrations(db, await loadMigrations());
  db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run(SHOP, "7745ДС", AT);
  return { db, path };
}

function metric(over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return {
    shop_no: SHOP,
    date: "2026-11-01",
    slice_id: 20403,
    chart_id: 20403,
    dataset_id: 3035,
    dimension_1: "",
    dimension_2: "",
    metric: "qty_orders_delivered",
    metric_kind: "additive",
    value: 1452,
    unit: "orders",
    evidence_status: "actual",
    data_status: "full",
    source_file: "observations_7745.csv",
    request_sha256: "abc",
    transform_version: "v1",
    loaded_at: AT,
    ...over,
  };
}

describe("SqliteRawRepository", () => {
  test("жизненный цикл запуска: создание, обновление, чтение, список", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteRawRepository(db);
      const runId = repo.createRun({
        started_at: AT,
        mode: "import-artifacts",
        shop_no: SHOP,
        period_from: "2026-10-13",
        period_to: "2026-11-22",
        tool_version: "stage1",
      });
      expect(runId).toBeGreaterThan(0);
      expect(repo.getRun(runId)!.status).toBe("running");

      repo.finishRun(runId, { status: "completed", finished_at: AT, rows_raw: 6892, rows_loaded: 6892, quality_status: "full" });
      const run = repo.getRun(runId)!;
      expect(run.status).toBe("completed");
      expect(run.rows_loaded).toBe(6892);
      expect(run.quality_status).toBe("full");
      expect(repo.listRuns().length).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("исходные payload дедуплицируются по sha256, происхождение сохраняется", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteRawRepository(db);
      const runId = repo.createRun({ started_at: AT, mode: "import-artifacts", shop_no: SHOP });

      const first = repo.addExtraction({ run_id: runId, source_kind: "observations_csv", source_ref: "observations_7745.csv", payload: "a,b\n1,2\n", loaded_at: AT });
      expect(first.duplicate).toBe(false);
      expect(first.raw_id).toBeGreaterThan(0);

      const second = repo.addExtraction({ run_id: runId, source_kind: "observations_csv", source_ref: "observations_7745.csv", payload: "a,b\n1,2\n", loaded_at: AT });
      expect(second.duplicate).toBe(true);
      expect(second.raw_id).toBe(first.raw_id);

      const stored = repo.getExtractionByHash(new Bun.CryptoHasher("sha256").update("a,b\n1,2\n").digest("hex"))!;
      expect(stored.bytes).toBeGreaterThan(0);
      expect(stored.source_ref).toBe("observations_7745.csv");
    } finally {
      closeDatabase(db);
    }
  });
});

describe("SqliteMetricsRepository", () => {
  test("вставляет, затем обновляет то же наблюдение вместо дублирования", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteMetricsRepository(db);
      const first = repo.upsertDailyMetrics([metric(), metric({ date: "2026-11-02", value: 1421 })]);
      expect(first).toEqual({ inserted: 2, updated: 0 });

      // повторный идентичный импорт (например, новый запуск сбора) не должен создавать дубли
      const second = repo.upsertDailyMetrics([metric(), metric({ date: "2026-11-02", value: 1421 })]);
      expect(second).toEqual({ inserted: 0, updated: 2 });
      expect(repo.getDailyMetrics({ shop_no: SHOP }).length).toBe(2);

      // исправленное значение перезаписывает то же наблюдение
      const third = repo.upsertDailyMetrics([metric({ value: 1500 })]);
      expect(third).toEqual({ inserted: 0, updated: 1 });
      expect(repo.getMetricSeries(SHOP, "qty_orders_delivered")[0]!.value).toBe(1500);
    } finally {
      closeDatabase(db);
    }
  });

  test("разные срезы / измерения / версии преобразования — разные наблюдения", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteMetricsRepository(db);
      repo.upsertDailyMetrics([
        metric({ slice_id: 20403, dimension_1: "Доставка за 30 минут" }),
        metric({ slice_id: 20403, dimension_1: "Ночная доставка" }),
        metric({ slice_id: 20405, dimension_1: "Доставка за 30 минут", dimension_2: "Доставка по слотам" }),
        metric({ slice_id: 20403, transform_version: "v2" }),
      ]);
      expect(repo.getDailyMetrics({ shop_no: SHOP }).length).toBe(4);
      expect(repo.getDailyMetrics({ shop_no: SHOP, slice_id: 20405 }).length).toBe(1);
      expect(repo.getDailyMetrics({ shop_no: SHOP, dimension_1: "Ночная доставка" }).length).toBe(1);
      expect(repo.getDailyMetrics({ shop_no: SHOP, transform_version: "v2" }).length).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("фильтры, порядок, лимит и покрытие", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteMetricsRepository(db);
      repo.upsertDailyMetrics([
        metric({ date: "2026-11-01", value: 10 }),
        metric({ date: "2026-11-02", value: 20, data_status: "partial" }),
        metric({ date: "2026-11-03", value: 30, metric: "qty_orders_declined", metric_kind: "additive" }),
      ]);

      const window = repo.getDailyMetrics({ shop_no: SHOP, date_from: "2026-11-02", date_to: "2026-11-02" });
      expect(window.length).toBe(1);
      expect(window[0]!.value).toBe(20);

      expect(repo.getDailyMetrics({ shop_no: SHOP, limit: 2 }).length).toBe(2);
      expect(repo.getDailyMetrics({ shop_no: SHOP }).map((r) => r.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);

      const coverage = repo.getCoverage(SHOP);
      expect(coverage.length).toBe(3);
      expect(coverage.map((c) => c.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
      expect(coverage.find((c) => c.date === "2026-11-02")!.data_status).toBe("partial");
      expect(coverage.find((c) => c.date === "2026-11-01")!.data_status).toBe("full");
      expect(coverage.find((c) => c.date === "2026-11-03")!.metrics).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("NULL сохраняется (пропуски не превращаются в нули)", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteMetricsRepository(db);
      repo.upsertDailyMetrics([metric({ metric: "share_not_in_slot_all", metric_kind: "ratio", value: null, evidence_status: "unknown" })]);
      const row = repo.getDailyMetrics({ shop_no: SHOP })[0]!;
      expect(row.value).toBeNull();
      expect(row.evidence_status).toBe("unknown");
    } finally {
      closeDatabase(db);
    }
  });
});

describe("SqliteFeaturesRepository", () => {
  test("идемпотентно пишет признаки по (дата, признак, версия) и читает их обратно", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteFeaturesRepository(db);
      const rows = [
        { shop_no: SHOP, date: "2026-11-01", feature: "dow", value: 6, evidence_status: "derived" as const, feature_version: "f1", computed_at: AT },
        { shop_no: SHOP, date: "2026-11-01", feature: "orders_lag_1", value: null, evidence_status: "unknown" as const, feature_version: "f1", computed_at: AT },
      ];
      expect(repo.upsertFeatures(rows)).toEqual({ inserted: 2, updated: 0 });
      expect(repo.upsertFeatures(rows)).toEqual({ inserted: 0, updated: 2 });

      const stored = repo.getFeatures(SHOP, "2026-11-01", "2026-11-01");
      expect(stored.length).toBe(2);
      expect(stored.find((r) => r.feature === "orders_lag_1")!.value).toBeNull();
      expect(repo.getFeatures(SHOP, undefined, undefined, "dow").length).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });
});

describe("SqliteEventsRepository", () => {
  test("разделяет план и факт, пишет идемпотентно и явно отмечает проверку", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteEventsRepository(db);
      const planned = {
        shop_no: SHOP,
        event_date: "2026-11-25",
        event_type: "rate_change",
        source: "reload-plan.csv",
        planned_start: "2026-11-25T09:00:00.000Z",
        status: "planned" as const,
        evidence_status: "planned" as const,
        expected_effect: "ставка с обоснованием",
        verification_result: "требует подтверждения",
        created_at: AT,
      };
      expect(repo.upsertEvents([planned])).toEqual({ inserted: 1, updated: 0 });
      expect(repo.upsertEvents([planned])).toEqual({ inserted: 0, updated: 1 });

      const stored = repo.getEvents(SHOP)[0]!;
      expect(stored.actual_start).toBeNull();
      expect(stored.status).toBe("planned");
      expect(stored.evidence_status).toBe("planned");

      repo.markVerification(stored.event_id!, {
        status: "done",
        evidence_status: "actual",
        actual_start: "2026-11-25T10:30:00.000Z",
        verification_result: "внедрено, эффект не измерен",
      });
      const verified = repo.getEvents(SHOP)[0]!;
      expect(verified.status).toBe("done");
      expect(verified.evidence_status).toBe("actual");
      expect(verified.actual_start).toBe("2026-11-25T10:30:00.000Z");

      // фильтр окна использует event_date, при отсутствии — planned_start
      expect(repo.getEvents(SHOP, "2026-11-01", "2026-11-30").length).toBe(1);
      expect(repo.getEvents(SHOP, "2026-12-01").length).toBe(0);
    } finally {
      closeDatabase(db);
    }
  });
});

describe("SqliteForecastRepository", () => {
  test("жизненный цикл запуска/результатов/оценок с идемпотентной записью", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteForecastRepository(db);
      const runId = repo.createRun({
        shop_no: SHOP,
        created_at: AT,
        horizon_days: 7,
        model_name: "seasonal_naive",
        model_version: "m1",
        target_metric: "qty_orders_delivered",
        features_version: "f1",
        input_snapshot_id: "snap-1",
        status: "completed",
      });
      expect(repo.getRun(runId)!.model_name).toBe("seasonal_naive");

      const results = [
        { run_id: runId, target_date: "2026-11-23", metric: "qty_orders_delivered", p10: 1400, p50: 1500, p90: 1600, baseline: 1480, confidence_status: "ok" as const },
        { run_id: runId, target_date: "2026-11-24", metric: "qty_orders_delivered", p50: null, baseline: null, confidence_status: "insufficient_data" as const },
      ];
      expect(repo.saveResults(runId, results)).toEqual({ inserted: 2, updated: 0 });
      expect(repo.saveResults(runId, results)).toEqual({ inserted: 0, updated: 2 });
      expect(repo.getResults(runId).find((r) => r.target_date === "2026-11-24")!.p50).toBeNull();

      const evaluations = [
        { run_id: runId, target_date: "2026-11-23", metric: "qty_orders_delivered", actual_value: 1517, predicted_value: 1500, absolute_error: 17, percentage_error: 0.0112, model_version: "m1", evaluated_at: AT },
      ];
      expect(repo.saveEvaluations(runId, evaluations)).toEqual({ inserted: 1, updated: 0 });
      expect(repo.saveEvaluations(runId, evaluations)).toEqual({ inserted: 0, updated: 1 });
      expect(repo.getEvaluations(runId)[0]!.absolute_error).toBe(17);

      expect(repo.listRuns(SHOP).length).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("сценарии сохраняют допущения и результаты", async () => {
    const { db } = await makeDb();
    try {
      const repo = new SqliteForecastRepository(db);
      const scenarioId = repo.createScenario({
        shop_no: SHOP,
        created_at: AT,
        name: "baseline",
        kind: "baseline",
        input_parameters: JSON.stringify({ orders_multiplier: 1, courier_availability: null }),
        assumptions: JSON.stringify({ productivity_per_courier: "assumed" }),
        data_status: "partial",
      });
      const scenario = repo.getScenario(scenarioId)!;
      expect(scenario.kind).toBe("baseline");
      expect(JSON.parse(scenario.input_parameters!).orders_multiplier).toBe(1);

      const rows = [
        { scenario_id: scenarioId, target_date: "2026-11-23", metric: "qty_orders_delivered", value: 1500, capacity_required: 30, capacity_available: null, deficit: null },
      ];
      expect(repo.saveScenarioResults(scenarioId, rows)).toEqual({ inserted: 1, updated: 0 });
      expect(repo.saveScenarioResults(scenarioId, rows)).toEqual({ inserted: 0, updated: 1 });
      const stored = repo.getScenarioResults(scenarioId)[0]!;
      expect(stored.capacity_available).toBeNull();
      expect(stored.deficit).toBeNull();
    } finally {
      closeDatabase(db);
    }
  });
});
