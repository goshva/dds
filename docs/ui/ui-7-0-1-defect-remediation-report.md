# Отчёт: UI-7.0.1 — Browser Audit Defect Remediation

**Дата:** 25 ноября 2026
**Статус:** ✅ ЗАВЕРШЕНО

---

## 1. FACT (Факты)

В ходе браузерного аудита UI-7.0 были обнаружены два дефекта:

| ID | Приоритет | Описание |
|---|---|---|
| **D-001** | P1 | `parseHash()` возвращает `from`/`to` как строки для страницы `forecast-quality`, где эти параметры — `mode`/`horizon`. Валидатор дат `rangeToQuery()` применялся к mode/horizon, вызывая ложные ошибки. |
| **D-002** | P2 | Vite proxy `"/api"` перенаправлял все запросы `/api/*` на Hono, включая `src/web/api/client.ts` (TypeScript-модуль фронтенда), который должен обслуживаться локально Vite. |

---

## 2. Root Cause Analysis

### D-001: Ложная валидация дат на forecast-quality

**Корневая причина:** Функция `parseHash()` не различала страницы с диапазоном дат (`history`, `quality`) от страницы `forecast-quality`, где `from`/`to` интерпретируются как `mode`/`horizon`. Функция `render()` вызывала `rangeToQuery()` для всех страниц, включая `forecast-quality`, что приводило к валидации строк `"shadow"`/`"replay"` и `"1"`/`"3"` как дат.

**Решение:**
- `parseHash()` теперь возвращает интерфейс `Route` с полем `isForecast: boolean`.
- `render()` проверяет `page === "forecast-quality"` **до** вызова `rangeToQuery()`.
- Введена функция `forecastParams()` для извлечения `mode` и `horizon` из параметров маршрута.
- Валидация дат не применяется к прогнозным страницам.

### D-002: Конфликт proxy-правил Vite

**Корневая причина:** Широкое правило proxy `"/api"` перехватывало все запросы `/api/*`, включая `/api/client.ts` — локальный TypeScript-файл фронтенда. Vite не мог обслуживать его статически, так как proxy перенаправлял запрос на Hono.

**Решение:**
- Proxy заменён на два точечных правила: `"/api/health"` и `"/api/v1"`.
- Запросы к `/api/client.ts` (и другим `/api/*`) не попадают в proxy и обслуживаются Vite локально.
- Hono остаётся доступен через `/api/health` и `/api/v1/*`.

---

## 3. Изменённые файлы

| Файл | Изменение |
|---|---|
| `src/web/main.ts` | `parseHash()` → интерфейс `Route` с `isForecast`; `forecastParams()`; `render()` — forecast-quality до rangeToQuery |
| `vite.config.ts` | `proxy: { "/api/health": {...}, "/api/v1": {...} }` вместо `"/api"` |
| `tests/web/ui-7-0-1-routing.test.ts` | **НОВЫЙ** — 14 регрессионных тестов (все PASS) |

---

## 4. Regression Tests

### Unit-тесты

```
829 pass
 4 skip
 0 fail
 28475 expect()
833 tests across 48 files
```

### Специфичные тесты UI-7.0.1

**`tests/web/ui-7-0-1-routing.test.ts`** — 14 тестов:

| # | Тест | Статус |
|---|---|---|
| 1 | `parseHash()` на `#overview` — isForecast: false | ✅ PASS |
| 2 | `parseHash()` на `#history/30` — isForecast: false | ✅ PASS |
| 3 | `parseHash()` на `#forecast-quality/shadow/1` — isForecast: true | ✅ PASS |
| 4 | `parseHash()` на `#forecast-quality/replay/3` — isForecast: true | ✅ PASS |
| 5 | `parseHash()` на `#quality` — isForecast: false | ✅ PASS |
| 6 | `parseHash()` на `#provenance` — isForecast: false | ✅ PASS |
| 7 | `forecastParams({range:"shadow",from:"1"})` → shadow h1 | ✅ PASS |
| 8 | `forecastParams({range:"replay",from:"3"})` → replay h3 | ✅ PASS |
| 9 | `forecastParams({range:"shadow",from:"3"})` → shadow h3 | ✅ PASS |
| 10 | `forecastParams({range:"shadow",from:""})` → shadow h1 | ✅ PASS |
| 11 | `rangeToQuery` на `#history/30` — извлекает from/to | ✅ PASS |
| 12 | `rangeToQuery` на `#history/custom/2026-01-01/2026-01-31` | ✅ PASS |
| 13 | `rangeToQuery` на `#history/all` — без from/to | ✅ PASS |
| 14 | `rangeToQuery` на `#forecast-quality/shadow/1` — isForecast: true | ✅ PASS |

---

## 5. Vite Dev HTTP Checks (порт 5173)

