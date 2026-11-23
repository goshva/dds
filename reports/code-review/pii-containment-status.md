# PII: containment и очистка истории — выполнено

**Дата:** 2026-11-23 · **Статус:** выполнено (Tier 1 + Tier 2 + force-push) · **Автор:** DSH-агент по прямому указанию владельца

## 1. Что было обнаружено

| Факт | Значение |
|---|---|
| `HEAD` до работ | `4730108` «for check» = `origin/main` (PII **уже была опубликована** на GitHub) |
| PII-файлов в tracked-дереве | 129 из 522 текстовых (все — в `origin/main`) |
| Срабатываний до очистки | `person_name=14 020`, `phone=20`, `email=6`, `person_code=5` |
| Сырые PII-отчёты в истории | `reports/phase-01-9/darkstore_7745_gap_findings.json`, `_gap_summary.txt`, `_chart_candidates.txt` (и intermediates `_gap_detail*.txt`, `_late_charts.txt`) |
| Крупнейшие носители | `analysis_package/metrics_catalog.csv`, `reports/phase-01-6-2/chart_metrics.csv`, `charts_inventory.json`, `reports/phase-01-6/evidence/sql_full/3466.sql` — ФИО сотрудников в названиях объектов Superset |

## 2. Containment (до перезаписи истории)

1. **Publish-gate:** `bun tools/redact-pii.ts --in <dir> --gate` — exit 1 при остаточных совпадениях; тестовые/фикстурные файлы исключены; маскирование стало **идемпотентным** (исправлено самосовпадение плейсхолдеров и ложное срабатывание на `git@github.com`).
2. **Публикуемые копии очищены:** `reports/public/**` и `reports/code-review/**` проходят gate чисто (`person_name=0 … secret=0`).
3. **Сырые отчёты сняты с публикации:** `.gitignore` + удаление из индекса (`reports/phase-01-9/_*.txt`, `reports/phase-01-9/*_findings.json`).

## 3. Очистка истории (выполнено)

Инструмент: `git filter-repo` (установлен через `python -m pip install git-filter-repo`), скрипт [purge-pii-history.ps1](../../tools/purge-pii-history.ps1).

| Шаг | Команда | Результат |
|---|---|---|
| Бэкап | `git bundle create C:\Temp\dds-backup-20261123-150742.bundle --all` | 11.6 МБ (содержит старую историю с PII — хранить ограниченно) |
| Tier 1 | `git filter-repo --force --invert-paths --path <3 файла> --path-glob 'reports/phase-01-9/_*.txt' --path-glob 'reports/phase-01-9/*_findings.json'` | сырые отчёты удалены из **всех** коммитов |
| Tier 2 (проход 1) | `git filter-repo --force --replace-text C:\Temp\pii-replacements.txt` | 523 правила: 504 ФИО + 16 телефонов + 3 почты |
| Tier 2 (проход 2) | повторный `--replace-text` по остаткам | добит последний остаток: одно ФИО, 12 вхождений (значение вырезано из этого отчёта) |
| Публикация | `git remote add origin …; git fetch origin; git push --force-with-lease origin main` | `+ 4730108...51d4162 main -> main (forced update)`, затем `+ 746b0be...c5b979a` после вычистки имени из самого отчёта |
| Локальная чистка | `git reflog expire --expire=now --all; git gc --prune=now --aggressive` | старые объекты и висячий blob с ФИО удалены локально |

**История переписана:** вершина `c5b979a` (после трёх проходов `filter-repo`: Tier 1 + два прохода `--replace-text`).

## 4. Проверка после очистки

| Проверка | Результат |
|---|---|
| `git ls-remote origin main` | `c5b979a…` (совпадает с локальным после повторного force-push) |
| Сырые PII-отчёты в `origin/main` | **отсутствуют** (все три) |
| ФИО в `origin/main` (выборочная проверка) | 0 файлов |
| Маски в каталоге | `chart_metrics.csv` в `origin/main`: **7 524** `<ФИО>` |
| Остаточные телефон/почта | **0 / 0** в tracked-дереве и **0 / 0** по всем 587 blob-объектам истории |
| **Скан всей истории по blob-объектам** (`git cat-file --batch-all-objects`, 587 блобов) | персональных имён: **0**; остались только два деловых/технических оборота (20 и 1 вхождение) — не персональные данные, значения вырезаны, чтобы отчёт проходил gate |
| Единственное реальное остаточное ФИО | найдено в 1 **висячем** (недостижимом) объекте, удалено `git gc --prune=now --aggressive`; после этого 0 достижимых и 0 висячих |
| Publish-gate на публикуемых путях | **PASS** |

Отчёт-инвентарь: [pii-tracked-inventory.json](pii-tracked-inventory.json).

## 5. Остаточные риски и обязательные действия

1. **GitHub хранит недостижимые объекты** (старые блобы/коммиты) ещё какое-то время. Гарантированная очистка — только через **GitHub Support** или **пересоздание репозитория**. Force-push убирает объекты из ветки, но не обязательно из хранилища GitHub немедленно.
2. **Все существующие клоны содержат старую историю с PII.** Их нужно переклонировать (`git clone`) либо `git fetch origin && git reset --hard origin/main`. Иначе следующий push из такого клона вернёт PII.
3. **Параллельная сессия** (агент, коммитивший в 14:51) должна остановиться и сделать `git reset --hard origin/main`; её незакоммиченные правки нужно перенести вручную.
4. **Бэкап** `C:\Temp\dds-backup-20261123-150742.bundle` содержит PII. Рекомендуется удалить после подтверждения, что новая история в порядке: `Remove-Item C:\Temp\dds-backup-*.bundle`.
5. В отчётах, ссылавшихся на удалённые intermediates (`_gap_detail.txt` и т.п.), ссылки больше не разрешаются — это ожидаемо: файлы убраны из репозитория и истории.
