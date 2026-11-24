# Этап 3 — Контракт метрик (резюме)

**Документ:** [metrics-contract.md](../../../docs/forecasting/contracts/metrics-contract.md) · **Версия:** `metrics/v1`

## Формулы

| Метрика | Формула | Единица | Роль |
|---|---|---|---|
| MAE | `mean(|prediction − actual|)` | заказы | основная метрика выбора |
| RMSE | `sqrt(mean((prediction − actual)²))` | заказы | дополнительная (штрафует крупные ошибки) |
| WAPE | `sum(|prediction − actual|) / sum(|actual|) × 100` | % | дополнительная |
| Bias | `mean(prediction − actual)` | заказы | направление смещения |
| median / max abs error | медиана и максимум `|error|` | заказы | устойчивость и худший случай |

## Граничные случаи

| Случай | Правило |
|---|---|
| `sum(|actual|) = 0` | WAPE = `NOT_AVAILABLE` (`wape_status = undefined_zero_actuals`), деление не выполняется, ноль не подставляется |
| пустая выборка | `NOT_AVAILABLE` (`wape_status = no_data`) |
| `NULL` в прогнозе или факте | наблюдение исключается; замены нулём нет |
| `NaN` / `Infinity` | отклоняются (`ensureFinite`, `validateMetricSet`); эксперимент помечается проблемным |
| выбросы | автоматически не удаляются |
| округление | прогнозы до расчёта не округляются; округляется только представление (4 знака для метрик, 2 — для процентов) |

## Интерпретация

- `Bias < 0` — систематическое занижение; `Bias > 0` — завышение; `Bias` не является мерой абсолютной ошибки.
- Основная метрика выбора — MAE; выбор только по одной метрике при существенном ухудшении остальных не допускается.
- Произвольные пороги ухудшения не вводятся.

## Обязательные величины сравнения

```text
margin_to_runner_up = MAE_best / MAE_second_best − 1
margin_vs_baseline  = (MAE_candidate − MAE_baseline) / MAE_baseline
absolute_mae_difference = MAE_candidate − MAE_baseline
```

При `MAE_baseline = 0` относительное изменение — `NOT_AVAILABLE`.

## Связь с реализацией

- `src/forecasting/analytics/backtesting/metrics.ts` (`computeMetrics`, `recomputeFromRecords`, `validateMetricSet`); правило двойного расчёта — `verifyMetricsAgainstRecords` в `rolling-origin.ts`.
