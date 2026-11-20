# Сводка Этапа 1.1 — phase_01_1_summary

**Дата:** 20 ноября 2026 г. · **<ФИО>:** Courier Analytics — Discovery & SQL Audit  
**Режим:** аудит; SQLite не изменялся; массовая дозагрузка не выполнялась; PII и секреты в отчёты не записаны.

---

## Вердикт этапа: **PASS_WITH_LIMITATIONS → ограничения сняты на уровне диагностики; полное закрытие требует дозагрузки (отдельное разрешение)**

Главное событие этапа: **доступ к Superset API восстановлен/подтверждён**. Ранешний `ECONNREFUSED` был временным (транспорт/VPN), что доказано послоевой диагностикой. <ФИО> переопределило выводы Этапа 1: часть «пропавших» объектов оказалась следствием двух багов выгрузки, а не недоступности источника.

---

## Задача 1 — Исправленная отчётность ✅
Файл: `discovery_corrected.md`
- Новая семантика Detail / Matched / Missing + формулы от ground-truth `.count` API.
- Ключевые пересчёты: charts coverage **18,9%** (3 766 detail из 19 920); datasets detail 0, но SQL есть в list-payload у 3 514/3 767; dashboards 100%.
- Реальные недостающие объекты: **14 920 charts** не в локальном list (усечение MAX_PAGES=50), 4 dataset ID отсутствуют.

## Задача 2 — Диагностика API ✅
Файлы: `api_transport_diagnostics.json`, `api_spot_checks.json`
- Все слои OK: DNS A → 10.210.254.19, TCP/443 56 мс, TLS (сертификат GlobalSign до 20.05.2027), HTTP `/health` 200, login успешен. Вердикт: **TRANSPORT_AND_AUTH_OK**.
- Найден баг URL: detail работает только **без завершающего слэша** (`/api/v1/dataset/4732` → 200, со слэшем → 404). Именно он + истёкший токен (5 660×401) дали «пустые» detail на Этапе 1.
- Уточнён синтаксис фильтров Superset 6.2: ключ `opr`, форма `operator` игнорируется молча.

## Задача 3 — Lineage ✅ (в границах локальных данных)
Файлы: `lineage_preview.json`, `lineage_relations.csv` (13 520 связей), `lineage_quality.md`
- Методы: position_json (7 900 пар, HIGH), chart.dashboards[] (1 757 пар, HIGH; 1 371 пар подтверждены обоими методами), datasource_id (3 755, VERIFIED), API-фильтр по 12 приоритетным dataset (+108, VERIFIED).
- Покрытие: 330/330 дашбордов имеют хотя бы одну связь с chart; 4 569 chart-ссылок ведут за пределы усечённого каталога — **не ошибка lineage, а следствие усечения выгрузки**.
- Таблица `relations` в SQLite **не изменялась** (подтверждено: relations=0, идентично бэкапу).

## Задача 4 — KPI-каталог ✅
Файлы: `kpi_source_matrix.md`, `kpi_source_matrix.json`
- 11 операционных KPI сопоставлены с 12 приоритетными датасетами по **фактическим полям SQL** (без выдуманных имён), с confidence HIGH/MEDIUM.
- Ядра: тёмные магазины/заказы (4732 → SLA, доставка, сборка, суммы), маршрутизация (cargo_main2/3/4, cargo_flags → distance/duration/is_late/флаги), HR-курьеры (hr_couriers* → найм/увольнение/продуктивность cnt_orders/enough_shifts_flg), логи (5247/5399 → events_qty по дням/неделям), зоны (7293 → positive/negative flow balance).
- Пробелы зафиксированы: metric-слой Superset недоступен без dataset_detail; 3 dataset без прямых charts.

---

## Целостность данных (финальная проверка перед сдачей)
| Проверка | Результат |
|----------|-----------|
| `PRAGMA quick_check` | ok |
| objects / relations | 13 193 / 0 — без изменений |
| Список таблиц и counts vs `backups/catalog-before-discovery.sqlite` | идентичны |
| sha256 бэкапа | 697c4dca… — совпадает с эталоном Этапа 0 |

## Что дальше (требует отдельного решения)
1. **Дозагрузка**: патч `discovery.ts` (слэш, MAX_PAGES≥200, ретрай на 401) → полные charts (19 920) и dataset_detail (SQL/columns/metrics).
2. После дозагрузки: пересборка lineage (ожидается ~полное покрытие chart→dataset) и расширение KPI-матрицы на все датасеты.
3. Только затем — переход к этапу SQL-аудита запросов.

## Артефакты этапа
```
reports/phase-01-1/
├── api_transport_diagnostics.json   (задача 2)
├── api_spot_checks.json             (задачи 1–2)
├── api_chart_links_priority.json    (задача 3, API-уточнение)
├── discovery_corrected.md           (задача 1)
├── lineage_preview.json             (задача 3)
├── lineage_relations.csv            (задача 3, 13 520 связей)
├── lineage_quality.md               (задача 3)
├── kpi_source_matrix.json           (задача 4)
├── kpi_source_matrix.md             (задача 4)
└── phase_01_1_summary.md            (этот файл)
```
Код: `src/phase1-1-{diagnostics,api-check,lineage,api-lineage,lineage-update,lineage-coverage,verify-method-a,kpi-catalog,kpi-fields}.ts` — все readonly.
