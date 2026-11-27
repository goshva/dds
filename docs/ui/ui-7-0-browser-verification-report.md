# UI-7.0 — Browser Verification & Responsive Audit

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Дата:** 2026-11-24 · **Статус:** ACCEPTED WITH LIMITATIONS  
**HEAD:** `099f37b2588c2c1cb821faabf81d507f14f14818` · **Ветка:** `main`  
**Продукционный билд:** `dist/web/` на порту `127.0.0.1:5199`  
**API-сервер:** `127.0.0.1:8787` (Hono), проксируется на 5199

---

## 1. Environment

| Параметр | Значение |
|---|---|
| ОС | Windows 11 (x64) |
| Bun | v1.4.4 |
| Vite | 8.3.8 (rolldown) |
| Hono | 4.13.21 |
| Production build | `bun run ui:build` → `dist/web/` (33.5 KB JS gzip 11.2 KB) |
| Тестовый сервер | `dist/web` + кастомный Bun-прокси `/api/*` → 8787 (порт 5199) |
| Vite dev (5173) | `/api/*` прокси → 8787 (проблема с `api/client.ts`) |
| Браузер | Koda Desktop Chromium (snapshot + screenshot) |

### Git status

| Файлы | Статус |
|---|---|
| `src/server/routes.ts` | **M** (изменено) |
| `src/web/main.ts` | **M** (добавлена страница forecast-quality) |
| `docs/ui/ui-4-*.md` | **??** (untracked, 7 файлов) |
| `src/server/forecast-evaluation.ts` | **??** (untracked) |
| `src/server/services/forecasting-read-models.ts` | **??** (untracked) |
| `src/web/pages/forecast-quality.ts` | **??** (untracked) |
| `src/web/templates/` | **??** (untracked, partials shell) |
| `tests/server/forecast-*.ts` | **??** (untracked, 2 файла) |
| `tests/web/forecast-quality.test.ts` | **??** (untracked) |
| `nul` | **??** (untracked, пустой файл) |

---

## 2. Launch Results

| Компонент | Порт | Статус |
|---|---|---|
| Vite dev server | 5173 | ✅ Запущен, но `/api/*` прокси перехватывает все запросы, включая `.ts` файлы |
| API-сервер (Hono) | 8787 | ✅ 10 GET-эндпоинтов, envelope `ok`/`not_available`/`error` |
| Production build | 5199 | ✅ `bun run ui:build` → `dist/web/`, кастомный прокси `/api/*` → 8787 |

**NOT_VERIFIED:** Vite dev на 5173 в production-сценариях (для UI-7 использован production build).

---

## 3. Desktop Results (1440 × 1000)

### 3.1 Overview `#overview`

| Проверка | Результат |
|---|---|
| Заголовок | ✅ «Обзор» + subtitle «магазин 7745 · Europe/Moscow · метрика qty_orders_delivered · slice 20624» |
| Sidebar | ✅ «АНАЛИТИКА» с 5 пунктами, активный «Обзор» подсвечен |
| Topbar | ✅ «DSS · история и аналитика», магазин 7745, источник: OK, обновлено |
| KPI «История» | ✅ Дней 906, Последний факт 1545, статусы OK |
| KPI «Теневой режим» | ✅ Shadow-снапшотов 8, Ожидают факта 6 (PENDING) |
| Актуальность | ✅ freshness: MATCH, manifest: OK, provenance drawer с checksum |
| График | ✅ Line chart с осью Y (2217–2744) |
| Полнота | ✅ Календарь 28 дней |
| Status badges | ✅ OK (зелёный), PENDING (янтарный), PROVISIONAL (синий) |
| Форматирование | ✅ Числа с пробелами-разделителями (1 545, 906) |
| Даты | ✅ 01.06.2024 — 23.11.2026 |

### 3.2 История заказов `#history/all`

| Проверка | Результат |
|---|---|
| Заголовок | ✅ «История заказов» + subtitle |
| Фильтры | ✅ Весь период, 30/90/180/365 дней, произвольный диапазон (DD.MM.YYYY), Применить, Сбросить |
| KPI «Показатели периода» | ✅ Всего заказов 1 583 459, Среднее 1 747,7, Максимум 2 744, Минимум 637, Календарных дней 906, Дней с данными 906 |
| Подпись KPI | ✅ «рассчитаны только по доступным фактическим значениям» |
| График | ✅ «Динамика доставленных заказов», единица измерения — заказы в день |
| Цвета KPI | ✅ Зелёный фон для OK-значений |

### 3.3 Качество данных `#quality`

