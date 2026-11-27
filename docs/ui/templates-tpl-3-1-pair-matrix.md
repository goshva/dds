# TPL-3.1 — матрица пар (36 из 36)

**Дата:** 2026-11-27 · **Источник:** `docs/ui/reference/screenshots/recheck/metrics.json`, `metrics-reference.json`
**Съёмка:** Chrome for Testing 159.0.8154.6 через DevTools Protocol, с ожиданием готовности (шрифты, изображения, отсутствие skeleton, наличие контента, `apiStatus = 200`).

## Статусы

| Статус | Значение | Количество |
|---|---|---:|
| PASS | геометрия и состав блоков совпадают | 18 |
| PASS_WITH_DATA_DIFFERENCES | геометрия совпадает, число KPI/таблиц или состояние данных отличается | 18 |
| INCOMPLETE_RENDER | готовность не подтверждена | 0 |
| LAYOUT_MISMATCH | расхождение сетки или поведения | 0 |
| NOT_VERIFIED | снимок или метрика отсутствуют | 0 |

## Матрица

`Δ` — модуль разницы между эталоном и production; значения в пикселях. Sidebar и content совпадают во всех парах (Δ = 0).

| Страница | Ширина | Статус | Sidebar (ref/prod) | Content (ref/prod) | Topbar h | KPI (ref/prod) | Таблиц (ref/prod) | Overflow | Бургер | Примечание |
|---|---:|---|---:|---:|---:|---:|---:|---|---|---|
| overview | 1440 | PASS | 246 / 246 | 1179 / 1179 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| overview | 1280 | PASS | 246 / 246 | 1019 / 1019 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| overview | 1024 | PASS | 218 / 218 | 791 / 791 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| overview | 768 | PASS | 260 / 260 | 753 / 753 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | мобильная навигация совпадает |
| overview | 390 | PASS | 260 / 260 | 390 / 390 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | — |
| overview | 360 | PASS | 260 / 260 | 360 / 360 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | — |
| history | 1440 | PASS | 246 / 246 | 1179 / 1179 | 76 / 76 | 6 / 6 | 1 / 1 | нет | скрыт | — |
| history | 1280 | PASS | 246 / 246 | 1019 / 1019 | 76 / 76 | 6 / 6 | 1 / 1 | нет | скрыт | — |
| history | 1024 | PASS | 218 / 218 | 791 / 791 | 76 / 76 | 6 / 6 | 1 / 1 | нет | скрыт | — |
| history | 768 | PASS | 260 / 260 | 753 / 753 | 68 / 68 | 6 / 6 | 1 / 1 | нет | виден | — |
| history | 390 | PASS | 260 / 260 | 390 / 390 | 68 / 68 | 6 / 6 | 1 / 1 | нет | виден | — |
| history | 360 | PASS | 260 / 260 | 360 / 360 | 68 / 68 | 6 / 6 | 1 / 1 | нет | виден | — |
| quality | 1440 | PASS | 246 / 246 | 1179 / 1179 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| quality | 1280 | PASS | 246 / 246 | 1019 / 1019 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| quality | 1024 | PASS | 218 / 218 | 791 / 791 | 76 / 76 | 4 / 4 | 1 / 1 | нет | скрыт | — |
| quality | 768 | PASS | 260 / 260 | 753 / 753 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | — |
| quality | 390 | PASS | 260 / 260 | 390 / 390 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | — |
| quality | 360 | PASS | 260 / 260 | 360 / 360 | 68 / 68 | 4 / 4 | 1 / 1 | нет | виден | — |
| provenance | 1440 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1179 / 1179 | 76 / 76 | 2 / 4 | 0 / 0 | нет | скрыт | production показывает больше показателей источника |
| provenance | 1280 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1019 / 1019 | 76 / 76 | 2 / 4 | 0 / 0 | нет | скрыт | то же |
| provenance | 1024 | PASS_WITH_DATA_DIFFERENCES | 218 / 218 | 791 / 791 | 76 / 76 | 2 / 4 | 0 / 0 | нет | скрыт | то же |
| provenance | 768 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 753 / 753 | 68 / 68 | 2 / 4 | 0 / 0 | нет | виден | то же |
| provenance | 390 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 390 / 390 | 68 / 68 | 2 / 4 | 0 / 0 | нет | виден | то же |
| provenance | 360 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 360 / 360 | 68 / 68 | 2 / 4 | 0 / 0 | нет | виден | то же |
| forecast-quality | 1440 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1179 / 1179 | 76 / 76 | 16 / 16 | 0 / 1 | нет | скрыт | production добавляет таблицу диагностики метрик |
| forecast-quality | 1280 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1019 / 1019 | 76 / 76 | 16 / 16 | 0 / 1 | нет | скрыт | то же |
| forecast-quality | 1024 | PASS_WITH_DATA_DIFFERENCES | 218 / 218 | 791 / 791 | 76 / 76 | 16 / 16 | 0 / 1 | нет | скрыт | то же |
| forecast-quality | 768 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 753 / 753 | 68 / 68 | 16 / 16 | 0 / 1 | нет | виден | то же |
| forecast-quality | 390 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 390 / 390 | 68 / 68 | 16 / 16 | 0 / 1 | нет | виден | то же |
| forecast-quality | 360 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 360 / 360 | 68 / 68 | 16 / 16 | 0 / 1 | нет | виден | то же |
| forecast-diagnostics | 1440 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1179 / 1179 | 76 / 76 | 4 / 8 | 1 / 1 | нет | скрыт | production: состояние отсутствия диагностических записей |
| forecast-diagnostics | 1280 | PASS_WITH_DATA_DIFFERENCES | 246 / 246 | 1019 / 1019 | 76 / 76 | 4 / 8 | 1 / 1 | нет | скрыт | то же |
| forecast-diagnostics | 1024 | PASS_WITH_DATA_DIFFERENCES | 218 / 218 | 791 / 791 | 76 / 76 | 4 / 8 | 1 / 1 | нет | скрыт | то же |
| forecast-diagnostics | 768 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 753 / 753 | 68 / 68 | 4 / 8 | 1 / 1 | нет | виден | то же |
| forecast-diagnostics | 390 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 390 / 390 | 68 / 68 | 4 / 8 | 1 / 1 | нет | виден | то же |
| forecast-diagnostics | 360 | PASS_WITH_DATA_DIFFERENCES | 260 / 260 | 360 / 360 | 68 / 68 | 4 / 8 | 1 / 1 | нет | виден | то же |

## Артефакты

- снимки: `docs/ui/reference/screenshots/recheck/<page>-<kind>-<width>.png` (72 файла);
- метрики: `metrics.json` (полный прогон), `metrics-reference.json` (пересъёмка эталонов после исправления CSS);
- предыдущие наборы (`screenshots/reference`, `screenshots/production`) сохранены без изменений.

## Пояснения к статусам

- PASS — совпадают геометрия, число показателей, число таблиц и поведение мобильной навигации.
- PASS_WITH_DATA_DIFFERENCES — совпадают геометрия и поведение; отличаются состав показателей, число таблиц или состояние данных. Различие объясняется разными источниками: синтетическая композиция эталона против реального read-model.
- Overflow проверялся как `documentElement.scrollWidth > innerWidth + 1` — ни в одной из 72 съёмок превышения нет.
