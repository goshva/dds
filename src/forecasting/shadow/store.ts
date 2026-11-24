/**
 * Stage 3.4.8 — Shadow Mode: неизменяемое хранилище снапшотов (append-only JSONL).
 *
 * Решения (согласованы):
 *  - JSONL, без SQLite и миграций;
 *  - snapshot_id детерминирован (sha256 от ключа), generated_at в ID не входит;
 *  - повтор с тем же ID и тем же содержимым — no-op;
 *  - тот же ID с другим содержимым — CONFLICT (остановка, без перезаписи);
 *  - reconcile не изменяет прогнозы, а пишет отдельные записи со ссылкой на snapshot_id.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type ShadowMode = "replay" | "shadow";
export type SnapshotStatus = "OK" | "FALLBACK" | "INVALID";
export type ModelId = "rolling_7_day_mean" | "adaptive_baseline";

export const MODEL_VERSIONS: Record<ModelId, string> = {
  rolling_7_day_mean: "rolling-7-day-mean/v1",
  adaptive_baseline: "adaptive-baseline/v1+variantB",
};

export interface ShadowSnapshot {
  snapshot_id: string;
  run_id: string;
  mode: ShadowMode;
  model_id: ModelId;
  model_version: string;
  variant: "B" | null;
  horizon: 1 | 3;
  origin_date: string;
  target_date: string;
  forecast_value: number | null;
  status: SnapshotStatus;
  fallback_reason: string | null;
  input_data_version: string;
  dataset_checksum: string;
  generated_at: string;
}

export interface ReconciliationRecord {
  snapshot_id: string;
  run_id: string;
  model_id: ModelId;
  horizon: 1 | 3;
  target_date: string;
  forecast_value: number | null;
  actual: number;
  absolute_error: number;
  signed_error: number;
  reconciled_at: string;
}

export interface ShadowError {
  run_id: string;
  mode: ShadowMode;
  code: string;
  message: string;
  origin_date: string | null;
  target_date: string | null;
  model_id: ModelId | null;
  horizon: number | null;
  created_at: string;
}

export interface ShadowManifest {
  version: string;
  created_at: string;
  dataset_checksum: string;
  horizons: number[];
  models: Record<ModelId, string>;
  alpha: number;
  limit_percent: number;
  min_train_days: number;
  note: string;
}

export class ShadowConflictError extends Error {
  readonly code = "SNAPSHOT_CONFLICT";
}

/** Повреждение JSONL-хранилища: fail-closed, без частичного результата. */
export class ShadowStorageCorruptedError extends Error {
  readonly code = "SHADOW_STORAGE_CORRUPTED";
  readonly file: string;
  readonly line: number;
  readonly reason: string;

  constructor(file: string, line: number, reason: string) {
    super(`SHADOW_STORAGE_CORRUPTED: file=${file} line=${line} reason=${reason}`);
    this.name = "ShadowStorageCorruptedError";
    this.file = file;
    this.line = line;
    this.reason = reason;
  }
}

/** SHA-256 от канонизированных строк; используется для snapshot_id и input_data_version. */
export function sha256(payload: string): string {
  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
}

export function snapshotId(input: {
  modelId: ModelId;
  modelVersion: string;
  horizon: 1 | 3;
  originDate: string;
  targetDate: string;
  inputDataVersion: string;
}): string {
  return sha256([input.modelId, input.modelVersion, input.horizon, input.originDate, input.targetDate, input.inputDataVersion].join("|"));
}

/** SHA-256 канонизированной истории (даты и значения), доступной на origin. */
export function inputDataVersion(history: ReadonlyArray<{ date: string; value: number }>): string {
  return sha256(history.map((row) => `${row.date}=${row.value}`).join("\n"));
}

export interface StorePaths {
  dir: string;
  forecasts: string;
  reconciliations: string;
  errors: string;
  manifest: string;
}