| Проверка | Результат |
|---|---|
| Заголовок | ✅ «Качество данных» + «Полнота исторического ряда · 01.06.2024 — 23.11.2026» |
| Полнота | ✅ Календарных дней 906, Дней с данными 906, Отсутствующих значений 0, Доля заполненности 100.00 % |
| Формула fill ratio | ✅ `observationDays / calendarDays (дни с фактическими значениями ÷ календарные дни)` |
| Пропуски | ✅ Максимальная длина интервала: 0, таблица пустая, «Пропусков в календарном покрытии нет» |
| Календарь | ✅ Последние 28 дней, все ячейки зелёные (full) |
| Ограничения качества | ✅ Семантика PROVISIONAL, 7 bullet-пунктов ограничений |

### 3.4 Происхождение `#provenance`

| Проверка | Результат |
|---|---|
| Заголовок | ✅ «Происхождение данных» + «Источник, версия и актуальность · Магазин 7745 · Europe/Moscow» |
| KPI «Источник» | ✅ Метрика `qty_orders_delivered` (canonical: `delivered_orders_daily`), Slice 20624, Период 01.06.2024 — 23.11.2026, Последнее значение 1545 |
| KPI «Версия и актуальность» | ✅ Source: canonical CSV (read-only), checksum, version: normalized, manifest: OK, freshness: MATCH |
| Прогнозы и качество | ✅ Кнопка перехода на `#forecast-quality` |
| Status badges | ✅ freshness: MATCH (зелёный), PROVISIONAL (синий) |

### 3.5 Forecast Quality `#forecast-quality` (shadow, h=1)

| Проверка | Результат |
|---|---|
| Заголовок | ✅ «Качество прогнозов» + «shadow JSONL (shadow) · technicalFactCutoff 23.11.2026» |
| KPI | ✅ Полнота выборки: COMPLETE, Интерпретируемость: INSUFFICIENT (PENDING), Ожидают факта: 2 (PENDING), Исключено: 1/1 (PENDING), Конфликты: 0, Неизвестные: 0 |
| Предупреждения | ✅ 4 bullet-пункта (недостаточно наблюдений, семантика не подтверждена, несколько версий dataset_checksum, 2 ожидают факта) |
| Происхождение | ✅ Checksum, manifest: OK, freshness: MATCH, несколько версий dataset_checksum |
| Таблица моделей | ✅ rolling_7_day_mean (исключено: 0, переполнение: 0, полнота: COMPLETE), adaptive_baseline (аналогично) |

### 3.6 Дефекты Desktop

| ID | Экран | Проблема | Severity |
|---|---|---|---|
| **D-001** | forecast-quality | Маршрут `#forecast-quality/<mode>/<horizon>` (например `/shadow/1`) → «Некорректный диапазон · Некорректная дата начала · INVALID_RANGE» вместо данных прогноза | **P1** |

**Причина D-001:** `parseHash()` разбивает `#forecast-quality/shadow/1` на `[page, range, from, to]` → `page="forecast-quality"`, `range="shadow"`, `from="1"`, `to=""`. Функция `rangeToQuery()` вызывается **до** разветвления по страницам. Она проверяет `from="1"` на паттерн `\d{4}-\d{2}-\d{2}`, не совпадает и возвращает ошибку `Некорректная дата начала`. Ошибка отображается до того, как код доходит до `if (page === "forecast-quality")`.

**Файл исправления:** `src/web/main.ts` — функция `rangeToQuery()` должна пропускать валидацию дат для страницы `forecast-quality`, или `rangeToQuery` должен вызывать `page` как параметр.

---

## 4. Tablet Results (1024 × 768)

**NOT_VERIFIED** — Koda Desktop эмулирует `desktop` и `mobile`, но не имеет пресета tablet 1024×768. CSS `responsive.css` не содержит breakpoint 1024px.

**OBSERVATION:** `responsive.css` содержит только `@media (max-width: 768px)` для мобильных устройств. Tablet-разрешение 1024×768 не имеет специфичных стилей.

---

## 5. Mobile Results (390 × 844, iPhone 15 Pro)

### 5.1 Overview

| Проверка | Результат |
|---|---|
| Layout | ✅ Sidebar скрыт, кнопка «☰» в topbar |
| Заголовок | ✅ «Обзор» виден |
| KPI | ✅ Каскадная раскладка (одна колонка) |
| Данные | ✅ Дней 906, Последний факт 1545, Shadow 8, Ожидают 6 |
| Актуальность | ✅ freshness: MATCH, manifest: OK |
| Проверка overflow | ✅ Нет горизонтального скролла |

### 5.2 История `#history/all`

| Проверка | Результат |
|---|---|
| Layout | ✅ Каскадная раскладка, фильтры в одну колонку |
| KPI | ✅ 6 карточек (3×2 grid на mobile) |
| Даты | ✅ Формат DD.MM.YYYY в input |
| Проверка overflow | ✅ Нет горизонтального скролла |

### 5.3 Качество `#quality`

