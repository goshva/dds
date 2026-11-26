# UI-4.2.6.1 — безопасная проверка целочисленного n: отчёт

**Дата:** 2026-11-24 · **HEAD:** `099f37b2588c2c1cb821faabf81d507f14f14818` · **Ветка:** `main` · **Staged:** 0
**Статус:** `COMPLETE`

---

## 1. Точный diff

Файл `src/web/pages/forecast-quality.ts`, функция `metricPresentation()`:

```diff
-  const sampleValid = Number.isInteger(n) && n > 0 && VALID_SAMPLE_STATUS.has(sampleStatus);
+  const sampleValid = Number.isSafeInteger(n) && n > 0 && VALID_SAMPLE_STATUS.has(sampleStatus);
```

Остальные условия не изменялись: `n > 0`, `sampleStatus ∈ {COMPLETE, PARTIAL}`, неизвестные значения обрабатываются fail-closed; бизнес-семантика и остальные ветви `metricPresentation()` (значение, статусы `PENDING`/`NOT_AVAILABLE`, признак `interpretable`) сохранены.

Примечание (FACT): файл `src/web/pages/forecast-quality.ts` является untracked, поэтому `git diff` по нему пуст; изменение подтверждается фактическим содержимым строки 70.

## 2. Изменённые файлы

| Файл | Изменение |
|---|---|
| `src/web/pages/forecast-quality.ts` | `Number.isInteger` → `Number.isSafeInteger` |
| `tests/web/forecast-quality.test.ts` | +5 тестов UI-4.2.6.1 (31 → 36) |
| `docs/ui/ui-4-2-6-1-report.md` | настоящий отчёт |

Не изменялись: API, read-model, прогнозное ядро (`src/forecasting/**`, `src/server/forecast-evaluation.ts`, `src/server/services/forecasting-read-models.ts`, `src/server/routes.ts`), SQLite, CSV, JSONL, `manifest.json`, HTML-макеты параллельной разработки, зависимости.

## 3. Новые тесты

| Тест | Вход | Ожидание | Результат |
|---|---|---|---|
| MAX_SAFE_INTEGER | `n = Number.MAX_SAFE_INTEGER`, `COMPLETE`, `LIMITED` | значение `100`, статус `PENDING`, `interpretable = true` | pass |
| MAX_SAFE_INTEGER + 1 | `n = Number.MAX_SAFE_INTEGER + 1` | `[Н/Д]`, `NOT_AVAILABLE`, `interpretable = false`, не `OK` | pass |
| 1e100 | `n = 1e100` | `[Н/Д]`, `NOT_AVAILABLE`, `interpretable = false` | pass |
| 1.5 | `n = 1.5` | `[Н/Д]`, `NOT_AVAILABLE`, `interpretable = false` | pass |
| n = 1 | `n = 1`, `COMPLETE`, `INSUFFICIENT` | значение `40,43`, статус `PENDING`, `interpretable = false`, примечание «недостаточно наблюдений» | pass |

## 4. Результаты проверок

| Команда | Результат |
|---|---|
| `bun test tests/web/forecast-quality.test.ts` | **36 pass / 0 fail** |
| `bun test tests/server tests/web` | **265 pass / 0 fail** |
| `bun test` | **815 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| `bun run ui:build` | exit 0 |
| PII gate (2 файла) | GATE PASS |
| `git diff --check` | чисто |

## 5. Неизменность данных (FACT)

SQLite `identical: true`; canonical CSV (нормализованный) `8f2b1818da001a42…`; `forecasts.jsonl` `e35fe27b002e42cca0d5d67579d9831c…`; `reconciliations.jsonl` `32ccd25604ae78b36996738c10581cea…`; `manifest.json` `9d986747771c5fd1cc3654a8eec6c0cf…`; `errors.jsonl` не создан. Прогнозные операции (replay, shadow, reconcile, monitor, `--mode all`) не запускались.

## 6. Git-состояние

HEAD `099f37b2588c2c1cb821faabf81d507f14f14818`; ветка `main`; staged **0**; изменённые (tracked): `src/server/routes.ts`, `src/web/main.ts` (изменения UI-4.2, не трогались в этом этапе); untracked: отчёты UI-4.0/4.1/4.2/4.2.5/4.2.6/4.2.6.1, ядро, read-model, страница качества, три тестовых файла, каталог `src/web/templates/` (параллельная разработка, не изменялся), артефакт `nul` (зарезервированное имя устройства Windows). Commit/push/reset/checkout/stash/clean не выполнялись; Git index не изменялся.

## 7. NOT_VERIFIED

- происхождение шести HTML-файлов `src/web/templates/partials/shell/*.html` — `OWNERSHIP_NOT_CONFIRMED`;
- визуальная адаптивность и горизонтальное переполнение в браузере (UI-7);
- бизнес-семантика `delivered_orders_daily` (`PROVISIONAL`).

## 8. Остаточные ограничения

1. **P1:** `LIMITED` ≠ статистическая достаточность — порог интерпретируемости не согласован.
2. **P2:** при неизвестном `sampleStatus` или недоступной интерпретации значение скрывается (`[Н/Д]`) — сознательный fail-closed выбор.
3. **P2:** экстремальные, но безопасные `n` (вплоть до `Number.MAX_SAFE_INTEGER`) проходят проверку — ограничение на размер выборки не вводится, поскольку это статистический, а не технический вопрос.
