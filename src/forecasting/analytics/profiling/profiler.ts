/**
 * Профилирование исторических данных магазина (Stage 3.1).
 *
 * Модуль не пишет в базу: он получает уже открытое read-only соединение
 * ({@link openReadOnlyDatabase}) и работает только читающими запросами.
 * Бизнес-прогнозы здесь не строятся — только оценка качества и пригодности данных.
 */

import type { Database } from "bun:sqlite";

import { buildDimensionProfiles } from "./dimensions-profile";
import { buildMetricProfiles, buildTemporalCoverage, calendarRange } from "./metrics-profile";
import { detectOutliers } from "./outliers";
import { readIntegrity, readTableCounts, queryAll, queryOne } from "./read-only";
import { aggregateReadinessByMetric, assessMetricReadiness } from "./readiness";
import { loadSemanticRegistry, ratioFormulaFor, RATIO_FORMULA_MAP } from "./semantics";
import { SEASONALITY_WARNING, buildTemporalProfile, completeWeeks, dowObservationCounts } from "./temporal-profile";
import type {
  DailyObservationRow,
  EventsProfile,
  MetricSemantics,
  OutlierFinding,
  PeriodAssessment,
  ProfilingResult,
  RatioCheck,
  ReadinessRow,
  SliceOverlapRow,
  TemporalProfile,
} from "./types";

export interface ProfileOptions {
  shopNo: string;
  /** Время формирования отчёта передаётся извне — вычисления детерминированы. */
  generatedAt: string;
  expectedPeriod?: { from: string; to: string };
  catalogPath?: string;
  datasetId?: string;
  /** Минимальная длина обучающей истории для оценки числа фолдов backtesting. */
  backtestMinTrainDays?: number[];
  backtestHorizons?: number[];
}

export const DEFAULT_EXPECTED_PERIOD = { from: "2026-10-13", to: "2026-11-22" };

const READ_ROWS_SQL = `SELECT date, slice_id, metric, metric_kind, dimension_1, dimension_2,
                              value, unit, evidence_status, data_status, transform_version
                         FROM daily_metrics
                        WHERE shop_no = ?
                        ORDER BY date, slice_id, metric, dimension_1, dimension_2`;

/**
 * Допуск округления при проверке отношения: значения долей в источнике хранятся
 * с ограниченной точностью, поэтому точное равенство не достигается (наблюдаемое
 * максимальное отклонение ~5·10⁻⁷).
 */
export const RATIO_ROUNDING_TOLERANCE = 1e-6;

/** Читает наблюдения магазина (только SELECT). */
export function readObservations(db: Database, shopNo: string): DailyObservationRow[] {
  return queryAll<DailyObservationRow>(db, READ_ROWS_SQL, [shopNo]);
}

function countBy(db: Database, shopNo: string, column: string): Record<string, number> {
  const allowed = new Set(["data_status", "evidence_status", "transform_version"]);
  if (!allowed.has(column)) throw new Error(`countBy: недопустимая колонка ${column}`);
  const rows = queryAll<{ key: string; c: number }>(
    db,
    `SELECT ${column} AS key, COUNT(*) AS c FROM daily_metrics WHERE shop_no = ? GROUP BY ${column} ORDER BY ${column}`,
    [shopNo],
  );
  return Object.fromEntries(rows.map((row) => [row.key ?? "", row.c]));
}

function findDuplicates(db: Database, shopNo: string): { count: number; examples: string[] } {
  const rows = queryAll<{ c: number; date: string; slice_id: number; metric: string }>(
    db,
    `SELECT COUNT(*) AS c, date, slice_id, metric
       FROM daily_metrics
      WHERE shop_no = ?
      GROUP BY shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version
     HAVING COUNT(*) > 1
      ORDER BY date, slice_id, metric
      LIMIT 20`,
    [shopNo],
  );
  const total = queryOne<{ c: number }>(
    db,
    `SELECT COALESCE(SUM(c - 1), 0) AS c FROM (
        SELECT COUNT(*) AS c FROM daily_metrics WHERE shop_no = ?
         GROUP BY shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version
        HAVING COUNT(*) > 1)`,
    [shopNo],
  );
  return {
    count: total?.c ?? 0,
    examples: rows.map((row) => `${row.date}/${row.slice_id}/${row.metric} ×${row.c}`),
  };
}

