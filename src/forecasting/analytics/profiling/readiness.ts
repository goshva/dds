/**
 * Оценка пригодности метрик для перехода к подготовке временного ряда.
 *
 * Правило этапа: READY не присваивается только за отсутствие технических ошибок.
 * Если семантика не подтверждена документально, метрика не может быть READY;
 * если показатель встречается в нескольких срезах с недоказанной независимостью —
 * это риск двойного суммирования и повод для CONDITIONAL.
 *
 * Значения статусов:
 *  - READY — структура и качество достаточны, семантика подтверждена, пересечений нет;
 *  - CONDITIONAL — можно использовать после выполнения перечисленных условий;
 *  - BLOCKED — использовать нельзя до устранения конкретной проблемы.
 */

import type { MetricProfile, MetricSemantics, OutlierFinding, ReadinessRow } from "./types";

/** Порог заполненности, ниже которого пропуски считаются критическими. */
export const CRITICAL_FILL_RATE = 0.5;

export interface ReadinessInput {
  profile: MetricProfile;
  semantics: MetricSemantics | null;
  /** Количество выбросов по обоим методам (единая точка = один выброс). */
  outliers: OutlierFinding[];
  /** Все срезы, в которых встречается метрика. */
  slices: number[];
  /** Установлена ли независимость срезов для этой метрики. */
  independence: "unknown" | "same_population" | "different_population";
  /** Восстановлено ли отношение для ratio-метрики. */
  ratioVerified?: boolean;
}

/**
 * Сводная оценка по метрике: статусы отдельных срезов объединяются по худшему,
 * счётчики суммируются, заполненность берётся по минимальному срезу.
 * Это соответствует требованию «статус — для каждой метрики», а детальные оценки
 * по парам (метрика, срез) остаются в metrics-profile.csv.
 */
export function aggregateReadinessByMetric(rows: readonly ReadinessRow[]): ReadinessRow[] {
  const byMetric = new Map<string, ReadinessRow[]>();
  for (const row of rows) {
    const bucket = byMetric.get(row.metric) ?? [];
    bucket.push(row);
    byMetric.set(row.metric, bucket);
  }

  const rank: Record<ReadinessRow["forecast_readiness"], number> = { READY: 0, CONDITIONAL: 1, BLOCKED: 2 };
  const result: ReadinessRow[] = [];
  for (const [metric, group] of byMetric) {
    const status = group.reduce<ReadinessRow["forecast_readiness"]>(
      (worst, row) => (rank[row.forecast_readiness] > rank[worst] ? row.forecast_readiness : worst),
      "READY",
    );
    const reasons = [...new Set(group.flatMap((row) => row.reasons))];
    const requiredActions = [...new Set(group.flatMap((row) => row.required_actions))];
    result.push({
      metric,
      metric_kind: group[0]!.metric_kind,
      slices: [...new Set(group.flatMap((row) => row.slices))].sort((a, b) => a - b),
      observations: group.reduce((acc, row) => acc + row.observations, 0),
      coverage: Math.min(...group.map((row) => row.coverage)),
      missing: group.reduce((acc, row) => acc + row.missing, 0),
      nulls: group.reduce((acc, row) => acc + row.nulls, 0),
      zeros: group.reduce((acc, row) => acc + row.zeros, 0),
      outliers: group.reduce((acc, row) => acc + row.outliers, 0),
      semantic_status: group[0]!.semantic_status,
      forecast_readiness: status,
      reasons,
      required_actions: requiredActions,
    });
  }

  return result.sort((a, b) => a.metric.localeCompare(b.metric));
}

