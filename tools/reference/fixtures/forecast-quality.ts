/**
 * TPL-4.1: fixtures страницы «Прогнозы и качество».
 * Соответствуют реальному QualityDto; показаны shadow/h1 и replay/h3.
 */
import { trusted, type TrustedHtml } from "../../../src/web/lib/format";
import { forecastQualityPage, type QualityDto } from "../../../src/web/pages/forecast-quality";
import { SYNTHETIC_CHECKSUM, referenceBanner, statesCard } from "./common";

function metrics(): QualityDto["independentMetrics"] {
  return [
    { mode: "shadow", horizon: 1, modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1", n: 1, mae: 40.43, wape: 2.617, bias: 40.43, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 1, overN: 0, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE", semantics: "PROVISIONAL" },
    { mode: "shadow", horizon: 1, modelId: "adaptive_baseline", modelVersion: "adaptive-baseline/v1+variantB", n: 1, mae: 124.12, wape: 8.034, bias: 124.12, maeStatus: "OK", wapeStatus: "OK", biasStatus: "OK", underN: 1, overN: 0, exactN: 0, excludedN: 0, overflowAffectedN: 0, sampleStatus: "COMPLETE", semantics: "PROVISIONAL" },
  ];
}

/** Теневой режим: одно наблюдение — статус интерпретируемости INSUFFICIENT. */
export function qualityShadowFixture(): QualityDto {
  return {
    mode: "shadow",
    horizon: 1,
    semantics: "PROVISIONAL",
    technicalFactCutoff: "2026-06-18",
    independentMetrics: metrics(),
    pairedComparison: { available: true, pairedN: 1, maeBaseline: 40.43, maeCandidate: 124.12, deltaMae: -83.69, status: "OK" },
    pairCounters: { baselineIndependentN: 1, candidateIndependentN: 1, pairedN: 1, excludedBaselineN: 3, excludedCandidateN: 3, unmatchedN: 0, conflictN: 0, pendingN: 6, missingActualN: 0, duplicateN: 0, unknownN: 0 },
    metricDiagnostics: [{ modelId: "rolling_7_day_mean", excludedN: 3, overflowAffectedN: 0, sampleStatus: "PARTIAL" }],
    sampleStatus: "PARTIAL",
    interpretabilityStatus: "INSUFFICIENT",
    warnings: ["PENDING_OBSERVATIONS_PRESENT"],
    provenance: { datasetChecksums: [SYNTHETIC_CHECKSUM.shadow], datasetVersionWarning: false, manifestStatus: "OK", freshness: "MATCH", shadowFileChecksums: { forecasts: SYNTHETIC_CHECKSUM.shadow } },
    availability: { available: true, reason: null },
  };
}

/** Историческая диагностика: сравнение недоступно, пары отсутствуют. */
export function qualityReplayFixture(): QualityDto {
  return {
    ...qualityShadowFixture(),
    mode: "replay",
    horizon: 3,
    pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" },
    pairCounters: { ...qualityShadowFixture().pairCounters, pairedN: 0, pendingN: 0 },
    interpretabilityStatus: "NOT_AVAILABLE",
    warnings: ["DATASET_VERSION_DIFFERS"],
    provenance: { datasetChecksums: [SYNTHETIC_CHECKSUM.normalized, SYNTHETIC_CHECKSUM.shadow], datasetVersionWarning: true, manifestStatus: "OK", freshness: "STALE", shadowFileChecksums: {} },
  };
}

export function forecastQualityContent(): TrustedHtml {
  return trusted(`${referenceBanner()}${forecastQualityPage({ data: qualityShadowFixture(), mode: "shadow", horizon: 1 })}${forecastQualityPage({ data: qualityReplayFixture(), mode: "replay", horizon: 3 })}${statesCard()}`);
}
