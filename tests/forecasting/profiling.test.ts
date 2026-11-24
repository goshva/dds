// Stage 3.1: статистика, временные ряды, выбросы, readiness, read-only и детерминированность.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDimensionProfiles } from "../../src/forecasting/analytics/profiling/dimensions-profile";
import {
  addDays,
  buildMetricProfiles,
  buildTemporalCoverage,
  calendarRange,
  dayOfWeek,
  describe as describeValues,
} from "../../src/forecasting/analytics/profiling/metrics-profile";
import { detectOutliers, MAD_Z_THRESHOLD, MIN_POINTS_FOR_OUTLIERS } from "../../src/forecasting/analytics/profiling/outliers";
import { profileShop, readObservations } from "../../src/forecasting/analytics/profiling/profiler";
import { openReadOnlyDatabase, readIntegrity, readTableCounts } from "../../src/forecasting/analytics/profiling/read-only";
import { assessMetricReadiness, CRITICAL_FILL_RATE } from "../../src/forecasting/analytics/profiling/readiness";
import { loadSemanticRegistry, ratioFormulaFor } from "../../src/forecasting/analytics/profiling/semantics";
import { coefficientOfVariation, iqr, linearTrend, mad, mean, median, quantile, stdev } from "../../src/forecasting/analytics/profiling/stats";
import { buildTemporalProfile, completeWeeks } from "../../src/forecasting/analytics/profiling/temporal-profile";
import type { DailyObservationRow, MetricProfile } from "../../src/forecasting/analytics/profiling/types";
import { openStore } from "../../src/forecasting/storage/sqlite/store";

const AT = "2026-11-23T22:00:00.000Z";

