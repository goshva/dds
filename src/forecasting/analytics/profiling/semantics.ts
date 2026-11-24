/**
 * Реестр семантики метрик и формул ratio-показателей.
 *
 * Источник определений — локальный каталог метаданных Superset
 * (`reports/phase-01-6-2/dataset_metrics.csv`, датасет 3035): поля `verbose_name`,
 * `expression`, `aggregation`. Это документальное подтверждение из источника,
 * а не вывод из названия метрики.
 *
 * Если определения в каталоге нет — статус `unknown`, и метрика не может считаться READY.
 */

import { readFileSync } from "node:fs";

import { parseCsv } from "../../reconciliation/normalizer";
import type { MetricSemantics, SemanticStatus } from "./types";

export const CATALOG_PATH = "reports/phase-01-6-2/dataset_metrics.csv";
export const CATALOG_DATASET_ID = "3035";

/** Загружает определения метрик датасета из каталога метаданных. */
export function loadSemanticRegistry(catalogPath = CATALOG_PATH, datasetId = CATALOG_DATASET_ID): MetricSemantics[] {
  let csv: string;
  try {
    csv = readFileSync(catalogPath, "utf8");
  } catch {
    return [];
  }
  const { header, rows } = parseCsv(csv);
  const index = (name: string) => header.indexOf(name);
  const datasetIndex = index("dataset_id");
  const metricIndex = index("metric_name");
  const verboseIndex = index("verbose_name");
  const expressionIndex = index("expression");
  const aggregationIndex = index("aggregation");
  if (datasetIndex < 0 || metricIndex < 0) return [];

  const registry: MetricSemantics[] = [];
  for (const row of rows) {
    if ((row[datasetIndex] ?? "").trim() !== datasetId) continue;
    const metric = (row[metricIndex] ?? "").trim();
    if (!metric) continue;
    const verbose = (row[verboseIndex] ?? "").trim() || null;
    const expression = (row[expressionIndex] ?? "").trim() || null;
    const aggregation = (row[aggregationIndex] ?? "").trim() || null;
    const status: SemanticStatus = verbose && expression ? "known" : verbose || expression ? "partial" : "unknown";
    registry.push({ metric, verbose_name: verbose, expression, aggregation, source: `${catalogPath}#${datasetId}`, status });
  }

  return registry.sort((a, b) => a.metric.localeCompare(b.metric));
}

export interface RatioFormula {
  metric: string;
  numerator_metric: string | null;
  denominator_metric: string | null;
  /** Почему числитель/знаменатель неизвестны, если они не представлены в наборе. */
  note: string;
}

/**
 * Соответствие ratio-метрик и метрик-числителей/знаменателей.
 *
 * Основание — выражения из каталога: у всех `share_not_in_slot_*` и `share_delivered_taxi`
 * знаменатель один и тот же (`COUNT(DISTINCT IF(status_name = 'Успешно завершен', ...))`
 * — это в точности метрика `qty_orders_delivered`). Числитель совпадает с существующей
 * метрикой только у `share_not_in_slot_all` (её числитель — `qty_not_in_slot_all`).
 */
export const RATIO_FORMULA_MAP: RatioFormula[] = [
  {
    metric: "share_not_in_slot_all",
    numerator_metric: "qty_not_in_slot_all",
    denominator_metric: "qty_orders_delivered",
    note: "числитель и знаменатель представлены в наборе — отношение можно проверить",
  },
  {
    metric: "share_not_in_slot_above_all",
    numerator_metric: null,
    denominator_metric: "qty_orders_delivered",
    note: "метрика-числитель (просроченные) в наборе отсутствует — восстановление отношения невозможно",
  },
  {
    metric: "share_not_in_slot_under_all",
    numerator_metric: null,
    denominator_metric: "qty_orders_delivered",
    note: "метрика-числитель (преждевременные) в наборе отсутствует — восстановление отношения невозможно",
  },
  {
    metric: "share_delivered_taxi",
    numerator_metric: null,
    denominator_metric: "qty_orders_delivered",
    note: "количество доставок такси в наборе отсутствует — восстановление отношения невозможно",
  },
  {
    metric: "share_orders_delivered",
    numerator_metric: null,
    denominator_metric: null,
    note: "знаменатель — все заказы УЗ (не qty_orders_delivered); в наборе не представлен",
  },
];

export function ratioFormulaFor(metric: string): RatioFormula | null {
  return RATIO_FORMULA_MAP.find((entry) => entry.metric === metric) ?? null;
}
