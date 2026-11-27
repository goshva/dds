# Reference-эталоны DSS UI (TPL-2)

**Назначение.** Независимый комплект HTML-эталонов шести страниц DSS UI для проверки структуры, композиции, размеров, отступов, визуальной иерархии и адаптивности.

**Статус:** reference artifact. Не является production UI, не подключается к API, не выполняет расчётов и не влияет на приложение.

## Состав

| Файл | Страница | Production-соответствие |
|---|---|---|
| `index.html` | индекс эталонов | — |
| `pages/overview.html` | Обзор | `#overview` (композиция в `src/web/main.ts`) |
| `pages/history.html` | История | `#history` (`historyPage`) |
| `pages/quality.html` | Качество данных | `#quality` (`dataQualityPage`) |
| `pages/provenance.html` | Происхождение | `#provenance` (`provenancePage`) |
| `pages/forecast-quality.html` | Прогнозы и качество | `#forecast-quality` (`forecastQualityPage`) |
| `pages/forecast-diagnostics.html` | Диагностика прогнозирования | `#forecast-diagnostics` (`forecastDiagnosticsPage`) |
| `assets/reference.css` | служебные стили reference + подключение production-стилей | — |
| `assets/reference.js` | мобильное меню и подсветка активного пункта | — |

## Правила

- разметка построена на утверждённых partials из `src/web/templates/partials/` (TPL-1/TPL-1.1);
- дизайн-система не дублируется: `assets/reference.css` подключает `src/web/styles/*`;
- данные синтетические и помечены баннером `REFERENCE DATA — NOT PRODUCTION DATA`;
- семантика сохранена: `PROVISIONAL`, `[Н/Д]` для отсутствующих значений, предупреждения не превращаются в ошибки;
- внешних зависимостей, CDN и сетевых запросов нет;
- скрипт изолирован и не содержит маршрутизатора.

## Открытие

- Файлы открываются напрямую в браузере. Например:

```bash
# Windows: открыть индекс эталонов
start docs/ui/reference/index.html
```

Проверка в headless-браузере (без установки зависимостей):

```bash
chrome.exe --headless=new --disable-gpu --window-size=1440,1000 \
  --screenshot=out.png "file:///C:/soft/bun/dds/docs/ui/reference/pages/history.html"
```

## Скриншоты визуального аудита

Каталог: `docs/ui/reference/screenshots/` (reference и production, шесть ширин). См. `docs/ui/templates-tpl-3-visual-audit.md`.

## Ограничения

- эталоны не подключены к API: состояния `loading`, `empty`, `error`, `not_available` показаны статически;
- интерактивность ограничена мобильным меню; фильтры и переключатели не выполняют переходов;
- расхождения с production фиксируются в `docs/ui/templates-tpl-3-discrepancies.md`, а не маскируются в эталоне.
