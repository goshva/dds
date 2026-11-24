# UI-3 — план реализации (история и аналитика)

**Дата:** 2026-11-24 · **Статус:** план (UI-3.0) · **База:** HEAD `505f70a…`, ветка `main`

---

## 1. Состояние frontend-архитектуры (FACT)

- Vite (`vite.config.ts`, root `src/web`, host `127.0.0.1:5173`, proxy `/api` → `127.0.0.1:8787`).
- Рендеринг — типизированные функции, возвращающие `TrustedHtml` (`src/web/components/*`), дизайн-система UI-1/1.1/1.2.
- Точка входа `src/web/main.ts`: единый shell, загрузка через `src/web/api/client.ts` (`validateResult`, timeout 8000 мс).
- Страниц как модулей нет: `main.ts` рендерит один экран (overview + history + shadow-секции).

## 2. Используемые API endpoints (FACT)

| Endpoint | Использование в UI-3 |
|---|---|
| `GET /api/v1/history` | ряд фактов, KPI-агрегаты, график, таблица |
| `GET /api/v1/history/coverage` | полнота, пропуски, интервалы, fill ratio |
| `GET /api/v1/overview` | период, последнее значение, provenance/freshness, семантика |
| `GET /api/health` | индикатор доступности API |

Новые endpoints **не требуются**: расширяются существующие read-model (`summary` в history, пропуски и fill ratio в coverage).

## 3. Доступные поля и структура данных (FACT)

- `history`: `points[{date, value}]`, `from`, `to`, `totalPoints`, `returnedPoints`, `semantics: "PROVISIONAL"`.
- `coverage`: `firstDate`, `lastDate`, `days`, `gaps`, `duplicateDates`, `nullValues`, `nullPolicy`, `completeness`.
- `overview.provenance`: `fileChecksum`, `normalizedChecksum`, `manifestDatasetChecksum`, `manifestStatus`, `freshness`.
- Фактические данные: 906 дней, `2024-06-01 … 2026-11-23`, сумма 1 583 459, среднее 1 748, max 2 744, min 637, нулевых значений 0, slice `20624`.

## 4. Показатели без дополнительных расчётов (FACT)

- период, последняя дата и значение, статус семантики, `freshness`, checksums, статус источника;
- список точек ряда, количество дней, пропуски (`gaps`), дубликаты.

## 5. Показатели, требующие backend read-model (FACT/INFERENCE)

- `summary`: сумма, среднее, max, min, календарные дни, дни с наблюдениями, отсутствующие дни — расчёт по **доступным** значениям (backend, без frontend-арифметики бизнес-показателей);
- `coverage.missingDates`, `gapIntervals`, `maxGapLength`, `fillRatio` + формула — для экрана качества.

## 6. Показатели, которые показывать нельзя (FACT)

- аномалии по датам: связь «305 outlier flags ↔ конкретные даты» не подтверждена источником → список аномальных дат **не показывается** (`NOT_IMPLEMENTED`);
- прогнозы, p10/p90, сценарии, финансовые эффекты — вне UI-3;
- данные других slices (20403/20404/20405/20623) и chart 20209 — не используются.

## 7. Структура страниц и компонентов (INFERENCE)

```text
src/web/pages/history.ts        → «История заказов»: KPI, фильтры, график, таблица
src/web/pages/data-quality.ts   → «Качество данных»: полнота, пропуски, ограничения
src/web/pages/provenance.ts     → «Происхождение данных»: источник, slice, checksum, freshness, семантика
src/web/main.ts                 → shell + навигация (hash: #history/#quality/#provenance/#overview)
```

Компоненты: существующие `kpiGrid`, `chartCard`, `dataTable`, `completenessCalendar`, `provenanceDrawer`, `statusBadge`, `emptyState`/`loadingState`/`errorState`, `pageHeader`. Новых компонентов не требуется.

## 8. План тестирования (INFERENCE)

- backend: `summary` (сумма/среднее по доступным значениям), пустой диапазон, граничные даты, `from > to`, coverage `missingDates`/`gapIntervals`/`fillRatio`, отсутствие смешивания slices, отсутствие PII;
- frontend: KPI-форматирование, `[Н/Д]` вместо нуля, разрыв линии при `null`, XSS-экранирование значений, состояния loading/empty/error/stale;
- регрессия: все существующие наборы (`tests/web`, `tests/server`, `tests/forecasting`, `tests/tools`).

## 9. Риски и ограничения

1. Браузерная визуальная проверка недоступна → адаптивность `NOT_VERIFIED` (UI-7).
2. SQLite не подключается (по условию UI-3); история — только canonical CSV.
3. Семантика `delivered_orders_daily` остаётся `PROVISIONAL`.
4. `summary` считается по доступным значениям; среднее по неполному периоду помечается предупреждением.
5. Аномалии: только пояснение, без списка дат.
6. Производительность: `limit ≤ 1000` (906 дней покрываются одним запросом), без кэша.

## 10. Файлы, которые предполагается изменить

| Файл | Действие |
|---|---|
| `src/server/services/read-models.ts` | расширение `historyModel.summary`, `coverageModel` (пропуски, fill ratio) |
| `src/web/pages/history.ts` | новый |
| `src/web/pages/data-quality.ts` | новый |
| `src/web/pages/provenance.ts` | новый |
| `src/web/main.ts` | навигация и подключение страниц |
| `src/web/api/client.ts` | типы DTO (без изменения логики) |
| `tests/server/ui-3.test.ts` | новый |
| `tests/web/ui-3.test.ts` | новый |
| `docs/ui/ui-3-implementation.md`, `docs/ui/ui-3-final-audit.md` | новые |
| `docs/ui/api-contract.md` | дополнение (расширенные поля) |

Не изменяются: canonical CSV, SQLite, shadow JSONL, manifest, прогнозное ядро, baseline, Variant B.

## 11. Расхождения документации и кода

| Утверждение в документации | Фактический код |
|---|---|
| `api-gap-analysis.md`: `/api/v1/history/coverage` — «NOT_IMPLEMENTED» | **реализован** (UI-2) |
| `ui-2-final-audit.md`: «страниц как модулей нет» | соответствует; UI-3 добавляет страницы |

Расхождения зафиксированы, реализация UI-2 не переписывается.