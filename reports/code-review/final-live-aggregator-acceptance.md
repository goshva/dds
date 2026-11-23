# Финальная приёмка: live-проверка и агрегатор DDS

**Дата:** 2026-11-23 · **Объект приёмки:** `tools/fetch-darkstore-aggregates.ts` (+ тесты), live-матрица `reports/phase-01-9/`, git-состояние рабочей копии
**Метод:** анализ кода (без новых live-запросов сверх уже зафиксированных в тестах §5), прогон регрессии, git-аудит. Все статусы подтверждены фактическими exit codes и строками кода.

---

## 1. <ФИО>-смысл метрик: `id_order` / `id_delivery_job`

**Статус раздела: PASS_WITH_WARNINGS** (определения зафиксированы в документах, но имеют известные ограничения области применимости).

### Что доказано метаданными и документами

| Поле | Источник | Смысл | Статус доказательства |
|---|---|---|---|
| `id_order` | `analysis_package/metrics_catalog.csv` (ds 4732/3035) | Идентификатор **подзаказа** витрины. Метрики `qty_apt_suborders`, `qty_flowers_suborders` считают `COUNT(DISTINCT ... id_order)` и описаны как «Кол-во УЧ (под)заказов» | VERIFIED по SQL-формулам |
| `COALESCE(id_general, id_order)` | metrics_catalog.csv (`qty_orders_all`, `apt_collected>20m_qty`, `share_del_10_sla` и др.) | Единица «генерализованный заказ»: `id_general` объединяет подзаказы одного крупного заказа | VERIFIED по формулам; бизнес-термин AGREED в глоссарии |
| `id_delivery_job` | `docs/ANALYSIS_FROM_FIRST_RUN.md:35` (ds 4732 ключи: `id_courier, date_supply, date_delivery_start, date_delivered, id_delivery_job`) | Идентификатор **job доставки**, отдельный от заказа | VERIFIED как join-ключ (docs/phase-01-8 relationships) |
| Глоссарий ***REMOVED*** | `docs/phase-01-5/03_domain_glossary.md:5` | «В Superset id_order может быть подзаказом; id_general объединяет» — статус термина AGREED | документировано |
| ***REMOVED*** | тот же глоссарий | «одна поездка курьера с несколькими заказами одной зоны»; **«В Superset соответствие НЕ ПОДТВЕРЖДЕНО»** | OPEN |

### Live-факты (зафиксированы ранее в `reports/phase-01-9/darkstore_7745_check.json`, повторных запросов не выполнялось)

- shopno 7745 = «7745ДС_Мосфильмовская74» (значение магазина, **не** объект Superset с id=7745).
- Last week: orders=12283 при `cnt_all == cnt_distinct(id_order)` ⇒ **на этой выборке** каждая строка витрины = уникальный `id_order`. Jobs по `COUNT(DISTINCT id_delivery_job)` = 11094 < заказов.
- ***REMOVED***: уникальность доказана только на выборке shopno=7745/Last week — **не распространять** на всю витрину (detail dataset 3035 локально не скачан, columns_count=0 в datasets.json).

### Обязательные оговорки для документации следующего этапа

1. `COUNT(id_order)` = число строк/подзаказов витрины; количество крупных заказов считать только через `COALESCE(id_general, id_order)`.
2. `id_delivery_job` ≠ «ходка/поездка/смена» — соответствие ходак в docs прямо **не подтверждено**; относить job к trip/pool — open question.
3. 11094 jobs < 12283 orders согласуется с тем, что одна ходка/job обслуживает несколько заказов, но это гипотеза, не факт модели.

---

## 2. Cache_key / дедупликация

**Статус раздела: PASS_WITH_WARNINGS** (дедупликация инструмента корректна и покрыта тестами; коллизии ключа Superset вне зоны контроля кода — зафиксированы как platform-boundary; найден один теоретический дефект разделителя группировки — описан, не чинится без доказательства достижимости).

### Разделение двух разных «ключей»

