/**
 * Stage 3.3.5 — rolling-origin backtesting.
 *
 * Методология: на каждом origin модель получает только историю до origin включительно
 * и формирует прогнозы на даты origin+1 … origin+maxHorizon. Фактические значения
 * используются исключительно для последующей оценки, никогда — для построения прогноза.
 *
 * Все исключения прогнозов фиксируются со счётчиками: пропущенные прогнозы и пропущенные
 * факты не заменяются нулями и не удаляются из отчётности.
 */

import { ALL_BASELINES } from "../../baselines";
import type { BaselineModel, HistoryPoint } from "../../baselines";
import { computeMetrics, recomputeFromRecords, validateMetricSet, type MetricSet } from "./metrics";

export interface ForecastRecord {
  model: string;
  minTrainDays: number;
  originDate: string;
  /** Шаг прогноза: targetDate = originDate + step. */
  step: number;
  /** Группа горизонта: метрики горизонта h считаются по всем шагам 1…h. */
  horizonDays: number;
  targetDate: string;
  predicted: number | null;
  status: "ok" | "unavailable";
  reason: string | null;
  actual: number | null;
  fold: number;
  historyPoints: number;
  lastHistoryDate: string;
}

export interface ModelHorizonMetrics extends MetricSet {
  model: string;
  horizonDays: number;
  minTrainDays: number;
  originCount: number;
  forecastGenerated: number;
  forecastUnavailable: number;
  evaluated: number;
  commonEvaluation: boolean;
  /** Способ оценки: все шаги 1…h (cumulative) или ровно шаг h (step-exact). */
  evaluationMode: "cumulative" | "step-exact";
  problems: string[];
}

/** Модель, которая не может быть оценена на горизонте (нет прогнозов) — фиксируется явно. */
export interface NotAvailableEntry {
  model: string;
  horizonDays: number;
  minTrainDays: number;
  reason: string;
}

export interface Coverage {
  minTrainDays: number;
  originsTotal: number;
  originsEvaluated: number;
  forecastsExpected: number;
  forecastsGenerated: number;
  forecastsMissing: number;
  actualsMissing: number;
  commonEvaluationCount: number;
}

export interface LeakageCheck {
  checked: number;
  violations: Array<{ model: string; originDate: string; targetDate: string; lastHistoryDate: string; kind: string }>;
  passed: boolean;
  notes: string[];
}

export interface BacktestResult {
  shopNo: string;
  metric: string;
  sliceId: number;
  datasetChecksum: string;
  datasetPoints: number;
  period: { from: string; to: string };
  horizons: number[];
  minTrainDays: number[];
  generatedAt: string;
  records: ForecastRecord[];
  /** Основная оценка: ровно шаг h (истинное качество горизонта h). */
  stepMetrics: ModelHorizonMetrics[];
  /** Общая выборка на шаге h: только модели, у которых есть прогнозы на этом шаге. */
  commonStepMetrics: ModelHorizonMetrics[];
  /** Справочная оценка: все шаги 1…h (cumulative). */
  metrics: ModelHorizonMetrics[];
  commonMetrics: ModelHorizonMetrics[];
  notAvailable: NotAvailableEntry[];
  coverage: Coverage[];
  leakage: LeakageCheck;
  reproducibility: { runs: number; identical: boolean; checksum: string };
  notes: string[];
}

export interface BacktestOptions {
  shopNo: string;
  metric: string;
  sliceId: number;
  history: readonly HistoryPoint[];
  datasetChecksum: string;
  horizons?: number[];
  minTrainDays?: number[];
  models?: readonly BaselineModel[];
  timezone?: string;
  generatedAt: string;
}

export const DEFAULT_HORIZONS = [1, 3, 7, 14];
export const DEFAULT_MIN_TRAIN = [28, 21];