/** Оценка одной пары (метрика, срез) по её профилю. */
export function assessMetricReadiness(input: ReadinessInput): ReadinessRow {
  const { profile, semantics, outliers, slices, independence } = input;
  const blockers: string[] = [];
  const conditions: string[] = [];
  const requiredActions: string[] = [];

  // --- блокирующие проблемы ----------------------------------------------------
  if (profile.observations === 0 || profile.stats.n === 0) {
    blockers.push("нет ни одного числового наблюдения");
    requiredActions.push("проверить источник данных и повторный сбор");
  }
  if (profile.fill_rate < CRITICAL_FILL_RATE) {
    blockers.push(`критическая неполнота: заполнено ${(profile.fill_rate * 100).toFixed(1)}% дней периода`);
    requiredActions.push("выяснить причину пропусков и восстановить данные за пропущенные дни");
  }
  if (profile.stats.n > 1 && profile.stats.stdev === 0) {
    blockers.push("ряд постоянный (стандартное отклонение = 0) — прогнозировать нечего");
    requiredActions.push("подтвердить, что показатель действительно постоянен, а не сломан в источнике");
  }
  if (profile.metric_kind === "additive" && profile.stats.negatives > 0) {
    blockers.push(`в аддитивной метрике ${profile.stats.negatives} отрицательных значений`);
    requiredActions.push("объяснить природу отрицательных значений (возвраты, корректировки)");
  }

  // --- условия использования ----------------------------------------------------
  const semanticStatus = semantics?.status ?? "unknown";
  if (semanticStatus !== "known") {
    conditions.push(`семантика не подтверждена документально (статус: ${semanticStatus})`);
    requiredActions.push("получить письменное определение метрики, единицы измерения и периода расчёта");
  }
  if (profile.metric_kind === "ratio") {
    if (input.ratioVerified === true) {
      conditions.push("отношение числитель/знаменатель восстановлено — способ агрегации определён");
    } else {
      conditions.push("не подтверждён знаменатель ratio-метрики — способ агрегации неизвестен");
      requiredActions.push("подтвердить числитель и знаменатель, запретить суммирование долей");
    }
  }
  if (profile.fill_rate < 1) {
    conditions.push(`внутри периода пропущено ${profile.missing_days} дней (заполнено ${(profile.fill_rate * 100).toFixed(1)}%)`);
    requiredActions.push("зафиксировать политику обработки пропусков (без интерполяции)");
  }
  if (profile.stats.nulls > 0) {
    conditions.push(`${profile.stats.nulls} наблюдений со значением NULL`);
    requiredActions.push("определить, означает ли NULL отсутствие заказов или отсутствие данных");
  }
  if (outliers.length > 0) {
    conditions.push(`обнаружено подозрительных значений: ${outliers.length} (IQR/MAD)`);
    requiredActions.push("проверить выбросы по первоисточнику; не удалять и не исправлять автоматически");
  }
  if (slices.length > 1) {
    if (independence === "unknown") {
      conditions.push(`метрика представлена в ${slices.length} срезах (${slices.join(", ")}) с недоказанной независимостью`);
      requiredActions.push("выбрать канонический срез и запретить суммирование значений между срезами");
    } else if (independence === "same_population") {
      conditions.push("срезы содержат одно и то же население — суммирование запрещено");
      requiredActions.push("использовать один срез как источник показателя");
    }
  }

  const forecastReadiness: ReadinessRow["forecast_readiness"] =
    blockers.length > 0 ? "BLOCKED" : conditions.length > 0 ? "CONDITIONAL" : "READY";

  const reasons = [...blockers, ...conditions];
  if (reasons.length === 0) reasons.push("технических и семантических ограничений не обнаружено");

  return {
    metric: profile.metric,
    metric_kind: profile.metric_kind,
    slices: [...slices].sort((a, b) => a - b),
    observations: profile.observations,
    coverage: profile.fill_rate,
    missing: profile.missing_days,
    nulls: profile.stats.nulls,
    zeros: profile.stats.zeros,
    outliers: outliers.length,
    semantic_status: semanticStatus,
    forecast_readiness: forecastReadiness,
    reasons,
    required_actions: [...new Set(requiredActions)],
  };
}
