/**
 * Stage 3.2.1 — реестр бизнес-семантики метрик.
 *
 * ЕДИНЫЙ источник определений метрик для Forecast Engine. Дублирование описаний
 * в других файлах запрещено: отчёты генерируются из этого реестра.
 *
 * Источники подтверждения (evidence):
 *  - `catalog` — каталог метаданных Superset: `reports/phase-01-6-2/dataset_metrics.csv`
 *    (поля `verbose_name`, `expression`, `aggregation`) для датасета 3035;
 *  - `stage-3.1` — профилирование данных (`reports/forecasting/stage-3.1/`);
 *  - `data` — прямая проверка значений в `daily_metrics` (read-only SQL).
 *
 * ВАЖНО: каталог метаданных — это документация источника, но НЕ письменное
 * бизнес-согласование. Поэтому ни одна метрика не получает статус `confirmed`
 * без внешнего подтверждения; для целевой метрики используется `conditional`.
 */

/** Уровень подтверждённости определения. */
export type SemanticConfidence = "confirmed" | "conditional" | "unconfirmed";

/** Правило агрегации значений. */
export interface AggregationRule {
  /** Как складывать строки внутри одного дня (по измерениям). */
  within_day: string;
  /** Как складывать значения между днями. */
  across_days: string;
  /** Допустимо ли суммирование строк без дополнительных доказательств. */
  requires_additivity_proof: boolean;
}

export interface MetricDefinition {
  metric_key: string;
  business_name: string;
  description: string;
  metric_kind: "additive" | "ratio";
  unit: string | null;
  numerator: string | null;
  denominator: string | null;
  aggregation_rule: AggregationRule;
  source_slices: number[];
  store_scope: string;
  temporal_grain: string;
  confidence: SemanticConfidence;
  /** Метрика запрещена к использованию в аналитическом слое (и почему). */
  blocked: boolean;
  blocked_reason: string | null;
  restrictions: string[];
  evidence: string[];
  /** Допустима ли метрика как целевой показатель дневного ряда на этом этапе. */
  target_eligible: boolean;
}

/**
 * Реестр метрик магазина 7745 (датасет 3035).
 * Порядок записей фиксирован для детерминированности отчётов.
 */
