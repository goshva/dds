# Stage 3.4.8.1 — упрочнение теневого хранилища: отчёт

**Дата:** 2026-11-24 · **Статус:** `STAGE_3_4_8_1_READY_FOR_REVIEW`
**Объём:** только R1 + R2. Архитектура, формула прогноза, данные и контракты не изменялись.

---

## 1. Executive summary

| Пункт | Результат (FACT) |
|---|---|
| R1 fail-closed reader | реализован, без частичного результата |
| R2 atomic lock | реализован (open `wx`), 12 сценариев |
| Новые тесты | 21 pass / 0 fail |
| Регрессия | `tests/forecasting` 386 pass, `bun test` 550 pass / 4 skip |
| TypeScript | 0 ошибок |
| PII gate | PASS |
| Существующие JSONL | не изменены (SHA-256 до/после совпали) |
| Канонический CSV / SQLite | не изменены |

## 2. Исходное состояние Git (FACT)

| Параметр | Значение |
|---|---|
| HEAD / ветка | `9daafc6332ff190033f3c0ebe231f666489af19d` / `main` |
| Untracked/modified до и после | 26 → 30 (добавлены новые файлы этапа; чужие файлы не тронуты) |
| `diff.txt` | не изменялся |

## 3. Изменённые и созданные файлы

| Файл | Изменение |
|---|---|
| `src/forecasting/shadow/store.ts` | R1: `ShadowStorageCorruptedError`, fail-closed `readJsonl` с валидаторами |
| `src/forecasting/shadow/lock.ts` | **новый**: R2 lock (atomic `wx`, token, stale recovery) |
| `src/forecasting/cli/shadow.ts` | захват/освобождение lock, exit codes 4/5/6 |
| `src/forecasting/shadow/pipeline.ts` | передача валидаторов в `readJsonl` |
| `tests/forecasting/shadow-hardening.test.ts` | **новый**: 21 тест |
| `docs/forecasting/stage-3.4.8.1-storage-hardening.md` | **новый** |
| `reports/forecasting/stage-3.4.8.1/stage-3.4.8.1-report.md` | **новый** (этот файл) |

## 4. Реализация R1 (FACT)

- `readJsonl` бросает `ShadowStorageCorruptedError` с `file`, `line`, `reason` при первой ошибке; частичный массив не возвращается.
- Пустой файл и отсутствие файла → `[]` (существующий контракт); пустые строки и завершающий `\n` допустимы.
- Структурная валидация: `isSnapshotRecord`, `isReconciliationRecord`, `isShadowErrorRecord`.
- CLI: `exit 6`, без записи в `errors.jsonl` (операция на повреждённом хранилище останавливается).

## 5. Реализация R2 (FACT)

- Захват — `openSync(path, "wx")`; проверка существования + создание не используется.
- Содержимое: `pid`, `hostname`, `started_at`, `token`, `mode`.
- Освобождение — `finally`, только при совпадении token.
- Stale recovery: atomic `rename` в карантин → сверка содержимого (token+pid) → удаление → повторный `wx`-захват; иначе `STALE_AMBIGUOUS`.
- Повреждённый lock → `CORRUPTED_LOCK`; другой hostname → запрет автоудаления.
- Exit codes: 4 — `LOCKED`, 5 — `CORRUPTED_LOCK`/`STALE_AMBIGUOUS`, 6 — повреждённое хранилище.

## 6. Тесты (FACT)

| № | Сценарий | Результат |
|---|---|---|
| R1-01 | корректный JSONL | pass |
| R1-02 | повреждение в начале (line=1) | pass |
| R1-03 | повреждение в середине (точная строка) | pass |
| R1-04 | повреждена последняя строка | pass |
| R1-05 | пустой файл → `[]` | pass |
| R1-06 | завершающий newline | pass |
| R1-07 | нет частичного результата | pass |
| R1-08 | неверная структура → ошибка валидации | pass |
| R1-09 | pipeline не пишет при повреждении | pass |
| R1-10 | CLI на повреждённом хранилище | pass (реальный процесс, exit 6) |
| R2-01 | первый захват | pass |
| R2-02 | второй при активном → LOCKED, lock сохранён | pass |
| R2-03 | штатное освобождение | pass |
| R2-04 | исключение → finally освобождает | pass |
| R2-05 | повреждённый lock → CORRUPTED_LOCK | pass |
| R2-06 | активный pid → LOCKED | pass |
| R2-07 | завершённый pid → recovery | pass |
| R2-08 | другой host → STALE_AMBIGUOUS | pass |
| R2-09 | чужой token не удаляет lock | pass |
| R2-10/11 | два реальных процесса: второй LOCKED, JSONL не создан | pass |
| R2-12 | kill процесса → recovery следующим запуском | pass |

