/**
 * Проверки артефактов перед импортом.
 *
 * Принцип: расхождение структуры или качества — это ОШИБКА, останавливающая импорт.
 * Валидатор и импортёр используют одну и ту же функцию статуса среза
 * ({@link sliceStatusFromQuality}), поэтому ситуация «валидатор дал warning,
 * а importer записал full/actual» невозможна по построению.
 */

import type { DataStatus, EvidenceStatus } from "../storage/interfaces/types";
import type { RunArtifacts } from "./artifact-reader";

export interface ValidationFinding {
  severity: "error" | "warning";
  message: string;
}

/** Статус среза, вычисленный из quality.json — единый источник правды для валидатора и импортёра. */
export interface SliceQualityStatus {
  slice_id: number;
  data_status: DataStatus;
  evidence_status: EvidenceStatus;
  /** Срез можно загрузить как полный фактический набор */
  importable_as_full: boolean;
  reasons: string[];
}

export interface ValidationResult {
  ok: boolean;
  findings: ValidationFinding[];
  slices_in_manifest: number[];
  slices_with_rows: number[];
  slices_missing_quality: number[];
  duplicate_slice_ids: number[];
  rows_without_date: number;
  duplicate_keys: number;
  /** Поля natural key наблюдения — в точности как в SQLite */
  natural_key_fields: string[];
  /** Инварианты одного импортируемого файла: одинаковы для всех его строк */
  invariants: { shop_no: string; transform_version: string };
  slice_statuses: SliceQualityStatus[];
}

/** Поля natural key наблюдения. Совпадает с UNIQUE-ключом таблицы daily_metrics. */
export const NATURAL_KEY_FIELDS = [
  "shop_no",
  "date",
  "slice_id",
  "dimension_1",
  "dimension_2",
  "metric",
  "transform_version",
] as const;

export interface ValidateOptions {
  /** Версия преобразования, с которой выполняется импорт (инвариант файла). */
  transformVersion?: string;
  /** Ожидаемый даркстор; если задан и не совпал с манифестом — ошибка. */
  expectedShopNo?: string;
}

/**
 * Статус среза по данным quality.json.
 *
 * Полным и фактическим (`full`/`actual`) срез считается только если ВСЕ проверки пройдены:
 * HTTP 200, полнота full, нет отсутствующих метрик и измерений, нет дублей, нет обрезанных
 * запросов и несовпадения числа ответов. В любом другом случае срез неполный,
 * а достоверность понижается до `unknown` (неполные данные не являются фактом).
 */
export function sliceStatusFromQuality(request: any, sliceIdFallback?: number): SliceQualityStatus {
  const sliceId = Number(request?.slice_id ?? sliceIdFallback ?? Number.NaN);
  const reasons: string[] = [];

  const httpStatus = request?.http_status == null ? null : Number(request.http_status);
  if (httpStatus !== 200) reasons.push(`HTTP ${httpStatus ?? "—"} (ожидался 200)`);

  const completeness = String(request?.completeness ?? "none");
  if (completeness !== "full") reasons.push(`полнота «${completeness}» (ожидалась full)`);

  const missingMetrics = Array.isArray(request?.missing_metrics) ? request.missing_metrics.map(String) : [];
  if (missingMetrics.length > 0) reasons.push(`отсутствуют метрики: ${missingMetrics.join(", ")}`);

  const missingDimensions = Array.isArray(request?.missing_dimensions) ? request.missing_dimensions.map(String) : [];
  if (missingDimensions.length > 0) reasons.push(`отсутствуют измерения: ${missingDimensions.join(", ")}`);

  const duplicateRows = Number(request?.duplicate_rows ?? 0);
  if (duplicateRows > 0) reasons.push(`дубли строк: ${duplicateRows}`);

  const truncatedQueries = Array.isArray(request?.truncated_queries) ? request.truncated_queries : [];
  if (truncatedQueries.length > 0) reasons.push(`обрезанные запросы: ${truncatedQueries.length}`);

  if (request?.query_count_mismatch === true) reasons.push("число ответов не совпало с числом запросов");

  const importableAsFull = reasons.length === 0;

  // data_status не может быть выше фактической полноты ответа
  let dataStatus: DataStatus;
  if (httpStatus !== 200) dataStatus = "none";
  else if (completeness === "full" || completeness === "partial" || completeness === "truncated" || completeness === "none") {
    dataStatus = completeness as DataStatus;
    // «full» от источника при найденных дефектах понижается до partial
    if (dataStatus === "full" && !importableAsFull) dataStatus = "partial";
  } else {
    dataStatus = "none";
  }

  return {
    slice_id: sliceId,
    data_status: dataStatus,
    evidence_status: importableAsFull ? "actual" : "unknown",
    importable_as_full: importableAsFull,
    reasons,
  };
}

