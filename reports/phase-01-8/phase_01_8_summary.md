# Этап 1.8 — Logical Data Model & ERD: итоговый отчёт

**Verdict:** `PASS_WITH_BLOCKERS`  
**Сгенерировано:** 2026-11-22T15:07:35.192Z  
**Статус входов:** `PARTIAL_INPUTS`

## 1. Что сделано

Построена логическая модель курьерской службы в двух слоях (observed source concepts и target logical model) на основании артефактов этапов 1.1–1.7, SQL definitions Superset и зафиксированных бизнес-правил. Созданы:

- 14 документов в `docs/phase-01-8/`;
- 7 Mermaid-диаграмм в `docs/phase-01-8/diagrams/`;
- 8 машиночитаемых JSON в `reports/phase-01-8/`;
- валидатор `src/phase1-8/validate.ts` и пайплайн `src/phase1-8/run.ts`.

## 2. Количество сущностей, атрибутов, связей, evidence, decisions

| Артефакт | Количество |
|---|---|
| Сущности | 39 |
| Атрибуты | 60 |
| Связи | 39 |
| Evidence links | 40 |
| Открытые решения | 37 |
| Инварианты | 20 |
| Gaps | 20 |
| Процессы | 13 |
| MVP-поля | 10 |
| Метрики | 4 |
| Bounded contexts | 8 |

## 2a. Проверка обязательных findings §5 ТЗ

Проверено по первичным артефактам 1.6.2 (`data/snapshots/phase-01-6-2`): **12** findings, подтверждено **11**, конфликтов **1**, не проверяемо **0**.

- `F1` ✅ 7802 содержит SQL references shifts/pools/courier_queue
- `F2` ✅ 7802 содержит поля id_shift/id_courier/id_pool/shift_start/shift_finish/pool_start/pool_finish/queue_in_dttm/queue_out_dttm/first_delivery_dttm/has_order
- `F3` ✅ cargo datasets содержат id_order/id_general/id_pool/courier_id_darkstore
- `F4` ⚠️ в одном из cargo datasets pool_size = count(distinct id_general)
- `F5` ✅ SQL 3466 не содержит time_ready/time_ready_plan
- `F6` ✅ 7021 — timesheet сборщиков, id_courier отсутствует
- `F7` ✅ 5939 содержит mentor/trainee поля; date_for_mentor в SQL отсутствует (metadata-only)
- `F8` ✅ 7473 содержит shift_1_profit … shift_5_profit
- `F9` ✅ длина SQL 3466 согласуется с 1.7 отчётом (38 370), но не с ТЗ (~35 926)
- `F10` ✅ количество датасетов 1.6.2 = 3778 (в 1.7 отчёте 3767)
- `F11` ✅ детали 7802/3466/7021/5939 присутствуют в datasets.detail.json
- `F12` ✅ детали 7091/7098/7160 отсутствуют в datasets.detail.json 1.6.2

Детали: `reports/phase-01-8/findings_verification.json`.

## 3. Breakdown по bounded context

| ID | Контекст | Сущностей |
|---|---|---|
| CTX-ORDER | Заказы и доставка | 6 |
| CTX-DARKSTORE | Дарксторы и ТТ | 2 |
| CTX-COURIER | Курьеры, смены, очередь, поездки | 11 |
| CTX-GEO | География и зоны | 5 |
| CTX-FINANCE | Финансы курьеров | 7 |
| CTX-HR | Наставничество и HR | 3 |
| CTX-ANALYTICS | Аналитика и SLA | 2 |
| CTX-SHARED | Общие и аудит | 3 |

## 4. Breakdown по статусам

| Статус | Сущностей |
|---|---|
| `FOUND_IN_SUPERSET_SQL` | 15 |
| `BUSINESS_REQUIRED_NOT_FOUND` | 12 |
| `INFERRED_FROM_MULTIPLE_SOURCES` | 5 |
| `NOT_VERIFIABLE` | 2 |
| `DESIGN_PROPOSAL` | 4 |
| `NOT_FOUND_IN_SUPERSET` | 1 |

## 5. Breakdown по confidence

| Confidence | Сущностей |
|---|---|
| `MEDIUM` | 16 |
| `NONE` | 18 |
| `LOW` | 4 |
| `HIGH` | 1 |

## 6. P0/P1 blockers

### P0

- `GAP-001` Канонический ID заказа: Не разграничены id_order и id_general.
- `GAP-002` Зерно заказа: Зерно результата не подтверждено.
- `GAP-003` Событие готовности: time_ready отсутствует в SQL 3466.
- `GAP-012` Начисление и выплата: Ledger начислений и выплат не найден.
- `GAP-017` Тариф и формула: Формула и владелец тарифа не установлены.
- `GAP-020` Доступ к SQL Lab: SQL Lab и chart_data недоступны (403/401).