## 7. Exit codes (FACT)

CLI: `0` — успех; `1` — ошибка; `2` — checksum CSV; `3` — CONFLICT; `4` — lock занят; `5` — повреждённый/неоднозначный lock; `6` — повреждённое хранилище.

## 8. Проверки (FACT)

| Команда | Результат | Exit |
|---|---|---:|
| `bun test tests/forecasting/shadow-hardening.test.ts` | 21 pass / 0 fail | 0 |
| `bun test tests/forecasting` | 386 pass / 0 fail | 0 |
| `bun test` | 550 pass / 4 skip / 0 fail | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| PII gate | GATE PASS | 0 |
| `git diff --check` | пусто | 0 |

## 9. Целостность (FACT)

| Объект | До | После |
|---|---|---|
| Canonical CSV | `d413286e…` | `d413286e…` — не изменялся |
| SQLite | `eadc3763…` | `eadc3763…` — не изменялась |
| `forecasts.jsonl` | 3 504 записи, `4b9c7308…` | 3 504 записи, `4b9c7308…` |
| `reconciliations.jsonl` | 3 500 записей, `77024788…` | 3 500 записей, `77024788…` |
| `manifest.json` | `20fd0efe…` | `20fd0efe…` |
| `errors.jsonl` | отсутствует | отсутствует |
| `.shadow.lock` после тестов | — | отсутствует |

## 10. Production isolation (FACT)

Модуль `shadow/` не импортируется production-кодом; `package.json`, baseline, pipeline и SQLite не изменялись.

## 11. Оставшиеся ограничения

- R1-10 реализован реальным процессом: CLI получает повреждённое хранилище и завершается с кодом 6 (см. раздел 13).
- R3 (ротация/бэкап) и R4 (алертинг) **не реализованы** — вне разрешённого объёма.
- Stale recovery не удаляет lock при другом hostname и при неоднозначности — требуется ручная диагностика по инструкции в документации.
- `readJsonl` различает отсутствие файла (`[]`) и повреждение (ошибка); это осознанный контракт.

## 12. Итоговый статус

**`STAGE_3_4_8_1_READY_FOR_REVIEW`.**

R1 и R2 реализованы, покрыты тестами (21 pass), регрессия зелёная, данные и контракты не изменены. Stage 3.4.9 не начинался; cron/scheduler/ежедневное наблюдение не запускались; commit/push не выполнялись.
---

## 13. R1-10 — проверка реального CLI (FACT)

### 13.1. Команда

```text
DSH_SHADOW_STORE=<временный каталог> bun src/forecasting/cli/shadow.ts --mode monitor
```

В тестовом хранилище: 2 корректные строки `forecasts.jsonl`, третья строка повреждена (`{broken`), один корректный артефакт `reconciliations.jsonl`, подготовленный `manifest.json`.

### 13.2. Результат

| Проверка | Факт |
|---|---|
| exit code | **6** (ненулевой) |
| диагностика stderr | `SHADOW_STORAGE_CORRUPTED: file=forecasts.jsonl line=3 reason=JSON.parse: …` |
| `forecasts.jsonl` SHA-256 | до/после совпал |
| `reconciliations.jsonl` SHA-256 | до/после совпал |
| `manifest.json` SHA-256 | до/после совпал |
| новые снапшоты | не записаны |
| `errors.jsonl` | не создан |
| `.shadow.lock` | отсутствует после завершения |

### 13.3. Обнаруженный и устранённый смежный дефект

При подготовке изолированного запуска выяснилось: CLI записывал `manifest.json` **до** проверки читаемости хранилища, то есть при повреждении успевал изменить файл. Это противоречило требованию fail-closed.

Исправление (минимальное, в рамках R1):
- перед `writeManifest` добавлена проверка чтения `forecasts.jsonl`, `reconciliations.jsonl`, `errors.jsonl` с валидаторами;
- при ошибке — выход с кодом 6 до любых записей;
- добавлена тестовая параметризация каталога через `DSH_SHADOW_STORE` (при отсутствии переменной поведение прежнее, production-путь не изменён).

### 13.4. Итог по R1-10

**PASS.** Сценарий воспроизведён реальным отдельным процессом, тестовое хранилище не изменилось, рабочие артефакты `data/shadow/7745/` не затронуты.