# UI-2 — реализация локальной оболочки DSS

**Дата:** 2026-11-24 · **Статус:** реализовано, read-only · **Стек:** Bun + TypeScript + Vite + Hono

---

## 1. Архитектура

```text
браузер (Vite dev server, 127.0.0.1:5173)
   │  /api/*  →  proxy
   ▼
Hono API (Bun.serve, 127.0.0.1:8787)
   │
   ├─ src/server/sources.ts        read-only: canonical CSV + shadow JSONL
   ├─ src/server/services/read-models.ts  read-models (без прогнозной логики)
   └─ src/server/routes.ts         только GET
```

Файлы: `src/server/api.ts` (контракт, ошибки), `src/server/sources.ts` (чтение источников),
`src/server/services/read-models.ts` (history/coverage/shadow/overview), `src/server/routes.ts` (маршруты),
`src/server/app.ts` (Hono, заголовки, 404, обработчик ошибок), `src/server/index.ts` (bind `127.0.0.1`).
Frontend: `src/web/index.html`, `src/web/main.ts`, `src/web/api/client.ts`, существующая дизайн-система UI-1.

## 2. Источники данных (FACT)

| Источник | Путь | Чтение |
|---|---|---|
| canonical CSV | `data/processed/forecasting/7745/canonical_daily_delivered_orders.csv` | `readCanonicalCsv` + проверка заголовка/типов/хронологии |
| shadow forecasts | `data/shadow/7745/forecasts.jsonl` | `readJsonl(..., isSnapshotRecord)` (fail-closed) |
| shadow reconciliations | `data/shadow/7745/reconciliations.jsonl` | `readJsonl(..., isReconciliationRecord)` |
| shadow errors | `data/shadow/7745/errors.jsonl` | `readJsonl(..., isShadowErrorRecord)` |
| manifest | `data/shadow/7745/manifest.json` | JSON.parse, только чтение |
| SQLite | `data/forecast/forecasting.sqlite` | **не подключена в UI-2** (см. NOT_IMPLEMENTED) |

## 3. Реализованные endpoints

`GET /api/health`, `GET /api/v1/overview`, `GET /api/v1/history`, `GET /api/v1/history/coverage`,
`GET /api/v1/shadow/forecasts`, `GET /api/v1/shadow/reconciliations`, `GET /api/v1/shadow/monitor`.
Изменяющие методы на `/api/*` → `405 METHOD_NOT_ALLOWED`.

## 4. Ограничения и NOT_IMPLEMENTED

- **SQLite не подключена (NOT_IMPLEMENTED)**: UI-2 работает на canonical CSV и shadow JSONL; read-only SQLite-репозиторий не создавался, схема и данные не изменялись. Отсутствие подключения гарантирует отсутствие записей, но **не подтверждает** работу read-only доступа (NOT_VERIFIED). Перенос — на этап, которому потребуются `daily_metrics` и `domain_events`.
- Сценарные endpoints, расчёт p10/p90, управленческие операции — не реализованы (вне UI-2).
- Запуск shadow/reconcile/monitor из интерфейса отсутствует.
- Авторизация отсутствует (локальный bind + same-origin proxy).
- Кэширование read-models не реализовано (данные читаются на запрос).

## 5. Проверки (FACT)

| Проверка | Результат |
|---|---|
| `bunx tsc --noEmit` | 0 ошибок |
| `bun test tests/server tests/web` | 38 pass / 0 fail |
| `bun test` | 588 pass / 4 skip / 0 fail |
| `bun run ui:build` (vite build) | exit 0, `dist/web/index.html` |
| bind | `TCP 127.0.0.1:8787 LISTENING`, внешний IP недоступен |\n| Host/Origin (UI-2.1) | чужой Host → 403, чужой Origin → 403, origin стенда → 200 |\n| стенд разработки (smoke) | `GET http://127.0.0.1:5173/` → 200 (`#app`, `main.ts`); proxy `/api/v1/overview` → `status=ok`, 906 дней |
| POST на бизнес-ресурс | `405` |
| PII gate | PASS (33 файла) |
| Исходные данные | идентичны (CSV `8f2b1818…`, JSONL `e35fe27b…`/`32ccd256…`, manifest `9d986747…`, SQLite `identical: true`) |
---

## 6. Итоговый аудит этапа

Закрытие замечаний UI-2.2…UI-2.2.5.1 и границы готовности: [ui-2-final-audit.md](ui-2-final-audit.md).
