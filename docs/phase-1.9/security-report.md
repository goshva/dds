# Security report — Phase 1.9-A

**Статус:** `PASS_FOR_IMPLEMENTED_SCOPE`
**Инструмент:** `tools/superset-extractor` версия 1.9-A

## 1. Маскирование секретов

| Объект | Что маскируется |
|---|---|
| Заголовки | `Authorization`, `Cookie`, `Set-Cookie`, `X-CSRFToken`, `X-CSRF-Token`, `async-token`, `X-Api-Key` |
| URL | query-параметры `token`, `session`, `csrf`, `access_token`, `password` и подобные |
| JSON body | поля `password`, `token`, `session`, `csrf`, `access_token`, `secret` |
| Cookie | значения cookie-строк |
| Form-urlencoded | поля `password=...`, `token=...` |

Маскирование выполняется до записи в артефакты и до расчёта fingerprint. В нормализованный реестр секреты не попадают.

## 2. <ФИО>

<ФИО> `redaction.test.ts` и `normalizer.test.ts` проверяют:

- `Authorization` и `Cookie` заменяются на `***`;
- секреты в URL и JSON body не попадают в `JSON.stringify(request)`;
- fingerprint не меняется при смене секрета;
- `scanForSecrets` находит Bearer, session, token, email;
- `containsSecretValue` подтверждает отсутствие секрета в строке.

Результат: `33 pass, 0 fail`.

## 3. PII

- `data/catalog.sqlite` содержит заголовки объектов Superset, которые могут включать имена сотрудников и email.
- В `docs/phase-1.9/sqlite-schema-inventory.md` выгружены только имена таблиц, колонок и счётчики; значения и заголовки не выводились.
- При парсинге curl-дампов PII-поля не извлекаются специально; если они встречаются в теле, маскируются по общим правилам.
- Входные файлы не найдены, поэтому фактическая проверка PII в них не выполнялась.

## 4. Сеть и SQL

- HTTP-запросы к Superset не выполнялись.
- SQL из curl-дампов не исполнялся.
- `data/catalog.sqlite` открывался только в режиме `readonly`.
- Основная БД DDS не изменялась.

## 5. Ограничения

- Полная проверка утечек на реальных входных файлах невозможна: файлы отсутствуют.
- После добавления файлов нужно повторить `extractor:parse` и `extractor:report`, затем проверить `requests.json` и `request-registry.json` на отсутствие секретов.
