/** UI-2/2.2: read-only доступ к источникам DSS. Записи не выполняются. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readCanonicalCsv } from "../forecasting/analytics/expansion/history-builder";
import {
  isReconciliationRecord,
  isShadowErrorRecord,
  isSnapshotRecord,
  readJsonl,
  storePaths,
  type ReconciliationRecord,
  type ShadowError,
  type ShadowManifest,
  type ShadowSnapshot,
} from "../forecasting/shadow/store";
import { SourceError } from "./api";

/** R11: рабочая директория источников определяется от расположения модуля, а не от cwd. */
export const PROJECT_ROOT = resolve(import.meta.dir, "../..");
export const CANONICAL_CSV = resolve(PROJECT_ROOT, "data/processed/forecasting/7745/canonical_daily_delivered_orders.csv");
export const SHADOW_DIR = resolve(PROJECT_ROOT, "data/shadow/7745");
export const SHOP_NO = "7745";
export const SLICE_ID = 20624;
export const TARGET_METRIC = "qty_orders_delivered";
export const TIMEZONE = "Europe/Moscow";
/** R8: ожидаемая схема canonical CSV (порядок и состав колонок). */
export const CANONICAL_COLUMNS = ["date", "shop_no", "metric", "value", "source_slice_id", "source_dataset_id", "source_run_id", "quality_status"] as const;

/** R8: календарная дата проверяется round-trip. */
export function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export interface HistoryPoint { date: string; value: number }

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
function shadowPaths() {
  return storePaths(SHADOW_DIR);
}

export interface HistoryReadResult {
  points: HistoryPoint[];
  /** R5: checksum исходного файла как есть (байты). */
  fileChecksum: string;
  /** R5: checksum нормализованных точек (date\tvalue) — не равен fileChecksum. */
  normalizedChecksum: string;
}

