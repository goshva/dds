// Stage 3.2: семантика, выбор канонического источника, дневной набор, сверка, read-only.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCanonicalDailyDataset } from "../../src/forecasting/analytics/canonical-dataset/builder";
import { CANONICAL_DECISION, verifyDecision } from "../../src/forecasting/analytics/canonical-dataset/decision";
import { reconcileDataset } from "../../src/forecasting/analytics/canonical-dataset/reconciliation";
import { rejectReasons, selectCanonicalSource } from "../../src/forecasting/analytics/canonical-dataset/selection";
import { crossSliceDailyTotals, metricPeriod, sliceCandidateStats } from "../../src/forecasting/analytics/canonical-dataset/source-loader";
import type { CrossSliceRow, SliceCandidateStats, SliceSourceRow } from "../../src/forecasting/analytics/canonical-dataset/types";
import { validateCanonicalDataset } from "../../src/forecasting/analytics/canonical-dataset/validation";
import { openReadOnlyDatabase, readIntegrity, readTableCounts } from "../../src/forecasting/analytics/profiling/read-only";
import {
  assertMetricUsable,
  METRIC_REGISTRY,
  metricByKey,
  TARGET_METRIC_KEY,
  validateRegistry,
} from "../../src/forecasting/analytics/semantics/metric-registry";
import { openStore } from "../../src/forecasting/storage/sqlite/store";

const AT = "2026-11-23T22:30:00.000Z";
const SHOP = "7745";
const METRIC = "qty_orders_delivered";

