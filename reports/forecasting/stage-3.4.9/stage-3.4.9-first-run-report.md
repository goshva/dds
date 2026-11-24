# Stage 3.4.9 — первый контролируемый ручной сбор: отчёт

**Дата запуска:** 2026-11-24 · **Фактический старт Stage 3.4.9:** 2026-11-24
**Статус:** `FIRST_RUN_ACCEPTED` · **Production baseline не переключался.**

---

## 1. Executive summary

| Пункт | Результат (FACT) |
|---|---|
| Новый факт | 2026-11-23 = **1 545** заказов (slice 20624, HAR-режим, HTTP 200, `full`) |
| Canonical CSV | 906 дней, 2024-06-01 … 2026-11-23, сумма **1 583 459**, checksum `8f2b1818…` |
| Сверка с прежними 905 днями | IDENTICAL=905, **NEW=1**, VALUE_CHANGED=0, MISSING=0 |
| Shadow (h=1, h=3) | 4 новых снапшота, 0 fallback/invalid, 2 pending |
| Reconciliation | +2 записи; pending=6 (будущие target), missing=0, errors=0 |
| Idempotency | повторный shadow: written=0, noop=4, conflicts=0 |
| Lock | захвачен и освобождён; файла lock после запуска нет |
| Production wiring | отсутствует |

## 2. Checkpoint 0 — Preflight (FACT)

| Параметр | Значение |
|---|---|
| HEAD / ветка | `ddf2b3441ece5850124fd08bd55e900fb292dd24` / `main` |
| Рабочее дерево | 0 изменений (Stage 3.4.8.1 закоммичен) |
| Документы | отчёт 3.4.8.1, контракт теневого режима, протокол адаптивного baseline — найдены |
| Штатный способ обновления | выгрузка HAR-телом 103 → сборка `forecast:history` (интервалы + сверка с предыдущим CSV) |
| `errors.jsonl` | отсутствует |
| SHA-256 до | CSV `d413286e…`; SQLite `eadc3763…`; forecasts `4b9c7308…` (3504); reconciliations `77024788…` (3500) |
| Superset | авторизация успешна, запрос выполнен (HTTP 200) |

## 3. Checkpoint 1 — Verified fact load (FACT)

- Выгрузка: `--files 103 --from 2026-11-23 --to 2026-11-24 --raw-artifacts`, HAR-режим (фильтры `feature_tt` и `delivery_type_group` сохранены, `shopno_injected=0`).
- Результат: 1 строка, дата `2026-11-23`, значение `1545`, метрика `qty_orders_delivered`, `completeness=full`, `missing_metrics=0`, `duplicates=0`.
- Сборка canonical через `forecast:history` (интервалы d1+h3+h2+h1, сверка с предыдущим CSV).
- Проверки файла: 906 строк, период `2024-06-01 … 2026-11-23`, дубликаты 0, хронология корректна, пропуски 0, сумма 1 583 459.
- Сверка: `MATCH_WITH_EXTENSIONS`; старые значения воспроизведены без изменений.

## 4. Checkpoint 2 — Shadow (FACT)

| Показатель | Значение |
|---|---|
| Режим | `--mode shadow` (без replay) |
| Lock | `acquired=true`, освобождён в `finally` |
| Снапшоты | 4 (baseline + Variant B × h=1, h=3) |
| Записано / no-op | 4 / 0 |
| fallback / invalid | 0 / 0 |
| Ожидают факта | 2 (target h=1 = 2026-11-24, h=3 = 2026-11-26) |

Повторный запуск: `written=0, noop=4, conflicts=0` — идемпотентность подтверждена.

## 5. Checkpoint 3 — Reconciliation и monitor (FACT)

| Показатель | Значение |
|---|---|
| Снапшотов после запуска | 3 508 |
| Сверено | 3 502 (+2 новых записи за счёт созревшего 2026-11-23) |
| Pending | 6 (target ещё не созрели) |
| Missing actual | 0 |
| Errors | 0 |

Monitor (накопленный reconcile-набор):

| Горизонт | MAE baseline | MAE Variant B | Δ MAE | n |
|---|---:|---:|---:|---:|
| h=1 | 100.48 | 85.87 | 14.61 | 876 / 876 |
| h=3 | 114.13 | 100.26 | 13.87 | 875 / 875 |

Pending не считается ошибкой: target-даты ещё не созрели.

## 6. SHA-256 до/после (FACT)

| Объект | До | После |
|---|---|---|
| Canonical CSV | `d413286e…` | **`8f2b1818…`** (906 дней) |
| SQLite | `eadc3763…` | `eadc3763…` — не изменялась |
| `forecasts.jsonl` | 3 504, `4b9c7308…` | **3 508**, `e35fe27b…` |
| `reconciliations.jsonl` | 3 500, `77024788…` | **3 502**, `32ccd256…` |
| `errors.jsonl` | отсутствует | отсутствует |
| `.shadow.lock` | отсутствует | отсутствует |

## 7. Отклонения и ограничения

1. **Изменение кода:** константа `EXPECTED_CHECKSUM` в `src/forecasting/cli/shadow.ts` обновлена на новый канонический checksum — обязательное следствие штатного расширения данных. Это единственное изменение кода в этом запуске.
2. Отчёты сборки истории записаны в `reports/forecasting/stage-3.4.9/history-check/`, чтобы не перезаписывать артефакты Stage 3.3.1.
3. `--mode all` не использовался (исторический replay не запускался).
4. Dry-run инструмента требует `--live --yes`; для проверки использован реальный запрос выгрузки.
5. Семантика target остаётся `PROVISIONAL`; финансовые оценки не делались.
6. Один новый факт — минимальная выборка; статистические выводы по нему не делаются.
7. Cron/scheduler не включались; commit/push/reset/rebase/checkout не выполнялись.

## 8. Проверки

| Проверка | Результат |
|---|---|
| `bunx tsc --noEmit` | 0 ошибок |
| `bun test tests/forecasting` | см. раздел 9 |
| PII gate | PASS |
| `git diff --check` | пусто |
| SQLite | `identical: true` |
| Production wiring | отсутствует |

## 9. Итог

- Первый день Stage 3.4.9 засчитан: verified fact load выполнен, shadow-запуск успешен, reconciliation и monitor отработали без ошибок, данные и контракты соблюдены. Автоматизация не включалась; следующий этап не начат.