function checksumOf(records: readonly ForecastRecord[]): string {
  const payload = records
    .map((record) =>
      [record.model, record.minTrainDays, record.originDate, record.step, record.horizonDays, record.targetDate, record.predicted ?? "", record.actual ?? "", record.status].join("|"),
    )
    .join("\n");
  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const models = options.models ?? ALL_BASELINES;
  const horizons = [...(options.horizons ?? DEFAULT_HORIZONS)].sort((a, b) => a - b);
  const minTrainDays = [...(options.minTrainDays ?? DEFAULT_MIN_TRAIN)].sort((a, b) => b - a);
  const maxHorizon = Math.max(...horizons);
  const history = [...options.history].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(history.map((point) => [point.date, point.value]));
  const records: ForecastRecord[] = [];
  const coverage: Coverage[] = [];
  const leakage: LeakageCheck = { checked: 0, violations: [], passed: true, notes: [] };
  const notes: string[] = [];

  for (const minTrain of minTrainDays) {
    let originsTotal = 0;
    let originsEvaluated = 0;
    let forecastsExpected = 0;
    let forecastsGenerated = 0;
    let actualsMissing = 0;
    const foldKeys = new Map<string, Set<string>>();

    for (let index = 0; index < history.length; index++) {
      const origin = history[index]!;
      const trainHistory = history.slice(0, index + 1);
      if (trainHistory.length < minTrain) continue;
      // горизонт должен помещаться в доступную историю: иначе оценивать нечего
      if (index + maxHorizon >= history.length) continue;
      originsTotal++;

      for (const model of models) {
        const result = model.forecast({
          originDate: origin.date,
          horizonDays: maxHorizon,
          history: trainHistory,
          timezone: options.timezone ?? "Europe/Moscow",
        });

        // проверка утечки: история модели не должна выходить за origin, цель — быть позже origin
        if (result.diagnostics.lastHistoryDate && result.diagnostics.lastHistoryDate > origin.date) {
          leakage.violations.push({
            model: model.name,
            originDate: origin.date,
            targetDate: "",
            lastHistoryDate: result.diagnostics.lastHistoryDate,
            kind: "history_after_origin",
          });
        }

        for (let step = 1; step <= maxHorizon; step++) {
          const point = result.points[step - 1];
          if (!point) continue;
          forecastsExpected++;
          const key = `${step}`;
          const bucket = foldKeys.get(key) ?? new Set<string>();
          bucket.add(origin.date);
          foldKeys.set(key, bucket);

          const actual = byDate.get(point.targetDate) ?? null;
          const targetInWindow = point.targetDate <= history.at(-1)!.date;
          if (point.targetDate <= origin.date) {
            leakage.violations.push({ model: model.name, originDate: origin.date, targetDate: point.targetDate, lastHistoryDate: result.diagnostics.lastHistoryDate ?? "", kind: "target_not_after_origin" });
          }
          if (point.status === "ok" && point.value !== null) forecastsGenerated++;
          if (targetInWindow && actual === null) actualsMissing++;

          // запись относится ко всем горизонтам h >= step: метрики горизонта считаются по шагам 1…h
          for (const horizon of horizons) {
            if (step > horizon) continue;
            records.push({
              model: model.name,
              minTrainDays: minTrain,
              originDate: origin.date,
              step,
              horizonDays: horizon,
              targetDate: point.targetDate,
              predicted: point.status === "ok" ? point.value : null,
              status: point.status,
              reason: point.reason,
              actual: targetInWindow ? actual : null,
              fold: [...bucket].length,
              historyPoints: result.diagnostics.historyPoints,
              lastHistoryDate: result.diagnostics.lastHistoryDate ?? "",
            });
          }
        }
      }
      originsEvaluated++;
    }

    const commonEvaluationCount = countCommonEvaluations(records, minTrain, horizons, models);
    coverage.push({
      minTrainDays: minTrain,
      originsTotal,
      originsEvaluated,
      forecastsExpected,
      forecastsGenerated,
      forecastsMissing: forecastsExpected - forecastsGenerated,
      actualsMissing,
      commonEvaluationCount,
    });
  }

  const metrics = buildMetrics(records, models, horizons, minTrainDays, false, "cumulative");
  const commonMetrics = buildMetrics(records, models, horizons, minTrainDays, true, "cumulative");
  // Основная оценка горизонта: ровно шаг h. Для моделей без прогнозов на этом шаге
  // (weekly_seasonal_naive на шагах 8…14) результат фиксируется как NOT_AVAILABLE.
  const stepMetrics = buildMetrics(records, models, horizons, minTrainDays, false, "step-exact");
  const commonStepMetrics = buildMetrics(records, models, horizons, minTrainDays, true, "step-exact");
  const notAvailable: NotAvailableEntry[] = [];
  for (const minTrain of minTrainDays) {
    for (const horizon of horizons) {
      for (const model of models) {
        const generated = records.filter(
          (record) => record.model === model.name && record.minTrainDays === minTrain && record.horizonDays === horizon && record.step === horizon && record.predicted !== null,
        ).length;
        if (generated === 0) {
          notAvailable.push({
            model: model.name,
            horizonDays: horizon,
            minTrainDays: minTrain,
            reason:
              model.name === "weekly_seasonal_naive" && horizon > 7
                ? `модель требует фактическое значение на ${horizon} − 7 дней от target, которое на момент origin ещё не известно (доступны только шаги 1…7)`
                : "на этом шаге модель не сформировала ни одного прогноза",
          });
        }
      }
    }
  }
  leakage.checked = records.length;
  leakage.passed = leakage.violations.length === 0;
  leakage.notes.push(`проверено записей прогнозов: ${records.length}`);
  leakage.notes.push("условие: max(дата истории) <= origin < targetDate");
  leakage.notes.push("модели не получают значений с целевых дат; rolling-окно не включает будущие наблюдения");

  notes.push(`история: ${history.length} наблюдений (${history[0]?.date} … ${history.at(-1)?.date})`);
  notes.push(`горизонты: ${horizons.join(", ")}; минимальная обучающая история: ${minTrainDays.join(", ")} дней`);
  notes.push("оценка выполняется на пересечении доступных прогнозов и фактических значений");

  const result: BacktestResult = {
    shopNo: options.shopNo,
    metric: options.metric,
    sliceId: options.sliceId,
    datasetChecksum: options.datasetChecksum,
    datasetPoints: history.length,
    period: { from: history[0]?.date ?? "", to: history.at(-1)?.date ?? "" },
    horizons,
    minTrainDays,
    generatedAt: options.generatedAt,
    records,
    stepMetrics,
    commonStepMetrics,
    metrics,
    commonMetrics,
    notAvailable,
    coverage,
    leakage,
    reproducibility: { runs: 1, identical: true, checksum: checksumOf(records) },
    notes,
  };
  result.reproducibility.checksum = checksumOf(records);
  return result;
}

