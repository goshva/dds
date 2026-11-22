# Logical Data Model & ERD — Этап 1.8

**Статус:** `PASS_WITH_BLOCKERS`  
**Сгенерировано:** 2026-11-22T15:07:28.955Z

## Что это

Логическая модель курьерской службы: сущности, атрибуты, связи, evidence,
открытые решения и инварианты. Модель не является физической схемой и не
запускает миграции.

## Навигация

| Документ | О чём |
|---|---|
| `01_logical_model_overview.md` | Цели, границы, контексты, допущения |
| `02_entity_catalog.md` | Каталог сущностей |
| `03_attribute_catalog.md` | Каталог атрибутов |
| `04_relationship_catalog.md` | Каталог связей |
| `05_order_lifecycle.md` | Жизненный цикл заказа |
| `06_trip_pool_assignment.md` | Trip / Pool / назначение |
| `07_queue_shift_lifecycle.md` | Очередь и смены |
| `08_zone_address_model.md` | Зоны и адреса |
| `09_finance_model.md` | Финансовая модель |
| `10_mentorship_model.md` | Наставничество |
| `11_event_and_audit_model.md` | События и аудит |
| `12_open_decisions_and_gaps.md` | Решения и gaps |
| `13_model_validation_report.md` | Самопроверка G1–G10 |
| `README.md` | Эта страница |

## Диаграммы

`diagrams/` — 7 Mermaid-файлов. Они соответствуют JSON-каталогам; связи без
подтверждения помечены `INFERRED`, `PROPOSED`, `BUSINESS_RULE`.

## Машиночитаемые артефакты

`reports/phase-01-8/`:

- `logical_model.json` — полная модель;
- `entities.json`, `attributes.json`, `relationships.json` — каталоги;
- `evidence_links.json` — evidence;
- `open_decisions.json` — решения;
- `model_validation.json` — результаты проверок;
- `model_manifest.json` — манифест и хэши;
- `preflight.json`, `final_validation.json`, `phase_01_8_summary.md`.

## Ключевые числа

- Сущностей: 39;
- Атрибутов: 60;
- Связей: 39;
- Evidence: 40;
- Решений: 37;
- Инвариантов: 20;
- Gaps: 20.

## Главное ограничение

SQL Lab и chart data недоступны (403/401), поэтому фактические значения,
распределения, кардинальности и уникальность не проверены. Модель честно
показывает это через статусы и gaps, а не через догадки.
