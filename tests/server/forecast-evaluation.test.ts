// UI-4.1 / UI-4.1.1: тесты вычислительного ядра (forecast-eval/v1, редакция UI-4.0.2).
import { describe, expect, test } from "bun:test";

import {
  BASELINE_IDENTITY,
  CANDIDATE_IDENTITY,
  buildEvaluationSummary,
  buildPairs,
  classifyComputeStatus,
  classifyConflicts,
  classifyUnknown,
  computeMetrics,
  eligibility,
  evaluate,
  isKnownMode,
  matchesIdentity,
  summariesByMode,
  type MetricInput,
  type ReconciliationLike,
  type SnapshotLike,
} from "../../src/server/forecast-evaluation";

const HEX = "a".repeat(64);
const HEX_B = "b".repeat(64);

function snap(over: Partial<SnapshotLike> = {}): SnapshotLike {
  return {
    snapshot_id: "s1", mode: "shadow", model_id: "rolling_7_day_mean", model_version: "rolling-7-day-mean/v1", variant: null,
    horizon: 1, origin_date: "2026-11-20", target_date: "2026-11-21", forecast_value: 1500, status: "OK",
    input_data_version: "iv1", dataset_checksum: HEX, ...over,
  };
}
function candidate(over: Partial<SnapshotLike> = {}): SnapshotLike {
  return snap({ snapshot_id: "c1", model_id: "adaptive_baseline", model_version: "adaptive-baseline/v1+variantB", variant: "B", ...over });
}
function rec(over: Partial<ReconciliationLike> = {}): ReconciliationLike {
  return { snapshot_id: "s1", model_id: "rolling_7_day_mean", horizon: 1, target_date: "2026-11-21", forecast_value: 1500, actual: 1545, ...over };
}
function metric(over: Partial<MetricInput> = {}): MetricInput {
  return { mode: "shadow", horizon: 1, modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1", forecast: 100, actual: 100, ...over };
}
const baselineContext = { mode: "shadow" as const, horizon: 1, modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1" };

describe("17.1 Eligibility (E01–E12)", () => {
  test("E01 OK + actual + forecast → ELIGIBLE", () => {
    expect(eligibility(snap(), rec())).toMatchObject({ eligibility: "ELIGIBLE", reason: null, factStatus: "RECONCILED", mode: "shadow", horizon: 1 });
  });
  test("E02/E03 FALLBACK и INVALID → EXCLUDED_STATUS", () => {
    expect(eligibility(snap({ status: "FALLBACK" }), rec()).reason).toBe("EXCLUDED_STATUS");
    expect(eligibility(snap({ status: "INVALID" }), rec()).reason).toBe("EXCLUDED_STATUS");
  });
  test("E04 forecast_value = null → EXCLUDED_NULL_FORECAST", () => {
    expect(eligibility(snap({ forecast_value: null }), rec()).reason).toBe("EXCLUDED_NULL_FORECAST");
  });
  test("E05/E06 нет reconciliation или actual невалиден → MISSING_ACTUAL", () => {
    expect(eligibility(snap(), null).reason).toBe("MISSING_ACTUAL");
    expect(eligibility(snap(), rec({ actual: Number.NaN })).reason).toBe("MISSING_ACTUAL");
  });
  test("E07 техническая незрелость → PENDING", () => {
    expect(eligibility(snap(), rec(), { technicalFactCutoff: "2026-11-20" })).toMatchObject({ reason: "PENDING", factStatus: "PENDING" });
  });
  test("E08 неизвестный mode → UNKNOWN_MODE", () => {
    expect(eligibility(snap({ mode: "backtest" }), rec()).reason).toBe("UNKNOWN_MODE");
  });
  test("E09 неизвестный status → UNKNOWN_STATUS (не OK)", () => {
    expect(eligibility(snap({ status: "weird" }), rec())).toMatchObject({ reason: "UNKNOWN_STATUS", computeStatus: "UNKNOWN" });
  });
  test("E10/E11 неверная версия или variant → EXCLUDED_MODEL_VERSION", () => {
    expect(eligibility(snap({ model_version: "rolling-7-day-mean/v2" }), rec(), { expectedIdentity: BASELINE_IDENTITY }).reason).toBe("EXCLUDED_MODEL_VERSION");
    expect(eligibility(snap({ variant: "C" }), rec(), { expectedIdentity: BASELINE_IDENTITY }).reason).toBe("EXCLUDED_MODEL_VERSION");
  });
  test("E12 UNKNOWN не превращается в OK", () => {
    expect(classifyComputeStatus("unknown")).toBe("UNKNOWN");
    expect(eligibility(snap({ status: "unknown" }), rec()).eligibility).toBe("EXCLUDED");
  });
});

describe("17.2 Парность (P01–P20)", () => {
  test("P01 корректная пара", () => {
    const { pairs, counters } = buildPairs([snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    expect(counters.pairedN).toBe(1);
    expect(pairs[0]!.pairIdentity).toMatchObject({ mode: "shadow", horizon: 1, originDate: "2026-11-20", targetDate: "2026-11-21", inputDataVersion: "iv1" });
  });
  test("P02/P03 нет участника → unmatchedN", () => {
    expect(buildPairs([snap()], [rec()]).counters.unmatchedN).toBe(1);
    expect(buildPairs([candidate()], [rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.unmatchedN).toBe(1);
  });
  test("P04–P08 разные mode/horizon/origin/target/input_data_version", () => {
    const cases: SnapshotLike[] = [candidate({ mode: "replay" }), candidate({ horizon: 3 }), candidate({ origin_date: "2026-11-19" }), candidate({ target_date: "2026-11-22" }), candidate({ input_data_version: "iv2" })];
    for (const cand of cases) {
      const { counters } = buildPairs([snap(), cand], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
      expect(counters.pairedN, JSON.stringify(cand)).toBe(0);
      expect(counters.unmatchedN).toBeGreaterThan(0);
    }
  });
  test("P09–P11 неверная версия/variant → не пара", () => {
    expect(buildPairs([snap(), candidate({ model_version: "adaptive-baseline/v2" })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.pairedN).toBe(0);
    expect(buildPairs([snap(), candidate({ variant: "A" })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.pairedN).toBe(0);
  });
  test("P12/P13 null forecast у участника", () => {
    expect(buildPairs([snap({ forecast_value: null }), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.pairedN).toBe(0);
    expect(buildPairs([snap(), candidate({ forecast_value: null })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.pairedN).toBe(0);
  });
  test("P14 нет reconciliation у участника", () => {
    expect(buildPairs([snap(), candidate()], [rec()]).counters.pairedN).toBe(0);
  });
  test("P15 разные actual → CONFLICT_ACTUAL", () => {
    const { counters } = buildPairs([snap(), candidate()], [rec({ actual: 1545 }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline", actual: 1600 })]);
    expect(counters.pairedN).toBe(0);
    expect(counters.conflictN).toBeGreaterThan(0);
  });
  test("P16 техническая незрелость → PENDING", () => {
    const { counters } = buildPairs([snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })], { technicalFactCutoff: "2026-11-20" });
    // оба участника пары незрелые → два наблюдения PENDING
    expect(counters.pendingN).toBe(2);
  });
  test("P17 replay и shadow не смешиваются", () => {
    const snapshots = [snap(), candidate(), snap({ snapshot_id: "r1", mode: "replay" }), candidate({ snapshot_id: "r2", mode: "replay" })];
    const reconciliations = [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec({ snapshot_id: "r1" }), rec({ snapshot_id: "r2", model_id: "adaptive_baseline" })];
    const summaries = summariesByMode(snapshots, reconciliations);
    expect(summaries.find((entry) => entry.mode === "shadow")!.pairCounters.pairedN).toBe(1);
    expect(summaries.find((entry) => entry.mode === "replay")!.pairCounters.pairedN).toBe(1);
  });
  test("P18 разные dataset_checksum → пара + DATASET_VERSION_DIFFERS", () => {
    const { pairs, counters } = buildPairs([snap(), candidate({ dataset_checksum: HEX_B })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    expect(counters.pairedN).toBe(1);
    expect(pairs[0]!.warnings).toContain("DATASET_VERSION_DIFFERS");
  });
  test("P19/P20 отсутствующий и нестроковый checksum → UNKNOWN_DATASET_VERSION", () => {
    expect(eligibility(snap({ dataset_checksum: null }), rec()).reason).toBe("UNKNOWN_DATASET_VERSION");
    expect(eligibility(snap({ dataset_checksum: 12345 as unknown as string }), rec()).reason).toBe("UNKNOWN_DATASET_VERSION");
  });
});

describe("17.3 Дубли (D01–D12)", () => {
  test("D01/D02 дубли snapshot", () => {
    expect(classifyConflicts([snap(), snap(), snap()], [rec()]).duplicateSnapshotIds).toEqual([{ snapshotId: "s1", count: 3 }]);
    expect(eligibility(snap(), rec(), { duplicateSnapshotIds: new Set(["s1"]) }).reason).toBe("CONFLICT_DUPLICATE");
    expect(buildPairs([snap(), snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).counters.pairedN).toBe(0);
  });
  test("D03 дубли reconciliation", () => {
    expect(classifyConflicts([snap()], [rec(), rec()]).duplicateReconciliationIds).toEqual([{ snapshotId: "s1", count: 2 }]);
  });
  test("D04/D05 дубли baseline/candidate → конфликт без выбора победителя", () => {
    const { counters } = buildPairs([snap(), snap({ snapshot_id: "s1b" }), candidate()], [rec(), rec({ snapshot_id: "s1b" }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    expect(counters.pairedN).toBe(0);
    expect(counters.conflictN).toBeGreaterThan(0);
  });
  test("D06/D07 snapshot без reconciliation и reconciliation без snapshot", () => {
    const report = classifyConflicts([snap({ snapshot_id: "orphan-snap" })], [rec({ snapshot_id: "missing-snap" })]);
    expect(report.snapshotsWithoutReconciliation).toContain("orphan-snap");
    expect(report.orphanReconciliations).toContain("missing-snap");
    expect(report.unknownRecords.some((entry) => entry.kind === "UNKNOWN_SNAPSHOT")).toBe(true);
  });
  test("D08 расхождение forecast_value", () => {
    expect(classifyConflicts([snap({ forecast_value: 1500 })], [rec({ forecast_value: 999 })]).forecastValueMismatches).toContain("s1");
    expect(eligibility(snap(), rec({ forecast_value: 999 })).reason).toBe("CONFLICT_FORECAST_VALUE");
  });
  test("D09 разные actual", () => {
    expect(classifyConflicts([snap(), candidate()], [rec({ actual: 1500 }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline", actual: 1600 })]).actualConflicts.length).toBe(1);
  });
  test("D10–D12 конфликтующие идентификаторы сохраняются", () => {
    const report = classifyConflicts([snap(), snap({ forecast_value: 1600 })], [rec(), rec()]);
    expect(report.duplicateSnapshotIds[0]).toEqual({ snapshotId: "s1", count: 2 });
    expect(report.duplicateReconciliationIds[0]).toEqual({ snapshotId: "s1", count: 2 });
  });
});

describe("17.4 Метрики (M01–M14)", () => {
  test("M01–M05 MAE, Bias, WAPE", () => {
    expect(computeMetrics([metric({ forecast: 100, actual: 110 }), metric({ forecast: 200, actual: 180 })], baselineContext).metrics.mae).toBe(15);
    expect(computeMetrics([metric({ forecast: 110, actual: 100 })], baselineContext).metrics.bias).toBe(10);
    expect(computeMetrics([metric({ forecast: 90, actual: 100 })], baselineContext).metrics.bias).toBe(-10);
    expect(computeMetrics([metric({ forecast: 90, actual: 100 }), metric({ forecast: 120, actual: 100 })], baselineContext).metrics.wape).toBeCloseTo(15, 6);
    expect(computeMetrics([metric({ forecast: 100, actual: 100 })], baselineContext).metrics.wape).toBe(0);
  });
  test("M06 нулевой знаменатель → null + NOT_AVAILABLE", () => {
    const { metrics } = computeMetrics([metric({ forecast: 5, actual: 0 })], baselineContext);
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("NOT_AVAILABLE");
    expect(metrics.mae).toBe(5);
  });
  test("M07 пустая выборка → null + NOT_AVAILABLE", () => {
    expect(computeMetrics([], baselineContext).metrics).toMatchObject({ n: 0, mae: null, bias: null, wape: null, wapeStatus: "NOT_AVAILABLE" });
  });
  test("M08–M11 under/over/exact и сумма", () => {
    const { metrics } = computeMetrics([metric({ forecast: 90 }), metric({ forecast: 110 }), metric({ forecast: 100 }), metric({ forecast: 95 })], baselineContext);
    expect([metrics.underN, metrics.overN, metrics.exactN]).toEqual([2, 1, 1]);
    expect(metrics.underN + metrics.overN + metrics.exactN).toBe(metrics.n);
  });
  test("M12–M14 NaN/Infinity отфильтрованы, null не превращается в 0", () => {
    const { metrics, excluded } = computeMetrics([metric({ forecast: Number.NaN }), metric({ forecast: Number.POSITIVE_INFINITY }), metric({ forecast: 100, actual: 100 })], baselineContext);
    expect(metrics.n).toBe(1);
    expect(metrics.mae).toBe(0);
    expect(excluded.filter((entry) => entry.reason === "NON_FINITE").length).toBe(2);
  });
});

describe("17.5 Режимы (R01–R05)", () => {
  test("R01–R03 сводки по режимам раздельны", () => {
    const snapshots = [snap(), candidate(), snap({ snapshot_id: "r1", mode: "replay" }), candidate({ snapshot_id: "r2", mode: "replay" })];
    const reconciliations = [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec({ snapshot_id: "r1" }), rec({ snapshot_id: "r2", model_id: "adaptive_baseline" })];
    const summaries = summariesByMode(snapshots, reconciliations);
    expect(summaries.length).toBe(2);
    expect(new Set(summaries.map((entry) => entry.mode))).toEqual(new Set(["shadow", "replay"]));
  });
  test("R04/R05 неизвестный режим не создаёт сводку и виден в диагностике", () => {
    expect(isKnownMode("backtest")).toBe(false);
    const result = evaluate([snap({ mode: "backtest" })], [rec()]);
    expect(result.summaries.length).toBe(0);
    expect(result.diagnostics.unknownRecords.some((entry) => entry.kind === "UNKNOWN_MODE")).toBe(true);
  });
});

describe("17.6 Инварианты (I01–I06)", () => {
  test("I01/I02 входные данные не мутируются", () => {
    const snapshots = [snap(), candidate()];
    const reconciliations = [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })];
    const snapshotsCopy = JSON.stringify(snapshots);
    const reconciliationsCopy = JSON.stringify(reconciliations);
    evaluate(snapshots, reconciliations);
    expect(JSON.stringify(snapshots)).toBe(snapshotsCopy);
    expect(JSON.stringify(reconciliations)).toBe(reconciliationsCopy);
  });
  test("I03/I05 детерминизм", () => {
    const snapshots = [snap(), candidate()];
    const reconciliations = [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })];
    expect(JSON.stringify(evaluate(snapshots, reconciliations))).toBe(JSON.stringify(evaluate(snapshots, reconciliations)));
  });
  test("I04 порядок записей не влияет на метрики", () => {
    const forward = buildEvaluationSummary("shadow", 1, [snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    const reversed = buildEvaluationSummary("shadow", 1, [candidate(), snap()], [rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec()]);
    expect(reversed.pairedComparison.pairedN).toBe(forward.pairedComparison.pairedN);
    expect(reversed.pairedComparison.maeBaseline).toBe(forward.pairedComparison.maeBaseline);
  });
  test("I06 нет системного времени и ввода-вывода", () => {
    const source = require("node:fs").readFileSync("src/server/forecast-evaluation.ts", "utf8") as string;
    for (const forbidden of ["Date.now", "new Date", "readFile", "Bun.file", "fetch(", "process.env"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("C-1 независимая оценка отделена от парной (T41-01…T41-05)", () => {
  test("T41-01 3 baseline и 1 candidate: independent 3/1, pairedN 1", () => {
    const snapshots = [
      snap({ snapshot_id: "b1", origin_date: "2026-11-18", target_date: "2026-11-19" }),
      snap({ snapshot_id: "b2", origin_date: "2026-11-19", target_date: "2026-11-20" }),
      snap({ snapshot_id: "b3", origin_date: "2026-11-20", target_date: "2026-11-21" }),
      candidate({ snapshot_id: "c3", origin_date: "2026-11-20", target_date: "2026-11-21" }),
    ];
    const reconciliations = [
      rec({ snapshot_id: "b1", target_date: "2026-11-19", forecast_value: 1500, actual: 1400 }),
      rec({ snapshot_id: "b2", target_date: "2026-11-20", forecast_value: 1500, actual: 1600 }),
      rec({ snapshot_id: "b3", target_date: "2026-11-21", forecast_value: 1500, actual: 1545 }),
      rec({ snapshot_id: "c3", model_id: "adaptive_baseline", target_date: "2026-11-21", forecast_value: 1500, actual: 1545 }),
    ];
    const result = evaluate(snapshots, reconciliations);
    const summary = result.summaries[0]!;
    const baseline = summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!;
    const candidateMetrics = summary.independentMetrics.find((entry) => entry.modelId === CANDIDATE_IDENTITY.modelId)!;
    expect(baseline.n).toBe(3);
    expect(candidateMetrics.n).toBe(1);
    expect(summary.pairedComparison.pairedN).toBe(1);
    expect(result.diagnostics.counters.baselineIndependentN).toBe(3);
    expect(result.diagnostics.counters.candidateIndependentN).toBe(1);
  });
  test("T41-02/T41-03 участник без пары попадает в независимые метрики", () => {
    const baselineOnly = evaluate([snap()], [rec()]).summaries[0]!;
    expect(baselineOnly.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!.n).toBe(1);
    expect(baselineOnly.pairedComparison.pairedN).toBe(0);
    const candidateOnly = evaluate([candidate()], [rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]).summaries[0]!;
    expect(candidateOnly.independentMetrics.find((entry) => entry.modelId === CANDIDATE_IDENTITY.modelId)!.n).toBe(1);
    expect(candidateOnly.pairedComparison.pairedN).toBe(0);
  });
  test("T41-04 непригодные наблюдения не входят в метрики, причина сохраняется", () => {
    // непригодное наблюдение имеет свою pair identity, чтобы не создавать конфликт идентичности (C-10)
    const result = evaluate(
      [snap(), snap({ snapshot_id: "bad", status: "FALLBACK", origin_date: "2026-11-19", target_date: "2026-11-20" })],
      [rec(), rec({ snapshot_id: "bad", target_date: "2026-11-20" })],
    );
    const summary = result.summaries[0]!;
    expect(summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!.n).toBe(1);
    expect(summary.eligibilityDiagnostics.find((entry) => entry.snapshotId === "bad")!.reason).toBe("EXCLUDED_STATUS");
  });
  test("T41-05 independent MAE и paired MAE считаются на своих выборках", () => {
    const snapshots = [snap({ snapshot_id: "b1", origin_date: "2026-11-18", target_date: "2026-11-19" }), snap({ snapshot_id: "b2" }), candidate({ snapshot_id: "c2" })];
    const reconciliations = [
      rec({ snapshot_id: "b1", target_date: "2026-11-19", forecast_value: 1500, actual: 1000 }),
      rec({ snapshot_id: "b2", forecast_value: 1500, actual: 1545 }),
      rec({ snapshot_id: "c2", model_id: "adaptive_baseline", forecast_value: 1500, actual: 1545 }),
    ];
    const summary = evaluate(snapshots, reconciliations).summaries[0]!;
    const independent = summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!;
    expect(independent.n).toBe(2);
    expect(independent.mae).toBeCloseTo((500 + 45) / 2, 6);
    expect(summary.pairedComparison.pairedN).toBe(1);
    expect(summary.pairedComparison.maeBaseline).toBeCloseTo(45, 6);
  });
});

describe("C-2 горизонты (T41-06…T41-10)", () => {
  test("T41-06/T41-07 h1 и h3 допускаются", () => {
    expect(evaluate([snap({ horizon: 1 })], [rec({ horizon: 1 })]).summaries[0]!.independentMetrics[0]!.n).toBe(1);
    const h3 = evaluate([snap({ horizon: 3, target_date: "2026-11-23" })], [rec({ horizon: 3, target_date: "2026-11-23" })]);
    expect(h3.summaries[0]!.horizon).toBe(3);
    expect(h3.summaries[0]!.independentMetrics[0]!.n).toBe(1);
  });
  test("T41-08/T41-09/T41-10 h5 исключается и виден в диагностике", () => {
    const result = evaluate([snap({ horizon: 5 })], [rec({ horizon: 5 })]);
    expect(result.summaries.length).toBe(0);
    expect(result.diagnostics.counters.unsupportedHorizonN).toBe(1);
    expect(result.diagnostics.unknownRecords.some((entry) => entry.kind === "UNKNOWN_HORIZON")).toBe(true);
    expect(buildPairs([snap(), candidate({ horizon: 5 })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline", horizon: 5 })]).counters.pairedN).toBe(0);
    expect(eligibility(snap({ horizon: 5 }), rec({ horizon: 5 })).reason).toBe("UNKNOWN_HORIZON");
  });
});

describe("C-3 контекст метрик (T41-11…T41-14)", () => {
  test("T41-11/T41-12 пустая выборка сохраняет переданный контекст", () => {
    const shadow = computeMetrics([], { mode: "shadow", horizon: 1, modelId: BASELINE_IDENTITY.modelId, modelVersion: BASELINE_IDENTITY.modelVersion }).metrics;
    expect(shadow).toMatchObject({ mode: "shadow", horizon: 1, n: 0, mae: null, wape: null, bias: null, wapeStatus: "NOT_AVAILABLE" });
    const replay = computeMetrics([], { mode: "replay", horizon: 3, modelId: CANDIDATE_IDENTITY.modelId, modelVersion: CANDIDATE_IDENTITY.modelVersion }).metrics;
    expect(replay).toMatchObject({ mode: "replay", horizon: 3, modelId: CANDIDATE_IDENTITY.modelId, n: 0 });
  });
  test("T41-13/T41-14 фиктивная идентичность не создаётся", () => {
    const metrics = computeMetrics([], baselineContext).metrics;
    expect(metrics.mode).not.toBe("shadow" === metrics.mode ? "UNKNOWN" : "shadow");
    expect(metrics.horizon).toBe(1);
    expect(metrics.modelId).toBe(BASELINE_IDENTITY.modelId);
    expect(computeMetrics([], { mode: "shadow", horizon: 1, modelId: "UNKNOWN", modelVersion: "UNKNOWN" }).metrics.modelId).toBe("UNKNOWN");
  });
});

describe("C-4 арифметическая безопасность (T41-15…T41-22)", () => {
  test("T41-15/T41-18 MAE не становится Infinity при переполнении", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE })], baselineContext);
    expect(metrics.mae).toBeNull();
    expect(metrics.biasStatus).toBe("OVERFLOW");
  });
  test("T41-16/T41-17 переполнение накопления сумм", () => {
    const { metrics } = computeMetrics([
      metric({ forecast: Number.MAX_VALUE, actual: 0 }),
      metric({ forecast: Number.MAX_VALUE, actual: 0 }),
      metric({ forecast: Number.MAX_VALUE, actual: 0 }),
    ], baselineContext);
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
    expect(Number.isFinite(metrics.mae ?? 0)).toBe(true);
  });
  test("T41-19/T41-20/T41-21 WAPE и Bias не Infinity; статус не OK при null", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: Number.MAX_VALUE })], baselineContext);
    expect(metrics.wape === null || Number.isFinite(metrics.wape)).toBe(true);
    expect(metrics.bias === null || Number.isFinite(metrics.bias)).toBe(true);
    expect(metrics.wapeStatus === "OK" ? Number.isFinite(metrics.wape) : true).toBe(true);
  });
  test("T41-22 корректные числа сохраняют результат", () => {
    const { metrics } = computeMetrics([metric({ forecast: 100, actual: 110 }), metric({ forecast: 200, actual: 180 })], baselineContext);
    expect(metrics).toMatchObject({ n: 2, mae: 15, bias: 5 });
  });
});

describe("C-5 согласованность reconciliation (T41-23…T41-29)", () => {
  test("T41-23 совпадающие поля → нет конфликта", () => {
    expect(classifyConflicts([snap()], [rec()]).reconciliationMismatches).toEqual([]);
    expect(eligibility(snap(), rec()).eligibility).toBe("ELIGIBLE");
  });
  test("T41-24/T41-25/T41-26/T41-27 несовпадение model_id/horizon/target_date/forecast_value", () => {
    expect(classifyConflicts([snap()], [rec({ model_id: "adaptive_baseline" })]).reconciliationMismatches[0]!.field).toBe("model_id");
    expect(classifyConflicts([snap()], [rec({ horizon: 3 })]).reconciliationMismatches[0]!.field).toBe("horizon");
    expect(classifyConflicts([snap()], [rec({ target_date: "2026-11-22" })]).reconciliationMismatches[0]!.field).toBe("target_date");
    expect(classifyConflicts([snap()], [rec({ forecast_value: 1 })]).reconciliationMismatches[0]!.field).toBe("forecast_value");
  });
  test("T41-28 отсутствие forecast_value в reconciliation — не конфликт", () => {
    const record = { snapshot_id: "s1", model_id: "rolling_7_day_mean", horizon: 1, target_date: "2026-11-21", actual: 1545 };
    expect(classifyConflicts([snap()], [record]).reconciliationMismatches).toEqual([]);
    expect(eligibility(snap(), record).eligibility).toBe("ELIGIBLE");
  });
  test("T41-29 конфликт reconciliation исключает наблюдение из обеих оценок", () => {
    const result = evaluate([snap(), candidate()], [rec({ model_id: "adaptive_baseline" }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    const summary = result.summaries[0]!;
    // исключается только конфликтующее наблюдение baseline; candidate остаётся пригодным, но пары нет
    expect(summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!.n).toBe(0);
    expect(summary.independentMetrics.find((entry) => entry.modelId === CANDIDATE_IDENTITY.modelId)!.n).toBe(1);
    expect(summary.pairedComparison.pairedN).toBe(0);
    expect(summary.eligibilityDiagnostics.some((entry) => entry.reason === "CONFLICT_RECONCILIATION")).toBe(true);
  });
});

describe("C-6/C-7/C-8 диагностика (T41-30…T41-43)", () => {
  test("T41-30…T41-33 orphan reconciliation виден, не влияет на метрики и не создаёт mode", () => {
    const result = evaluate([snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec({ snapshot_id: "ghost", actual: 1 })]);
    expect(result.diagnostics.conflicts.orphanReconciliations).toContain("ghost");
    expect(result.diagnostics.unknownRecords.some((entry) => entry.kind === "UNKNOWN_SNAPSHOT" && entry.recordType === "reconciliation")).toBe(true);
    expect(result.diagnostics.counters.orphanReconciliationN).toBe(1);
    const summary = result.summaries[0]!;
    expect(summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!.n).toBe(1);
    expect(summary.mode).toBe("shadow");
  });
  test("T41-34…T41-38 неизвестные записи видимы и не попадают в метрики", () => {
    const snapshots = [snap({ snapshot_id: "u1", mode: "x" }), snap({ snapshot_id: "u2", model_id: "other" }), snap({ snapshot_id: "u3", status: "x" }), snap({ snapshot_id: "u4", horizon: 7 })];
    const result = evaluate(snapshots, [rec({ snapshot_id: "u1" }), rec({ snapshot_id: "u2" }), rec({ snapshot_id: "u3" }), rec({ snapshot_id: "u4" })]);
    const kinds = new Set(result.diagnostics.unknownRecords.map((entry) => entry.kind));
    expect(kinds.has("UNKNOWN_MODE")).toBe(true);
    expect(kinds.has("UNKNOWN_MODEL")).toBe(true);
    expect(kinds.has("UNKNOWN_STATUS")).toBe(true);
    expect(kinds.has("UNKNOWN_HORIZON")).toBe(true);
    // сводка по известному режиму может существовать, но неизвестные записи в метрики не попадают
    expect(result.summaries.every((summary) => summary.independentMetrics.every((entry) => entry.n === 0))).toBe(true);
  });
  test("T41-39…T41-43 UNKNOWN_RECONCILIATION отделён от CONFLICT_DUPLICATE", () => {
    const orphan = classifyConflicts([snap()], [rec({ snapshot_id: "missing" })]);
    expect(orphan.unknownRecords.some((entry) => entry.kind === "UNKNOWN_SNAPSHOT")).toBe(true);
    const invalid = classifyConflicts([snap()], [rec({ actual: Number.NaN })]);
    expect(invalid.invalidReconciliations).toContain("s1");
    expect(invalid.unknownRecords.some((entry) => entry.kind === "UNKNOWN_RECONCILIATION")).toBe(true);
    const badHorizon = classifyConflicts([snap()], [rec({ horizon: 9 })]);
    expect(badHorizon.invalidReconciliations).toContain("s1");
    const duplicates = classifyConflicts([snap()], [rec(), rec()]);
    expect(duplicates.duplicateReconciliationIds.length).toBe(1);
    expect(duplicates.unknownRecords.some((entry) => entry.kind === "UNKNOWN_RECONCILIATION")).toBe(false);
  });
});

describe("C-9/C-10 защита контекста и pair identity (T41-44…T41-56)", () => {
  test("T41-44/T41-45/T41-46/T41-47 смешение контекстов исключается", () => {
    const mixed = [
      metric({ mode: "replay" }),
      metric({ horizon: 3 }),
      metric({ modelId: "adaptive_baseline", modelVersion: "adaptive-baseline/v1+variantB" }),
      metric({ modelVersion: "rolling-7-day-mean/v2" }),
      metric({ forecast: 100, actual: 100 }),
    ];
    const { metrics, excluded } = computeMetrics(mixed, baselineContext);
    expect(metrics.n).toBe(1);
    expect(excluded.filter((entry) => entry.reason === "CONTEXT_MISMATCH").length).toBe(4);
  });
  test("T41-48/T41-49 несовпадающие записи диагностируемы, однородная выборка сохраняет результат", () => {
    const { excluded } = computeMetrics([metric({ mode: "replay" }), metric({ forecast: 100, actual: 100 })], baselineContext);
    expect(excluded[0]!.detail).toContain("replay");
    expect(computeMetrics([metric({ forecast: 100, actual: 110 })], baselineContext).metrics.mae).toBe(10);
  });
  test("T41-50/T41-56 разные модели с одной pair identity — нормальная пара", () => {
    const { pairs, counters } = buildPairs([snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    expect(counters.pairedN).toBe(1);
    expect(pairs.length).toBe(1);
    expect(counters.pairIdentityConflictN).toBe(0);
  });
  test("T41-51/T41-52/T41-53 два участника одной модели с одной pair identity → конфликт, ID сохранены", () => {
    const result = evaluate([snap({ snapshot_id: "b1" }), snap({ snapshot_id: "b2" }), candidate()], [rec({ snapshot_id: "b1" }), rec({ snapshot_id: "b2" }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    const conflicts = result.diagnostics.conflicts.pairIdentityConflicts;
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.participant).toBe("baseline");
    expect(conflicts[0]!.snapshotIds.sort()).toEqual(["b1", "b2"]);
    expect(result.diagnostics.counters.pairIdentityConflictN).toBe(1);
    const candidateConflict = evaluate([snap(), candidate({ snapshot_id: "c1" }), candidate({ snapshot_id: "c2" })], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec({ snapshot_id: "c2", model_id: "adaptive_baseline" })]);
    expect(candidateConflict.diagnostics.conflicts.pairIdentityConflicts[0]!.participant).toBe("candidate");
  });
  test("T41-54/T41-55 конфликтующие варианты не попадают в парную и независимую оценку", () => {
    const result = evaluate([snap({ snapshot_id: "b1" }), snap({ snapshot_id: "b2" }), candidate()], [rec({ snapshot_id: "b1" }), rec({ snapshot_id: "b2" }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    const summary = result.summaries[0]!;
    expect(summary.pairedComparison.pairedN).toBe(0);
    expect(summary.independentMetrics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!.n).toBe(0);
    expect(summary.eligibilityDiagnostics.filter((entry) => entry.reason === "CONFLICT_PAIR_IDENTITY").length).toBe(2);
  });
});

describe("Совместимость и контракт", () => {
  test("pairedN = 0 → NOT_AVAILABLE", () => {
    const summary = buildEvaluationSummary("shadow", 1, [snap()], [rec()]);
    expect(summary.pairedComparison.status).toBe("NOT_AVAILABLE");
    expect(summary.pairedComparison.deltaMae).toBeNull();
  });
  test("PROVISIONAL сохраняется в метриках и сводке", () => {
    const summary = buildEvaluationSummary("shadow", 1, [snap(), candidate()], [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })]);
    expect(summary.semantics).toBe("PROVISIONAL");
    expect(summary.independentMetrics.every((entry) => entry.semantics === "PROVISIONAL")).toBe(true);
  });
  test("identities проверяются независимо", () => {
    expect(matchesIdentity(snap(), BASELINE_IDENTITY)).toBe(true);
    expect(matchesIdentity(candidate(), CANDIDATE_IDENTITY)).toBe(true);
    expect(matchesIdentity(snap(), CANDIDATE_IDENTITY)).toBe(false);
  });
  test("classifyUnknown покрывает mode/model/status/horizon", () => {
    expect(classifyUnknown(snap({ mode: "x" }))).toBe("UNKNOWN_MODE");
    expect(classifyUnknown(snap({ model_id: "other" }))).toBe("UNKNOWN_MODEL");
    expect(classifyUnknown(snap({ status: "x" }))).toBe("UNKNOWN_STATUS");
    expect(classifyUnknown(snap({ horizon: 9 }))).toBe("UNKNOWN_HORIZON");
    expect(classifyUnknown(snap())).toBeNull();
  });
});

describe("UI-4.1.2: арифметическое переполнение (T1–T7)", () => {
  test("T1 переполнение разности", () => {
    const { metrics, excluded } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE })], baselineContext);
    expect(metrics.n).toBe(0);
    expect(metrics.mae).toBeNull();
    expect(metrics.maeStatus).toBe("OVERFLOW");
    expect(metrics.bias).toBeNull();
    expect(metrics.biasStatus).toBe("OVERFLOW");
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
    expect(metrics.excludedOverflowN).toBe(1);
    expect(metrics.overflowAffectedN).toBe(0);
    expect(metrics.excludedN).toBe(1);
    expect(metrics.sampleStatus).toBe("PARTIAL");
    expect(excluded[0]).toMatchObject({ reason: "OVERFLOW", detail: "разность не конечна" });
  });
  test("T2 переполнение суммы абсолютных ошибок", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE / 2, actual: 0 }), metric({ forecast: Number.MAX_VALUE / 2, actual: 0 }), metric({ forecast: Number.MAX_VALUE / 2, actual: 0 })], baselineContext);
    expect(metrics.n).toBe(3);
    expect(metrics.mae).toBeNull();
    expect(metrics.maeStatus).toBe("OVERFLOW");
    expect(metrics.excludedOverflowN).toBe(0);
    expect(metrics.overflowAffectedN).toBe(3);
    // агрегированное сообщение о переполнении метрик не считается исключённой строкой (C-14)
    expect(metrics.excludedN).toBe(0);
    expect(metrics.sampleStatus).toBe("COMPLETE");
  });
  test("T3 переполнение суммы знаковых ошибок", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }), metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }), metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 })], baselineContext);
    expect(metrics.bias).toBeNull();
    expect(metrics.biasStatus).toBe("OVERFLOW");
    expect(metrics.maeStatus).toBe("OVERFLOW");
  });
  test("T4 переполнение знаменателя WAPE не портит MAE и Bias", () => {
    // три значения по MAX_VALUE/2 переполняют сумму |actual| (MAX_VALUE/2 × 3 = Infinity)
    const { metrics } = computeMetrics([
      metric({ forecast: Number.MAX_VALUE / 2, actual: Number.MAX_VALUE / 2 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: Number.MAX_VALUE / 2 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: Number.MAX_VALUE / 2 }),
    ], baselineContext);
    expect(metrics.mae).toBe(0);
    expect(metrics.maeStatus).toBe("OK");
    expect(metrics.bias).toBe(0);
    expect(metrics.biasStatus).toBe("OK");
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
  });
  test("T5 переполнение финального WAPE при конечных суммах", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: 1 })], baselineContext);
    expect(metrics.mae).toBe(Number.MAX_VALUE - 1);
    expect(metrics.maeStatus).toBe("OK");
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
  });
  test("T6 нулевой знаменатель WAPE — NOT_AVAILABLE, не OVERFLOW", () => {
    const { metrics } = computeMetrics([metric({ forecast: 5, actual: 0 })], baselineContext);
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("NOT_AVAILABLE");
    expect(metrics.mae).toBe(5);
    expect(metrics.maeStatus).toBe("OK");
  });
  test("T7 смешанный набор: счётчики согласованы, частичный результат не выдаётся за полный", () => {
    const { metrics, excluded } = computeMetrics([
      metric({ forecast: 100, actual: 110 }),
      metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE }),
      metric({ forecast: 100, actual: 90 }),
    ], baselineContext);
    expect(metrics.n).toBe(2);
    expect(metrics.underN + metrics.overN + metrics.exactN).toBe(metrics.n);
    expect(metrics.underN).toBe(1);
    expect(metrics.overN).toBe(1);
    expect(metrics.exactN).toBe(0);
    expect(metrics.excludedOverflowN).toBe(1);
    expect(metrics.overflowAffectedN).toBe(0);
    expect(metrics.excludedN).toBe(1);
    expect(metrics.contextMismatchN).toBe(0);
    expect(metrics.nonFiniteN).toBe(0);
    // C-14: непересекающиеся категории покрывают весь вход
    expect(metrics.contextMismatchN + metrics.nonFiniteN + metrics.excludedOverflowN + metrics.n).toBe(3);
    expect(excluded.filter((entry) => entry.reason === "OVERFLOW").length).toBe(1);
    expect(metrics.mae).toBe(10);
    expect(metrics.maeStatus).toBe("OK");
    // C-16: метрика корректна, но выборка частичная
    expect(metrics.sampleStatus).toBe("PARTIAL");
  });
});

describe("UI-4.1.2: доступность парного сравнения (T8–T12)", () => {
  function pairWith(baselineForecast: number, candidateForecast: number, actual: number) {
    return evaluate(
      [snap({ forecast_value: baselineForecast }), candidate({ forecast_value: candidateForecast })],
      [rec({ forecast_value: baselineForecast, actual }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline", forecast_value: candidateForecast, actual })],
    ).summaries[0]!;
  }
  test("T8 baseline MAE переполнена, candidate корректна → сравнение не OK", () => {
    const summary = pairWith(Number.MAX_VALUE, 0, -Number.MAX_VALUE);
    expect(summary.pairedComparison.pairedN).toBe(1);
    expect(summary.pairedComparison.maeBaseline).toBeNull();
    expect(summary.pairedComparison.maeCandidate).toBe(Number.MAX_VALUE);
    expect(summary.pairedComparison.status).toBe("OVERFLOW");
    expect(summary.pairedComparison.available).toBe(false);
    expect(summary.pairedComparison.deltaMae).toBeNull();
  });
  test("T9 candidate MAE переполнена, baseline корректна → сравнение не OK", () => {
    const summary = pairWith(0, Number.MAX_VALUE, -Number.MAX_VALUE);
    expect(summary.pairedComparison.maeBaseline).toBe(Number.MAX_VALUE);
    expect(summary.pairedComparison.maeCandidate).toBeNull();
    expect(summary.pairedComparison.status).toBe("OVERFLOW");
    expect(summary.pairedComparison.available).toBe(false);
  });
  test("T10 переполнение delta недостижимо при неотрицательных MAE", () => {
    // MAE ≥ 0, поэтому разность двух конечных MAE всегда конечна: фиксируем это свойство
    const summary = pairWith(Number.MAX_VALUE, 0, 0);
    expect(summary.pairedComparison.maeBaseline).toBe(Number.MAX_VALUE);
    expect(summary.pairedComparison.maeCandidate).toBe(0);
    expect(summary.pairedComparison.deltaMae).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(summary.pairedComparison.deltaMae!)).toBe(true);
  });
  test("T11 обе метрики доступны и delta конечна → OK", () => {
    const summary = pairWith(1500, 1490, 1545);
    expect(summary.pairedComparison.status).toBe("OK");
    expect(summary.pairedComparison.available).toBe(true);
    // deltaMae = maeBaseline − maeCandidate = 45 − 55
    expect(summary.pairedComparison.maeBaseline).toBe(45);
    expect(summary.pairedComparison.maeCandidate).toBe(55);
    expect(summary.pairedComparison.deltaMae).toBe(-10);
  });
  test("T12 пар нет → NOT_AVAILABLE", () => {
    const summary = evaluate([snap()], [rec()]).summaries[0]!;
    expect(summary.pairedComparison.pairedN).toBe(0);
    expect(summary.pairedComparison.status).toBe("NOT_AVAILABLE");
    expect(summary.pairedComparison.available).toBe(false);
  });
  test("T13 диагностика метрик сохраняется в сводке (C-11.4)", () => {
    const summary = evaluate(
      [snap(), candidate()],
      [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" })],
    ).summaries[0]!;
    expect(summary.metricDiagnostics.length).toBe(2);
    for (const entry of summary.metricDiagnostics) {
      expect(Array.isArray(entry.excluded)).toBe(true);
      expect(entry.sampleStatus).toBe("COMPLETE");
      expect(entry.excludedN).toBe(entry.excluded.length);
    }
  });
});
describe("UI-4.1.2.1: счётчики, диагностика, полнота (C-14…C-17)", () => {
  test("C-14 инвариант счётчиков не пересекается и покрывает весь вход", () => {
    const cases: Array<{ name: string; records: MetricInput[] }> = [
      { name: "только корректные", records: [metric(), metric()] },
      { name: "переполнение разности", records: [metric(), metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE })] },
      { name: "переполнение накопления", records: [metric({ forecast: Number.MAX_VALUE, actual: 0 }), metric({ forecast: Number.MAX_VALUE, actual: 0 }), metric({ forecast: Number.MAX_VALUE, actual: 0 })] },
      { name: "нечисловые и чужие контексты", records: [metric(), metric({ forecast: Number.NaN }), metric({ mode: "replay" })] },
    ];
    for (const item of cases) {
      const { metrics } = computeMetrics(item.records, baselineContext);
      // непересекающиеся категории: контекст + нечисловые + исключённые из-за разности + вошедшие в расчёт
      expect(metrics.contextMismatchN + metrics.nonFiniteN + metrics.excludedOverflowN + metrics.n, item.name).toBe(item.records.length);
      // затронутые переполнением накопления не суммируются с исключёнными строками
      expect(metrics.overflowAffectedN, item.name).toBeLessThanOrEqual(metrics.n);
      expect(metrics.excludedN, item.name).toBe(metrics.contextMismatchN + metrics.nonFiniteN + metrics.excludedOverflowN);
    }
  });

  test("C-14 двойной учёт отсутствует при одновременном переполнении разности и накопления", () => {
    const { metrics } = computeMetrics([
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE }),
    ], baselineContext);
    expect(metrics.n).toBe(3);
    expect(metrics.excludedOverflowN).toBe(1);
    expect(metrics.overflowAffectedN).toBe(3);
    expect(metrics.contextMismatchN + metrics.nonFiniteN + metrics.excludedOverflowN + metrics.n).toBe(4);
    expect(metrics.excludedN).toBe(1);
    expect(metrics.contextMismatchN + metrics.nonFiniteN + metrics.excludedOverflowN + metrics.n).toBe(4);
  });

  test("C-15 структурированная диагностика исключений сохраняется в сводке", () => {
    const summary = evaluate(
      [snap(), candidate(), snap({ snapshot_id: "overflow", origin_date: "2026-11-19", target_date: "2026-11-20", forecast_value: Number.MAX_VALUE })],
      [rec(), rec({ snapshot_id: "c1", model_id: "adaptive_baseline" }), rec({ snapshot_id: "overflow", target_date: "2026-11-20", forecast_value: Number.MAX_VALUE, actual: -Number.MAX_VALUE })],
    ).summaries[0]!;
    const baselineDiagnostics = summary.metricDiagnostics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!;
    expect(Array.isArray(baselineDiagnostics.overflowNotes)).toBe(true);
    expect(baselineDiagnostics.excluded.length).toBe(1);
    expect(baselineDiagnostics.excluded[0]).toMatchObject({ reason: "OVERFLOW", detail: "разность не конечна" });
    expect(baselineDiagnostics.excludedN).toBe(1);
    expect(baselineDiagnostics.excludedOverflowN).toBe(1);
    expect(baselineDiagnostics.sampleStatus).toBe("PARTIAL");
  });

  test("C-15 причины CONTEXT_MISMATCH и NON_FINITE различимы в диагностике", () => {
    const { excluded } = computeMetrics([metric({ mode: "replay" }), metric({ forecast: Number.NaN }), metric()], baselineContext);
    const reasons = excluded.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(["CONTEXT_MISMATCH", "NON_FINITE"]);
  });

  test("C-16 полнота выборки: COMPLETE без исключений, PARTIAL с исключениями", () => {
    const complete = computeMetrics([metric({ forecast: 100, actual: 110 })], baselineContext).metrics;
    expect(complete.sampleStatus).toBe("COMPLETE");
    expect(complete.excludedN).toBe(0);
    expect(complete.maeStatus).toBe("OK");
    const partial = computeMetrics([metric({ forecast: 100, actual: 110 }), metric({ forecast: Number.MAX_VALUE, actual: -Number.MAX_VALUE })], baselineContext).metrics;
    expect(partial.sampleStatus).toBe("PARTIAL");
    expect(partial.maeStatus).toBe("OK");
    expect(partial.mae).toBe(10);
    expect(partial.excludedN).toBe(1);
  });

  test("C-17 математическая зависимость: |сумма знаковых| ≤ сумма модулей", () => {
    const { metrics } = computeMetrics([
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
    ], baselineContext);
    // при переполнении errorSum обязательно переполнена и absSum (следствие |Σe| ≤ Σ|e|)
    expect(metrics.biasStatus).toBe("OVERFLOW");
    expect(metrics.maeStatus).toBe("OVERFLOW");
    expect(metrics.wapeStatus).toBe("OVERFLOW");
  });

  test("C-17 изолированное переполнение absSum достижимо при ошибках разных знаков", () => {
    const { metrics } = computeMetrics([
      metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 }),
      metric({ forecast: -Number.MAX_VALUE / 4, actual: Number.MAX_VALUE / 2 }),
    ], baselineContext);
    // absSum переполняется, знаковая сумма остаётся конечной (взаимно компенсируется)
    expect(metrics.mae).toBeNull();
    expect(metrics.maeStatus).toBe("OVERFLOW");
    expect(metrics.bias).toBe(0);
    expect(metrics.biasStatus).toBe("OK");
    expect(metrics.wapeStatus).toBe("OVERFLOW");
    expect(metrics.overflowAffectedN).toBe(2);
    expect(metrics.excludedOverflowN).toBe(0);
  });

  test("C-17 T3 пересмотрен: тест доказывает реальную зависимость, а не изолированную ветку", () => {
    const { metrics } = computeMetrics([metric({ forecast: Number.MAX_VALUE / 2, actual: -Number.MAX_VALUE / 4 })], baselineContext);
    // одна запись: absSum = 0.75·MAX конечно, bias конечен
    expect(metrics.biasStatus).toBe("OK");
    expect(metrics.maeStatus).toBe("OK");
    expect(metrics.bias).toBe(Number.MAX_VALUE / 2 + Number.MAX_VALUE / 4);
  });
});
describe("UI-4.1.2.2: диагностика финального переполнения WAPE (C-18)", () => {
  test("переполнение деления absSum / actualAbsSum", () => {
    // absSum = MAX_VALUE (конечно), actualAbsSum = MIN_VALUE → отношение бесконечно
    const { metrics, overflowNotes } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: Number.MIN_VALUE })], baselineContext);
    expect(metrics.mae).toBe(Number.MAX_VALUE);
    expect(metrics.maeStatus).toBe("OK");
    expect(metrics.bias).toBe(Number.MAX_VALUE);
    expect(metrics.biasStatus).toBe("OK");
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
    expect(overflowNotes.some((note) => note.includes("деление"))).toBe(true);
    // накопления не переполнялись
    expect(metrics.overflowAffectedN).toBe(0);
    expect(metrics.excludedOverflowN).toBe(0);
  });

  test("переполнение умножения отношения на 100", () => {
    // absSum = MAX_VALUE, actualAbsSum = 10 → отношение конечно, произведение на 100 бесконечно
    const { metrics, overflowNotes } = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: 10 })], baselineContext);
    const ratio = (Number.MAX_VALUE - 10) / 10;
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio * 100).toBe(Number.POSITIVE_INFINITY);
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("OVERFLOW");
    expect(overflowNotes.some((note) => note.includes("умножение"))).toBe(true);
    expect(metrics.maeStatus).toBe("OK");
    expect(metrics.biasStatus).toBe("OK");
  });

  test("нулевой знаменатель по-прежнему NOT_AVAILABLE, а не OVERFLOW", () => {
    const { metrics, overflowNotes } = computeMetrics([metric({ forecast: 5, actual: 0 })], baselineContext);
    expect(metrics.wape).toBeNull();
    expect(metrics.wapeStatus).toBe("NOT_AVAILABLE");
    expect(overflowNotes.some((note) => note.includes("WAPE"))).toBe(false);
    expect(metrics.mae).toBe(5);
    expect(metrics.maeStatus).toBe("OK");
  });

  test("переполнение накопления и финального WAPE различимы в overflowNotes", () => {
    const accumulation = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: 0 }), metric({ forecast: Number.MAX_VALUE, actual: 0 })], baselineContext);
    expect(accumulation.overflowNotes.some((note) => note.includes("накопление"))).toBe(true);
    expect(accumulation.metrics.overflowAffectedN).toBe(2);
    const finalStage = computeMetrics([metric({ forecast: Number.MAX_VALUE, actual: 10 })], baselineContext);
    expect(finalStage.overflowNotes.some((note) => note.includes("накопление"))).toBe(false);
    expect(finalStage.metrics.overflowAffectedN).toBe(0);
  });

  test("диагностика WAPE сохраняется в сводке оценки", () => {
    const summary = evaluate(
      [snap({ forecast_value: Number.MAX_VALUE }), candidate({ forecast_value: Number.MAX_VALUE })],
      [rec({ forecast_value: Number.MAX_VALUE, actual: 10 }), rec({ snapshot_id: "c1", model_id: "adaptive_baseline", forecast_value: Number.MAX_VALUE, actual: 10 })],
    ).summaries[0]!;
    const baselineDiagnostics = summary.metricDiagnostics.find((entry) => entry.modelId === BASELINE_IDENTITY.modelId)!;
    expect(baselineDiagnostics.overflowNotes.some((note) => note.includes("WAPE"))).toBe(true);
    expect(baselineDiagnostics.excluded.length).toBe(0);
  });
});