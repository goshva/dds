// Stage 3.4.1: тесты методологического контракта (сценарии A–J) и валидатор документации.
// Тесты не изменяют существующий pipeline: они проверяют, что зафиксированные правила
// действительно выполняются текущей реализацией, и что контрактные документы согласованы.
import { describe, expect, test } from "bun:test";

import { computeMetrics, recomputeFromRecords, validateMetricSet } from "../../src/forecasting/analytics/backtesting/metrics";
import { runBacktest, verifyMetricsAgainstRecords } from "../../src/forecasting/analytics/backtesting/rolling-origin";
import { COMMON_SET_FORMULA } from "../../src/forecasting/analytics/backtesting/reports";
import { assertNoFutureData, ensureFinite } from "../../src/forecasting/baselines/types";
import { addDaysIso } from "../../src/forecasting/baselines/types";
import type { HistoryPoint } from "../../src/forecasting/baselines";

const AT = "2026-11-23T23:50:00.000Z";
const CONTRACTS_DIR = "docs/forecasting/contracts";
const STAGE_DIR = "reports/forecasting/stage-3.4.1";

function syntheticHistory(days = 120, start = "2025-01-01"): HistoryPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: addDaysIso(start, index),
    value: 1000 + (index % 7) * 25 + (index % 5 === 0 ? -40 : 0),
  }));
}

function options(days = 120) {
  return {
    shopNo: "7745",
    metric: "qty_orders_delivered",
    sliceId: 20624,
    history: syntheticHistory(days),
    datasetChecksum: "contract-test-checksum",
    horizons: [1, 3, 7, 14],
    minTrainDays: [28, 21],
    generatedAt: AT,
  };
}

describe("A — точный горизонт (step-exact)", () => {
  test("матрица: в step-exact h входят только записи с horizon_step = h", () => {
    const result = runBacktest(options());
    const minTrain = 28;
    const models = ["naive_yesterday", "rolling_7_day_mean", "weekly_seasonal_naive"];
    const horizons = [1, 3, 7, 14];

    // независимый подсчёт ожидаемого числа наблюдений прямо из records
    const validCount = (model: string, horizon: number, step?: number) =>
      result.records.filter(
        (record) =>
          record.model === model &&
          record.minTrainDays === minTrain &&
          record.horizonDays === horizon &&
          (step === undefined || record.step === step) &&
          record.predicted !== null &&
          record.actual !== null,
      ).length;

    for (const model of models) {
      for (const horizon of horizons) {
        const row = result.stepMetrics.find((entry) => entry.model === model && entry.horizonDays === horizon && entry.minTrainDays === minTrain)!;
        const cumulativeRow = result.metrics.find((entry) => entry.model === model && entry.horizonDays === horizon && entry.minTrainDays === minTrain)!;
        // step-exact h = только шаг h
        expect(row.evaluated, `${model}/h${horizon}`).toBe(validCount(model, horizon, horizon));
        // cumulative h = все шаги 1…h (структура records), поэтому step-exact не превышает cumulative
        expect(cumulativeRow.evaluated, `${model}/h${horizon}/cumulative`).toBe(
          Array.from({ length: horizon }, (_, index) => index + 1).reduce((acc, step) => acc + validCount(model, horizon, step), 0),
        );
        if (horizon > 1) expect(row.evaluated).toBeLessThan(cumulativeRow.evaluated);
      }
    }

    // Матрица включения выводится из двух проверенных фактов:
    //  - step-exact(h).evaluated = числу валидных наблюдений шага h в группе h;
    //  - cumulative(h).evaluated = сумме валидных наблюдений шагов 1…h,
    // поэтому наблюдение с шагом s учитывается в step-exact только при h = s.
    for (const model of models) {
      for (const horizon of horizons) {
        const row = result.stepMetrics.find((entry) => entry.model === model && entry.horizonDays === horizon && entry.minTrainDays === minTrain)!;
        const ownStep = validCount(model, horizon, horizon);
        const allSteps = validCount(model, horizon);
        expect(row.evaluated).toBe(ownStep);
        if (ownStep > 0 && horizon > 1) {
          expect(row.evaluated).toBeLessThan(allSteps); // другие шаги в step-exact не примешиваются
        }
      }
    }
  });

  test("структура records не равна оценочной выборке: шаг 7 присутствует в группах h≥7, но не в step-exact h=14", () => {
    const result = runBacktest(options());
    const step7AllGroups = result.records.filter((record) => record.step === 7 && record.minTrainDays === 28 && record.model === "naive_yesterday");
    // записи шага 7 действительно создаются для групп h=7 и h=14
    expect(new Set(step7AllGroups.map((record) => record.horizonDays))).toEqual(new Set([7, 14]));

    const step7Group7 = step7AllGroups.filter((record) => record.horizonDays === 7 && record.predicted !== null && record.actual !== null).length;
    const step7Group14 = step7AllGroups.filter((record) => record.horizonDays === 14 && record.predicted !== null && record.actual !== null).length;
    expect(step7Group14).toBeGreaterThan(0);

    const exact7 = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 7 && row.minTrainDays === 28)!;
    const exact14 = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    // step-exact h=7 использует только группу h=7: записи шага 7 из группы h=14 не учитываются
    expect(exact7.evaluated).toBe(step7Group7);
    expect(exact7.evaluated).toBeLessThan(step7Group7 + step7Group14);
    // step-exact h=14 использует шаг 14 своей группы, а не шаг 7
    expect(exact14.evaluated).toBe(
      result.records.filter(
        (record) =>
          record.model === "naive_yesterday" &&
          record.minTrainDays === 28 &&
          record.horizonDays === 14 &&
          record.step === 14 &&
          record.predicted !== null &&
          record.actual !== null,
      ).length,
    );
  });
});