export const METRIC_REGISTRY: readonly MetricDefinition[] = [
  {
    metric_key: "qty_orders_delivered",
    business_name: "Доставленные заказы (весь даркстор)",
    description:
      "Количество уникальных заказов в статусе «Успешно завершен». Выражение каталога: " +
      "COUNT(DISTINCT IF(status_name = 'Успешно завершен', COALESCE(id_general, id_order), NULL)). " +
      "Считаются уникальные идентификаторы заказов, а не операции доставки. Дата отнесения — дата доставки заказа " +
      "(гранулярность запросов задаётся измерением date_supply).",
    metric_kind: "additive",
    unit: "заказы (шт.)",
    numerator: null,
    denominator: null,
    aggregation_rule: {
      within_day: "сумма строк по измерениям допустима только при доказанной взаимоисключаемости категорий",
      across_days: "сумма по дням — итог за период",
      requires_additivity_proof: true,
    },
    source_slices: [20403, 20404, 20405, 20623, 20624],
    store_scope: "даркстор 7745 целиком (в срезе 20624 одна строка на дату)",
    temporal_grain: "календарный день (Europe/Moscow)",
    confidence: "conditional",
    blocked: false,
    blocked_reason: null,
    restrictions: [
      "письменного бизнес-согласования определения нет: подтверждение только каталогом метаданных и данными",
      "причины отмен и корректировок заказов в наборе отсутствуют",
      "дата отнесения заказа (доставка/создание/сборка) подтверждена только формулой каталога",
    ],
    evidence: ["catalog: " + "COUNT(DISTINCT IF(status_name = 'Успешно завершен', COALESCE(id_general, id_order), NULL))", "data: сумма по 41 дню = 62 739, совпадает во всех пяти срезах", "stage-3.1: 915 наблюдений, 0 NULL, 0 дублей, покрытие 41/41"],
    target_eligible: true,
  },
  {
    metric_key: "qty_orders_declined",
    business_name: "Отменённые и невыполненные заказы",
    description:
      "COUNT(DISTINCT IF(status_name IN ('Отменен', 'Не выполнен', 'Вернулся на полки'), COALESCE(id_general, id_order), NULL)). " +
      "Причины отмен в наборе отсутствуют.",
    metric_kind: "additive",
    unit: "заказы (шт.)",
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "сумма строк по измерениям", across_days: "сумма по дням", requires_additivity_proof: true },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "conditional",
    blocked: false,
    blocked_reason: null,
    restrictions: ["нет разбивки по причинам отмен", "аддитивность разреза по сервисам не подтверждена письменно"],
    evidence: ["catalog: COUNT(DISTINCT IF(status_name IN ('Отменен','Не выполнен','Вернулся на полки'), ...))", "stage-3.1: 517 наблюдений, 190 нулей"],
    target_eligible: false,
  },
  {
    metric_key: "qty_orders_in_work",
    business_name: "Заказы в работе",
    description: "COUNT(DISTINCT IF(status_name NOT IN ('Отменен','Не выполнен','Вернулся на полки','Успешно завершен'), ...)) — заказы в промежуточных статусах.",
    metric_kind: "additive",
    unit: "заказы (шт.)",
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "сумма строк по измерениям", across_days: "не агрегируется", requires_additivity_proof: true },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: true,
    blocked_reason: "в текущем наборе все 517 значений равны нулю (σ = 0): показатель неинформативен, источник требует проверки",
    restrictions: ["не использовать в аналитике до выяснения причины нулевых значений"],
    evidence: ["data: 517 наблюдений, все значения 0", "stage-3.1: статус BLOCKED (постоянный ряд)"],
    target_eligible: false,
  },
  {
    metric_key: "qty_not_in_slot_all",
    business_name: "Заказы вне слота",
    description:
      "COUNT(DISTINCT IF(status_name = 'Успешно завершен' AND IF(gettype IN (0,6), date_collected, date_delivered) NOT BETWEEN date_supply AND date_supply_until, ...)) — " +
      "доставленные заказы, фактическое время которых вышло за интервал слота.",
    metric_kind: "additive",
    unit: "заказы (шт.)",
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "сумма строк по измерениям", across_days: "сумма по дням", requires_additivity_proof: true },
    source_slices: [20403, 20404, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "conditional",
    blocked: false,
    blocked_reason: null,
    restrictions: ["аддитивность разреза по сервисам не подтверждена письменно"],
    evidence: ["catalog: выражение метрики", "stage-3.1: 716 наблюдений, 157 нулей"],
    target_eligible: false,
  },
  {
    metric_key: "share_not_in_slot_all",
    business_name: "Доля доставок вне слота",
    description: "Отношение заказов вне слота к доставленным заказам: numerator / qty_orders_delivered.",
    metric_kind: "ratio",
    unit: "доля (0..1)",
    numerator: "qty_not_in_slot_all",
    denominator: "qty_orders_delivered",
    aggregation_rule: {
      within_day: "НЕ суммировать; агрегированное отношение = sum(числитель)/sum(знаменатель)",
      across_days: "НЕ суммировать; агрегированное отношение = sum(числитель)/sum(знаменатель)",
      requires_additivity_proof: false,
    },
    source_slices: [20403, 20404, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "conditional",
    blocked: false,
    blocked_reason: null,
    restrictions: ["простое среднее дневных долей не является агрегированным отношением"],
    evidence: [
      "catalog: отношение COUNT(... вне слота ...) / NULLIF(COUNT(... Успешно завершен ...), 0)",
      "data: отношение восстанавливается на 199/199 и 318/318 наблюдений в пределах округления 1e-6 (макс. отклонение 5e-7)",
    ],
    target_eligible: false,
  },
  {
    metric_key: "share_not_in_slot_above_all",
    business_name: "Доля просроченных по времени доставок",
    description: "Отношение заказов, доставленных позже date_supply_until, к доставленным заказам.",
    metric_kind: "ratio",
    unit: "доля (0..1)",
    numerator: null,
    denominator: "qty_orders_delivered",
    aggregation_rule: {
      within_day: "НЕ суммировать; требуется агрегированное отношение",
      across_days: "НЕ суммировать; требуется агрегированное отношение",
      requires_additivity_proof: false,
    },
    source_slices: [20403, 20404, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: false,
    blocked_reason: null,
    restrictions: ["метрика-числитель (число просроченных заказов) в наборе отсутствует — агрегировать нельзя"],
    evidence: ["catalog: числитель COUNT(... > date_supply_until ...)", "data: числителя в daily_metrics нет"],
    target_eligible: false,
  },
  {
    metric_key: "share_not_in_slot_under_all",
    business_name: "Доля преждевременных доставок",
    description: "Отношение заказов, доставленных раньше date_supply, к доставленным заказам.",
    metric_kind: "ratio",
    unit: "доля (0..1)",
    numerator: null,
    denominator: "qty_orders_delivered",
    aggregation_rule: {
      within_day: "НЕ суммировать; требуется агрегированное отношение",
      across_days: "НЕ суммировать; требуется агрегированное отношение",
      requires_additivity_proof: false,
    },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: false,
    blocked_reason: null,
    restrictions: ["метрика-числитель (число преждевременных заказов) в наборе отсутствует"],
    evidence: ["catalog: числитель COUNT(... < date_supply ...)", "data: числителя в daily_metrics нет"],
    target_eligible: false,
  },
  {
    metric_key: "share_delivered_taxi",
    business_name: "Доля доставок такси",
    description: "Отношение заказов, доставленных такси (delivery_type_group = 'Такси'), к доставленным заказам.",
    metric_kind: "ratio",
    unit: "доля (0..1)",
    numerator: null,
    denominator: "qty_orders_delivered",
    aggregation_rule: {
      within_day: "НЕ суммировать; требуется агрегированное отношение",
      across_days: "НЕ суммировать; требуется агрегированное отношение",
      requires_additivity_proof: false,
    },
    source_slices: [20403, 20404, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: false,
    blocked_reason: null,
    restrictions: ["количество доставок такси в наборе отсутствует — агрегировать нельзя"],
    evidence: ["catalog: числитель COUNT(DISTINCT IF(... delivery_type_group = 'Такси' ...))", "data: числителя в daily_metrics нет"],
    target_eligible: false,
  },
  {
    metric_key: "share_orders_delivered",
    business_name: "Доля заказов даркстора от общего количества",
    description: "Отношение доставленных заказов даркстора к общему количеству заказов УЗ (feature_tt = 'ДаркСтор').",
    metric_kind: "ratio",
    unit: "доля (0..1)",
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "не использовать", across_days: "не использовать", requires_additivity_proof: false },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745 (знаменатель — вся сеть УЗ)",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: true,
    blocked_reason: "в текущем наборе 517 значений равны 1.0 (знаменатель совпадает с числителем), знаменатель «все заказы УЗ» в наборе отсутствует",
    restrictions: ["не использовать в аналитике"],
    evidence: ["data: 517 наблюдений, все значения 1.0", "stage-3.1: статус BLOCKED (постоянный ряд и неподтверждённый знаменатель)"],
    target_eligible: false,
  },
  {
    metric_key: "sum_without_bonuses",
    business_name: "Сумма заказов (по выражению: sum_paid без вычета)",
    description:
      "SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0), NULL)). Каталог описывает как «Сумма (ДС + баллы)». " +
      "Название метрики и описание противоречат друг другу.",
    metric_kind: "additive",
    unit: null,
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "сумма строк по измерениям", across_days: "сумма по дням", requires_additivity_proof: true },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: false,
    blocked_reason: null,
    restrictions: ["единица измерения (рубли или копейки) не подтверждена", "имя метрики противоречит каталожному описанию", "не использовать как денежный факт до согласования"],
    evidence: ["catalog: SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0), NULL)), verbose_name = 'Сумма (ДС + баллы) (УЗ)'"],
    target_eligible: false,
  },
  {
    metric_key: "sum_with_bonuses",
    business_name: "Сумма заказов за вычетом скидки (по выражению)",
    description:
      "SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0) - COALESCE(sum_paid_disc, 0), NULL)). Каталог описывает как «Сумма (только ДС)». " +
      "Название метрики и описание противоречат друг другу.",
    metric_kind: "additive",
    unit: null,
    numerator: null,
    denominator: null,
    aggregation_rule: { within_day: "сумма строк по измерениям", across_days: "сумма по дням", requires_additivity_proof: true },
    source_slices: [20403, 20405],
    store_scope: "даркстор 7745",
    temporal_grain: "календарный день",
    confidence: "unconfirmed",
    blocked: false,
    blocked_reason: null,
    restrictions: ["единица измерения не подтверждена", "имя метрики противоречит каталожному описанию", "не использовать как денежный факт до согласования"],
    evidence: ["catalog: SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid,0) - COALESCE(sum_paid_disc,0), NULL)), verbose_name = 'Сумма (только ДС) (УЗ)'"],
    target_eligible: false,
  },
];

