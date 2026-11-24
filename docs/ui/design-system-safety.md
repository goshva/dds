# UI-1.1 — контракт безопасности дизайн-системы

**Дата:** 2026-11-24 · **Статус:** действует · **Область:** `src/web/**` (UI-1/UI-1.1)

---

## 1. Граница доверенной разметки (FACT)

| Категория | Тип | Правило |
|---|---|---|
| разметка, созданная компонентами DSS | `TrustedHtml` (`string & { __trustedHtml }`) | только результат функций компонентов или `trusted(...)` в доверенном коде |
| динамические данные (API, файлы, ввод) | `string`, `number`, `unknown` | обязаны проходить `escapeHtml`; в слоты `TrustedHtml` не передаются |
| слоты разметки | `CardProps.body/right`, `ChartCardProps.chart/legend`, `AppShellProps.sidebar/topbar/content`, `PageHeaderProps.right` | принимают **только** `TrustedHtml` |

Компилятор TypeScript запрещает передачу обычной строки в слот: попытка даёт `TS2322`. Проверено (FACT): до приведения playground к `trusted(...)` сборка падала с этой ошибкой.

## 2. Обязанности компонентов (FACT)

- Все динамические значения экранируются через `escapeHtml`: `title`, `subtitle`, `label`, `value`, `note`, `source`, `checksum`, `version`, ячейки таблицы, `caption`, `emptyText`, `date`, `detail`, `code`, `text`, `brandName`, `brandSub`, `shopNo`, `lastUpdated`, метки серий.
- Тексты статусов — из фиксированного словаря `statusLabel`, не из API.
- `loadingState` не использует случайные значения (детерминированные ширины).

## 3. Навигация (FACT)

| Функция | Поведение |
|---|---|
| `isSafeHref(href)` | `true` для `#…`, `./…`, `../…`, `/…`, относительных путей и `https?://…` без управляющих символов и кавычек |
| `isSafeHref` | `false` для `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative `//host`, пустых значений, управляющих символов |
| `safeHref(href)` | возвращает экранированный безопасный href или `#` |
| `sidebar` | использует `safeHref`; при подмене добавляет `data-ds-unsafe-href="1"` |

## 4. CSS-токены (FACT)

- `tokens.css` — единственный файл с литеральными цветами.
- `layout.css`, `components.css`, `charts.css`, `responsive.css` содержат только `var(--ds-*)`; проверяется тестом (`offenders` должен быть пустым).
- Добавлены токены UI-1.1: `--ds-white`, `--ds-brand-mark`, `--ds-nav-end`, `--ds-nav-muted`, `--ds-nav-link`, `--ds-nav-hover`, `--ds-nav-section`, `--ds-kpi-border`, `--ds-kpi-from`, `--ds-kpi-to`, `--ds-ok-border`, `--ds-pending-border`, `--ds-provisional-border`, `--ds-conflict-border`, `--ds-na-border`, `--ds-skeleton-base`, `--ds-skeleton-shine`, `--ds-topbar-bg`, `--ds-scrim-bg`.

## 5. Тесты-стражи (FACT)

| Тест | Что защищает |
|---|---|
| опасные схемы URL отклоняются | `isSafeHref` для 12 случаев, включая регистр `JaVaScRiPt:` |
| `safeHref` подменяет опасные ссылки | навигация |
| sidebar не вставляет опасную схему | разметка навигации |
| CSS-компоненты без литеральных цветов | правило дизайн-системы |
| динамика экранируется, слоты `TrustedHtml` | контракт разметки |

## 6. Ограничения

- `trusted()` не проверяет содержимое: он для кода, который сам формирует разметку. Значения API в него передавать запрещено.
- Визуальная проверка адаптивности остаётся критерием UI-7 (браузерная проверка).
- Vite и Hono не подключались (перенесено в UI-2 по решению владельца).
---

## 7. UI-1.2 — безопасность входа SVG (FACT)

- `Series.className` ограничен union `"actual" | "baseline" | "candidate" | "pending"`; соответствие CSS-классам задано внутренней картой `SERIES_CLASS`.
- Неизвестное значение (в том числе приведённое через `as never`) не интерполируется: `seriesCssClass()` возвращает класс `actual`, поэтому произвольная строка не может попасть в атрибут `class`.
- Размеры SVG (`width`, `height`) проходят `safeSize()`: конечные положительные числа, иначе значения по умолчанию — `NaN`/`Infinity`/отрицательные не попадают в `viewBox`.
- Динамические значения SVG: подписи (`title`) экранируются, координаты — числа через `toFixed`, значения `null` разрывают линию и не превращаются в ноль.
- `entry.name` не участвует в разметке (используется только как метаданные вызывающего кода).

## 8. Границы `trusted()` (FACT)

- `trusted()` — **доверенная точка создания HTML**, а не sanitizer: он не проверяет и не очищает содержимое.
- Передавать в `trusted()` значения API запрещено. Данные API обязаны проходить через компоненты DSS (`card`, `dataTable`, `kpiCard` и др.), которые экранируют динамику через `escapeHtml`.
- Типизация слотов сохранена: `body`, `right`, `chart`, `legend`, `sidebar`, `topbar`, `content` принимают только `TrustedHtml`.
- Единственная допустимая форма использования: `trusted(...)` вокруг разметки, собранной компонентами DSS в этом же вызове.