| Проверка | Результат |
|---|---|
| Layout | ✅ Каскадная раскладка |
| Календарь | ✅ Последние 28 дней в одну колонку (ячейки 7×4) |
| Пропуски | ✅ Таблица адаптивна |
| Ограничения | ✅ Bullet-пункты корректно обернуты |
| Проверка overflow | ✅ Нет горизонтального скролла |

### 5.4 Происхождение `#provenance`

| Проверка | Результат |
|---|---|
| KPI | ✅ Метрика, Slice, Период, Последнее значение |
| Checksum | ✅ Полные хэши видны, прокручиваются |
| Проверка overflow | ✅ Нет горизонтального скролла |

### 5.5 Forecast Quality `#forecast-quality`

| Проверка | Результат |
|---|---|
| Layout | ✅ Каскадная раскладка |
| Предупреждения | ✅ Bullet-пункты корректно обернуты |
| Происхождение | ✅ Checksum прокручивается |
| Проверка overflow | ✅ Нет горизонтального скролла |

### 5.6 Дефекты Mobile

| ID | Экран | Проблема | Severity |
|---|---|---|---|
| **D-002** | forecast-quality | Маршрут `#forecast-quality/<mode>/<horizon>` → та же ошибка, что D-001 (INVALID_RANGE) | **P1** |

---

## 6. API and Network

### 6.1 Endpoints tested

| Endpoint | Method | Статус | Результат |
|---|---|---|---|
| `/api/health` | GET | 200 | `ok` |
| `/api/v1/overview` | GET | 200 | Полный DTO с history/shadow/replay/provenance |
| `/api/v1/history?limit=1000` | GET | 200 | 906 точек ряда |
| `/api/v1/history/coverage` | GET | 200 | Полнота COMPLETE, gaps: 0 |
| `/api/v1/shadow/forecasts?limit=20` | GET | 200 | 8 shadow-снапшотов |
| `/api/v1/forecasts/quality?mode=shadow&horizon=1` | GET | 200 | Полное DTO с independentMetrics |
| `/api/v1/forecasts/quality?mode=replay&horizon=1` | GET | 200 | Полное DTO с independentMetrics |
| `/api/v1/forecasts` | GET | 200 | Список прогнозов |
| `/api/v1/forecasts/errors` | GET | 200 | Список ошибок |

### 6.2 Security checks

| Проверка | Результат |
|---|---|
| POST/PUT/DELETE | ✅ Нет ни одного (только GET) |
| Host/Origin guard | ✅ Проверено: `app.ts` фильтрует по `ALLOWED_HOSTS` и `ALLOWED_ORIGINS` |
| Host: localhost | ✅ Отклоняется (только `127.0.0.1` в allowlist) |
| Ошибки API | ✅ Все содержат `eventId` |

---

## 7. Console Errors

| Уровень | Количество | Детали |
|---|---|---|
| error | **0** | Пусто |
| warn | 0 | Пусто |
| info | 2 | `[vite] connecting...`, `[vite] connected` (dev-сервер) |

**Production build (порт 5199):** console полностью чистый, 0 ошибок.

---

## 8. Overflow Results

| Экран | Desktop | Mobile |
|---|---|---|
| Overview | ✅ Нет overflow | ✅ Нет overflow |
| History | ✅ Нет overflow | ✅ Нет overflow |
| Quality | ✅ Нет overflow | ✅ Нет overflow |
| Provenance | ✅ Нет overflow | ✅ Нет overflow |
| Forecast Quality | ✅ Нет overflow | ✅ Нет overflow |

**Длина хэшей:** checksums в `provenance` не обрезаются, но не вызывают overflow — текст переносится (`word-wrap: break-word` или аналогично через CSS tokens).

---

## 9. PII Results

| Проверка | Результат |
|---|---|
| ФИО сотрудников | ✅ Отсутствуют |
| Телефон/Email | ✅ Отсутствуют |
| Персональные идентификаторы | ✅ Отсутствуют |
| Паспортные данные | ✅ Отсутствуют |
| PII в API-ответах | ✅ Все endpoint'ы возвращают агрегаты и метаданные без PII |

**OBSERVATION:** Прогнозные модели (rolling_7_day_mean, adaptive_baseline) — технические имена, не содержат PII.

---

## 10. Screenshots / Evidence

| Скриншот | Страница | Разрешение | URL |
|---|---|---|---|
| 1 | Overview | Desktop | #overview |
| 2 | History | Desktop | #history/all |
| 3 | Quality | Desktop | #quality |
| 4 | Provenance | Desktop | #provenance |
| 5 | Forecast Quality | Desktop | #forecast-quality |
| 6 | Overview | Mobile | #overview |
| 7 | History | Mobile | #history/all |
| 8 | Quality | Mobile | #quality |
| 9 | Provenance | Mobile | #provenance |
| 10 | Forecast Quality | Mobile | #forecast-quality |
| 11 | Forecast Quality (bug) | Desktop | #forecast-quality/shadow/3 |
| 12 | Forecast Quality (bug) | Mobile | #forecast-quality/shadow/1 |