function readEvents(db: Database, shopNo: string): EventsProfile {
  const byStatus = queryAll<{ key: string; c: number }>(
    db,
    "SELECT status AS key, COUNT(*) AS c FROM domain_events WHERE shop_no = ? GROUP BY status ORDER BY status",
    [shopNo],
  );
  const byEvidence = queryAll<{ key: string; c: number }>(
    db,
    "SELECT evidence_status AS key, COUNT(*) AS c FROM domain_events WHERE shop_no = ? GROUP BY evidence_status ORDER BY evidence_status",
    [shopNo],
  );
  const notes = queryAll<{ ledger_note: string; status: string; evidence_status: string }>(
    db,
    `SELECT COALESCE(ledger_note, '') AS ledger_note, status, evidence_status
       FROM domain_events WHERE shop_no = ? ORDER BY event_id`,
    [shopNo],
  );
  const total = byStatus.reduce((acc, row) => acc + row.c, 0);
  const hasActual = notes.some((note) => note.status !== "planned" || note.evidence_status !== "planned");
  return {
    total,
    by_status: Object.fromEntries(byStatus.map((row) => [row.key, row.c])),
    by_evidence_status: Object.fromEntries(byEvidence.map((row) => [row.key, row.c])),
    planned_notes: notes,
    note: hasActual
      ? "ВНИМАНИЕ: обнаружены мероприятия со статусом, отличным от planned — требуется проверка"
      : "Все мероприятия имеют статус planned/planned: это план, а не подтверждённые факты; влияние на спрос не рассчитывается",
  };
}

function ratioChecks(rows: readonly DailyObservationRow[]): RatioCheck[] {
  const checks: RatioCheck[] = [];
  for (const formula of RATIO_FORMULA_MAP) {
    const slices = [...new Set(rows.filter((row) => row.metric === formula.metric).map((row) => row.slice_id))].sort((a, b) => a - b);
    for (const sliceId of slices) {
      const key = (row: DailyObservationRow) => `${row.date}\u0001${row.dimension_1}\u0001${row.dimension_2}`;
      const ratios = new Map<string, number>();
      const numerators = new Map<string, number>();
      const denominators = new Map<string, number>();
      for (const row of rows) {
        if (row.slice_id !== sliceId || row.value === null) continue;
        if (row.metric === formula.metric) ratios.set(key(row), row.value);
        if (formula.numerator_metric && row.metric === formula.numerator_metric) numerators.set(key(row), row.value);
        if (formula.denominator_metric && row.metric === formula.denominator_metric) denominators.set(key(row), row.value);
      }

      if (!formula.numerator_metric || !formula.denominator_metric) {
        checks.push({
          metric: formula.metric,
          slice_id: sliceId,
          numerator_metric: formula.numerator_metric,
          denominator_metric: formula.denominator_metric,
          dates_checked: 0,
          max_abs_deviation: null,
          mean_abs_deviation: null,
          exact_matches: 0,
          matches_within_rounding: 0,
          rounding_tolerance: RATIO_ROUNDING_TOLERANCE,
          formula_source: "каталог метаданных: " + (loadSemanticRegistryCachedExpression(formula.metric) ?? "нет выражения"),
          note: formula.note,
        });
        continue;
      }

      let maxDeviation = 0;
      let sumDeviation = 0;
      let checked = 0;
      let exact = 0;
      let withinRounding = 0;
      for (const [k, ratioValue] of ratios) {
        const numerator = numerators.get(k);
        const denominator = denominators.get(k);
        if (numerator === undefined || denominator === undefined || denominator === 0) continue;
        const expected = numerator / denominator;
        const deviation = Math.abs(ratioValue - expected);
        maxDeviation = Math.max(maxDeviation, deviation);
        sumDeviation += deviation;
        checked++;
        if (deviation <= 1e-9) exact++;
        if (deviation <= RATIO_ROUNDING_TOLERANCE) withinRounding++;
      }

      checks.push({
        metric: formula.metric,
        slice_id: sliceId,
        numerator_metric: formula.numerator_metric,
        denominator_metric: formula.denominator_metric,
        dates_checked: checked,
        max_abs_deviation: checked ? maxDeviation : null,
        mean_abs_deviation: checked ? sumDeviation / checked : null,
        exact_matches: exact,
        matches_within_rounding: withinRounding,
        rounding_tolerance: RATIO_ROUNDING_TOLERANCE,
        formula_source: loadSemanticRegistryCachedExpression(formula.metric) ?? null,
        note: checked
          ? withinRounding === checked
            ? exact === checked
              ? "отношение восстанавливается точно на всех проверенных наблюдениях"
              : `отношение восстанавливается в пределах округления долей (допуск ${RATIO_ROUNDING_TOLERANCE}): точных совпадений ${exact} из ${checked}`
            : "отношение НЕ восстанавливается: часть наблюдений отличается сильнее допуска округления — вероятен иной знаменатель"
          : "нет наблюдений, где одновременно присутствуют все три метрики",
      });
    }
  }
  return checks;
}