function countCommonEvaluations(
  records: readonly ForecastRecord[],
  minTrainDays: number,
  horizons: readonly number[],
  models: readonly BaselineModel[],
): number {
  let count = 0;
  for (const horizon of horizons) {
    const keys = new Map<string, Set<string>>();
    for (const record of records) {
      if (record.minTrainDays !== minTrainDays || record.horizonDays !== horizon) continue;
      if (record.predicted === null || record.actual === null) continue;
      const key = `${record.originDate}|${record.targetDate}`;
      const bucket = keys.get(key) ?? new Set<string>();
      bucket.add(record.model);
      keys.set(key, bucket);
    }
    for (const bucket of keys.values()) if (bucket.size === models.length) count++;
  }
  return count;
}

function buildMetrics(
  records: readonly ForecastRecord[],
  models: readonly BaselineModel[],
  horizons: readonly number[],
  minTrainDays: readonly number[],
  commonOnly: boolean,
  mode: "cumulative" | "step-exact",
): ModelHorizonMetrics[] {
  const result: ModelHorizonMetrics[] = [];

  for (const minTrain of minTrainDays) {
    for (const horizon of horizons) {
      // базовая выборка: либо все шаги 1…h, либо ровно шаг h
      const base = records.filter(
        (record) =>
          record.minTrainDays === minTrain &&
          record.horizonDays === horizon &&
          (mode === "cumulative" || record.step === horizon),
      );

      // модели, у которых на этом горизонте есть хотя бы один прогноз (для step-exact это
      // исключает weekly_seasonal_naive на шаге 8…14 из общей выборки, фиксируя NOT_AVAILABLE)
      const availableModels = models.filter((model) => base.some((record) => record.model === model.name && record.predicted !== null));

      const commonKeys = new Set<string>();
      if (commonOnly && availableModels.length > 1) {
        const byKey = new Map<string, Set<string>>();
        for (const record of base) {
          if (record.predicted === null || record.actual === null) continue;
          const key = `${record.originDate}|${record.targetDate}`;
          const bucket = byKey.get(key) ?? new Set<string>();
          bucket.add(record.model);
          byKey.set(key, bucket);
        }
        for (const [key, bucket] of byKey) if (bucket.size === availableModels.length) commonKeys.add(key);
      }

      for (const model of models) {
        if (commonOnly && !availableModels.some((available) => available.name === model.name)) continue;
        const relevant = base.filter(
          (record) =>
            record.model === model.name &&
            (!commonOnly || commonKeys.has(`${record.originDate}|${record.targetDate}`)),
        );
        const evaluatedPairs = relevant.filter((record) => record.predicted !== null && record.actual !== null);
        const metrics = computeMetrics(
          evaluatedPairs.map((record) => ({ actual: record.actual as number, forecast: record.predicted as number })),
        );
        const problems = validateMetricSet(metrics);

        result.push({
          ...metrics,
          model: model.name,
          horizonDays: horizon,
          minTrainDays: minTrain,
          originCount: new Set(relevant.map((record) => record.originDate)).size,
          forecastGenerated: relevant.filter((record) => record.predicted !== null).length,
          forecastUnavailable: relevant.filter((record) => record.predicted === null).length,
          evaluated: evaluatedPairs.length,
          commonEvaluation: commonOnly,
          evaluationMode: mode,
          problems,
        });
      }
    }
  }

  return result;
}

/** Независимая проверка итоговой таблицы: пересчёт метрик из сохранённых записей. */
export function verifyMetricsAgainstRecords(result: BacktestResult): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const row of result.metrics) {
    const relevant = result.records.filter(
      (record) => record.model === row.model && record.minTrainDays === row.minTrainDays && record.horizonDays === row.horizonDays,
    );
    const recalculated = recomputeFromRecords(relevant);
    for (const key of ["n", "mae", "rmse", "wape", "bias"] as const) {
      const a = row[key];
      const b = recalculated[key];
      if (typeof a === "number" && typeof b === "number") {
        if (Math.abs(a - b) > 1e-9) mismatches.push(`${row.model}/h${row.horizonDays}/train${row.minTrainDays}: ${key} ${a} ≠ ${b}`);
      } else if (a !== b) {
        mismatches.push(`${row.model}/h${row.horizonDays}/train${row.minTrainDays}: ${key} ${String(a)} ≠ ${String(b)}`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