export async function readHistory(csvPath: string = CANONICAL_CSV): Promise<HistoryReadResult> {
  let text: string;
  try {
    text = await readFile(csvPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SourceError("SOURCE_NOT_AVAILABLE", "Canonical dataset is not available");
    throw new SourceError("SOURCE_READ_FAILED", "Canonical dataset cannot be read");
  }
  // UI-2.2.5.1: без глобального trim. Снимается ровно один завершающий разделитель:
  // CRLF — целиком, LF — как одиночный символ. Одиночный завершающий CR не удаляется
  // и остаётся частью последнего значения (будет отклонён числовой валидацией).
  let content = text;
  if (content.endsWith("\r\n")) content = content.slice(0, -2);
  else if (content.endsWith("\n")) content = content.slice(0, -1);

  const lines = content.split(/\r?\n/);
  if (lines.length < 2 || lines.some((line) => line.length === 0)) {
    throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset contains empty rows");
  }
  const header = lines[0]!.split(",");
  // R8: однозначное сопоставление колонок — точный набор и порядок, без дублей и лишних колонок
  if (header.length !== CANONICAL_COLUMNS.length) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset has an unexpected column count");
  if (new Set(header).size !== header.length) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset has duplicate columns");
  for (const [index, column] of CANONICAL_COLUMNS.entries()) {
    if (header[index] !== column) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset column ${index} must be ${column}`);
  }
  const columnIndex = (name: string): number => CANONICAL_COLUMNS.indexOf(name as (typeof CANONICAL_COLUMNS)[number]);
  // R8: построчная проверка сырого CSV — пустое значение не превращается в 0,
  // нечисловое/NULL отклоняется как повреждение источника (readCanonicalCsv маскирует их как 0/null).
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split(",");
    const row = index + 2;
    if (cells.length !== CANONICAL_COLUMNS.length) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an invalid column count`);
    // UI-2.2.5.1: управляющие символы (одиночный \r, не являющийся CRLF-разделителем) не допускаются ни в одной ячейке
    if (cells.some((cell) => cell.includes("\r") || cell.includes("\n"))) {
      throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} contains a control character`);
    }
    const date = cells[columnIndex("date")] ?? "";
    const shopNo = cells[columnIndex("shop_no")] ?? "";
    const metric = cells[columnIndex("metric")] ?? "";
    const rawValue = cells[columnIndex("value")] ?? "";
    const sliceId = cells[columnIndex("source_slice_id")] ?? "";
    if (!isRealCalendarDate(date)) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an invalid date`);
    if (shopNo !== SHOP_NO) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an unexpected shop_no`);
    if (metric !== TARGET_METRIC) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an unexpected metric`);
    if (sliceId !== String(SLICE_ID)) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an unexpected source_slice_id`);
    if (rawValue.trim() === "") throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an empty value`);
    // UI-2.2.4: числовой домен qty_orders_delivered — неотрицательное целое в десятичном формате.
    // Отклоняются -1, 1.5, 0x10, NaN, Infinity, -Infinity, NULL и любые нестандартные представления;
    // повреждённое значение не превращается в 0.
    if (!DECIMAL_UNSIGNED_INTEGER.test(rawValue)) throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} has an invalid numeric format`);
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || !Number.isSafeInteger(numericValue) || numericValue < 0) {
      throw new SourceError("DATA_SOURCE_CORRUPTED", `Canonical dataset row ${row} is outside the qty_orders_delivered domain`);
    }
  }

  let points: HistoryPoint[];
  try {
    points = await readCanonicalCsv(csvPath);
  } catch {
    throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset cannot be parsed");
  }
  if (points.length !== lines.length - 1) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset rows were dropped during parsing");
  let previous = "";
  for (const point of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date)) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset contains an invalid date");
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset contains a non-finite value");
    if (point.date <= previous) throw new SourceError("DATA_SOURCE_CORRUPTED", "Canonical dataset chronology is violated");
    previous = point.date;
  }
  return {
    points,
    fileChecksum: sha256(text),
    normalizedChecksum: sha256(points.map((point) => `${point.date}\t${point.value}`).join("\n")),
  };
}

export async function readSnapshots(dir: string = SHADOW_DIR): Promise<ShadowSnapshot[]> {
  try {
    return await readJsonl<ShadowSnapshot>(storePaths(dir).forecasts, isSnapshotRecord);
  } catch {
    throw new SourceError("DATA_SOURCE_CORRUPTED", "Shadow forecasts storage is corrupted");
  }
}
export async function readReconciliations(dir: string = SHADOW_DIR): Promise<ReconciliationRecord[]> {
  try {
    return await readJsonl<ReconciliationRecord>(storePaths(dir).reconciliations, isReconciliationRecord);
  } catch {
    throw new SourceError("DATA_SOURCE_CORRUPTED", "Shadow reconciliation storage is corrupted");
  }
}
export async function readShadowErrors(dir: string = SHADOW_DIR): Promise<ShadowError[]> {
  try {
    return await readJsonl<ShadowError>(storePaths(dir).errors, isShadowErrorRecord);
  } catch {
    throw new SourceError("DATA_SOURCE_CORRUPTED", "Shadow error storage is corrupted");
  }
}

/** R1 (UI-2.2.1): допустимые версии, горизонты и формат контрольной суммы. */
export const ALLOWED_MANIFEST_VERSIONS = new Set(["shadow-mode/v1", "shadow-mode/v1.1"]);
export const ALLOWED_MANIFEST_HORIZONS = new Set([1, 3]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Строгий ISO timestamp: YYYY-MM-DDTHH:MM:SS(.sss)Z */
/** Десятичное неотрицательное целое: единственный допустимый формат qty_orders_delivered. */
const DECIMAL_UNSIGNED_INTEGER = /^\d+$/;

const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** R1: календарная дата и время проверяются round-trip, а не только регуляркой. */
export function isStrictIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false;
  if (parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second) return false;
  return !Number.isNaN(Date.parse(value));
}

/** R1: обязательная строка — непустая после trim(). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isManifest(value: unknown): value is ShadowManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  // обязательные поля схемы ShadowManifest (src/forecasting/shadow/store.ts)
  if (typeof record.version !== "string" || !ALLOWED_MANIFEST_VERSIONS.has(record.version)) return false;
  // строгий ISO timestamp (производитель пишет new Date().toISOString())
  if (typeof record.created_at !== "string" || !isStrictIsoTimestamp(record.created_at)) return false;
  if (typeof record.dataset_checksum !== "string" || !SHA256_HEX.test(record.dataset_checksum)) return false;
  // горизонты: только уникальные значения из SHADOW_HORIZONS = [1, 3]
  if (!Array.isArray(record.horizons) || record.horizons.length === 0) return false;
  if (!record.horizons.every((horizon) => typeof horizon === "number" && ALLOWED_MANIFEST_HORIZONS.has(horizon))) return false;
  if (new Set(record.horizons).size !== record.horizons.length) return false;
  // модели: обе модели контура с непустыми версиями
  if (typeof record.models !== "object" || record.models === null) return false;
  const models = record.models as Record<string, unknown>;
  if (!isNonEmptyString(models.rolling_7_day_mean) || !isNonEmptyString(models.adaptive_baseline)) return false;
  // числовые параметры: диапазоны следуют из кода-производителя
  // (calculator: alpha/limitPercent — конечные и неотрицательные; SHADOW_ALPHA=1.0, SHADOW_LIMIT_PERCENT=0.1)
  if (typeof record.alpha !== "number" || !Number.isFinite(record.alpha) || record.alpha < 0) return false;
  if (typeof record.limit_percent !== "number" || !Number.isFinite(record.limit_percent) || record.limit_percent < 0) return false;
  // min_train_days: целое (SHADOW_MIN_TRAIN = 28, sensitivity 21)
  if (typeof record.min_train_days !== "number" || !Number.isInteger(record.min_train_days) || record.min_train_days < 1) return false;
  if (!isNonEmptyString(record.note)) return false;
  return true;
}
export interface ManifestReadResult {
  manifest: ShadowManifest | null;
  status: "OK" | "NOT_AVAILABLE" | "CORRUPTED";
}

/** R1: ENOENT → NOT_AVAILABLE; ошибка чтения/парсинга/структуры → CORRUPTED (fail-closed). */
export async function readManifest(dir: string = SHADOW_DIR): Promise<ManifestReadResult> {
  const manifestPath = storePaths(dir).manifest;
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { manifest: null, status: "NOT_AVAILABLE" };
    return { manifest: null, status: "CORRUPTED" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { manifest: null, status: "CORRUPTED" };
  }
  if (!isManifest(parsed)) return { manifest: null, status: "CORRUPTED" };
  return { manifest: parsed, status: "OK" };
}

/** R1: строгий вариант для операций, которым manifest обязателен. */
export async function requireManifest(): Promise<ShadowManifest> {
  const result = await readManifest();
  if (result.status === "CORRUPTED") throw new SourceError("DATA_SOURCE_CORRUPTED", "Shadow manifest is corrupted");
  if (result.status === "NOT_AVAILABLE" || !result.manifest) throw new SourceError("SOURCE_NOT_AVAILABLE", "Shadow manifest is not available");
  return result.manifest;
}

export async function shadowFileChecksums(): Promise<Record<string, string>> {
  const paths = shadowPaths();
  const result: Record<string, string> = {};
  for (const [name, path] of [["forecasts", paths.forecasts], ["reconciliations", paths.reconciliations], ["manifest", paths.manifest]] as const) {
    try {
      result[name] = sha256(await readFile(path, "utf8"));
    } catch {
      result[name] = "NOT_AVAILABLE";
    }
  }
  return result;
}