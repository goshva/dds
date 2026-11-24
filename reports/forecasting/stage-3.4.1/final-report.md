# Stage 3.4.1 — Итоговый отчёт (методологический контракт)

**Этап:** контракт стратегии и оценки (forecast strategy & evaluation contract) · **Дата:** 2026-11-23 · **Тип:** проектирование и документирование
**Магазин:** `7745` · **Срез:** `20624` · **Метрика:** `delivered_orders_daily` (`qty_orders_delivered`)

---

## 1. Краткое резюме

| Пункт | Состояние |
|---|---|
| Выполнено | шесть контрактов, девять отчётов этапа, автоматическая валидация сценариев A–J, тесты контракта |
| Не выполнено | порог практической значимости не введён (сознательно); расширение `assertNoFutureData` не сделано (вне границ); бизнес-семантика остаётся `PROVISIONAL` |
| Общий статус этапа | **ACCEPTED_WITH_LIMITATIONS** (ограничения перечислены в разделах 8 и 9) |
| Код моделей, данные, SQLite, baseline | не изменялись |

## 2. Preflight

| Параметр | Значение |
|---|---|
| HEAD (до и после) | `867546df149cf10280e18b2060269aeeea1b5b87` |
| Ветка | `main` |
| Git status до | 99 записей; 6 modified (tracked), остальное untracked; staged отсутствуют |
| Git status после | тот же состав modified-файлов плюс новые untracked-каталоги `docs/forecasting/contracts/`, `reports/forecasting/stage-3.4.1/`, `tests/forecasting/contracts.test.ts` |
| Обнаруженные ограничения | пробел `assertNoFutureData` (дубликаты дат, глобальные статистики); отсутствие метаданных эксперимента; неопределённый порог значимости; неподтверждённый `date_supply` |

## 3. Созданные документы

| Файл | Содержание | Связь с кодом |
|---|---|---|
| `docs/forecasting/contracts/forecast-strategy-contract.md` | объект, горизонты, термины времени, стратегия выбора | `baselines/types.ts` (`addDaysIso`, `targetDates`) |
| `docs/forecasting/contracts/evaluation-contract.md` | `step-exact`, выборки, сопоставимость, статусы доступности | `analytics/backtesting/rolling-origin.ts` |
| `docs/forecasting/contracts/metrics-contract.md` | формулы и граничные случаи метрик | `analytics/backtesting/metrics.ts` |
| `docs/forecasting/contracts/model-selection-contract.md` | допуск кандидата, статусы сравнения, запрет подгонки | `rolling-origin.ts`, `metrics.ts` |
| `docs/forecasting/contracts/backtesting-protocol.md` | rolling-origin, leakage prevention, повторяемость | `runBacktest`, `LeakageCheck`, CLI `forecast:backtest` |
| `docs/forecasting/contracts/experiment-reporting-contract.md` | обязательные поля, разделение режимов, счётчики | `analytics/backtesting/reports.ts` |
| `reports/forecasting/stage-3.4.1/00-preflight-audit.md` | аудит репозитория, кода и контрольных сумм | — |
| `reports/forecasting/stage-3.4.1/01…06-*.md` | резюме каждого контракта | — |
| `reports/forecasting/stage-3.4.1/validation-results.md` | проверка сценариев A–J | `tests/forecasting/contracts.test.ts` |
| `tests/forecasting/contracts.test.ts` | 17 тестов контракта и валидатор документации | существующий код без изменений |

## 4. Зафиксированные контракты

| Контракт | Версия | Ключевое содержание |
|---|---|---|
| стратегия | `strategy/v1` | `delivered_orders_daily`; горизонты 1/3/7/14; `origin`/`target`/`horizon_step`; независимый выбор модели по горизонтам |
| оценка | `evaluation/v1` | `step-exact` основной, `cumulative` справочный; `min_train` 28 основной, 21 sensitivity; общие пары; `AVAILABLE`/`NOT_AVAILABLE`/`INVALID`; `margin_to_runner_up` |
| метрики | `metrics/v1` | MAE, RMSE, WAPE, Bias; `NOT_AVAILABLE` при нулевом знаменателе; запрет замены NULL и авт удаления выбросов |
| выбор модели | `selection/v1` | 10 условий допуска; 6 статусов сравнения; `PRODUCTION_APPROVED` только при 6 условиях; запрет подгонки под тест |
| backtesting | `backtesting/v1` | rolling-origin; 8 правил leakage; повторяемость и метаданные эксперимента; пробел `assertNoFutureData` |
| отчётность | `reporting/v1` | 19 обязательных полей; `PRIMARY`/`SENSITIVITY`/`REFERENCE`; счётчики покрытия; преемственность через `archive/` |

## 5. Валидация

