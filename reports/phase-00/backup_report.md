# Этап 0 — Отчёт о резервном копировании

Дата: 2026-11-20. Исходник: `data/catalog.sqlite` (1 839 284 224 байт, journal_mode=WAL).

## Предварительная проверка активной записи

- `PRAGMA wal_checkpoint(BUSY)` → `{busy: 0, log: 0, checkpointed: 0}` — активных писателей нет, WAL пуст.
- После checkpoint файлы `catalog.sqlite-wal` и `catalog.sqlite-shm` были удалены SQLite штатно (последнее соединение закрыто).
- Процессов `bun.exe` в момент копирования не запущено.

## Метод копирования

Bun 1.4.4 не предоставляет `db.backup()` (SQLite online backup API) в `bun:sqlite`; CLI `sqlite3` в системе отсутствует.
Использован эквивалентный штатный механизм SQLite — **`VACUUM INTO`** (атомарный консистентный снимок, выполняемый самим SQLite
на той же версии движка; исходная БД открывается readonly и не мутирует). Копирование «сырых файлов» не применялось.

```sql
-- выполнено на соединении readonly к data/catalog.sqlite
VACUUM INTO 'backups/catalog-before-discovery.sqlite';
```

## Результат

| Параметр | Значение |
|---|---|
| Файл | `backups/catalog-before-discovery.sqlite` |
| Размер | 1 839 157 248 байт |
| SHA-256 | `697c4dca238c3c18b6326c26ebe4e544f2c8c5133df26f50ebcc138e0711bace` |
| quick_check | ok |
| integrity_check | ok |
| objects | 13 193 |
| relations | 0 |
| Разбивка | chart 5 000 · chart_detail 3 766 · dashboard 330 · dashboard_detail 330 · dataset 3 767 |

## Целостность исходника

- Размер `data/catalog.sqlite` до и после копирования идентичен: 1 839 284 224 байт.
- Исходный файл сохранён без изменений; миграции не выполнялись; WAL-файлы не удалялись вручную.

## ***REMOVED***

<ФИО> копия валидна и готова к использованию как точка отката перед этапами 1–7.