let expressionCache: Map<string, string> | null = null;
function loadSemanticRegistryCachedExpression(metric: string): string | null {
  if (!expressionCache) {
    expressionCache = new Map(loadSemanticRegistry().map((entry) => [entry.metric, entry.expression ?? ""]));
  }
  return expressionCache.get(metric)?.trim() || null;
}

function sliceOverlap(rows: readonly DailyObservationRow[]): SliceOverlapRow[] {
  const byMetric = new Map<string, DailyObservationRow[]>();
  for (const row of rows) {
    const bucket = byMetric.get(row.metric) ?? [];
    bucket.push(row);
    byMetric.set(row.metric, bucket);
  }

  const result: SliceOverlapRow[] = [];
  for (const [metric, group] of byMetric) {
    const slices = [...new Set(group.map((row) => row.slice_id))].sort((a, b) => a - b);
    if (slices.length < 2) continue;

    // сравниваем суммы по датам между срезами (без учёта измерений — грубая проверка пересечения)
    const totals = new Map<string, Map<number, number>>();
    for (const row of group) {
      if (row.value === null) continue;
      const perSlice = totals.get(row.date) ?? new Map<number, number>();
      perSlice.set(row.slice_id, (perSlice.get(row.slice_id) ?? 0) + row.value);
      totals.set(row.date, perSlice);
    }
    let sharedDates = 0;
    let equal = 0;
    for (const perSlice of totals.values()) {
      if (perSlice.size < 2) continue;
      const values = [...perSlice.values()];
      sharedDates++;
      if (values.every((value) => Math.abs(value - values[0]!) <= 1e-9)) equal++;
    }

    result.push({
      metric,
      slices,
      shared_dates: sharedDates,
      values_equal_on_shared_dates: sharedDates > 0 && equal === sharedDates,
      independence: "unknown",
      notes: [
        "независимость срезов не доказана: суммирование показателя между срезами запрещено",
        sharedDates > 0
          ? equal === sharedDates
            ? "дневные суммы по срезам совпадают — вероятно, это разные измерения одного населения"
            : "дневные суммы по срезам различаются — требуется установить семантику каждого среза"
          : "нет дат, где метрика присутствует более чем в одном срезе",
      ],
    });
  }
  return result.sort((a, b) => a.metric.localeCompare(b.metric));
}

function assessPeriod(
  calendar: readonly string[],
  canonicalPoints: ReadonlyArray<{ date: string; value: number }>,
  options: { minTrainDays: number[]; horizons: number[] },
): PeriodAssessment {
  const weeks = completeWeeks(canonicalPoints);
  const days = calendar.length;
  const folds: PeriodAssessment["backtesting_folds"] = [];
  for (const minTrain of options.minTrainDays) {
    for (const horizon of options.horizons) {
      folds.push({ horizon_days: horizon, min_train_days: minTrain, folds: Math.max(0, days - minTrain - horizon + 1) });
    }
  }
  const recommended = options.horizons.filter((horizon) =>
    folds.some((entry) => entry.horizon_days === horizon && entry.min_train_days === 21 && entry.folds >= 3),
  );

  return {
    from: calendar[0] ?? "",
    to: calendar.at(-1) ?? "",
    days,
    missing_calendar_days: [],
    complete_weeks: weeks,
    simple_baseline_possible: days >= 21,
    dow_features_possible: weeks >= 2,
    weekly_profile_reliability: weeks >= 4 ? "medium" : "low",
    backtesting_folds: folds,
    recommended_horizons: recommended,
    forbidden_claims: [
      "годовая сезонность",
      "месячная сезонность",
      "устойчивость долгосрочного тренда",
      "поведение в праздники и сезонные пики",
      "долгосрочная стабильность спроса",
      "подтверждённая недельная сезонность",
    ],
  };
}