// ---------------------------------------------------------------------------
// 9.1. Business semantics
// ---------------------------------------------------------------------------
describe("реестр бизнес-семантики", () => {
  test("целевая метрика присутствует и не заблокирована", () => {
    const target = metricByKey(TARGET_METRIC_KEY);
    expect(target).not.toBeNull();
    expect(target!.blocked).toBe(false);
    expect(target!.target_eligible).toBe(true);
    expect(target!.metric_kind).toBe("additive");
    expect(target!.unit).toBe("заказы (шт.)");
  });

  test("ключи метрик уникальны, реестр проходит самопроверку", () => {
    const keys = METRIC_REGISTRY.map((metric) => metric.metric_key);
    expect(new Set(keys).size).toBe(keys.length);
    const check = validateRegistry();
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test("ни одна метрика не помечена confirmed без письменного бизнес-подтверждения", () => {
    expect(METRIC_REGISTRY.filter((metric) => metric.confidence === "confirmed")).toEqual([]);
  });

  test("заблокированные метрики недоступны аналитическому слою", () => {
    expect(() => assertMetricUsable("qty_orders_in_work")).toThrow(/заблокирована/);
    expect(() => assertMetricUsable("share_orders_delivered")).toThrow(/заблокирована/);
    expect(() => assertMetricUsable("нет_такой_метрики")).toThrow(/отсутствует в реестре/);
    expect(assertMetricUsable(TARGET_METRIC_KEY).metric_key).toBe(TARGET_METRIC_KEY);
  });

  test("неподтверждённая единица не становится подтверждённой", () => {
    for (const key of ["sum_with_bonuses", "sum_without_bonuses"]) {
      const metric = metricByKey(key)!;
      expect(metric.unit).toBeNull();
      expect(metric.confidence).toBe("unconfirmed");
      expect(metric.restrictions.join(" ")).toContain("единица измерения");
    }
  });

  test("ratio-метрика с неизвестным числителем не считается подтверждённой", () => {
    for (const key of ["share_not_in_slot_above_all", "share_not_in_slot_under_all", "share_delivered_taxi"]) {
      const metric = metricByKey(key)!;
      expect(metric.metric_kind).toBe("ratio");
      expect(metric.numerator).toBeNull();
      expect(metric.confidence).toBe("unconfirmed");
      expect(metric.aggregation_rule.within_day).toContain("НЕ суммировать");
    }
    const confirmedRatio = metricByKey("share_not_in_slot_all")!;
    expect(confirmedRatio.numerator).toBe("qty_not_in_slot_all");
    expect(confirmedRatio.denominator).toBe("qty_orders_delivered");
  });
});

// ---------------------------------------------------------------------------
// 9.2. Canonical source selection
// ---------------------------------------------------------------------------
function candidate(over: Partial<SliceCandidateStats> = {}): SliceCandidateStats {
  return {
    sliceId: 20624,
    rows: 41,
    dailyRows: 41,
    totalsRows: 0,
    dates: 41,
    rowsPerDayMin: 1,
    rowsPerDayMax: 1,
    rowsPerDayAvg: 1,
    dimensionCombinations: 1,
    dimension1Values: 1,
    dimension2Values: 0,
    emptyDimension1: 0,
    emptyDimension2: 41,
    maskedDimension1: 0,
    maskedDimension2: 0,
    nullValues: 0,
    zeroValues: 0,
    negativeValues: 0,
    fractionalValues: 0,
    min: 1300,
    max: 1700,
    dailyTotal: 62739,
    duplicateKeys: 0,
    datasetId: 3035,
    runId: 2,
    singleRowPerDate: true,
    calendarComplete: true,
    ...over,
  };
}

function crossRows(dates: number, slices: number[], equal = true): CrossSliceRow[] {
  return Array.from({ length: dates }, (_, index) => {
    const totals: Record<string, number> = {};
    slices.forEach((slice, position) => {
      totals[String(slice)] = 100 + (equal || position === 0 ? 0 : position);
    });
    const values = Object.values(totals);
    const maxDeviation = Math.max(...values) - Math.min(...values);
    return { date: `2026-10-${String(index + 13).padStart(2, "0")}`, totalsBySlice: totals, allEqual: maxDeviation === 0, maxDeviation, slicesCompared: slices.length };
  });
}

describe("выбор канонического источника", () => {
  test("единственный срез с одной строкой на дату выбирается, остальные — контрольные", () => {
    const candidates = [
      candidate({ sliceId: 20624 }),
      candidate({ sliceId: 20403, rows: 199, dailyRows: 199, dimensionCombinations: 7, dimension1Values: 7, emptyDimension2: 199, rowsPerDayMin: 4, rowsPerDayMax: 6, singleRowPerDate: false }),
    ];
    const result = selectCanonicalSource(candidates, crossRows(41, [20403, 20624]), 41);
    expect(result.status).toBe("CONFIRMED");
    expect(result.sliceId).toBe(20624);
    expect(result.alternatives.some((entry) => entry.sliceId === 20403 && entry.role === "контрольный источник")).toBe(true);
  });

  test("несколько срезов с одной строкой на дату — BLOCKED (выбор неоднозначен)", () => {
    const result = selectCanonicalSource([candidate({ sliceId: 20624 }), candidate({ sliceId: 12345 })], crossRows(41, [12345, 20624]), 41);
    expect(result.status).toBe("BLOCKED");
    expect(result.sliceId).toBeNull();
    expect(result.reasons.join(" ")).toContain("неоднозначен");
  });

  test("нет срезов с одной строкой на дату — BLOCKED (аддитивность категорий не доказана)", () => {
    const result = selectCanonicalSource([candidate({ singleRowPerDate: false, rowsPerDayMin: 4, rowsPerDayMax: 6 })], crossRows(41, [20624]), 41);
    expect(result.status).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("взаимоисключаемость и полноту категорий");
  });

  test("расхождение дневных сумм между срезами — BLOCKED", () => {
    const candidates = [candidate({ sliceId: 20624 }), candidate({ sliceId: 20403, singleRowPerDate: false, dimensionCombinations: 7 })];
    const result = selectCanonicalSource(candidates, crossRows(41, [20403, 20624], false), 41);
    expect(result.status).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("расходятся");
  });

  test("плейсхолдеры маскирования, дубли, NULL, отрицательные, дробные и totals отклоняют срез", () => {
    expect(rejectReasons(candidate({ maskedDimension1: 5 })).join(" ")).toContain("плейсхолдеры маскирования");
    expect(rejectReasons(candidate({ duplicateKeys: 1 })).join(" ")).toContain("дублирующихся ключей");
    expect(rejectReasons(candidate({ nullValues: 2 })).join(" ")).toContain("NULL");
    expect(rejectReasons(candidate({ negativeValues: 3 })).join(" ")).toContain("отрицательных");
    expect(rejectReasons(candidate({ fractionalValues: 1 })).join(" ")).toContain("дробных");
    expect(rejectReasons(candidate({ totalsRows: 1 })).join(" ")).toContain("итоговых строк");

    const masked = selectCanonicalSource([candidate({ maskedDimension1: 5 })], crossRows(41, [20624]), 41);
    expect(masked.status).toBe("BLOCKED");
    expect(masked.rejected[0]!.reason).toContain("маскирования");
  });

  test("неполный календарь отклоняет срез", () => {
    const result = selectCanonicalSource([candidate({ dates: 30, calendarComplete: false })], crossRows(30, [20624]), 41);
    expect(result.status).toBe("BLOCKED");
    expect(result.rejected[0]!.reason).toContain("неполный календарь");
  });

  test("зафиксированное решение подтверждается данными и не переключается автоматически", () => {
    const selection = selectCanonicalSource([candidate({ sliceId: 20624 })], crossRows(41, [20624]), 41);
    expect(verifyDecision(CANONICAL_DECISION, selection).ok).toBe(true);

    const otherSlice = selectCanonicalSource([candidate({ sliceId: 99999 })], crossRows(41, [99999]), 41);
    const failed = verifyDecision(CANONICAL_DECISION, otherSlice);
    expect(failed.ok).toBe(false);
    expect(failed.messages.join(" ")).toContain("не переключается автоматически");
  });
});

// ---------------------------------------------------------------------------
// 9.3. Canonical dataset
// ---------------------------------------------------------------------------
function row(date: string, value: number | null, over: Partial<SliceSourceRow> = {}): SliceSourceRow {
  return {
    date,
    sliceId: 20624,
    dimension1: "7745ДС_Мосфильмовская74",
    dimension2: "",
    value,
    datasetId: 3035,
    runId: 2,
    transformVersion: "v1",
    evidenceStatus: "actual",
    dataStatus: "full",
    ...over,
  };
}

const BUILD = {
  shopNo: SHOP,
  metric: METRIC,
  businessName: "delivered_orders_daily",
  sourceSliceId: 20624,
  from: "2026-10-13",
  to: "2026-10-18",
  generatedAt: AT,
};

describe("построение канонического дневного набора", () => {
  test("корректный набор: одна запись на дату, сортировка, сумма и провенанс", () => {
    const rows = [row("2026-10-13", 10), row("2026-10-14", 20), row("2026-10-15", 30), row("2026-10-16", 40), row("2026-10-17", 50)];
    const { dataset, issues } = buildCanonicalDailyDataset(rows, BUILD);

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(dataset.observations.map((observation) => observation.date)).toEqual([
      "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17",
    ]);
    expect(dataset.observations.map((observation) => observation.value)).toEqual([10, 20, 30, 40, 50]);
    expect(dataset.totalDelivered).toBe(150);
    expect(dataset.period.days).toBe(5);
    expect(dataset.provenance.sourceFile).toContain("slice=20624");
    expect(dataset.provenance.extractionRunIds).toEqual([2]);
    expect(dataset.provenance.checksum!.length).toBe(64);
    expect(dataset.observations[0]!.qualityStatus).toBe("full");
  });

  test("верхняя граница исключающая, а строки без даты исключаются", () => {
    const rows = [row("2026-10-13", 10), row("2026-10-17", 99), row("", 500)];
    // to = 2026-10-17 → строка за 17 октября исключается как верхняя (исключающая) граница
    const { dataset } = buildCanonicalDailyDataset(rows, { ...BUILD, to: "2026-10-17" });
    expect(dataset.observations.map((observation) => observation.date)).toEqual(["2026-10-13"]);
    expect(dataset.excludedTotalsRows).toBe(1);
    expect(dataset.totalDelivered).toBe(10);
  });

  test("NULL приводит к ошибке и не превращается в ноль", () => {
    const { dataset, issues } = buildCanonicalDailyDataset([row("2026-10-13", null)], BUILD);
    expect(issues.some((issue) => issue.code === "null_value" && issue.severity === "error")).toBe(true);
    expect(dataset.observations).toEqual([]);
    expect(dataset.observations.some((observation) => observation.value === 0)).toBe(false);
  });

  test("отрицательное значение — ошибка, ноль сохраняется как значение источника", () => {
    const negative = buildCanonicalDailyDataset([row("2026-10-13", -5)], BUILD);
    expect(negative.issues.some((issue) => issue.code === "negative_value")).toBe(true);
    expect(negative.dataset.observations[0]!.value).toBe(-5);

    const zero = buildCanonicalDailyDataset([row("2026-10-13", 0)], BUILD);
    expect(zero.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(zero.dataset.observations[0]!.value).toBe(0);
  });

  test("дробное значение сохраняется и понижает статус до conditional", () => {
    const { dataset, issues } = buildCanonicalDailyDataset([row("2026-10-13", 10.5)], BUILD);
    expect(issues.some((issue) => issue.code === "fractional_value" && issue.severity === "warning")).toBe(true);
    expect(dataset.observations[0]!.value).toBe(10.5);
    expect(dataset.observations[0]!.qualityStatus).toBe("conditional");
  });

  test("несколько строк на дату не суммируются: набор не строится", () => {
    const { dataset, issues } = buildCanonicalDailyDataset([row("2026-10-13", 10), row("2026-10-13", 20)], BUILD);
    expect(issues.some((issue) => issue.code === "multiple_rows_per_date" && issue.severity === "error")).toBe(true);
    expect(dataset.observations).toEqual([]);
    expect(dataset.totalDelivered).toBe(0);
  });

  test("строки другого среза игнорируются", () => {
    const rows = [row("2026-10-13", 10), row("2026-10-13", 777, { sliceId: 20403 })];
    const { dataset } = buildCanonicalDailyDataset(rows, BUILD);
    expect(dataset.observations.length).toBe(1);
    expect(dataset.totalDelivered).toBe(10);
    expect(dataset.observations.every((observation) => observation.sourceSliceId === 20624)).toBe(true);
  });

  test("детерминированность: одинаковые входные данные дают одинаковый результат и checksum", () => {
    const rows = [row("2026-10-13", 10), row("2026-10-14", 20)];
    const first = buildCanonicalDailyDataset(rows, BUILD);
    const second = buildCanonicalDailyDataset([...rows].reverse(), { ...BUILD, generatedAt: AT });
    expect(second.dataset.provenance.checksum).toBe(first.dataset.provenance.checksum);
    expect(JSON.stringify(second.dataset.observations)).toBe(JSON.stringify(first.dataset.observations));
  });

  test("валидация набора: пропуск в календаре и отсутствие данных фиксируются", () => {
    const withGap = buildCanonicalDailyDataset([row("2026-10-13", 10), row("2026-10-15", 20)], BUILD);
    const gapReport = validateCanonicalDataset(withGap.dataset, { expectedFrom: "2026-10-13", expectedToInclusive: "2026-10-15" });
    expect(gapReport.ok).toBe(false);
    expect(gapReport.checks.find((check) => check.code === "calendar_continuous")!.passed).toBe(false);

    const empty = buildCanonicalDailyDataset([], BUILD);
    const emptyReport = validateCanonicalDataset(empty.dataset);
    expect(emptyReport.ok).toBe(false);
    expect(emptyReport.checks.find((check) => check.code === "non_empty_dataset")!.passed).toBe(false);
  });

  test("валидация набора: чистый набор проходит все проверки", () => {
    const rows = ["2026-10-13", "2026-10-14", "2026-10-15"].map((date, index) => row(date, 10 + index));
    const { dataset } = buildCanonicalDailyDataset(rows, BUILD);
    const report = validateCanonicalDataset(dataset, { expectedFrom: "2026-10-13", expectedToInclusive: "2026-10-15" });
    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9.4. Reconciliation
// ---------------------------------------------------------------------------
function reconcileFixture(options: { canonValue?: number; extraCanonicalRow?: boolean; otherSliceRows?: boolean; deterministic?: boolean } = {}) {
  const dates = ["2026-10-13", "2026-10-14", "2026-10-15"];
  const sourceRows: SliceSourceRow[] = dates.map((date, index) => row(date, 100 + index));
  const otherRows: SliceSourceRow[] = options.otherSliceRows
    ? dates.map((date, index) => row(date, 100 + index, { sliceId: 20403, dimension1: "Сервис A" }))
    : [];
  const rows = [...sourceRows, ...otherRows];
  const { dataset } = buildCanonicalDailyDataset(sourceRows, { ...BUILD, to: "2026-10-16" });
  if (options.canonValue !== undefined && dataset.observations.length) {
    dataset.observations[0]!.value = options.canonValue;
    dataset.totalDelivered = dataset.observations.reduce((acc, observation) => acc + observation.value, 0);
  }
  if (options.extraCanonicalRow) {
    // дубликат существующей даты — проверка отсутствия задвоения
    dataset.observations.push({ ...dataset.observations[0]!, value: 999 });
  }
  const slices = options.otherSliceRows ? [20403, 20624] : [20624];
  const crossSlice = crossSliceDailyTotals(rows, slices);
  const candidates = slices.map((slice) => sliceCandidateStats(rows, slice, 3));
  return {
    input: {
      dataset,
      rows,
      candidates,
      crossSlice,
      expected: { from: "2026-10-13", toInclusive: "2026-10-15", days: 3 },
      determinism: { runs: 2, identical: options.deterministic ?? true },
    },
    rows,
  };
}

describe("сверка канонического набора", () => {
  test("полное совпадение — PASS", () => {
    const { input } = reconcileFixture({ otherSliceRows: true });
    const result = reconcileDataset(input);
    expect(result.status).toBe("PASS");
    expect(result.counts.conflicts).toBe(0);
    expect(result.totals.equal).toBe(true);
    expect(result.crossSliceMismatches).toBe(0);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  test("расхождение в одной дате — BLOCKED", () => {
    const { input } = reconcileFixture({ canonValue: 1 });
    const result = reconcileDataset(input);
    expect(result.status).toBe("BLOCKED");
    expect(result.counts.conflicts).toBe(1);
    expect(result.issues.some((issue) => issue.code === "daily_values_match_source")).toBe(true);
  });

  test("расхождение общей суммы — BLOCKED (потеря записи)", () => {
    const { input } = reconcileFixture();
    input.dataset.observations = input.dataset.observations.slice(0, 2);
    input.dataset.totalDelivered = input.dataset.observations.reduce((acc, observation) => acc + observation.value, 0);
    const result = reconcileDataset(input);
    expect(result.status).toBe("BLOCKED");
    expect(result.totals.equal).toBe(false);
    expect(result.issues.some((issue) => issue.code === "totals_match_source")).toBe(true);
  });

  test("задвоение записи — BLOCKED", () => {
    const { input } = reconcileFixture({ extraCanonicalRow: true });
    const result = reconcileDataset(input);
    expect(result.status).toBe("BLOCKED");
    expect(result.issues.some((issue) => issue.code === "no_duplicate_dates")).toBe(true);
  });

  test("строки других срезов не попадают в набор и не суммируются", () => {
    const { input } = reconcileFixture({ otherSliceRows: true });
    const result = reconcileDataset(input);
    expect(result.checks.find((check) => check.code === "no_other_slice_rows_in_dataset")!.passed).toBe(true);
    expect(input.dataset.observations.every((observation) => observation.sourceSliceId === 20624)).toBe(true);
    expect(input.dataset.totalDelivered).toBe(303);
  });

  test("недетерминированный результат — BLOCKED", () => {
    const { input } = reconcileFixture({ deterministic: false });
    const result = reconcileDataset(input);
    expect(result.status).toBe("BLOCKED");
    expect(result.issues.some((issue) => issue.code === "deterministic_build")).toBe(true);
  });

  test("контрольная сумма Stage 3.1 передаётся извне и проверяется", () => {
    const { input } = reconcileFixture();
    input.expected = { ...input.expected, total: 303 } as typeof input.expected;
    const matched = reconcileDataset(input);
    expect(matched.totals.matchesExpected).toBe(true);
    expect(matched.totals.expectedTotal).toBe(303);

    input.expected = { ...input.expected, total: 999 } as typeof input.expected;
    const mismatched = reconcileDataset(input);
    expect(mismatched.totals.matchesExpected).toBe(false);
    expect(mismatched.status).toBe("BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// 7.2.G — read-only доступ
// ---------------------------------------------------------------------------
describe("read-only доступ к SQLite", () => {
  test("запись отклоняется, данные и целостность не меняются", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-canonical-"));
    const path = join(dir, "forecasting.sqlite");
    const store = await openStore(path);
    try {
      store.db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run(SHOP, SHOP, AT);
      for (const date of ["2026-10-13", "2026-10-14"]) {
        store.db
          .query(
            `INSERT INTO daily_metrics
               (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, unit, evidence_status, data_status, transform_version, loaded_at)
             VALUES (?, ?, 20624, '7745ДС_Мосфильмовская74', '', ?, 'additive', 100, 'count', 'actual', 'full', 'v1', ?)`,
          )
          .run(SHOP, date, METRIC, AT);
      }
    } finally {
      store.close();
    }

    const connection = openReadOnlyDatabase(path);
    try {
      const before = readTableCounts(connection.db);
      expect(connection.writeBlocked).toBe(true);
      expect(() => connection.db.query("INSERT INTO shops (shop_no, created_at) VALUES ('x','2026-01-01T00:00:00.000Z')").run()).toThrow(/readonly/i);
      expect(() => connection.db.exec("UPDATE daily_metrics SET value = 0")).toThrow(/readonly|query_only/i);
      const integrity = readIntegrity(connection.db);
      expect(integrity.integrity).toBe("ok");
      expect(integrity.foreign_key_violations).toBe(0);
      expect(integrity.query_only).toBe(1);
      expect(readTableCounts(connection.db)).toEqual(before);
    } finally {
      connection.db.close(false);
    }
  });

  test("период метрики определяется по дневным строкам", () => {
    const rows = [row("2026-10-13", 1), row("2026-10-15", 2), row("", 3)];
    expect(metricPeriod(rows)).toEqual({ from: "2026-10-13", to: "2026-10-15", days: 2 });
  });
});