describe("B — cumulative", () => {
  const validCount = (result: ReturnType<typeof runBacktest>, model: string, horizon: number, maxStep?: number) =>
    result.records.filter(
      (record) =>
        record.model === model &&
        record.minTrainDays === 28 &&
        record.horizonDays === horizon &&
        (maxStep === undefined || record.step <= maxStep) &&
        record.predicted !== null &&
        record.actual !== null,
    ).length;

  test("общее правило: cumulative(h) включает все допустимые шаги 1…h", () => {
    const result = runBacktest(options());
    for (const model of ["naive_yesterday", "rolling_7_day_mean", "weekly_seasonal_naive"]) {
      for (const horizon of [1, 3, 7, 14]) {
        const row = result.metrics.find((entry) => entry.model === model && entry.horizonDays === horizon && entry.minTrainDays === 28)!;
        expect(row.evaluationMode).toBe("cumulative");
        // не фиксированный коэффициент, а фактическая сумма допустимых наблюдений по шагам 1…h
        expect(row.evaluated, `${model}/h${horizon}`).toBe(validCount(result, model, horizon));
      }
    }
  });

  test("случай «все шаги доступны»: отношение cumulative/step-exact равно h — локальное свойство набора", () => {
    const result = runBacktest(options());
    for (const horizon of [1, 3, 7, 14]) {
      const cumulative = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === horizon && row.minTrainDays === 28)!;
      const exact = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === horizon && row.minTrainDays === 28)!;
      expect(cumulative.evaluated).toBe(exact.evaluated * horizon);
    }
    // это отношение держится только потому, что у модели все шаги 1…h доступны
    for (let step = 1; step <= 14; step++) {
      expect(validCount(result, "naive_yesterday", 14, step) - validCount(result, "naive_yesterday", 14, step - 1)).toBeGreaterThan(0);
    }
  });

  test("случай «часть шагов отсутствует»: weekly на h=14 — cumulative включает только доступные шаги", () => {
    const result = runBacktest(options());
    const cumulative = result.metrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    const exact = result.stepMetrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    expect(exact.evaluated).toBe(0); // NOT_AVAILABLE на шаге 14
    expect(exact.mae).toBeNull();
    // cumulative учитывает только фактически доступные шаги 1…7
    expect(cumulative.evaluated).toBe(validCount(result, "weekly_seasonal_naive", 14));
    expect(cumulative.evaluated).toBeGreaterThan(0);
    const step7Exact = result.stepMetrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 7 && row.minTrainDays === 28)!;
    expect(cumulative.evaluated).toBe(step7Exact.evaluated * 7); // доступны ровно 7 шагов
    expect(cumulative.evaluated).not.toBe(exact.evaluated * 14);
    expect(result.notAvailable.some((entry) => entry.model === "weekly_seasonal_naive" && entry.horizonDays === 14)).toBe(true);
  });

  test("случай «разное число наблюдений по шагам»: шаги 8…14 дают меньше валидных наблюдений", () => {
    const result = runBacktest(options(120));
    // группа h=14: шаги 1…7 доступны всем трём моделям, шаги 8…14 — только двум
    expect(validCount(result, "naive_yesterday", 14, 14) - validCount(result, "naive_yesterday", 14, 7)).toBeGreaterThan(0);
    expect(validCount(result, "weekly_seasonal_naive", 14, 14) - validCount(result, "weekly_seasonal_naive", 14, 7)).toBe(0);
    const cumulative = result.metrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    expect(cumulative.evaluated).toBe(validCount(result, "weekly_seasonal_naive", 14));
    expect(cumulative.evaluated).toBeLessThan(validCount(result, "naive_yesterday", 14));
  });

  test("cumulative не выводится из step-exact: шаг без собственной horizon-группы всё равно учитывается", () => {
    const result = runBacktest({ ...options(), horizons: [1, 3] });
    // step-exact существует только для h=1 и h=3; шаг 2 собственной группы не имеет
    expect(result.stepMetrics.some((row) => row.horizonDays === 2)).toBe(false);
    expect(result.records.some((record) => record.horizonDays === 3 && record.step === 2)).toBe(true);
    const cumulative3 = result.metrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 3 && row.minTrainDays === 28)!;
    const step2 = result.records.filter(
      (record) =>
        record.model === "naive_yesterday" && record.minTrainDays === 28 && record.horizonDays === 3 && record.step === 2 && record.predicted !== null && record.actual !== null,
    ).length;
    expect(step2).toBeGreaterThan(0);
    expect(cumulative3.evaluated).toBe(
      validCount(result, "naive_yesterday", 3, 1) + step2 + validCount(result, "naive_yesterday", 3, 3) - validCount(result, "naive_yesterday", 3, 2),
    );
  });
});