/** Метрики, запрещённые к использованию в аналитическом слое. */
export const BLOCKED_METRICS: readonly string[] = METRIC_REGISTRY.filter((metric) => metric.blocked).map((metric) => metric.metric_key);

export function metricByKey(metricKey: string): MetricDefinition | null {
  return METRIC_REGISTRY.find((metric) => metric.metric_key === metricKey) ?? null;
}

/** Разрешает метрику для аналитики: блокированные метрики использовать нельзя. */
export function assertMetricUsable(metricKey: string): MetricDefinition {
  const metric = metricByKey(metricKey);
  if (!metric) throw new Error(`метрика «${metricKey}» отсутствует в реестре семантики`);
  if (metric.blocked) throw new Error(`метрика «${metricKey}» заблокирована: ${metric.blocked_reason}`);
  return metric;
}

/** Проверка целостности реестра: дубликатов ключей быть не должно. */
export function validateRegistry(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const metric of METRIC_REGISTRY) {
    if (seen.has(metric.metric_key)) errors.push(`дублирующийся metric_key: ${metric.metric_key}`);
    seen.add(metric.metric_key);
    if (metric.metric_kind === "ratio" && !/не суммировать|не использовать/i.test(metric.aggregation_rule.within_day)) {
      errors.push(`ratio-метрика ${metric.metric_key} должна явно запрещать суммирование`);
    }
    if (metric.confidence === "confirmed" && !metric.evidence.some((entry) => entry.startsWith("business:"))) {
      errors.push(`метрика ${metric.metric_key} помечена confirmed без письменного бизнес-подтверждения`);
    }
    if (metric.blocked && !metric.blocked_reason) errors.push(`метрика ${metric.metric_key} заблокирована без причины`);
  }
  return { ok: errors.length === 0, errors };
}

/** Целевая метрика текущего этапа. */
export const TARGET_METRIC_KEY = "qty_orders_delivered";
export const TARGET_METRIC_BUSINESS_NAME = "delivered_orders_daily";
