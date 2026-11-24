// Stage 3.3.5: метрики, rolling-origin, утечка данных, воспроизводимость, покрытие.
import { describe, expect, test } from "bun:test";

import { computeMetrics, recomputeFromRecords, validateMetricSet } from "../../src/forecasting/analytics/backtesting/metrics";
import { runBacktest, verifyMetricsAgainstRecords } from "../../src/forecasting/analytics/backtesting/rolling-origin";
import { backtestingMarkdown } from "../../src/forecasting/analytics/backtesting/reports";
import { ALL_BASELINES } from "../../src/forecasting/baselines";
import { addDaysIso } from "../../src/forecasting/baselines/types";
import type { HistoryPoint } from "../../src/forecasting/baselines";

const AT = "2026-11-23T23:00:00.000Z";

/** Синтетическая история с недельной структурой и лёгким трендом. */
function syntheticHistory(days: number, start = "2025-01-01"): HistoryPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: addDaysIso(start, index),
    value: 1000 + index * 0.5 + (index % 7 === 5 || index % 7 === 6 ? -150 : 100),
  }));
}

function baseOptions(days = 200) {
  const history = syntheticHistory(days);
  return {
    shopNo: "7745",
    metric: "qty_orders_delivered",
    sliceId: 20624,
    history,
    datasetChecksum: "test-checksum",
    horizons: [1, 3, 7, 14],
    minTrainDays: [28],
    generatedAt: AT,
  };
}

describe("метрики качества", () => {
  test("MAE, RMSE, WAPE и Bias считаются по определениям", () => {
    const metrics = computeMetrics([
      { actual: 100, forecast: 110 },
      { actual: 200, forecast: 190 },
    ]);
    expect(metrics.n).toBe(2);
    expect(metrics.mae).toBeCloseTo(10, 9);
    expect(metrics.rmse).toBeCloseTo(10, 9);
    expect(metrics.wape).toBeCloseTo((20 / 300) * 100, 9);
    expect(metrics.bias).toBeCloseTo(0, 9); // (10 - 10) / 2
    expect(metrics.max_abs_error).toBe(10);
    expect(metrics.median_abs_error).toBe(10);
  });

  test("Bias положителен при систематическом завышении и отрицателен при занижении", () => {
    expect(computeMetrics([{ actual: 100, forecast: 120 }]).bias).toBeCloseTo(20, 9);
    expect(computeMetrics([{ actual: 100, forecast: 80 }]).bias).toBeCloseTo(-20, 9);
  });

  test("WAPE = undefined при нулевой сумме фактических значений (не ноль и не бесконечность)", () => {
    const metrics = computeMetrics([{ actual: 0, forecast: 10 }]);
    expect(metrics.wape).toBeNull();
    expect(metrics.wape_status).toBe("undefined_zero_actuals");
    expect(Number.isFinite(metrics.mae as number)).toBe(true);
  });

  test("пустой набор даёт статус no_data без NaN", () => {
    const metrics = computeMetrics([]);
    expect(metrics.n).toBe(0);
    expect(metrics.wape_status).toBe("no_data");
    expect(validateMetricSet(metrics)).toEqual([]);
  });

  test("нечисловые пары отфильтровываются, метрики остаются конечными", () => {
    const metrics = computeMetrics([
      { actual: Number.NaN, forecast: 10 },
      { actual: 100, forecast: Number.POSITIVE_INFINITY },
      { actual: 100, forecast: 90 },
    ]);
    expect(metrics.n).toBe(1);
    expect(validateMetricSet(metrics)).toEqual([]);
  });

  test("независимый пересчёт из записей совпадает с расчётом по парам", () => {
    const records = [
      { actual: 100, predicted: 110 },
      { actual: 200, predicted: 190 },
      { actual: null, predicted: 300 },
      { actual: 50, predicted: null },
    ];
    const direct = computeMetrics([{ actual: 100, forecast: 110 }, { actual: 200, forecast: 190 }]);
    expect(recomputeFromRecords(records)).toEqual(direct);
  });
});

