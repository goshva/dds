/**
 * TPL-4.1: fixtures страницы «Диагностика прогнозирования».
 * Показаны состояния: данные доступны, quality недоступно, errors недоступно, ошибка API,
 * пустой список диагностик, ожидание факта и устаревшая актуальность.
 */
import { trusted, type TrustedHtml } from "../../../src/web/lib/format";
import type { ApiResult } from "../../../src/web/api/client";
import { forecastDiagnosticsPage, type ForecastErrorsDto } from "../../../src/web/pages/forecast-diagnostics";
import { apiMeta, referenceBanner } from "./common";
import { qualityShadowFixture } from "./forecast-quality";

function errorsAvailable(): ApiResult<ForecastErrorsDto> {
  return {
    status: "ok",
    data: {
      mode: "shadow",
      total: 3,
      persistedErrorsAvailable: false,
      items: [
        { source: "detected", kind: "UNKNOWN_HORIZON", snapshotId: "reference-snapshot-0007", recordType: "snapshot", reason: "горизонт вне поддерживаемых" },
        { source: "detected", kind: "CONFLICT_PAIR_IDENTITY", snapshotId: "reference-snapshot-0011", recordType: "snapshot", reason: "несколько записей на одну пару" },
        { source: "detected", kind: "UNKNOWN_RECONCILIATION", snapshotId: "reference-snapshot-0014", recordType: "reconciliation", reason: "невалидные обязательные поля" },
      ],
    },
    meta: apiMeta(),
  };
}

function errorsEmpty(): ApiResult<ForecastErrorsDto> {
  return { status: "ok", data: { mode: "shadow", total: 0, persistedErrorsAvailable: false, items: [] }, meta: apiMeta() };
}

export function diagnosticsContent(): TrustedHtml {
  const qualityOk = { status: "ok", data: qualityShadowFixture(), meta: apiMeta() } as ApiResult<ReturnType<typeof qualityShadowFixture>>;
  const qualityMissing: ApiResult<ReturnType<typeof qualityShadowFixture>> = { status: "not_available", data: null, meta: { ...apiMeta(), reason: "NO_RECORDS_FOR_MODE_AND_HORIZON" } };
  const errorsMissing: ApiResult<ForecastErrorsDto> = { status: "not_available", data: null, meta: { ...apiMeta(), reason: "NO_DETECTED_DIAGNOSTICS" } };
  const errorsFailure: ApiResult<ForecastErrorsDto> = { status: "error", error: { code: "DATA_SOURCE_CORRUPTED", message: "Источник повреждён", eventId: "reference-event-0001" } };

  const available = forecastDiagnosticsPage({ mode: "shadow", horizon: 1, quality: qualityOk, errors: errorsAvailable(), generatedAt: apiMeta().generatedAt });
  const qualityUnavailable = forecastDiagnosticsPage({ mode: "shadow", horizon: 1, quality: qualityMissing, errors: errorsAvailable(), generatedAt: null });
  const errorsUnavailable = forecastDiagnosticsPage({ mode: "shadow", horizon: 1, quality: qualityOk, errors: errorsMissing, generatedAt: null });
  const emptyList = forecastDiagnosticsPage({ mode: "replay", horizon: 3, quality: qualityOk, errors: errorsEmpty(), generatedAt: null });
  const failure = forecastDiagnosticsPage({ mode: "shadow", horizon: 3, quality: qualityMissing, errors: errorsFailure, generatedAt: null });

  return trusted(`${referenceBanner()}${available}${qualityUnavailable}${errorsUnavailable}${emptyList}${failure}`);
}
