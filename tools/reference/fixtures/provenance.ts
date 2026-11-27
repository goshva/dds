/**
 * TPL-4.1: fixtures страницы «Происхождение».
 * Контрольные суммы синтетические и не совпадают с реальными значениями данных.
 */
import { trusted, type TrustedHtml } from "../../../src/web/lib/format";
import { provenancePage, type OverviewForProvenance } from "../../../src/web/pages/provenance";
import { SYNTHETIC_CHECKSUM, referenceBanner, statesCard } from "./common";

export function provenanceFixture(): OverviewForProvenance {
  return {
    shopNo: "7745",
    timezone: "Europe/Moscow",
    metric: "delivered_orders_daily",
    sliceId: 20624,
    semantics: "PROVISIONAL",
    history: {
      days: 900,
      firstDate: "2024-06-01",
      lastDate: "2026-06-18",
      lastValue: 1500,
      checksum: SYNTHETIC_CHECKSUM.normalized,
      fileChecksum: SYNTHETIC_CHECKSUM.file,
      completeness: "PARTIAL",
    },
    provenance: {
      normalizedChecksum: SYNTHETIC_CHECKSUM.normalized,
      fileChecksum: SYNTHETIC_CHECKSUM.file,
      manifestDatasetChecksum: SYNTHETIC_CHECKSUM.manifest,
      manifestStatus: "OK",
      freshness: "MATCH",
    },
  };
}

/** Вариант с расхождением версий: показывает предупреждение, а не ошибку модели. */
export function provenanceStaleFixture(): OverviewForProvenance {
  const base = provenanceFixture();
  return {
    ...base,
    provenance: { ...base.provenance, manifestStatus: "NOT_AVAILABLE", freshness: "STALE", manifestDatasetChecksum: null },
  };
}

export function provenanceContent(): TrustedHtml {
  return trusted(`${referenceBanner()}${provenancePage(provenanceFixture())}${provenancePage(provenanceStaleFixture())}${statesCard()}`);
}
