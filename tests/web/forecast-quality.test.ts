// UI-4.2.3: тесты отображения прогнозной аналитики (предупреждения, статусы, отсутствие ложного победителя).
import { describe, expect, test } from "bun:test";

import { forecastQualityPage, metricPresentation, qualityWarnings, type QualityDto } from "../../src/web/pages/forecast-quality";

function quality(over: Partial<QualityDto> = {}): QualityDto {
  const metrics = [
    { mode: "shadow", horizon: 1, modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1", n: 1, mae: 40.43, wape: 2.617, bias: 40.43, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 1, overN: 0, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE" as const, semantics: "PROVISIONAL" },
    { mode: "shadow", horizon: 1, modelId: "adaptive_baseline", modelVersion: "adaptive-baseline/v1+variantB", n: 1, mae: 124.12, wape: 8.034, bias: 124.12, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 1, overN: 0, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE" as const, semantics: "PROVISIONAL" },
  ];
  return {
    mode: "shadow",
    horizon: 1,
    semantics: "PROVISIONAL",
    technicalFactCutoff: "2026-11-23",
    independentMetrics: metrics,
    pairedComparison: { available: true, pairedN: 1, maeBaseline: 40.43, maeCandidate: 124.12, deltaMae: -83.7, status: "OK" },
    pairCounters: { baselineIndependentN: 1, candidateIndependentN: 1, pairedN: 1, excludedBaselineN: 0, excludedCandidateN: 0, unmatchedN: 0, conflictN: 0, pendingN: 6, missingActualN: 0, duplicateN: 0, unknownN: 0 },
    metricDiagnostics: [{ modelId: "rolling_7_day_mean", excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE" }],
    sampleStatus: "COMPLETE",
    interpretabilityStatus: "INSUFFICIENT",
    warnings: [],
    provenance: { datasetChecksums: ["8f2b1818da00"], datasetVersionWarning: false, manifestStatus: "OK", freshness: "MATCH", shadowFileChecksums: { forecasts: "e35fe27b" } },
    availability: { available: true, reason: null },
    ...over,
  };
}

describe("UI-4.2: предупреждения секции качества", () => {
  test("shadow с одним наблюдением: описательный характер и недостаток пар", () => {
    const warnings = qualityWarnings(quality({ pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" }, interpretabilityStatus: "NOT_AVAILABLE" }));
    expect(warnings.some((warning) => warning.includes("описательный характер"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Недостаточно созревших пар"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("PROVISIONAL") || warning.includes("не подтверждена"))).toBe(true);
  });
  test("replay маркируется как историческая диагностика", () => {
    const warnings = qualityWarnings(quality({ mode: "replay", interpretabilityStatus: "LIMITED" }));
    expect(warnings.some((warning) => warning.includes("Историческая диагностика"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Не является текущим Shadow Mode"))).toBe(true);
  });
  test("несколько версий dataset_checksum и pending дают предупреждения", () => {
    const warnings = qualityWarnings(quality({ provenance: { datasetChecksums: ["a", "b"], datasetVersionWarning: true, manifestStatus: "OK", freshness: "STALE", shadowFileChecksums: {} } }));
    expect(warnings.some((warning) => warning.includes("dataset_checksum"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Ожидают факта"))).toBe(true);
  });
});

describe("UI-4.2: страница качества", () => {
  test("отображает n, pairedN, статусы и не объявляет победителя", () => {
    const html = forecastQualityPage({ data: quality(), mode: "shadow", horizon: 1 });
    expect(html).toContain("Прогнозы и качество моделей");
    expect(html).toContain("rolling_7_day_mean");
    expect(html).toContain("adaptive_baseline");
    expect(html).toContain("pairedN = 1");
    expect(html).toContain("INSUFFICIENT");
    expect(html).toContain("PROVISIONAL");
    expect(html).toContain("не доказательство превосходства");
    expect(html).not.toContain("Улучшение");
    expect(html).not.toContain("победитель:");
  });
  test("null-метрики отображаются как [Н/Д], а не нулём", () => {
    const data = quality({ pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" } });
    const html = forecastQualityPage({ data, mode: "shadow", horizon: 1 });
    expect(html).toContain("[Н/Д]");
    expect(html).toContain("сравнение недоступно");
  });
  test("экранирование: значения источника не создают разметку", () => {
    const html = forecastQualityPage({ data: quality({ provenance: { datasetChecksums: ['<img src=x onerror=alert(1)>'], datasetVersionWarning: true, manifestStatus: "OK", freshness: "MATCH", shadowFileChecksums: {} } }), mode: "shadow", horizon: 1 });
    expect(html).not.toContain("<img");
  });
});
describe("UI-4.2.5: раздельные статусы метрик", () => {
  test("INSUFFICIENT: значение показывается, но статус не OK", () => {
    const result = metricPresentation({ value: 40.43, n: 1, sampleStatus: "COMPLETE", interpretabilityStatus: "INSUFFICIENT" });
    expect(result.value).toBe("40,43");
    expect(result.status).toBe("PENDING");
    expect(result.interpretable).toBe(false);
    expect(result.note).toContain("описательное значение");
  });
  test("NOT_AVAILABLE: числовое значение не подаётся как доступная метрика", () => {
    const result = metricPresentation({ value: 40.43, n: 0, sampleStatus: "NOT_AVAILABLE", interpretabilityStatus: "NOT_AVAILABLE" });
    expect(result.value).toBe("[Н/Д]");
    expect(result.status).toBe("NOT_AVAILABLE");
    expect(result.interpretable).toBe(false);
  });
  test("LIMITED: ограниченная интерпретация, не OK и не доказательство достаточности", () => {
    const result = metricPresentation({ value: 100.55, n: 875, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" });
    expect(result.status).toBe("PENDING");
    expect(result.note).toContain("ограниченная интерпретация");
    expect(result.interpretable).toBe(true);
  });
  test("NOT_ASSESSED и null-значение", () => {
    expect(metricPresentation({ value: null, n: 0, sampleStatus: "NOT_AVAILABLE", interpretabilityStatus: "NOT_ASSESSED" }).status).toBe("NOT_AVAILABLE");
    expect(metricPresentation({ value: 10, n: 0, sampleStatus: "NOT_AVAILABLE", interpretabilityStatus: "NOT_ASSESSED" }).value).toBe("[Н/Д]");
  });
  test("PARTIAL: техническая полнота отражается в примечании", () => {
    const result = metricPresentation({ value: 100, n: 5, sampleStatus: "PARTIAL", interpretabilityStatus: "LIMITED" });
    expect(result.note).toContain("PARTIAL");
  });
  test("страница не содержит зелёного статуса качества при INSUFFICIENT и NOT_AVAILABLE", () => {
    const insufficient = forecastQualityPage({ data: quality(), mode: "shadow", horizon: 1 });
    // секция независимых метрик и парного сравнения не должна содержать зелёный статус качества
    const metricsSection = insufficient.slice(insufficient.indexOf("Независимые метрики"), insufficient.indexOf("Полнота и диагностика"));
    expect(metricsSection.includes("ds-badge--ok")).toBe(false);
    expect(metricsSection).toContain("описательное значение");
    const unavailable = forecastQualityPage({
      data: quality({ pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" }, interpretabilityStatus: "NOT_AVAILABLE" }),
      mode: "shadow", horizon: 1,
    });
    expect(unavailable).toContain("[Н/Д]");
    expect(unavailable).toContain("интерпретация недоступна");
  });
  test("replay h1/h3: историческая диагностика и статусы без OK", () => {
    for (const horizon of [1, 3]) {
      const html = forecastQualityPage({ data: quality({ mode: "replay", horizon, interpretabilityStatus: "LIMITED" }), mode: "replay", horizon });
      expect(html, `h${horizon}`).toContain("Историческая диагностика");
      expect(html, `h${horizon}`).toContain("ограниченная интерпретация");
    }
  });
  test("shadow h3 с pairedN = 0 показывает недоступность сравнения", () => {
    const html = forecastQualityPage({
      data: quality({ horizon: 3, pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" }, interpretabilityStatus: "NOT_AVAILABLE" }),
      mode: "shadow", horizon: 3,
    });
    expect(html).toContain("сравнение недоступно");
    expect(html).toContain("Недостаточно созревших пар для сравнения моделей.");
  });
  test("отсутствие baseline или candidate не создаёт фиктивных значений", () => {
    const onlyBaseline = quality({ independentMetrics: quality().independentMetrics.filter((metric) => metric.modelId === "rolling_7_day_mean") });
    const html = forecastQualityPage({ data: onlyBaseline, mode: "shadow", horizon: 1 });
    expect(html).toContain("[Н/Д]");
    const onlyCandidate = quality({ independentMetrics: quality().independentMetrics.filter((metric) => metric.modelId === "adaptive_baseline") });
    expect(forecastQualityPage({ data: onlyCandidate, mode: "shadow", horizon: 1 })).toContain("[Н/Д]");
  });
  test("несколько dataset checksum и STALE отражаются предупреждением", () => {
    const html = forecastQualityPage({
      data: quality({ provenance: { datasetChecksums: ["a", "b"], datasetVersionWarning: true, manifestStatus: "OK", freshness: "STALE", shadowFileChecksums: {} } }),
      mode: "shadow", horizon: 1,
    });
    expect(html).toContain("несколько версий dataset_checksum");
    expect(html).toContain("STALE");
  });
  test("экранирование значений DTO", () => {
    const html = forecastQualityPage({ data: quality({ provenance: { datasetChecksums: ['"><script>alert(1)</script>'], datasetVersionWarning: true, manifestStatus: "OK", freshness: "MATCH", shadowFileChecksums: {} } }), mode: "shadow", horizon: 1 });
    expect(html).not.toContain("<script>");
  });
});
describe("UI-4.2.6: fail-closed представление метрик", () => {
  const cases: Array<{ name: string; input: Parameters<typeof metricPresentation>[0]; value: string; status: "OK" | "PENDING" | "NOT_AVAILABLE" | "PROVISIONAL"; interpretable: boolean }> = [
    { name: "n = 0 при LIMITED", input: { value: 100, n: 0, sampleStatus: "NOT_AVAILABLE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "n = -1", input: { value: 100, n: -1, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "n = 5, неизвестный sampleStatus", input: { value: 100, n: 5, sampleStatus: "UNKNOWN", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "неизвестный interpretabilityStatus", input: { value: 100, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "SOMETHING" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "NaN", input: { value: Number.NaN, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "Infinity", input: { value: Number.POSITIVE_INFINITY, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "-Infinity", input: { value: Number.NEGATIVE_INFINITY, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "null", input: { value: null, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
    { name: "COMPLETE + LIMITED", input: { value: 100.55, n: 875, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" }, value: "100,55", status: "PENDING", interpretable: true },
    { name: "PARTIAL + LIMITED", input: { value: 100.55, n: 12, sampleStatus: "PARTIAL", interpretabilityStatus: "LIMITED" }, value: "100,55", status: "PENDING", interpretable: true },
    { name: "COMPLETE + INSUFFICIENT", input: { value: 40.43, n: 1, sampleStatus: "COMPLETE", interpretabilityStatus: "INSUFFICIENT" }, value: "40,43", status: "PENDING", interpretable: false },
    { name: "NOT_ASSESSED", input: { value: 100, n: 5, sampleStatus: "COMPLETE", interpretabilityStatus: "NOT_ASSESSED" }, value: "[Н/Д]", status: "NOT_AVAILABLE", interpretable: false },
  ];

  for (const item of cases) {
    test(`${item.name}: value=${item.value}, status=${item.status}`, () => {
      const result = metricPresentation(item.input);
      expect(result.value, item.name).toBe(item.value);
      expect(result.status).toBe(item.status);
      expect(result.interpretable, item.name).toBe(item.interpretable);
      // ни одна комбинация не даёт зелёный статус качества
      expect(result.status, item.name).not.toBe("OK");
    });
  }

  test("независимые метрики имеют собственный n, парное сравнение — собственный pairedN", () => {
    const data = quality({ independentMetrics: [
      { ...quality().independentMetrics[0]!, n: 875, sampleStatus: "COMPLETE" },
      { ...quality().independentMetrics[1]!, n: 0, sampleStatus: "NOT_AVAILABLE", mae: null },
    ], pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" } });
    const html = forecastQualityPage({ data, mode: "shadow", horizon: 1 });
    const metricsSection = html.slice(html.indexOf("Независимые метрики"), html.indexOf("Полнота и диагностика"));
    expect(metricsSection).toContain("875");
    expect(metricsSection).toContain("[Н/Д]");
    expect(metricsSection).not.toContain("ds-badge--ok");
  });

  test("pairedN = 0 не создаёт зелёный статус независимо от числа независимых наблюдений", () => {
    const data = quality({ independentMetrics: quality().independentMetrics.map((metric) => ({ ...metric, n: 875 })), pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" }, interpretabilityStatus: "NOT_AVAILABLE" });
    const html = forecastQualityPage({ data, mode: "replay", horizon: 1 });
    const pairedSection = html.slice(html.indexOf("Парное сравнение"), html.indexOf("Полнота и диагностика"));
    expect(pairedSection).not.toContain("ds-badge--ok");
    expect(pairedSection).toContain("[Н/Д]");
  });
});
describe("UI-4.2.6.1: безопасная целочисленная проверка n", () => {
  const invalid = [
    { name: "MAX_SAFE_INTEGER + 1", n: Number.MAX_SAFE_INTEGER + 1 },
    { name: "1e100", n: 1e100 },
    { name: "1.5", n: 1.5 },
  ];
  for (const item of invalid) {
    test(`${item.name}: значение недоступно (fail-closed)`, () => {
      const result = metricPresentation({ value: 100, n: item.n, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" });
      expect(result.value).toBe("[Н/Д]");
      expect(result.status).toBe("NOT_AVAILABLE");
      expect(result.interpretable).toBe(false);
      expect(result.status).not.toBe("OK");
    });
  }
  test("MAX_SAFE_INTEGER: допустимое целое", () => {
    const result = metricPresentation({ value: 100, n: Number.MAX_SAFE_INTEGER, sampleStatus: "COMPLETE", interpretabilityStatus: "LIMITED" });
    expect(result.value).toBe("100");
    expect(result.status).toBe("PENDING");
    expect(result.interpretable).toBe(true);
  });
  test("n = 1: корректная минимальная положительная выборка", () => {
    const result = metricPresentation({ value: 40.43, n: 1, sampleStatus: "COMPLETE", interpretabilityStatus: "INSUFFICIENT" });
    expect(result.value).toBe("40,43");
    expect(result.status).toBe("PENDING");
    expect(result.interpretable).toBe(false);
    expect(result.note).toContain("недостаточно наблюдений");
  });
});