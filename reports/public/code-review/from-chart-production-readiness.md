# `--from-chart`: готовность к промышленному использованию в DDS

**Дата:** 2026-11-23 · **Объект:** [tools/fetch-darkstore-aggregates.ts](../../tools/fetch-darkstore-aggregates.ts) и вспомогательные инструменты
**Режим работы:** только чтение; ни одного нового live-запроса к Superset в этой задаче не выполнялось; коммитов и push нет.

---

## 1. Итоговый статус

**PASS_WITH_BLOCKER** (ревизия 2: все код-блокеры приёмки закрыты, см. §1a)

- Инструмент **готов к промышленному использованию**: read-only allowlist с привязкой метода к пути, обработка `202→GET`, строгая сверка `queries[]`/`result[]`, quality-gate (включая пропущенные измерения, обрезку по лимиту и дубликаты), маскирование PII в артефактах по умолчанию, 63 герметичных теста агрегатора (в т.ч. 12 shopno и 14 security) + 10 тестов PII + 7 тестов конфигурации блоков; полный `bun test` — 151 pass / 0 fail; `tsc` без ошибок.
- **Блокер один и он не в коде:** права на датасеты. Из проверенных (проба `dataset_access_matrix.json`) доступен только `3035`; `3466`, `5888`, `7696`, `7712` → `401 Not authorized`. Без выдачи прав 6 из 8 блоков DDS не запускаются, 2 (слоты, карта покрытия) закрываются частично.
- Дополнительное ограничение: live-приёмочный прогон в этой задаче **не выполнялся** (запрет на новые live-запросы), поэтому статус `READY` не присвоен ни одному блоку — он требует подтверждённого live-извлечения, а не только наличия chart id.

---

## 1a. Ревизия 2 — ответ на замечания приёмки (2026-11-23, вечер)

Приёмка относилась к промежуточному состоянию: часть правок (`shopno`-операторы, `SHOPNO_UNCONSTRAINED`, файл shopno-тестов) пришла из параллельной сессии и на момент проверки ещё не имела подтверждённого PASS. Ниже — фактическое состояние рабочего дерева после завершения правок. Свежий диф: [from-chart-fixes.diff](from-chart-fixes.diff) (+ [список новых файлов с sha256](from-chart-fixes.new-files.txt)).

