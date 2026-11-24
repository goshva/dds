/** Этап 3.3.5 — артефакты backtesting: CSV, JSON и markdown-отчёт. */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toCsv } from "../profiling/report";
import { METRIC_FORMULAS } from "./metrics";
import type { BacktestResult, ForecastRecord, ModelHorizonMetrics } from "./rolling-origin";
import { verifyMetricsAgainstRecords } from "./rolling-origin";

const fmt = (value: number | null | undefined, digits = 4): string =>
  value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits);

function mdTable(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) return "_нет данных_";
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

function metricRow(row: ModelHorizonMetrics): Array<unknown> {
  return [
    row.model, row.horizonDays, row.minTrainDays, row.evaluated, row.originCount,
    fmt(row.mae), fmt(row.rmse), fmt(row.wape), fmt(row.bias), fmt(row.median_abs_error), fmt(row.max_abs_error),
  ];
}

/** Формула общей выборки — документируется явно, чтобы значение покрытия не было двусмысленным. */
export const COMMON_SET_FORMULA = [
  "Ключ наблюдения: (origin_date, target_date).",
  "Шаг 1 (cumulative): для горизонта h в выборку входят все пары (origin, target) с шагом 1…h.",
  "Шаг 2: из них остаются только пары, где у ВСЕХ доступных моделей есть прогноз (predicted ≠ null) и есть фактическое значение (actual ≠ null).",
  "Шаг 3: common_evaluation_count в покрытии — СУММА таких пар по всем горизонтам (1 + 3 + 7 + 14) для данного min_train_days, а не число уникальных дат.",
  "Шаг 4 (step-exact): для горизонта h берётся только шаг ровно h; модель без прогнозов на этом шаге исключается из общей выборки и попадает в NOT_AVAILABLE.",
];

export function modelComparisonCsv(result: BacktestResult): string {
  return toCsv(
    ["model", "evaluation_mode", "horizon_days", "min_train_days", "evaluated", "origins", "MAE", "RMSE", "WAPE", "Bias", "median_abs_error", "max_abs_error", "common_evaluation", "problems"],
    [...result.stepMetrics, ...result.commonStepMetrics, ...result.metrics, ...result.commonMetrics].map((row) => [
      row.model,
      row.evaluationMode,
      row.horizonDays,
      row.minTrainDays,
      row.evaluated,
      row.originCount,
      fmt(row.mae),
      fmt(row.rmse),
      fmt(row.wape),
      fmt(row.bias),
      fmt(row.median_abs_error),
      fmt(row.max_abs_error),
      row.commonEvaluation,
      row.problems.join("; "),
    ]),
  );
}

export function forecastDetailsCsv(result: BacktestResult): string {
  return toCsv(
    ["model", "min_train_days", "origin_date", "step", "horizon_group", "target_date", "predicted", "status", "reason", "actual", "error", "abs_error", "fold", "history_points", "last_history_date"],
    result.records.map((record) => [
      record.model, record.minTrainDays, record.originDate, record.step, record.horizonDays, record.targetDate,
      record.predicted, record.status, record.reason ?? "", record.actual,
      record.predicted !== null && record.actual !== null ? record.predicted - record.actual : null,
      record.predicted !== null && record.actual !== null ? Math.abs(record.predicted - record.actual) : null,
      record.fold, record.historyPoints, record.lastHistoryDate,
    ]),
  );
}

export function foldSummaryCsv(result: BacktestResult): string {
  const rows: Array<Array<unknown>> = [];
  for (const coverage of result.coverage) {
    for (const horizon of result.horizons) {
      const relevant = result.records.filter((record) => record.minTrainDays === coverage.minTrainDays && record.horizonDays === horizon);
      const origins = [...new Set(relevant.map((record) => record.originDate))].sort();
      for (const origin of origins) {
        const foldRecords = relevant.filter((record) => record.originDate === origin);
        const evaluated = foldRecords.filter((record) => record.predicted !== null && record.actual !== null);
        const absErrors = evaluated.map((record) => Math.abs((record.predicted as number) - (record.actual as number)));
        rows.push([
          coverage.minTrainDays,
          horizon,
          origin,
          foldRecords[0]?.fold ?? 0,
          new Set(foldRecords.map((record) => record.model)).size,
          evaluated.length,
          absErrors.length ? absErrors.reduce((acc, value) => acc + value, 0) / absErrors.length : null,
          absErrors.length ? Math.max(...absErrors) : null,
        ]);
      }
    }
  }
  return toCsv(["min_train_days", "horizon_days", "origin_date", "fold", "models", "evaluated", "mean_abs_error", "max_abs_error"], rows);
}

