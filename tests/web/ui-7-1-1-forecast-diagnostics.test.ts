// UI-7.1.1: тесты страницы диагностики прогнозирования (fallback на существующем API).
// Импортируются реальные production-функции (без копий логики).
import { describe, expect, test } from "bun:test";

import { forecastDiagnosticsInvalid, forecastDiagnosticsLoading, forecastDiagnosticsPage, type ForecastErrorsDto } from "../../src/web/pages/forecast-diagnostics";
import type { QualityDto } from "../../src/web/pages/forecast-quality";
import type { ApiResult } from "../../src/web/api/client";

function quality(over: Partial<QualityDto> = {}): QualityDto {
  return {
    mode: "shadow",
    horizon: 1,
    semantics: "PROVISIONAL",
    technicalFactCutoff: "2026-11-23",
    independentMetrics: [
      { mode: "shadow", horizon: 1, modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1", n: 4, mae: 100.48, wape: 6.5, bias: 10, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 2, overN: 2, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE", semantics: "PROVISIONAL" },
      { mode: "shadow", horizon: 1, modelId: "adaptive_baseline", modelVersion: "adaptive-baseline/v1+variantB", n: 4, mae: 85.87, wape: 5.5, bias: 8, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 2, overN: 2, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE", semantics: "PROVISIONAL" },
    ],
    pairedComparison: { available: true, pairedN: 4, maeBaseline: 100.48, maeCandidate: 85.87, deltaMae: -14.61, status: "OK" },
    pairCounters: { baselineIndependentN: 4, candidateIndependentN: 4, pairedN: 4, excludedBaselineN: 2, excludedCandidateN: 2, unmatchedN: 0, conflictN: 1, pendingN: 6, missingActualN: 0, duplicateN: 0, unknownN: 3 },
    metricDiagnostics: [{ modelId: "rolling_7_day_mean", excludedN: 2, overflowAffectedN: 0, sampleStatus: "COMPLETE" }],
    sampleStatus: "COMPLETE",
    interpretabilityStatus: "LIMITED",
    warnings: ["DATASET_VERSION_DIFFERS", "PENDING_OBSERVATIONS_PRESENT"],
    provenance: { datasetChecksums: ["d413286e", "8f2b1818"], datasetVersionWarning: true, manifestStatus: "OK", freshness: "STALE", shadowFileChecksums: { forecasts: "e35fe27b", reconciliations: "32ccd256" } },
    availability: { available: true, reason: null },
    ...over,
  };
}

function errorsDto(over: Partial<ForecastErrorsDto> = {}): ForecastErrorsDto {
  const base: ForecastErrorsDto = {
    mode: "shadow",
    total: 2,
    persistedErrorsAvailable: false,
    items: [
      { source: "detected", kind: "UNKNOWN_STATUS", snapshotId: "snap-1", recordType: "snapshot", reason: "mode=shadow/horizon=1/model_id=x/model_version=v/status=weird" },
      { source: "detected", kind: "CONFLICT_RECONCILIATION", snapshotId: "snap-2", recordType: "reconciliation", reason: "forecast_value" },
    ],
  };
  return { ...base, ...over };
}

const okQuality = (data: QualityDto = quality()): ApiResult<QualityDto> => ({ status: "ok", data, meta: { readOnly: true, generatedAt: "2026-11-24T11:14:48.138Z", source: "shadow_jsonl+canonical_csv" } });
const okErrors = (data: Partial<ForecastErrorsDto> = {}): ApiResult<ForecastErrorsDto> => ({ status: "ok", data: errorsDto(data), meta: { readOnly: true, generatedAt: "2026-11-24T11:14:48.200Z", source: "shadow_jsonl" } });
const naQuality = (reason = "NO_RECORDS_FOR_MODE_AND_HORIZON"): ApiResult<QualityDto> => ({ status: "not_available", data: null, meta: { readOnly: true, generatedAt: "2026-11-24T11:14:48.138Z", source: "shadow_jsonl", reason } });
const naErrors = (reason = "NO_DETECTED_DIAGNOSTICS"): ApiResult<ForecastErrorsDto> => ({ status: "not_available", data: null, meta: { readOnly: true, generatedAt: "2026-11-24T11:14:48.138Z", source: "shadow_jsonl", reason } });
const errQuality = (): ApiResult<QualityDto> => ({ status: "error", error: { code: "HTTP_503", message: "API вернул статус 503", eventId: "client-12345678" } });
const errErrors = (): ApiResult<ForecastErrorsDto> => ({ status: "error", error: { code: "TIMEOUT", message: "Превышено время ожидания ответа", eventId: "client-abcdefgh" } });

function render(input: Partial<Parameters<typeof forecastDiagnosticsPage>[0]> = {}): string {
  return forecastDiagnosticsPage({ mode: "shadow", horizon: 1, quality: okQuality(), errors: okErrors(), generatedAt: "2026-11-24T11:14:48.138Z", ...input });
}

describe("UI-7.1.1: блок A — состояние диагностики", () => {
  test("meta.generatedAt подписан как время формирования ответа, не как дата обновления данных", () => {
    const html = render();
    expect(html).toContain("Время формирования ответа API (meta.generatedAt)");
    expect(html).toContain("2026-11-24T11:14:48.138Z");
    expect(html).not.toContain("дата последнего наблюдения");
  });

  test("режим и горизонт подписаны", () => {
    const html = render({ mode: "replay", horizon: 3 });
    expect(html).toContain("Историческая диагностика (Replay)");
    expect(html).toContain("горизонт h3");
  });

  test("независимые статусы quality и errors", () => {
    const html = render({ quality: naQuality(), errors: okErrors() });
    expect(html).toContain("quality: not_available");
    expect(html).toContain("errors: ok");
  });
});

describe("UI-7.1.1: блок B — качество прогноза", () => {
  test("success quality response показывает счётчики и метрики", () => {
    const html = render();
    expect(html).toContain("Качество прогноза");
    expect(html).toContain("Ожидают факта (pending)");
    expect(html).toContain("pairedN");
    expect(html).toContain("rolling_7_day_mean");
    expect(html).toContain("100,48");
  });

  test("NOT_AVAILABLE quality → emptyState, не нули", () => {
    const html = render({ quality: naQuality("NO_RECORDS_FOR_MODE_AND_HORIZON") });
    expect(html).toContain("Данные качества недоступны");
    expect(html).toContain("NO_RECORDS_FOR_MODE_AND_HORIZON");
  });

  test("AG-13: отсутствующие метрики → [Н/Д], а не 0", () => {
    const q = quality({ independentMetrics: [{ ...quality().independentMetrics[0]!, n: 0, mae: null, wape: null, bias: null, sampleStatus: "NOT_AVAILABLE" }] });
    const html = render({ quality: okQuality(q) });
    expect(html).toContain("[Н/Д]");
  });

  test("error quality → errorState с кодом", () => {
    const html = render({ quality: errQuality() });
    expect(html).toContain("Ошибка запроса качества");
    expect(html).toContain("HTTP_503");
  });

  test("pending отдельно от ошибок (status=PENDING, note pending≠ошибка)", () => {
    const html = render();
    expect(html).toContain("pending ≠ ошибка");
  });

  test("warnings DATASET_VERSION_DIFFERS трактуется как предупреждение версии", () => {
    const html = render();
    expect(html).toContain("несколько версий dataset_checksum");
  });
});

describe("UI-7.1.1: блок C — обнаруженные диагностические записи", () => {
  test("успех: поля source/kind/snapshotId/recordType/reason", () => {
    const html = render();
    expect(html).toContain("Обнаруженные диагностические записи");
    expect(html).toContain("UNKNOWN_STATUS");
    expect(html).toContain("snap-1");
    expect(html).toContain("reconciliation");
    expect(html).toContain("forecast_value");
  });

  test("mode-wide: пояснение про отсутствие фильтра по горизонту", () => {
    const html = render();
    expect(html).toContain("API не поддерживает фильтрацию этого списка по горизонту");
  });

  test("not_available → показано как «Диагностических записей нет» + пояснение", () => {
    const html = render({ errors: naErrors() });
    expect(html).toContain("Диагностических записей нет");
    expect(html).toContain("не «ошибок нет»");
  });

  test("успешный пустой набор ≠ not_available", () => {
    const html = render({ errors: okErrors({ total: 0, items: [] }) });
    expect(html).toContain("Успешный пустой набор");
  });

  test("error errors → errorState", () => {
    const html = render({ errors: errErrors() });
    expect(html).toContain("Ошибка запроса диагностики");
    expect(html).toContain("TIMEOUT");
  });

  test("persisted journal недоступен — бейдж NOT_AVAILABLE", () => {
    const html = render();
    expect(html).toContain("Journal: N/A");
    expect(html).toContain("ds-badge--na");
  });

  test("не показываются identity/asOf/manifestVersion (полей нет в DTO)", () => {
    const html = render();
    // Negative-check: не должно быть этих несуществующих полей
    expect(html).not.toContain("identity");
    expect(html).not.toContain("asOf");
    expect(html).not.toContain("manifestVersion");
  });
});

describe("UI-7.1.1: блок D — provenance", () => {
  test("checksum mismatch → warning", () => {
    const html = render();
    // Бейдж теперь короткий, расшифровка в ds-sub
    expect(html).toContain("DATASET_VERSION_DIFFERS");
    expect(html).toContain("несколько версий dataset_checksum");
  });

  test("STALE freshness — пояснение без вывода об ошибочности модели", () => {
    const html = render();
    expect(html).toContain("не доказывает ошибочность прогноза");
  });

  test("неизвестный checksum не превращается в success", () => {
    const q = quality({ provenance: { datasetChecksums: [], datasetVersionWarning: false, manifestStatus: "CORRUPTED", freshness: "NOT_CONFIRMED", shadowFileChecksums: {} } });
    const html = render({ quality: okQuality(q) });
    expect(html).toContain("CORRUPTED");
    expect(html).toContain("NOT_CONFIRMED");
  });

  test("provenance скрыт, если quality недоступен", () => {
    const html = render({ quality: naQuality() });
    expect(html).toContain("Provenance недоступен");
  });
});

describe("UI-7.1.1: блок E — ограничения", () => {
  test("явные ограничения диагностики", () => {
    const html = render();
    expect(html).toContain("Ограничения диагностики");
    expect(html).toContain("persisted errors показываются как NOT_AVAILABLE");
    expect(html).toContain("Per-record eligibility reasons не предоставляются");
    expect(html).toContain("pending ≠ failed");
  });
});

describe("UI-7.1.1: XSS-защита", () => {
  test("XSS в kind/snapshotId/reason/scenario — экранируется", () => {
    const html = render({
      errors: okErrors({
        items: [{ source: "detected", kind: "<script>alert(1)</script>", snapshotId: "<img onerror=alert(2)>", recordType: "snapshot", reason: "<svg onload=alert(3)>" }],
      }),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror=alert(2)>");
    expect(html).not.toContain("<svg onload=alert(3)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("XSS в warning code из API", () => {
    const q = quality({ warnings: ["<script>alert(1)</script>"] });
    const html = render({ quality: okQuality(q) });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("UI-7.1.1: loading / invalid", () => {
  test("loading состояние отдельно", () => {
    const html = forecastDiagnosticsLoading();
    expect(html).toContain("Диагностика прогнозирования");
    expect(html).toContain("загрузка");
  });

  test("invalid params → errorState с INVALID_PARAMS", () => {
    const html = forecastDiagnosticsInvalid("evil", "9");
    expect(html).toContain("Некорректные параметры диагностики");
    expect(html).toContain("INVALID_PARAMS");
  });
});
