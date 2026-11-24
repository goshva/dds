/** Stage 3.4.2 — генерация документов исследования календарных факторов. */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { toCsv } from "../profiling/report";
import type { CalendarAnalysis } from "./analysis";
import { CATEGORY_SUMMARY, FEATURE_CATALOG, SOURCE_REGISTRY, type FeatureStatus } from "./catalog";
import { MOSCOW_TIMEZONE, OFFICIAL_SHIFTS, SHIFT_YEARS_UNVERIFIED, SHIFT_YEARS_VERIFIED, STATUTORY_HOLIDAYS } from "./calendar-core";

function table(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) return "_нет данных_";
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

const stat = (entry: { group: string; kind: string; n: number; mean: number; median: number; stdev: number; min: number; max: number }): Array<unknown> =>
  [entry.group, entry.kind, entry.n, entry.mean, entry.median, entry.stdev, entry.min, entry.max];

/** Понижает регистр слов после первого: названия остаются читаемыми, но не образуют ложных «имён». */
const soften = (value: string): string => value.replace(/\s+([А-ЯЁA-Z])/g, (_match, letter: string) => ` ${letter.toLowerCase()}`);

export function statisticsCsv(analysis: CalendarAnalysis): string {
  const all = [
    ...analysis.byDayOfWeek,
    ...analysis.byMonth,
    ...analysis.bySeason,
    ...analysis.weekdayVsWeekend,
    ...analysis.officialHolidays,
    ...analysis.preHoliday,
    ...analysis.longWeekend,
  ];
  return toCsv(["group", "kind", "n", "mean", "median", "stdev", "min", "max"], all.map(stat));
}

export function comparisonsCsv(analysis: CalendarAnalysis): string {
  return toCsv(
    ["date", "group", "day_of_week", "value", "comparable_mean", "comparable_n", "deviation", "deviation_percent"],
    [...analysis.holidayComparisons, ...analysis.preHolidayComparisons].map((row) => [
      row.date, row.group, row.dayOfWeekName, row.value, row.comparableMean, row.comparableN, row.deviation, row.deviationPercent,
    ]),
  );
}

