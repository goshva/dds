# 13 — Model Validation Report

**Сгенерировано:** 2026-11-22T15:07:28.955Z  
**Verdict:** `PASS_WITH_BLOCKERS`

## 1. Сводка

| Показатель | Значение |
| --- | --- |
| PASS | 10 |
| FAIL | 0 |
| WARN | 0 |
| BLOCKED | 0 |

## 2. Проверки G1–G10

| ID | Проверка | Статус | Детали |
| --- | --- | --- | --- |
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

## 3. Safety

| Флаг | Значение |
| --- | --- |
| source_databases_queried | false |
| superset_objects_modified | false |
| migrations_applied | false |
| etl_or_backfill_run | false |
| git_committed | false |
| git_pushed | false |
| catalog_sqlite_modified | false |
| pii_exported | false |

## 4. Blockers

- GAP-001 Канонический ID заказа: Не разграничены id_order и id_general.
- GAP-002 Зерно заказа: Зерно результата не подтверждено.
- GAP-003 Событие готовности: time_ready отсутствует в SQL 3466.
- GAP-012 Начисление и выплата: Ledger начислений и выплат не найден.
- GAP-017 Тариф и формула: Формула и владелец тарифа не установлены.
- GAP-020 Доступ к SQL Lab: SQL Lab и chart_data недоступны (403/401).

## 5. Ограничение

Проверки выполнялись статически по артефактам. Mermaid-диаграммы проверены
структурно (`STATIC_VALIDATION`), без полноценного render test. Фактические
SELECT к source DB не выполнялись, поэтому `VERIFIED` статусы не присваивались.