export function validateArtifacts(artifacts: RunArtifacts, options: ValidateOptions = {}): ValidationResult {
  const findings: ValidationFinding[] = [];

  // --- инварианты файла -------------------------------------------------------
  // shop_no берётся из манифеста, transform_version — параметр импорта; оба одинаковы для всех строк,
  // поэтому natural key внутри файла эквивалентен SQLite-ключу
  // (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version).
  const shopNo = String(artifacts.manifest?.shopno ?? "").trim();
  if (!shopNo) {
    findings.push({ severity: "error", message: "в манифесте не указан shopno — инвариант natural key не определён" });
  } else if (options.expectedShopNo && shopNo !== options.expectedShopNo) {
    findings.push({
      severity: "error",
      message: `shopno манифеста «${shopNo}» не совпадает с ожидаемым «${options.expectedShopNo}»`,
    });
  }
  const transformVersion = String(options.transformVersion ?? "v1");
  if (!transformVersion.trim()) {
    findings.push({ severity: "error", message: "не задана версия преобразования (transform_version) — инвариант natural key не определён" });
  }

  // --- состав срезов: манифест ↔ CSV (двусторонняя проверка) -------------------
  const sources = Array.isArray(artifacts.manifest?.sources) ? artifacts.manifest.sources : [];
  const manifestSlicesRaw = sources.map((s: any) => Number(s.slice_id)).filter((n: number) => Number.isFinite(n));

  const duplicateSliceIds: number[] = [];
  const seenManifest = new Set<number>();
  for (const slice of manifestSlicesRaw) {
    if (seenManifest.has(slice)) {
      if (!duplicateSliceIds.includes(slice)) duplicateSliceIds.push(slice);
    } else seenManifest.add(slice);
  }
  if (duplicateSliceIds.length) {
    findings.push({
      severity: "error",
      message: `в манифесте повторяются slice_id: ${duplicateSliceIds.join(", ")}`,
    });
  }
  const slicesInManifest = [...seenManifest].sort((a: number, b: number) => a - b);
  if (!slicesInManifest.length) findings.push({ severity: "error", message: "в манифесте нет ни одного источника" });

  const rowsBySlice = new Map<number, number>();
  for (const row of artifacts.observations) {
    rowsBySlice.set(row.slice_id, (rowsBySlice.get(row.slice_id) ?? 0) + 1);
  }
  const slicesWithRows = [...rowsBySlice.keys()].sort((a, b) => a - b);

  // (1) каждый срез манифеста должен присутствовать в CSV и быть непустым
  for (const slice of slicesInManifest) {
    const rows = rowsBySlice.get(slice) ?? 0;
    if (rows === 0) {
      findings.push({ severity: "error", message: `срез ${slice} объявлен в манифесте, но строк в CSV нет` });
    }
  }
  // (2) каждый срез CSV должен присутствовать в манифесте
  for (const slice of slicesWithRows) {
    if (!slicesInManifest.includes(slice)) {
      findings.push({ severity: "error", message: `срез ${slice} есть в CSV, но отсутствует в манифесте` });
    }
  }

  // --- качество каждого ожидаемого среза ---------------------------------------
  const qualityBySlice = new Map<number, any>();
  for (const request of artifacts.quality?.requests ?? []) {
    const sliceId = Number(request?.slice_id);
    if (Number.isFinite(sliceId)) qualityBySlice.set(sliceId, request);
  }

  const slicesMissingQuality: number[] = [];
  const sliceStatuses: SliceQualityStatus[] = [];
  for (const slice of slicesInManifest) {
    const quality = qualityBySlice.get(slice);
    if (!quality) {
      slicesMissingQuality.push(slice);
      findings.push({ severity: "error", message: `срез ${slice}: нет записи в quality.json` });
      sliceStatuses.push({
        slice_id: slice,
        data_status: "none",
        evidence_status: "unknown",
        importable_as_full: false,
        reasons: ["нет записи в quality.json"],
      });
      continue;
    }

    const status = sliceStatusFromQuality(quality, slice);
    sliceStatuses.push(status);
    for (const reason of status.reasons) {
      findings.push({ severity: "error", message: `срез ${slice}: ${reason} — импорт как полного фактического набора запрещён` });
    }
  }

  // лишние записи quality для срезов, которых нет в манифесте — признак рассинхронизации
  for (const slice of qualityBySlice.keys()) {
    if (!slicesInManifest.includes(slice)) {
      findings.push({ severity: "warning", message: `в quality.json есть срез ${slice}, которого нет в манифесте` });
    }
  }

  // --- дубли наблюдений по natural key -----------------------------------------
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of artifacts.observations) {
    const key = [
      shopNo,
      row.date || "TOTAL",
      row.slice_id,
      row.dimension_1,
      row.dimension_2,
      row.metric,
      transformVersion,
    ].join("\u0001");
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  if (duplicates > 0) {
    findings.push({
      severity: "error",
      message: `в выгрузке ${duplicates} дублирующихся наблюдений по natural key (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)`,
    });
  }

  for (const row of artifacts.observations) {
    if (!row.metric_kind) {
      findings.push({ severity: "error", message: `срез ${row.slice_id}, метрика ${row.metric}: не указан metric_kind` });
    }
  }

  const rowsWithoutDate = artifacts.observations.filter((r) => r.date === "").length;
  if (rowsWithoutDate > 0) {
    findings.push({
      severity: "warning",
      message: `${rowsWithoutDate} строк без даты (итоги за период) — в daily_metrics не загружаются, сравниваются отдельно`,
    });
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    ok: errors.length === 0,
    findings,
    slices_in_manifest: slicesInManifest,
    slices_with_rows: slicesWithRows,
    slices_missing_quality: slicesMissingQuality,
    duplicate_slice_ids: duplicateSliceIds,
    rows_without_date: rowsWithoutDate,
    duplicate_keys: duplicates,
    natural_key_fields: [...NATURAL_KEY_FIELDS],
    invariants: { shop_no: shopNo, transform_version: transformVersion },
    slice_statuses: sliceStatuses,
  };
}
