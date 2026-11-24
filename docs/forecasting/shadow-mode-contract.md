# Контракт теневого режима (Stage 3.4.8)

**Статус:** действующий · **Версия:** `shadow-mode/v1` · **Дата:** 2026-11-24
**Область:** изолированный контур, h=1 и h=3, baseline `rolling_7_day_mean` + Variant B.

---

## 1. Идентификатор снапшота

```text
snapshot_id = SHA256(
  model_id | model_version | horizon | origin_date | target_date | input_data_version
)
```

Правила:

- `generated_at` в идентификатор **не входит**;
- `input_data_version` = SHA-256 канонизированной истории (`date=value`), доступной на `origin`;
- baseline и Variant B имеют разные `model_id` (`rolling_7_day_mean`, `adaptive_baseline`);
- конфигурация модели фиксируется в `model_version` (`adaptive-baseline/v1+variantB`);
- существующий `snapshot_id` с тем же содержимым → **no-op**;
- существующий `snapshot_id` с другим содержимым → **CONFLICT**, остановка без перезаписи.

`run_id` и `generated_at` — аудит-поля: не входят в идентичность и не влияют на no-op.

## 2. Схема снапшота

| Поле | Тип | Обязательное | Смысл |
|---|---|---|---|
| `snapshot_id` | string (sha256) | да | детерминированный идентификатор |
| `run_id` | string | да | идентификатор запуска (аудит) |
| `mode` | `replay` / `shadow` | да | происхождение записи |
| `model_id` | `rolling_7_day_mean` / `adaptive_baseline` | да | модель |
| `model_version` | string | да | версия модели |
| `variant` | `B` / null | да | только для адаптивной модели |
| `horizon` | 1 / 3 | да | горизонт |
| `origin_date` | ISO-дата | да | последняя дата доступной истории |
| `target_date` | ISO-дата | да | дата прогноза |
| `forecast_value` | number / null | да | прогноз (null — нет допустимого прогноза) |
| `status` | `OK` / `FALLBACK` / `INVALID` | да | статус |
| `fallback_reason` | string / null | да | причина fallback/invalid |
| `input_data_version` | sha256 | да | версия входной истории |
| `dataset_checksum` | sha256 | да | контрольная сумма canonical CSV |
| `generated_at` | ISO | да | момент создания (аудит) |

## 3. Неизменяемость

- `forecasts.jsonl` — append-only: записи только добавляются.
- Запрещено: переписывать прогнозы, обновлять после появления факта, исправлять историю.
- `reconciliations.jsonl` — отдельные записи со ссылкой на `snapshot_id`; прогноз не изменяется.
- `errors.jsonl` — append-only журнал ошибок.
- `manifest.json` — версии, конфигурация, контрольные суммы.

## 4. Reconciliation

- Факт берётся только из canonical CSV и только для дат `target_date ≤ последней подтверждённой даты`.
- Будущие даты не оцениваются (`pending_future`).
- Отсутствующий факт не заменяется нулём (`MISSING_ACTUAL`).
- Ошибки: `absolute_error = |forecast − actual|`, `signed_error = forecast − actual`.

## 5. Статусы

| Статус | Значение |
|---|---|
| `OK` | поправка применена (Variant B) или baseline рассчитан |
| `FALLBACK` | поправка не применена: недостаток истории или правило варианта |
| `INVALID` | нарушение входа (future, дубликат, NaN, некорректные параметры) |

Fallback варианта B **не заменяет** baseline: baseline-снапшот существует независимо.

## 6. Идемпотентность

- Повторный запуск с теми же входами: 0 новых записей, 0 изменений файлов.
- Повторный запуск с изменённой историей: новый `input_data_version` → новые `snapshot_id`.
- Изменение `alpha`/`limit` без изменения `model_version` запрещено контрактом: конфигурация входит в версию.

## 7. Запреты

- не подключать к production pipeline;
- не использовать в операционных решениях;
- не переключать baseline;
- не изменять canonical CSV и SQLite;
- не запускать новые статистические эксперименты в рамках shadow-режима;
- не создавать финансовые оценки без подтверждённых стоимостей.