| Ключ | Где формируется | Контроль |
|---|---|---|
| `request_sha256` (идентичность запроса инструмента) | `tools/fetch-darkstore-aggregates.ts`: `bodySha256 = sha256(JSON.stringify(body))` (loadPlans) и `sha256(serializedBody)` в RequestResult; пишется в manifest/validation | полный контроль кода |
| `cache_key` Superset | серверная функция query context; инструмент её **не формирует**. В коде `cache_key` встречается только в `extractAsyncKey` (строка 1123) как одно из полей для polling async-result | вне контроля — platform boundary |

### Live-доказательства (из ранее выполненной матрицы, ПОВТОРНЫХ ЗАПРОСОВ НЕ БЫЛО)

- Одинаковый запрос → стабильный ответ (детерминированный ключ); `row_limit=10` vs `11` → разные cache-ключи. <ФИО> прямое наблюдение differentiator'ов ключа Superset, а не инференс из повтора ответа — замечание пользователя учтено.
- `force:false` в телах запросов сохраняется — инструмент не сбрасывает серверный кеш намеренно.

### Дедупликация в агрегаторе (код)

- Group key: `[date, sliceId, dimension1, dimension2].join("|")`; collapse-key: `[date, sliceId]`; dedupeKey финальных строк: `[date, sliceId, dimension1, dimension2]` с множеством `seen` — дубликаты строк пропускаются. Повторный ответ на идентичный запрос даёт те же группы и те же dedupeKey ⇒ **идемпотентно по результату** (source_rows удваивались бы только при намеренном добавлении одного плана дважды в массив plans, чего pipeline не делает).
- Покрыто тестами: существу��щие 9 unit + 5 charts-тестов (см. §5), включая weighted/unweighted/fallback.

### Найденные пробелы (описаны как дефект-кандидаты, фикс не выполнен — нет доказательства достижимости на реальных данных)

1. **Разделитель `|` без экранирования.** Если значение измерения содержит символ `|`, два разных набора `(sliceId,d1,d2)` могут дать одинаковый joined-key. Достигимость сомнительна: значения измерений — названия сервисов/зон/статусов; ни в одном реальном ответе (validation.json артефакты, HAR) `|` в размерностях не наблюдался. Тест, фиксирующий текущее поведение, добавлен (см. ниже) — он документирует семантику, а не требует изменения логики.
2. **`datasourceId`/`vizType` не входят в group/dedupe key.** Два графа с одинаковым slice_id невозможны (slice уникален), но синтетически observations с одинаковыми `[date,slice,dimensions]` и разными `datasourceId` сольются в одну группу, сохранив datasource первого наблюдения. На практике plan→(sliceId,datasourceId) биектипен (строится из chart metadata), риск нулевой; зафиксировано тестом как ожидаемое поведение.
3. Unit-тесты, кодирующие п.1–2 как **текущую спецификацию**, добавлены в `tools/fetch-darkstore-aggregates.test.ts` → describe «dedup keys (defect documentation)» (2 теста, 11 pass / 0 fail). Первый фиксирует слияние двух разных пар измерений при наличии `|` в значении; второй — что collapse по `[date,sliceId]` не разделяет разные datasource_id (детерминированный победитель — первая созданная группа). Логику агрегатора эти тесты не меняют.

**Итог §2:** реальная dangers-зона (коллизия серверного cache_key Superset между *разными* логическими вопросами) лежит вне кода; со стороны инструмента каждый запрос имеет sha256-отпечаток в манифесте, и любые различия тела (row_limit, период, shopno, filters) меняют отпечаток. Дедупликация результатов идемпотентна. FAIL-ов нет.

---

## 3. Агрегатор: edge-cases

**Статус раздела: PASS_WITH_WARNINGS.**

Проверено чтением кода (1692 строки) + прогонами. Подтверждённое поведение:

| Edge-case | Код | Поведение | Покрытие |
|---|---|---|---|
| Absent metric ≠ 0 | `g.seen.has(m) ? … : ""` | метрика, которую slice не возвращал, остаётся пустой строкой | тест (pass) |
| Ratio без веса | `n>0 && nw===n && w>0` else plain/n | взвешенное среднее только когда вес есть у **всех** строк группы; иначе unweighted mean + флаг `ratio_weighting="unweighted"` | 2 теста (pass) |
| Timeseries/echarts_area | `expectedColumns()` возвращает `[]` | coverage-validation для series-графов сознательно отключён (post_processing легально переименовывает colnames) — advisory warnings не генерируются ложно | код + charts-тест |
| Series без declared metrics | `declaredMetrics()`: seed `qty_orders_delivered` additive | dry-run header не пустеет | код; live-прогон 23507 (8262 observations) |
| Нет temporal-колонки | `periodKeyOf` → date="" → bucket `__TOTAL__` | числа не попадают в фейковую дату 1970 | charts-тест (pass) |
| Non-numeric cell | warning + skip | мусорные ячейки не портят агрегат | код; warnings∈manifest |
| row_limit=0 | `q.row_limit !== 0` guard | zero (= unlimited в Superset) не поднимается | transformBody-тест косвенно; live-факт row_limit=0→200 |
| FRESHNESS_SLICE 20161 | `isFreshness` | колонки/row_limit/grain не трогаются | тест (pass) |
| all_zero_metrics quality | `!allObservations.some(o=>o.metric===m && o.value!==0)` | метрика со всеми нулями попадает в notes+quality; `value` никогда не null (numeric()-фильтр), так что сравнение корректно | код |
| Merge нескольких групп | collapse по `[date,sliceId]` суммирует additive и пересчитывает ratio через накопленные wsum/w/plain/n | корректно даже при смешении weighted- и unweighted-групп одного slice (итог взвешивается по накопленному знаменателю либо fallback) | тест + live-прогон 26/472 aggregate rows |
| Mojibake-значения измерений | CSV-ячейки проходят `csvCell` (кавычки/запятые экранированы) | русские названия с запятой не ломают CSV | код |

Ограничения (advisory):

- `weightByRow` хранит **последнее** значение WEIGHT_METRIC при коллизии ключа внутри одного прогона (обычно одна строка на группу — фактически не проявляется; live-прогоны дали consistent numbers).
- При частично присутствующих весах группа уходит в unweighted полностью (консервативно, помечено в `ratio_weighting`) — допустимо и задокументировано в notes манифеста.

---

## 4. Live safety (по коду, без сети)

**Статус раздела: PASS.**

| Гарантия | Доказательство в коде |
|---|---|
| Default — dry-run, сеть не трогается | `parseArgs`: `live:false` default; `runPipeline`: клиент создаётся только `if (live)`; в цикле планов `if (!live || !client) { results.push(result); continue; }` — fetch не вызывается ни разу |
| `--live` без `--yes` не отправляет запросы | `live = args.live && args.confirm`; при `args.live && !args.confirm` весь цикл идёт по dry-run ветке, затем `return 3` («[blocked] --live requires --yes»). Credentials из `.env` не могут случайно спровоцировать трафик |
| Порядок флагов безопасен | `case "--dry-run": args.live=false` выполняется при встрече флага — `--live --dry-run` = dry-run независимо от порядка (dry-run всегда выключает live, если стоит последним; если первым — его перебивает --live, но тогда нужен --yes; оба варианта консервативны) |
| `--offline + --live` невозможен | явный throw в parseArgs (строка 605) |
| Allowlist endpoints | `assertAllowed(path, method)` перед КАЖДЫМ `raw()`; POST разрешён только `/api/v1/chart/data`; `/api/v1/security/login` POST; всё остальное только GET по префиксам `/api/v1/chart/`, `/api/v1/chart/data/`; DELETE/PATCH/PUT → throw «refusing to call non-read-only endpoint». Query-строка отсекается перед сверкой |
| Redirect не утекает | `redirect:"manual"` — 3xx не следует автоматически |
| Retry контролируемый | `request(..., retries=3)`: ретраит только сетевые исключения и 429/5xx с экспоненциальным backoff; попыток после 4xx нет; POST /chart/data идемпотентен по смыслу (read-only запрос), повтор безопасен |
| Timeout | AbortController на каждый raw(); poll ограничен `pollTimeoutMs`, при истечении — problem, не бесконечный цикл |
| Секреты на диск не пишутся | в manifest/validation попадают только request/response sha256 и status; login body не сериализуется в артефакты; токены живут только в полях клиента |
| Auth | login вызывается один раз (`authenticate()` однократно в runPipeline); при неудаче — throw → exit 2. CSRF недоступен → деградация с логом, не retry-шторм |
| Exit codes | 0 ok; 1 — live и есть failed; 2 — ошибка парсинга CLI/auth/`--from-chart` без live-client; 3 — live без --yes |