| Сценарий | Проверка | Результат |
|---|---|---|
| A | точный горизонт `step-exact` | PASS |
| B | cumulative не равен точному шагу | PASS |
| C | отсутствие прогноза → `NOT_AVAILABLE` без подстановки | PASS |
| D | `NaN`/`Infinity` → отклонение и исключение из метрик | PASS |
| E | утечка данных → ошибка, прогон без нарушений | PASS |
| F | несопоставимые выборки → общий набор и счётчики | PASS |
| G | нулевой знаменатель WAPE → `NOT_AVAILABLE` | PASS |
| H | разные `min_train` не смешиваются | PASS |
| I | выбор модели отдельно для каждого горизонта | PASS |
| J | повторяемость прогона | PASS |

- Не пройденных проверок нет.
- Подробности и фактические значения — в `validation-results.md`.

## 6. Тесты

| Команда | Результат | Exit |
|---|---|---:|
| `bun test tests/forecasting` | 236 pass / 0 fail (добавлено 17 тестов контракта) | 0 |
| `bun test` | 400 pass / 4 skip / 0 fail | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| `bun run forecast:db check` | `ok=true`, `integrity=ok` | 0 |
| PII gate (`docs/forecasting/contracts`, `reports/forecasting`, `data/processed`) | GATE PASS, 0 срабатываний | 0 |
| `git diff --check` | пусто | 0 |
| `bun run forecast:backtest` (контрольный прогон) | leakage PASS, checksum стабилен | 0 |

Существующие тесты не ослаблялись и не переписывались.

## 7. Целостность

| Объект | До | После |
|---|---|---|
| Canonical CSV, checksum содержимого | `d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a` | то же значение |
| Canonical CSV, строк | 905 | 905 |
| SQLite sha256 | `eadc3763926e142a574e5493495ee83584bd21f77d71bbbf6ae42cc0c7c65619` | то же значение |
| extraction `h1` / `h2` / `h3` | `2d271dbf…` / `d34e578a…` / `a28d6d78…` | без изменений |
| Stage 3.3 (отчёты и артефакты) | — | не изменялись |

## 8. Известные ограничения

- Бизнес-семантика `PROVISIONAL`: смысл `date_supply`, правила перерасчётов, возвратов и корректировок не подтверждены.
- Порог `NO_MATERIAL_DIFFERENCE` не определён: сравнение моделей опирается на `margin_to_runner_up` и экспертную оценку.
- `assertNoFutureData` не покрывает дубликаты дат и глобальные статистики — требуется отдельное согласование.
- Метаданные эксперимента (`experiment_id`, `config_hash`, `model_version`) существуют как спецификация, но не сохраняются автоматически.
- Термин `NOT_AVAILABLE` в контракте соответствует коду `wape = null` + `wape_status`.
- Устойчивого победителя по горизонтам нет; производственное превосходство не доказано.
- Один магазин, отсутствие почасовых, кадровых и подтверждённых операционных данных, chart 20209 не подключён.

## 9. Матрица приёмки

| № | Критерий | Результат |
|---|---|---|
| 1 | Preflight зафиксирован | выполнен |
| 2 | Контракт стратегии | выполнен |
| 3 | Контракт оценки | выполнен |
| 4 | Основной режим `min_train=28` | зафиксирован |
| 5 | Sensitivity `min_train=21` отделён | зафиксирован |
| 6 | Cumulative не используется как точная оценка | зафиксировано |
| 7 | Метрики и граничные случаи | описаны |
| 8 | Правила допуска и сравнения | описаны |
| 9 | Rolling-origin и leakage prevention | описаны |
| 10 | Обязательные метаданные | описаны |
| 11 | Контракт воспроизводимости | описан |
| 12 | Сценарии A–J | все PASS |
| 13 | `PROVISIONAL` сохранён | да |
| 14 | Данные не изменены | подтверждено checksum |
| 15 | Формулы baseline сохранены | да |
| 16 | SQLite и миграции не изменены | подтверждено sha256 |
| 17 | Тесты пройдены | 236 pass / 0 fail, tsc 0 ошибок |
| 18 | PII gate | PASS |
| 19 | Commit и push не выполнялись | подтверждено |
| 20 | Итоговый отчёт подготовлен | настоящий документ |

## 10. Git

- commit — не выполнялся;
- push — не выполнялся;
- reset, rebase, checkout — не выполнялись;
- пользовательские изменения не удалялись; `diff.txt` не изменялся;
- ветка осталась `main`, HEAD не изменялся.

## 11. Следующий этап

- Предлагается **Stage 3.4.2 — календарные признаки (calendar features)**: исследование дней недели, месяцев, праздников и длинных выходных как признаков, с обязательным соблюдением настоящего контракта (step-exact, разделение primary/sensitivity, запрет утечки).
- Реализация Stage 3.4.2 не начата: требуется отдельное разрешение.
