/**
 * Stage 3.3.3 — бизнес-определение целевой метрики.
 *
 * ВАЖНО: подтверждение НЕ является письменным бизнес-согласованием.
 * Доступные источники (каталог метаданных Superset, фактический запрос чарта, данные)
 * позволяют технически согласовать определение, но не заменяют владельца процесса.
 * Поэтому статус — PROVISIONAL, а `confirmed_by` / `confirmed_at` остаются null.
 */

export type ConfirmationStatus = "CONFIRMED" | "PROVISIONAL" | "UNCONFIRMED" | "BLOCKED";

export interface BusinessQuestion {
  question: string;
  answer: string;
  status: "FACT" | "INFERENCE" | "ASSUMPTION" | "UNCONFIRMED";
  evidence: string;
}

export interface BusinessDefinition {
  metric: string;
  business_name: string;
  business_definition: string;
  unit: string;
  aggregation_rule: string;
  date_attribution_rule: string;
  timezone: string;
  source: string;
  source_slice: number;
  source_chart_id: number;
  source_query_facts: {
    metrics: string[];
    granularity: string;
    time_grain: string;
    filters: string[];
    row_limit: number | null;
    groupby: string[];
  };
  known_limitations: string[];
  confirmation_status: ConfirmationStatus;
  confirmed_by: null;
  confirmed_at: null;
  questions: BusinessQuestion[];
  required_confirmations: string[];
}

export const TARGET_BUSINESS_DEFINITION: BusinessDefinition = {
  metric: "qty_orders_delivered",
  business_name: "delivered_orders_daily",
  business_definition:
    "Количество доставленных заказов за календарный день по всему даркстору 7745. " +
    "Техническая формула источника: COUNT(DISTINCT IF(status_name = 'Успешно завершен', COALESCE(id_general, id_order), NULL)) — " +
    "считаются уникальные идентификаторы заказов, а не операции доставки.",
  unit: "заказы (шт.)",
  aggregation_rule:
    "Аддитивная метрика: значение дня берётся из среза с одной строкой на дату (20624), суммирование между срезами запрещено; " +
    "итог периода — сумма дневных значений.",
  date_attribution_rule:
    "Заказ относится к дню, заданному временным измерением запроса (гранулярность date_supply, P1D). " +
    "Точное правило (дата доставки, сборки или последнего изменения статуса) из доступных источников однозначно не следует.",
  timezone: "Europe/Moscow",
  source: "Superset, датасет 3035 (darkstore_time_click), график 20624, HAR-тело 103",
  source_slice: 20624,
  source_chart_id: 20624,
  source_query_facts: {
    metrics: ["qty_orders_delivered"],
    granularity: "date_supply",
    time_grain: "P1D",
    filters: [
      "shopno IN ('7745')",
      "shopno NOT IN ('99888', '8519')",
      "feature_tt IN ('ДаркСтор')",
      "delivery_type_group IN ('Курьеры', 'Такси')",
    ],
    row_limit: 10000,
    groupby: ["name_tt"],
  },
  known_limitations: [
    "письменного подтверждения от бизнес-владельца нет",
    "причины отмен и корректировок заказов в наборе отсутствуют",
    "правило пересчёта исторических значений задним числом не документировано",
    "отсутствует почасовая детализация",
    "единицы измерения денежных метрик не подтверждены (к целевой метрике не относятся)",
  ],
  confirmation_status: "PROVISIONAL",
  confirmed_by: null,
  confirmed_at: null,
  questions: [
    {
      question: "Что считается доставленным заказом?",
      answer: "Заказ со статусом «Успешно завершен»; считается уникальный идентификатор (COALESCE(id_general, id_order))",
      status: "FACT",
      evidence: "каталог метаданных Superset: выражение метрики qty_orders_delivered",
    },
    {
      question: "Какая дата используется для атрибуции?",
      answer: "Временное измерение запроса — date_supply с гранулярностью P1D; точный бизнес-смысл поля (доставка/сборка) не подтверждён",
      status: "UNCONFIRMED",
      evidence: "фактический запрос выгрузки: granularity=date_supply, extras.time_grain_sqla=P1D",
    },
    {
      question: "Когда заказ попадает в показатель?",
      answer: "В момент, когда заказ имеет статус «Успешно завершен» и его дата попадает в день агрегации",
      status: "INFERENCE",
      evidence: "выражение метрики + совпадение дневных сумм между пятью срезами",
    },
    {
      question: "Учитываются ли отмены?",
      answer: "Нет: отменённые заказы попадают в отдельную метрику qty_orders_declined",
      status: "FACT",
      evidence: "выражения qty_orders_delivered и qty_orders_declined из каталога",
    },
    {
      question: "Возможны ли корректировки задним числом?",
      answer: "Не подтверждено; при повторной выгрузке значения прежних дней совпали (41 из 41), что косвенно говорит об отсутствии пересчёта за проверенный период",
      status: "INFERENCE",
      evidence: "сверка Stage 3.3.1: IDENTICAL=41, VALUE_CHANGED=0",
    },
    {
      question: "Возможны ли повторные доставки одного заказа?",
      answer: "Не подтверждено; используется COUNT(DISTINCT ...), поэтому повторные операции внутри дня не удваивают значение",
      status: "INFERENCE",
      evidence: "COUNT(DISTINCT ...) в выражении метрики",
    },
    {
      question: "Как учитываются возвраты?",
      answer: "Не подтверждено; возврат «на полки» учитывается в qty_orders_declined, а не в доставленных",
      status: "ASSUMPTION",
      evidence: "состав статусов в выражении qty_orders_declined",
    },
    {
      question: "Как обрабатывается перенос между днями?",
      answer: "Не подтверждено: правило зависит от смысла date_supply",
      status: "UNCONFIRMED",
      evidence: "нет документации по полю date_supply",
    },
    {
      question: "В какой timezone ведётся учёт?",
      answer: "Europe/Moscow (заявлено в задании; в выгрузках время не хранится, только дата)",
      status: "ASSUMPTION",
      evidence: "параметры задания и период выгрузок",
    },
    {
      question: "Что означает одна единица?",
      answer: "Один уникальный заказ (не позиция и не операция)",
      status: "FACT",
      evidence: "COUNT(DISTINCT COALESCE(id_general, id_order))",
    },
  ],
  required_confirmations: [
    "письменно подтвердить определение «доставленный заказ» и правило атрибуции по дате (date_supply)",
    "подтвердить отсутствие пересчёта истории задним числом и регламент таких пересчётов",
    "подтвердить timezone учёта",
    "подтвердить, что feature_tt IN ('ДаркСтор') и delivery_type_group IN ('Курьеры','Такси') — полный и корректный фильтр магазина",
  ],
};

/** Gate перед использованием результатов: без подтверждённой семантики результаты помечаются provisional. */
export function semanticsGate(definition: BusinessDefinition = TARGET_BUSINESS_DEFINITION): {
  status: ConfirmationStatus;
  allowTechnicalComparison: boolean;
  provisionalLabel: boolean;
  reasons: string[];
} {
  const provisional = definition.confirmation_status !== "CONFIRMED";
  return {
    status: definition.confirmation_status,
    allowTechnicalComparison: definition.confirmation_status !== "BLOCKED",
    provisionalLabel: provisional,
    reasons: provisional
      ? [
          "семантика подтверждена техническими источниками, но не письменным согласованием бизнес-владельца",
          "результаты baseline-сравнения помечаются как provisional и не могут использоваться для бизнес-обещаний",
        ]
      : [],
  };
}
