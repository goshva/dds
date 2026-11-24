#!/usr/bin/env bun
/**
 * CLI Stage 3.3.3 — документ бизнес-семантики целевой метрики.
 *
 *   bun run forecast:semantics [--out <dir>] [--now <ISO>]
 *
 * Документ генерируется из кода (`business-definition.ts`) — единого источника определения.
 * Коды возврата: 0 — PROVISIONAL/CONFIRMED, 2 — BLOCKED, 1 — ошибка.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { semanticsGate, TARGET_BUSINESS_DEFINITION } from "../analytics/semantics/business-definition";

const DEFAULT_OUT = "reports/forecasting/stage-3.3";

function mdTable(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) return "_нет данных_";
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

function buildMarkdown(generatedAt: string): string {
  const definition = TARGET_BUSINESS_DEFINITION;
  const gate = semanticsGate(definition);
  const lines: string[] = [];
  lines.push("# Stage 3.3.3 — Бизнес-семантика целевой метрики");
  lines.push("");
  lines.push(`**Метрика:** \`${definition.metric}\` → \`${definition.business_name}\``);
  lines.push(`**Статус подтверждения:** **${definition.confirmation_status}**`);
  lines.push(`**confirmed_by:** ${definition.confirmed_by ?? "— (не заполняется вымышленными значениями)"}`);
  lines.push(`**confirmed_at:** ${definition.confirmed_at ?? "—"}`);
  lines.push(`**Сформировано:** ${generatedAt}`);
  lines.push("");
  lines.push("## Определение (FACT/INFERENCE)");
  lines.push("");
  lines.push(definition.business_definition);
  lines.push("");
  lines.push(mdTable(["Поле", "Значение"], [
    ["unit", definition.unit],
    ["aggregation_rule", definition.aggregation_rule],
    ["date_attribution_rule", definition.date_attribution_rule],
    ["timezone", definition.timezone],
    ["source", definition.source],
    ["source_slice", definition.source_slice],
    ["source_chart_id", definition.source_chart_id],
  ]));
  lines.push("");
  lines.push("## Фактические параметры запроса-источника");
  lines.push("");
  lines.push(mdTable(["Параметр", "Значение"], [
    ["metrics", definition.source_query_facts.metrics.join(", ")],
    ["granularity", definition.source_query_facts.granularity],
    ["time_grain_sqla", definition.source_query_facts.time_grain],
    ["groupby", definition.source_query_facts.groupby.join(", ")],
    ["row_limit", definition.source_query_facts.row_limit ?? "—"],
    ["фильтры", definition.source_query_facts.filters.join("; ")],
  ]));
  lines.push("");
  lines.push("## Проверочные вопросы");
  lines.push("");
  lines.push(mdTable(
    ["Вопрос", "Ответ", "Статус", "Основание"],
    definition.questions.map((question) => [question.question, question.answer, question.status, question.evidence]),
  ));
  lines.push("");
  lines.push("## Известные ограничения");
  lines.push("");
  for (const limitation of definition.known_limitations) lines.push(`- ${limitation}`);
  lines.push("");
  lines.push("## Gate для дальнейшей аналитики");
  lines.push("");
  lines.push(mdTable(["Параметр", "Значение"], [
    ["статус семантики", gate.status],
    ["техническое сравнение baseline разрешено", gate.allowTechnicalComparison ? "да" : "нет"],
    ["результаты помечаются как provisional", gate.provisionalLabel ? "да" : "нет"],
  ]));
  lines.push("");
  for (const reason of gate.reasons) lines.push(`- ${reason}`);
  lines.push("");
  lines.push("## Что требуется подтвердить от бизнес-владельца");
  lines.push("");
  for (const item of definition.required_confirmations) lines.push(`- ${item}`);
  lines.push("");
  lines.push("Пока эти пункты не подтверждены, выводы Stage 3.3.5 считаются **техническими**: они показывают поведение моделей на данных, но не доказывают, что модель прогнозирует подтверждённый бизнес-показатель.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(argv: string[]): Promise<number> {
  let out = DEFAULT_OUT;
  let now = new Date().toISOString();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i] ?? out;
    else if (argv[i] === "--now") now = argv[++i] ?? now;
  }
  try {
    const dir = resolve(out);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "3.3.3-business-semantics.md");
    await Bun.write(path, buildMarkdown(now));
    const gate = semanticsGate();
    console.log(JSON.stringify({
      path,
      metric: TARGET_BUSINESS_DEFINITION.metric,
      confirmation_status: gate.status,
      provisional: gate.provisionalLabel,
      required_confirmations: TARGET_BUSINESS_DEFINITION.required_confirmations.length,
    }, null, 2));
    return gate.status === "BLOCKED" ? 2 : 0;
  } catch (error) {
    console.error(`[ОШИБКА] ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
