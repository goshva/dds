# UI-4.2.6 — безопасное представление метрик: отчёт

**Дата:** 2026-11-24 · **HEAD:** `099f37b2588c2c1cb821faabf81d507f14f14818` · **Ветка:** `main` · **Staged:** 0
**Статус:** `COMPLETE WITH LIMITATIONS` (браузерная проверка и происхождение части HTML — `NOT_VERIFIED`)

---

## 1. FACT

- `metricPresentation()` усилена до fail-closed: значение показывается только при конечном числе, корректном `n > 0` и **известной** полноте выборки (`COMPLETE` / `PARTIAL`).
- Неизвестные `sampleStatus` и `interpretabilityStatus` трактуются безопасно (`NOT_AVAILABLE` / `NOT_ASSESSED`), а не как полная и интерпретируемая выборка.
- Ни одна комбинация входов не даёт статус `OK`: карточки используют только `PENDING` / `NOT_AVAILABLE`.
- Числовые значения, смысл MAE/WAPE/Bias, формулы, пороги и API-контракты не изменялись.
- Исходные данные и прогнозное ядро не изменялись: SQLite `identical: true`, CSV/JSONL/manifest — прежние checksum.

## 2. CHANGES

| Файл | Изменение |
|---|---|
| `src/web/pages/forecast-quality.ts` | fail-closed `metricPresentation()`; `MetricsDto.sampleStatus` расширен до `COMPLETE \| PARTIAL \| NOT_AVAILABLE` |
| `tests/web/forecast-quality.test.ts` | +14 тестов UI-4.2.6 (17 → 31) |
| `docs/ui/ui-4-2-6-hardening-report.md` | настоящий отчёт |

Не изменялись: `src/forecasting/**`, `src/server/forecast-evaluation.ts`, `src/server/services/forecasting-read-models.ts`, `src/server/routes.ts`, `src/web/main.ts`, Shadow JSONL, canonical CSV, SQLite, `manifest.json`, `package.json`, `bun.lock`, HTML-макеты параллельной разработки.

## 3. TEST RESULTS

| Команда | Результат |
|---|---|
| `bun test tests/web/forecast-quality.test.ts` | **31 pass / 0 fail** |
| `bun test tests/server tests/web` | **260 pass / 0 fail** |
| `bun test` | **810 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| `bun run ui:build` | exit 0 |
| PII gate | GATE PASS |
| `git diff --check` | чисто |

## 4. METRIC EDGE CASES