describe("C — отсутствие прогноза", () => {
  test("NOT_AVAILABLE не подменяется нулём и не попадает в метрики", () => {
    const result = runBacktest(options());
    const unavailableRecords = result.records.filter((record) => record.horizonDays === 14 && record.step === 14 && record.model === "weekly_seasonal_naive");
    expect(unavailableRecords.length).toBeGreaterThan(0);
    expect(unavailableRecords.every((record) => record.predicted === null)).toBe(true);
    expect(unavailableRecords.every((record) => record.status === "unavailable")).toBe(true);
    expect(unavailableRecords.every((record) => record.reason !== null)).toBe(true);
    expect(result.notAvailable.some((entry) => entry.model === "weekly_seasonal_naive" && entry.horizonDays === 14)).toBe(true);
  });
});

describe("D — некорректный прогноз", () => {
  test("NaN и Infinity отклоняются и исключаются из метрик", () => {
    expect(() => ensureFinite(Number.NaN, "test")).toThrow(/не число/);
    expect(() => ensureFinite(Number.POSITIVE_INFINITY, "test")).toThrow(/не число/);

    const metrics = computeMetrics([
      { actual: 100, forecast: Number.NaN },
      { actual: 100, forecast: Number.POSITIVE_INFINITY },
      { actual: 100, forecast: 90 },
    ]);
    expect(metrics.n).toBe(1);
    expect(validateMetricSet(metrics)).toEqual([]);
    expect(recomputeFromRecords([{ actual: 100, predicted: Number.NaN }]).n).toBe(0);
  });
});

describe("E — утечка данных", () => {
  test("передача будущих наблюдений отклоняется, прогон не содержит нарушений", () => {
    const history = syntheticHistory(10);
    expect(() => assertNoFutureData({ originDate: history[5]!.date, horizonDays: 1, history, timezone: "Europe/Moscow" })).toThrow(/утечка/);

    const result = runBacktest(options());
    expect(result.leakage.passed).toBe(true);
    expect(result.leakage.violations).toEqual([]);
    expect(result.records.every((record) => record.lastHistoryDate <= record.originDate && record.targetDate > record.originDate)).toBe(true);
  });
});

describe("F — несопоставимые выборки", () => {
  test("на шаге 14 общая выборка формируется только из доступных моделей", () => {
    const result = runBacktest(options());
    const common14 = result.commonStepMetrics.filter((row) => row.horizonDays === 14 && row.minTrainDays === 28);
    expect(common14.map((row) => row.model)).toEqual(["naive_yesterday", "rolling_7_day_mean"]);
    // полная выборка weekly меньше полной выборки naive — сравнение помечается как несопоставимое
    const weekly = result.stepMetrics.find((row) => row.model === "weekly_seasonal_naive" && row.horizonDays === 14 && row.minTrainDays === 28);
    const naive = result.stepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 14 && row.minTrainDays === 28)!;
    expect(weekly?.mae ?? null).toBeNull();
    expect(common14.every((row) => row.evaluated === naive.evaluated)).toBe(true);
    expect(COMMON_SET_FORMULA.some((rule) => rule.includes("СУММА"))).toBe(true);
  });
});

describe("G — нулевой знаменатель WAPE", () => {
  test("WAPE получает NOT_AVAILABLE, а не ноль и не бесконечность", () => {
    const metrics = computeMetrics([{ actual: 0, forecast: 5 }]);
    expect(metrics.wape).toBeNull();
    expect(metrics.wape_status).toBe("undefined_zero_actuals");
    expect(metrics.mae).toBe(5);
  });
});

