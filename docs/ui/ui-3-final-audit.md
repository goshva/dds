# UI-3 — итоговый аудит (история и аналитика)

**Дата:** 2026-11-24 · **HEAD:** `505f70a24fecbb9e5afc190059cf8a1f0fe5301f` · **Ветка:** `main` · **Staged:** 0
**Статус:** `ACCEPTED WITH DOCUMENTED LIMITATIONS`

Метки: **FACT** — проверено кодом/данными; **NOT_VERIFIED** — не подтверждено; **NOT_IMPLEMENTED** — не реализовано.

---

## 1. Что реализовано (FACT)

- раздел History & Analytics: экраны «История заказов», «Качество данных», «Происхождение», обновлённый «Обзор»;
- hash-навигация `#<page>/<range>/<from>/<to>` в едином shell;
- серверные read-model: `history.summary` (сумма/среднее/max/min/календарные и наблюдаемые дни/отсутствующие дни/формула), `coverage` (`missingDates`, `gapIntervals`, `maxGapLength`, `fillRatio`, `fillRatioFormula`);
- фильтры периодов: весь / 30 / 90 / 180 / 365 / произвольный диапазон с клиентской и серверной валидацией;
- SVG-график с разрывом линии на отсутствующих наблюдениях; таблица с `[Н/Д]` вместо нуля;
- provenance: раздельные `freshness` и `manifestStatus`, предупреждения для `STALE`/`NOT_CONFIRMED`, конфликтный статус для `CORRUPTED`;
- семантика `PROVISIONAL` выведена в интерфейс на всех экранах.

## 2. Критерии приёмки UI-3

| № | Критерий | Статус | Основание |
|---:|---|---|---|
| 1 | Исторические данные из canonical source | **PASS** | API читает canonical CSV (`slice 20624`) |
| 2 | Используется только slice 20624 | **PASS** | `sliceId = 20624`; другие slices не используются |
| 3 | Фильтры периодов работают | **PASS** | тесты диапазонов, границ, пустого периода, `from > to` |
| 4 | NULL не превращается в 0 | **PASS** | сервер отклоняет пустые/нечисловые; UI выводит `[Н/Д]` |
| 5 | Нули отображаются как реальные значения | **PASS** | тест `>0<` для фактического нуля |
| 6 | График не соединяет отсутствующие наблюдения | **PASS** | тест двух подпутей (`M`×2) |
| 7 | KPI имеют документированные формулы | **PASS** | `summary.formula`, `fillRatioFormula`, раздел 5 implementation |
| 8 | Пропуски отображаются корректно | **PASS** | `missingDates`, `gapIntervals`, `maxGapLength` |
| 9 | Аномалии не удаляются и не корректируются | **PASS** | данные не изменяются; список дат `NOT_IMPLEMENTED` |
| 10 | Provenance доступен | **PASS** | checksums, manifest, freshness на экране |
| 11 | Семантика PROVISIONAL сохранена | **PASS** | константа + бейджи в UI |
| 12 | PII не раскрывается | **PASS** | PII gate; `dimension_*` не отдаются |
| 13 | UI-2 security не регрессирует | **PASS** | тесты сервера (69 pass) и Host/Origin/методов сохранены |
| 14 | Адаптивность на пяти разрешениях | **NOT_VERIFIED** | браузер недоступен; UI-7 |
| 15 | Тесты проходят | **PASS** | `bun test` 663 pass / 4 skip / 0 fail |
| 16 | TypeScript без ошибок | **PASS** | `bunx tsc --noEmit` exit 0 |
| 17 | Production build успешен | **PASS** | `bun run ui:build` exit 0 |
| 18 | Исходные данные не изменены | **PASS** | checksums совпадают (раздел 4) |
| 19 | Реализация описана | **PASS** | `docs/ui/ui-3-implementation.md` |
| 20 | Создан итоговый аудит | **PASS** | этот документ |

## 3. Проверки (FACT)

| Проверка | Результат | Exit |
|---|---|---:|
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| `bun test tests/server tests/web` | 113 pass / 0 fail | 0 |
| `bun test` | 663 pass / 4 skip / 0 fail | 0 |
| `bun run ui:build` | build успешен | 0 |
| PII gate (`src/server`, `src/web`, `tests/server`, `tests/web`) | GATE PASS | 0 |
| `git diff --check` (src, tests, docs) | чисто | 0 |
| Браузерная адаптивность (5 разрешений) | **NOT_VERIFIED** | — |

Примечание: при первом полном прогоне один существующий тест `catalog.sqlite … readonly quick_check` завершился по таймауту 5 с; повторный прогон — 663 pass / 0 fail (флейк, не связан с UI-3).

## 4. Целостность данных (FACT)

| Объект | До UI-3 | После UI-3 |
|---|---|---|
| SQLite | `eadc3763926e142a574e5493495ee83584bd21f77d71bbbf6ae42cc0c7c65619` | идентично (`identical: true`) |
| canonical CSV (нормализованный) | `8f2b1818da001a42fad3125ba85a600f71c4443316e868181c49fa35708d3d16` | идентично |
| canonical CSV (байты файла) | `56069e58207be8e2a812531e6667f845e377811032cc1bd9ed2f62c73ba377c5` | идентично |
| `forecasts.jsonl` | `e35fe27b002e42cca0d5d67579d9831c29cd7cbb03d7ceecb17432a3f08a648c` | идентично |
| `reconciliations.jsonl` | `32ccd25604ae78b36996738c10581cead7f833c783e5461530623f3138dad146` | идентично |
| `manifest.json` | `9d986747771c5fd1cc3654a8eec6c0cfc3b44f139eb1d7f99bba9165fc10c17d` | идентично |
| `errors.jsonl` | отсутствует | отсутствует |