### P1

- `GAP-004` Формирование поездки: Pool и Trip не разграничены.
- `GAP-005` История состава поездки: Нет подтверждённой истории изменений.
- `GAP-006` Назначение курьера: courier_id_darkstore не подтверждён как назначение.
- `GAP-007` События очереди: Вызов, пропуск, возврат не подтверждены.
- `GAP-008` Выезд и фиксация состава: Событие выезда не найдено.
- `GAP-010` Отмена и возврат: Правила учёта в SLA не утверждены.
- `GAP-011` Смена и перерыв: Перерыв и возврат не подтверждены.
- `GAP-013` Наставничество курьеров: HR-модель не подтверждена как курьерская.
- `GAP-014` SLA-методика: Формула и исключения не утверждены.
- `GAP-015` Справочник зон: Геометрия и мастер-реестр зон не найдены.

## 7. Результаты G0–G7

### G0 — preflight

Репозиторий: `C:/soft/bun/dds`; ветка `main`; HEAD `374786a6c410b6387f2139182232e8091c5e1bd7`. SHA-256 `data/catalog.sqlite` до работы: `09e827205ada06b7e395dc3406e49f63eafd33284626269a48fc837529869c0c`. Статус входов: `PARTIAL_INPUTS`.

### G1–G7 — автоматические проверки

| ID | Проверка | Статус | Детали |
|---|---|---|---|
| G1_COMPLETENESS | Полнота документов, диаграмм, JSON и уникальность ID | PASS | docs=14/14; diagrams=7/7; json=8/8; dup(ENT/ATT/REL/EVD/DEC)=0/0/0/0/0 |
| G2_EVIDENCE_INTEGRITY | Целостность evidence и ссылок на решения | PASS | все ссылки на evidence и решения существуют; VERIFIED не присваивался |
| G3_RELATIONSHIP_INTEGRITY | Целостность связей | PASS | 39 связей, все ссылки валидны |
| G4_BUSINESS_INVARIANTS | Наличие и статусы инвариантов INV-001…INV-020 | PASS | 20 инвариантов, статусы валидны |
| G5_DIAGRAM_CONSISTENCY | Статическая согласованность Mermaid | PASS | 7 диаграмм непусты, ссылки на сущности валидны (STATIC_VALIDATION) |
| G6_PII_SCAN | PII и секреты в новых артефактах | PASS | 34 файлов, совпадений 0 |
| G7_READONLY_SCOPE | Read-only и границы изменений | PASS | pwd=C:\soft\bun\dds; git=main@374786a6; catalog=sha256 09e827205ada; inputs=PARTIAL_INPUTS; git-scope ok |
| G8_FORBIDDEN_CLAIMS | Запрещённые выводы | PASS | FK-нотация, Pool=Trip, zone merge, sum_order=earnings, ready=date_set_cell — не обнаружены |
| G9_JSON_INTEGRITY | Целостность машиночитаемых файлов | PASS | 8 JSON валидны, счётчики совпадают |
| G10_P0_BLOCKERS | P0 blockers зафиксированы | PASS | 6 P0: GAP-001,GAP-002,GAP-003,GAP-012,GAP-017,GAP-020 |

## 8. Тесты и compile

- `bunx tsc --noEmit` — см. вывод запуска (ожидается 0 ошибок);
- локальные тесты — см. вывод запуска;
- валидатор: `bun src/phase1-8/validate.ts` (через `run.ts`).

## 9. PII и secrets

PII-скан новых артефактов: см. `G6_PII_SCAN` в таблице выше. Цель — 0 совпадений. Секреты не выгружались, `.env` не читался.

## 10. Неизменность SQLite

SHA-256 до: `09e827205ada06b7e395dc3406e49f63eafd33284626269a48fc837529869c0c`. SHA-256 после: см. `G7_REPOSITORY_SAFETY`. Изменений нет.

## 11. Safety

- source databases не запрашивались;
- Superset не изменялся;
- ETL/backfill не запускался;
- DDL/migrations не применялись;
- git commit/push не выполнялись;
- PII не экспортировались.

## 12. Что нужно для этапа 1.9

1. Read-only SQL Lab / DB role для 18 SELECT: фактические значения, распределения, NULL-доли, кардинальности, покрытие связей.
2. Ответы владельцев по P0/P1 gaps: канонический ID заказа, ready timestamp, Pool vs Trip, очередь, тарифы, зоны, наставничество.
3. Подтверждение master data owners для courier/TT/zone/tariff.
4. Решение по единой SLA-методике и учёту отмен/возвратов.
5. После этого — физическое проектирование (DDL) и миграции, которые этап 1.8 намеренно не выполняет.