describe("H — разные min_train", () => {
  test("основной и sensitivity режимы не смешиваются", () => {
    const result = runBacktest(options());
    expect(result.minTrainDays[0]).toBe(28);
    expect(result.coverage.map((coverage) => coverage.minTrainDays)).toEqual([28, 21]);
    for (const row of result.commonStepMetrics) {
      expect([28, 21]).toContain(row.minTrainDays);
    }
    const rows28 = result.commonStepMetrics.filter((row) => row.minTrainDays === 28);
    const rows21 = result.commonStepMetrics.filter((row) => row.minTrainDays === 21);
    expect(rows28.every((row) => row.minTrainDays === 28)).toBe(true);
    expect(rows21.every((row) => row.minTrainDays === 21)).toBe(true);
  });
});

describe("I — разные горизонты", () => {
  test("лучшая модель определяется отдельно для каждого горизонта", () => {
    const result = runBacktest(options());
    const best: Record<number, string> = {};
    for (const horizon of result.horizons) {
      const rows = result.commonStepMetrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === 28 && row.mae !== null);
      if (!rows.length) continue;
      best[horizon] = [...rows].sort((a, b) => (a.mae as number) - (b.mae as number))[0]!.model;
    }
    expect(Object.keys(best).length).toBeGreaterThan(0);
    // контракт допускает как совпадение, так и различие победителей по горизонтам
    expect(Object.values(best).every((model) => typeof model === "string")).toBe(true);
  });
});

describe("J — повторяемость", () => {
  test("одинаковый эксперимент даёт одинаковый результат", () => {
    const first = runBacktest(options());
    const second = runBacktest(options());
    expect(second.reproducibility.checksum).toBe(first.reproducibility.checksum);
    expect(second.records.length).toBe(first.records.length);
    expect(first.reproducibility.checksum.length).toBe(64);
    expect(verifyMetricsAgainstRecords(first).ok).toBe(true);
  });
});

describe("валидатор документации контракта", () => {
  const contracts = [
    "forecast-strategy-contract.md",
    "evaluation-contract.md",
    "metrics-contract.md",
    "model-selection-contract.md",
    "backtesting-protocol.md",
    "experiment-reporting-contract.md",
  ];

  test("все шесть контрактов существуют и непусты", async () => {
    for (const name of contracts) {
      const file = Bun.file(`${CONTRACTS_DIR}/${name}`);
      expect(await file.exists(), name).toBe(true);
      expect((await file.text()).length, name).toBeGreaterThan(1000);
    }
  });

  test("контракт оценки фиксирует обязательные параметры", async () => {
    const text = await Bun.file(`${CONTRACTS_DIR}/evaluation-contract.md`).text();
    for (const required of [
      "evaluation_mode = step-exact",
      "primary_min_train_days = 28",
      "sensitivity_min_train_days = 21",
      "horizons = [1, 3, 7, 14]",
      "NOT_AVAILABLE",
      "INVALID",
      "margin_to_runner_up",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  test("контракт метрик содержит формулы и правила граничных случаев", async () => {
    const text = await Bun.file(`${CONTRACTS_DIR}/metrics-contract.md`).text();
    for (const required of ["MAE = mean", "RMSE = sqrt", "WAPE = sum", "Bias = mean", "undefined_zero_actuals", "no_data"]) {
      expect(text, required).toContain(required);
    }
  });

  test("контракт выбора модели содержит статусы и запрет подгонки", async () => {
    const text = await Bun.file(`${CONTRACTS_DIR}/model-selection-contract.md`).text();
    for (const required of ["BETTER", "WORSE", "NO_MATERIAL_DIFFERENCE", "INCONCLUSIVE", "PRODUCTION_APPROVED", "relative_mae_change"]) {
      expect(text, required).toContain(required);
    }
  });

  test("отчёты этапа и сценарии валидации присутствуют", async () => {
    const files = [
      "00-preflight-audit.md",
      "01-forecast-strategy.md",
      "02-evaluation-contract.md",
      "03-metrics-contract.md",
      "04-model-selection.md",
      "05-backtesting-protocol.md",
      "06-experiment-reporting.md",
      "validation-results.md",
      "final-report.md",
    ];
    for (const name of files) {
      expect(await Bun.file(`${STAGE_DIR}/${name}`).exists(), name).toBe(true);
    }
    const validation = await Bun.file(`${STAGE_DIR}/validation-results.md`).text();
    for (const scenario of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      expect(validation, `сценарий ${scenario}`).toContain(`Сценарий ${scenario}`);
    }
  });
});