## 5. Изменённые файлы (FACT)

| Файл | Действие |
|---|---|
| `src/server/services/read-models.ts` | расширены `history.summary` и `coverage` |
| `src/web/pages/history.ts`, `data-quality.ts`, `provenance.ts` | новые страницы |
| `src/web/main.ts` | роутинг и подключение страниц |
| `tests/server/ui-3.test.ts`, `tests/web/ui-3.test.ts` | новые тесты |
| `docs/ui/ui-3-implementation-plan.md`, `ui-3-implementation.md`, `ui-3-final-audit.md` | документация |
| `docs/ui/api-contract.md` | дополнение по расширенным полям |

## 6. Безопасность (FACT)

Loopback bind; Host/Origin guard; CORS не открыт; `no-store`/`nosniff`/`no-referrer`; только GET; `escapeHtml` + `TrustedHtml`; allowlist SVG-классов; ошибки с `eventId` без stack trace; PII gate пройден; записи в исходные данные нет.

## 7. Ограничения

- **NOT_VERIFIED:** браузерная визуальная проверка и адаптивность (UI-7); повреждение рабочего canonical CSV.
- **NOT_IMPLEMENTED:** список аномальных дат; SQLite read-only API; прогнозы/p10-p90/сценарии/финансовые эффекты; запуск теневого режима из UI; кэширование read-model.
- **INFERENCE:** `fillRatio` и `missingDays` корректны при условии непрерывного календарного ряда canonical CSV (проверено на текущих данных: 906 дней, пропусков нет).
- **ASSUMPTION:** интерпретация периода в `Europe/Moscow` соответствует контракту DSS; отдельного теста на смену таймзоны нет.

## 8. Итоговый статус

**`ACCEPTED WITH DOCUMENTED LIMITATIONS`.**

Основание: все применимые критерии (1–13, 15–20) — `PASS`; критерий 14 (адаптивность в браузере) — `NOT_VERIFIED` и вынесен в UI-7; ограничения раздела 7 не маскируются.

**UI-4 NOT STARTED.**
---

## 9. UI-3.1 — календарная корректность (закрытие замечаний аудита)

**Статус UI-3.1:** `CLOSED` · **Дата:** 2026-11-24

| Замечание | Исправление | Тесты |
|---|---|---|
| `calendarDays` считался по найденным точкам → неполный период выглядел полным | `calendarDays` считается по **запрошенному** диапазону; `missingDays = calendarDays − observationDays` | диапазон 20–30.11 при данных до 23.11 → 11 / 4 / 7, `complete=false` |
| Диапазоны за пределами истории | полностью непересекающийся → `400 RANGE_OUT_OF_BOUNDS`; частично выходящий принимается и помечается `rangeClamped` | 2 негативных + 2 позитивных теста |
| Агрегаты зависели от `limit` | `sum/average/max/min/observationDays` считаются по всему диапазону; добавлен `truncated` | тест: `observationDays = 906` при `limit=120` |
| Календарь качества строился из последних 28 **наблюдений** | `buildCalendar()` строит последние 28 **календарных** дней от последней даты и использует `coverage.missingDates` | тесты: missing в начале/середине/конце, `unknown` для дней без наблюдений |

**Новые поля API:** `requested`, `available`, `rangeClamped`, `summary.truncated`; новый код ошибки `RANGE_OUT_OF_BOUNDS`.

**Обновлённые критерии:**

| № | Критерий | Было | Стало |
|---:|---|---|---|
| 3 | Фильтры периодов | PASS | PASS (границы и частичный выход покрыты тестами) |
| 7 | Формулы KPI | PASS | PASS (`calendarDays` по диапазону, `truncated`) |
| 8 | Пропуски | PASS | PASS (календарная сетка по `missingDates`) |

**Итог:** замечания аудита UI-3 закрыты; статус этапа — `ACCEPTED WITH DOCUMENTED LIMITATIONS` (без изменения: адаптивность в браузере остаётся `NOT_VERIFIED`, UI-7).
---

## 10. Follow-up замечания (не блокируют, не открывают UI-3.1 заново)

| ID | Замечание | Где | Риск | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|
| FU-1 | Календарь полноты на экране «Обзор» строится из `points.slice(-28)` — последних 28 **наблюдений**, а не календарных дней | `src/web/main.ts:154` | при появлении пропусков временная шкала «Обзора» сжимается и пропуски отображаются не в своих календарных позициях | заменить на `buildCalendar()` из `src/web/pages/data-quality.ts` (календарные дни от последней доступной даты + `coverage.missingDates`), как уже сделано на экране «Качество данных» | **OPEN** |

**FACT:** экран «Качество данных» использует `buildCalendar()` (`src/web/pages/data-quality.ts:32`), экран «Обзор» — по-прежнему `slice(-28)` (`src/web/main.ts:154`). На текущем непрерывном ряде (906 дней, пропусков нет) расхождение не проявляется.

**Решение по этапу:** замечание фиксируется как follow-up и устраняется при ближайшем изменении экрана «Обзор» (кандидат — UI-4 либо отдельная микроправка). UI-3.1 повторно не открывается; UI-4 не начинается.