// ---------------------------------------------------------------------------
// 9.1. Статистические функции
// ---------------------------------------------------------------------------
describe("статистические функции", () => {
  test("среднее, медиана и квантили", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(() => quantile([1], 1.5)).toThrow(/within/);
  });

  test("стандартное отклонение (выборочное) и дисперсия", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
    expect(stdev([5])).toBeNull();
    expect(stdev([])).toBeNull();
  });

  test("коэффициент вариации: нулевое и отсутствующее среднее", () => {
    expect(coefficientOfVariation([10, 20, 30])).toBeCloseTo(0.5, 6);
    expect(coefficientOfVariation([-5, 5])).toBeNull(); // среднее = 0
    expect(coefficientOfVariation([7])).toBeNull(); // одно значение
    expect(coefficientOfVariation([])).toBeNull();
  });

  test("IQR и MAD, включая постоянный ряд", () => {
    expect(iqr([1, 2, 3, 4, 5])).toBe(2);
    expect(iqr([3, 3, 3, 3])).toBe(0);
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
    expect(mad([7, 7, 7])).toBe(0);
    expect(iqr([])).toBeNull();
    expect(mad([])).toBeNull();
  });

  test("пустой массив и одно значение обрабатываются явно", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(mean([42])).toBe(42);
    expect(median([42])).toBe(42);
  });

  test("отрицательные значения учитываются корректно", () => {
    expect(mean([-10, 10])).toBe(0);
    expect(describeValues([-10, -5, 5, 10]).negatives).toBe(2);
    expect(Math.min(...[-10, -5, 5, 10])).toBe(-10);
  });

  test("описательный тренд: наклон, R² и вырожденные случаи", () => {
    const trend = linearTrend([1, 2, 3, 4]);
    expect(trend!.slope).toBeCloseTo(1, 9);
    expect(trend!.r2).toBeCloseTo(1, 9);
    expect(linearTrend([5, 5, 5])!.slope).toBe(0);
    expect(linearTrend([5, 5, 5])!.r2).toBeNull();
    expect(linearTrend([1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9.2. Временные ряды
// ---------------------------------------------------------------------------
describe("временные ряды", () => {
  const row = (date: string, value: number | null, over: Partial<DailyObservationRow> = {}): DailyObservationRow => ({
    date,
    slice_id: 20403,
    metric: "m",
    metric_kind: "additive",
    dimension_1: "",
    dimension_2: "",
    value,
    unit: null,
    evidence_status: "actual",
    data_status: "full",
    transform_version: "v1",
    ...over,
  });

  test("календарный диапазон, добавление дней и день недели", () => {
    expect(calendarRange("2026-10-13", "2026-10-16")).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(calendarRange("2026-10-13", "2026-10-13")).toEqual(["2026-10-13"]);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(dayOfWeek("2026-10-13")).toBe(2); // вторник
    expect(dayOfWeek("2026-10-18")).toBe(7); // воскресенье
  });

  test("пропущенные календарные дни, NULL и явные нули различаются", () => {
    const calendar = calendarRange("2026-10-13", "2026-10-18"); // 6 дней
    const rows = [
      row("2026-10-13", 10),
      row("2026-10-14", null), // наблюдение есть, значение неизвестно
      row("2026-10-15", 0), // источник сообщил ноль
      row("2026-10-18", 5), // 16 и 17 отсутствуют
    ];
    const profiles = buildMetricProfiles(rows, calendar);
    expect(profiles.length).toBe(1);
    const profile = profiles[0]!;
    expect(profile.observations).toBe(4);
    expect(profile.days_with_data).toBe(4);
    expect(profile.missing_days).toBe(2);
    expect(profile.stats.nulls).toBe(1);
    expect(profile.stats.zeros).toBe(1);
    expect(profile.stats.n).toBe(3);
    expect(profile.fill_rate).toBeCloseTo(4 / 6, 6);
    expect(profile.max_gap_days).toBe(2);
    expect(profile.gap_ranges).toEqual([{ from: "2026-10-16", to: "2026-10-17", days: 2 }]);
  });

  test("отсутствующая метрика не создаёт профиль", () => {
    const calendar = calendarRange("2026-10-13", "2026-10-15");
    const profiles = buildMetricProfiles([row("2026-10-13", 1, { metric: "m1" })], calendar);
    expect(profiles.map((profile) => profile.metric)).toEqual(["m1"]);
  });

  test("несколько метрик и несколько срезов группируются раздельно", () => {
    const calendar = calendarRange("2026-10-13", "2026-10-14");
    const rows = [
      row("2026-10-13", 1, { metric: "m1", slice_id: 20403 }),
      row("2026-10-13", 2, { metric: "m1", slice_id: 20405 }),
      row("2026-10-13", 3, { metric: "m2", slice_id: 20403 }),
      row("2026-10-14", 4, { metric: "m1", slice_id: 20403 }),
    ];
    const profiles = buildMetricProfiles(rows, calendar);
    expect(profiles.map((profile) => `${profile.metric}/${profile.slice_id}`)).toEqual(["m1/20403", "m1/20405", "m2/20403"]);
    const coverage = buildTemporalCoverage(rows, calendar);
    expect(coverage.find((entry) => entry.metric === "m1" && entry.slice_id === 20405)!.missing_days).toBe(1);
  });

  test("повторяющиеся natural key видны в профиле как несколько наблюдений на дату", () => {
    const calendar = calendarRange("2026-10-13", "2026-10-13");
    const rows = [row("2026-10-13", 1), row("2026-10-13", 2)];
    const profiles = buildMetricProfiles(rows, calendar);
    expect(profiles[0]!.observations).toBe(2);
    expect(profiles[0]!.days_with_data).toBe(1);
  });

  test("полные недели и временной профиль", () => {
    const points = calendarRange("2026-10-12", "2026-10-25").map((date) => ({ date, value: 1 }));
    expect(completeWeeks(points)).toBe(2);
    expect(completeWeeks([{ date: "2026-10-13", value: 1 }])).toBe(0);

    const rows = calendarRange("2026-10-12", "2026-10-25").map((date, index) => row(date, index + 1));
    const profile = buildTemporalProfile({
      metric: "m",
      slice_id: 20403,
      points: rows.map((entry) => ({ date: entry.date, value: entry.value as number })),
      aggregation: "sum_by_dimensions",
      aggregation_note: "тест",
    });
    expect(profile.points_used).toBe(14);
    expect(profile.aggregation).toBe("sum_by_dimensions");
    expect(profile.first_value).toBe(1);
    expect(profile.last_value).toBe(14);
    expect(profile.trend_slope_per_day).toBeCloseTo(1, 6);
    expect(profile.dow.length).toBe(7);
    expect(profile.dow.find((entry) => entry.dow === 2)!.observations).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9.3. Выбросы
// ---------------------------------------------------------------------------
describe("выбросы", () => {
  const points = (values: number[]) => values.map((value, index) => ({ date: addDays("2026-10-01", index), value }));
  const ctx = { metric: "m", slice_id: 20403 };

  test("обычный ряд без выбросов", () => {
    const result = detectOutliers(points([10, 11, 10, 12, 11, 10, 11, 12, 10, 11]), ctx);
    expect(result.findings).toEqual([]);
    expect(result.applicability.every((entry) => entry.applicable)).toBe(true);
  });

  test("единичный выброс найден обоими методами", () => {
    const result = detectOutliers(points([10, 11, 10, 11, 10, 11, 10, 11, 10, 500]), ctx);
    const methods = [...new Set(result.findings.map((finding) => finding.method))].sort();
    expect(methods).toEqual(["IQR", "MAD"]);
    expect(result.findings.every((finding) => finding.value === 500)).toBe(true);
    expect(result.findings.every((finding) => finding.date === addDays("2026-10-01", 9))).toBe(true);
  });

  test("постоянный ряд: методы неприменимы, выбросов нет", () => {
    const result = detectOutliers(points([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), ctx);
    expect(result.findings).toEqual([]);
    expect(result.applicability.every((entry) => entry.applicable === false)).toBe(true);
  });

  test("малый объём данных: методы неприменимы", () => {
    const result = detectOutliers(points([1, 2, 100]), ctx);
    expect(result.findings).toEqual([]);
    expect(result.applicability.every((entry) => entry.reason.includes(String(MIN_POINTS_FOR_OUTLIERS)))).toBe(true);
  });

  test("несколько выбросов", () => {
    const result = detectOutliers(points([10, 11, 10, 11, -50, 11, 10, 11, 10, 900]), ctx);
    const values = [...new Set(result.findings.map((finding) => finding.value))].sort((a, b) => a - b);
    expect(values).toContain(-50);
    expect(values).toContain(900);
  });

  test("IQR и MAD дают корректные границы и статистики", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
    const result = detectOutliers(points(values), ctx);
    const iqrFinding = result.findings.find((finding) => finding.method === "IQR")!;
    // [1..10, 100]: Q1 = 3.5, Q3 = 8.5 → IQR = 5; верхняя граница = 8.5 + 1.5·5 = 16
    expect(iqrFinding.statistic).toBeCloseTo(5, 6);
    expect(iqrFinding.upper_bound).toBeCloseTo(16, 6);
    const madFinding = result.findings.find((finding) => finding.method === "MAD")!;
    expect(madFinding.statistic).toBeCloseTo(3, 6);
    expect(madFinding.reason).toContain(String(MAD_Z_THRESHOLD));
  });

  test("выбросы не изменяют исходные значения", () => {
    const input = points([10, 11, 10, 11, 10, 11, 10, 11, 10, 500]);
    const snapshot = JSON.stringify(input);
    detectOutliers(input, ctx);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 9.4. Readiness
// ---------------------------------------------------------------------------
describe("readiness", () => {
  const profile = (over: Partial<MetricProfile> = {}): MetricProfile => ({
    metric: "qty_orders_delivered",
    metric_kind: "additive",
    slice_id: 20403,
    unit: "count",
    observations: 41,
    days_with_data: 41,
    first_date: "2026-10-13",
    last_date: "2026-11-22",
    stats: { n: 41, nulls: 0, zeros: 0, negatives: 0, min: 1, max: 9, mean: 5, median: 5, stdev: 1, cv: 0.2, q1: 4, q3: 6, iqr: 2, mad: 1 },
    sum: 205,
    mean_per_day: 5,
    positive_days: 41,
    zero_days: 0,
    expected_days: 41,
    missing_days: 0,
    fill_rate: 1,
    max_gap_days: 0,
    gap_ranges: [],
    additive_aggregation_confirmed: false,
    notes: [],
    ...over,
  });

  const semantics = { metric: "qty_orders_delivered", verbose_name: "Ген.заказы", expression: "COUNT(...)", aggregation: "COUNT", source: "catalog", status: "known" as const };

  test("технически корректная метрика с подтверждённой семантикой и одним срезом — READY", () => {
    const row = assessMetricReadiness({ profile: profile(), semantics, outliers: [], slices: [20403], independence: "unknown" });
    expect(row.forecast_readiness).toBe("READY");
    expect(row.reasons[0]).toContain("не обнаружено");
  });

  test("технически корректная метрика без подтверждённой семантики — CONDITIONAL, не READY", () => {
    const row = assessMetricReadiness({ profile: profile(), semantics: null, outliers: [], slices: [20403], independence: "unknown" });
    expect(row.forecast_readiness).toBe("CONDITIONAL");
    expect(row.semantic_status).toBe("unknown");
    expect(row.reasons.join(" ")).toContain("семантика не подтверждена");
    expect(row.required_actions.join(" ")).toContain("определение метрики");
  });

  test("ratio-метрика без подтверждённого знаменателя — CONDITIONAL", () => {
    const row = assessMetricReadiness({
      profile: profile({ metric: "share_not_in_slot_all", metric_kind: "ratio", unit: "share" }),
      semantics: { ...semantics, metric: "share_not_in_slot_all" },
      outliers: [],
      slices: [20403],
      independence: "unknown",
      ratioVerified: false,
    });
    expect(row.forecast_readiness).toBe("CONDITIONAL");
    expect(row.reasons.join(" ")).toContain("знаменатель");
  });

  test("ratio-метрика с восстановленным отношением остаётся CONDITIONAL из-за запрета суммирования", () => {
    const row = assessMetricReadiness({
      profile: profile({ metric: "share_not_in_slot_all", metric_kind: "ratio" }),
      semantics: { ...semantics, metric: "share_not_in_slot_all" },
      outliers: [],
      slices: [20403],
      independence: "unknown",
      ratioVerified: true,
    });
    expect(row.forecast_readiness).toBe("CONDITIONAL");
    expect(row.reasons.join(" ")).toContain("отношение числитель/знаменатель восстановлено");
  });

  test("критические пропуски — BLOCKED", () => {
    const row = assessMetricReadiness({
      profile: profile({ fill_rate: CRITICAL_FILL_RATE - 0.1, missing_days: 25, days_with_data: 16 }),
      semantics,
      outliers: [],
      slices: [20403],
      independence: "unknown",
    });
    expect(row.forecast_readiness).toBe("BLOCKED");
    expect(row.reasons.join(" ")).toContain("критическая неполнота");
  });

  test("постоянный ряд — BLOCKED (прогнозировать нечего)", () => {
    const row = assessMetricReadiness({
      profile: profile({ stats: { ...profile().stats, stdev: 0, min: 5, max: 5 } }),
      semantics,
      outliers: [],
      slices: [20403],
      independence: "unknown",
    });
    expect(row.forecast_readiness).toBe("BLOCKED");
    expect(row.reasons.join(" ")).toContain("постоянный");
  });

  test("отрицательные значения в аддитивной метрике — BLOCKED", () => {
    const row = assessMetricReadiness({
      profile: profile({ stats: { ...profile().stats, negatives: 3, min: -10 } }),
      semantics,
      outliers: [],
      slices: [20403],
      independence: "unknown",
    });
    expect(row.forecast_readiness).toBe("BLOCKED");
    expect(row.reasons.join(" ")).toContain("отрицательных значений");
  });

  test("метрика в нескольких срезах без доказанной независимости — CONDITIONAL с запретом суммирования", () => {
    const row = assessMetricReadiness({ profile: profile(), semantics, outliers: [], slices: [20403, 20404, 20405], independence: "unknown" });
    expect(row.forecast_readiness).toBe("CONDITIONAL");
    expect(row.reasons.join(" ")).toContain("недоказанной независимостью");
    expect(row.required_actions.join(" ")).toContain("канонический срез");
  });

  test("выбросы переводят метрику в CONDITIONAL с требованием проверки", () => {
    const row = assessMetricReadiness({
      profile: profile(),
      semantics,
      outliers: [{ metric: "qty_orders_delivered", slice_id: 20403, dimension_1: "", dimension_2: "", date: "2026-11-01", value: 9, method: "IQR", statistic: 2, lower_bound: 1, upper_bound: 8, reason: "test" }],
      slices: [20403],
      independence: "unknown",
    });
    expect(row.forecast_readiness).toBe("CONDITIONAL");
    expect(row.reasons.join(" ")).toContain("подозрительных значений");
  });
});

// ---------------------------------------------------------------------------
// 9.5. Read-only и 9.6. Детерминированность (на синтетической базе)
// ---------------------------------------------------------------------------
async function makeSyntheticDatabase(): Promise<{ path: string; days: number; rows: number }> {
  const dir = await mkdtemp(join(tmpdir(), "dds-profile-"));
  const path = join(dir, "forecasting.sqlite");
  const store = await openStore(path);
  try {
    store.db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run("7745", "7745ДС", AT);
    const dates = calendarRange("2026-10-13", "2026-11-22"); // 41 день
    let rows = 0;
    for (const date of dates) {
      for (const sliceId of [20403, 20624]) {
        for (const metric of sliceId === 20403 ? ["qty_orders_delivered", "qty_not_in_slot_all", "share_not_in_slot_all"] : ["qty_orders_delivered"]) {
          const index = dates.indexOf(date);
          const value = metric === "share_not_in_slot_all" ? 0.1 : 100 + index + (metric === "qty_not_in_slot_all" ? 5 : 0);
          store.db
            .query(
              `INSERT INTO daily_metrics
                 (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, unit, evidence_status, data_status, transform_version, loaded_at)
               VALUES ('7745', ?, ?, ?, '', ?, ?, ?, ?, 'actual', 'full', 'v1', ?)`,
            )
            .run(
              date,
              sliceId,
              sliceId === 20403 ? "Служба A" : "",
              metric,
              metric === "share_not_in_slot_all" ? "ratio" : "additive",
              value,
              metric === "share_not_in_slot_all" ? "share" : "count",
              AT,
            );
          rows++;
        }
      }
    }
    return { path, days: dates.length, rows };
  } finally {
    store.close();
  }
}

describe("read-only профилирование", () => {
  test("запись невозможна, данные и целостность не меняются", async () => {
    const fixture = await makeSyntheticDatabase();
    const before = (() => {
      const probe = openReadOnlyDatabase(fixture.path);
      const counts = readTableCounts(probe.db);
      probe.db.close(false);
      return counts;
    })();

    const connection = openReadOnlyDatabase(fixture.path);
    try {
      expect(connection.writeBlocked).toBe(true);
      expect(() => connection.db.query("INSERT INTO shops (shop_no, created_at) VALUES ('x','2026-01-01T00:00:00.000Z')").run()).toThrow(/readonly/i);
      expect(() => connection.db.exec("UPDATE daily_metrics SET value = 0")).toThrow(/readonly|query_only/i);
      expect(() => connection.db.exec("DELETE FROM daily_metrics")).toThrow(/readonly|query_only/i);

      const rows = readObservations(connection.db, "7745");
      expect(rows.length).toBe(fixture.rows);

      const result = profileShop(connection.db, { shopNo: "7745", generatedAt: AT });
      expect(result.period.days).toBe(fixture.days);
      expect(result.slices).toEqual([20403, 20624]);
      expect(result.read_only.query_only).toBe(1);
      expect(result.period.matches_expected_period).toBe(true);
      expect(result.duplicates.count).toBe(0);

      const integrity = readIntegrity(connection.db);
      expect(integrity.integrity).toBe("ok");
      expect(integrity.foreign_key_violations).toBe(0);

      const after = readTableCounts(connection.db);
      expect(after).toEqual(before);
      expect(after.daily_metrics).toBe(fixture.rows);
    } finally {
      connection.db.close(false);
    }
  });

  test("профилирование детерминировано: два прогона дают одинаковый результат", async () => {
    const fixture = await makeSyntheticDatabase();
    const connection = openReadOnlyDatabase(fixture.path);
    try {
      const first = profileShop(connection.db, { shopNo: "7745", generatedAt: AT });
      const second = profileShop(connection.db, { shopNo: "7745", generatedAt: AT });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(JSON.stringify(second.metric_profiles)).toBe(JSON.stringify(first.metric_profiles));
      expect(JSON.stringify(second.readiness)).toBe(JSON.stringify(first.readiness));
    } finally {
      connection.db.close(false);
    }
  });

  test("guard отклоняет записывающие SQL", async () => {
    const fixture = await makeSyntheticDatabase();
    const connection = openReadOnlyDatabase(fixture.path);
    try {
      const { assertReadOnlySql } = await import("../../src/forecasting/analytics/profiling/read-only");
      expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
      expect(() => assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")).not.toThrow();
      for (const sql of ["INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t", "CREATE TABLE t (a)", "ALTER TABLE t ADD b", "DROP TABLE t", "PRAGMA journal_mode = WAL"]) {
        expect(() => assertReadOnlySql(sql), sql).toThrow(/read-only guard/);
      }
    } finally {
      connection.db.close(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Профиль dimensions и семантика из каталога (интеграционные проверки)
// ---------------------------------------------------------------------------
describe("dimensions и семантика", () => {
  test("профиль измерений: кардинальность, пустые значения и плейсхолдеры", async () => {
    const fixture = await makeSyntheticDatabase();
    const connection = openReadOnlyDatabase(fixture.path);
    try {
      const rows = readObservations(connection.db, "7745");
      const profiles = buildDimensionProfiles(rows);
      const dimension1 = profiles.find((profile) => profile.field === "dimension_1")!;
      expect(dimension1.unique_values).toBe(1);
      expect(dimension1.empty_values).toBeGreaterThan(0);
      expect(dimension1.cardinality).toBe("low");
      expect(dimension1.masking_placeholder_values).toBe(0);
    } finally {
      connection.db.close(false);
    }
  });

  test("реестр семантики читается из каталога метаданных, формулы ratio известны", () => {
    const registry = loadSemanticRegistry();
    expect(registry.length).toBeGreaterThan(100);
    const delivered = registry.find((entry) => entry.metric === "qty_orders_delivered")!;
    expect(delivered.status).toBe("known");
    expect(delivered.verbose_name).toContain("Успешно завершен");

    expect(ratioFormulaFor("share_not_in_slot_all")).toMatchObject({
      numerator_metric: "qty_not_in_slot_all",
      denominator_metric: "qty_orders_delivered",
    });
    expect(ratioFormulaFor("share_orders_delivered")!.denominator_metric).toBeNull();
    expect(ratioFormulaFor("нет_такой_метрики")).toBeNull();
  });
});
