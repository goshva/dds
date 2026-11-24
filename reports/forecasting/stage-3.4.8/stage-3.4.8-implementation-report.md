# Stage 3.4.8 — теневой режим: отчёт о реализации

**Дата:** 2026-11-24 · **Статус:** `SHADOW_MODE_READY_FOR_REVIEW`
**Изолированный контур; production baseline `rolling_7_day_mean` не изменялся, автоматического запуска в production нет.**

---

## 1. Executive summary

| Пункт | Состояние (FACT) |
|---|---|
| Архитектура | отдельный контур `src/forecasting/shadow/`, не импортируется production-кодом |
| Хранилище | append-only JSONL (`data/shadow/7745/`), без SQLite и миграций |
| Режимы | `replay` и `shadow` разделены; результаты не смешиваются |
| Горизонты | только h=1 и h=3; h=7/h=14 не подключены |
| Идентификатор | детерминированный `snapshot_id` (sha256), `generated_at` не входит |
| Идемпотентность | повторный запуск — no-op; другое содержимое при том же ID — CONFLICT |
| Fail-closed | неконечный baseline, future data, отсутствующий факт — фиксируются, значения не подставляются |
| Тесты | 12 pass / 0 fail |
| Документы | `shadow-mode-architecture.md`, `shadow-mode-contract.md` |

## 2. Реализация (FACT)

| Файл | Роль |
|---|---|
| `src/forecasting/shadow/store.ts` | типы, `snapshot_id`, `input_data_version`, append-only JSONL, no-op/CONFLICT, manifest |
| `src/forecasting/shadow/runner.ts` | расчёт baseline и Variant B независимо; режимы replay/shadow; fail-closed при неконечном baseline |
| `src/forecasting/shadow/pipeline.ts` | reconcile (только чтение снапшотов) и monitor (метрики, разницы, счётчики) |
| `src/forecasting/shadow/index.ts` | публичный API |
| `src/forecasting/cli/shadow.ts` | прямой запуск без изменения `package.json` |
| `tests/forecasting/shadow-mode.test.ts` | 12 тестов |
| `docs/forecasting/shadow-mode-architecture.md`, `shadow-mode-contract.md` | архитектура и контракт |

## 3. Идентификатор и неизменяемость

```text
snapshot_id = SHA256(model_id | model_version | horizon | origin_date | target_date | input_data_version)
input_data_version = SHA256(канонизированная история date=value до origin)
```

- `generated_at` и `run_id` — аудит-поля, в идентичность не входят (проверено тестом повторного запуска).
- Reconciliation никогда не изменяет `forecasts.jsonl` (проверено сравнением файла до/после).

## 4. Прогон CLI (FACT)

```
bun src/forecasting/cli/shadow.ts --mode all --now 2026-11-24T...
→ exit 0
replay:      прогнозов 3500, записано 3500, no-op 0, fallback 0, invalid 0
shadow:      прогнозов 4, записано 4, ожидают факта 2
reconcile:   снапшотов 3504, сверено 3500, новых 3500, ожидают 4
monitor:     прогнозов 3504, сверено 3500, errors 0
```

Replay-диагностика (весь исторический период, **не** test-интервал Stage 3.4.5/3.4.6):

| Горизонт | MAE baseline | MAE Variant B | Δ MAE |
|---|---:|---:|---:|
| h=1 | 100.55 | 85.82 | 14.72 |
| h=3 | 114.13 | 100.26 | 13.87 |

**Внимание:** эти числа — историческое воспроизведение, а не результаты shadow-наблюдения; они не заменяют и не пересчитывают эксперименты Stage 3.4.5–3.4.7.

## 5. Тесты (FACT)

| Группа | Проверка | Результат |
|---|---|---|
| одинаковые входные данные | для каждой пары (origin, target, h) есть обе модели | pass |
| неизменяемость | повторный запуск не добавляет и не меняет записи | pass |
| future leakage | replay — только подтверждённые даты; shadow — будущие не оцениваются | pass |
| фактическое сопоставление | `absolute_error`/`signed_error` корректны; reconcile не меняет прогнозы | pass |
| отсутствующий факт | `MISSING_ACTUAL`, ноль не подставляется | pass |
| независимость baseline | baseline не зависит от Variant B, `variant = null` | pass |
| идемпотентность | детерминированный ID; no-op | pass |
| CONFLICT | тот же ID + другое содержимое → остановка, файл не изменён | pass |
| fail-closed | неконечный baseline не сохраняется как прогноз | pass |
| мониторинг | счётчики и сравнение по горизонтам | pass |

## 6. Проверки (FACT)

| Проверка | Результат | Exit |
|---|---|---:|
| `bun test tests/forecasting/shadow-mode.test.ts` | 12 pass / 0 fail | 0 |
| `bun test tests/forecasting` | 365 pass / 0 fail | 0 |
| `bun test` | 529 pass / 4 skip / 0 fail | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| PII gate (reports, docs, data/processed) | PASS | 0 |
| `git diff --check` | пусто | 0 |
| Canonical CSV checksum | `d413286e…` — не изменялся | — |
| SQLite sha256 | `eadc3763…` — не изменялась | — |
| `package.json` | не изменялся | — |
| Production baseline | не переключался; модуль не импортируется production-кодом | — |
| commit/push/reset/rebase/checkout | не выполнялись | — |

## 7. Защита артефактов

- `data/shadow/7745/` покрыт `.gitignore` (`data/*`) — файлы не попадут в публикацию.
- PII gate запускается по `reports/`, `docs/forecasting/contracts/`, `data/processed/`; shadow-артефакты не публикуются и не содержат персональных данных (только даты и числовые прогнозы).

## 8. Ограничения

1. Новые факты поступают только через обновление canonical CSV; интеграция с ingestion не делалась.
2. `shadow`-записи пока без фактов (`pending = 4`); reconcile выполнится после появления данных.
3. Replay-числа — диагностика, не подтверждение качества; основное подтверждение — Stage 3.4.5–3.4.7.
4. Бизнес-материальность не измерялась (нет подтверждённых стоимостей).
5. Семантика `PROVISIONAL`.

## 9. Следующее решение (за владельцем проекта)

- Продолжительность теневого режима и критерии успешного завершения.
- Частота обновления canonical CSV для поступления новых фактов.
- Условия перехода к Stage 3.5 (готовность к production).

**Остановка:** реализация завершена, автоматического запуска в production нет.