export function storePaths(dir: string): StorePaths {
  return {
    dir,
    forecasts: join(dir, "forecasts.jsonl"),
    reconciliations: join(dir, "reconciliations.jsonl"),
    errors: join(dir, "errors.jsonl"),
    manifest: join(dir, "manifest.json"),
  };
}

/**
 * Fail-closed чтение JSONL.
 *
 * - пустые строки и завершающий перевод строки допустимы;
 * - каждая непустая строка разбирается отдельно;
 * - при первой ошибке — ShadowStorageCorruptedError с файлом, номером строки и причиной;
 * - частичный результат не возвращается, повреждённое хранилище не считается пустым.
 */
export async function readJsonl<T>(path: string, validate?: (value: unknown) => value is T): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const file = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const records: T[] = [];
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ShadowStorageCorruptedError(file, index + 1, `JSON.parse: ${(error as Error).message}`);
    }
    if (validate && !validate(parsed)) {
      throw new ShadowStorageCorruptedError(file, index + 1, "структура записи не соответствует контракту");
    }
    records.push(parsed as T);
  }
  return records;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSnapshotRecord(value: unknown): value is ShadowSnapshot {
  if (!isRecordObject(value)) return false;
  return (
    typeof value.snapshot_id === "string" &&
    typeof value.model_id === "string" &&
    (value.horizon === 1 || value.horizon === 3) &&
    typeof value.origin_date === "string" &&
    typeof value.target_date === "string" &&
    (typeof value.forecast_value === "number" || value.forecast_value === null) &&
    typeof value.input_data_version === "string"
  );
}

export function isReconciliationRecord(value: unknown): value is ReconciliationRecord {
  if (!isRecordObject(value)) return false;
  return (
    typeof value.snapshot_id === "string" &&
    typeof value.model_id === "string" &&
    (value.horizon === 1 || value.horizon === 3) &&
    typeof value.actual === "number" &&
    typeof value.absolute_error === "number"
  );
}

export function isShadowErrorRecord(value: unknown): value is ShadowError {
  if (!isRecordObject(value)) return false;
  return typeof value.code === "string" && typeof value.message === "string" && typeof value.run_id === "string";
}

export async function appendJsonl(path: string, record: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function writeManifest(path: string, manifest: ShadowManifest): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export interface AppendResult {
  written: boolean;
  conflict: boolean;
  reason: string;
}

/** Append-only запись снапшота: no-op при совпадении, CONFLICT при расхождении содержимого. */
export async function appendSnapshot(paths: StorePaths, snapshot: ShadowSnapshot): Promise<AppendResult> {
  const existing = await readJsonl<ShadowSnapshot>(paths.forecasts, isSnapshotRecord);
  const same = existing.find((entry) => entry.snapshot_id === snapshot.snapshot_id);
  if (!same) {
    await appendJsonl(paths.forecasts, snapshot);
    return { written: true, conflict: false, reason: "новый снапшот" };
  }

  // run_id и generated_at — аудит-поля, они меняются между запусками и не входят в идентичность
  const comparable = (entry: ShadowSnapshot) =>
    JSON.stringify({ ...entry, run_id: null, generated_at: null });
  if (comparable(same) !== comparable(snapshot)) {
    await appendJsonl(paths.errors, {
      run_id: snapshot.run_id,
      mode: snapshot.mode,
      code: "SNAPSHOT_CONFLICT",
      message: `snapshot_id ${snapshot.snapshot_id} уже существует с другим содержимым`,
      origin_date: snapshot.origin_date,
      target_date: snapshot.target_date,
      model_id: snapshot.model_id,
      horizon: snapshot.horizon,
      created_at: snapshot.generated_at,
    } satisfies ShadowError);
    return { written: false, conflict: true, reason: "CONFLICT: содержимое отличается, перезапись запрещена" };
  }
  return { written: false, conflict: false, reason: "no-op: идентичный снапшот уже сохранён" };
}