/** Сводит строки одного дня к одному значению: аддитивные — суммой, доли — средним (с оговоркой). */
export function aggregateSeriesByDate(
  rows: readonly DailyObservationRow[],
  metric: string,
  sliceId: number,
  metricKind: string,
): { points: Array<{ date: string; value: number }>; aggregation: "sum_by_dimensions" | "mean_by_dimensions"; note: string } {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    if (row.metric !== metric || row.slice_id !== sliceId || !row.date || row.value === null) continue;
    const bucket = byDate.get(row.date) ?? [];
    bucket.push(row.value);
    byDate.set(row.date, bucket);
  }

  const points: Array<{ date: string; value: number }> = [];
  for (const [date, values] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (metricKind === "additive") {
      points.push({ date, value: values.reduce((acc, value) => acc + value, 0) });
    } else {
      points.push({ date, value: values.reduce((acc, value) => acc + value, 0) / values.length });
    }
  }

  return metricKind === "additive"
    ? {
        points,
        aggregation: "sum_by_dimensions",
        note: "значение дня — арифметическая сумма по измерениям внутри среза (не подтверждённый бизнес-агрегат)",
      }
    : {
        points,
        aggregation: "mean_by_dimensions",
        note: "значение дня — простое среднее долей по измерениям; это НЕ агрегированное отношение sum(числитель)/sum(знаменатель)",
      };
}