describe("rolling-origin backtesting", () => {
  test("результат детерминирован и воспроизводим", () => {
    const first = runBacktest(baseOptions());
    const second = runBacktest(baseOptions());
    expect(second.reproducibility.checksum).toBe(first.reproducibility.checksum);
    expect(second.records.length).toBe(first.records.length);
  });

  test("утечка данных отсутствует: история модели не выходит за origin, цель позже origin", () => {
    const result = runBacktest(baseOptions());
    expect(result.leakage.passed).toBe(true);
    expect(result.leakage.violations).toEqual([]);
    for (const record of result.records) {
      expect(record.lastHistoryDate <= record.originDate).toBe(true);
      expect(record.targetDate > record.originDate).toBe(true);
    }
  });

  test("метрики в таблице совпадают с независимым пересчётом из сохранённых прогнозов", () => {
    const result = runBacktest(baseOptions());
    const verification = verifyMetricsAgainstRecords(result);
    expect(verification.ok).toBe(true);
    expect(verification.mismatches).toEqual([]);
  });

  test("все три модели и все горизонты присутствуют в таблице", () => {
    const result = runBacktest(baseOptions());
    for (const horizon of [1, 3, 7, 14]) {
      const rows = result.metrics.filter((row) => row.horizonDays === horizon);
      expect(new Set(rows.map((row) => row.model))).toEqual(new Set(ALL_BASELINES.map((model) => model.name)));
    }
  });

  test("горизонт h включает все шаги 1…h, поэтому наблюдений больше", () => {
    const result = runBacktest(baseOptions());
    const h1 = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 1)!;
    const h7 = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 7)!;
    const h14 = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14)!;
    expect(h7.evaluated).toBe(h1.evaluated * 7);
    expect(h14.evaluated).toBe(h1.evaluated * 14);
  });

  test("weekly seasonal naive ограничивает сопоставимость на горизонте 14", () => {
    const result = runBacktest(baseOptions());
    const weekly = result.metrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14)!;
    const naive = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14)!;
    expect(weekly.evaluated).toBeLessThan(naive.evaluated);
    expect(weekly.forecastUnavailable).toBeGreaterThan(0);

    // на общей выборке все модели оцениваются на одинаковом числе дат
    const commonWeekly = result.commonMetrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14)!;
    const commonNaive = result.commonMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14)!;
    expect(commonWeekly.evaluated).toBe(commonNaive.evaluated);
  });

  test("покрытие фиксирует пропущенные прогнозы и не подменяет их нулями", () => {
    const result = runBacktest(baseOptions());
    const coverage = result.coverage[0]!;
    expect(coverage.originsTotal).toBeGreaterThan(0);
    expect(coverage.forecastsExpected).toBeGreaterThan(coverage.forecastsGenerated); // weekly даёт недоступные прогнозы
    expect(coverage.forecastsMissing).toBe(coverage.forecastsExpected - coverage.forecastsGenerated);
    expect(coverage.actualsMissing).toBe(0); // горизонт всегда помещается в историю
  });

  test("без достаточной истории backtesting не даёт оценок", () => {
    const result = runBacktest({ ...baseOptions(20), minTrainDays: [28] });
    expect(result.records).toEqual([]);
    expect(result.coverage[0]!.originsTotal).toBe(0);
  });

  test("разные min_train дают разные наборы origin и не смешиваются", () => {
    const result = runBacktest({ ...baseOptions(), minTrainDays: [28, 21] });
    const for28 = result.records.filter((record) => record.minTrainDays === 28);
    const for21 = result.records.filter((record) => record.minTrainDays === 21);
    expect(for21.length).toBeGreaterThan(for28.length);
    expect(result.coverage.map((coverage) => coverage.minTrainDays)).toEqual([28, 21]);
  });

  test("step-exact: горизонт оценивается ровно по шагу h, а не по шагам 1…h", () => {
    const result = runBacktest(baseOptions());
    const naive7 = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 7 && row.minTrainDays === 28)!;
    const naive14 = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    expect(naive7.evaluationMode).toBe("step-exact");
    expect(naive14.evaluationMode).toBe("step-exact");
    // на каждом шаге ровно один прогноз на origin → число оценок совпадает для h=7 и h=14
    expect(naive7.evaluated).toBe(naive14.evaluated);
    // cumulative-оценка на h=14 включает в 14 раз больше наблюдений
    const cumulative14 = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    expect(cumulative14.evaluated).toBe(naive14.evaluated * 14);
  });

  test("weekly_seasonal_naive помечена NOT_AVAILABLE на горизонте 14", () => {
    const result = runBacktest(baseOptions());
    const unavailable = result.notAvailable.filter((entry) => entry.horizonDays === 14 && entry.minTrainDays === 28);
    expect(unavailable.map((entry) => entry.model)).toEqual(["weekly_seasonal_naive"]);
    expect(unavailable[0]!.reason).toContain("ещё не известно");

    // в общей выборке шага 14 остаются только модели с прогнозом
    const commonModels = result.commonStepMetrics.filter((row) => row.horizonDays === 14 && row.minTrainDays === 28).map((row) => row.model);
    expect(commonModels).toEqual(["naive_yesterday", "rolling_7_day_mean"]);
    expect(result.commonStepMetrics.some((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14)).toBe(false);
  });

  test("истинный 14-дневный результат отличается от оценки первых семи шагов", () => {
    const result = runBacktest(baseOptions());
    const step14 = result.commonStepMetrics.find((row) => row.model === "rolling_7_day_mean" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    const cumulative14 = result.commonMetrics.find((row) => row.model === "rolling_7_day_mean" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    // cumulative для h=14 включает шаги 1…7 и потому совпадает по числу наблюдений с общим набором h=7
    const common7 = result.commonMetrics.find((row) => row.model === "rolling_7_day_mean" && row.horizonDays === 7 && row.minTrainDays === 28)!;
    expect(cumulative14.evaluated).toBe(common7.evaluated);
    // step-exact оценка использует только шаг 14
    expect(step14.evaluated).toBeLessThan(cumulative14.evaluated);
    expect(step14.evaluationMode).toBe("step-exact");
  });

  test("отчёт явно разделяет основной режим и sensitivity", () => {
    const result = runBacktest({ ...baseOptions(), minTrainDays: [28, 21] });
    const markdown = backtestingMarkdown(result, result.reproducibility.checksum);
    expect(markdown).toContain("Основной результат — `min_train_days = 28`");
    expect(markdown).toContain("Sensitivity analysis (`min_train = 21`)");
    // в выводах используются значения только основного режима
    const conclusionsBlock = markdown.slice(markdown.indexOf("## Выводы по моделям"));
    expect(conclusionsBlock).toContain("min_train_days = 28");
    // в выводах фигурирует MAE лучшей модели основного режима на шаге 7 (в формате отчёта)
    const best7 = result.commonStepMetrics
      .filter((row) => row.horizonDays === 7 && row.minTrainDays === 28 && row.mae !== null)
      .sort((a, b) => (a.mae as number) - (b.mae as number))[0]!;
    expect(conclusionsBlock).toContain(best7.mae!.toFixed(4));
  });

  test("step-exact метрики пересчитываются из сохранённых прогнозов независимо", () => {
    const result = runBacktest(baseOptions());
    for (const row of result.stepMetrics) {
      if (row.mae === null) continue;
      const relevant = result.records.filter(
        (record) =>
          record.model === row.model &&
          record.minTrainDays === row.minTrainDays &&
          record.horizonDays === row.horizonDays &&
          record.step === row.horizonDays &&
          record.predicted !== null &&
          record.actual !== null,
      );
      const recalculated = recomputeFromRecords(relevant);
      expect(recalculated.mae, `${row.model}/step${row.horizonDays}`).toBeCloseTo(row.mae as number, 9);
      expect(recalculated.n).toBe(row.evaluated);
    }
  });
});
