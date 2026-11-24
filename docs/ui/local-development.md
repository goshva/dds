# UI-2 — локальная разработка

## 1. Требования

Bun 1.4+, зависимости: `hono` (runtime), `vite` (dev).

## 2. Команды

```bash
bun install            # зависимости
bun run api:start      # Hono API на 127.0.0.1:8787 (read-only)
bun run ui:dev         # Vite dev server на 127.0.0.1:5173 с proxy /api → 8787
bun run ui:build       # production build в dist/web
bun run ui:test        # bun test tests/web tests/server
bun test               # полный набор тестов
bunx tsc --noEmit      # проверка типов
```

Порт API: `DSS_API_PORT` (по умолчанию 8787). Порт Vite: 5173 (`strictPort`).

## 3. Порядок запуска

1. `bun run api:start` — поднимает API.
2. `bun run ui:dev` — открывает интерфейс на `http://127.0.0.1:5173`.
3. Интерфейс читает данные через `/api/*` (proxy), реальные данные; fixtures не используются.
4. DEMO-режим playground (fixtures, помечены `FIXTURE`): `http://127.0.0.1:5173/playground/?demo=1`.

## 4. Диагностика

| Симптом | Причина |
|---|---|
| `not_available` в карточках | источник пуст или диапазон без данных (не ошибка) |
| `error DATA_SOURCE_CORRUPTED` | повреждён CSV/JSONL — API не маскирует ошибку |
| `NETWORK_ERROR` в UI | API не запущен |
| `TIMEOUT` | ответ дольше 8 с |

## 5. Запреты

- Не запускать `--mode all`/`replay` из интерфейса.
- Не выполнять запись в CSV, JSONL, manifest, SQLite.
- Не открывать bind на `0.0.0.0`.
- Не публиковать приложение в интернет.

## 6. Известные ограничения

- SQLite в UI-2 не подключена (только CSV и JSONL).
- Кэширование read-models отсутствует.
- Визуальная адаптивность проверяется в UI-7.
---

## 7. Итоговый статус UI-2

UI-2 принят с документированными ограничениями: см. [ui-2-final-audit.md](ui-2-final-audit.md). SQLite read-only API не реализован; запуск теневого режима из UI отсутствует; визуальная проверка в браузере — UI-7.
