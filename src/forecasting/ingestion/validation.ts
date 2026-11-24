/**
 * Проверки артефактов перед импортом.
 *
 * Принцип: расхождение структуры или качества — это ОШИБКА, останавливающая импорт.
 * Валидатор и импортёр используют одну и ту же функцию статуса среза
 * ({@link sliceStatusFromQuality}), поэтому ситуация «валидатор дал warning,
 * а importer записал full/actual» невозможна по построению.
 *
 * Неизвестное или отсутствующее значение поля качества НЕ считается успешной проверкой:
 * это безопасный отказ (fail-closed).
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
  /** slice_id, которые повторяются в quality.requests */
  duplicate_quality_slice_ids: number[];
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

/** Ожидаемый даркстор MVP. Импорт другого магазина возможен только с явным указанием. */
export const DEFAULT_EXPECTED_SHOP_NO = "7745";

/** Допустимые значения полноты ответа Superset. */
export const COMPLETENESS_VALUES = ["full", "partial", "truncated", "none"] as const;

export interface ValidateOptions {
  /** Версия преобразования, с которой выполняется импорт (инвариант файла). */
  transformVersion?: string;
  /**
   * Ожидаемый даркстор. Если не задан — используется {@link DEFAULT_EXPECTED_SHOP_NO}.
   * Чтобы импортировать другой магазин, его нужно передать здесь явно.
   */
  expectedShopNo?: string;
  /** Явный список разрешённых магазинов — задел для мультимагазинного режима. */
  allowedShopNos?: readonly string[];
}