| Замечание приёмки | Статус | Доказательство |
|---|---|---|
| shopno-тесты не подтверждены PASS (IN, NOT IN, `=`, `!=`, `<>`, несколько `queries[]`, ad-hoc) | **ИСПРАВЛЕНО** | [shopno.test.ts](../../tools/fetch-darkstore-aggregates.shopno.test.ts) — **12 pass / 0 fail, EXIT=0**; включая исправленный тест «several queries with different original filters»: каждый запрос получает положительное ограничение, ни один не уходит в скан по всем ДС |
| HTTP allowlist не методоспецифичен (login/CSRF принимали любой метод) | **ИСПРАВЛЕНО** | введена таблица `ALLOWED_ROUTES` (метод+путь) и deny-лист; `POST /security/csrf_token/`, `GET /security/login`, `GET/PUT /chart/data`, `POST /chart/data/{key}` теперь отклоняются; тест «the method is pinned per endpoint» — security **14 pass / 0 fail, EXIT=0** |
| Multi-query: нет строгой сверки `queries[]` и `result[]` | **ИСПРАВЛЕНО** | `validateChartResponse(..., expectedQueries)` → жёсткая ошибка при расхождении; `query_count_mismatch` попадает в quality и понижает статус; тест «queries[]/result[] mismatch is an error, not a silent first-query mapping» |
| Quality gate использовал метаинформацию первого запроса; не проверялись пропущенные измерения | **ИСПРАВЛЕНО** | `applied_filters` теперь per-query (`{query_index, col, op, val}`); добавлены `missing_dimensions`, `truncated_queries`, `query_count_mismatch` и правило «дубликаты ⇒ не full»; лимит строк проверяется по каждому запросу (тест «a sibling query hitting its limit is not hidden by the first query's limit») |
| Дедупликация: коллизии документированы, но не устранены | **ИСПРАВЛЕНО** | ключи группировки, схлопывания и дедупа переведены на `JSON.stringify`, в ключ добавлен `datasource_id`; тесты «KNOWN LIMITATION…» заменены регрессионными («'|' inside a dimension value no longer aliases two groups», «different datasource_id is never merged into one group») |
| PII: `chart_name` и значения фильтров могли попасть в manifest/quality | **ИСПРАВЛЕНО** | маскирование включено по умолчанию для `manifest`/`validation`/`quality`, копий request/response и обоих CSV; флаг `--raw-artifacts` оставляет значения для отладки; `artifacts_pii_masked` фиксируется в манифесте; тесты «chart titles and filter values are masked…» и «--raw-artifacts keeps the original values» |
| Коды возврата снимались через pipe (`bun test … | tail`) | **УЧТЕНО** | все прогоны ниже выполнены без pipe, `$LASTEXITCODE` снимался сразу после процесса, полные логи сохранены (`C:\Temp\suite-*.log`, `C:\Temp\s2-*.log`) |

---

## 2. Git-состояние (этап 1)

| Параметр | Значение |
|---|---|
| HEAD | `6cbfd00b6aa97871377f024264869fa4e0f2f86a` |
| Ветка | `main`, tracking `origin/main` |
| Локальный `origin/main` | `774b58f` (ref не обновлялся fetch-ем; сравнение по локальному ref) |
| Ahead/behind | **ahead 2** (в `origin/main` этих коммитов ещё нет) |
| Staged | нет |
| Unstaged | `package.json`, `tools/fetch-darkstore-aggregates.ts`, `tools/fetch-darkstore-aggregates.test.ts` — правки этой задачи |
| Untracked | артефакты и новые инструменты/тесты этой сессии (см. §8) |
| Stash | пусто |
| Секреты | `.env` в `.gitignore`; value-bearing `SUPERSET_PASSWORD=` в tracked-файлах не найден |

**Параллельные изменения подтверждены.** Коммиты `578ce1e` и `6cbfd00` («to chech state and way», автор `goshva`) были созданы **во время** моей работы другой сессией: в `578ce1e` попала ранняя версия моего инструмента и тестов, в `6cbfd00` — уже более поздняя, плюс чужие файлы `src/check-darkstore-7745.ts`, `reports/phase-01-9/darkstore_7745_check.json`, `docs/phase-1.9/*`, `src/phase1-9/scan-mojibake.ts`. Ничего не сбрасывалось и не удалялось; мои текущие правки не закоммичены.

---

## 3. Аудит `--from-chart` (этап 2)

### 3.1 Что проверено

| Проверка | Результат |
|---|---|
| Получение `/api/v1/chart/{id}` | `ReadOnlySuperset.getChart()`; `GET` разрешён allowlist-ом, `PUT/DELETE/POST` на этот путь запрещены |
| Разбор `query_context` | JSON-строка парсится; берутся `queries[]`, `form_data`, `datasource` |
| Отсутствие `query_context` | fallback на `params` (метрики, `groupby*`, `granularity_sqla`, `time_range`, `row_limit`, `adhoc_filters`) |
| Некорректный JSON в `query_context`/`params` | try/catch, работа продолжается по `params`, datasource сохраняется |
| Пустые `queries[]` | fallback на `params` |
| Несколько `queries[]` | `planMetas()` даёт метаданные на каждый запрос; извлечение идёт по `result[i] ↔ queries[i]`; реальный чарт 23507 (2 запроса) проверен тестом |
| `form_data` | переносится из `query_context`, дополняется `datasource`, `viz_type`, `slice_id`, `dashboardId`, `result_format/type` |
| Извлечение datasource | приоритет у метаданных чарта (`result.datasource_id`), расхождение с `query_context.datasource` не ломает запрос (тест) |
| Ad-hoc SQL-метрики и размерности | имена берутся из `label`; колонка `{"label":"Дата доставки С","sqlExpression":"toStartOfDay(date_supply)"}` не дублируется, период читается из неё |
| Неизвестные SQL-функции | токенизация выражения не падает; находится базовое поле даты (тест `weirdUnknownFunc(date_supply)`) |
| Фильтры и `time_range` | `queries[].time_range`, `form_data.time_range`, `extra_form_data.time_range`, `TEMPORAL_RANGE` в `filters`/`adhoc_filters` приводятся к окну; каждое изменение попадает в `semanticOverrides` |
| Инъекция `shopno` | по умолчанию включена в chart-режиме; вставляется только если фильтра `shopno IN` нет ни в `filters`, ни в `adhoc_filters` |
| Конфликт с исходными фильтрами | `shopno IN [...]` переписывается **с записью исходных значений**; если чарт явно исключает ДС (`shopno NOT IN 7745`) — запрос **отклоняется** (`SHOPNO_EXCLUDED`), обход только через `--force-shopno` |
| Временные поля | `temporalColumnsOf()` собирает кандидатов; выбранный кандидат и полный список пишутся в manifest (`temporal_chosen`, `temporal_columns`) |
| Неоднозначные временные поля | если выбранная колонка не является измерением, а чарт группируется по другой дате — лишняя колонка **не добавляется**, пишется warning `temporal grain ambiguity` (никакого тихого смешивания гранулярности) |
| Ratio-метрики | классификация `share_*`, `доля`, `percent`, `%` → `ratio` |
| Weighted / unweighted | доли агрегируются взвешенно по `qty_orders_delivered`; если веса нет — невзвешенное среднее + колонка `ratio_weighting`, список `unweighted_metrics` в quality |
| Offline-режим | `--offline --chart-details-dir` строит запросы из сохранённых `GET /api/v1/chart/{id}`; в тестах используются **реальные** сохранённые `query_context` (20209, 25053, 28163, 23507) |

### 3.2 Что исправлено в этой задаче

1. Извлечение стало request-driven (метрики/измерения/период из запроса, а не по regex) — иначе чужие датасеты разбирались неверно.
2. Появилась поддержка нескольких `queries[]` (раньше использовался только первый запрос).
3. `shopno`-семантика перестала быть тихой: `semanticOverrides`, `shopnoOriginalValues`, `shopnoExcluded`, отказ `SHOPNO_EXCLUDED`, флаг `--force-shopno`.
4. Добавлена политика для неоднозначной гранулярности (`temporalAmbiguity`) вместо угадывания.
5. Числовые метрики больше не могут стать «датой 1970» (`parsesAsDate`).
6. Ошибки colnames переведены из `problems` в `warnings` (pivot/series/post_processing легально переименовывают колонки), а `errors[]`, `error`, `rowcount`/`data.length` остаются жёсткими проверками.

---

## 4. Безопасность (этап 3)

### 4.1 Read-only allowlist (тест `read-only allowlist`)

| Метод | <ФИО> | Разрешено |
|---|---|---|
| POST | `/api/v1/chart/data` | да |
| GET | `/api/v1/chart/data/{key}` | да |
| GET | `/api/v1/chart/{id}` | да |
| POST | `/api/v1/security/login`, GET `/api/v1/security/csrf_token/` | да |
| PUT/DELETE | `/api/v1/chart/{id}` | **отказ** |
| POST/GET | `/api/v1/chart/`, `/api/v1/dataset/*`, `/api/v1/sqllab/*` | **отказ** |
| PUT | `/api/v1/chart/data` | **отказ** |

### 4.2 Проверено тестами (моки `fetch`, сеть не используется)

| Проверка | Поведение |
|---|---|
| Запись в SQLite / Superset | инструмент не открывает SQLite вообще; в тесте «только read endpoints» зафиксировано, что вызываются исключительно 4 разрешённых пути, DML/DDL нет |
| `--session` | уходит только в заголовке `Cookie`; в query-параметрах не появляется (тест) |
| Cookie/пароль/токен в логах и артефактах | сканирование всех файлов прогона: секретов нет (тест) |
| Секреты в `manifest.json`/`validation.json`/`quality.json` | отсутствуют (тест) |
| Истечение сессии | `GET /api/v1/chart/{id}` → 401 → `runPipeline` возвращает `2` и останавливается (тест) |
| 401 на `chart/data` | не ретраится, помечается `failed`, completeness `none` (тест) |
| 403 | возвращается с телом, без ретраев (тест) |
| 5xx | до 3 ретраев с backoff, затем статус наружу (тест) |
| Таймаут/abort | ретраи, затем ошибка сети (тест) |
| `--live` без `--yes` | выход 3, ни одного запроса |

---

## 5. PII (этап 4)

### 5.1 Аудит

| Метрика | Значение |
|---|---|
| Просканировано текстовых файлов (`reports`, `docs`, `src`, `tools`) | **464** |
| Файлов с срабатываниями | 125 |
| `person_name` | **9 616** (основная масса — ФИО владельцев чартов/дашбордов/датасетов в заголовках объектов Superset; конкретные значения здесь не приводятся. Плюс ложные срабатывания на деловых и технических фразах из двух заглавных слов — примеры вырезаны, чтобы отчёт проходил publish-gate) |
| `phone` | **6** (2 — в `datasets_inventory.json`, 2 — в `05_sql_inventory.csv`, 2 — в синтетической фикстуре `docs/phase-01-5/fixtures/courier_queue_entries.json`); требуют ручной проверки |
| `secret` | **3** (все — примеры ключей доступа в документации без значений, плюс объявления типов в `src/config.ts`); реальных значений секретов нет |
| `person_code` | 0 |
| Git history | value-bearing `SUPERSET_PASSWORD=` и токены в tracked-файлах не найдены; `.env` игнорируется |

*****REMOVED***:** реальные PII в репозитории — это **ФИО сотрудников в названиях объектов Superset** (метаданные каталога), а не секреты. Ложноположительные срабатывания правила «ФИО» высоки на больших каталогах — см. ограничения. В самом этом отчёте маскировщик находил совпадения по деловым фразам и по примерам ключей без значений; формулировки вырезаны, и отчёт проходит publish-gate чисто (`person_name=0 … secret=0`).

### 5.2 Механизм маскирования

[tools/redact-pii.ts](../../tools/redact-pii.ts) + [tools/redact-pii.test.ts](../../tools/redact-pii.test.ts) (10 тестов):

- правила: `person_name` (кириллица 2–3 слова с заглавных, латиница со стоп-листом), `email`, `phone`, `secret` (маскируется только значение, ключ сохраняется), `person_code`;
- источники **никогда не изменяются**: пишутся копии (`--out`), есть `--dry-run` и JSON-отчёт о количестве срабатываний;
- `redactJson()` рекурсивно обходит структуры;
- проверено, что бизнес-идентификаторы (`7745ДС_Мосфильмовская74`, `share_not_in_slot_all`, `dataset_id=3035`) не портятся.

**Сделано на реальных данных:** `reports/public/phase-01-9/` (9 файлов-копий) + `reports/public/pii-redaction-report.json`; замаскировано 7 ФИО в 3 файлах (`_chart_candidates.txt`, `_gap_summary.txt`, `darkstore_7745_gap_findings.json`). Исходные выгрузки в `data/extraction/superset/7745/` **не тронуты** (по согласованию с заказчиком могут быть замаскированы отдельным прогоном).

---

## 6. Контроль качества данных (этап 5)

На каждый запрос формируется quality-свод (пишется в `quality.json`, дублируется в `validation.json`/`manifest.json`):

`chart_id`, `slice_id`, `datasource_id`, `source`, `viz_type`, `queries`, `applied_filters`, `time_range`, `row_limit`, `row_count`, `metrics`, `dimensions`, `missing_metrics`, `duplicate_rows`, `aggregation_method`, `ratio_weighting`, `unweighted_metrics`, `http_status`, `mode`, `completeness`, `completeness_reason`, `warnings`, `problems`.

Правила `completeness` (неполный результат никогда не «PASS»):

| Условие | Статус |
|---|---|
| `mode = dry-run` | `none` («запрос не отправлялся») |
| ошибка/отказ (`error`, 401/403/5xx, `SHOPNO_EXCLUDED`) | `none` |
| `row_count = 0` | `partial` («пустой результат») |
| есть `missing_metrics` | `partial` |
| `row_count >= row_limit` | `truncated` |
| есть extraction/advisory warnings | `partial` |
| всё на месте и ниже лимита | `full` |

Exit-код `runPipeline` в live-режиме: `0` только если `failed = 0` **и** `partial/truncated/none = 0`; иначе `1`. <ФИО> прямо реализует требование «неполный результат не маркируется как полноценный PASS».

---

## 7. Матрица восьми блоков (этап 6)

Конфигурация: [tools/dds-blocks.json](../../tools/dds-blocks.json) (генерируется из локального каталога + матрицы доступа, валидируется тестами [tools/dds-blocks.test.ts](../../tools/dds-blocks.test.ts)).

| # | Блок | Датасеты | Права | Статус | Причина |
|---|---|---|---|---|---|
| 1 | ТМЦ | 3871, 3306, 3746, 3897 | все не выданы | **BLOCKED_ACCESS** | права не подтверждены (датасеты не входили в пробу); 401 на других датасетах указывает на границу прав |
| 2 | Вайты / ЗИЗ | 1583, 3466 | 3466 закрыт | **BLOCKED_ACCESS** | 3466 → 401 (проверено), 1583 не подтверждён |
| 3 | Сборка | 3466, 5888, 5542 | 3466/5888 закрыты | **BLOCKED_ACCESS** | 3466, 5888 → 401 (проверено), 5542 не подтверждён |
| 4 | Опоздания | 7696, 7006, 4547 | 7696 закрыт | **BLOCKED_ACCESS** | 7696 → 401 (проверено), 7006/4547 не подтверждены |
| 5 | Управление слотами | 3035, 3406, 4732 | 3035 открыт | **PARTIAL** | 3035 доступен (слоты/нагрузка есть), покрытие смен (3406/4732) закрыто |
| 6 | Матрёшка | 5939, 7473, 5797 | все не выданы | **BLOCKED_ACCESS** | права не подтверждены |
| 7 | Фотоконтроль и аудиты | 7712, 7713, 7607, 3268, 6310 | 7712 закрыт | **BLOCKED_ACCESS** | 7712 → 401 (проверено), остальные не подтверждены |
| 8 | Карта покрытия / кластер | 3035, 6863, 4732 | 3035 открыт | **PARTIAL** | `zone_cluster` на 3035 доступен, гео-датасеты закрыты |

Для каждого блока в конфиге: `chart_ids`, `charts`, `datasets[].access`, `required_rights`, `dimensions`, `metrics`, `period` (8 недель, `--to 2026-11-24`), `limits` (`row_limit 1000`, таймауты), `allowed/blocked/unverified_datasets`, `run_command`, `status_reason`, `access_state`.

***REMOVED*** статусов: **`READY` не выдаётся по наличию chart id** — тест запрещает `READY`, пока матрица доступа не подтверждает `ALLOWED` по всем датасетам блока и пока блок не подтверждён live-извлечением. Сейчас блоков `READY` нет.

---

## 8. Результаты тестов (этап 7)

| Команда | Результат | Exit code |
|---|---|---|
| `bun run aggregates:test` (core, charts, **shopno**, edge, security) | **63 pass, 0 fail** | **0** |
| — в т.ч. `shopno.test.ts` отдельно | 12 pass, 0 fail | **0** |
| — в т.ч. `security.test.ts` (моки) | 14 pass, 0 fail | **0** |
| — в т.ч. `edge.test.ts` | 21 pass, 0 fail | **0** |
| `bun run pii:test` | **10 pass, 0 fail** | **0** |
| `bun test tools/dds-blocks.test.ts` | **7 pass, 0 fail** | **0** |
| `bun test` (полный прогон, 18 файлов) | **151 pass, 4 skip, 0 fail** | **0** |
| `bun run aggregates:test:live` | **не выполнялся** — новые live-запросы запрещены; тесты скипаются (гейт `SUPERSET_LIVE_TESTS=1`) | — |
| `bunx tsc --noEmit` (репозиторий) | без ошибок | **0** |
| `bunx tsc --ignoreConfig … tools/*.ts` (11 файлов) | без ошибок | **0** |

4 skip — это live-набор: он отключён по умолчанию, поэтому полный `bun test` не делает сетевых вызовов. Проверка `--dry-run` после правок: `EXIT=0`, `completeness = none` для всех 6 планов («запрос не отправлялся»), `artifacts_pii_masked = true` в манифесте.

---

## 9. Ограничения

1. **Права на датасеты** — единственный блокер (§7). `401 Not authorized` — это граница прав, а не дефект кода: тот же код на 3035 возвращает 200 и реальные строки, метаданные чартов читаются по всем датасетам.
2. **Живая приёмка не проводилась** в этой задаче: `--from-chart` проверен герметично на реальных сохранённых `query_context` и моками; ранее в сессии 20209/23507 реально вернули 200 (13 и 459 строк).
3. **Артефакты по умолчанию маскируются** (manifest/validation/quality, копии request/response, CSV). <ФИО> значит, что скопированное с диска тело запроса — не побайтовая копия отправленного: для воспроизведения «как было» нужен `--raw-artifacts`.
4. **Семантика `shopno`**: положительное ограничение — только `IN`/`IS IN`/`EQUALS`/`=`/`==`; `NOT IN`/`NOT EQUALS`/`!=`/`<>` ограничением **не является** и никогда не переписывается. Если после инъекции хоть один `queries[]` остаётся без положительного ограничения, chart-режим отказывается выполнять запрос (`SHOPNO_UNCONSTRAINED`), а если чарт исключает целевой ДС — `SHOPNO_EXCLUDED` (обход только `--force-shopno`).
5. **Матрица доступа покрывает 5 датасетов** (`3035` ALLOWED; `3466`, `5888`, `7696`, `7712` → 401). Ранее в сессии полная проба 20 датасетов показала `ALLOWED` только для 3035, но тот артефакт был перезаписан сокращённой пробой; для расширения матрицы нужен новый прогон `bun run dataset:access` (в этой задаче не выполнялся — массовые live-запросы запрещены).
6. **PII-правило «ФИО» шумное** на больших каталогах (деловые фразы из двух заглавных слов). Маскирование идёт «в безопасную сторону», но перед публикацией нужен ручной просмотр отчёта маскирования; для репозиторного сканирования правило стоит сузить.
7. **<ФИО>-смысл метрик не выводится**: инструмент переносит имена метрик/измерений из запроса и не интерпретирует их.
8. Один и тот же аккаунт для чтения: смена/истечение сессии обрабатывается (401 → ошибка, live-режим останавливается), но автоматического перелогина нет — для JWT можно добавить позже.
9. В `reports/code-review/` параллельной сессией создан `final-live-aggregator-acceptance.md`; он не проверялся в рамках этой ревизии.

---

## 10. Необходимые права

Чтобы запустить блоки, аккаунту нужен `can_chart_data` (POST `/api/v1/chart/data`) по датасетам:

- ТМЦ: `3871`, `3306`, `3746`, `3897`
- Вайты/ЗИЗ: `1583`, `3466`
- Сборка: `3466`, `5888`, `5542`
- Опоздания: `7696`, `7006`, `4547`
- Слоты (доп. часть): `3406`, `4732`
- Матрёшка: `5939`, `7473`, `5797`
- Фотоконтроль/аудиты: `7712`, `7713`, `7607`, `3268`, `6310`
- Карта покрытия: `6863`, `4732`

Альтернатива без выдачи прав: сессия аналитика — `--session "<cookie>"` (инструмент поддерживает).

---

## 11. Что нужно для запуска восьми блоков

1. Выдать права на перечисленные датасеты (или предоставить cookie аналитика).
2. Обновить матрицу: `bun run dataset:access --live --yes` (20 датасетов) — подтвердить `ALLOWED` по нужным.
3. Прогнать по блокам: `bun tools/fetch-darkstore-aggregates.ts --live --yes --from-chart <ids> --weeks 8 --to 2026-11-24` (готовые команды лежат в `run_command` каждого блока).
4. <ФИО> `quality.json`: блок считается принятым только при `completeness = full` по всем запросам; `partial/truncated/none` — на разбор.
5. Опубликовать отчёты через маскирование: `bun tools/redact-pii.ts --in reports/... --out reports/public/...`.