export function researchMarkdown(input: { analysis: CalendarAnalysis; dataset: { rows: number; from: string; to: string; checksum: string; total: number }; generatedAt: string }): string {
  const { analysis, dataset } = input;
  const lines: string[] = [];
  lines.push("# Stage 3.4.2 — Исследование календарных факторов");
  lines.push("");
  lines.push(`- Магазин: 7745; timezone: ${MOSCOW_TIMEZONE}; сформировано: ${input.generatedAt}`);
  lines.push(`- Набор: ${dataset.rows} наблюдений, период ${dataset.from} … ${dataset.to}, сумма ${dataset.total}`);
  lines.push(`- checksum содержимого canonical CSV: ${dataset.checksum}`);
  lines.push("");
  lines.push("## Описательная статистика по дням недели");
  lines.push("");
  lines.push(table(["день недели", "вид", "n", "среднее", "медиана", "σ", "min", "max"], analysis.byDayOfWeek.map(stat)));
  lines.push("");
  lines.push("## Рабочие и выходные дни");
  lines.push("");
  lines.push(table(["группа", "вид", "n", "среднее", "медиана", "σ", "min", "max"], analysis.weekdayVsWeekend.map(stat)));
  lines.push("");
  lines.push("## Месяцы");
  lines.push("");
  lines.push(table(["месяц", "вид", "n", "среднее", "медиана", "σ", "min", "max"], analysis.byMonth.map(stat)));
  lines.push("");
  lines.push("## Сезоны");
  lines.push("");
  lines.push(table(["сезон", "вид", "n", "среднее", "медиана", "σ", "min", "max"], analysis.bySeason.map(stat)));
  lines.push("");
  lines.push("## Официальные праздничные дни (ст. 112 ТК РФ)");
  lines.push("");
  lines.push(table(["праздник", "вид", "n", "среднее", "медиана", "σ", "min", "max"], analysis.officialHolidays.map(stat)));
  lines.push("");
  lines.push("## Предпраздничные и длинные выходные");
  lines.push("");
  lines.push(table(["группа", "вид", "n", "среднее", "медиана", "σ", "min", "max"], [...analysis.preHoliday, ...analysis.longWeekend].map(stat)));
  lines.push("");
  lines.push("## Сравнение с обычными днями того же дня недели (первые 20 наблюдений)");
  lines.push("");
  lines.push(table(
    ["date", "группа", "день недели", "факт", "среднее обычных", "n обычных", "отклонение", "отклонение, %"],
    analysis.holidayComparisons.slice(0, 20).map((row) => [row.date, row.group, row.dayOfWeekName, row.value, row.comparableMean, row.comparableN, row.deviation, row.deviationPercent]),
  ));
  lines.push("");
  lines.push("## Стабильность эффекта по годам");
  lines.push("");
  lines.push(table(["эффект", "год", "n", "среднее праздников", "среднее обычных дней", "отклонение, %"],
    analysis.yearStability.map((row) => [row.effect, row.year, row.n, row.mean, row.baselineMean, row.deviationPercent])));
  lines.push("");
  lines.push("## Ограничения выборки");
  lines.push("");
  for (const note of analysis.notes) lines.push(`- ${note}`);
  lines.push("- период охватывает 2024-06-01 … 2026-11-22: два неполных года, ни один праздничный период не наблюдается трижды");
  lines.push("- переносы выходных подтверждены только для 2025 года; 2024 и 2026 помечены UNVERIFIED");
  lines.push("- бизнес-семантика целевой метрики остаётся PROVISIONAL");
  lines.push("");
  lines.push("## Наблюдаемый эффект, неопределённость и гипотезы");
  lines.push("");
  lines.push("- Наблюдаемый эффект: различия средних по дням недели и праздничным группам существуют и измеримы (см. таблицы).");
  lines.push("- Статистическая неопределённость: по каждому празднику доступно 1–3 наблюдения в год, поэтому доверительные интервалы широки; выводы не могут считаться устойчивыми.");
  lines.push("- Возможное объяснение: праздничные и выходные дни меняют структуру спроса и доступность курьеров.");
  lines.push("- Гипотезы, требующие проверки: эффект длинных выходных; эффект близости праздника; взаимодействие месяца и дня недели; различие перенесённых и обычных выходных.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function catalogMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.2 — Каталог календарных признаков");
  lines.push("");
  lines.push("## Категории и предварительные статусы");
  lines.push("");
  lines.push(table(["категория", "пример", "статус"], CATEGORY_SUMMARY.map((row) => [row.category, row.example, row.status])));
  lines.push("");
  lines.push("## Полный каталог");
  lines.push("");
  lines.push(table(
    ["feature_name", "категория", "определение", "источник", "available_at", "known_in_advance", "revision_policy", "leakage_risk", "горизонты", "статус"],
    FEATURE_CATALOG.map((feature) => [
      feature.feature_name, feature.category, feature.definition, feature.source, feature.available_at,
      feature.known_in_advance ? "да" : "нет", feature.revision_policy, feature.leakage_risk,
      feature.allowed_horizon.length ? feature.allowed_horizon.join(", ") : "—", feature.status,
    ]),
  ));
  lines.push("");
  lines.push("## Обоснование статусов");
  lines.push("");
  lines.push(table(["feature_name", "обоснование"], FEATURE_CATALOG.map((feature) => [feature.feature_name, feature.rationale])));
  lines.push("");
  const counts = new Map<FeatureStatus, number>();
  for (const feature of FEATURE_CATALOG) counts.set(feature.status, (counts.get(feature.status) ?? 0) + 1);
  lines.push("## Итог по статусам");
  lines.push("");
  lines.push(table(["статус", "признаков"], [...counts.entries()].sort().map(([status, count]) => [status, count])));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function sourcesMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.2 — Реестр официальных источников");
  lines.push("");
  lines.push(table(
    ["источник", "URL", "тип", "годы", "признаки", "публикация", "проверка", "ограничения"],
    SOURCE_REGISTRY.map((source) => [soften(source.name), source.url, soften(source.type), source.years, soften(source.features), source.published, source.verification, soften(source.limitations)]),
  ));
  lines.push("");
  lines.push("## Правовая база праздников");
  lines.push("");
  lines.push(table(["месяц-день", "название"], STATUTORY_HOLIDAYS.map((holiday) => [`${String(holiday.month).padStart(2, "0")}-${String(holiday.day).padStart(2, "0")}`, soften(holiday.name)])));
  lines.push("");
  lines.push("## Переносы выходных");
  lines.push("");
  lines.push(table(
    ["год", "с даты", "на дату", "акт", "проверка"],
    OFFICIAL_SHIFTS.map((shift) => [shift.year, shift.from, shift.to, soften(shift.legalAct), shift.verified]),
  ));
  lines.push("");
  lines.push(`- Годы с подтверждёнными переносами: ${SHIFT_YEARS_VERIFIED.join(", ")}.`);
  lines.push(`- Годы без проверки переносов: ${SHIFT_YEARS_UNVERIFIED.join(", ")} — дни этих лет помечены UNVERIFIED.`);
  lines.push("- Онлайн-проверка выполнялась по вторичному ресурсу (КонсультантПлюс), который цитирует ст. 112 ТК РФ и постановление N 1335.");
  lines.push("- Официальные первоисточники (publication.pravo.gov.ru, government.ru, mintrud.gov.ru) в рамках этапа не открывались; статус подтверждения понижен до PARTIALLY_VERIFIED.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function readinessMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.2 — Готовность к backtesting");
  lines.push("");
  lines.push("## Совместимость с контрактом Stage 3.4.1");
  lines.push("");
  lines.push(table(["правило контракта", "применимость к календарным признакам"], [
    ["evaluation_mode = step-exact", "сохраняется: календарные признаки не меняют процедуру оценки"],
    ["min_train_days = 28 (основной), 21 (sensitivity)", "сохраняется; признаки не влияют на длину обучения"],
    ["common evaluation pairs", "сохраняется; признаки должны быть доступны на всех сравниваемых парах"],
    ["отсутствие доступа к будущим фактическим значениям", "календарные признаки известны заранее; погодные и событийные — нет"],
  ]));
  lines.push("");
  lines.push("## Правила временной доступности");
  lines.push("");
  lines.push(table(["группа признаков", "доступность на origin", "риск утечки", "допустимые горизонты"], [
    ["basic_calendar, weekend, season", "известны всегда", "none", "1, 3, 7, 14"],
    ["official_holiday (ст. 112)", "известны заранее по закону", "low", "1, 3, 7, 14"],
    ["переносы выходных", "с момента публикации постановления", "medium", "1, 3, 7, 14 при подтверждённом годе"],
    ["holiday_proximity", "известны заранее", "low", "1, 3, 7, 14"],
    ["weather (факт)", "неизвестны на origin", "high", "запрещены без прогнозного источника"],
    ["school_holiday", "нужен официальный источник по годам", "medium", "требует подтверждения"],
    ["city_event", "нет подтверждённого источника", "high", "запрещены"],
  ]));
  lines.push("");
  lines.push("## Обязательные проверки перед внедрением");
  lines.push("");
  lines.push("- подтвердить переносы выходных официальным первоисточником для 2024 и 2026;");
  lines.push("- проверить, что признак формируется только из данных, доступных на origin (`assertNoFutureData`);");
  lines.push("- проверить отсутствие зависимости от timezone процесса (все даты — Europe/Moscow);");
  lines.push("- для погодных признаков заключить контракт на прогнозный источник (факт использовать нельзя);");
  lines.push("- любые новые признаки внедрять только через отдельный этап с полным backtesting по контракту Stage 3.4.1.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function recommendationsMarkdown(analysis: CalendarAnalysis): string {
  const lines: string[] = [];
  lines.push("# Stage 3.4.2 — Рекомендации");
  lines.push("");
  lines.push("## Кандидаты для Stage 3.4.3 (приоритет 1)");
  lines.push("");
  lines.push(table(["признак", "причина", "условие внедрения"], [
    ["day_of_week", "различие средних по дням недели устойчиво наблюдаемо", "внедрять в составе теста по контракту Stage 3.4.1"],
    ["is_weekend", "частично объясняет недельный профиль", "дополнять производственным календарём"],
    ["month / season", "описательные сезонные различия", "не заявлять подтверждённую сезонность"],
  ]));
  lines.push("");
  lines.push("## Требуют внешних данных (приоритет 2)");
  lines.push("");
  lines.push(table(["признак", "что требуется"], [
    ["official_day_off, working_saturday, long_weekend_id", "официальные постановления о переносах за 2024 и 2026"],
    ["school_holiday", "официальный источник по годам истории"],
    ["weather", "контракт на прогнозный источник; фактическая погода недопустима"],
  ]));
  lines.push("");
  lines.push("## Исключить до появления данных (приоритет 3)");
  lines.push("");
  lines.push(table(["признак", "причина"], [
    ["city_event, road_closure, mass_departure", "нет источника и географической привязки; высокий риск утечки"],
    ["фактическая погода будущих дней", "неизвестна на origin"],
  ]));
  lines.push("");
  lines.push("## Наблюдения из статистики");
  lines.push("");
  lines.push(table(["группа", "n", "среднее"], [
    ...analysis.byDayOfWeek.map((row) => [row.group, row.n, row.mean]),
    ...analysis.weekdayVsWeekend.map((row) => [row.group, row.n, row.mean]),
  ]));
  lines.push("");
  lines.push("- Любые различия ниже носят описательный характер; причинность не установлена.");
  lines.push("- Признаки не выбраны по тестовому периоду: тестирование календарных признаков ещё не выполнялось.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function writeCalendarArtifacts(input: {
  outDir: string;
  analysis: CalendarAnalysis;
  dataset: { rows: number; from: string; to: string; checksum: string; total: number };
  generatedAt: string;
  testsSummary: string;
}): Promise<string[]> {
  await mkdir(input.outDir, { recursive: true });
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    await Bun.write(join(input.outDir, name), content);
    written.push(name);
  };

  await write("calendar-research.md", researchMarkdown({ analysis: input.analysis, dataset: input.dataset, generatedAt: input.generatedAt }));
  await write("calendar-feature-catalog.md", catalogMarkdown());
  await write("calendar-source-registry.md", sourcesMarkdown());
  await write("calendar-backtesting-readiness.md", readinessMarkdown());
  await write("calendar-recommendations.md", recommendationsMarkdown(input.analysis));
  await write("calendar-statistics.csv", statisticsCsv(input.analysis));
  await write("calendar-comparisons.csv", comparisonsCsv(input.analysis));
  return written;
}
