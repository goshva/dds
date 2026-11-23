/**
 * Формирование отчёта сверки (markdown + JSON).
 * Отчёт не скрывает расхождения: он показывает их, объясняет и даёт итоговый статус.
 */

import type { ComparisonResult, NormalizedRun } from "./types";
import { explain } from "./difference-classifier";

export interface ReportInput {
  result: ComparisonResult;
  old_run: NormalizedRun;
  new_run: NormalizedRun;
  /** Текст о результате авторизации (без секретов и токенов). */
  authorization: string;
  /** Описание параметров запуска сборщика. */
  collection: { command: string; strategy: string; incident?: string };
  /** Дополнительный раздел по chart 20209 (если проверка выполнялась). */
  chart_20209?: string;
  /** Максимум строк в таблице расхождений в markdown (полный список — в JSON). */
  diff_table_limit?: number;
}

const fmt = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(4);

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "_нет данных_";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`)].join("\n");
}

const STATUS_LABEL: Record<ComparisonResult["status"], string> = {
  IDENTICAL: "**IDENTICAL** — данные совпадают полностью",
  MATCH_WITH_MINOR_DIFFERENCES: "**MATCH_WITH_MINOR_DIFFERENCES** — совпадение с незначительными отличиями",
  DATA_CHANGED: "**DATA_CHANGED** — значения в источнике изменились",
  INCOMPLETE: "**INCOMPLETE** — выгрузка неполная",
  BLOCKED: "**BLOCKED** — доступ или период не позволяют сравнить данные",
};

/** Итоговый вывод о пригодности набора данных для импорта. */
export function suitability(result: ComparisonResult): string {
  switch (result.status) {
    case "IDENTICAL":
      return "Набор пригоден для импорта; допустимо импортировать любую из версий, рекомендуется сохранить обе как отдельные источники с провенансом.";
    case "MATCH_WITH_MINOR_DIFFERENCES":
      return "Набор пригоден для импорта с оговорками: отличия касаются только новых/исчезнувших строк и служебных полей, значения совпадают. Рекомендуется импортировать обе версии и зафиксировать отличия в журнале.";
    case "DATA_CHANGED":
      return "Требуется решение пользователя: значения за один и тот же период различаются. Не импортировать до выбора достоверной версии; не считать новую выгрузку правильной только потому, что она новее.";
    case "INCOMPLETE":
      return "Импорт запрещён: неполная выгрузка. Повторить сбор проблемных срезов и сверку заново.";
    default:
      return "Импорт невозможен: доступ или период. Требуется вмешательство (права на датасет, корректный период).";
  }
}

export function buildReconciliationReport(input: ReportInput): string {
  const { result, old_run, new_run } = input;
  const diffLimit = input.diff_table_limit ?? 50;
  const lines: string[] = [];

  lines.push("# Сверка данных Superset: старая выгрузка и повторный API-сбор");
  lines.push("");
  lines.push(`**Дата сверки:** ${result.generated_at}`);
  lines.push(`**Старая выгрузка (контрольный набор):** \`${result.old_dir}\``);
  lines.push(`**Новая выгрузка (API refresh):** \`${result.new_dir}\``);
  lines.push(`**Итоговый статус:** ${STATUS_LABEL[result.status]}`);
  lines.push("");

  const lastDataDate = new_run.observations
    .filter((o) => !o.isTotal && o.parts.date)
    .map((o) => o.parts.date)
    .sort()
    .at(-1);

  lines.push("## 1. Параметры API-сбора");
  lines.push("");
  lines.push(table(
    ["Параметр", "Значение"],
    [
      ["Команда сборщика", input.collection.command],
      ["Стратегия", input.collection.strategy],
      ["Даркстор", new_run.shop_no],
      ["Период (старая / новая)", `${old_run.period.time_range} / ${new_run.period.time_range}`],
      ["Верхняя граница", `исключающая; фактический последний день данных — ${lastDataDate ?? "—"}`],
      ["Часовой пояс", "Europe/Moscow"],
      ["Артефакты", "manifest.json, quality.json, validation.json, request/response JSON, observations CSV, aggregate CSV"],
      [
        "Маскирование измерений",
        `старая выгрузка: измерения замаскированы (${result.masking.masked_rows_old} строк); ` +
          `новая: сырые измерения при сборе с \`--raw-artifacts\` (маскировщик затронул бы ${result.masking.masked_rows_new} строк)`,
      ],
    ],
  ));
  lines.push("");
  if (input.collection.incident) {
    lines.push(`**Инцидент при сборе:** ${input.collection.incident}`);
    lines.push("");
  }

  lines.push("## 2. Источники и их статусы");
  lines.push("");
  const sourceRows: string[][] = [];
  for (const sliceId of result.slices.new) {
    const source = new_run.sources.find((s) => s.slice_id === sliceId);
    const oldSource = old_run.sources.find((s) => s.slice_id === sliceId);
    const oldQuality = old_run.quality_by_slice.get(sliceId);
    const newQuality = new_run.quality_by_slice.get(sliceId);
    sourceRows.push([
      String(sliceId),
      String(source?.dataset_id ?? "—"),
      source?.file ? source.file.split("\\").pop()! : "—",
      oldSource && source && oldSource.request_sha256 === source.request_sha256 ? "совпадает" : "ОТЛИЧАЕТСЯ",
      fmt(oldQuality?.http_status ?? null),
      fmt(newQuality?.http_status ?? null),
      `${oldQuality?.completeness ?? "—"} / ${newQuality?.completeness ?? "—"}`,
    ]);
  }
  lines.push(table(["slice", "dataset", "тело запроса", "request_sha256", "HTTP старый", "HTTP новый", "полнота старая/новая"], sourceRows));
  lines.push("");

  lines.push("## 3. Авторизация");
  lines.push("");
  lines.push(input.authorization);
  lines.push("");

  lines.push("## 4. Объёмы и результаты сравнения");
  lines.push("");
  lines.push(table(
    ["Показатель", "Значение"],
    [
      ["Количество запросов", `${result.slices.new.length} (новая выгрузка), ${result.slices.old.length} (старая)`],
      ["Строк в старой выгрузке", String(old_run.observations.length)],
      ["Строк в новой выгрузке", String(new_run.observations.length)],
      ["Сравнено наблюдений", String(result.counts.compared)],
      ["Совпало (IDENTICAL)", String(result.counts.identical)],
      ["  из них дневных", String(result.counts.daily_identical)],
      ["  из них итоги за период", String(result.counts.totals_identical)],
      ["Значения изменились (VALUE_CHANGED)", String(result.counts.value_changed)],
      ["Новые строки (NEW_ROW)", String(result.counts.new_rows)],
      ["Исчезнувшие строки (MISSING_ROW)", String(result.counts.missing_rows)],
      ["Строк с пустой датой (итоги за период)", `${old_run.total_rows} / ${new_run.total_rows}`],
      ["Дубли", `${result.counts.duplicates_old} / ${result.counts.duplicates_new}`],
      ["Допуск сравнения", `abs=${result.tolerance.abs}, rel=${result.tolerance.rel}`],
    ],
  ));
  lines.push("");

  lines.push("## 5. Сравнение по срезам");
  lines.push("");
  lines.push(table(
    [
      "slice",
      "дневных старая",
      "дневных новая",
      "итогов старая",
      "итогов новая",
      "совпало",
      "изменено",
      "новых",
      "исчезло",
      "итог qty_orders_delivered старая",
      "итог новая",
      "состав метрик",
    ],
    result.per_slice.map((s) => [
      String(s.slice_id),
      String(s.old_rows),
      String(s.new_rows),
      String(s.totals_rows_old),
      String(s.totals_rows_new),
      String(s.identical),
      String(s.value_changed),
      String(s.added),
      String(s.missing),
      fmt(s.total_old),
      fmt(s.total_new),
      s.metric_set_changed ? "ИЗМЕНИЛСЯ" : "без изменений",
    ]),
  ));
  lines.push("");
  lines.push("_Дневные итоги разных срезов не суммируются: каждый срез проверяется отдельно._");
  lines.push("");

  lines.push("## 6. Агрегаты по срезам (суммы аддитивных метрик за период)");
  lines.push("");
  const changedAggregates = result.aggregates.filter((a) => a.changed);
  lines.push(table(
    ["slice", "метрика", "старая сумма", "новая сумма", "абс. разница", "отн. разница", "изменилось"],
    (changedAggregates.length ? changedAggregates : result.aggregates.slice(0, 20)).map((a) => [
      String(a.slice_id),
      a.metric,
      fmt(a.old_total),
      fmt(a.new_total),
      fmt(a.abs_delta),
      a.rel_delta === null ? "—" : a.rel_delta.toExponential(3),
      a.changed ? "да" : "нет",
    ]),
  ));
  lines.push("");
  lines.push(changedAggregates.length ? `Изменившихся агрегатов: ${changedAggregates.length}.` : "Все агрегаты совпадают.");
  lines.push("");

  lines.push("## 7. Качество запросов");
  lines.push("");
  if (result.quality_changes.length) {
    lines.push(table(
      ["slice", "поле", "было", "стало", "ухудшение"],
      result.quality_changes.map((q) => [String(q.slice_id), q.field, q.old_value, q.new_value, q.degraded ? "да" : "нет"]),
    ));
  } else {
    lines.push("Ухудшений качества не обнаружено.");
  }
  if (result.quality_improvements.length) {
    lines.push("");
    lines.push("Улучшения качества (не являются расхождением данных):");
    lines.push("");
    lines.push(table(
      ["slice", "поле", "было", "стало"],
      result.quality_improvements.map((q) => [String(q.slice_id), q.field, q.old_value, q.new_value]),
    ));
  }
  lines.push("");

  lines.push("## 8. Таблица расхождений");
  lines.push("");
  if (!result.diffs.length) {
    lines.push("Расхождений не обнаружено.");
  } else {
    const byCategory = new Map<string, number>();
    for (const diff of result.diffs) byCategory.set(diff.category, (byCategory.get(diff.category) ?? 0) + 1);
    lines.push(table(["категория", "количество"], [...byCategory.entries()].sort().map(([c, n]) => [c, String(n)])));
    lines.push("");
    lines.push(`Показаны первые ${Math.min(diffLimit, result.diffs.length)} из ${result.diffs.length}; полный список — в JSON-файле отчёта.`);
    lines.push("");
    lines.push(table(
      ["категория", "совмещение", "slice", "дата", "метрика", "измерение 1", "измерение 2", "старое", "новое", "разница", "комментарий"],
      result.diffs.slice(0, diffLimit).map((d) => [
        d.category,
        d.scope,
        d.slice_id === null ? "—" : String(d.slice_id),
        d.date || "—",
        d.metric || "—",
        d.dimension_1 || "—",
        d.dimension_2 || "—",
        fmt(d.old_value),
        fmt(d.new_value),
        fmt(d.abs_delta),
        d.detail,
      ]),
    ));
  }
  lines.push("");

  lines.push("## 9. Объяснения выявленных изменений");
  lines.push("");
  const explained = new Set<string>();
  for (const diff of result.diffs) {
    if (explained.has(diff.category)) continue;
    explained.add(diff.category);
    lines.push(`- **${diff.category}** — ${explain(diff.category)}`);
  }
  if (!explained.size) lines.push("- Расхождений нет, объяснения не требуются.");
  lines.push("");
  lines.push("### Влияние маскирования");
  lines.push("");
  lines.push(
    `Старая выгрузка хранится с замаскированными измерениями (${result.masking.masked_rows_old} строк), новая сделана с \`--raw-artifacts\`.` +
      ` Для корректного сравнения обе стороны приведены к одному виду тем же маскировщиком.` +
      ` Различий в исходном тексте измерений, скрытых маскированием: ${result.masking.hidden_dimension_differences}.`,
  );
  lines.push("");

  if (input.chart_20209) {
    lines.push("## 10. Отдельная проверка chart 20209");
    lines.push("");
    lines.push(input.chart_20209);
    lines.push("");
  }

  lines.push(input.chart_20209 ? "## 11. Вывод о пригодности данных" : "## 10. Вывод о пригодности данных");
  lines.push("");
  lines.push(suitability(result));
  lines.push("");
  lines.push("### Статус");
  lines.push("");
  lines.push(STATUS_LABEL[result.status]);
  lines.push("");
  lines.push("### Примечания методики");
  lines.push("");
  for (const note of result.notes) lines.push(`- ${note}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function buildReconciliationJson(input: ReportInput): string {
  return `${JSON.stringify(
    {
      generated_at: input.result.generated_at,
      status: input.result.status,
      suitability: suitability(input.result),
      collection: input.collection,
      authorization: input.authorization,
      old: {
        dir: input.old_run.dir,
        shop_no: input.old_run.shop_no,
        period: input.old_run.period,
        rows: input.old_run.observations.length,
        sources: input.old_run.sources,
      },
      new: {
        dir: input.new_run.dir,
        shop_no: input.new_run.shop_no,
        period: input.new_run.period,
        rows: input.new_run.observations.length,
        sources: input.new_run.sources,
      },
      result: input.result,
    },
    null,
    2,
  )}\n`;
}