---

## 11. Defect Register

### D-001 — INVALID_RANGE на `#forecast-quality/<mode>/<horizon>`

| Параметр | Значение |
|---|---|
| **ID** | D-001 |
| **Severity** | **P1** (блокирует доступ к странице прогнозов по прямой ссылке) |
| **Экран** | Forecast Quality |
| **Разрешение** | Desktop + Mobile |
| **Шаги** | 1. Открыть `http://127.0.0.1:5199/#forecast-quality/shadow/1` |
| | 2. Дождаться загрузки |
| **Факт** | «Некорректный диапазон · Некорректная дата начала · INVALID_RANGE» |
| **Ожидалось** | Данные прогноза для mode=shadow, horizon=1 |
| **Причина** | `parseHash()` разбивает хеш на `[page, range, from, to]`. Для `#forecast-quality/shadow/1`: `from="1"`. `rangeToQuery()` проверяет `from` на `\d{4}-\d{2}-\d{2}`, не совпадает → ошибка. Проверка `page === "forecast-quality"` происходит **после** `rangeToQuery()`. |
| **Файл** | `src/web/main.ts`, функция `rangeToQuery()` |
| **Исправление** | Передать `page` в `rangeToQuery()` и пропустить валидацию дат для `forecast-quality`, либо вызвать `rangeToQuery()` только для страниц `history`/`overview`/`quality`/`provenance` |

### D-002 — Vite proxy `/api/*` перехватывает `api/client.ts`

| Параметр | Значение |
|---|---|
| **ID** | D-002 |
| **Severity** | **P2** (не влияет на production build, только на Vite dev-сервер) |
| **Экран** | Vite dev (5173) |
| **Разрешение** | Все |
| **Шаги** | 1. Запустить `bun run ui:dev` (порт 5173) |
| | 2. Открыть `http://127.0.0.1:5173/api/client.ts` |
| **Факт** | HTTP 404, ответ Hono: `{"status":"error","error":{"code":"NOT_FOUND"...}}` |
| **Ожидалось** | HTTP 200, TypeScript-код модуля |
| **Причина** | Vite-прокси `"/api": { target: "http://127.0.0.1:8787" }` перенаправляет **все** `/api/*` на Hono, включая статические `.ts` файлы, которые Vite должен обслуживать сам |
| **Файл** | `vite.config.ts` |
| **Исправление** | Добавить `ws: true` и/или настроить `proxy` для `/api/v1/**` вместо `/api/**` |

**NOT_VERIFIED:** Vite dev на 5173 — production-билд на 5199 работает корректно (прокси реализован кастомно, не через Vite).

---

## 12. NOT_VERIFIED

| Область | Причина |
|---|---|
| Tablet 1024×768 | Koda Desktop не имеет пресета tablet; CSS `responsive.css` не содержит breakpoint 1024px |
| Tablet 768px | Эмулируется как mobile (390px), визуальная проверка не проводилась |
| Браузерная адаптивность — Safari/Firefox | Проверено только в Chromium (Koda Desktop) |
| Производительность рендеринга | Не измерялась (FPS, TTI) |
| Touch-интеракции (скролл, кнопки) | Только визуальная проверка, не интерактивная |
| keyboard navigation | Не проверялась (tabindex, focus-visible) |
| ARIA-атрибуты | Не проверялись (role, aria-label) |
| Доступность WCAG | Не проводилась автоматическая проверка (axe, Lighthouse) |

---

## 13. Recommendation

**Статус: ACCEPTED WITH LIMITATIONS**

### Что работает:
1. ✅ Все 5 страниц загружаются и отображаются на desktop и mobile
2. ✅ Production build корректен (33.5 KB JS)
3. ✅ API-эндпоинты возвращают валидные DTO
4. ✅ Нет PII в UI и API
5. ✅ Нет console ошибок
6. ✅ Нет горизонтального overflow
7. ✅ Статусы (OK/PENDING/PROVISIONAL) отображаются корректно
8. ✅ Форматирование чисел и дат корректно
9. ✅ Sidebar/collapsible для mobile работает

### Что требует исправления:
1. 🔴 **D-001 (P1):** `rangeToQuery` ломает `#forecast-quality/<mode>/<horizon>` — страница недоступна по прямой ссылке
2. 🟡 **D-002 (P2):** Vite proxy `/api/*` перехватывает `api/client.ts` — влияет только на dev-сервер

### Что не проверялось:
- Tablet 1024px
- Производительность
- Доступность (WCAG)
- Touch-интеракции
- Keyboard navigation
