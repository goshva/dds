# HTML-разметка DSS UI: архитектура и источники

**Обновлено:** TPL-4.4 · **Статус:** каталог legacy partials удалён

## Источник HTML-разметки

Единственный источник HTML приложения — TypeScript:

- `src/web/components/` — атомарные компоненты (`shell.ts`, `cards.ts`, `charts.ts`, `data.ts`, `states.ts`);
- `src/web/pages/` и `src/web/main.ts` — композиция страниц, маршрутизация и состояния;
- `src/web/lib/format.ts` — экранирование (`escapeHtml`), доверенная разметка (`trusted`, `TrustedHtml`) и безопасные ссылки (`safeHref`, `isSafeHref`).

Все динамические значения проходят `escapeHtml`; в доверенные слоты (`sidebar`, `topbar`, `content`, `brand`, `safeHref`, `right`, `body`, `chart`, `legend`, `kpiCard`, `statusBadge`) попадает только разметка, созданная компонентами.

## Эталонные страницы

Актуальная визуальная документация разметки: `docs/ui/reference/` — HTML-эталоны шести страниц, собираемые напрямую из production-компонентов:

```bash
bun tools/reference/generate.ts
```

Генератор детерминирован, использует типизированные синтетические фикстуры, не обращается к API, SQLite и JSONL, и помечает данные как `REFERENCE DATA — NOT PRODUCTION DATA`.

## Удалённый каталог

Каталог `src/web/templates/partials/` (22 HTML-файла) **удалён** в рамках TPL-4.4.

Причины:

- ни один файл не использовался production runtime (проверено дважды: TPL-4.2 STAGE B и TPL-4.4);
- ни один файл не участвовал в сборке: в `dist/web` попадал только `index.html`;
- содержимое дублировало разметку TypeScript-компонентов и расходилось с их фактическим контрактом (`data-table`, `loading-state`, `kpi-card`, графики, `history-filters`);
- поддержка синхронизации вручную противоречила принципу единственного источника разметки;
- explicit-генерация partials без дублирования HTML признана нецелесообразной (TPL-4.2 STAGE B: `NO_GENERATOR_RECOMMENDED`).

Исторические документы аудита (`docs/ui/templates-inventory.md`, `docs/ui/templates-contract.md`, отчёты `docs/ui/templates-tpl-*`) сохранены как след проверок и **не описывают действующий механизм**.

## Правила для разработчиков

- Разметку компонентов меняйте только в `src/web/components/` и `src/web/pages/`.
- Не воссоздавайте каталог partials и не поддерживайте параллельную копию разметки.
- Не вводите шаблонный движок, реестр шаблонов или runtime-renderer: приложение формирует HTML напрямую в TypeScript.
- После изменения разметки обновляйте эталоны командой `bun tools/reference/generate.ts` и проверяйте разницу в `docs/ui/reference/`.
- Безопасность: любые новые значения из API проходят `escapeHtml`; новые доверенные слоты не добавляются без отдельного теста безопасности.

## Проверки

- `bun test tests/web` — компоненты, генератор эталонов, инварианты безопасности и архитектуры;
- `bun test tests/server` — API и источники;
- `bunx tsc --noEmit` — строгая типизация;
- `bun run ui:build` — сборка интерфейса.