export function dataCoverageCsv(result: BacktestResult): string {
  return toCsv(
    ["min_train_days", "origins_total", "origins_evaluated", "forecasts_expected", "forecasts_generated", "forecasts_missing", "actuals_missing", "common_evaluation_count"],
    result.coverage.map((coverage) => [
      coverage.minTrainDays, coverage.originsTotal, coverage.originsEvaluated, coverage.forecastsExpected,
      coverage.forecastsGenerated, coverage.forecastsMissing, coverage.actualsMissing, coverage.commonEvaluationCount,
    ]),
  );
}

export function leakageCheckJson(result: BacktestResult): string {
  return `${JSON.stringify({
    passed: result.leakage.passed,
    checked_records: result.leakage.checked,
    violations: result.leakage.violations,
    rules: [
      "max(дата истории модели) <= origin_date",
      "target_date > origin_date",
      "rolling-окно включает только наблюдения <= origin",
      "фактические значения целевых дат недоступны модели при построении прогноза",
    ],
    notes: result.leakage.notes,
  }, null, 2)}\n`;
}

export function reproducibilityJson(result: BacktestResult, secondRunChecksum: string): string {
  const verification = verifyMetricsAgainstRecords(result);
  return `${JSON.stringify({
    dataset_checksum: result.datasetChecksum,
    records_checksum_first_run: result.reproducibility.checksum,
    records_checksum_second_run: secondRunChecksum,
    identical: result.reproducibility.checksum === secondRunChecksum,
    metrics_recalculated_from_records: { ok: verification.ok, mismatches: verification.mismatches },
    formula_source: "metrics.ts (единая реализация MAE/RMSE/WAPE/Bias)",
    generated_at: result.generatedAt,
  }, null, 2)}\n`;
}