| URL | Статус | Результат |
|---|---|---|
| `/api/client.ts` | ✅ HTTP 200 | TypeScript-код фронтенда (локально от Vite) |
| `/api/health` | ✅ HTTP 200 | Ответ Hono |
| `/api/v1/overview` | ✅ HTTP 200 | Данные |
| `/api/v1/forecasts/quality?mode=shadow&horizon=1` | ✅ HTTP 200 | Данные |
| `/api/v1/nonexistent` | ✅ HTTP 404 | Ответ Hono (не frontend-модуль) |

---

## 6. Production HTTP Checks (порт 5199)

| URL | Статус | Результат |
|---|---|---|
| `/` (index) | ✅ HTTP 200 | Frontend SPA |
| `#forecast-quality/shadow/1` | ✅ HTTP 200 | Данные forecast-quality |
| `#history/30` | ✅ HTTP 200 | Данные истории |
| `/api/health` | ✅ HTTP 200 | Hono health-check |

---

## 7. Browser Verification

### Desktop (1440×900)

| Маршрут | Результат | Детали |
|---|---|---|
| `#forecast-quality/shadow/1` | ✅ | Данные shadow h1 (n=1) |
| `#forecast-quality/shadow/3` | ✅ | Данные shadow h3 (n=0, NOT_AVAILABLE) |
| `#forecast-quality/replay/1` | ✅ | Данные replay h1 (n=875) |
| `#forecast-quality/replay/3` | ✅ | Данные replay h3 (n=875) |

### Mobile (390px)

| Маршрут | Результат | Детали |
|---|---|---|
| `#forecast-quality/shadow/1` | ✅ | Корректно |
| `#history/30` | ✅ | 46 646 заказов, 30 наблюдений |
| `#history/01.13.2026-99.99.2026` | ✅ | Корректно (fallback на полный период) |
| `#history/custom/2026-13-01/2026-11-23` | ✅ | INVALID_RANGE — «Дата начала позже даты окончания» |
| `#unknown-page` | ✅ | Default: «Обзор» |

### Console Errors

| Проверка | Результат |
|---|---|
| Console errors (все маршруты) | ✅ 0 |

---

## 8. Data Integrity

- **Shadow h1 (n=1):** MAE = 40.43 (описательное значение, недостаточно наблюдений)
- **Shadow h3 (n=0):** NOT_AVAILABLE
- **Replay h1 (n=875):** MAE = 124.12
- **Replay h3 (n=875):** MAE = 124.12
- **History 30 days:** 46 646 заказов, среднее 1 554.9 в день

Данные не изменились — исправления коснулись только маршрутизации и валидации.

---

## 9. Git Status

```
 M src/server/routes.ts    (UI-4.2: +47 строк, endpoints forecasts/quality|errors)
 M src/web/main.ts         (UI-4.2 + UI-7.0.1: forecast-quality + routing fix)
 M vite.config.ts          (UI-7.0.1: proxy fix)
?? docs/ui/ui-4-*.md       (7 untracked)
?? docs/ui/ui-7-0-browser-verification-report.md
?? docs/ui/ui-7-0-1-defect-remediation-report.md (этот файл)
?? src/server/forecast-evaluation.ts
?? src/server/services/forecasting-read-models.ts
?? src/web/pages/forecast-quality.ts
?? src/web/templates/partials/shell/*.html (6 файлов)
?? tests/server/forecast-*.test.ts (2 файла)
?? tests/web/forecast-quality.test.ts
?? tests/web/ui-7-0-1-routing.test.ts
```

---

## 10. NOT_VERIFIED

| Проверка | Причина |
|---|---|
| Tablet 1024×768 | Нет инструмента эмуляции tablet viewport |
| Переход из Provenance на forecast-quality | Клик по ссылке в sidebar не сработал (stale_ref + timeout), но прямой переход по URL работает |

---

## 11. Recommendations

1. **Немедленное применение:** Оба исправления критичны. D-001 (P1) ломает работу страницы forecast-quality на production. D-002 (P2) блокирует загрузку API-клиента фронтенда в dev-режиме.
2. **UI-7.1:** Добавить страницу `forecast-errors` (endpoint `/api/v1/forecasts/errors` уже создан в UI-4.2).
3. **UI-4.3:** Создать шаблоны в `src/web/templates/` (cards/charts/data/states/pages).
4. **Тестирование:** Рассмотреть добавление e2e-тестов для hash-роутинга.
5. **Документация:** Обновить документацию маршрутизации с учётом нового интерфейса `Route`.

---

## 12. Checklist

- [x] Исправление D-001 (P1)
- [x] Исправление D-002 (P2)
- [x] Регрессионные тесты (829 pass, 0 fail)
- [x] `bunx tsc --noEmit` (PASS)
- [x] `git diff --check` (только LF→CRLF warning, нет whitespace-ошибок)
- [x] Vite dev HTTP-проверки
- [x] Production HTTP-проверки
- [x] Browser verification (desktop + mobile)
- [x] Data integrity verification
- [x] Отчёт создан
