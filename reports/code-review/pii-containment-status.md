# Срочно: PII в публикации и в истории Git — что уже сделано и что требует решения

**Дата:** 2026-11-23 ~15:05 · **Статус:** containment выполнен; удаление из истории **не выполнено** (требует подтверждения)

## 1. Факты

| Факт | Значение |
|---|---|
| `HEAD` = `origin/main` | `4730108` «for check» (14:51) — параллельная сессия **уже запушила** коммит |
| PII-файлов в tracked-дереве | **129** (все 129 уже в `origin/main`) |
| Суммарно срабатываний | `person_name=14 020`, `phone=20`, `email=6`, `person_code=5` |
| Сырые PII-отчёты, попавшие в историю | `reports/phase-01-9/darkstore_7745_gap_findings.json`, `_gap_summary.txt`, `_chart_candidates.txt` (коммит `4730108`) |
| Крупнейшие носители (каталог метаданных) | `analysis_package/metrics_catalog.csv` (3 646), `reports/phase-01-6-2/chart_metrics.csv` (3 405), `charts_inventory.json` (1 050), `reports/phase-01-6/evidence/sql_full/3466.sql` (791) |
| Реальные жёсткие сигналы | `phone=2` в `reports/phase-01-4/05_sql_inventory.csv`, `phone=2` в `reports/phase-01-6-2/datasets_inventory.json`, `phone=8` в `tools/har-out/manifest.json` (похоже на HTTP-метаданные), фикстуры `docs/phase-01-5/fixtures/*` (синтетика) |

Полный перечень: `reports/code-review/pii-tracked-inventory.json`.

## 2. Что уже сделано (обратимо, без перезаписи истории)

1. **Publish-gate:** `bun tools/redact-pii.ts --in <dir> --gate` — падает (exit 1), если в публикуемых путях остались PII-совпадения; тестовые/фикстурные файлы исключены. Маскирование стало **идемпотентным** (повторный прогон даёт 0 совпадений).
2. **Опубликованные копии очищены:** `reports/public/**` проходит gate (`person_name=0 … secret=0`). ***REMOVED*** `reports/code-review/from-chart-production-readiness.md` и `final-live-aggregator-acceptance.md` вычищены от примеров-совпадений.
3. **Сырые отчёты сняты с публикации:** `git rm --cached` для трёх файлов (файлы остались на диске) + правила в `.gitignore`:
   `reports/phase-01-9/_*.txt`, `reports/phase-01-9/*_findings.json`. Эти удаления **застейджены, но не закоммичены**.
4. **Подготовлен скрипт очистки истории:** [purge-pii-history.ps1](../../tools/purge-pii-history.ps1) (dry-run по умолчанию).
   * Tier 1 — удалить сырые PII-отчёты из всех коммитов (`git filter-repo --invert-paths`, 3 пути + 2 glob).
   * Tier 2 — замаскировать ФИО/телефоны/почты **внутри** артефактов каталога во всей истории (`--replace-text`, 523 правила; правила лежат вне репозитория: `C:\Temp\pii-replacements.txt`).
   * `git filter-repo` установлен (`python -m pip install git-filter-repo`), проверен в dry-run.

## 3. Что не сделано и почему

Перезапись истории (**`filter-repo` + `git push --force`**) не выполнена, потому что:

* она ломает все существующие клоны и **активную параллельную сессию**, которая коммитит в этот же репозиторий;
* push переписывает общую ветку `main` на GitHub — действие необратимое без бэкапа (скрипт делает bundle в `C:\Temp`);
* GitHub ещё какое-то время хранит недостижимые объекты: гарантированная очистка — только через GitHub Support или пересоздание репозитория.

## 4. ***REMOVED*** (после остановки других писателей)

```powershell
# 1) зафиксировать containment (иначе filter-repo откажется работать на грязном дереве)
git add -A && git commit -m "pii: stop publishing raw reports, add publish gate"
# 2) Tier 1 (сырые отчёты) — затем при необходимости Tier 2 (маскирование каталогов в истории)
& tools/purge-pii-history.ps1                 # dry-run
& tools/purge-pii-history.ps1 -Execute
& tools/purge-pii-history.ps1 -Tier1And2 -Execute
# 3) опубликовать переписанную историю
git remote add origin git@github.com:goshva/dds.git
git push --force-with-lease origin main
```