/** Группирует строки по комбинации измерений: популяции не смешиваются. */
function groupByDimension(rows: readonly DailyObservationRow[]): Map<string, DailyObservationRow[]> {
  const groups = new Map<string, DailyObservationRow[]>();
  for (const row of rows) {
    const key = `${row.metric}\u0001${row.slice_id}\u0001${row.dimension_1}\u0001${row.dimension_2}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Полное профилирование по уже открытому read-only соединению. */
export function profileShop(db: Database, options: ProfileOptions): ProfilingResult {
  const { shopNo, generatedAt } = options;
  const expected = options.expectedPeriod ?? DEFAULT_EXPECTED_PERIOD;

  const rows = readObservations(db, shopNo);
  const dailyRows = rows.filter((row) => row.date);
  const dates = [...new Set(dailyRows.map((row) => row.date))].sort();
  const from = dates[0] ?? "";
  const to = dates.at(-1) ?? "";
  const calendar = from && to ? calendarRange(from, to) : [];
  const presentDates = new Set(dates);
  const missingCalendarDays = calendar.filter((date) => !presentDates.has(date));

  const semanticsRegistry = loadSemanticRegistry(options.catalogPath, options.datasetId);
  const semanticsByMetric = new Map<string, MetricSemantics>(semanticsRegistry.map((entry) => [entry.metric, entry]));

  const metricProfiles = buildMetricProfiles(dailyRows, calendar);
  const temporalCoverage = buildTemporalCoverage(dailyRows, calendar);
  const dimensions = buildDimensionProfiles(dailyRows);

  // выбросы и временные профили
  //  - выбросы ищутся внутри одной комбинации измерений (разные службы/курьеры не смешиваются);
  //  - временной профиль строится по одному значению на дату с явно указанным способом сведения.
  const outliers: OutlierFinding[] = [];
  for (const [key, group] of groupByDimension(dailyRows)) {
    const [metric, sliceIdRaw, dimension1, dimension2] = key.split("\u0001") as [string, string, string, string];
    const points = group
      .filter((row) => row.value !== null)
      .map((row) => ({ date: row.date, value: row.value as number }));
    if (points.length === 0) continue;
    const detection = detectOutliers(points, {
      metric,
      slice_id: Number(sliceIdRaw),
      dimension_1: dimension1,
      dimension_2: dimension2,
    });
    outliers.push(...detection.findings);
  }
  outliers.sort(
    (a, b) =>
      a.metric.localeCompare(b.metric) ||
      a.slice_id - b.slice_id ||
      a.dimension_1.localeCompare(b.dimension_1) ||
      a.date.localeCompare(b.date) ||
      a.method.localeCompare(b.method),
  );

  const temporalProfiles: TemporalProfile[] = [];
  for (const profile of metricProfiles) {
    const series = aggregateSeriesByDate(dailyRows, profile.metric, profile.slice_id, profile.metric_kind);
    temporalProfiles.push(
      buildTemporalProfile({
        metric: profile.metric,
        slice_id: profile.slice_id,
        points: series.points,
        aggregation: series.aggregation,
        aggregation_note: series.note,
      }),
    );
  }

  const overlap = sliceOverlap(dailyRows);
  const checks = ratioChecks(dailyRows);

  // readiness: сначала по каждой паре (метрика, срез), затем свод по метрике
  const perProfileReadiness: ReadinessRow[] = metricProfiles.map((profile) => {
    const slices = [...new Set(dailyRows.filter((row) => row.metric === profile.metric).map((row) => row.slice_id))].sort((a, b) => a - b);
    const metricOutliers = outliers.filter((finding) => finding.metric === profile.metric && finding.slice_id === profile.slice_id);
    const overlapRow = overlap.find((entry) => entry.metric === profile.metric);
    const ratioOk = checks.some(
      (check) =>
        check.metric === profile.metric &&
        check.slice_id === profile.slice_id &&
        check.dates_checked > 0 &&
        check.matches_within_rounding === check.dates_checked,
    );
    return assessMetricReadiness({
      profile,
      semantics: semanticsByMetric.get(profile.metric) ?? null,
      outliers: metricOutliers,
      slices,
      independence: overlapRow?.independence ?? "unknown",
      ratioVerified: ratioOk,
    });
  });

  // сводная оценка по метрике (статус — по худшему срезу)
  const readiness = aggregateReadinessByMetric(perProfileReadiness);

  // оценка периода — по каноническому показателю в первом срезе (агрегированная дневная серия)
  const canonicalMetric = "qty_orders_delivered";
  const canonicalSlice = [...new Set(dailyRows.map((row) => row.slice_id))].sort((a, b) => a - b)[0] ?? 0;
  const canonicalSeries = aggregateSeriesByDate(dailyRows, canonicalMetric, canonicalSlice, "additive");
  const assessmentBase = assessPeriod(calendar, canonicalSeries.points, {
    minTrainDays: options.backtestMinTrainDays ?? [21, 28],
    horizons: options.backtestHorizons ?? [1, 3, 7, 14],
  });
  assessmentBase.missing_calendar_days = missingCalendarDays;

  const integrity = readIntegrity(db);
  const counts = readTableCounts(db);
  const duplicates = findDuplicates(db, shopNo);

  const limitations = [
    "период 41 день (менее 6 полных недель): выводы о сезонности невозможны",
    SEASONALITY_WARNING,
    "один магазин (7745): результаты не переносимы на другие даркстоны без проверки",
    "бизнес-семантика метрик подтверждена только каталогом метаданных Superset; письменного согласования определений нет",
    "единицы измерения денежных метрик не подтверждены — суммы не интерпретируются как рубли или копейки",
    "ratio-метрики нельзя суммировать; знаменатель подтверждён только у части из них",
    "dimension-поля содержат плейсхолдеры маскирования: возможны коллизии разных сущностей",
    "почасовых данных нет — внутридневная динамика не анализируется",
    "кадровые и операционные факторы (явка, пул, ходки, ТМЦ) в наборе отсутствуют",
    "chart 20209 в основной набор не включён: его семантика (slots = 1) не подтверждена",
    `профилирование выполнялось read-only: query_only=${integrity.query_only}, пробная запись отклонена`,
    `дублей по natural key: ${duplicates.count}`,
  ];

  return {
    shop_no: shopNo,
    generated_at: generatedAt,
    period: {
      from,
      to,
      days: calendar.length,
      missing_calendar_days: missingCalendarDays,
      matches_expected_period: from === expected.from && to === expected.to,
      expected_period: expected,
    },
    source_counts: counts,
    slices: [...new Set(dailyRows.map((row) => row.slice_id))].sort((a, b) => a - b),
    status_counts: {
      data_status: countBy(db, shopNo, "data_status"),
      evidence_status: countBy(db, shopNo, "evidence_status"),
      transform_version: countBy(db, shopNo, "transform_version"),
    },
    duplicates,
    metric_profiles: metricProfiles,
    temporal_coverage: temporalCoverage,
    temporal_profiles: temporalProfiles.sort((a, b) => a.metric.localeCompare(b.metric) || a.slice_id - b.slice_id),
    outliers,
    dimensions,
    slice_overlap: overlap,
    ratio_checks: checks,
    period_assessment: assessmentBase,
    semantics: semanticsRegistry.filter((entry) => metricProfiles.some((profile) => profile.metric === entry.metric)),
    readiness: readiness.sort((a, b) => a.metric.localeCompare(b.metric) || a.slices[0]! - b.slices[0]!),
    events: readEvents(db, shopNo),
    limitations,
    read_only: { readonly_connection: true, query_only: integrity.query_only, write_attempt_blocked: integrity.query_only === 1 },
  };
}

/** Дни недели по календарю (для отчёта о сбалансированности). */
export function dowCounts(rows: readonly DailyObservationRow[]) {
  return dowObservationCounts(rows);
}