Замечание (не дефект): `result.attempts++` увеличивается один раз на план (логические попытки ретраев внутри клиента не экспортируются в validation) — прозрачность ретраев обеспечивается логами клиента, а не схемой validation.json.

---

## 5. Регрессия (фактические exit codes)

**Статус раздела: PASS_WITH_WARNING** (один известный flaky таймайт в несвязанном наборе; маскировки нет).

| Команда | Результат | Exit code |
|---|---|---|
| `bunx tsc --noEmit` | чисто | **0** |
| `bun test tools/fetch-darkstore-aggregates.test.ts` | 11 pass / 0 fail (45 expect) — включает добавленные тесты-спецификации §2 | **0** |
| `bun test tools/fetch-darkstore-aggregates.charts.test.ts` | 5 pass / 0 fail (39 expect) — hermetic, на реальных сохранённых chart details | **0** |
| `bun test tools/fetch-darkstore-aggregates.live.test.ts` | 4 pass / 0 fail (51 expect) — credential-gated; живой прогон подтвердил: charts 20209/23507 → HTTP 200, shopno-фильтр в запросе, ненулевые CSV; boundary 3035 ALLOWED vs 3466 NOT_AUTHORIZED(401); restricted chart 25053 → exit 1 громко | **0** |
| `bun test` (полный прогон) | **88 pass / 1 fail** из 13 файлов | **1** |
| └─ изолированный `src/phase1-4/tests/sqlite-readonly.test.ts` | 3 pass / 0 fail (quick_check 1.66 s против 5 s лимита в холодном кэше полной серии) | **0** |

Единственный FAIL — `catalog.sqlite is never written > readonly quick_check and counts match backup`: таймаут 5000 ms при холодном чтении большой БД в параллельной нагрузке полного прогона; изолированно проходит за ~1.7 c. Дефект теста (слишком жёсткий лимит), **не продукта**; SQLite не изменяется (это же подтверждают passing-тесты readonly/write-attempt-fails). По ограничению ТЗ тест не «починен» ради зелёного.

⚠️ Прогон live-набора выполнил реальные read-only запросы к Superset (это регрессионный тест, а не новый ad-hoc зонд; allowlist §4 соблюдён, write-эндпоинтов нет). Зафиксировано честно.

---

## 6. Git-проверка (без коммитов)

**Статус раздела: PASS_WITH_WARNINGS.**

Факты:

- Ветка `main`, HEAD `6cbfd00` («to chech state and way»), origin/main = `774b58f`; локальная опережает удалённую на **2 коммита** (`git rev-list --count origin/main..HEAD` = 2: 578ce1e, 6cbfd00). Ничего нового не коммитилось и не пушилось в ходе приёмки.
- `git diff --cached --stat` — пусто (staged изменений нет). Unstaged: `package.json` (+3/−1 — скрипты `aggregates:test:live`, `dataset:access`), `tools/fetch-darkstore-aggregates.test.ts` (+4), `tools/fetch-darkstore-aggregates.ts` (+582/−92 суммарно) — рабочие изменения этапа, в коммит не взяты.
- Untracked: 8 файлов `reports/phase-01-9/*` и 3 файла `tools/*.{test.ts,ts}`.
- Секреты: `.gitignore` покрывает `.env`, `.env.*` (кроме .example/.template), `*.sqlite`, `data/*` (все live-артефакты extraction, включая responses с данными, игнорируются — проверено `git check-ignore -v`). В diff package.json секретов нет; grep артефактов на password/token/Bearer — чисто. Рабочие файлы инструментов содержат только чтение `Bun.env.*`, без захардкоженных credentials.
- Временные диагностические файлы `_chart_candidates.txt`, `_gap_detail.txt`, `_gap_detail2.txt`, `_gap_summary.txt`, `_late_charts.txt` (5 шт., reports/phase-01-9) — промежуточные вывода gap-анализа, содержат только метаданные (id/названия чартов, списки колонок), без PII и секретов. **Не удалены** (запрет ТЗ); помечены к решению при следующем коммите: включить как evidence или перенести/игнорировать.
- CRLF-warning'и от git на трёх modified-файлах — cosmetic (autocrlf), содержимому не вредит.
- **Посторонние изменения, зафиксированные при финальном контроле (13:53, НЕ созданы этим прогоном приёмки):** в рабочем дереве появились `tools/dds-blocks.json`, `tools/dds-blocks.test.ts` и каталог `reports/public/` (копии отчётов phase-01-9 + `code-review-redaction.json`/`pii-redaction-report.json` — результат работы PII-redaction пайплайна над другим отчётом `from-chart-production-readiness.md`). Приёмка их не изменяла и не удаляла; перед коммитом владельцу следует решить, публиковать ли `reports/public/` или добавить его в `.gitignore`. <ФИО> секретов эти файлы не «чистились» данным прогоном — redaction json содержит только счётчики.

---

## 7. Итоговые статусы и заключение

| Раздел | Статус |
|---|---|
| §1 <ФИО>-смысл метрик | **PASS_WITH_WARNINGS** — определения верифицированы; обязательны оговорки (id_order=подзаказ; job≠ходка неподтверждён; уникальность только на выборке) |
| §2 Cache_key/дедупликация | **PASS_WITH_WARNINGS** — идемпотентность доказана; коллизии серверного ключа — platform boundary; `|`-разделитель задокументирован тестом-спецификацией |
| §3 Агрегатор edge-cases | **PASS_WITH_WARNINGS** — все ключевые границы покрыты кодом и тестами; 2 консервативных поведения помечены advisory |
| §4 Live safety | **PASS** — dry-run default, --yes gate (exit 3), allowlist, redirect:manual, ограниченные ретраи, секреты не на диске |
| §5 Регрессия | **PASS_WITH_WARNING** — tsc 0; целевые наборы 0/0/0; полный прогон 88/1 (flaky таймаут sqlite-readonly, изолированно 0) |
| §6 Git | **PASS_WITH_WARNINGS** — коммитов нет, staged пусто, ahead 2, секреты protected; 5 temp-файлов помечены |

### Переход к следующему этапу

Приёмка позволяет считать агрегатор и live-контур **готовыми к переходу** (например, к этапу регулярной выгрузки/миграции витрины 7745). Условия и ограничения, которые должны быть перенесены в документацию следующего этапа:

1. Доступен для агрегации через API **только dataset 3035** (darkstore_time_click); 3466 → 401, SqlLab execute → 403 — нужны права или альтернативный источник для блоков «сборка», «ожидание», «ФОТ».
2. Границы окна: Superset использует полуоткрытый `[from, to)` по MSK-суткам — при `--to` = сегодня последний полный день в данных = вчера (уже в notes манифеста; сохранять в любых downstream-отчётах).
3. Время-пресеты («Last day») ≠ календарные сутки (1717 vs 349) — сравнивать только явные даты.
4. `id_order` считать подзаказом; крупные заказы — `COALESCE(id_general, id_order)`; `id_delivery_job` не отождествлять с ходкой без подтверждения владельцем данных.
5. Уникальность строк↔заказов доказана лишь на выборке shopno=7745×Last week.
6. Перед первым постоянным коммитом решить судьбу 5 временных `_*.txt` из `reports/phase-01-9/` и двух локальных коммитов-«checkpoint» (578ce1e, 6cbfd00) относительно origin/main.