| Вход | `value` | `status` | `interpretable` |
|---|---|---|---|
| `value=100, n=0, NOT_AVAILABLE, LIMITED` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=100, n=-1, COMPLETE, LIMITED` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=100, n=5, UNKNOWN, LIMITED` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=100, n=5, COMPLETE, SOMETHING` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=NaN` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=Infinity` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=-Infinity` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=null` | `[Н/Д]` | `NOT_AVAILABLE` | false |
| `value=100.55, n=875, COMPLETE, LIMITED` | `100,55` | `PENDING` | true |
| `value=100.55, n=12, PARTIAL, LIMITED` | `100,55` | `PENDING` | true |
| `value=40.43, n=1, COMPLETE, INSUFFICIENT` | `40,43` | `PENDING` | false |
| `value=100, n=5, COMPLETE, NOT_ASSESSED` | `[Н/Д]` | `NOT_AVAILABLE` | false |

Дополнительно: независимые метрики используют собственный `n`; при `pairedN = 0` секция сравнения не содержит зелёного статуса независимо от количества независимых наблюдений.

## 5. PARALLEL WORK OWNERSHIP

- `git status --short`: изменены `src/server/routes.ts`, `src/web/main.ts` (изменения UI-4.2/UI-4.2.5); untracked — отчёты UI-4, ядро, read-model, страница, тесты, каталог `src/web/templates/`, файл `nul`.
- `git diff --stat` / `--name-status`: только `src/server/routes.ts` (+47/−1) и `src/web/main.ts` (+12) — это изменения UI-4.2.
- `git ls-files src/web/templates/` — **пусто**: HTML-файлы **не отслеживаются** Git.
- Содержимое (read-only): `partials/shell/app-shell.html` (235 Б), `page-header.html` (230 Б), `sidebar-brand.html` (459 Б), `sidebar-nav.html` (267 Б), `sidebar.html` (269 Б), `topbar.html` (463 Б); время создания 23:44–23:45 24.11.2026 — период, когда я выполнял UI-4.2/UI-4.2.5, но файлы **не создавались ни одной моей командой** (я создавал только `pages/forecast-quality.ts` и правила `main.ts`).
- Пересечений с файлами UI-4.2 нет; ссылок на `templates/` в production-коде нет — макеты изолированы.
- **Итог: `OWNERSHIP_NOT_CONFIRMED`.** Файлы не изменялись, не перемещались, не удалялись и не форматировались.
- **Безопасная граница:** экспериментальные HTML-макеты остаются вне production shell, маршрутов, API и логики DSS; интеграция возможна только после отдельного ревью и согласования. Отдельно зафиксирован артефакт `nul` в корне репозитория: git сообщает о нём как об untracked, при этом проверка `Test-Path -LiteralPath` показывает, что физически файл отсутствует — `nul` является зарезервированным именем устройства Windows. Артефакт не создавался моими командами в этом этапе и не удалялся.

## 6. CHECKSUM RECONCILIATION

| Checksum | Что означает |
|---|---|
| `8f2b1818da001a42fad3125ba85a600f71c4443316e868181c49fa35708d3d16` | SHA-256 **нормализованного** представления (`date\tvalue`) всех **906** дней canonical CSV (`2024-06-01 … 2026-11-23`) — текущее состояние |
| `d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a` | SHA-256 того же нормализованного представления для **905** дней (до `2026-11-22`) — состояние до добавления последнего дня (`2026-11-23 = 1545`) |
| `56069e58207be8e2a812531e6667f845e377811032cc1bd9ed2f62c73ba377c5` | SHA-256 **байтов файла** CSV (не нормализованное представление) |

Оба значения в отчётах корректны и относятся к одному файлу `data/processed/forecasting/7745/canonical_daily_delivered_orders.csv` в разных состояниях; подмена версии текущей не выполнялась.

## 7. NOT_IMPLEMENTED

- статистический порог интерпретируемости (не согласован; `LIMITED` при любом `pairedN > 1`);
- браузерная визуальная проверка (UI-7);
- кэширование read-model, хранение ошибок, p10/p90, сценарии, финансовый эффект, SQLite API;
- интеграция HTML-макетов параллельной разработки.

## 8. NOT_VERIFIED

- происхождение шести HTML-файлов `src/web/templates/partials/shell/*.html` (`OWNERSHIP_NOT_CONFIRMED`);
- происхождение артефакта `nul` (зарезервированное имя устройства Windows: в git — untracked, физически отсутствует);
- визуальная адаптивность и отсутствие горизонтального переполнения в браузере;
- бизнес-семантика `delivered_orders_daily` (`PROVISIONAL`).

## 9. REMAINING RISKS

1. **P1:** `LIMITED` не означает статистическую достаточность — отражено статусом `PENDING` и примечанием; порог не согласован.
2. **P2:** при неизвестном `sampleStatus` значение скрывается (`[Н/Д]`) — сознательный fail-closed выбор.
3. **P2:** параллельные HTML-макеты и артефакт `nul` находятся в рабочем дереве без подтверждённого владельца; их присутствие не влияет на сборку и маршруты.

## 10. RECOMMENDATION

UI-4.2.6 можно закрывать: части A и B выполнены и подтверждены тестами, части C и D выполнены в режиме read-only, риски P0 отсутствуют. Ограничения (`OWNERSHIP_NOT_CONFIRMED`, браузерная проверка) вынесены в UI-7 и не блокируют этап.
