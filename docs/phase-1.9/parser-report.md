# Parser report — Phase 1.9-A

**Статус:** `PARSER_READY_INPUT_BLOCKED`
**Инструмент:** `tools/superset-extractor` версия 1.9-A
**Реальные входные файлы:** не найдены (см. `input-request-inventory.md`)

## 1. Что реализовано

| Компонент | Файл | Назначение |
|---|---|---|
| Токенизатор | `src/input/curl-parser.ts` | кавычки, экранирование, многострочные команды |
| Парсер опций | `src/input/curl-parser.ts` | `--data-raw`, `-H`, `-b`, `-X`, `--url`, `--data` и др. |
| Нормализатор | `src/input/request-normalizer.ts` | endpoint, IDs, классификация, fingerprint |
| Реестр | `src/input/request-registry.ts` | группировка по fingerprint, статистика |
| Маскирование | `src/security/redaction.ts` | Cookie, Authorization, CSRF, session, токены |
| CLI | `src/cli/index.ts` | `inspect`, `parse`, `report` |

## 2. Поддерживаемый синтаксис

- многострочные команды с `\` в конце строки;
- одинарные и двойные кавычки;
- ANSI-C кавычки `$'...'`;
- экранирование `\"`, `\'`, `\\`, `\n`, `\r`, `\t`;
- `--url`, `-H`, `-b`, `--data-raw`, `--data`, `-X`;
- повторяющиеся команды `curl ...` в одном файле;
- JSON-тело и form-urlencoded тело.

## 3. Классификация

| Класс | Условие |
|---|---|
| `CHART_DATA` | `/api/v1/chart/data` |
| `CHART_METADATA` | `/api/v1/chart/...` |
| `DATASET_METADATA` | `/api/v1/dataset/...` |
| `DASHBOARD_METADATA` | `/api/v1/dashboard/...` |
| `DASHBOARD_FILTERS` | фильтры дашборда |
| `USER_CONTEXT` | `/api/v1/me`, `/api/v1/security/...` |
| `TELEMETRY` | `/api/v1/log`, `/api/v1/telemetry` |
| `OTHER` | всё остальное |

## 4. Fingerprint

Fingerprint считается по канонизированному объекту:

```text
method + URL + headers + body + classification
```

Секреты маскируются до расчёта fingerprint, поэтому смена session/cookie не меняет идентичность запроса. Одинаковые запросы группируются в реестре, но сохраняют все вхождения и файлы-источники.

## 5. Результаты тестов

```text
bun test tools/superset-extractor/tests
33 pass, 0 fail, 86 expect() calls
```

Покрыто:

- многострочные команды;
- кавычки и экранирование;
- `--data-raw`, `-H`, `-b`, `-X`, `--url`;
- JSON body;
- секреты и маскирование;
- повторные команды;
- fingerprint;
- извлечение chart/dataset/dashboard ID;
- классификация endpoint;
- некорректные команды.

## 6. Ограничения

- Реальные curl-дампы не обработаны: файлы отсутствуют.
- Парсер не выполняет HTTP-запросы и не запускает SQL.
- Повторные команды распознаются по fingerprint; если входные файлы содержат динамические токены в URL, они маскируются, поэтому одинаковые по смыслу запросы могут считаться повторами.
- Не поддерживаются экзотические конструкции shell (heredoc, подстановки `$(...)`), которые не встречаются в типовых curl-дампах.
