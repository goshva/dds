# TPL-3 — перечень расхождений

**Дата:** 2026-11-27 · **Всего расхождений:** 7 (P0 — 0, P1 — 1, P2 — 4, P3 — 2)

| Поле | Значение |
|---|---|
| ID | Уникальный идентификатор |
| Page | Страница |
| Viewport | Разрешение |
| Severity | P0–P3 |
| Root cause | Подтверждённая причина или NOT_VERIFIED |
| Scope | Reference / Production / Both |

---

## TPL3-D-01 — незавершённая отрисовка production на части скриншотов

| Поле | Значение |
|---|---|
| ID | TPL3-D-01 |
| Page | quality, provenance, forecast-quality, forecast-diagnostics |
| Viewport | 1440, 1280, 1024, 768, 390, 360 (11 комбинаций) |
| Severity | **P1** |
| Reference | полная композиция страницы |
| Production | `ink` 0.032–0.049 при `ink` эталона 0.22–0.27 |
| Difference | на снимке отсутствует основное содержимое страницы |
| Root cause | **NOT_VERIFIED**: наиболее вероятен захват до завершения загрузки данных (та же страница при 1024 px содержит полную отрисовку, `ink` 0.330) |
| Source file | `src/web/main.ts` (асинхронный рендер после запросов) |
| Recommendation | повторить съёмку с увеличенным `--virtual-time-budget` (12–15 с) и/или ожиданием сетевого простоя; только затем делать выводы о дефектах вёрстки |
| Scope | Both (процедура аудита и, при подтверждении, UI) |
| Статус | NOT_IMPLEMENTED (повторная съёмка не выполнялась) |

## TPL3-D-02 — отсутствует модификатор статуса календаря `unknown`

| Поле | Значение |
|---|---|
| ID | TPL3-D-02 |
| Page | quality, overview |
| Viewport | все |
| Severity | **P2** |
| Reference | `<div class="ds-calendar-day ds-calendar-day--unknown">` — отдельное оформление |
| Production | модификатор не определён; дни со статусом `unknown` получают базовое оформление |
| Difference | неизвестные дни визуально неотличимы от общего состояния «нет данных» |
| Root cause | **Подтверждена**: `src/web/components/data.ts` формирует класс `ds-calendar-day--${day.status}` для статусов `full/partial/missing/unknown` (`CalendarDayStatus`), а `src/web/styles/components.css` определяет только `.ds-calendar-day`, `--full`, `--partial`, `--missing` |
| Source file | `src/web/styles/components.css` (блок `.ds-calendar-day*`), `src/web/components/data.ts` |
| Recommendation | добавить `.ds-calendar-day--unknown` с нейтральным оформлением (или явно маппить `unknown` в существующий класс) — отдельной задачей, с изменением production CSS |
| Scope | Production |
| Статус | NOT_IMPLEMENTED (production CSS в области TPL-2/TPL-3 не изменяется) |

## TPL3-D-03 — имена файлов двух пар не совпадали с матрицей

| Поле | Значение |
|---|---|
| ID | TPL3-D-03 |
| Page | quality |
| Viewport | 1440, 768 |
| Severity | **P3** |
| Reference | снимок `quality-reference-1440.png` / `-768.png` |
| Production | снимки были созданы как `quality-1440.png` / `quality-768.png` (без суффикса `-production`) |
| Difference | имена файлов не соответствовали матрице; метрики для этих двух пар не измерялись |
| Root cause | **Подтверждена**: ошибка именования в скрипте повторной съёмки; файлы переименованы к матрице |
| Source file | — |
| Recommendation | повторить съёмку этих двух комбинаций вместе с TPL3-D-01 |
| Scope | Both (артефакты аудита) |
| Статус | RESOLVED (имена приведены к матрице; метрики не измерялись) |

## TPL3-D-04 — статическая раздача production UI не предусмотрена API-сервером

| Поле | Значение |
|---|---|
| ID | TPL3-D-04 |
| Page | все |
| Viewport | — |
| Severity | **P2** |
| Reference | `docs/ui/reference/README.md` описывает открытие эталонов напрямую |
| Production | `GET http://127.0.0.1:8787/` → 404 при существующем `dist/web/index.html` |
| Difference | собранный интерфейс не раздаётся командой `api:start`; для аудита потребовался `ui:dev` |
| Root cause | **Подтверждена**: `src/server/index.ts` создаёт `Bun.serve({ fetch: app.fetch })` без обработчика статики |
| Source file | `src/server/index.ts` |
| Recommendation | либо добавить статическую раздачу `dist/web` в отдельной задаче, либо уточнить документацию запуска (интерфейс раздаётся Vite) |
| Scope | Production / документация |
| Статус | RESOLVED (имена приведены к матрице; метрики не измерялись) |

## TPL3-D-05 — различия данных между эталоном и production

| Поле | Значение |
|---|---|
| ID | TPL3-D-05 |
| Page | все |
| Viewport | все |
| Severity | **P3** |
| Reference | фиксированные синтетические значения и полный набор блоков |
| Production | реальные значения, зависящие от доступности данных |
| Difference | различаются тексты, длины подписей и геометрия; корреляция профиля строк средняя 0.153 |
| Root cause | **Подтверждена**: разные источники данных (синтетика против read-model) |
| Source file | `docs/ui/reference/**`, `src/web/pages/**` |
| Recommendation | не является дефектом; учитывать при оценке метрик сходства |
| Scope | Both (ожидаемое различие) |
| Статус | NOT_APPLICABLE |

## TPL3-D-06 — служебные элементы эталонов

| Поле | Значение |
|---|---|
| ID | TPL3-D-06 |
| Page | все |
| Viewport | все |
| Severity | **P3** |
| Reference | баннер `REFERENCE DATA — NOT PRODUCTION DATA`, ссылка «Индекс», статус источника `REFERENCE` |
| Production | этих элементов нет |
| Difference | эталон содержит навигацию и маркировку, которых нет в приложении |
| Root cause | **Подтверждена**: требование изоляции эталонов |
| Source file | `docs/ui/reference/**` |
| Recommendation | сохранять: элементы обязательны для маркировки синтетических данных |
| Scope | Reference |
| Статус | NOT_APPLICABLE |

## TPL3-D-07 — расхождение сверхширокого диапазона

| Поле | Значение |
|---|---|
| ID | TPL3-D-07 |
| Page | все |
| Viewport | 1440 |
| Severity | **P3** |
| Reference | production-стиль `@media (min-width: 1441px)` не активируется на 1440 px |
| Production | то же поведение |
| Difference | отсутствует: оба представления используют одинаковый медиазапрос |
| Root cause | **Подтверждена**: единый `responsive.css` |
| Source file | `src/web/styles/responsive.css` |
| Recommendation | при аудите на 1441+ px ожидать одинакового поведения |
| Scope | Both |
| Статус | NOT_APPLICABLE |

---

## Сводка рекомендаций

1. Повторить съёмку 11 «пустых» и 2 отсутствующих комбинаций с увеличенным бюджетом ожидания (TPL3-D-01, TPL3-D-03) — до любых выводов о вёрстке.
2. Рассмотреть отдельную задачу на добавление `.ds-calendar-day--unknown` (TPL3-D-02).
3. Уточнить способ раздачи production UI (TPL3-D-04).
4. Просмотреть изображения человеком: модель не имеет визуального восприятия, поэтому косметические дефекты (P3) могли остаться незамеченными.

**Production-дефекты в рамках TPL-2/TPL-3 не исправлялись.**