function hasOwn(value: unknown, key: string): boolean {
  return value != null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

/** Читает обязательное поле-массив строк. Возвращает пустой массив и пишет причину при дефекте. */
function readStringArray(request: any, field: string, reasons: string[]): string[] {
  if (!hasOwn(request, field)) {
    reasons.push(`отсутствует поле ${field}`);
    return [];
  }
  const value = request[field];
  if (!Array.isArray(value)) {
    reasons.push(`некорректный ${field}: ожидался массив, получено ${JSON.stringify(value)}`);
    return [];
  }
  const notStrings = value.filter((item) => typeof item !== "string");
  if (notStrings.length > 0) {
    reasons.push(`некорректный ${field}: элементы должны быть строками (${JSON.stringify(notStrings.slice(0, 3))})`);
    return value.filter((item) => typeof item === "string").map(String);
  }
  return value.map(String);
}

/**
 * Статус среза по данным quality.json.
 *
 * Полным и фактическим (`full`/`actual`) срез считается только если ВСЕ проверки пройдены:
 * HTTP 200, полнота full, нет отсутствующих метрик и измерений, нет дублей, нет обрезанных
 * запросов и несовпадения числа ответов. В любом другом случае срез неполный,
 * а достоверность понижается до `unknown` (неполные данные не являются фактом).
 *
 * Все семь полей обязательны и проверяются по типу: отсутствие или неверный тип —
 * такой же отказ, как и отрицательный результат проверки.
 */
export function sliceStatusFromQuality(request: any, sliceIdFallback?: number): SliceQualityStatus {
  const sliceId = Number(request?.slice_id ?? sliceIdFallback ?? Number.NaN);
  const reasons: string[] = [];

  // --- 1. http_status: обязательное целое число --------------------------------
  let httpStatus: number | null = null;
  if (!hasOwn(request, "http_status")) {
    reasons.push("отсутствует поле http_status");
  } else if (typeof request.http_status !== "number" || !Number.isInteger(request.http_status)) {
    reasons.push(`некорректный http_status: ${JSON.stringify(request.http_status)}`);
  } else {
    httpStatus = request.http_status;
  }
  if (httpStatus !== null && httpStatus !== 200) reasons.push(`HTTP ${httpStatus} (ожидался 200)`);

  // --- 2. completeness: обязательная строка из известного набора ---------------
  let completeness = "none";
  if (!hasOwn(request, "completeness")) {
    reasons.push("отсутствует поле completeness");
  } else if (typeof request.completeness !== "string" || !(COMPLETENESS_VALUES as readonly string[]).includes(request.completeness)) {
    reasons.push(`некорректный completeness: ${JSON.stringify(request.completeness)}`);
  } else {
    completeness = request.completeness;
    // любое корректное значение, кроме full, — это неполный набор
    if (completeness !== "full") reasons.push(`полнота «${completeness}» (ожидалась full)`);
  }

  // --- 3-4. missing_metrics / missing_dimensions: обязательные массивы строк ----
  const missingMetrics = readStringArray(request, "missing_metrics", reasons);
  if (missingMetrics.length > 0) reasons.push(`отсутствуют метрики: ${missingMetrics.join(", ")}`);

  const missingDimensions = readStringArray(request, "missing_dimensions", reasons);
  if (missingDimensions.length > 0) reasons.push(`отсутствуют измерения: ${missingDimensions.join(", ")}`);

  // --- 5. duplicate_rows: обязательное неотрицательное число -------------------
  let duplicateRows = 0;
  if (!hasOwn(request, "duplicate_rows")) {
    reasons.push("отсутствует поле duplicate_rows");
  } else if (typeof request.duplicate_rows !== "number" || !Number.isFinite(request.duplicate_rows) || request.duplicate_rows < 0) {
    reasons.push(`некорректный duplicate_rows: ${JSON.stringify(request.duplicate_rows)}`);
  } else {
    duplicateRows = request.duplicate_rows;
    if (duplicateRows > 0) reasons.push(`дубли строк: ${duplicateRows}`);
  }

  // --- 6. truncated_queries: обязательный массив -------------------------------
  let truncatedCount = 0;
  if (!hasOwn(request, "truncated_queries")) {
    reasons.push("отсутствует поле truncated_queries");
  } else if (!Array.isArray(request.truncated_queries)) {
    reasons.push(`некорректный truncated_queries: ожидался массив, получено ${JSON.stringify(request.truncated_queries)}`);
  } else {
    truncatedCount = request.truncated_queries.length;
    if (truncatedCount > 0) reasons.push(`обрезанные запросы: ${truncatedCount}`);
  }

  // --- 7. query_count_mismatch: обязательный boolean ---------------------------
  if (!hasOwn(request, "query_count_mismatch")) {
    reasons.push("отсутствует поле query_count_mismatch");
  } else if (typeof request.query_count_mismatch !== "boolean") {
    reasons.push(`некорректный query_count_mismatch: ${JSON.stringify(request.query_count_mismatch)}`);
  } else if (request.query_count_mismatch === true) {
    reasons.push("число ответов не совпало с числом запросов");
  }

  const importableAsFull = reasons.length === 0;

  // data_status не может быть выше фактической полноты ответа
  let dataStatus: DataStatus;
  if (httpStatus !== 200) dataStatus = "none";
  else {
    dataStatus = completeness as DataStatus;
    // «full» от источника при найденных дефектах понижается до partial
    if (dataStatus === "full" && !importableAsFull) dataStatus = "partial";
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
  // Явный список разрешённых магазинов: приоритет у allowedShopNos, затем expectedShopNo,
  // затем значение по умолчанию MVP. Импорт другого магазина требует явного указания.
  const allowedShopNos =
    options.allowedShopNos && options.allowedShopNos.length > 0
      ? [...options.allowedShopNos]
      : [options.expectedShopNo ?? DEFAULT_EXPECTED_SHOP_NO];

  if (!shopNo) {
    findings.push({ severity: "error", message: "в манифесте не указан shopno — инвариант natural key не определён" });
  } else if (!allowedShopNos.includes(shopNo)) {
    findings.push({
      severity: "error",
      message:
        `shopno манифеста «${shopNo}» не разрешён (ожидался один из [${allowedShopNos.join(", ")}]). ` +
        "Для импорта другого магазина передайте его явно в expectedShopNo/allowedShopNos",
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

  // --- качество: уникальность записей quality.json ------------------------------
  // Повтор slice_id в quality.requests означает, что две разные записи претендуют на один срез.
  // Молчаливая перезапись в Map запрещена: сохраняем первую запись, а дубли фиксируем как ошибку.
  const qualityBySlice = new Map<number, any>();
  const duplicateQualitySliceIds: number[] = [];
  for (const request of artifacts.quality?.requests ?? []) {
    const sliceId = Number(request?.slice_id);
    if (!Number.isFinite(sliceId)) {
      findings.push({ severity: "error", message: `в quality.json запись без корректного slice_id: ${JSON.stringify(request?.slice_id)}` });
      continue;
    }
    if (qualityBySlice.has(sliceId)) {
      if (!duplicateQualitySliceIds.includes(sliceId)) duplicateQualitySliceIds.push(sliceId);
      continue; // НЕ перезаписываем уже сохранённую запись
    }
    qualityBySlice.set(sliceId, request);
  }
  if (duplicateQualitySliceIds.length) {
    findings.push({
      severity: "error",
      message: `в quality.json повторяются slice_id: ${duplicateQualitySliceIds.join(", ")} — какая запись достоверна, не определено`,
    });
  }

  // --- качество каждого ожидаемого среза ---------------------------------------
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
    duplicate_quality_slice_ids: duplicateQualitySliceIds,
    rows_without_date: rowsWithoutDate,
    duplicate_keys: duplicates,
    natural_key_fields: [...NATURAL_KEY_FIELDS],
    invariants: { shop_no: shopNo, transform_version: transformVersion },
    slice_statuses: sliceStatuses,
  };
}