export function backtestingMarkdown(result: BacktestResult, secondRunChecksum: string): string {
  const verification = verifyMetricsAgainstRecords(result);
  const lines: string[] = [];
  lines.push("# Stage 3.3.5 — Rolling-origin backtesting baseline-моделей");
  lines.push("");
  lines.push(`Магазин ${result.shopNo}; метрика ${result.metric}; срез ${result.sliceId}; сформировано ${result.generatedAt}.`);
  lines.push("");
  lines.push("## Данные");
  lines.push("");
  lines.push(mdTable(["Показатель", "Значение"], [
    ["наблюдений", result.datasetPoints],
    ["период", `${result.period.from} … ${result.period.to}`],
    ["checksum набора", result.datasetChecksum],
    ["горизонты", result.horizons.join(", ")],
    ["минимальная обучающая история", result.minTrainDays.map((value) => `${value} дней`).join(", ")],
    ["checksum прогнозов", result.reproducibility.checksum],
  ]));
  lines.push("");
  lines.push("## Формулы метрик");
  lines.push("");
  lines.push(mdTable(["Метрика", "Формула"], Object.entries(METRIC_FORMULAS).map(([name, formula]) => [name, formula])));
  lines.push("");
  lines.push("## Режимы оценки: основной и sensitivity");
  lines.push("");
  const primaryTrain = result.minTrainDays[0] ?? 28;
  const sensitivityTrain = result.minTrainDays.filter((value) => value !== primaryTrain);
  lines.push(
    `**Основной результат — \`min_train_days = ${primaryTrain}\`**: все таблицы горизонтов, выводы и сравнительные утверждения ниже относятся только к нему.`,
  );
  lines.push("");
  lines.push(
    sensitivityTrain.length
      ? `Режим \`min_train_days = ${sensitivityTrain.join(", ")}\` — **sensitivity analysis**: приведён отдельной таблицей в конце отчёта. Значения двух режимов относятся к разным экспериментальным настройкам и не смешиваются ни в одной таблице и ни в одном выводе.`
      : "Sensitivity-режим не запускался: в отчёте присутствует только основной режим.",
  );
  lines.push("");
  lines.push(mdTable(
    ["min_train_days", "статус", "origins", "прогнозов сформировано", "общая выборка (cumulative)"],
    result.coverage.map((coverage) => [
      coverage.minTrainDays,
      coverage.minTrainDays === primaryTrain ? "основной" : "sensitivity analysis",
      coverage.originsEvaluated,
      coverage.forecastsGenerated,
      coverage.commonEvaluationCount,
    ]),
  ));
  lines.push("");
  lines.push("## Определение общей выборки (common set)");
  lines.push("");
  for (const rule of COMMON_SET_FORMULA) lines.push(`- ${rule}`);
  lines.push("");
  lines.push("## Модели, недоступные на горизонте (NOT_AVAILABLE)");
  lines.push("");
  lines.push(result.notAvailable.length
    ? mdTable(["модель", "горизонт", "min train", "причина"], result.notAvailable.map((entry) => [entry.model, entry.horizonDays, entry.minTrainDays, entry.reason]))
    : "_нет_");
  lines.push("");
  lines.push("## Покрытие и исключения");
  lines.push("");
  lines.push("Счётчики покрытия приведены на уровне шагов прогноза (origin × модель × шаг). Метрики горизонта h рассчитываются по всем шагам 1…h, поэтому число оценённых пар для большего горизонта больше.");
  lines.push("");
  lines.push(mdTable(
    ["min train", "origins total", "origins evaluated", "прогнозов ожидалось", "сформировано", "пропущено прогнозов", "пропущено фактов", "common set"],
    result.coverage.map((coverage) => [
      coverage.minTrainDays, coverage.originsTotal, coverage.originsEvaluated, coverage.forecastsExpected,
      coverage.forecastsGenerated, coverage.forecastsMissing, coverage.actualsMissing, coverage.commonEvaluationCount,
    ]),
  ));
  lines.push("");

  for (const horizon of result.horizons) {
    lines.push(`## Горизонт ${horizon} дн. (основной режим \`min_train = ${primaryTrain}\`)`);
    lines.push("");
    const unavailable = result.notAvailable.filter((entry) => entry.horizonDays === horizon && entry.minTrainDays === primaryTrain);
    if (unavailable.length) {
      lines.push(
        `**NOT_AVAILABLE:** ${unavailable.map((entry) => `${entry.model}`).join(", ")} — прогноз на шаге ${horizon} невозможен при текущем контракте модели (основной режим).`,
      );
      lines.push("");
    }

    lines.push(`### Основная оценка: ровно шаг ${horizon} (истинное качество горизонта)`);
    lines.push("");
    lines.push("Полная доступная выборка каждой модели:");
    lines.push("");
    lines.push(mdTable(
      ["модель", "min train", "оценено", "MAE", "RMSE", "WAPE, %", "Bias"],
      result.stepMetrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === primaryTrain).map((row) => [
        row.model, row.minTrainDays, row.evaluated, fmt(row.mae), fmt(row.rmse), fmt(row.wape), fmt(row.bias),
      ]),
    ));
    lines.push("");
    lines.push(`Общая выборка на шаге ${horizon} (только модели, у которых есть прогноз на этом шаге):`);
    lines.push("");
    lines.push(mdTable(
      ["модель", "min train", "оценено", "MAE", "RMSE", "WAPE, %", "Bias"],
      result.commonStepMetrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === primaryTrain).map((row) => [
        row.model, row.minTrainDays, row.evaluated, fmt(row.mae), fmt(row.rmse), fmt(row.wape), fmt(row.bias),
      ]),
    ));
    lines.push("");
    lines.push(`<details><summary>Справочно: оценка по всем шагам 1…${horizon} (cumulative, основной режим)</summary>`);
    lines.push("");
    lines.push(mdTable(
      ["модель", "min train", "оценено", "MAE", "RMSE", "WAPE, %", "Bias"],
      result.metrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === primaryTrain).map((row) => [
        row.model, row.minTrainDays, row.evaluated, fmt(row.mae), fmt(row.rmse), fmt(row.wape), fmt(row.bias),
      ]),
    ));
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (sensitivityTrain.length) {
    lines.push(`## Sensitivity analysis (\`min_train = ${sensitivityTrain.join(", ")}\`)`);
    lines.push("");
    lines.push("Отдельный режим, не смешивается с основным результатом. Оценка — ровно шаг `h`, общая выборка.");
    lines.push("");
    lines.push(mdTable(
      ["горизонт", "модель", "оценено", "MAE", "RMSE", "WAPE, %", "Bias"],
      result.commonStepMetrics
        .filter((row) => sensitivityTrain.includes(row.minTrainDays))
        .map((row) => [row.horizonDays, row.model, row.evaluated, fmt(row.mae), fmt(row.rmse), fmt(row.wape), fmt(row.bias)]),
    ));
    lines.push("");
    lines.push("Полная таблица обоих режимов (с колонкой `evaluation_mode` и `min_train_days`) — в `3.3.5-model-comparison.csv`.");
    lines.push("");
  }

  lines.push("## Проверка утечки данных");
  lines.push("");
  lines.push(`Проверено записей: ${result.leakage.checked}; нарушений: ${result.leakage.violations.length}; статус: ${result.leakage.passed ? "PASS" : "FAIL"}.`);
  lines.push("");
  lines.push(mdTable(["правило", "пояснение"], result.leakage.notes.map((note) => ["—", note])));
  lines.push("");
  if (result.leakage.violations.length) {
    lines.push(mdTable(
      ["модель", "origin", "target", "последняя дата истории", "тип"],
      result.leakage.violations.slice(0, 20).map((violation) => [violation.model, violation.originDate, violation.targetDate, violation.lastHistoryDate, violation.kind]),
    ));
    lines.push("");
  }

  lines.push("## Воспроизводимость и независимый пересчёт");
  lines.push("");
  lines.push(mdTable(["Проверка", "Результат"], [
    ["повторный прогон идентичен", result.reproducibility.checksum === secondRunChecksum ? "да" : "НЕТ"],
    ["метрики пересчитаны из записей", verification.ok ? "совпали" : `расхождения: ${verification.mismatches.length}`],
    ["NaN/Infinity в метриках", result.metrics.some((row) => row.problems.length) ? "обнаружены" : "нет"],
  ]));
  lines.push("");
  lines.push("## Выводы по моделям");
  lines.push("");
  lines.push(conclusions(result));
  lines.push("");
  lines.push("## Ограничения интерпретации");
  lines.push("");
  lines.push(mdTable(["Ограничение", "Следствие"], [
    ["один магазин", "выводы не переносятся на другие даркстоны"],
    ["семантика метрики PROVISIONAL", "результаты являются техническими, а не бизнес-подтверждёнными"],
    ["короткая история относительно годового цикла", "недельная и годовая сезонность не доказаны"],
    ["отсутствуют почасовые данные, данные о курьерах и подтверждённые мероприятия", "причинно-следственные выводы невозможны"],
    ["chart 20209 исключён", "показатели мощности курьеров не учитываются"],
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function conclusions(result: BacktestResult): string {
  const lines: string[] = [];
  const bestByHorizon: string[] = [];
  const primaryTrain = result.minTrainDays[0] ?? 28;
  lines.push(
    `Все выводы относятся к **основному режиму \`min_train_days = ${primaryTrain}\`** и к **основной оценке (ровно шаг h)**. ` +
      "Значения sensitivity-режима приведены отдельной таблицей и в выводах не используются.",
  );
  lines.push("");
  for (const horizon of result.horizons) {
    const rows = result.commonStepMetrics.filter((row) => row.horizonDays === horizon && row.minTrainDays === primaryTrain && row.mae !== null);
    const unavailable = result.notAvailable.filter((entry) => entry.horizonDays === horizon && entry.minTrainDays === primaryTrain);
    if (!rows.length) {
      bestByHorizon.push(`- Горизонт ${horizon} дн.: недостаточно данных для сравнения.`);
      continue;
    }
    const sorted = [...rows].sort((a, b) => (a.mae as number) - (b.mae as number));
    const best = sorted[0]!;
    const worst = sorted.at(-1)!;
    const spread = Math.abs((worst.mae as number) - (best.mae as number));
    const bestMae = best.mae as number;
    const relativeGap = bestMae > 0 ? (spread / bestMae) * 100 : null;
    const unavailableNote = unavailable.length
      ? ` Модели NOT_AVAILABLE на этом шаге: ${unavailable.map((entry) => entry.model).join(", ")}.`
      : "";
    bestByHorizon.push(
      `- Горизонт ${horizon} дн. (шаг ${horizon}): наименьшая MAE у **${best.model}** (${fmt(best.mae)} заказов, n=${best.evaluated}); ` +
        `разброс между сопоставимыми моделями ${fmt(spread)}${relativeGap === null ? "" : ` (${relativeGap.toFixed(1)}% от лучшей MAE)`}.` +
        (unavailableNote) +
        (relativeGap !== null && relativeGap < 10
          ? " Разница мала относительно разброса ошибок: уверенный вывод о превосходстве невозможен."
          : " Разница заметна, но подтверждается только на доступной истории."),
    );
  }
  lines.push(...bestByHorizon);
  const naive = result.commonStepMetrics.find((row) => row.model === "naive_yesterday" && row.horizonDays === 7 && row.minTrainDays === primaryTrain);
  const rolling = result.commonStepMetrics.find((row) => row.model === "rolling_7_day_mean" && row.horizonDays === 7 && row.minTrainDays === primaryTrain);
  if (naive?.mae != null && rolling?.mae != null) {
    const delta = (rolling.mae as number) - (naive.mae as number);
    lines.push(
      `- Скользящее среднее (rolling_7_day_mean) против наивного прогноза (naive_yesterday) на шаге 7: разница MAE ${fmt(delta)} заказов ` +
        `(${delta < 0 ? "в пользу скользящего среднего" : delta > 0 ? "в пользу наивного прогноза" : "равны"}).`,
    );
  }
  const biases = result.commonStepMetrics.filter((row) => row.bias !== null && row.minTrainDays === primaryTrain);
  const maxAbsBias = biases.reduce<ModelHorizonMetrics | null>((acc, row) => (!acc || Math.abs(row.bias as number) > Math.abs(acc.bias as number) ? row : acc), null);
  if (maxAbsBias) {
    lines.push(
      `- Наибольшее систематическое смещение: ${maxAbsBias.model} (горизонт ${maxAbsBias.horizonDays} дн.) — Bias ${fmt(maxAbsBias.bias)} заказов ` +
        `(${(maxAbsBias.bias as number) > 0 ? "завышение" : "занижение"}).`,
    );
  }
  lines.push(
    "- Общая формулировка: на доступной истории различия между baseline-моделями невелики; для уверенного выбора одной модели требуется более длинная история и подтверждённая бизнес-семантика.",
  );
  return lines.join("\n");
}

export async function writeBacktestArtifacts(input: {
  outDir: string;
  result: BacktestResult;
  secondRunChecksum: string;
  baselineModelsMarkdown: string;
}): Promise<string[]> {
  await mkdir(input.outDir, { recursive: true });
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(input.outDir, name), content);
    written.push(name);
  };

  await write("3.3.4-baseline-models.md", input.baselineModelsMarkdown);
  await write("3.3.5-backtesting-report.md", backtestingMarkdown(input.result, input.secondRunChecksum));
  await write("3.3.5-model-comparison.csv", modelComparisonCsv(input.result));
  await write("3.3.5-forecast-details.csv", forecastDetailsCsv(input.result));
  await write("3.3.5-fold-summary.csv", foldSummaryCsv(input.result));
  await write("3.3.5-data-coverage.csv", dataCoverageCsv(input.result));
  await write("3.3.5-leakage-check.json", leakageCheckJson(input.result));
  await write("3.3.5-reproducibility.json", reproducibilityJson(input.result, input.secondRunChecksum));

  return written;
}

export function baselineModelsMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Stage 3.3.4 — Baseline-модели");
  lines.push("");
  lines.push("Реализованы ровно три интерпретируемые модели с единым контрактом `BaselineModel`:");
  lines.push("");
  lines.push(mdTable(["Модель", "Формула", "Требования к истории", "Поведение при нехватке данных"], [
    ["naive_yesterday", "forecast(t + h) = actual(t) — последнее известное фактическое значение", "минимум 1 наблюдение", "прогноз недоступен"],
    ["rolling_7_day_mean", "forecast(t + h) = mean(последних 7 фактических наблюдений)", "минимум 7 фактических наблюдений", "прогноз недоступен (без интерполяции)"],
    ["weekly_seasonal_naive", "forecast(d) = actual(d − 7 дней)", "наличие значения ровно на d − 7", "недоступно для конкретной даты, помечается причиной"],
  ]));
  lines.push("");
  lines.push("## Общие ограничения реализации");
  lines.push("");
  lines.push(mdTable(["Правило", "Реализация"], [
    ["доступ к будущим данным", "запрещён: `assertNoFutureData` бросает ошибку, если наблюдение позже origin"],
    ["пропуски", "не интерполируются и не заменяются нулём: прогноз получает статус unavailable с причиной"],
    ["округление", "прогнозы не округляются; средние могут быть дробными"],
    ["NaN / Infinity", "проверяются через `ensureFinite`, при нарушении — ошибка"],
    ["горизонты", "1, 3, 7, 14 дней; target-даты формируются календарно от origin"],
  ]));
  lines.push("");
  lines.push("Unit-тесты покрывают: историю из 7 дней и менее, пропущенные даты, дубликаты, дробные, нулевые и отрицательные значения, NaN/Infinity, переходы месяца и года, горизонты 1/3/7/14 и попытку передачи будущих наблюдений.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
