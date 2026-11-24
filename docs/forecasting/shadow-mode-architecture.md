# Архитектура теневого режима (Stage 3.4.8)

**Статус:** реализовано, изолированный контур · **Версия:** `shadow-mode/v1` · **Дата:** 2026-11-24
**Production baseline:** `rolling_7_day_mean` — не изменялся.

---

## 1. Назначение

Параллельный расчёт двух прогнозов — production baseline и Variant B — с сохранением
неизменяемых снапшотов и последующим независимым сопоставлением с фактом.
Теневой режим **не влияет** на операционные решения и не подключён к production pipeline.

## 2. Компоненты

| Компонент | Файл | Ответственность |
|---|---|---|
| хранилище | `src/forecasting/shadow/store.ts` | append-only JSONL, детерминированный `snapshot_id`, no-op / CONFLICT, manifest |
| вычисление | `src/forecasting/shadow/runner.ts` | baseline (`rolling_7_day_mean`) и Variant B независимо, h=1 и h=3, режимы replay/shadow |
| сопоставление | `src/forecasting/shadow/pipeline.ts` | reconcile (только чтение снапшотов), метрики, мониторинг |
| CLI | `src/forecasting/cli/shadow.ts` | `--mode replay|shadow|reconcile|monitor|all` |
| публичный API | `src/forecasting/shadow/index.ts` | экспорт типов и функций |

## 3. Потоки данных

```text
canonical CSV (единственный источник)
        │
        ▼
[runner] ── baseline = rolling_7_day_mean (без изменений формулы)
        └─ Variant B = calculator.calculateForVariant("B", alpha=1, limit=10%)
        │
        ▼
[store] append-only JSONL: forecasts.jsonl (неизменяемые снапшоты)
        │
        ▼
[pipeline] reconcile: читает снапшоты, пишет reconciliations.jsonl
        │
        ▼
[pipeline] monitor: shadow-monitor.json (MAE/WAPE/Bias, разницы, fallback, pending)
```

## 4. Режимы

| Режим | Что делает | Факт |
|---|---|---|
| `replay` | историческое воспроизведение по всем origin, где target попадает в историю | подтверждён |
| `shadow` | прогноз от последней доступной даты на будущие даты | ещё не подтверждён |
| `reconcile` | сопоставление сохранённых снапшотов с фактом | только подтверждённые даты |
| `monitor` | сводка качества и служебных счётчиков | — |

Replay-результаты **не являются** результатами реального shadow-наблюдения и публикуются раздельно.

## 5. Разделение ответственности

| Слой | Что делает | Чего не делает |
|---|---|---|
| вычисление | считает прогнозы на одинаковых парах (origin, target) | не пишет файлы |
| сохранение | append-only, идемпотентность, CONFLICT | не пересчитывает прогнозы |
| факт | только canonical CSV, только подтверждённые даты | не подставляет нули, не интерполирует |
| оценка | MAE/WAPE/Bias, разницы, счётчики | не изменяет прогнозы |

## 6. Fail-closed

| Условие | Поведение |
|---|---|
| неконечный baseline | прогноз не сохраняется как значение, ошибка `NON_FINITE_BASELINE` |
| future data (`target ≤ origin`) | запись пропускается при reconcile |
| отсутствующий факт | ошибка `MISSING_ACTUAL`, значение не подставляется |
| тот же `snapshot_id` и другое содержимое | `SNAPSHOT_CONFLICT`, остановка без перезаписи |
| checksum canonical CSV не совпал | CLI завершается с кодом 2 |

## 7. Изоляция

- Модуль `shadow/` не импортируется ни одним production-файлом.
- `package.json` не изменялся; запуск — прямой `bun src/forecasting/cli/shadow.ts`.
- Артефакты `data/shadow/7745/` покрыты `.gitignore` (`data/*`) и не публикуются; PII gate на них не распространяется.
- h=7 и h=14 не подключены.
- Financial-оценки не создаются.